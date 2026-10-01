/**
 * Buzz item building blocks: alias header, text / placeholders, vote cluster, poll, support link, overflow menu.
 * Nothing here ever renders an Avatar, a handle or a link to a profile (design §0.1).
 */
import { useState, type FC, type ReactNode } from 'react';
import { ArrowBigDown, ArrowBigUp, Ellipsis, EyeOff, HeartHandshake, Share, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Id } from '@shared/core';
import type { Buzz, BuzzAlias, BuzzItemStatus, BuzzPoll, BuzzReply } from '@shared/buzz';
import { AliasAvatar, Button, IconButton, OpBadge } from '@/ui';
import { OverflowMenu, TimeAgo } from '@/components';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { formatDayTime } from '@/lib/format';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { useDeleteBuzz, useHideAuthor, useHideThread, usePollVote, useVote } from './api';
import { useBuzzStore } from './store';

/* ───────────────────────────── alias header ───────────────────────────── */

export const AliasLine: FC<{ alias: BuzzAlias; isMine: boolean; isOp?: boolean; createdAt: number; trailing?: ReactNode; size?: 'sm' | 'md' }> = ({
  alias, isMine, isOp, createdAt, trailing, size = 'sm',
}) => (
  <div className="flex min-w-0 items-center gap-2">
    <AliasAvatar emoji={alias.emoji} color={alias.color} size={size} />
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="truncate type-label-sm text-ink">
        {isMine ? <span className="text-accent-ink">You</span> : null}
        {isMine ? <span className="text-ink-4"> · </span> : null}
        {alias.label}
      </span>
      {isOp ? <OpBadge /> : null}
      <span className="text-ink-4" aria-hidden>·</span>
      <TimeAgo ts={createdAt} className="shrink-0 type-caption text-ink-3" />
    </div>
    {trailing}
  </div>
);

/* ───────────────────────────── text & placeholders ───────────────────────────── */

/** `held` never reaches another viewer (server: generic 404 / absent); the entry is defence in depth against an empty body. */
const PLACEHOLDER: Partial<Record<BuzzItemStatus, string>> = {
  held: '[held for review]',
  hidden: '[hidden pending review]',
  removed: '[removed by moderators]',
  deleted: '[deleted]',
};

