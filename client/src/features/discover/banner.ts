/**
 * Deterministic aurora banner per profile (product §2.5 delighter 2): every user gets a unique mesh derived from
 * their id, painted ONLY with theme tokens (no raw colours). Same id → same banner on every device.
 */
import type { CSSProperties } from 'react';

const TOKENS = [
  'var(--color-aurora-violet)',
  'var(--color-aurora-azure)',
  'var(--color-aurora-cyan)',
  'var(--color-aurora-mint)',
  'var(--color-brand-500)',
  'var(--color-aurora-orchid)',
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mixes a token with the canvas so the blobs stay soft on both Aurora surfaces. */
function soft(token: string, pct: number): string {
  return `color-mix(in oklab, ${token} ${pct}%, var(--color-canvas))`;
}

export function bannerStyle(id: string): CSSProperties {
  const h = hash(id);
  const a = TOKENS[h % TOKENS.length]!;
  const b = TOKENS[(h >>> 3) % TOKENS.length]!;
  const c = TOKENS[(h >>> 7) % TOKENS.length]!;
  const x1 = 10 + ((h >>> 11) % 60);
  const y1 = 20 + ((h >>> 15) % 60);
  const x2 = 40 + ((h >>> 19) % 55);
  const y2 = 10 + ((h >>> 23) % 70);
  const x3 = 5 + ((h >>> 27) % 85);
  const angle = (h >>> 5) % 360;
  return {
    backgroundColor: 'var(--color-surface-2)',
    backgroundImage: [
      `radial-gradient(60% 90% at ${x1}% ${y1}%, ${soft(a, 70)} 0%, transparent 70%)`,
      `radial-gradient(55% 80% at ${x2}% ${y2}%, ${soft(b, 62)} 0%, transparent 68%)`,
      `radial-gradient(70% 60% at ${x3}% 95%, ${soft(c, 55)} 0%, transparent 72%)`,
      `linear-gradient(${angle}deg, ${soft(a, 28)}, var(--color-surface-1))`,
    ].join(', '),
  };
}
