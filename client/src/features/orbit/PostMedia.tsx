/**
 * Photo mosaic (1 / 2 / 3 / 4 layouts, fixed aspect ratios → no layout shift), tap → `Lightbox`, double-tap → like
 * with a heart burst at the touch point (design §7.2 "double-tap a photo to like").
 */
import { useCallback, useRef, useState, type FC, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { Lightbox } from '@/ui';
import { MediaBox } from '@/components';
import { cn } from '@/lib/cn';
import { useDoubleTap } from '@/lib/hooks';
import { useReducedMotionPref } from '@/lib/motion';

export interface PostMediaProps {
  images: MediaImage[];
  /** Double-tap handler (like). Omit to disable the gesture. */
  onDoubleTap?(): void;
  className?: string;
}

interface Burst {
  id: number;
  x: number;
  y: number;
}

function singleAspect(img: MediaImage): number {
  if (img.width && img.height && img.width > 0 && img.height > 0) return Math.min(1.78, Math.max(0.8, img.width / img.height));
  return 0.8;
}

let burstSeq = 0;

export const PostMedia: FC<PostMediaProps> = ({ images, onDoubleTap, className }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const reduced = useReducedMotionPref();
  const box = useRef<HTMLDivElement | null>(null);
  const pendingIndex = useRef(0);

  const openAt = useCallback((i: number) => {
    setIndex(i);
    setOpen(true);
  }, []);

  const handleTap = useDoubleTap<HTMLDivElement>(
    () => openAt(pendingIndex.current),
    (e: MouseEvent<HTMLDivElement>) => {
      if (!onDoubleTap) {
        openAt(pendingIndex.current);
        return;
      }
      onDoubleTap();
      const rect = box.current?.getBoundingClientRect();
      if (rect) {
        const id = ++burstSeq;
        setBursts((b) => [...b, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
        window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 700);
      }
    },
  );

  const tileClick = (i: number) => (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    pendingIndex.current = i;
    handleTap(e);
  };

  if (images.length === 0) return null;
  const n = Math.min(4, images.length);
  const imgs = images.slice(0, 4);

  const tile = (i: number, aspect: number, extra?: string) => (
    <div key={i} className={cn('relative', extra)} onClick={tileClick(i)} role="button" tabIndex={0} aria-label={`Open photo ${i + 1} of ${n}`} onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAt(i);
      }
    }}>
      <MediaBox src={imgs[i]!.url} alt={imgs[i]!.alt ?? `Photo ${i + 1}`} aspect={aspect} rounded="none" className="h-full" />
    </div>
  );

  let grid: React.ReactNode;
  if (n === 1) grid = tile(0, singleAspect(imgs[0]!));
  else if (n === 2) grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1].map((i) => tile(i, 0.8))}</div>;
  else if (n === 3)
    grid = (
      <div className="grid grid-cols-2 grid-rows-2 gap-0.5">
        {tile(0, 0.5, 'row-span-2')}
        {tile(1, 1)}
        {tile(2, 1)}
      </div>
    );
  else grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1, 2, 3].map((i) => tile(i, 1))}</div>;

  return (
    <>
      <div ref={box} className={cn('relative overflow-hidden rounded-lg bg-surface-2 select-none', className)} data-no-pager-drag>
        {grid}
        <AnimatePresence>
          {bursts.map((b) => (
            <motion.span
              key={b.id}
              aria-hidden
              className="pointer-events-none absolute text-love drop-shadow-md"
              style={{ left: b.x - 36, top: b.y - 36 }}
              initial={reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.4 }}
              animate={reduced ? { opacity: 1 } : { opacity: [0, 1, 1], scale: [0.4, 1.15, 1], y: [0, 0, -16] }}
              exit={{ opacity: 0, scale: reduced ? 1 : 1.3 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            >
              <Heart size={72} strokeWidth={0} fill="currentColor" />
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        <Lightbox open={open} onOpenChange={setOpen} images={images} index={index} onIndexChange={setIndex} />
      </div>
    </>
  );
};
