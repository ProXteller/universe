import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps {
  /** Number = px. */
  w?: number | string;
  h?: number | string;
  circle?: boolean;
  className?: string;
}

/**
 * Shimmer block. Build geometry-matching skeletons from it (same height, radius and padding as the real
 * thing). Static `surface-3` under reduced motion. No spinners anywhere.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton({ w, h, circle = false, className }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden
      style={{ width: w, height: h ?? (circle ? w : undefined) }}
      className={cn('skeleton block shrink-0', circle ? 'rounded-full' : 'rounded-sm', h === undefined && !circle && 'h-4', className)}
    />
  );
});

export interface SkeletonTextProps {
  lines: number;
  className?: string;
}

/** `lines` text bars on the `type-body` rhythm (22px); the last one is 60% wide. */
export const SkeletonText = forwardRef<HTMLDivElement, SkeletonTextProps>(function SkeletonText({ lines, className }, ref) {
  return (
    <div ref={ref} aria-hidden className={cn('flex w-full flex-col', className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div key={i} className="flex h-[1.375rem] items-center">
          <div className="skeleton h-3 rounded-xs" style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
        </div>
      ))}
    </div>
  );
});
