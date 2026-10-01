import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import type { UserSummary } from '@shared/core';
import { Avatar, type AvatarProps } from '@/ui';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';

export type UserAvatarUser = Pick<UserSummary, 'id' | 'handle' | 'displayName' | 'avatarUrl' | 'accountType' | 'isVerified'>;

export interface UserAvatarProps {
  user: UserAvatarUser;
  size?: AvatarProps['size'];
  ring?: AvatarProps['ring'];
  presence?: 'online' | 'offline';
  /** Default `true` → links to `/u/:handle`. */
  link?: boolean;
  className?: string;
}

/** `Avatar` for a real public user: org shape + verified badge automatic. Never inside Buzz. */
export const UserAvatar = forwardRef<HTMLElement, UserAvatarProps>(function UserAvatar(
  { user, size = 'md', ring = 'none', presence, link = true, className },
  ref,
) {
  const avatar = (
    <Avatar
      ref={link ? undefined : ref}
      src={user.avatarUrl}
      name={user.displayName}
      size={size}
      shape={user.accountType === 'org' ? 'org' : 'circle'}
      ring={ring}
      presence={presence}
      badge={user.isVerified ? 'verified' : undefined}
      className={link ? undefined : className}
    />
  );
  if (!link) return avatar;
  return (
    <Link
      ref={ref as React.Ref<HTMLAnchorElement>}
      to={routes.profile(user.handle)}
      aria-label={user.displayName}
      draggable={false}
      className={cn('press inline-flex shrink-0 rounded-full', user.accountType === 'org' && 'rounded-[30%]', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {avatar}
    </Link>
  );
});
