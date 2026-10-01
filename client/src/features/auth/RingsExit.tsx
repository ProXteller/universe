/**
 * The 900 ms rings-expand exit into Home (product §1.6, T2). Rendered inside the follow `<Screen>` (absolute within
 * `#frame`, never `position: fixed`). Under reduced motion the caller skips it entirely.
 */
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useScreen } from '@/ui';
import { ease } from '@/lib/motion';

export const RINGS_EXIT_MS = 900;

const RINGS = [
  { delay: 0, from: 0.2, opacity: 0.9 },
  { delay: 0.12, from: 0.1, opacity: 0.6 },
  { delay: 0.24, from: 0.05, opacity: 0.35 },
];

/** Portals into the enclosing Screen's float layer (covers header, body and footer); inline when there is none. */
export function RingsExit() {
  const screen = useScreen();
  const node = <RingsExitLayer />;
  return screen?.floatEl ? createPortal(node, screen.floatEl) : node;
}

function RingsExitLayer() {
  const seconds = RINGS_EXIT_MS / 1000;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-(--z-sheet) flex items-center justify-center overflow-hidden bg-canvas"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: ease.out }}
    >
      {RINGS.map((r, i) => (
        <motion.span
          key={i}
          className="absolute size-40 rounded-full bg-aurora-ring"
          style={{ maskImage: 'radial-gradient(circle, transparent 62%, black 64%)', WebkitMaskImage: 'radial-gradient(circle, transparent 62%, black 64%)' }}
          initial={{ scale: r.from, opacity: 0 }}
          animate={{ scale: 9, opacity: [0, r.opacity, 0] }}
          transition={{ duration: seconds - r.delay, delay: r.delay, ease: ease.inOut }}
        />
      ))}
      <motion.span
        className="absolute size-6 rounded-full bg-hero shadow-glow"
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: 60, opacity: 0 }}
        transition={{ duration: seconds, ease: ease.inOut }}
      />
    </motion.div>
  );
}
