import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Field, controlChrome, controlInvalid } from './Field';
import { Sheet } from './Sheet';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
}

interface SelectBaseProps<T extends string> {
  label?: string;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  error?: string;
  /** Sheet title; falls back to `label`, then "Select". */
  sheetTitle?: string;
  disabled?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export interface SelectProps<T extends string> extends SelectBaseProps<T> {
  value: T | null;
  onChange: (value: T) => void;
}

export interface MultiSelectProps<T extends string> extends SelectBaseProps<T> {
  value: T[];
  onChange: (value: T[]) => void;
  /** Maximum number of selections; further options are disabled once reached. */
  max?: number;
}

/* ------------------------------------------------------------------ shared pieces */

interface TriggerProps {
  id: string;
  labelId: string;
  messageId: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  expanded: boolean;
  onOpen(): void;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
  filled: boolean;
}

function Trigger({ id, labelId, messageId, label, error, disabled, className, expanded, onOpen, buttonRef, children, filled }: TriggerProps) {
  return (
    <Field labelId={labelId} htmlFor={id} label={label} error={error} messageId={messageId} className={className}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        onClick={onOpen}
        className={cn(
          'flex h-11 w-full min-w-0 items-center gap-2 rounded-md px-3.5 text-left text-md font-normal outline-none',
          'focus-visible:border-accent-line focus-visible:ring-3 focus-visible:ring-accent-soft',
          controlChrome,
          error && controlInvalid,
          filled ? 'text-ink' : 'text-ink-3',
          'disabled:pointer-events-none disabled:opacity-45',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
        <ChevronDown
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className={cn('shrink-0 text-ink-3 transition-transform duration-150 ease-out', expanded && 'rotate-180')}
        />
      </button>
    </Field>
  );
}

interface OptionRowProps<T extends string> {
  option: SelectOption<T>;
  selected: boolean;
  disabled?: boolean;
  role: 'radio' | 'checkbox';
  first: boolean;
  onSelect(): void;
}

function OptionRow<T extends string>({ option, selected, disabled, role, first, onSelect }: OptionRowProps<T>) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      data-option=""
      onClick={onSelect}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ease-out',
        'hover:bg-surface-4 active:bg-surface-4 disabled:pointer-events-none disabled:opacity-45',
        !first && 'border-t border-line-subtle',
        selected && 'bg-accent-soft hover:bg-accent-soft',
      )}
    >
      {Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden className={cn('shrink-0', selected ? 'text-accent-ink' : 'text-ink-2')} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate type-headline font-medium text-ink">{option.label}</span>
        {option.description ? <span className="mt-0.5 block type-footnote text-ink-3">{option.description}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center border transition-colors duration-150 ease-out',
          role === 'radio' ? 'rounded-full' : 'rounded-xs',
          selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-transparent text-transparent',
        )}
      >
        <Check size={14} strokeWidth={3} />
      </span>
    </button>
  );
}

/** ↑/↓/Home/End move focus between option rows. */
function onListKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-option]:not(:disabled)'));
  if (rows.length === 0) return;
  e.preventDefault();
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? (index + 1) % rows.length : (index - 1 + rows.length) % rows.length;
  rows[next]?.focus();
}

const listClass = 'overflow-hidden rounded-lg border border-line bg-surface-3';

/* ------------------------------------------------------------------ Select */

/** A button styled like an Input that opens a Sheet with a radio list. Never a native popup. */
export function Select<const T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select',
  error,
  sheetTitle,
  disabled,
  className,
  ref,
}: SelectProps<T>) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? null;
  const CurrentIcon = current?.icon;

  return (
    <>
      <Trigger
        id={`sel-${uid}`}
        labelId={`sel-${uid}-label`}
        messageId={`sel-${uid}-msg`}
        label={label}
        error={error}
        disabled={disabled}
        className={className}
        expanded={open}
        onOpen={() => setOpen(true)}
        buttonRef={ref}
        filled={Boolean(current)}
      >
        {CurrentIcon ? <CurrentIcon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-2" /> : null}
        <span className="truncate">{current ? current.label : placeholder}</span>
      </Trigger>
      <Sheet open={open} onOpenChange={setOpen} title={sheetTitle ?? label ?? 'Select'}>
        <div role="radiogroup" aria-label={sheetTitle ?? label ?? 'Options'} className={listClass} onKeyDown={onListKeyDown}>
          {options.map((option, i) => (
            <OptionRow
              key={option.value}
              option={option}
              role="radio"
              first={i === 0}
              selected={option.value === value}
              onSelect={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ MultiSelect */

/** Same trigger; the sheet holds a checkbox list and a "Done" footer. Changes apply immediately. */
export function MultiSelect<const T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select',
  error,
  sheetTitle,
  max,
  disabled,
  className,
  ref,
}: MultiSelectProps<T>) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => value.includes(o.value));
  const atMax = max !== undefined && value.length >= max;

  const summary =
    chosen.length === 0
      ? placeholder
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(', ')
        : `${chosen[0]!.label}, ${chosen[1]!.label} +${chosen.length - 2}`;

  const toggle = (v: T) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!atMax) onChange([...value, v]);
  };

  return (
    <>
      <Trigger
        id={`msel-${uid}`}
        labelId={`msel-${uid}-label`}
        messageId={`msel-${uid}-msg`}
        label={label}
        error={error}
        disabled={disabled}
        className={className}
        expanded={open}
        onOpen={() => setOpen(true)}
        buttonRef={ref}
        filled={chosen.length > 0}
      >
        <span className="truncate">{summary}</span>
      </Trigger>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={sheetTitle ?? label ?? 'Select'}
        description={max !== undefined ? `Choose up to ${max} · ${value.length} selected` : undefined}
        footer={
          <Button fullWidth size="lg" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <div role="group" aria-label={sheetTitle ?? label ?? 'Options'} className={listClass} onKeyDown={onListKeyDown}>
          {options.map((option, i) => {
            const selected = value.includes(option.value);
            return (
              <OptionRow
                key={option.value}
                option={option}
                role="checkbox"
                first={i === 0}
                selected={selected}
                disabled={!selected && atMax}
                onSelect={() => toggle(option.value)}
              />
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
