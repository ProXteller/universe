import { forwardRef, useEffect, useLayoutEffect, useRef, type Ref } from 'react';
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useTransform } from 'motion/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { cn } from '@/lib/cn';
import { duration, ease, exitTween, prefersReducedMotion, spring } from '@/lib/motion';
import { IconButton } from './IconButton';
import { OverlayPortal, useEscapeKey, useFocusTrap, useMergedRef, useOverlayLayer } from './overlay';

export interface LightboxProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  images: MediaImage[];
  index: number;
  onIndexChange(index: number): void;
  className?: string;
}

/** Full-frame image viewer (orbit, messages, market). Swipe / ← → between images, swipe down / Esc to close. */
export const Lightbox = forwardRef<HTMLDivElement, LightboxProps>(function Lightbox(props, ref) {
  return (
    <OverlayPortal>
      <AnimatePresence>{props.open && props.images.length > 0 ? <LightboxPanel key="lightbox" {...props} panelRef={ref} /> : null}</AnimatePresence>
    </OverlayPortal>
  );
});

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 600;

function LightboxPanel({ onOpenChange, images, index, onIndexChange, className, panelRef }: LightboxProps & { panelRef: Ref<HTMLDivElement> }) {
  const present = useIsPresent();
  const isTop = useOverlayLayer(present);
  const panel = useRef<HTMLDivElement | null>(null);
  const setPanel = useMergedRef(panelRef, panel);
  const strip = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(index);
  const changeIndex = useRef(onIndexChange);
  changeIndex.current = onIndexChange;
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;
  const count = images.length;
  const safeIndex = Math.min(Math.max(index, 0), count - 1);

  const dragY = useMotionValue(0);
  const backdrop = useTransform(dragY, [0, 320], [1, 0.25], { clamp: true });
  const shrink = useTransform(dragY, [0, 320], [1, 0.9], { clamp: true });

  const close = () => onOpenChange(false);
  useEscapeKey(present, isTop, close);
  useFocusTrap(panel, present, isTop);

  // Open on the right slide with no visible scroll.
  useLayoutEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = safeIndex * el.clientWidth;
    indexRef.current = safeIndex;
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `index` changed from outside (arrow keys, buttons): scroll there.
  useEffect(() => {
    const el = strip.current;
    if (!el || indexRef.current === safeIndex) return;
    indexRef.current = safeIndex;
    el.scrollTo({ left: safeIndex * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [safeIndex]);

  // Native swipe: report the slide the strip settled on.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (el.clientWidth === 0) return;
        const next = Math.round(el.scrollLeft / el.clientWidth);
        if (next !== indexRef.current && Math.abs(el.scrollLeft - next * el.clientWidth) < 2) {
          indexRef.current = next;
          changeIndex.current(next);
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Swipe down to dismiss (touch). Horizontal swipes stay native scroll-snap.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      dragging = false;
      start = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          start = null;
          return;
        }
        dragging = true;
        lastY = t.clientY;
        lastT = performance.now();
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      if (now > lastT) velocity = ((t.clientY - lastY) / (now - lastT)) * 1000;
      lastY = t.clientY;
      lastT = now;
      dragY.set(Math.max(0, dy));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      start = null;
      if (dragY.get() > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) closeRef.current(false);
      else animate(dragY, 0, prefersReducedMotion() ? { duration: 0.12 } : { ...spring.settle, velocity });
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
  }, [dragY]);

  const go = (delta: number) => {
    const next = Math.min(Math.max(safeIndex + delta, 0), count - 1);
    if (next !== safeIndex) onIndexChange(next);
  };

  const current = images[safeIndex];

  return (
    <motion.div
      ref={setPanel}
      role="dialog"
      aria-modal="true"
      aria-label={count > 1 ? `Image ${safeIndex + 1} of ${count}` : 'Image'}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        else if (e.key === 'ArrowLeft') go(-1);
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: duration.base, ease: ease.out } }}
      exit={{ opacity: 0, transition: exitTween }}
      className={cn('absolute inset-0 z-(--z-dialog) flex flex-col text-white outline-none', className)}
      style={{ pointerEvents: present ? 'auto' : 'none' }}
    >
      <motion.div aria-hidden style={{ opacity: backdrop }} className="absolute inset-0 bg-void" />

      <motion.div style={{ y: dragY, scale: shrink }} className="relative min-h-0 flex-1">
        <div ref={strip} className="scroll-x flex size-full snap-x snap-mandatory" onClick={(e) => e.target === e.currentTarget && close()}>
          {images.map((image, i) => (
            <div
              key={`${image.url}-${i}`}
              className="flex size-full shrink-0 snap-center snap-always items-center justify-center"
              onClick={(e) => e.target === e.currentTarget && close()}
              aria-hidden={i !== safeIndex}
            >
              <img
                src={image.url}
                alt={image.alt ?? ''}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                decoding="async"
                draggable={false}
                className="max-h-full max-w-full object-contain select-none"
              />
            </div>
          ))}
        </div>
      </motion.div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-scrim-top px-2 pb-6" style={{ paddingTop: 'calc(var(--safe-top) + 4px)' }}>
        <IconButton icon={X} aria-label="Close" variant="glass" onClick={close} className="pointer-events-auto" />
        {count > 1 ? (
          <span className="rounded-full bg-black/35 px-3 py-1 type-caption text-white tabular-nums backdrop-blur-md">
            {safeIndex + 1} / {count}
          </span>
        ) : null}
        <span className="size-11" />
      </div>

      {count > 1 ? (
        <div className="pointer-events-none absolute inset-x-2 top-1/2 hidden -translate-y-1/2 justify-between [@media(hover:hover)]:flex">
          <IconButton icon={ChevronLeft} aria-label="Previous image" variant="glass" disabled={safeIndex === 0} onClick={() => go(-1)} className="pointer-events-auto" />
          <IconButton icon={ChevronRight} aria-label="Next image" variant="glass" disabled={safeIndex === count - 1} onClick={() => go(1)} className="pointer-events-auto" />
        </div>
      ) : null}

      {current?.alt ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-scrim-bottom px-4 pt-10" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
          <p className="line-clamp-2 text-center type-footnote text-white/85">{current.alt}</p>
        </div>
      ) : null}
    </motion.div>
  );
}
