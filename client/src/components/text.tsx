/**
 * Small text composites: CountLabel, TimeAgo, SectionHeader.
 */
import { forwardRef, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { EpochMs } from '@shared/core';
import { Button } from '@/ui';
import { cn } from '@/lib/cn';
import { formatCount, formatDayTime, timeAgo } from '@/lib/format';

export interface CountLabelProps {
  value: number;
  className?: string;
}

/** Compact number ("1.2K"), tabular. */
export const CountLabel = forwardRef<HTMLSpanElement, CountLabelProps>(function CountLabel({ value, className }, ref) {
  return (
    <span ref={ref} className={cn('tabular-nums', className)} aria-label={`${value}`}>
      {formatCount(value)}
    </span>
  );
});

export interface TimeAgoProps {
  ts: EpochMs;
  className?: string;
}

/** Live-updating relative time ("3m") with the full date/time in `title`. */
export const TimeAgo = forwardRef<HTMLTimeElement, TimeAgoProps>(function TimeAgo({ ts, className }, ref) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const age = Date.now() - ts;
    if (age > 24 * 3_600_000) return;
    const every = age < 3_600_000 ? 30_000 : 300_000;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [ts]);
  return (
    <time ref={ref} dateTime={new Date(ts).toISOString()} title={formatDayTime(ts)} className={cn('tabular-nums', className)}>
      {timeAgo(ts, now)}
    </time>
  );
});

export interface SectionHeaderProps {
  title: string;
  action?: { label: string; to?: string; onClick?(): void };
  className?: string;
}

/** `type-title-3` + optional trailing "See all" link. */
export const SectionHeader = forwardRef<HTMLDivElement, SectionHeaderProps>(function SectionHeader({ title, action, className }, ref) {
  return (
    <div ref={ref} className={cn('flex min-h-11 items-center justify-between gap-3 px-4', className)}>
      <h2 className="truncate type-title-3 text-ink">{title}</h2>
      {action ? (
        <Button variant="ghost" size="sm" rightIcon={ChevronRight} to={action.to} onClick={action.onClick} className="-mr-2 text-accent-ink hover:text-accent-ink">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
});
