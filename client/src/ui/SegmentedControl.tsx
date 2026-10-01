import { useId, type KeyboardEvent, type Ref } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { spring, useReducedMotionPref } from '@/lib/motion';

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  /** md 44 (default) · sm 36. */
  size?: 'sm' | 'md';
  /** Segments share the width equally. */
  fullWidth?: boolean;
  'aria-label': string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** 2–4 mutually exclusive views of the same data. Rule of thumb: Segmented = filter, Tabs = different content. */
export function SegmentedControl<const T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  fullWidth = false,
  'aria-label': ariaLabel,
  className,
  ref,
}: SegmentedControlProps<T>) {
  const uid = useId();
  const reduced = useReducedMotionPref();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (forward ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'relative isolate inline-flex max-w-full items-center rounded-full bg-surface-2 p-1',
        size === 'sm' ? 'h-9' : 'h-11',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            className={cn(
              'relative flex h-full min-w-0 items-center justify-center gap-1.5 rounded-full type-label-sm whitespace-nowrap',
              'transition-colors duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-1.5',
              size === 'sm' ? 'px-3' : 'px-4',
              fullWidth && 'flex-1',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${uid}`}
                aria-hidden
                transition={reduced ? { duration: 0 } : spring.snappy}
                className="absolute inset-0 -z-[1] rounded-full bg-surface-4 shadow-sm inset-shadow-hairline"
              />
            ) : null}
            {Icon ? <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" /> : null}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
