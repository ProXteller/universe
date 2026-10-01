import { forwardRef, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field, controlChrome, controlInvalid } from './Field';
import { useMergedRef } from './overlay';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: string;
  helper?: string;
  error?: string;
  /** md 44 (default) · lg 52. */
  size?: 'md' | 'lg';
  /** `search` = pill shape, `Search` glyph on the left, clear button when non-empty. */
  variant?: 'field' | 'search';
  leftIcon?: LucideIcon;
  rightSlot?: ReactNode;
  /** Static text before the value, e.g. `$` or `@`. */
  prefix?: string;
  /** Called by the clear button. Without it the kit clears the native value and fires `onChange('')`. */
  onClear?(): void;
}

function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Text field. Input text is always 16px (iOS zoom guard). `className` styles the outer field wrapper. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helper,
    error,
    size = 'md',
    variant = 'field',
    leftIcon,
    rightSlot,
    prefix,
    onClear,
    className,
    id,
    disabled,
    value,
    defaultValue,
    onChange,
    type,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `in-${autoId}`;
  const messageId = `${inputId}-msg`;
  const inner = useRef<HTMLInputElement | null>(null);
  const setRef = useMergedRef(ref, inner);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ''));
  const current = value !== undefined ? String(value) : uncontrolled;

  const isSearch = variant === 'search';
  const LeftIcon = leftIcon ?? (isSearch ? Search : undefined);
  const canClear = (isSearch || Boolean(onClear)) && current.length > 0 && !disabled;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) setUncontrolled(e.target.value);
    onChange?.(e);
  };

  const clear = () => {
    const el = inner.current;
    if (onClear) onClear();
    else if (el) setNativeValue(el, '');
    if (value === undefined) setUncontrolled('');
    el?.focus();
  };

  return (
    <Field htmlFor={inputId} label={label} helper={helper} error={error} messageId={messageId} className={className}>
      <div
        className={cn(
          'flex w-full min-w-0 cursor-text items-center gap-2',
          controlChrome,
          isSearch ? 'rounded-full pr-1.5 pl-3.5' : 'rounded-md px-3.5',
          size === 'lg' ? 'h-13' : 'h-11',
          error && controlInvalid,
          disabled && 'pointer-events-none opacity-45',
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget) inner.current?.focus();
        }}
      >
        {LeftIcon ? <LeftIcon size={isSearch ? 18 : 20} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-3" /> : null}
        {prefix ? (
          <span aria-hidden className="shrink-0 text-md text-ink-3 select-none">
            {prefix}
          </span>
        ) : null}
        <input
          ref={setRef}
          id={inputId}
          type={type ?? (isSearch ? 'search' : 'text')}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helper ? messageId : undefined}
          enterKeyHint={isSearch ? 'search' : undefined}
          className={cn(
            'h-full min-w-0 flex-1 appearance-none bg-transparent text-md font-normal text-ink outline-none',
            'placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden',
          )}
          {...rest}
        />
        {canClear ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={clear}
            className="press-icon relative flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-ink-2 before:absolute before:-inset-2 hover:text-ink"
          >
            <X size={14} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        {rightSlot ? <div className="flex shrink-0 items-center">{rightSlot}</div> : null}
      </div>
    </Field>
  );
});
