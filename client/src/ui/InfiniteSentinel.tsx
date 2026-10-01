import { forwardRef, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Orbit } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ErrorState } from './ErrorState';
import { useScreen } from './Screen';
import { Skeleton } from './Skeleton';
import { useMergedRef } from './overlay';

export interface InfiniteSentinelProps {
  onReach(): void;
  hasMore: boolean;
  isFetching: boolean;
  error?: unknown;
  onRetry?(): void;
  /** Scroll container to observe against. Default: the enclosing `<Screen>`'s scroller, else the viewport. */
  rootRef?: RefObject<HTMLElement | null>;
  /** 2–3 geometry-matching skeleton rows shown while the next page loads. */
  skeleton?: ReactNode;
  /** End cap text; `null` hides the cap. Default "You're all caught up". */
  endLabel?: string | null;
  className?: string;
}

/**
 * Put it right under a non-empty list. Fires `onReach` 600px before the end; re-arms after every fetch, so a
 * page that does not fill the viewport keeps loading until it does (or `hasMore` turns false).
 */
export const InfiniteSentinel = forwardRef<HTMLDivElement, InfiniteSentinelProps>(function InfiniteSentinel(
  { onReach, hasMore, isFetching, error, onRetry, rootRef, skeleton, endLabel = "You're all caught up", className },
  ref,
) {
  const screen = useScreen();
  const probe = useRef<HTMLDivElement | null>(null);
  const setRef = useMergedRef(ref, probe);
  const reach = useRef(onReach);
  reach.current = onReach;

  const armed = hasMore && !isFetching && !error;
  const screenRoot = screen?.scrollEl ?? null;

  useEffect(() => {
    const el = probe.current;
    if (!armed || !el || typeof IntersectionObserver === 'undefined') return;
    const root = rootRef?.current ?? screenRoot;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) reach.current();
      },
      { root, rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [armed, rootRef, screenRoot]);

  return (
    <div className={cn('w-full', className)}>
      <div ref={setRef} aria-hidden className="h-px w-full" />
      {error ? (
        <ErrorState inline title="Couldn't load more" error={error} onRetry={onRetry} />
      ) : isFetching && hasMore ? (
        <div aria-busy="true" aria-live="polite">
          {skeleton ?? (
            <div className="flex flex-col gap-3 px-4 py-3">
              <Skeleton h={56} className="w-full rounded-lg" />
              <Skeleton h={56} className="w-full rounded-lg" />
            </div>
          )}
        </div>
      ) : !hasMore && endLabel !== null ? (
        <div className="my-8 flex items-center justify-center gap-2 type-caption text-ink-3">
          <Orbit size={14} strokeWidth={2} aria-hidden />
          <span>{endLabel}</span>
        </div>
      ) : null}
    </div>
  );
});
