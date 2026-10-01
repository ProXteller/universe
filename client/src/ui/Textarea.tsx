import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { Field, controlChrome, controlInvalid } from './Field';
import { useMergedRef } from './overlay';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
  /** Auto-grow floor, default 3 rows. */
  minRows?: number;
  /** Auto-grow ceiling, default 8 rows; scrolls beyond. */
  maxRows?: number;
  maxLength?: number;
  /** Character counter bottom-right. Defaults to `true` when `maxLength` is set. */
  showCount?: boolean;
  /** `bare` = no chrome, for composers (`type-body-lg`). */
  variant?: 'field' | 'bare';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    helper,
    error,
    minRows = 3,
    maxRows = 8,
    maxLength,
    showCount,
    variant = 'field',
    className,
    id,
    disabled,
    value,
    defaultValue,
    onChange,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? `ta-${autoId}`;
  const messageId = `${areaId}-msg`;
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useMergedRef(ref, inner);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ''));
  const current = value !== undefined ? String(value) : uncontrolled;
  const bare = variant === 'bare';

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const min = Math.round(line * minRows + pad);
    const max = Math.round(line * Math.max(maxRows, minRows) + pad);
    el.style.height = 'auto';
    const next = Math.min(max, Math.max(min, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [minRows, maxRows]);

  useLayoutEffect(() => {
    resize();
  }, [resize, current]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (value === undefined) setUncontrolled(e.target.value);
    onChange?.(e);
  };

  const counts = showCount ?? maxLength !== undefined;
  const length = current.length;
  const ratio = maxLength ? length / maxLength : 0;
  const counter = counts ? (
    <span
      aria-live="off"
      className={cn(
        'shrink-0 type-caption tabular-nums',
        ratio >= 1 ? 'text-danger' : ratio >= 0.9 ? 'text-warning' : 'text-ink-3',
      )}
    >
      {maxLength !== undefined ? `${length}/${maxLength}` : length}
    </span>
  ) : null;

  return (
    <Field
      htmlFor={areaId}
      label={label}
      helper={helper}
      error={error}
      messageId={messageId}
      aside={counter}
      className={className}
    >
      <textarea
        ref={setRef}
        id={areaId}
        rows={minRows}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        onChange={handleChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || helper ? messageId : undefined}
        className={cn(
          'block w-full min-w-0 resize-none appearance-none text-ink outline-none placeholder:text-ink-3',
          bare
            ? 'bg-transparent type-body-lg'
            : cn('rounded-md px-3.5 py-3 text-md leading-[1.375rem] font-normal', controlChrome),
          !bare && error && controlInvalid,
          disabled && 'pointer-events-none opacity-45',
        )}
        {...rest}
      />
    </Field>
  );
});
