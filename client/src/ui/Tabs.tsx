import { useEffect, useId, useRef, type KeyboardEvent, type Ref } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { prefersReducedMotion, spring, useReducedMotionPref } from '@/lib/motion';
import { useMergedRef } from './overlay';
import { edgeMaskStyle, useScrollEdges } from './useScrollEdges';

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly { value: T; label: string; count?: number }[];
  /** More than ~4 tabs: one scrolling row (`scroll-x`) instead of equal columns. */
  scrollable?: boolean;
  /** Sticks under the PageHeader bar (`--safe-top` + `--topbar-h`) with a canvas background. */
  sticky?: boolean;
  'aria-label'?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Underline tabs for in-page sections with different content. `role="tablist"`, ←/→/Home/End with automatic
 * activation. Panels are the caller's: give them `role="tabpanel"` if they are not the whole rest of the page.
 */
export function Tabs<const T extends string>({ value, onChange, tabs, scrollable = false, sticky = false, 'aria-label': ariaLabel, className, ref }: TabsProps<T>) {
  const uid = useId();
  const reduced = useReducedMotionPref();
  const list = useRef<HTMLDivElement | null>(null);
  const setRef = useMergedRef(ref, list);
  const edges = useScrollEdges(list, scrollable);

  // Keep the active tab in view in a scrolling row (horizontal only: scrollIntoView would also move the page).
  useEffect(() => {
    const row = list.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!scrollable || !row || !el) return;
    const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    const max = row.scrollWidth - row.clientWidth;
    const target = Math.max(0, Math.min(max, left));
    if (Math.abs(row.scrollLeft - target) < 2) return;
    row.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [value, scrollable]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.value === value);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      className={cn('border-b border-line-subtle bg-canvas', sticky && 'sticky z-(--z-sticky)', className)}
      style={sticky ? { top: 'calc(var(--safe-top) + var(--topbar-h))' } : undefined}
    >
      <div
        ref={setRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        style={scrollable ? edgeMaskStyle(edges) : undefined}
        className={cn('flex', scrollable ? 'scroll-x gap-1 px-2' : 'px-0')}
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`tab-${uid}-${tab.value}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (!active) onChange(tab.value);
              }}
              className={cn(
                'relative flex h-12 shrink-0 items-center justify-center gap-1.5 px-3 type-label whitespace-nowrap transition-colors duration-150 ease-out',
                !scrollable && 'min-w-0 flex-1',
                active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <span className="relative flex h-full items-center gap-1.5">
                <span className="truncate">{tab.label}</span>
                {tab.count !== undefined ? (
                  <span className={cn('type-caption tabular-nums', active ? 'text-ink-2' : 'text-ink-3')}>{tab.count}</span>
                ) : null}
                {active ? (
                  <motion.span
                    layoutId={`tabs-${uid}`}
                    aria-hidden
                    transition={reduced ? { duration: 0 } : spring.snappy}
                    className="absolute inset-x-0 -bottom-px h-0.5 min-w-6 rounded-full bg-accent"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
