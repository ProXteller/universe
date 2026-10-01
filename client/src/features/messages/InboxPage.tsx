/**
 * Inbox — Tabs Chats | Requests(n) (§2.3: no All / Unread / Groups chips), client-side filter box, rows with
 * avatar / name / preview / time / unread badge / mute icon / course chip. Requests carrying a context sort first
 * (server) and show their `contextLabel`.
 */
import { useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, BookOpen, MessageCircle, Search, SquarePen } from 'lucide-react';
import type { ConversationSummary } from '@shared/core';
import type { InboxTab } from '@shared/messages';
import { Badge, EmptyState, ErrorState, IconButton, InfiniteSentinel, Input, ListRow, PageHeader, Screen, Skeleton, Tabs } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { routes } from '@/lib/links';
import { sendWs } from '@/lib/realtime';
import { useBadges } from '@/lib/session';
import { useInbox } from './api';
import { ConversationAvatar, ReconnectBar } from './parts';
import { useMessagesStore, useTypingIn } from './store';

const TABS: readonly InboxTab[] = ['chats', 'requests'];

function preview(c: ConversationSummary, typingLabel: string | null): { text: string; accent: boolean } {
  if (typingLabel) return { text: typingLabel, accent: true };
  if (c.requestPending) return { text: 'Request sent', accent: false };
  const m = c.lastMessage;
  if (!m) return { text: c.kind === 'dm' ? 'Say hi' : 'No messages yet', accent: false };
  const prefix = c.kind !== 'dm' && m.senderName ? `${m.senderName}: ` : '';
  return { text: `${prefix}${m.text}`, accent: false };
}

const Row: FC<{ c: ConversationSummary; tab: InboxTab }> = ({ c, tab }) => {
  const navigate = useNavigate();
  const typing = useTypingIn(c.id, Date.now());
  const presence = useMessagesStore((s) => (c.peer ? s.presence[c.peer.id] : undefined));
  const typingLabel = typing.length === 0 ? null : c.kind === 'dm' ? 'typing…' : `${typing[0]!.displayName.split(' ')[0]} is typing…`;
  const p = preview(c, typingLabel);
  const unread = c.unreadCount > 0 && !c.muted;
  const ts = c.lastMessage?.createdAt ?? c.updatedAt;

  return (
    <ListRow
      leading={<ConversationAvatar c={c} presence={presence ? (presence.online ? 'online' : 'offline') : undefined} />}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          {/* A course code is the row's identity: it keeps its full width and the (icon-only) badge gives way first. */}
          <span className={cn('truncate', c.course && 'max-w-full shrink-0')}>{c.title}</span>
          {c.course ? (
            <Badge variant="soft" tone="accent" className="w-5 min-w-0 shrink justify-center overflow-hidden px-0">
              <BookOpen size={11} strokeWidth={2} aria-hidden className="shrink-0" />
              <span className="sr-only">Course chat</span>
            </Badge>
          ) : null}
          {c.peerIsNewAccount && tab === 'requests' ? (
            <Badge variant="outline" tone="neutral" className="shrink-0">
              New account
            </Badge>
          ) : null}
        </span>
      }
      subtitle={
        <span className="flex min-w-0 flex-col">
          {c.contextLabel && tab === 'requests' ? <span className="truncate type-caption text-accent-ink">{c.contextLabel}</span> : null}
          <span className={cn('truncate type-footnote', p.accent ? 'text-accent-ink' : unread ? 'text-ink' : 'text-ink-2')}>{p.text}</span>
        </span>
      }
      meta={<span className="type-caption tabular-nums text-ink-3">{timeAgo(ts)}</span>}
      trailing={
        <span className="flex items-center gap-1.5">
          {c.muted ? <BellOff size={14} strokeWidth={1.75} aria-label="Muted" className="text-ink-3" /> : null}
          {c.unreadCount > 0 ? <Badge variant="count" tone={c.muted ? 'neutral' : 'accent'} count={c.unreadCount} /> : null}
        </span>
      }
      unread={unread}
      onClick={() => navigate(routes.chat(c.id))}
    />
  );
};

const RowSkeleton: FC = () => (
  <div className="flex min-h-17 items-center gap-3 px-4">
    <Skeleton w={56} h={56} circle />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton w="45%" h={14} />
      <Skeleton w="70%" h={12} />
    </div>
    <Skeleton w={28} h={10} />
  </div>
);

export const InboxPage: FC<{ tab: InboxTab }> = ({ tab }) => {
  const navigate = useNavigate();
  const badges = useBadges();
  const [q, setQ] = useState('');
  useScreenView('messages_inbox', { tab });

  const list = useInbox(tab);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list.items;
    return list.items.filter((c) => c.title.toLowerCase().includes(needle) || c.peer?.handle.toLowerCase().includes(needle) || c.lastMessage?.text.toLowerCase().includes(needle));
  }, [list.items, q]);

  // presence for the accepted DM partners on screen (foundation answers only where allowed)
  useEffect(() => {
    const ids = list.items.filter((c) => c.kind === 'dm' && c.state === 'active' && !c.requestPending && c.peer).map((c) => c.peer!.id).slice(0, 30);
    if (ids.length) sendWs({ type: 'presence.subscribe', userIds: ids });
  }, [list.items]);

  const header = (
    <PageHeader
      title="Messages"
      mode="large"
      actions={<IconButton icon={SquarePen} aria-label="New message" onClick={() => navigate(routes.messagesNew())} />}
      below={
        <div className="flex flex-col bg-canvas">
          <Tabs
            value={tab}
            onChange={(v) => navigate(v === 'requests' ? routes.messagesRequests() : routes.messages(), { replace: true })}
            tabs={TABS.map((t) => ({ value: t, label: t === 'chats' ? 'Chats' : 'Requests', count: t === 'requests' && badges.requests > 0 ? badges.requests : undefined }))}
            aria-label="Inbox"
          />
          <div className="px-4 py-2">
            <Input variant="search" leftIcon={Search} placeholder={tab === 'chats' ? 'Search chats' : 'Search requests'} value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} aria-label="Filter conversations" />
          </div>
        </div>
      }
    />
  );

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col">
        {Array.from({ length: 7 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body =
      tab === 'chats' ? (
        <EmptyState
          icon={MessageCircle}
          title="No messages yet"
          description="Say hi to someone from class — or join a course chat."
          action={{ label: 'New message', onClick: () => navigate(routes.messagesNew()) }}
          secondary={{ label: 'Browse course chats', onClick: () => navigate(routes.courses()) }}
        />
      ) : (
        <EmptyState icon={MessageCircle} title="No requests" description="Messages from people you don't follow show up here first." />
      );
  } else if (filtered.length === 0) {
    body = <EmptyState icon={Search} title={`No chats match "${q.trim()}"`} compact />;
  } else {
    body = (
      <div className="flex flex-col">
        {filtered.map((c) => (
          <Row key={c.id} c={c} tab={tab} />
        ))}
        {!q.trim() ? <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} /> : null}
      </div>
    );
  }

  return (
    <Screen nav header={header}>
      <ReconnectBar />
      {body}
    </Screen>
  );
};
