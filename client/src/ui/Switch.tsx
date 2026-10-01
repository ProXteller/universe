import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { spring, useReducedMotionPref } from '@/lib/motion';

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  /** Required unless the switch sits in a `ListRow` whose title names it via `aria-labelledby`. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  className?: string;
}

const TRAVEL = 20; // 52 track − 26 thumb − 2 × 3 inset

/** 52×32 track, 26px thumb. Pair with a label through `ListRow`'s trailing slot. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, disabled, className, ...aria },
  ref,
) {
  const reduced = useReducedMotionPref();
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-13 shrink-0 items-center rounded-full p-[3px] transition-colors duration-150 ease-out',
        'before:absolute before:-inset-x-1 before:-inset-y-1.5 disabled:pointer-events-none disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-surface-4',
        className,
      )}
      {...aria}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ x: checked ? TRAVEL : 0 }}
        transition={reduced ? { duration: 0 } : spring.snappy}
        className={cn(
          'block size-[26px] rounded-full shadow-sm transition-colors duration-150 ease-out',
          checked ? 'bg-on-accent' : 'bg-white',
        )}
      />
    </button>
  );
});
