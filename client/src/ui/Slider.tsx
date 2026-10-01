import { forwardRef, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { cn } from '@/lib/cn';

export interface SliderProps {
  min: number;
  max: number;
  /** Default 1. */
  step?: number;
  value: number;
  onChange(value: number): void;
  /** Formats the value for the bubble, the header read-out and `aria-valuetext`. */
  format?(value: number): string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export interface RangeSliderProps extends Omit<SliderProps, 'value' | 'onChange'> {
  value: [number, number];
  onChange(value: [number, number]): void;
  /** Minimum distance between the two thumbs, in value units. Default 0. */
  minGap?: number;
}

const THUMB = 24;
const INSET = THUMB / 2;

function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function snap(raw: number, min: number, max: number, step: number): number {
  const stepped = Math.round((raw - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals(step)));
}

interface CoreProps {
  min: number;
  max: number;
  step: number;
  values: number[];
  minGap: number;
  onValues(values: number[]): void;
  format?(value: number): string;
  label?: string;
  disabled?: boolean;
  className?: string;
  rootRef: Ref<HTMLDivElement>;
  thumbLabels: string[];
}

function SliderCore({ min, max, step, values, minGap, onValues, format, label, disabled, className, rootRef, thumbLabels }: CoreProps) {
  const labelId = useId();
  const track = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState<number | null>(null);
  const span = max - min || 1;
  const text = (v: number) => (format ? format(v) : String(v));
  const pct = (v: number) => Math.min(1, Math.max(0, (v - min) / span));

  const commit = (index: number, raw: number) => {
    let next = snap(raw, min, max, step);
    if (values.length === 2) {
      next = index === 0 ? Math.min(next, values[1]! - minGap) : Math.max(next, values[0]! + minGap);
      next = Math.min(max, Math.max(min, next));
    }
    if (next === values[index]) return;
    const out = values.slice();
    out[index] = next;
    onValues(out);
  };

  const valueAt = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= THUMB) return min;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - INSET) / (rect.width - THUMB)));
    return min + ratio * span;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const raw = valueAt(e.clientX);
    let index = 0;
    if (values.length === 2) {
      const d0 = Math.abs(raw - values[0]!);
      const d1 = Math.abs(raw - values[1]!);
      index = d0 === d1 ? (raw > values[1]! ? 1 : 0) : d0 < d1 ? 0 : 1;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(index);
    setKeyboard(null);
    commit(index, raw);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    commit(dragging, valueAt(e.clientX));
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(null);
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = Math.max(step, snap(min + span * 0.1, min, max, step) - min);
    const current = values[index]!;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - step;
    else if (e.key === 'PageUp') next = current + big;
    else if (e.key === 'PageDown') next = current - big;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    setKeyboard(index);
    commit(index, next);
  };

  const lo = values.length === 2 ? pct(values[0]!) : 0;
  const hi = pct(values[values.length - 1]!);
  const readout = values.map(text).join(' – ');

  return (
    <div ref={rootRef} className={cn('w-full min-w-0', disabled && 'pointer-events-none opacity-45', className)}>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span id={labelId} className="type-footnote text-ink-2">
            {label}
          </span>
          <span className="type-label-sm text-ink tabular-nums">{readout}</span>
        </div>
      ) : null}
      <div
        ref={track}
        data-sheet-no-drag=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className="relative h-11 cursor-pointer touch-pan-y select-none"
      >
        <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-surface-4">
          <div className="absolute inset-y-0 rounded-full bg-accent" style={{ left: `${lo * 100}%`, right: `${(1 - hi) * 100}%` }} />
        </div>
        {values.map((v, i) => {
          const showBubble = dragging === i || keyboard === i;
          return (
            <div
              key={i}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={label ? undefined : thumbLabels[i]}
              aria-labelledby={label ? labelId : undefined}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={v}
              aria-valuetext={values.length === 2 ? `${thumbLabels[i]}: ${text(v)}` : text(v)}
              aria-disabled={disabled || undefined}
              aria-orientation="horizontal"
              onKeyDown={onKeyDown(i)}
              onBlur={() => setKeyboard(null)}
              style={{ left: `calc(${INSET}px + (100% - ${THUMB}px) * ${pct(v)})` }}
              className={cn(
                'absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-transform duration-150 ease-out',
                'before:absolute before:-inset-2.5',
                dragging === i && 'scale-110',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full bg-surface-4 px-2.5 py-1',
                  'type-caption whitespace-nowrap text-ink tabular-nums shadow-md transition-opacity duration-150 ease-out',
                  showBubble ? 'opacity-100' : 'opacity-0',
                )}
              >
                {text(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Single-thumb slider. Arrows ± step, PageUp/PageDown ± 10%, Home/End. */
export const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
  { min, max, step = 1, value, onChange, format, label, disabled, className },
  ref,
) {
  return (
    <SliderCore
      rootRef={ref}
      min={min}
      max={max}
      step={step}
      values={[value]}
      minGap={0}
      onValues={(v) => onChange(v[0]!)}
      format={format}
      label={label}
      disabled={disabled}
      className={className}
      thumbLabels={['Value']}
    />
  );
});

/** Two thumbs kept at least `minGap` apart. */
export const RangeSlider = forwardRef<HTMLDivElement, RangeSliderProps>(function RangeSlider(
  { min, max, step = 1, value, onChange, format, label, minGap = 0, disabled, className },
  ref,
) {
  return (
    <SliderCore
      rootRef={ref}
      min={min}
      max={max}
      step={step}
      values={[value[0], value[1]]}
      minGap={minGap}
      onValues={(v) => onChange([v[0]!, v[1]!])}
      format={format}
      label={label}
      disabled={disabled}
      className={className}
      thumbLabels={['Minimum', 'Maximum']}
    />
  );
});
