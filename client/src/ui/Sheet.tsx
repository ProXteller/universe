import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { duration, ease, reducedTween, spring, useReducedMotionPref } from '@/lib/motion';
import { IconButton } from './IconButton';
import { OverlayPortal, useEscapeKey, useFocusTrap, useKeyboardInset, useMergedRef, useOverlayLayer } from './overlay';
import { ScreenContext, type ScreenContextValue } from './Screen';

export type SheetDetent = 'auto' | 'half' | 'full';

export interface SheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Resting heights. `'auto'` = content height (max 90%) · `'half'` = 56% · `'full'` = 100% − safe-top − 12px.
   * Several detents are allowed (`['half','full']` for comments); the user drags between them. Default `['auto']`.
   */
  detents?: SheetDetent[];
  /** Index into `detents` to open at. Default 0. */
  initialDetent?: number;
  /** Sticky footer (p-4 + safe-bottom, top divider). */
  footer?: ReactNode;
  /** `false` = no drag-to-dismiss, no scrim tap, no Esc, no close button. Default `true`. */
  dismissible?: boolean;
  /** Accessible name when there is no `title`. */
  'aria-label'?: string;
  /** Styles the panel. */
  className?: string;
  children?: ReactNode;
}

/* Gesture constants (design §5.5). */
const DISMISS_FRACTION = 0.28; // of the visible height at the lowest detent
const FLING_VELOCITY = 600; // px/s
const ELASTIC_TOP = 0.04;
const ELASTIC_LOCKED = 0.15; // downward resistance when the sheet is not dismissible
const VELOCITY_WINDOW_MS = 100;
const NO_DRAG = '[data-sheet-no-drag], .scroll-x, [role="slider"], input, textarea, select, [contenteditable="true"]';

interface Sample {
  t: number;
  y: number;
}

/**
 * Bottom sheet — the default overlay. Renders inside `#overlay-root` (in the frame, never position:fixed)
 * and inherits the caller's Surface mode, so a sheet opened from Buzz is Phosphor.
 *
 * The sheet body is its own scroll container, so the panel provides a `ScreenContext` of its own: an
 * `InfiniteSentinel`, `PageHeader`, `PullToRefresh` or `FAB` written inside a sheet resolves the sheet body
 * (React context crosses the portal — without this they would find the page's `<Screen>` scroller, which is
 * not an ancestor of anything in `#overlay-root`, and an IntersectionObserver whose root is not an ancestor
 * of its target never fires).
 */
export const Sheet = forwardRef<HTMLDivElement, SheetProps>(function Sheet(props, ref) {
  const [mounted, setMounted] = useState(props.open);
  useEffect(() => {
    if (props.open) setMounted(true);
  }, [props.open]);
  const handleExited = useCallback(() => setMounted(false), []);

  if (!mounted && !props.open) return null;
  return (
    <OverlayPortal>
      <SheetPanel {...props} panelRef={ref} onExited={handleExited} />
    </OverlayPortal>
  );
});

interface SheetPanelProps extends SheetProps {
  panelRef: Ref<HTMLDivElement>;
  onExited(): void;
}

