/**
 * /buzz/:threadId — thread page (design §7.2 "Buzz thread"). Compact header "Thread" + overflow; root in type-body-lg
 * without card chrome; replies nested two visual levels (depth-1 with a 2px rail, depth-2 indented, deeper ones already
 * flattened server-side with "↳ replying to {alias}"); "You · {alias}" on own items; bottom glass reply bar with the
 * inline incognito ComposerModeBanner. ws `buzz.thread_updated` → refetch.
 */
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CornerDownRight, Lock, MessageCircle, SendHorizontal, X } from 'lucide-react';
import { LIMITS, type Id } from '@shared/core';
import type { BuzzReply, BuzzThread } from '@shared/buzz';
import { Badge, EmptyState, ErrorState, IconButton, InfiniteSentinel, PageHeader, Screen, Skeleton, SkeletonText, Surface, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner } from '@/components';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { ContentStatusChip, handleModerationError, showModerationNotice } from '@/lib/moderation';
import { useRealtime } from '@/lib/realtime';
import { toast } from '@/lib/toast';
import { invalidateThread, useBuzzReplies, useBuzzThread, useCreateReply } from './api';
import { BuzzContent, BuzzMediaView } from './body';
import { BuzzGatePanel, useBuzzGate } from './gate';
import { AliasLine, BuzzText, CollapsedFold, ItemMenu, PollView, ShareButton, SupportLink, VoteCluster } from './parts';
import { ensureBuzzStoreReset, useBuzzStore } from './store';

export const ThreadPage: FC = () => {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { accepted } = useBuzzGate();
  useEffect(() => {
    ensureBuzzStoreReset();
  }, []);
  const back = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate(routes.home('buzz'), { replace: true });
  };
  return (
    <Surface mode="incognito" className="absolute inset-0">
      {accepted ? (
        <ThreadScreen threadId={threadId} onBack={back} />
      ) : (
        <Screen header={<PageHeader title="Thread" mode="compact" back={back} />}>
          <BuzzGatePanel variant="page" onDismiss={back} className="pt-4" />
        </Screen>
      )}
    </Surface>
  );
};

