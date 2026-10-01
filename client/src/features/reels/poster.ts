/**
 * Generated poster art for reels without a cover: a deterministic aurora gradient built from theme tokens only
 * (no raw hex — `var(--color-aurora-*)`), seeded by the reel id so a tile and its player match.
 */
import type { CSSProperties } from 'react';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const AURORA = ['var(--color-aurora-violet)', 'var(--color-aurora-azure)', 'var(--color-aurora-cyan)', 'var(--color-aurora-mint)', 'var(--color-aurora-orchid)'];

export function gradientFor(seed: string): string {
  const h = hash(seed);
  const a = AURORA[h % AURORA.length]!;
  const b = AURORA[(h >> 3) % AURORA.length]!;
  const c = AURORA[(h >> 6) % AURORA.length]!;
  const x1 = 15 + (h % 50);
  const y1 = 10 + ((h >> 8) % 40);
  const x2 = 40 + ((h >> 12) % 55);
  const y2 = 55 + ((h >> 16) % 40);
  return [
    `radial-gradient(60% 45% at ${x1}% ${y1}%, color-mix(in oklab, ${a} 70%, transparent), transparent 70%)`,
    `radial-gradient(55% 40% at ${x2}% ${y2}%, color-mix(in oklab, ${b} 60%, transparent), transparent 70%)`,
    `radial-gradient(80% 60% at 50% 100%, color-mix(in oklab, ${c} 35%, transparent), transparent 70%)`,
    'linear-gradient(var(--color-canvas), var(--color-canvas))',
  ].join(', ');
}

export function gradientStyle(seed: string): CSSProperties {
  return { backgroundImage: gradientFor(seed) };
}
