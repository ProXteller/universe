/**
 * The animated poster: what plays when the video file is missing or cannot be decoded (Constitution §2, SPEC §5.2).
 * Ken Burns over `posterUrl`, else a generated aurora gradient (tokens only) with drifting orbit rings — either way
 * it looks intentional, keeps the identical overlays, and shows no error UI. Static under reduced motion.
 */
import { memo } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useReducedMotionPref } from '@/lib/motion';
import { gradientFor } from './poster';

export interface PosterFallbackProps {
  /** Seed for the generated gradient (the reel id). */
  seed: string;
  posterUrl: string | null;
  /** Drives the drift; paused = frozen frame. */
  playing: boolean;
  className?: string;
}

export const PosterFallback = memo(function PosterFallback({ seed, posterUrl, playing, className }: PosterFallbackProps) {
  const reduced = useReducedMotionPref();
  const animate = playing && !reduced;
  const drift = { scale: animate ? [1.02, 1.1] : 1.02, x: animate ? [0, -10] : 0, y: animate ? [0, 8] : 0 };
  const transition = { duration: 9, repeat: Infinity, repeatType: 'mirror' as const, ease: 'linear' as const };
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-canvas', className)} aria-hidden data-reel-fallback>
      {posterUrl ? (
        <motion.img
          src={posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          initial={false}
          animate={drift}
          transition={transition}
        />
      ) : (
        <motion.div
          className="absolute inset-0"
          style={{ backgroundImage: gradientFor(seed) }}
          initial={false}
          animate={drift}
          transition={transition}
        />
      )}
      {!posterUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="relative size-56 rounded-full border border-white/12"
            initial={false}
            animate={animate ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
          >
            <span className="absolute left-1/2 top-0 -ml-1 size-2 rounded-full bg-white/70" />
            <span className="absolute inset-8 rounded-full border border-white/10" />
          </motion.div>
        </div>
      ) : null}
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
});
