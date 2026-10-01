/**
 * AuroraBackdrop (design §6.1): the ≥ 768px void behind the phone frame. `bg-void` + three blurred blobs
 * (violet / cyan / orchid, ~46vmax, 38–45 % opacity) drifting slowly, plus a quiet radial vignette. Static
 * under reduced motion (MotionConfig `reducedMotion` drops the transform animation). Never rendered on phones.
 */
import { motion } from 'motion/react';
import { Wordmark } from '@/components';
import { cn } from '@/lib/cn';
import { useReducedMotionPref } from '@/lib/motion';

interface Blob {
  name: string;
  /** Colour comes from the `--color-aurora-*` tokens (theme.css) through a utility — never a literal. */
  tone: string;
  left: string;
  top: string;
  opacity: number;
  drift: { x: number[]; y: number[] };
  duration: number;
}

const BLOBS: Blob[] = [
  { name: 'violet', tone: 'bg-aurora-violet', left: '18%', top: '12%', opacity: 0.42, drift: { x: [0, 60, -30, 0], y: [0, -40, 30, 0] }, duration: 46 },
  { name: 'cyan', tone: 'bg-aurora-cyan', left: '86%', top: '28%', opacity: 0.38, drift: { x: [0, -70, 20, 0], y: [0, 50, -30, 0] }, duration: 54 },
  { name: 'orchid', tone: 'bg-aurora-orchid', left: '52%', top: '104%', opacity: 0.45, drift: { x: [0, 40, -50, 0], y: [0, -60, 20, 0] }, duration: 60 },
];

export function AuroraBackdrop() {
  const reduced = useReducedMotionPref();
  return (
    <div aria-hidden className="absolute inset-0 hidden overflow-hidden bg-void md:block">
      {BLOBS.map((b) => (
        <motion.div
          key={b.name}
          className={cn('absolute rounded-full will-change-transform', b.tone)}
          style={{
            left: b.left,
            top: b.top,
            width: '46vmax',
            height: '46vmax',
            marginLeft: '-23vmax',
            marginTop: '-23vmax',
            opacity: b.opacity,
            filter: 'blur(120px)',
          }}
          animate={reduced ? undefined : { x: b.drift.x, y: b.drift.y }}
          transition={{ duration: b.duration, ease: 'easeInOut', repeat: Infinity, repeatType: 'loop' }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 50%, rgb(0 0 0 / 0) 55%, rgb(0 0 0 / 0.5) 100%)' }}
      />
    </div>
  );
}

/** The quiet brand block left of the frame (≥ 1100px only, design §6.1). */
export function BrandBlock() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 hidden -translate-y-1/2 flex-col gap-3 select-none min-[1100px]:flex"
      style={{ left: 'max(48px, calc(50% - 215px - 380px))', width: 300 }}
    >
      <Wordmark size="display" />
      <p className="type-body-lg text-ink-2">Your whole campus. One app.</p>
      <p className="type-caption text-ink-4">Best on your phone</p>
    </div>
  );
}
