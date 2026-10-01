import { forwardRef, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { useMergedRef } from './overlay';

export interface OTPInputProps {
  value: string;
  onChange(value: string): void;
  /** Fired once each time the value reaches six digits. */
  onComplete?(value: string): void;
  /** `verifying` disables input · `error` shakes, then clears the value · `success` turns the cells green. */
  status?: 'idle' | 'verifying' | 'error' | 'success';
  autoFocus?: boolean;
  'aria-label'?: string;
  className?: string;
}

const LENGTH = 6;

/**
 * Six cells painted under ONE real input (`inputMode="numeric"`, `autoComplete="one-time-code"`), so paste
 * and SMS autofill just work. Cells are fluid (max 48px) so the row fits a 360px screen with 16px gutters.
 */
export const OTPInput = forwardRef<HTMLInputElement, OTPInputProps>(function OTPInput(
  { value, onChange, onComplete, status = 'idle', autoFocus, 'aria-label': ariaLabel = 'Verification code', className },
  ref,
) {
  const reduced = useReducedMotionPref();
  const input = useRef<HTMLInputElement | null>(null);
  const setRef = useMergedRef(ref, input);
  const [focused, setFocused] = useState(false);
  const shake = useAnimationControls();
  /** The six-digit value `onComplete` last fired for; re-armed whenever the value drops below six digits. */
  const completed = useRef<string | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const digits = value.replace(/\D/g, '').slice(0, LENGTH);
  const locked = status === 'verifying' || status === 'success';

  useEffect(() => {
    if (status !== 'error') return;
    if (!reduced) void shake.start({ x: [0, -6, 6, -6, 6, 0], transition: { duration: 0.36, ease: 'easeInOut' } });
    const t = window.setTimeout(() => {
      change.current('');
      input.current?.focus();
    }, 520);
    return () => window.clearTimeout(t);
  }, [status, reduced, shake]);

  // Watches the CONTROLLED value, so a programmatic fill (dev-inbox "Fill", a paste handler in the parent, SMS
  // autofill that never reaches onChange) completes exactly like typing does. Typing fires synchronously from
  // handleChange below and lands here already marked, so nothing fires twice. A wrong code stays marked until
  // the error path clears the value (< 6 digits re-arms), so an `error` status can never re-submit it.
  useEffect(() => {
    if (digits.length < LENGTH) {
      completed.current = null;
      return;
    }
    if (locked || completed.current === digits) return;
    completed.current = digits;
    complete.current?.(digits);
  }, [digits, locked]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, LENGTH);
    onChange(next);
    if (next.length < LENGTH) completed.current = null;
    else if (!locked && completed.current !== next) {
      completed.current = next;
      onComplete?.(next);
    }
  };

  const activeIndex = Math.min(digits.length, LENGTH - 1);

  return (
    <motion.div animate={shake} className={cn('relative mx-auto flex w-full max-w-[344px] items-center', className)}>
      <div aria-hidden className="flex w-full items-center gap-2">
        {Array.from({ length: LENGTH }, (_, i) => {
          const char = digits[i] ?? '';
          const active = focused && !locked && status !== 'error' && i === activeIndex && digits.length < LENGTH;
          return (
            <div
              key={i}
              className={cn(
                'relative flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border bg-surface-2 inset-shadow-hairline',
                'type-title-2 text-ink tabular-nums transition-[border-color,box-shadow] duration-150 ease-out',
                i === 3 && 'ml-4',
                status === 'error'
                  ? 'border-danger/70'
                  : status === 'success'
                    ? 'border-success/70'
                    : active
                      ? 'border-accent-line ring-3 ring-accent-soft'
                      : char
                        ? 'border-line-strong'
                        : 'border-line',
                status === 'verifying' && 'opacity-60',
              )}
            >
              {char}
              {active ? <span className="uv-caret absolute h-6 w-0.5 rounded-full bg-accent-ink" /> : null}
            </div>
          );
        })}
      </div>
      <input
        ref={setRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        aria-label={ariaLabel}
        aria-invalid={status === 'error' ? true : undefined}
        autoFocus={autoFocus}
        disabled={locked}
        value={digits}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={(e) => {
          // Keep the caret at the end: the cells have no notion of a mid-string cursor.
          const el = e.currentTarget;
          if (el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length);
        }}
        className="absolute inset-0 size-full cursor-text appearance-none rounded-md border-0 bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
      />
      {status === 'success' ? (
        <motion.span
          aria-hidden
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? { duration: 0.12 } : spring.snappy}
          className="pointer-events-none absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-success text-ink-inverse"
        >
          <Check size={14} strokeWidth={3} />
        </motion.span>
      ) : null}
      <span className="sr-only" role="status">
        {status === 'verifying' ? 'Checking code' : status === 'error' ? 'That code did not match' : status === 'success' ? 'Code accepted' : ''}
      </span>
    </motion.div>
  );
});
