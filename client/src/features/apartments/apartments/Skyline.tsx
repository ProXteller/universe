/**
 * Isometric skyline with orbit rings (design §7.7) — inline SVG, token colours only (no network, no hex).
 */
import type { FC } from 'react';
import { cn } from '@/lib/cn';

export const Skyline: FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 360 220" role="img" aria-label="A campus skyline inside orbit rings" className={cn('block h-auto w-full', className)}>
    <defs>
      <linearGradient id="apt-tower" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--color-surface-4)" />
        <stop offset="1" stopColor="var(--color-surface-2)" />
      </linearGradient>
      <linearGradient id="apt-tower-lit" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--color-aurora-violet)" stopOpacity="0.85" />
        <stop offset="1" stopColor="var(--color-aurora-cyan)" stopOpacity="0.55" />
      </linearGradient>
      <radialGradient id="apt-glow" cx="0.5" cy="0.55" r="0.55">
        <stop offset="0" stopColor="var(--color-aurora-violet)" stopOpacity="0.55" />
        <stop offset="0.6" stopColor="var(--color-aurora-azure)" stopOpacity="0.18" />
        <stop offset="1" stopColor="var(--color-canvas)" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* aurora glow */}
    <ellipse cx="180" cy="126" rx="170" ry="96" fill="url(#apt-glow)" />

    {/* orbit rings */}
    <g fill="none" stroke="var(--color-line-strong)" strokeWidth="1">
      <ellipse cx="180" cy="128" rx="150" ry="52" opacity="0.7" />
      <ellipse cx="180" cy="128" rx="112" ry="38" opacity="0.5" />
    </g>
    <circle cx="52" cy="150" r="3.5" fill="var(--color-aurora-cyan)" />
    <circle cx="292" cy="98" r="2.5" fill="var(--color-aurora-mint)" />
    <circle cx="300" cy="150" r="2" fill="var(--color-ink-3)" />

    {/* ground plane */}
    <path d="M60 176 L180 212 L300 176 L180 140 Z" fill="var(--color-surface-1)" stroke="var(--color-line)" strokeWidth="1" />

    {/* towers: back row */}
    <g>
      <path d="M96 150 l0 -44 l22 -8 l22 8 l0 44 l-22 8 Z" fill="url(#apt-tower)" stroke="var(--color-line-strong)" strokeWidth="0.75" />
      <path d="M118 158 l0 -44 l22 -8 l0 44 Z" fill="var(--color-surface-3)" opacity="0.7" />
      <path d="M232 152 l0 -54 l22 -8 l22 8 l0 54 l-22 8 Z" fill="url(#apt-tower)" stroke="var(--color-line-strong)" strokeWidth="0.75" />
      <path d="M254 160 l0 -54 l22 -8 l0 54 Z" fill="var(--color-surface-3)" opacity="0.7" />
    </g>

    {/* hero tower */}
    <g>
      <path d="M150 172 l0 -78 l30 -11 l30 11 l0 78 l-30 11 Z" fill="url(#apt-tower-lit)" stroke="var(--color-accent-line)" strokeWidth="1" />
      <path d="M180 183 l0 -78 l30 -11 l0 78 Z" fill="var(--color-canvas)" opacity="0.28" />
      {/* windows */}
      <g fill="var(--color-white)" opacity="0.85">
        <rect x="158" y="104" width="5" height="6" rx="1" />
        <rect x="168" y="100" width="5" height="6" rx="1" />
        <rect x="158" y="118" width="5" height="6" rx="1" />
        <rect x="168" y="114" width="5" height="6" rx="1" />
        <rect x="158" y="132" width="5" height="6" rx="1" />
        <rect x="168" y="128" width="5" height="6" rx="1" />
        <rect x="158" y="146" width="5" height="6" rx="1" />
        <rect x="168" y="142" width="5" height="6" rx="1" />
      </g>
      <g fill="var(--color-aurora-mint)" opacity="0.7">
        <rect x="188" y="100" width="5" height="6" rx="1" />
        <rect x="198" y="96" width="5" height="6" rx="1" />
        <rect x="188" y="128" width="5" height="6" rx="1" />
        <rect x="198" y="124" width="5" height="6" rx="1" />
      </g>
    </g>

    {/* front row */}
    <g>
      <path d="M118 178 l0 -30 l16 -6 l16 6 l0 30 l-16 6 Z" fill="url(#apt-tower)" stroke="var(--color-line-strong)" strokeWidth="0.75" />
      <path d="M214 184 l0 -36 l18 -7 l18 7 l0 36 l-18 7 Z" fill="url(#apt-tower)" stroke="var(--color-line-strong)" strokeWidth="0.75" />
      <path d="M232 191 l0 -36 l18 -7 l0 36 Z" fill="var(--color-surface-3)" opacity="0.7" />
    </g>

    {/* front ring overlaps the skyline */}
    <path d="M30 128 a150 52 0 0 0 300 0" fill="none" stroke="var(--color-accent-line)" strokeWidth="1.25" opacity="0.9" />
    <circle cx="180" cy="180" r="4" fill="var(--color-accent)" />
  </svg>
);
