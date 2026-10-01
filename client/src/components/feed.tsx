/**
 * Feed helpers shared by Reels / Buzz / Orbit / Market / Roommates: CampusScopeToggle, ColdStartBanner, SafetyCard.
 */
import { forwardRef, useState } from 'react';
import { ChevronDown, Globe, Info, School, ShieldAlert, X } from 'lucide-react';
import type { FeedScope } from '@shared/core';
import { Button, IconButton, SegmentedControl } from '@/ui';
import { cn } from '@/lib/cn';

export interface CampusScopeToggleProps {
  value: FeedScope;
  onChange(v: FeedScope): void;
  size?: 'sm' | 'md';
  className?: string;
}

export const CampusScopeToggle = forwardRef<HTMLDivElement, CampusScopeToggleProps>(function CampusScopeToggle(
  { value, onChange, size = 'sm', className },
  ref,
) {
  return (
    <SegmentedControl<FeedScope>
      ref={ref}
      aria-label="Feed scope"
      size={size}
      value={value}
      onChange={onChange}
      options={[
        { value: 'campus', label: 'Campus', icon: School },
        { value: 'global', label: 'Global', icon: Globe },
      ]}
      className={className}
    />
  );
});

export interface ColdStartBannerProps {
  universityName: string;
  onDismiss(): void;
  onPost(): void;
  className?: string;
}

/** SPEC §1 rule 1: "{university} is just getting started — showing Global." + [Post the first one]. */
export const ColdStartBanner = forwardRef<HTMLDivElement, ColdStartBannerProps>(function ColdStartBanner(
  { universityName, onDismiss, onPost, className },
  ref,
) {
  return (
    <div
      ref={ref}
      role="status"
      className={cn('mx-4 flex items-center gap-3 rounded-lg border border-accent-line bg-hero-soft px-3.5 py-2.5', className)}
    >
      <p className="min-w-0 flex-1 type-footnote text-ink">
        {universityName} is just getting started — showing Global.
      </p>
      <Button size="sm" variant="secondary" onClick={onPost} className="shrink-0">
        Post the first one
      </Button>
      <IconButton icon={X} aria-label="Dismiss" size="sm" onClick={onDismiss} className="-mr-1 shrink-0" />
    </div>
  );
});

export interface SafetyCardProps {
  title: string;
  points: string[];
  /** Open by default for the first 3 views (counted in localStorage under this key). */
  storageKey: string;
  tone?: 'warning' | 'info';
  className?: string;
}

function bumpViews(key: string): number {
  try {
    const n = Number(localStorage.getItem(key) ?? '0') + 1;
    localStorage.setItem(key, String(n));
    return n;
  } catch {
    return 1;
  }
}

/** Collapsible safety tips (Marketplace meetups, roommate safety). */
export const SafetyCard = forwardRef<HTMLDivElement, SafetyCardProps>(function SafetyCard(
  { title, points, storageKey, tone = 'info', className },
  ref,
) {
  const [open, setOpen] = useState(() => bumpViews(storageKey) <= 3);
  const Icon = tone === 'warning' ? ShieldAlert : Info;
  return (
    <div
      ref={ref}
      className={cn(
        'mx-4 overflow-hidden rounded-lg border',
        tone === 'warning' ? 'border-warning/45 bg-warning-soft' : 'border-info/45 bg-info-soft',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full items-center gap-2.5 px-3.5 text-left"
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden className={tone === 'warning' ? 'text-warning' : 'text-info'} />
        <span className="min-w-0 flex-1 truncate type-label-sm text-ink">{title}</span>
        <ChevronDown size={18} strokeWidth={1.75} aria-hidden className={cn('text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5 px-3.5 pb-3.5 pl-10">
          {points.map((p) => (
            <li key={p} className="list-disc type-footnote text-ink-2">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
