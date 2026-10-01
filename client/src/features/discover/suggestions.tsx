/**
 * Suggestion cards + rows (design §7.3): every card shows its reason and can be dismissed (x).
 * Public surface only — real avatars, real handles. No Buzz content can reach this file (the API has none).
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Suggestion } from '@shared/discover';
import { IconButton, Skeleton } from '@/ui';
import { FollowButton, UserAvatar, UserRow } from '@/components';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';

export interface SuggestionCardProps {
  suggestion: Suggestion;
  onDismiss(s: Suggestion): void;
}

/** 148px card for the horizontal "People you may know" rail. */
export const SuggestionCard: FC<SuggestionCardProps> = ({ suggestion, onDismiss }) => {
  const navigate = useNavigate();
  const { user, reason } = suggestion;
  return (
    <div className="relative flex w-[148px] shrink-0 snap-start flex-col items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 pb-3 pt-4 text-center">
      <IconButton
        icon={X}
        size="sm"
        aria-label={`Dismiss ${user.displayName}`}
        onClick={() => onDismiss(suggestion)}
        className="absolute top-1 right-1 text-ink-3"
      />
      <UserAvatar user={user} size="lg" />
      <button
        type="button"
        onClick={() => navigate(routes.profile(user.handle))}
        className="press flex w-full min-w-0 flex-col items-center rounded-sm"
        aria-label={`${user.displayName}, @${user.handle}`}
      >
        <span className="w-full truncate type-label text-ink">{user.displayName}</span>
        <span className="w-full truncate type-caption text-ink-3">{user.major ?? `@${user.handle}`}</span>
        <span className="w-full truncate type-caption text-accent-ink">{reason}</span>
      </button>
      <FollowButton userId={user.id} initialFollowing={user.viewer.isFollowing} followsMe={user.viewer.isFollowedBy} size="sm" />
    </div>
  );
};

export const SuggestionCardSkeleton: FC = () => (
  <div aria-hidden className="flex w-[148px] shrink-0 flex-col items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 pb-3 pt-4">
    <Skeleton w={56} h={56} circle />
    <Skeleton w="80%" h={14} />
    <Skeleton w="60%" h={12} />
    <Skeleton w="70%" h={12} />
    <Skeleton w="100%" h={32} className="rounded-full" />
  </div>
);

export interface SuggestionRowProps {
  suggestion: Suggestion;
  onDismiss(s: Suggestion): void;
  className?: string;
}

/** `UserRow` with the reason line and a trailing Follow + dismiss pair. */
export const SuggestionRow: FC<SuggestionRowProps> = ({ suggestion, onDismiss, className }) => {
  const { user, reason } = suggestion;
  return (
    <UserRow
      user={user}
      reason={<span className="text-accent-ink">{reason}</span>}
      className={cn('px-4', className)}
      trailing={
        <div className="flex items-center gap-1">
          <FollowButton userId={user.id} initialFollowing={user.viewer.isFollowing} followsMe={user.viewer.isFollowedBy} size="sm" />
          <IconButton icon={X} size="sm" aria-label={`Dismiss ${user.displayName}`} onClick={() => onDismiss(suggestion)} className="text-ink-3" />
        </div>
      }
    />
  );
};

export const UserRowSkeleton: FC<{ trailing?: boolean }> = ({ trailing = true }) => (
  <div aria-hidden className="flex min-h-16 w-full items-center gap-3 px-4 py-2">
    <Skeleton w={40} h={40} circle />
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Skeleton w="48%" h={14} />
      <Skeleton w="34%" h={12} />
    </div>
    {trailing ? <Skeleton w={84} h={32} className="rounded-full" /> : null}
  </div>
);