const ThreadScreen: FC<{ threadId: Id; onBack(): void }> = ({ threadId, onBack }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thread = useBuzzThread(threadId);
  const replies = useBuzzReplies(threadId, thread.data?.replies);
  const create = useCreateReply(threadId);
  const draft = useBuzzStore((s) => s.replyDrafts[threadId]) ?? { text: '', parentId: null };
  const setReplyDraft = useBuzzStore((s) => s.setReplyDraft);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [sending, setSending] = useState(false);

  useRealtime('buzz.thread_updated', (e) => {
    if (e.threadId === threadId) invalidateThread(threadId);
  });

  const byId = useMemo(() => new Map(replies.items.map((r) => [r.id, r])), [replies.items]);
  const replyingTo = draft.parentId ? byId.get(draft.parentId) ?? null : null;
  const tree = useMemo(() => buildTree(threadId, replies.items), [threadId, replies.items]);

  const focusComposer = (parentId: Id | null): void => {
    setReplyDraft(threadId, { text: draft.text, parentId });
    textRef.current?.focus();
  };

  const send = (): void => {
    const text = draft.text.trim();
    if (!text || sending) return;
    setSending(true);
    create.mutate(
      { text, ...(draft.parentId ? { parentId: draft.parentId } : {}) },
      {
        onSuccess: (res) => {
          showModerationNotice(res.moderation);
          setReplyDraft(threadId, null);
          if (res.moderation.status !== 'held') toast.success(`Replied as ${res.alias.label}`);
        },
        onError: (e) => {
          if (isApiError(e) && e.status === 403 && (e.details as { reason?: string } | undefined)?.reason === 'locked') toast.error('This thread is locked.');
          else if (!handleModerationError(e, { onEdit: () => textRef.current?.focus() })) toast.error(errorMessage(e));
        },
        onSettled: () => setSending(false),
      },
    );
  };

  const root = thread.data?.root;
  const locked = root?.locked === true || (root !== undefined && root.status !== 'active');
  const gateError = isApiError(thread.error, 'buzz_gate_required');

  return (
    <Screen
      scrollRef={scrollRef}
      header={<PageHeader title="Thread" mode="compact" back={onBack} actions={root ? <ItemMenu item={root} onHidden={onBack} onDeleted={onBack} /> : undefined} />}
      footer={
        root && !locked ? (
          <ComposerGuard scope="buzz" className="mx-4 my-2">
            <div className="flex flex-col gap-2 px-4 py-2">
              <div className="flex items-center gap-2">
                <ComposerModeBanner mode="incognito" size="inline" verb="Replying" />
                {replyingTo ? (
                  <span className="flex min-w-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-1 type-caption text-ink-2">
                    <CornerDownRight size={12} aria-hidden />
                    <span className="truncate">{replyingTo.alias.label}</span>
                    <button type="button" aria-label="Reply to the buzz instead" onClick={() => setReplyDraft(threadId, { text: draft.text, parentId: null })} className="ml-0.5 text-ink-3">
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textRef}
                  variant="bare"
                  aria-label="Reply anonymously"
                  placeholder="Reply anonymously…"
                  value={draft.text}
                  minRows={1}
                  maxRows={5}
                  maxLength={LIMITS.buzzReplyText}
                  showCount={draft.text.length > LIMITS.buzzReplyText - 60}
                  onChange={(e) => setReplyDraft(threadId, { text: e.target.value, parentId: draft.parentId })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
                  }}
                  className="flex-1 rounded-lg bg-surface-2 px-3 py-2"
                />
                <IconButton icon={SendHorizontal} aria-label="Send reply" variant="accent" disabled={!draft.text.trim() || sending} onClick={send} />
              </div>
            </div>
          </ComposerGuard>
        ) : root && locked ? (
          <div className="flex min-h-12 items-center gap-2 px-4 type-footnote text-ink-3">
            <Lock size={14} aria-hidden />
            {root.locked ? 'This thread is locked.' : 'This buzz is no longer open for replies.'}
          </div>
        ) : undefined
      }
    >
      {thread.isLoading ? (
        <div className="flex flex-col gap-4 px-4 pt-3" aria-busy>
          <div className="flex items-center gap-2">
            <Skeleton w={36} h={36} circle />
            <Skeleton w={120} h={14} />
          </div>
          <SkeletonText lines={4} />
          <Skeleton w={104} h={36} className="rounded-full" />
        </div>
      ) : thread.isError && !gateError ? (
        <ErrorState title={isApiError(thread.error) && thread.error.status === 404 ? "That buzz isn't available." : "Buzz didn't load. That's on us."} error={thread.error} onRetry={() => void thread.refetch()} className="px-4 pt-6" />
      ) : root ? (
        <>
          <article className="flex flex-col gap-3 px-4 pt-3 pb-4" aria-label="Buzz">
            <AliasLine alias={root.alias} isMine={root.isMine} createdAt={root.createdAt} size="md" trailing={root.isMine ? <ContentStatusChip status={root.status} /> : root.campusShortName ? <Badge variant="soft" tone="neutral">{root.campusShortName}</Badge> : null} />
            {root.collapsed && !root.isMine ? (
              <CollapsedFold id={root.id} reason="community">
                <BuzzContent buzz={root} large />
                <BuzzMediaView media={root.media} className="mt-3" />
              </CollapsedFold>
            ) : (
              <>
                <BuzzContent buzz={root} large />
                <BuzzMediaView media={root.media} />
              </>
            )}
            {root.poll ? <PollView threadId={root.id} poll={root.poll} isMine={root.isMine} disabled={root.status !== 'active'} /> : null}
            {root.supportLink ? <SupportLink /> : null}
            <footer className="flex items-center gap-1">
              <VoteCluster item={root} size="md" />
              <span className="ml-2 inline-flex items-center gap-1 type-footnote text-ink-3">
                <MessageCircle size={16} strokeWidth={1.75} aria-hidden />
                <span className="tabular-nums">{root.replyCount}</span>
              </span>
              <span className="flex-1" />
              <ShareButton item={root} />
            </footer>
          </article>
          <div className="h-px bg-line-subtle" aria-hidden />
          {tree.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No replies yet."
              description="Reply and you'll get your own alias in this thread."
              action={!locked ? { label: 'Write a reply', onClick: () => focusComposer(null) } : undefined}
              compact
              className="pt-6"
            />
          ) : (
            <ol className="flex flex-col px-4 pt-2" aria-label="Replies">
              {tree.map((node) => (
                <li key={node.reply.id} className="py-2">
                  <ReplyItem reply={node.reply} onReply={locked ? undefined : () => focusComposer(node.reply.id)} />
                  {node.children.length > 0 ? (
                    <ol className="ml-4 flex flex-col border-l-2 border-line pl-3" aria-label="Replies to this reply">
                      {node.children.map((child) => (
                        <li key={child.id} className="py-2">
                          <ReplyItem reply={child} onReply={locked ? undefined : () => focusComposer(child.id)} />
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
              <InfiniteSentinel
                onReach={() => void replies.fetchNextPage()}
                hasMore={replies.hasNextPage}
                isFetching={replies.isFetchingNextPage}
                error={replies.error}
                onRetry={() => void replies.fetchNextPage()}
                rootRef={scrollRef}
                endLabel={null}
                skeleton={<SkeletonText lines={2} />}
              />
            </ol>
          )}
        </>
      ) : null}
    </Screen>
  );
};

interface Node {
  reply: BuzzReply;
  children: BuzzReply[];
}

/** Groups a flat, oldest-first reply list into depth-1 nodes with their depth-2 children (already flattened by the server). */
function buildTree(threadId: Id, items: BuzzReply[]): Node[] {
  const nodes: Node[] = [];
  const index = new Map<Id, Node>();
  const orphans: BuzzReply[] = [];
  for (const r of items) {
    if (r.parentId === threadId || r.depth === 1) {
      const node = { reply: r, children: [] };
      nodes.push(node);
      index.set(r.id, node);
    } else {
      const parent = index.get(r.parentId);
      if (parent) parent.children.push(r);
      else orphans.push(r);
    }
  }
  for (const o of orphans) nodes.push({ reply: o, children: [] });
  return nodes;
}

const ReplyItem: FC<{ reply: BuzzReply; onReply?(): void }> = ({ reply, onReply }) => {
  const body = (
    <div className="flex flex-col gap-2">
      <AliasLine alias={reply.alias} isMine={reply.isMine} isOp={reply.isOp} createdAt={reply.createdAt} trailing={<div className="flex shrink-0 items-center">{reply.isMine ? <ContentStatusChip status={reply.status} className="mr-1" /> : null}<ItemMenu item={reply} className="-mr-2" /></div>} />
      {reply.replyingTo ? (
        <span className="inline-flex items-center gap-1 type-caption text-ink-3">
          <CornerDownRight size={12} aria-hidden />
          replying to {reply.replyingTo.emoji} {reply.replyingTo.label}
        </span>
      ) : null}
      <BuzzText text={reply.text} status={reply.status} />
      {reply.supportLink ? <SupportLink /> : null}
      <div className="flex items-center gap-1">
        <VoteCluster item={reply} />
        {onReply && reply.status === 'active' ? (
          <button type="button" onClick={onReply} className="ml-1 inline-flex min-h-9 items-center rounded-full px-2 type-label-sm text-ink-2 hover:bg-surface-2">
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
  if (reply.collapsed && !reply.isMine) {
    return (
      <CollapsedFold id={reply.id} reason={reply.score <= -5 ? 'community' : 'anon'}>
        {body}
      </CollapsedFold>
    );
  }
  return <div className={cn(reply.status === 'deleted' && 'opacity-70')}>{body}</div>;
};
