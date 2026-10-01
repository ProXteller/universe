import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Orbit } from 'lucide-react';
import { cn } from '@/lib/cn';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { useScreen } from './Screen';
import { useMergedRef } from './overlay';

export interface PullToRefreshProps {
  onRefresh(): Promise<unknown>;
  /** The Reels pane disables it. It is also off under reduced motion (offer a header refresh action instead). */
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

const THRESHOLD = 64;
const MAX_PULL = 120;
const RESISTANCE = 0.5;
const HOLD = 56;
const MIN_SPIN_MS = 500;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Touch only. Wrap the content of a scroll container (inside `<Screen>`): when the scroller is at the top
 * and the finger drags down, the content follows with 0.5 resistance and an orbit glyph rotates with the
 * pull; past 64px a release calls `onRefresh` (the glyph spins until it settles, min 500ms).
 */
export const PullToRefresh = forwardRef<HTMLDivElement, PullToRefreshProps>(function PullToRefresh(
  { onRefresh, disabled = false, className, children },
  ref,
) {
  const reduced = useReducedMotionPref();
  const screen = useScreen();
  const root = useRef<HTMLDivElement | null>(null);
  const setRef = useMergedRef(ref, root);
  const pull = useMotionValue(0);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const indicatorY = useTransform(pull, (p) => p - 44);
  const indicatorOpacity = useTransform(pull, [0, THRESHOLD * 0.4, THRESHOLD], [0, 0.4, 1]);
  const rotate = useTransform(pull, (p) => p * 3);
  const scale = useTransform(pull, [0, THRESHOLD], [0.7, 1], { clamp: true });

  const off = disabled || reduced;
  const screenScroller = screen?.scrollEl ?? null;

  useEffect(() => {
    const el = root.current;
    if (!el || off) return;
    const scroller = screenScroller ?? scrollParent(el);
    let start: { x: number; y: number } | null = null;
    let pulling = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      pulling = false;
      start = t && e.touches.length === 1 && !busy.current ? { x: t.clientX, y: t.clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      if ((scroller?.scrollTop ?? 0) > 0) {
        // Not at the top yet: keep re-anchoring so the pull starts exactly when the top is reached.
        start = { x: t.clientX, y: t.clientY };
        return;
      }
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!pulling) {
        if (dy < 6 && Math.abs(dx) < 6) return;
        if (dy <= 0 || Math.abs(dx) > dy) {
          start = null;
          return;
        }
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      pull.set(Math.min(MAX_PULL, Math.max(0, dy * RESISTANCE)));
    };
    const onEnd = () => {
      if (!pulling) {
        start = null;
        return;
      }
      pulling = false;
      start = null;
      if (pull.get() < THRESHOLD) {
        animate(pull, 0, spring.settle);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      animate(pull, HOLD, spring.settle);
      const began = performance.now();
      void Promise.resolve()
        .then(() => refresh.current())
        .catch(() => undefined)
        .then(() => new Promise((r) => window.setTimeout(r, Math.max(0, MIN_SPIN_MS - (performance.now() - began)))))
        .then(() => {
          busy.current = false;
          setRefreshing(false);
          animate(pull, 0, spring.settle);
        });
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [off, pull, screenScroller]);

  return (
    <div ref={setRef} className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      {off ? null : (
        <motion.div
          aria-hidden
          style={{ y: indicatorY, opacity: indicatorOpacity, scale }}
          className="pointer-events-none absolute top-0 left-1/2 z-[1] -ml-[18px] flex size-9 items-center justify-center rounded-full bg-surface-3 text-accent-ink shadow-md"
        >
          <motion.span style={refreshing ? undefined : { rotate }} className={cn('flex', refreshing && 'uv-spin motion-safe-keep')}>
            <Orbit size={18} strokeWidth={2} />
          </motion.span>
        </motion.div>
      )}
      <motion.div style={{ y: pull }} className="flex min-h-0 flex-1 flex-col">
        {children}
      </motion.div>
      <span className="sr-only" role="status">
        {refreshing ? 'Refreshing' : ''}
      </span>
    </div>
  );
});
