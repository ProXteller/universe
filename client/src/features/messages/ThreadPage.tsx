/**
 * Chat thread (design §7.4, SPEC §5.6): compact header with presence / member count, pinned live context card,
 * grouped bubbles with day separators, optimistic send with `clientId`, typing, "Seen" / group read stack,
 * MediaPicker + Lightbox, reactions, reply-to, delete, offer Accept / Decline → "Mark as sold?", quick replies,
 * request bar (Accept / Delete / Block / Report), recipient banners, reconnect bar. Nav hidden.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Flag, Info, MessageCircle, Trash2 } from 'lucide-react';
import type { Id, MediaImage, MessageReactionEmoji, SendMessageRequest, ShareCard, UserSummary } from '@shared/core';
import type { ConversationDetail } from '@shared/messages';
import { LISTING_SAFETY_TIP } from '@shared/messages';
import { Badge, Button, Dialog, EmptyState, ErrorState, IconButton, InfiniteSentinel, Lightbox, PageHeader, Screen, Skeleton } from '@/ui';
import { SafetyCard, ShareCardView } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { api, errorMessage, isApiError } from '@/lib/api';
import { firstName, timeAgo } from '@/lib/format';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { sendWs } from '@/lib/realtime';
import { openBlock, openReport } from '@/lib/report';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import {
  clearInboxUnread, invalidateConversation, invalidateInbox, messagesApi, patchThreadMessage, removeThreadMessage, upsertThreadMessage,
  useConversation, useThread, type LocalMessage,
} from './api';
import { blockAndReport, BubbleSkeleton, MessageBubble, SeenLine, type BubbleActions } from './bubbles';
import { Composer } from './Composer';
import { ConversationAvatar, DaySeparator, ReconnectBar, TypingDots } from './parts';
import { useMessagesStore, useTypingIn } from './store';

const GROUP_GAP_MS = 5 * 60_000;
const NEAR_BOTTOM_PX = 140;

let clientSeq = 0;
const nextClientId = () => `c${Date.now().toString(36)}${(clientSeq++).toString(36)}`;

/* ───────────────────────────── header ───────────────────────────── */

function subtitleFor(d: ConversationDetail, presence: { online: boolean; lastActiveAt: number | null } | undefined): string {
  if (d.kind === 'course') return d.course ? `${d.course.title} · ${d.course.term}` : 'Course chat';
  if (d.kind === 'group') return `${d.memberCount} members`;
  if (d.state === 'request') return 'Message request';
  if (d.requestPending) return 'Request sent';
  if (presence?.online) return 'Active now';
  if (presence?.lastActiveAt) {
    const ago = timeAgo(presence.lastActiveAt);
    return ago === 'now' ? 'Active now' : `Active ${ago} ago`;
  }
  return d.peer ? `@${d.peer.handle}` : '';
}

/* ───────────────────────────── offer helpers ───────────────────────────── */

function useListingCard(listingId: Id | null, pinned: ShareCard | null): ShareCard | null {
  const matches = pinned && pinned.kind === 'listing' && pinned.id === listingId ? pinned : null;
  const q = useQuery<ShareCard>({
    queryKey: ['messages', 'card', 'listing', listingId ?? ''],
    queryFn: () => api.get<ShareCard>(`/cards/listing/${encodeURIComponent(listingId ?? '')}`),
    enabled: !!listingId && !matches,
    staleTime: 60_000,
  });
  return matches ?? q.data ?? null;
}

/* ───────────────────────────── page ───────────────────────────── */

