import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { reducedTween, spring, useReducedMotionPref } from '@/lib/motion';
import { IconButton } from './IconButton';
import { useSurfaceMode } from './Surface';
import { useMergedRef } from './overlay';

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/* ------------------------------------------------------------------ ProgressBar */

export interface ProgressBarProps {
  /** 0–1. `undefined` = indeterminate (uploads). */
  value?: number;
  'aria-label'?: string;
  className?: string;
}

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(function ProgressBar(
  { value, 'aria-label': ariaLabel = 'Progress', className },
  ref,
) {
  const reduced = useReducedMotionPref();
  const determinate = value !== undefined;
  const v = clamp01(value ?? 0);
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(v * 100) : undefined}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-surface-4', className)}
    >
      {determinate ? (
        <motion.div
          initial={false}
          animate={{ scaleX: v }}
          transition={reduced ? reducedTween : spring.gentle}
          className="absolute inset-0 origin-left rounded-full bg-hero"
        />
      ) : (
        // Progress is information, not decoration: it keeps moving under reduced motion.
        <div className="uv-indeterminate motion-safe-keep absolute inset-y-0 left-0 w-full rounded-full bg-hero" />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ StepDots */

export interface StepDotsProps {
  total: number;
  /** **1-based** current step ("Step {current} of {total}"). Steps before it are complete. */
  current: number;
  /** Shows the "Step 2 of 5" caption. */
  label?: boolean;
  className?: string;
}

export const StepDots = forwardRef<HTMLDivElement, StepDotsProps>(function StepDots({ total, current, label = false, className }, ref) {
  const reduced = useReducedMotionPref();
  const step = Math.min(Math.max(Math.round(current), 0), total);
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-valuetext={`Step ${step} of ${total}`}
      className={cn('w-full', className)}
    >
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => {
          const index = i + 1;
          const fill = index <= step ? 1 : 0;
          return (
            <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-4">
              <motion.span
                initial={false}
                animate={{ scaleX: fill }}
                transition={reduced ? reducedTween : spring.gentle}
                className={cn('absolute inset-0 origin-left rounded-full', index === step ? 'bg-hero' : 'bg-accent')}
              />
            </span>
          );
        })}
      </div>
      {label ? (
        <p className="mt-2 type-caption text-ink-3 tabular-nums">
          Step {step} of {total}
        </p>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ ProgressRing */

export interface ProgressRingProps {
  /** 0–1. */
  value: number;
  size?: 40 | 64 | 96;
  /** Centre content. Defaults to the percentage. */
  label?: ReactNode;
  /** Draw from 0 to `value` once, when 40% of the ring is visible. Default `true`. */
  animate?: boolean;
  'aria-label'?: string;
  className?: string;
}

const ringSpec = {
  40: { stroke: 4, text: 'type-micro' },
  64: { stroke: 5, text: 'type-label' },
  96: { stroke: 6, text: 'type-title-2' },
} as const;

export const ProgressRing = forwardRef<HTMLDivElement, ProgressRingProps>(function ProgressRing(
  { value, size = 64, label, animate: shouldAnimate = true, 'aria-label': ariaLabel = 'Progress', className },
  ref,
) {
  const reduced = useReducedMotionPref();
  const mode = useSurfaceMode();
  const gradientId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const setRef = useMergedRef(ref, root);
  const target = clamp01(value);
  const still = !shouldAnimate || reduced;
  const [seen, setSeen] = useState(still);
  const progress = useMotionValue(still ? target : 0);

  useEffect(() => {
    if (seen) return;
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    if (still) {
      progress.set(target);
      return;
    }
    const controls = animate(progress, target, spring.gentle);
    return () => controls.stop();
  }, [seen, still, target, progress]);

  const { stroke, text } = ringSpec[size];
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = useTransform(progress, (p) => c * (1 - p));
  const stops =
    mode === 'incognito'
      ? ['var(--color-incog-300)', 'var(--color-incog-500)', 'var(--color-incog-600)']
      : ['var(--color-aurora-violet)', 'var(--color-aurora-azure)', 'var(--color-aurora-cyan)'];

  return (
    <div
      ref={setRef}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(target * 100)}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: stops[0] }} />
            <stop offset="50%" style={{ stopColor: stops[1] }} />
            <stop offset="100%" style={{ stopColor: stops[2] }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-4" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <span className={cn('absolute inset-0 flex items-center justify-center font-display text-ink tabular-nums', text)}>
        {label ?? `${Math.round(target * 100)}%`}
      </span>
    </div>
  );
});

/* ------------------------------------------------------------------ NumberStepper */

export interface NumberStepperProps {
  value: number;
  /** Default 0. */
  min?: number;
  /** Default 99. */
  max?: number;
  onChange(value: number): void;
  'aria-label'?: string;
  className?: string;
}

/** `−  2  +` for small counts (bedrooms, quantity). */
export const NumberStepper = forwardRef<HTMLDivElement, NumberStepperProps>(function NumberStepper(
  { value, min = 0, max = 99, onChange, 'aria-label': ariaLabel = 'Quantity', className },
  ref,
) {
  return (
    <div ref={ref} role="group" aria-label={ariaLabel} className={cn('inline-flex items-center gap-1', className)}>
      <IconButton icon={Minus} aria-label="Decrease" variant="filled" size="sm" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
      <span aria-live="polite" className="min-w-9 text-center type-headline text-ink tabular-nums">
        {value}
      </span>
      <IconButton icon={Plus} aria-label="Increase" variant="filled" size="sm" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
    </div>
  );
});