export const BuzzText: FC<{ text: string; status: BuzzItemStatus; clamp?: boolean; large?: boolean; className?: string }> = ({ text, status, clamp, large, className }) => {
  const [expanded, setExpanded] = useState(false);
  const placeholder = text === '' ? PLACEHOLDER[status] : null;
  if (placeholder) return <p className={cn('type-body text-ink-4 italic', className)}>{placeholder}</p>;
  const long = clamp && text.length > 320;
  return (
    <div className={className}>
      <p className={cn(large ? 'type-body-lg' : 'type-body', 'whitespace-pre-wrap break-words text-ink', clamp && !expanded && 'line-clamp-6')}>{text}</p>
      {long ? (
        <button type="button" className="mt-1 type-label-sm text-accent-ink" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
};

/** Community collapse / hidden-anon fold: "Hidden by the community · Tap to view". */
export const CollapsedFold: FC<{ id: Id; reason: 'community' | 'anon'; children: ReactNode }> = ({ id, reason, children }) => {
  const revealed = useBuzzStore((s) => s.revealed[id] === true);
  const reveal = useBuzzStore((s) => s.reveal);
  if (revealed) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => reveal(id)}
      className="flex min-h-11 w-full items-center gap-2 rounded-md bg-surface-2 px-3 text-left type-footnote text-ink-3"
    >
      <EyeOff size={16} strokeWidth={1.75} aria-hidden />
      <span className="flex-1 truncate">{reason === 'community' ? 'Hidden by the community' : 'Hidden by you in this thread'}</span>
      <span className="shrink-0 text-accent-ink">Tap to view</span>
    </button>
  );
};

/* ───────────────────────────── votes ───────────────────────────── */

export const VoteCluster: FC<{ item: Buzz | BuzzReply; size?: 'sm' | 'md' }> = ({ item, size = 'sm' }) => {
  const vote = useVote();
  const disabled = item.isMine || item.status !== 'active';
  const cast = (value: -1 | 1): void => {
    if (disabled) return;
    const next = item.myVote === value ? 0 : value; // tap again to undo
    vote.mutate({ id: item.id, value: next }, { onError: (e) => { if (!handleModerationError(e)) toast.error(errorMessage(e)); } });
  };
  const px = size === 'sm' ? 'h-9' : 'h-11';
  return (
    <div className={cn('inline-flex items-center rounded-full bg-surface-2', px)} role="group" aria-label="Votes">
      <button
        type="button"
        aria-label={item.myVote === 1 ? 'Remove upvote' : 'Upvote'}
        aria-pressed={item.myVote === 1}
        disabled={disabled}
        onClick={() => cast(1)}
        className={cn('flex h-full min-w-11 items-center justify-center rounded-l-full pl-1 text-ink-3 disabled:opacity-45', item.myVote === 1 && 'text-accent-ink')}
      >
        <ArrowBigUp size={20} strokeWidth={1.75} fill={item.myVote === 1 ? 'currentColor' : 'none'} aria-hidden />
      </button>
      <span className={cn('min-w-6 text-center type-label-sm tabular-nums', item.myVote === 1 ? 'text-accent-ink' : item.myVote === -1 ? 'text-incog-down' : 'text-ink-2')}>{item.score}</span>
      <button
        type="button"
        aria-label={item.myVote === -1 ? 'Remove downvote' : 'Downvote'}
        aria-pressed={item.myVote === -1}
        disabled={disabled}
        onClick={() => cast(-1)}
        className={cn('flex h-full min-w-11 items-center justify-center rounded-r-full pr-1 text-ink-3 disabled:opacity-45', item.myVote === -1 && 'text-incog-down')}
      >
        <ArrowBigDown size={20} strokeWidth={1.75} fill={item.myVote === -1 ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </div>
  );
};

/* ───────────────────────────── poll ───────────────────────────── */

function timeLeft(closesAt: number): string {
  const ms = closesAt - Date.now();
  if (ms <= 0) return 'closed';
  const h = Math.ceil(ms / 3_600_000);
  if (h < 24) return `${h}h left`;
  return `${Math.ceil(h / 24)}d left`;
}

export const PollView: FC<{ threadId: Id; poll: BuzzPoll; isMine: boolean; disabled?: boolean }> = ({ threadId, poll, isMine, disabled }) => {
  const voteMut = usePollVote(threadId);
  const canVote = !poll.closed && !isMine && poll.myChoice === null && !disabled;
  return (
    <div className="flex flex-col gap-1.5" role={canVote ? 'group' : undefined} aria-label="Poll">
      {poll.options.map((o) => {
        const pct = o.pct ?? 0;
        const chosen = poll.myChoice === o.id;
        const body = (
          <>
            {poll.resultsVisible ? (
              <span
                aria-hidden
                className={cn('absolute inset-y-0 left-0 rounded-md transition-[width] duration-300 ease-out', chosen ? 'bg-accent-soft' : 'bg-surface-3')}
                style={{ width: `${pct}%` }}
              />
            ) : null}
            <span className="relative z-[1] flex w-full items-center gap-2">
              <span className={cn('min-w-0 flex-1 truncate type-body', chosen ? 'text-accent-ink' : 'text-ink')}>{o.text}</span>
              {poll.resultsVisible ? <span className="shrink-0 type-label-sm tabular-nums text-ink-2">{pct}%</span> : null}
            </span>
          </>
        );
        return canVote ? (
          <button
            key={o.id}
            type="button"
            disabled={voteMut.isPending}
            onClick={() => voteMut.mutate(o.id, { onError: (e) => { if (!handleModerationError(e)) toast.error(errorMessage(e)); } })}
            className="relative flex min-h-11 w-full items-center overflow-hidden rounded-md border border-line bg-surface-2 px-3 text-left hover:border-accent-line"
          >
            {body}
          </button>
        ) : (
          <div key={o.id} className={cn('relative flex min-h-11 w-full items-center overflow-hidden rounded-md bg-surface-2 px-3', chosen && 'ring-1 ring-accent-line')}>
            {body}
          </div>
        );
      })}
      <p className="type-caption text-ink-3 tabular-nums">
        {poll.closed ? `Poll closed · ${poll.totalVotes ?? 0} votes` : poll.resultsVisible ? `${poll.totalVotes ?? 0} votes · ${timeLeft(poll.closesAt)}` : `Vote to see results · ${timeLeft(poll.closesAt)}`}
        {!poll.closed ? <span className="sr-only">{` (closes ${formatDayTime(poll.closesAt)})`}</span> : null}
      </p>
    </div>
  );
};

/* ───────────────────────────── support link ───────────────────────────── */

export const SupportLink: FC = () => (
  <Link to={routes.guidelines('self-harm')} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3 type-caption text-accent-ink">
    <HeartHandshake size={14} strokeWidth={1.75} aria-hidden />
    Support resources
  </Link>
);

/* ───────────────────────────── overflow ───────────────────────────── */

export interface ItemMenuProps {
  item: Buzz | BuzzReply;
  /** Thread pages: hide-thread removes it from the feed and navigates back. */
  onHidden?(): void;
  onDeleted?(): void;
  className?: string;
}

/** Share · Copy link · Report · Hide this thread · Hide this anon in this thread (replies) · Delete (own). No Block (L14). */
export const ItemMenu: FC<ItemMenuProps> = ({ item, onHidden, onDeleted, className }) => {
  const [open, setOpen] = useState(false);
  const del = useDeleteBuzz();
  const hideThread = useHideThread();
  const hideAuthor = useHideAuthor();
  const isRoot = item.kind === 'buzz';
  const shareText = item.text.slice(0, 140);
  const items = [
    ...(!item.isMine
      ? [{
          icon: EyeOff, label: 'Hide this thread',
          onSelect: () => hideThread.mutate({ threadId: item.threadId, hide: true }, { onSuccess: () => { toast.show('Thread hidden'); onHidden?.(); }, onError: (e: unknown) => toast.error(errorMessage(e)) }),
        }]
      : []),
    ...(!isRoot && !item.isMine
      ? [{
          icon: UserX, label: 'Hide this anon in this thread',
          onSelect: () => hideAuthor.mutate(item.id, { onSuccess: () => toast.show('Hidden in this thread'), onError: (e: unknown) => toast.error(errorMessage(e)) }),
        }]
      : []),
  ];
  return (
    <>
      <IconButton icon={Ellipsis} aria-label="More" size="sm" onClick={() => setOpen(true)} className={className} />
      <OverflowMenu
        open={open}
        onOpenChange={setOpen}
        items={items}
        share={isRoot && item.status === 'active' ? { card: { kind: 'buzz', id: item.threadId }, url: routes.buzzThread(item.threadId), title: 'Buzz', text: shareText, mode: 'incognito' } : undefined}
        report={!item.isMine && item.status !== 'deleted' ? { entityType: isRoot ? 'buzz' : 'buzz_reply', entityId: item.id, onReported: onHidden } : undefined}
        onDelete={item.isMine && item.status !== 'deleted'
          ? () => del.mutate(item.id, { onSuccess: () => { toast.show('Deleted'); onDeleted?.(); }, onError: (e) => toast.error(errorMessage(e)) })
          : undefined}
      />
    </>
  );
};

/* ───────────────────────────── share button ───────────────────────────── */

/** Share = text-only card (`kind:'buzz'` → alias-free, `ownerId: null` server-side). */
export const ShareButton: FC<{ item: Buzz }> = ({ item }) => {
  if (item.status !== 'active') return null;
  return (
    <IconButton
      icon={Share}
      aria-label="Share"
      size="sm"
      onClick={() => openShare({ card: { kind: 'buzz', id: item.threadId }, url: routes.buzzThread(item.threadId), title: 'Buzz', text: item.text.slice(0, 140), mode: 'incognito' })}
    />
  );
};

export const ReplyCountButton: FC<{ threadId: Id; count: number }> = ({ threadId, count }) => (
  <Button variant="ghost" size="sm" to={routes.buzzThread(threadId)} className="-ml-2 text-ink-2">
    <span className="tabular-nums">{count}</span>
    <span className="ml-1 type-footnote text-ink-3">{count === 1 ? 'reply' : 'replies'}</span>
  </Button>
);