export const ThreadPage: FC = () => {
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  const id = conversationId;
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const draft = (location.state as { draft?: string } | null)?.draft ?? null;
  useScreenView('messages_thread');

  const detail = useConversation(id, !!id);
  const thread = useThread(id, !!id);
  const d = detail.data ?? null;
  const openedKind = d?.kind ?? null;
  useEffect(() => {
    if (openedKind) track('conversation_open', { kind: openedKind });
  }, [id, openedKind]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<Id | null>(null);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: MediaImage[]; index: number } | null>(null);
  const [soldPrompt, setSoldPrompt] = useState<{ listingId: Id; title: string } | null>(null);
  const [confirm, setConfirm] = useState<'delete-request' | 'delete-message' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocalMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const presence = useMessagesStore((s) => (d?.peer ? s.presence[d.peer.id] : undefined));
  const typing = useTypingIn(id, now);
  useEffect(() => {
    if (typing.length === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [typing.length]);

  // oldest → newest for rendering
  const ordered = useMemo(() => [...thread.items].reverse(), [thread.items]);
  const byId = useMemo(() => new Map(ordered.map((m) => [m.id, m])), [ordered]);
  const newest = ordered[ordered.length - 1] ?? null;

  /* focus / presence / read tracking */
  useEffect(() => {
    if (!id) return;
    sendWs({ type: 'conversation.focus', conversationId: id });
    return () => sendWs({ type: 'conversation.focus', conversationId: null });
  }, [id]);
  useEffect(() => {
    if (d?.kind === 'dm' && d.state === 'active' && !d.requestPending && d.peer) sendWs({ type: 'presence.subscribe', userIds: [d.peer.id] });
  }, [d?.kind, d?.state, d?.requestPending, d?.peer]);

  const lastReadSent = useRef<Id | null>(null);
  useEffect(() => {
    if (!d || d.state !== 'active' || !newest || newest.pending || newest.failed) return;
    if (newest.sender?.id === me.id || lastReadSent.current === newest.id) return;
    lastReadSent.current = newest.id;
    clearInboxUnread(id);
    messagesApi.read(id, newest.id).catch(() => undefined);
  }, [d, newest, id, me.id]);

  /* scroll: bottom on first paint + own / near-bottom arrivals; keep position when older pages prepend */
  const firstPaint = useRef(true);
  const prevNewestId = useRef<Id | null>(null);
  const older = useRef<{ height: number; count: number } | null>(null);
  const fetchingOlder = thread.isFetchingNextPage;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || ordered.length === 0) return;
    if (firstPaint.current) {
      el.scrollTop = el.scrollHeight;
      firstPaint.current = false;
      prevNewestId.current = newest?.id ?? null;
      return;
    }
    if (older.current && !fetchingOlder) {
      // an older page landed above: keep what the viewer was looking at in place
      if (ordered.length > older.current.count) el.scrollTop += el.scrollHeight - older.current.height;
      older.current = null;
      prevNewestId.current = newest?.id ?? null;
      return;
    }
    if (newest && newest.id !== prevNewestId.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      if (nearBottom || newest.sender?.id === me.id) el.scrollTop = el.scrollHeight;
      prevNewestId.current = newest.id;
    }
  }, [ordered, newest, me.id, fetchingOlder]);

  const loadOlder = () => {
    const el = scrollRef.current;
    if (!older.current) older.current = { height: el?.scrollHeight ?? 0, count: ordered.length };
    thread.sentinelProps.onReach();
  };

  /* send */
  const send = useCallback(
    async (body: SendMessageRequest): Promise<boolean> => {
      const clientId = body.clientId ?? nextClientId();
      const optimistic: LocalMessage = {
        id: clientId, conversationId: id, sender: me, kind: body.kind, text: body.text ?? '', images: body.images ?? [], imagesWithheld: false,
        card: null, offer: null, reactions: [], replyToId: body.replyToId ?? null, clientId, banner: null, collapsedByBlock: false, deleted: false,
        createdAt: Date.now(), pending: true,
      };
      useMessagesStore.getState().forgetFailed(clientId);
      upsertThreadMessage(id, optimistic);
      try {
        const res = await messagesApi.send(id, { ...body, clientId });
        upsertThreadMessage(id, res);
        showModerationNotice(res.moderation);
        invalidateInbox();
        if (d?.requestPending || d?.state === 'request') invalidateConversation(id);
        return true;
      } catch (e) {
        if (handleModerationError(e, { onEdit: () => setRestoreText(body.text ?? '') })) {
          removeThreadMessage(id, clientId);
          return false;
        }
        if (isApiError(e) && e.status === 403) {
          removeThreadMessage(id, clientId);
          invalidateConversation(id);
          toast.error(errorMessage(e));
          return false;
        }
        if (isApiError(e) && e.status >= 400 && e.status < 500) {
          removeThreadMessage(id, clientId);
          toast.error(errorMessage(e));
          return false;
        }
        useMessagesStore.getState().rememberFailed(clientId, id, { ...body, clientId });
        patchThreadMessage(id, clientId, (m) => ({ ...m, pending: false, failed: true, retry: { ...body, clientId } }));
        return false;
      }
    },
    [id, me, d?.requestPending, d?.state],
  );

  const onTyping = useCallback(
    (isTyping: boolean) => {
      if (!d || d.state !== 'active' || d.requestPending) return;
      sendWs({ type: 'typing.set', conversationId: id, isTyping });
    },
    [d, id],
  );

  /* bubble actions */
  const actions = useMemo<BubbleActions>(
    () => ({
      onReact: (m, emoji: MessageReactionEmoji | null) => {
        // optimistic: drop my previous reaction, add the new one; the server row replaces it on success
        patchThreadMessage(id, m.id, (cur) => {
          const reactions = cur.reactions.map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : { ...r }));
          if (emoji) {
            const hit = reactions.find((r) => r.emoji === emoji);
            if (hit) {
              hit.count += 1;
              hit.mine = true;
            } else reactions.push({ emoji, count: 1, mine: true });
          }
          return { ...cur, reactions: reactions.filter((r) => r.count > 0) };
        });
        messagesApi.react(id, m.id, emoji).then((res) => upsertThreadMessage(id, res)).catch((e) => toast.error(errorMessage(e)));
      },
      onReply: (m) => setReplyTo(m),
      onDelete: (m) => {
        setPendingDelete(m);
        setConfirm('delete-message');
      },
      onRetry: (m) => {
        const body = m.retry ?? useMessagesStore.getState().failedSends[m.id]?.body;
        if (!body) return;
        removeThreadMessage(id, m.id);
        void send({ ...body, clientId: undefined });
      },
      onOffer: (m, action) => {
        messagesApi
          .offer(id, m.id, action)
          .then((res) => {
            upsertThreadMessage(id, res);
            invalidateConversation(id);
            if (action === 'accept' && res.offer) setSoldPrompt({ listingId: res.offer.listingId, title: d?.context?.title ?? 'this listing' });
          })
          .catch((e) => toast.error(errorMessage(e)));
      },
      onOpenImage: (m, index) => setLightbox({ images: m.images, index }),
      onBlockAndReport: (m) => {
        if (m.sender) blockAndReport(m.sender, m.id);
      },
    }),
    [id, send, d?.context?.title],
  );

  /* request bar actions */
  const accept = async () => {
    try {
      await messagesApi.accept(id);
      invalidateConversation(id);
      toast.success('Request accepted');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const decline = async () => {
    try {
      await messagesApi.decline(id);
      invalidateInbox();
      navigate(routes.messagesRequests(), { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const deleteMessage = async () => {
    const m = pendingDelete;
    setPendingDelete(null);
    if (!m) return;
    try {
      const res = await messagesApi.remove(id, m.id);
      upsertThreadMessage(id, res);
      invalidateInbox();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const markSold = async () => {
    const p = soldPrompt;
    setSoldPrompt(null);
    if (!p) return;
    try {
      await messagesApi.markSold(p.listingId);
      toast.success('Marked as sold');
      invalidateConversation(id);
    } catch (e) {
      if (isApiError(e) && e.status === 404) return; // market not available → degrade silently (R6)
      toast.error(errorMessage(e));
    }
  };

  /* receipts */
  const lastOwn = useMemo(() => [...ordered].reverse().find((m) => m.sender?.id === me.id && !m.pending && !m.failed) ?? null, [ordered, me.id]);
  const readAt = useMessagesStore((s) => s.reads);
  const seenBy = useMemo<UserSummary[]>(() => {
    if (!d || !lastOwn) return [];
    return d.members
      .filter((mem) => mem.id !== me.id && mem.lastReadMessageId)
      .filter((mem) => {
        if (mem.lastReadMessageId === lastOwn.id) return true;
        const row = mem.lastReadMessageId ? byId.get(mem.lastReadMessageId) : undefined;
        return !!row && row.createdAt >= lastOwn.createdAt;
      });
  }, [d, lastOwn, byId, me.id]);

  /* offer ownership card */
  const offerListingId = useMemo(() => ordered.find((m) => m.kind === 'offer' && m.offer?.status === 'pending')?.offer?.listingId ?? ordered.find((m) => m.kind === 'offer')?.offer?.listingId ?? null, [ordered]);
  const offerCard = useListingCard(offerListingId, d?.context ?? null);

  /* ───────────── render ───────────── */

  if (!id || detail.isError) {
    return (
      <Screen header={<PageHeader title="Chat" back />}>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title={isApiError(detail.error) && detail.error.status === 404 ? 'This conversation is not available.' : undefined} />
      </Screen>
    );
  }

  const header = (
    <PageHeader
      back
      title={
        d ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <ConversationAvatar c={d} size="sm" presence={presence ? (presence.online ? 'online' : 'offline') : undefined} />
            <span className="flex min-w-0 flex-col text-left">
              <span className="truncate type-headline">{d.title}</span>
              <span className="truncate type-caption text-ink-3">{subtitleFor(d, presence)}</span>
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2.5">
            <Skeleton w={32} h={32} circle />
            <Skeleton w={120} h={14} />
          </span>
        )
      }
      actions={d ? <IconButton icon={Info} aria-label="Conversation info" onClick={() => navigate(routes.chatInfo(id))} /> : null}
      below={
        d?.context ? (
          <div className="bg-canvas px-4 pt-1 pb-2">
            <ShareCardView card={d.context} variant="pinned" />
          </div>
        ) : undefined
      }
    />
  );

  /* thread body */
  let body;
  if (thread.isLoading || (detail.isLoading && !d)) {
    body = (
      <div className="flex flex-col justify-end gap-1 py-4">
        <BubbleSkeleton w={180} />
        <BubbleSkeleton mine w={120} />
        <BubbleSkeleton w={220} />
        <BubbleSkeleton mine w={160} />
        <BubbleSkeleton w={90} />
      </div>
    );
  } else if (thread.isError) {
    body = <ErrorState error={thread.error} onRetry={() => void thread.refetch()} />;
  } else if (ordered.length === 0) {
    body = (
      <div className="flex flex-1 flex-col justify-end">
        <EmptyState
          icon={MessageCircle}
          title={d?.kind === 'dm' ? `This is the start of your chat with ${d.peer ? firstName(d.peer.displayName) : d.title}.` : `This is the start of ${d?.title ?? 'the chat'}.`}
          compact
        />
      </div>
    );
  } else {
    const nodes = [];
    let prev: LocalMessage | null = null;
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i]!;
      const next = ordered[i + 1] ?? null;
      const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
      if (newDay) nodes.push(<DaySeparator key={`day-${m.id}`} ts={m.createdAt} />);
      const sameAsPrev = !!prev && !newDay && prev.kind !== 'system' && m.kind !== 'system' && prev.sender?.id === m.sender?.id && m.createdAt - prev.createdAt < GROUP_GAP_MS;
      const sameAsNext = !!next && next.kind !== 'system' && m.kind !== 'system' && next.sender?.id === m.sender?.id && next.createdAt - m.createdAt < GROUP_GAP_MS && new Date(next.createdAt).toDateString() === new Date(m.createdAt).toDateString();
      const mine = m.sender?.id === me.id;
      const isLastOwn = lastOwn?.id === m.id;
      nodes.push(
        <MessageBubble
          key={m.id}
          m={m}
          mine={mine}
          first={!sameAsPrev}
          last={!sameAsNext}
          showSender={d?.kind !== 'dm'}
          replyTo={m.replyToId ? (byId.get(m.replyToId) ?? null) : null}
          offerOwner={!!offerCard && offerCard.ownerId === me.id && offerCard.id === m.offer?.listingId}
          offerCard={m.kind === 'offer' && offerCard && offerCard.id === m.offer?.listingId ? offerCard : null}
          selected={selected === m.id}
          onSelect={setSelected}
          interactive={d?.state === 'active'}
          actions={actions}
          receipt={
            isLastOwn && seenBy.length > 0 && d?.state === 'active' && !d.requestPending ? (
              d.kind === 'dm' ? <SeenLine at={readAt[`${id}:${seenBy[0]!.id}`] ?? null} /> : <SeenLine at={null} users={seenBy} />
            ) : undefined
          }
        />,
      );
      prev = m;
    }
    body = (
      <div className="flex flex-1 flex-col justify-end pb-2">
        {thread.hasNextPage ? (
          <InfiniteSentinel
            onReach={loadOlder}
            hasMore={thread.hasNextPage}
            isFetching={thread.isFetchingNextPage}
            error={thread.sentinelProps.error}
            onRetry={thread.sentinelProps.onRetry}
            rootRef={scrollRef}
            skeleton={<BubbleSkeleton w={160} />}
            endLabel={null}
          />
        ) : null}
        {d?.context?.kind === 'listing' ? <SafetyCard title="Meeting up safely" points={[LISTING_SAFETY_TIP]} storageKey="uv:messages:listing-safety-tip" tone="info" className="mt-3" /> : null}
        {nodes}
        {typing.length > 0 ? <TypingDots label={d?.kind === 'dm' ? null : typing.map((t) => firstName(t.displayName)).join(', ')} /> : null}
      </div>
    );
  }

  /* footer */
  let footer = null;
  if (d) {
    if (d.state === 'request') {
      footer = (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-1">
            <p className="type-footnote text-ink">
              {d.peer ? `${firstName(d.peer.displayName)} isn't in your Orbit. They won't know you've seen this until you accept.` : "This group invite is waiting for you. Nobody sees you here until you accept."}
            </p>
            {d.kind === 'dm' ? (
              <p className="flex flex-wrap items-center gap-1.5 type-caption text-ink-3">
                {d.peer ? <span>@{d.peer.handle} · {d.peer.universityShortName}</span> : null}
                {d.mutualCount > 0 ? <span>· {d.mutualCount} mutual{d.mutualCount === 1 ? '' : 's'}</span> : null}
                {d.peerIsNewAccount ? <Badge variant="outline" tone="neutral">New account</Badge> : null}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" leftIcon={Check} onClick={() => void accept()} className="flex-1">
              Accept
            </Button>
            <Button variant="ghost" leftIcon={Trash2} onClick={() => setConfirm('delete-request')}>
              Delete
            </Button>
            {d.peer ? (
              <Button variant="danger-ghost" leftIcon={Ban} onClick={() => openBlock(d.peer!, { onBlocked: () => navigate(routes.messagesRequests(), { replace: true }) })}>
                Block
              </Button>
            ) : null}
            <IconButton icon={Flag} aria-label="Report" onClick={() => openReport({ entityType: 'conversation', entityId: id, author: d.peer ?? undefined })} />
          </div>
        </div>
      );
    } else if (!d.canSend && d.cannotSendReason === 'request_pending') {
      footer = (
        <div className="flex min-h-14 items-center justify-center px-4 py-3">
          <span className="type-footnote text-ink-2">Request sent — waiting for {d.peer ? firstName(d.peer.displayName) : 'them'}</span>
        </div>
      );
    } else if (!d.canSend) {
      footer = (
        <div className="flex min-h-14 items-center justify-center px-4 py-3">
          <span className="type-footnote text-ink-2">You can't message this person.</span>
        </div>
      );
    } else {
      footer = (
        <Composer
          draft={draft}
          context={d.context}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          guard={d.requestPending}
          onSend={send}
          onTyping={onTyping}
          restoreText={restoreText}
        />
      );
    }
  }

  return (
    <Screen header={header} footer={footer} scrollRef={scrollRef} className="min-h-full">
      <ReconnectBar />
      {body}
      <Lightbox open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)} images={lightbox?.images ?? []} index={lightbox?.index ?? 0} onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
      <Dialog
        open={confirm === 'delete-request'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this request?"
        description="They won't be told, and they can't send you another request for 30 days."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          setConfirm(null);
          await decline();
        }}
      />
      <Dialog
        open={confirm === 'delete-message'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete for everyone?"
        description="This message will be removed for everyone in the chat."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          setConfirm(null);
          await deleteMessage();
        }}
      />
      <Dialog
        open={!!soldPrompt}
        onOpenChange={(o) => !o && setSoldPrompt(null)}
        title="Mark as sold?"
        description={soldPrompt ? `Offer accepted. Mark ${soldPrompt.title} as sold so nobody else asks about it.` : undefined}
        confirmLabel="Mark as sold"
        cancelLabel="Not yet"
        onConfirm={markSold}
      />
    </Screen>
  );
};
