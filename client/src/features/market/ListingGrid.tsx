/**
 * The 2-column listing grid every market list uses: skeleton → content → `InfiniteSentinel`, with EmptyState and
 * ErrorState(retry). 12px gap, 16px gutters, fixed tile geometry (no layout shift).
 */
import type { FC, ReactNode } from 'react';
import type { ListingCard } from '@shared/market';
import { ErrorState, InfiniteSentinel, type InfiniteSentinelProps } from '@/ui';
import { cn } from '@/lib/cn';
import { ListingTile, ListingTileSkeleton } from './ListingCard';

export interface ListingGridProps {
  items: ListingCard[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry(): void;
  sentinelProps: Pick<InfiniteSentinelProps, 'onReach' | 'hasMore' | 'isFetching' | 'error' | 'onRetry'>;
  /** Rendered when the first page is empty. */
  empty: ReactNode;
  errorTitle?: string;
  className?: string;
}

const SKELETON_COUNT = 6;

export const ListingGrid: FC<ListingGridProps> = ({ items, isLoading, isError, error, onRetry, sentinelProps, empty, errorTitle = "Couldn't load listings", className }) => {
  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 px-4 py-3', className)} aria-busy="true" aria-label="Loading listings">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <ListingTileSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState title={errorTitle} error={error} onRetry={onRetry} />;
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        {items.map((card) => (
          <ListingTile key={card.id} card={card} />
        ))}
      </div>
      <InfiniteSentinel
        {...sentinelProps}
        endLabel={null}
        skeleton={
          <div className="grid grid-cols-2 gap-3 px-4 pb-3">
            <ListingTileSkeleton />
            <ListingTileSkeleton />
          </div>
        }
      />
    </div>
  );
};