function SheetPanel({
  open,
  onOpenChange,
  title,
  description,
  detents = ['auto'],
  initialDetent = 0,
  footer,
  dismissible = true,
  'aria-label': ariaLabel,
  className,
  children,
  panelRef,
  onExited,
}: SheetPanelProps) {
  const reduced = useReducedMotionPref();
  const isTop = useOverlayLayer(open);
  const keyboard = useKeyboardInset(open);
  const titleId = useId();
  const descId = useId();

  const detentKey = detents.join('|');
  const onlyAuto = detents.length === 1 && detents[0] === 'auto';
  const multi = detents.length > 1;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelEl = useRef<HTMLDivElement | null>(null);
  const setPanel = useMergedRef(panelRef, panelEl);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyInnerRef = useRef<HTMLDivElement | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);

  /* The sheet's own Screen context: body = scroll container, a non-scrolling float layer for `FAB`. */
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [floatEl, setFloatEl] = useState<HTMLDivElement | null>(null);
  const setBody = useMergedRef(bodyRef, setBodyEl);
  const registerHeader = useCallback(() => () => {}, []);
  const screenCtx = useMemo<ScreenContextValue>(
    () => ({ scrollEl: bodyEl, floatEl, nav: false, registerHeader }),
    [bodyEl, floatEl, registerHeader],
  );

  // Start far below the frame so the very first painted frame never shows an open panel.
  const y = useMotionValue(typeof window === 'undefined' ? 2000 : window.innerHeight);
  const presence = useMotionValue(0);
  const panelH = useMotionValue(0);
  const lowOffset = useMotionValue(0);
  const [panelPx, setPanelPx] = useState<number | null>(null);

  const offsets = useRef<number[]>([0]);
  const detent = useRef(Math.min(Math.max(initialDetent, 0), detents.length - 1));
  const phase = useRef<'init' | 'open' | 'closing'>('init');
  const yAnim = useRef<AnimationPlaybackControls | null>(null);
  const presenceAnim = useRef<AnimationPlaybackControls | null>(null);
  const dragging = useRef(false);
  const pendingSync = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const releaseVelocity = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const exited = useRef(onExited);
  exited.current = onExited;

  const scrimOpacity = useTransform(() => {
    const total = panelH.get();
    const low = lowOffset.get();
    const span = total - low;
    const progress = span > 0 ? 1 - Math.min(1, Math.max(0, (y.get() - low) / span)) : 1;
    return (reducedRef.current ? 1 : progress) * presence.get();
  });
  const panelOpacity = useTransform(() => (reducedRef.current ? presence.get() : 1));
  // With several detents the panel is as tall as the tallest one and translated down for the others;
  // the inner column shrinks by the same amount so the footer and the end of the body stay on screen.
  const innerHeight = useTransform(() => {
    const total = panelH.get();
    if (total <= 0) return '100%';
    return `${Math.max(0, total - Math.min(Math.max(y.get(), 0), lowOffset.get()))}px`;
  });

  /* ---------------------------------------------------------------- animation helpers */

  /** Tracks the running y animation; when it finishes, applies a resize that arrived meanwhile. */
  const runY = useCallback((controls: AnimationPlaybackControls): AnimationPlaybackControls => {
    yAnim.current = controls;
    void controls.then(() => {
      if (yAnim.current !== controls) return;
      yAnim.current = null;
      if (pendingSync.current) {
        pendingSync.current = false;
        syncRef.current();
      }
    });
    return controls;
  }, []);

  const stopY = useCallback(() => {
    const running = yAnim.current;
    yAnim.current = null;
    running?.stop();
  }, []);

  const animateY = useCallback(
    (to: number, velocity = 0): AnimationPlaybackControls => {
      stopY();
      return runY(
        reducedRef.current
          ? animate(y, to, reducedTween)
          : animate(y, to, { ...spring.settle, velocity, restDelta: 0.5, restSpeed: 8 }),
      );
    },
    [y, runY, stopY],
  );

  const animatePresence = useCallback(
    (to: number) => {
      presenceAnim.current?.stop();
      presenceAnim.current = animate(presence, to, {
        duration: reducedRef.current ? reducedTween.duration : to === 1 ? duration.base : duration.fast,
        ease: to === 1 ? ease.out : ease.in,
      });
    },
    [presence],
  );

  /* ---------------------------------------------------------------- measuring */

  const measure = useCallback(() => {
    const container = containerRef.current;
    const panel = panelEl.current;
    if (!container || !panel) return false;
    const H = container.clientHeight;
    if (H <= 0) return false;

    let total: number;
    let heights: number[];
    if (onlyAuto) {
      total = panel.offsetHeight;
      heights = [total];
    } else {
      const safeTop = probeRef.current?.offsetHeight ?? 0;
      const full = Math.max(0, H - safeTop - 12);
      const body = bodyRef.current;
      const bodyPad = body ? parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(body).paddingBottom) : 0;
      const natural =
        (headRef.current?.offsetHeight ?? 0) +
        (bodyInnerRef.current?.offsetHeight ?? 0) +
        bodyPad +
        (footRef.current?.offsetHeight ?? 0);
      heights = detents.map((d) =>
        d === 'full' ? full : d === 'half' ? Math.min(full, Math.round(H * 0.56)) : Math.min(Math.round(H * 0.9), natural),
      );
      total = Math.max(...heights);
      setPanelPx((prev) => (prev === total ? prev : total));
    }
    offsets.current = heights.map((h) => Math.max(0, total - h));
    panelH.set(total);
    lowOffset.set(Math.max(...offsets.current));
    return total > 0;
    // `detentKey` stands in for `detents` (callers pass a fresh array literal every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detentKey, onlyAuto, panelH, lowOffset]);

  const sync = useCallback(() => {
    if (!measure()) return;
    const target = offsets.current[detent.current] ?? 0;
    if (phase.current === 'init') {
      if (!openRef.current) return;
      phase.current = 'open';
      stopY();
      if (reducedRef.current) {
        y.jump(target);
      } else {
        y.jump(panelH.get());
        runY(animate(y, target, spring.smooth));
      }
      animatePresence(1);
      return;
    }
    if (phase.current !== 'open' || dragging.current || Math.abs(y.get() - target) <= 0.5) return;
    // Content or frame size changed. Let a running open/snap animation finish first (runY re-syncs).
    if (yAnim.current) pendingSync.current = true;
    else animateY(target);
  }, [measure, y, panelH, animatePresence, animateY, runY, stopY]);
  syncRef.current = sync;

  useLayoutEffect(() => {
    sync();
    const ro = new ResizeObserver(() => syncRef.current());
    if (containerRef.current) ro.observe(containerRef.current);
    if (panelEl.current) ro.observe(panelEl.current);
    if (bodyInnerRef.current) ro.observe(bodyInnerRef.current);
    return () => {
      ro.disconnect();
      // StrictMode re-runs effects on the same instance: make the next run start the entrance again.
      stopY();
      if (phase.current === 'open') phase.current = 'init';
    };
    // Mount-only: `sync` is always reached through `syncRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detents changed while open: re-measure and glide.
  useEffect(() => {
    if (phase.current === 'open') syncRef.current();
  }, [detentKey]);

  /* ---------------------------------------------------------------- open / close */

  useEffect(() => {
    if (open) {
      if (phase.current === 'closing') {
        // Re-opened mid-exit.
        phase.current = 'open';
        animateY(offsets.current[detent.current] ?? 0);
        animatePresence(1);
      }
      return;
    }
    if (phase.current === 'init') {
      exited.current();
      return;
    }
    phase.current = 'closing';
    animatePresence(0);
    const v = releaseVelocity.current;
    releaseVelocity.current = 0;
    stopY();
    let controls: AnimationPlaybackControls;
    if (reducedRef.current) {
      controls = animate(presence, 0, reducedTween);
    } else if (v > 0) {
      controls = animate(y, panelH.get(), { ...spring.settle, velocity: v, restDelta: 2, restSpeed: 40 });
    } else {
      controls = animate(y, panelH.get(), { duration: 0.2, ease: ease.in });
    }
    yAnim.current = controls;
    let cancelled = false;
    void controls.then(() => {
      if (!cancelled && !openRef.current) exited.current();
    });
    return () => {
      cancelled = true;
    };
  }, [open, animateY, animatePresence, stopY, presence, y, panelH]);

  useEffect(
    () => () => {
      presenceAnim.current?.stop();
    },
    [],
  );

  const requestClose = useCallback(() => {
    if (!dismissible) return;
    onOpenChange(false);
  }, [dismissible, onOpenChange]);

  useEscapeKey(open && dismissible, isTop, requestClose);
  useFocusTrap(panelEl, open, isTop);

  /* ---------------------------------------------------------------- drag (velocity-aware) */

  const gesture = useRef<{ startClient: number; startOffset: number; samples: Sample[] } | null>(null);

  const dragStart = useCallback(
    (clientY: number) => {
      if (phase.current !== 'open') return;
      stopY();
      dragging.current = true;
      gesture.current = { startClient: clientY, startOffset: y.get(), samples: [{ t: performance.now(), y: clientY }] };
    },
    [y, stopY],
  );

  const dragMove = useCallback(
    (clientY: number) => {
      const g = gesture.current;
      if (!g) return;
      const min = Math.min(...offsets.current);
      const max = Math.max(...offsets.current);
      let next = g.startOffset + (clientY - g.startClient);
      if (next < min) next = min + (next - min) * ELASTIC_TOP;
      else if (!dismissible && next > max) next = max + (next - max) * ELASTIC_LOCKED;
      y.set(next);
      const now = performance.now();
      g.samples.push({ t: now, y: clientY });
      while (g.samples.length > 2 && now - g.samples[0]!.t > VELOCITY_WINDOW_MS) g.samples.shift();
    },
    [dismissible, y],
  );

  const dragEnd = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    dragging.current = false;
    if (!g) return;

    const first = g.samples[0]!;
    const last = g.samples[g.samples.length - 1]!;
    const dt = last.t - first.t;
    const stale = performance.now() - last.t > 80; // finger rested before lifting: no fling
    const velocity = dt > 0 && !stale ? ((last.y - first.y) / dt) * 1000 : 0;

    const pos = y.get();
    const snaps = Array.from(new Set(offsets.current)).sort((a, b) => a - b); // 0 (tallest) … low
    const low = snaps[snaps.length - 1] ?? 0;
    const visibleAtLow = panelH.get() - low;

    const pastLow = pos - low;
    if (dismissible && pastLow > 0 && (pastLow > visibleAtLow * DISMISS_FRACTION || velocity > FLING_VELOCITY)) {
      releaseVelocity.current = Math.max(velocity, 0);
      onOpenChange(false);
      // A controlled parent may refuse to close: settle back instead of hanging half-way.
      window.setTimeout(() => {
        if (openRef.current && phase.current === 'open' && !dragging.current) animateY(low);
      }, 60);
      return;
    }

    let target: number;
    if (Math.abs(velocity) > FLING_VELOCITY) {
      // A fling moves exactly one detent in its direction.
      target =
        velocity > 0
          ? (snaps.find((s) => s > pos + 1) ?? low)
          : ([...snaps].reverse().find((s) => s < pos - 1) ?? snaps[0] ?? 0);
    } else {
      target = snaps.reduce((best, s) => (Math.abs(s - pos) < Math.abs(best - pos) ? s : best), snaps[0] ?? 0);
    }
    const index = offsets.current.indexOf(target);
    if (index >= 0) detent.current = index;
    animateY(target, velocity);
  }, [animateY, dismissible, onOpenChange, panelH, y]);

  /* Grabber + header: pointer events (mouse, pen, touch). `touch-action: none` keeps the stream alive. */
  const headPointer = useRef<number | null>(null);
  const onHeadPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (headPointer.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    headPointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic event): moves still arrive through bubbling */
    }
    dragStart(e.clientY);
  };
  const onHeadPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (headPointer.current === e.pointerId && gesture.current) dragMove(e.clientY);
  };
  const onHeadPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (headPointer.current !== e.pointerId) return;
    headPointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragEnd();
  };

  /* Body: touch only, and only when the body is scrolled to the top and the finger moves down. */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let start: { x: number; y: number; decided: boolean } | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || body.scrollTop > 0) {
        start = null;
        return;
      }
      if (e.target instanceof Element && e.target.closest(NO_DRAG)) {
        start = null;
        return;
      }
      start = { x: t.clientX, y: t.clientY, decided: false };
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      if (!start.decided) {
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) && body.scrollTop <= 0) {
          start.decided = true;
          dragStart(t.clientY);
        } else {
          start = null;
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      dragMove(t.clientY);
    };
    const onEnd = () => {
      if (start?.decided) dragEnd();
      start = null;
    };

    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
    };
  }, [dragStart, dragMove, dragEnd]);

  /* ---------------------------------------------------------------- render */

  const hasHeader = title != null && title !== false;

  return (
    <div
      ref={containerRef}
      className="absolute inset-x-0 top-0 z-(--z-sheet) overflow-hidden"
      style={{ bottom: keyboard, pointerEvents: open ? 'auto' : 'none' }}
    >
      <div ref={probeRef} aria-hidden className="invisible absolute w-0" style={{ height: 'var(--safe-top)' }} />
      <motion.div
        aria-hidden
        onClick={requestClose}
        style={{ opacity: scrimOpacity }}
        className="absolute inset-0 bg-scrim backdrop-blur-[6px]"
      />
      <motion.div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasHeader ? titleId : undefined}
        aria-label={hasHeader ? undefined : (ariaLabel ?? 'Sheet')}
        aria-describedby={hasHeader && description ? descId : undefined}
        tabIndex={-1}
        style={{ y, opacity: panelOpacity, height: panelPx ?? undefined, maxHeight: onlyAuto ? '90%' : undefined }}
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col rounded-t-xl border-t border-line bg-surface-2 text-ink shadow-lg outline-none',
          // Extends the panel colour below the frame edge so the top-elastic drag never reveals the scrim.
          "after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-surface-2",
          className,
        )}
      >
        <ScreenContext.Provider value={screenCtx}>
          <motion.div className="flex min-h-0 flex-col" style={multi ? { height: innerHeight } : { maxHeight: '100%', flex: '1 1 auto' }}>
            <div
              ref={headRef}
              onPointerDown={onHeadPointerDown}
              onPointerMove={onHeadPointerMove}
              onPointerUp={onHeadPointerEnd}
              onPointerCancel={onHeadPointerEnd}
              className={cn('relative shrink-0 touch-none select-none', dismissible || multi ? 'cursor-grab active:cursor-grabbing' : '')}
            >
              <div aria-hidden className="flex h-5 items-end justify-center">
                <span className="h-1 w-9 rounded-full bg-surface-4" />
              </div>
              {hasHeader ? (
                <div className="flex items-start gap-3 px-4 pt-3 pb-3">
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h2 id={titleId} className="type-title-3 text-ink">
                      {title}
                    </h2>
                    {description ? (
                      <p id={descId} className="mt-1 type-footnote text-ink-2">
                        {description}
                      </p>
                    ) : null}
                  </div>
                  {dismissible ? (
                    <IconButton icon={X} aria-label="Close" variant="filled" size="sm" onClick={requestClose} className="-mt-0.5 -mr-1" />
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="h-3" />
                  {dismissible ? (
                    <button type="button" className="sr-only" onClick={requestClose}>
                      Close
                    </button>
                  ) : null}
                </>
              )}
            </div>

            <div
              ref={setBody}
              data-sheet-scroll=""
              className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4', footer ? 'pb-4' : 'pb-[calc(16px+var(--safe-bottom))]')}
            >
              <div ref={bodyInnerRef}>
                {!hasHeader && description ? <p className="mb-3 type-footnote text-ink-2">{description}</p> : null}
                {children}
              </div>
            </div>

            {footer ? (
              <div ref={footRef} className="shrink-0 border-t border-line-subtle px-4 pt-4 pb-[calc(16px+var(--safe-bottom))]">
                {footer}
              </div>
            ) : null}
          </motion.div>
          <div ref={setFloatEl} className="pointer-events-none absolute inset-0 z-(--z-fab)" />
        </ScreenContext.Provider>
      </motion.div>
    </div>
  );
}
