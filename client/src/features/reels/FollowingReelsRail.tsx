/**
 * `FollowingReelsRail` (SPEC §4.6 / §5.2): new reels from accounts the viewer follows (last 7 days), rendered atop
 * Orbit. Avatars `ring="orbit"` + first name, tap → `/reel/:id`. Renders NOTHING while loading, on error or when
 * empty. Query key is the reserved `['reels','following']` (foundation invalidates it after follow / unfollow /
 * block). Horizontal scroller uses `scroll-x` so its edges never move the Home pager.
 */
import { type FC } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/ui';
import { cn } from '@/lib/cn';
import { firstName } from '@/lib/format';
import { routes } from '@/lib/links';
import { useFollowingReels } from './api';

export const FollowingReelsRail: FC<{ className?: string }> = ({ className }) => {
  const query = useFollowingReels();
  const items = query.data?.items ?? [];
  if (query.isLoading || query.isError || items.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-1.5 py-2', className)} aria-label="New reels from people you follow">
      <span className="px-4 type-overline text-ink-3">New reels</span>
      <ul className="scroll-x flex gap-3 px-4 pb-1" data-no-pager-drag>
        {items.map((reel) => (
          <li key={reel.id} className="w-16 shrink-0">
            <Link to={routes.reel(reel.id)} className="press flex flex-col items-center gap-1.5 rounded-lg" aria-label={`Reel by ${reel.author.displayName}`}>
              <Avatar
                src={reel.author.avatarUrl}
                name={reel.author.displayName}
                size="lg"
                ring="orbit"
                shape={reel.author.accountType === 'org' ? 'org' : 'circle'}
                badge={reel.author.isVerified ? 'verified' : undefined}
              />
              <span className="w-full truncate text-center type-caption text-ink-2">{firstName(reel.author.displayName)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
