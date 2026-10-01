/**
 * `UserReelsGrid` (SPEC §4.6 / §5.2): 3-col 9:16 tiles with a view-count overlay, embedded in discover's profile
 * `<Screen>` — never its own scroll container (the sentinel resolves the enclosing screen's scroller).
 * Empty copy by `isSelf` (product §2.2); own held / hidden / removed rows carry the status chip.
 */
import { type FC } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clapperboard, Play } from 'lucide-react';
import type { Reel } from '@shared/reels';
import { EmptyState, ErrorState, InfiniteSentinel, Skeleton } from '@/ui';
import { MediaBox } from '@/components';
import type { UserContentProps } from '@/app/contracts';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { useUserReels } from './api';
import { gradientStyle } from './poster';

function TileSkeleton() {
  return <Skeleton className="aspect-[9/16] w-full rounded-sm" h="auto" />;
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-0.5 px-0.5" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

export const UserReelsGrid: FC<UserContentProps> = ({ userId, handle, isSelf }) => {
  const navigate = useNavigate();
  const list = useUserReels(userId);

  if (list.isLoading) return <GridSkeleton />;
  if (list.isError) return <ErrorState title="Couldn't load reels" error={list.error} onRetry={() => void list.refetch()} />;
  if (list.items.length === 0) {
    return isSelf ? (
      <EmptyState
        compact
        icon={Clapperboard}
        title="Your reels live here."
        description="Post your first — 60 seconds max."
        action={{ label: 'Post a reel', onClick: () => navigate(routes.reelNew()) }}
      />
    ) : (
      <EmptyState compact icon={Clapperboard} title={`@${handle} hasn't posted any reels yet.`} />
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="grid grid-cols-3 gap-0.5 px-0.5">
        {list.items.map((reel) => (
          <li key={reel.id}>
            <ReelTile reel={reel} />
          </li>
        ))}
      </ul>
      <InfiniteSentinel {...list.sentinelProps} skeleton={<GridSkeleton />} endLabel={null} />
    </div>
  );
};

function ReelTile({ reel }: { reel: Reel }) {
  const own = reel.viewer.isSelf && reel.status !== 'active';
  return (
    <Link to={routes.reel(reel.id)} aria-label={reel.caption.trim() || `Reel by @${reel.author.handle}`} className="press block focus-visible:focus-ring">
      {reel.posterUrl ? (
        <MediaBox
          src={reel.posterUrl}
          alt=""
          aspect="9:16"
          rounded="sm"
          overlay={<TileOverlay reel={reel} own={own} />}
        />
      ) : (
        <div className={cn('relative aspect-[9/16] w-full overflow-hidden rounded-sm bg-surface-2')} style={gradientStyle(reel.id)}>
          <TileOverlay reel={reel} own={own} />
        </div>
      )}
    </Link>
  );
}

function TileOverlay({ reel, own }: { reel: Reel; own: boolean }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-scrim-bottom" />
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
        <Play size={12} strokeWidth={0} fill="currentColor" aria-hidden />
        <span className="type-caption tabular-nums">{formatCount(reel.viewCount)}</span>
      </div>
      {own ? (
        <div className="pointer-events-none absolute left-1.5 top-1.5">
          <ContentStatusChip status={reel.status} />
        </div>
      ) : null}
    </>
  );
}
