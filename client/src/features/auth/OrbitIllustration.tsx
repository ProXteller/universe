/**
 * Welcome hero (design §7.1): two blurred aurora blobs at ~30 % behind a slowly rotating 3-ring orbit, with three
 * floating preview cards (a reel, a buzz, a listing) drifting on the rings. Static under reduced motion.
 * Everything is tokens + local SVG — no images, no network. The buzz card carries no mask glyph and no Phosphor
 * (those are Buzz-only, design §0.1): "anonymous" reads through the dashed frame alone.
 */
import { motion } from 'motion/react';
import { Clapperboard, MessagesSquare, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReducedMotionPref } from '@/lib/motion';

interface PreviewCard {
  icon: LucideIcon;
  title: string;
  sub: string;
  /** Percent position inside the illustration box. */
  left: string;
  top: string;
  dashed?: boolean;
  delay: number;
}

const CARDS: PreviewCard[] = [
  { icon: Clapperboard, title: 'Reel', sub: 'Solar car, first drive', left: '6%', top: '18%', delay: 0 },
  { icon: MessagesSquare, title: 'Buzz', sub: 'Anonymous · campus', left: '58%', top: '8%', dashed: true, delay: 0.8 },
  { icon: Tag, title: 'For sale', sub: 'Mini fridge · pickup today', left: '48%', top: '66%', delay: 1.6 },
];

export function OrbitIllustration({ className }: { className?: string }) {
  const reduced = useReducedMotionPref();
  return (
    <div aria-hidden className={cn('relative w-full overflow-hidden', className)}>
      {/* aurora blobs */}
      <div className="absolute left-[22%] top-[30%] size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-aurora-violet opacity-30" style={{ filter: 'blur(70px)' }} />
      <div className="absolute left-[78%] top-[55%] size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-aurora-cyan opacity-30" style={{ filter: 'blur(70px)' }} />

      {/* rings */}
      <motion.svg
        viewBox="0 0 400 400"
        className="absolute left-1/2 top-1/2 size-[118%] -translate-x-1/2 -translate-y-1/2 text-ink"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 90, ease: 'linear', repeat: Infinity }}
        style={{ originX: '50%', originY: '50%' }}
      >
        <defs>
          <linearGradient id="uv-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-aurora-violet)" />
            <stop offset="50%" stopColor="var(--color-aurora-cyan)" />
            <stop offset="100%" stopColor="var(--color-aurora-orchid)" />
          </linearGradient>
        </defs>
        <g fill="none" strokeWidth="1.25" stroke="url(#uv-ring)" opacity="0.9">
          <ellipse cx="200" cy="200" rx="188" ry="188" opacity="0.35" />
          <ellipse cx="200" cy="200" rx="140" ry="140" opacity="0.55" />
          <ellipse cx="200" cy="200" rx="84" ry="84" opacity="0.8" />
        </g>
        <g fill="var(--color-aurora-cyan)">
          <circle cx="200" cy="12" r="3.5" />
          <circle cx="340" cy="200" r="3" />
          <circle cx="116" cy="200" r="2.5" />
        </g>
        <circle cx="200" cy="200" r="22" fill="url(#uv-ring)" opacity="0.9" />
        <circle cx="200" cy="200" r="34" fill="none" stroke="var(--color-aurora-violet)" strokeWidth="1" opacity="0.5" />
      </motion.svg>

      {/* floating preview cards */}
      {CARDS.map((c) => (
        <motion.div
          key={c.title}
          className={cn(
            'absolute flex w-[42%] max-w-[168px] items-center gap-2.5 rounded-md px-3 py-2.5 glass',
            c.dashed ? 'border border-dashed border-line-strong' : 'border border-line',
          )}
          style={{ left: c.left, top: c.top }}
          animate={reduced ? undefined : { y: [0, -8, 0, 6, 0] }}
          transition={{ duration: 9, ease: 'easeInOut', repeat: Infinity, delay: c.delay }}
        >
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-sm', c.dashed ? 'bg-surface-3 text-ink-2' : 'bg-accent-soft text-accent-ink')}>
            <c.icon size={16} strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate type-label-sm text-ink">{c.title}</span>
            <span className="truncate type-caption text-ink-3">{c.sub}</span>
          </span>
        </motion.div>
      ))}
    </div>
  );
}
