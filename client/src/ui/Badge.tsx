import { forwardRef, type ReactNode } from 'react';
import { BadgeCheck, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'gold';

export interface BadgeProps {
  /** `soft` (default) · `outline` · `count` (accent pill, "99+") · `dot` (8px). */
  variant?: 'count' | 'dot' | 'soft' | 'outline';
  tone?: BadgeTone;
  count?: number;
  className?: string;
  children?: ReactNode;
}

const soft: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  gold: 'bg-gold/14 text-gold',
};

const outline: Record<BadgeTone, string> = {
  neutral: 'border-line-strong text-ink-2',
  accent: 'border-accent-line text-accent-ink',
  success: 'border-success/45 text-success',
  warning: 'border-warning/45 text-warning',
  danger: 'border-danger/45 text-danger',
  info: 'border-info/45 text-info',
  gold: 'border-gold/45 text-gold',
};

const solid: Record<BadgeTone, string> = {
  neutral: 'bg-surface-4 text-ink',
  accent: 'bg-accent text-on-accent',
  success: 'bg-success text-ink-inverse',
  warning: 'bg-warning text-ink-inverse',
  danger: 'bg-danger-fill text-white',
  info: 'bg-info text-ink-inverse',
  gold: 'bg-gold text-ink-inverse',
};

/** Non-interactive status. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'soft', tone, count, className, children },
  ref,
) {
  if (variant === 'dot') {
    return <span ref={ref} aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', solid[tone ?? 'accent'], className)} />;
  }
  if (variant === 'count') {
    const n = count ?? 0;
    if (n <= 0 && children == null) return null;
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 type-micro tabular-nums',
          solid[tone ?? 'accent'],
          className,
        )}
      >
        {children ?? (n > 99 ? '99+' : n)}
      </span>
    );
  }
  const t = tone ?? 'neutral';
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-2 type-micro whitespace-nowrap',
        variant === 'outline' ? cn('border', outline[t]) : soft[t],
        className,
      )}
    >
      {children}
      {count !== undefined ? <span className="tabular-nums">{count > 99 ? '99+' : count}</span> : null}
    </span>
  );
});

/** Gold tick for verified orgs. */
export const VerifiedBadge = forwardRef<SVGSVGElement, { size?: number; className?: string }>(function VerifiedBadge(
  { size = 16, className },
  ref,
) {
  return (
    <BadgeCheck
      ref={ref}
      size={size}
      strokeWidth={2}
      role="img"
      aria-label="Verified"
      className={cn('inline-block shrink-0 fill-gold/20 align-[-0.15em] text-gold', className)}
    />
  );
});

/** "OP" marker in Buzz threads (reads the accent slot → Phosphor inside incognito). */
export const OpBadge = forwardRef<HTMLSpanElement, { className?: string }>(function OpBadge({ className }, ref) {
  return (
    <span
      ref={ref}
      title="Original poster"
      className={cn('inline-flex h-[18px] shrink-0 items-center rounded-xs bg-accent-soft px-1.5 type-micro text-accent-ink', className)}
    >
      OP
    </span>
  );
});

/** GraduationCap + university short name. */
export const CampusBadge = forwardRef<HTMLSpanElement, { name: string; className?: string }>(function CampusBadge(
  { name, className },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn('inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full bg-surface-3 pr-2 pl-1.5 type-micro text-ink-2', className)}
    >
      <GraduationCap size={12} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
});
