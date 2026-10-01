import { forwardRef, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { edgeMaskStyle, useScrollEdges } from './useScrollEdges';
import { useMergedRef } from './overlay';

export interface ChipProps {
  /**
   * `filter` (default) = toggle button · `choice` = same look with radio semantics (used by `ChipGroup`) ·
   * `tag` = static, not a button · `removable` = static label + trailing remove button.
   */
  variant?: 'filter' | 'choice' | 'tag' | 'removable';
  /** sm 32 (`type-caption`) · md 36 (`type-label-sm`, default). Hit area is 44 either way. */
  size?: 'sm' | 'md';
  selected?: boolean;
  onClick?(): void;
  onRemove?(): void;
  leftIcon?: LucideIcon;
  count?: number;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  /** Roving tabindex, set by `ChipGroup`. */
  tabIndex?: number;
}

const sizeClass = { sm: 'h-8 gap-1.5 px-3 type-caption', md: 'h-9 gap-1.5 px-3.5 type-label-sm' } as const;
const hit = 'before:absolute before:inset-x-0 before:-inset-y-1.5';
const off = 'border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink';
const on = 'border-accent-line bg-accent-soft text-ink';

export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  { variant = 'filter', size = 'md', selected = false, onClick, onRemove, leftIcon: LeftIcon, count, disabled, className, children, tabIndex },
  ref,
) {
  const iconPx = size === 'sm' ? 14 : 16;
  const inner = (
    <>
      {LeftIcon ? <LeftIcon size={iconPx} strokeWidth={2} aria-hidden className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
      {count !== undefined ? <span className={cn('tabular-nums', selected ? 'text-ink-2' : 'text-ink-3')}>{count}</span> : null}
    </>
  );
  const shape = cn('relative inline-flex max-w-full shrink-0 select-none items-center rounded-full border whitespace-nowrap', sizeClass[size]);

  if (variant === 'tag') {
    return (
      <span ref={ref as Ref<HTMLSpanElement>} className={cn(shape, 'border-transparent bg-surface-3 text-ink-2', className)}>
        {inner}
      </span>
    );
  }

  if (variant === 'removable') {
    return (
      <span ref={ref as Ref<HTMLSpanElement>} className={cn(shape, on, 'pr-1', disabled && 'opacity-45', className)}>
        {inner}
        <button
          type="button"
          aria-label={typeof children === 'string' ? `Remove ${children}` : 'Remove'}
          disabled={disabled}
          onClick={onRemove}
          className="press-icon relative -mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-2 before:absolute before:-inset-2.5 hover:bg-surface-4 hover:text-ink"
        >
          <X size={14} strokeWidth={2.25} aria-hidden />
        </button>
      </span>
    );
  }

  const choice = variant === 'choice';
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      role={choice ? 'radio' : undefined}
      aria-checked={choice ? selected : undefined}
      aria-pressed={choice ? undefined : selected}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        shape,
        hit,
        'press disabled:pointer-events-none disabled:opacity-45',
        selected ? on : off,
        className,
      )}
    >
      {inner}
    </button>
  );
});

/* ------------------------------------------------------------------ ChipGroup */

export interface ChipGroupOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface ChipGroupProps<T extends string> {
  options: readonly ChipGroupOption<T>[];
  /** Single: `T | null`. Multiple: `T[]`. */
  value: T | T[] | null;
  /**
   * Single mode emits `T` (radio semantics: tapping the selected chip keeps it selected — it never emits null).
   * Multiple mode emits `T[]`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange(value: any): void;
  multiple?: boolean;
  /** Multiple mode: cap on selections; the rest are disabled once reached. */
  max?: number;
  /** `'x'` = one scrolling row (`scroll-x`, edge fades; never drags the Home pager) · `'wrap'` (default). */
  scroll?: 'x' | 'wrap';
  size?: 'sm' | 'md';
  'aria-label': string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

export function ChipGroup<const T extends string>({
  options,
  value,
  onChange,
  multiple = false,
  max,
  scroll = 'wrap',
  size = 'md',
  'aria-label': ariaLabel,
  className,
  ref,
}: ChipGroupProps<T>) {
  const el = useRef<HTMLDivElement | null>(null);
  const setRef = useMergedRef(ref, el);
  const edges = useScrollEdges(el, scroll === 'x');

  const selectedValues: T[] = Array.isArray(value) ? value : value === null ? [] : [value];
  const atMax = multiple && max !== undefined && selectedValues.length >= max;

  const select = (v: T) => {
    if (!multiple) {
      if (selectedValues[0] !== v) onChange(v);
      return;
    }
    if (selectedValues.includes(v)) onChange(selectedValues.filter((x) => x !== v));
    else if (!atMax) onChange([...selectedValues, v]);
  };

  // Radio group: roving tabindex + arrow keys (selection follows focus, like native radios).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (multiple || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
    if (chips.length === 0) return;
    e.preventDefault();
    const index = chips.indexOf(document.activeElement as HTMLButtonElement);
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? chips.length - 1 : (index + (forward ? 1 : -1) + chips.length) % chips.length;
    chips[next]?.focus();
    chips[next]?.click();
  };

  const tabStop = selectedValues[0] ?? options[0]?.value;

  return (
    <div
      ref={setRef}
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={scroll === 'x' ? edgeMaskStyle(edges) : undefined}
      className={cn('flex gap-2', scroll === 'x' ? 'scroll-x flex-nowrap py-1' : 'flex-wrap', className)}
    >
      {options.map((option) => {
        const selected = selectedValues.includes(option.value);
        return (
          <Chip
            key={option.value}
            variant={multiple ? 'filter' : 'choice'}
            size={size}
            selected={selected}
            leftIcon={option.icon}
            disabled={!selected && atMax}
            tabIndex={multiple ? undefined : option.value === tabStop ? 0 : -1}
            onClick={() => select(option.value)}
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
  );
}
