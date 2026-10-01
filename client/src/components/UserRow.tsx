import { forwardRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserListItem, UserSummary } from '@shared/core';
import { Badge, VerifiedBadge } from '@/ui';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { useMeOptional } from '@/lib/session';
import { FollowButton } from './FollowButton';
import { UserAvatar } from './UserAvatar';

export interface UserRowProps {
  user: UserSummary | UserListItem;
  /** Default "@handle · {universityShortName}". */
  subtitle?: ReactNode;
  /** Small line under the subtitle ("Follows you", "Same major"). */
  reason?: ReactNode;
  /** Default `'follow'` unless self. */
  trailing?: ReactNode | 'follow' | 'none';
  /** Default: navigate to the profile. */
  onClick?(): void;
  size?: 'md' | 'lg';
  /** e.g. "Invited you". */
  tag?: string;
  className?: string;
}

function hasViewer(u: UserSummary | UserListItem): u is UserListItem {
  return 'viewer' in u && typeof (u as UserListItem).viewer === 'object';
}

/** Avatar + name + @handle · campus + FollowButton — every list of people looks like this. */
export const UserRow = forwardRef<HTMLDivElement, UserRowProps>(function UserRow(
  { user, subtitle, reason, trailing = 'follow', onClick, size = 'md', tag, className },
  ref,
) {
  const navigate = useNavigate();
  const me = useMeOptional();
  const isSelf = me?.id === user.id || (hasViewer(user) && user.viewer.isSelf);
  const open = onClick ?? (() => navigate(routes.profile(user.handle)));

  let right: ReactNode = null;
  if (trailing === 'follow') {
    right = isSelf ? null : (
      <FollowButton
        userId={user.id}
        initialFollowing={hasViewer(user) ? user.viewer.isFollowing : false}
        followsMe={hasViewer(user) ? user.viewer.isFollowedBy : false}
        size="sm"
      />
    );
  } else if (trailing !== 'none') {
    right = trailing;
  }

  return (
    <div
      ref={ref}
      className={cn('flex w-full items-center gap-3 px-4', size === 'lg' ? 'min-h-[72px] py-2.5' : 'min-h-16 py-2', className)}
    >
      <UserAvatar user={user} size={size === 'lg' ? 'lg' : 'md'} link={false} />
      <button
        type="button"
        onClick={open}
        className="press flex min-w-0 flex-1 flex-col items-start rounded-sm text-left"
        aria-label={`${user.displayName}, @${user.handle}`}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <span className={cn('truncate text-ink', size === 'lg' ? 'type-headline' : 'type-label')}>{user.displayName}</span>
          {user.isVerified ? <VerifiedBadge size={14} /> : null}
          {tag ? (
            <Badge variant="soft" tone="accent" className="shrink-0">
              {tag}
            </Badge>
          ) : null}
        </span>
        <span className="max-w-full truncate type-footnote text-ink-3">
          {subtitle ?? `@${user.handle} · ${user.universityShortName}`}
        </span>
        {reason ? <span className="max-w-full truncate type-caption text-ink-4">{reason}</span> : null}
      </button>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
});
