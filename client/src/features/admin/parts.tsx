/**
 * Shared admin composites: labels, severity rail cards, the incognito excerpt frame (Buzz text without an avatar),
 * highlighted spans, stat tiles, inline-SVG sparklines, funnel bars, the Limitations panel. Utilitarian: denser type,
 * no hero gradients (design §7.10).
 */
import { useEffect, useState, type FC, type ReactNode } from 'react';
import { Flag, ShieldAlert, VenetianMask } from 'lucide-react';
import type { ModerationCategory, ModerationPriority, ModerationSeverity, ModerationSurface, Role } from '@shared/core';
import { CATEGORY_LABELS } from '@shared/core';
import type { LIMITATIONS, StaffQueueItem } from '@shared/admin';
import { Badge, Card, Skeleton, SkeletonText, Surface, type BadgeTone } from '@/ui';
import { TimeAgo } from '@/components';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { routes } from '@/lib/links';

export const PRIORITY_TONE: Record<ModerationPriority, BadgeTone> = { p0: 'danger', p1: 'warning', p2: 'info', p3: 'neutral' };
export const SEVERITY_RAIL: Record<ModerationSeverity, string> = {
  none: 'border-l-line-strong', low: 'border-l-info', medium: 'border-l-warning', high: 'border-l-danger', critical: 'border-l-danger',
};
export const SURFACE_LABEL: Record<ModerationSurface, string> = {
  buzz: 'Buzz', buzz_reply: 'Buzz reply', buzz_poll: 'Buzz poll', orbit_post: 'Orbit post', comment: 'Comment', reel_caption: 'Reel', event: 'Event',
  profile: 'Profile', handle: 'Handle', group_name: 'Group name', market_listing: 'Listing', roommate_listing: 'Roommate post', message: 'Message',
  group_message: 'Group message', report_note: 'Report note', appeal: 'Appeal',
};
export const SOURCE_LABEL: Record<string, string> = {
  rule_flag: 'Rule flag', rule_block_escalation: 'Blocked + escalated', ai_flag: 'AI flag', user_report: 'Reports', community_score: 'Community score',
  appeal: 'Appeal', system: 'System',
};
export const ROLE_TONE: Record<Role, BadgeTone> = { user: 'neutral', moderator: 'info', admin: 'gold' };

export function categoryLabel(c: ModerationCategory | null): string {
  return c ? CATEGORY_LABELS[c] : 'Uncategorised';
}

/** Ticks every `ms` so countdowns re-render; returns the current time. */
export function useNowTick(ms = 30_000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
}

/** `**bold**` segments of the guideline / notice copy. */
export const Rich: FC<{ text: string; className?: string }> = ({ text, className }) => {
  const parts = text.split('**');
  return (
    <span className={className}>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{p}</strong> : <span key={i}>{p}</span>))}
    </span>
  );
};

/* ------------------------------------------------------------------ excerpts */

export interface ExcerptBlockProps {
  text: string;
  anon: boolean;
  /** Buzz context alias (from the adapter's blind serializer) — a label only, never an avatar. */
  aliasLabel?: string | null;
  spans?: [number, number][];
  className?: string;
}

export const HighlightedText: FC<{ text: string; spans?: [number, number][] }> = ({ text, spans }) => {
  if (!spans || spans.length === 0) return <>{text}</>;
  const sorted = [...spans].filter(([a, b]) => a >= 0 && b > a && a < text.length).sort((x, y) => x[0] - y[0]);
  const out: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([a, b], i) => {
    const start = Math.max(a, cursor);
    const end = Math.min(b, text.length);
    if (start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    if (end > start) out.push(<mark key={`m${i}`} className="rounded-xs bg-warning-soft px-0.5 text-ink">{text.slice(start, end)}</mark>);
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
};

/** Buzz excerpts sit inside a nested incognito chip-frame: mask glyph + optional alias label, never an avatar. */
export const ExcerptBlock: FC<ExcerptBlockProps> = ({ text, anon, aliasLabel, spans, className }) => {
  const body = text.trim() ? <HighlightedText text={text} spans={spans} /> : <span className="text-ink-3">(no text)</span>;
  if (anon) {
    return (
      <Surface mode="incognito" className={cn('rounded-md border border-line p-3', className)}>
        <div className="flex items-start gap-2">
          <VenetianMask className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            {aliasLabel ? <div className="type-caption text-ink-3">{aliasLabel}</div> : null}
            <p className="type-footnote whitespace-pre-wrap break-words text-ink">{body}</p>
          </div>
        </div>
      </Surface>
    );
  }
  return (
    <blockquote className={cn('rounded-md bg-surface-2 p-3 type-footnote whitespace-pre-wrap break-words text-ink', className)}>{body}</blockquote>
  );
};

/* ------------------------------------------------------------------ queue cards */

export const SlaChip: FC<{ item: StaffQueueItem }> = ({ item }) => {
  const nowMs = useNowTick();
  if (item.status === 'closed') return null;
  const left = item.slaDueAt - nowMs;
  const overdue = left <= 0;
  return (
    <Badge variant="soft" tone={overdue ? 'danger' : item.priority === 'p0' ? 'warning' : 'neutral'}>
      {overdue ? `SLA overdue ${formatDuration(-left)}` : `SLA ${formatDuration(left)}`}
    </Badge>
  );
};

export const StatusChip: FC<{ item: StaffQueueItem }> = ({ item }) => {
  if (item.status === 'closed') return <Badge variant="outline" tone={item.resolution === 'approved' || item.resolution === 'dismissed' ? 'success' : 'neutral'}>{item.resolution ?? 'closed'}</Badge>;
  if (item.status === 'escalated') return <Badge variant="soft" tone="warning">Escalated</Badge>;
  if (item.claimedByOther) return <Badge variant="soft" tone="info">Being reviewed</Badge>;
  if (item.claimedByMe) return <Badge variant="soft" tone="accent">Yours</Badge>;
  return null;
};

export interface QueueCardProps {
  item: StaffQueueItem;
  selecting?: boolean;
  selected?: boolean;
  onToggle?(): void;
}

export const QueueCard: FC<QueueCardProps> = ({ item, selecting, selected, onToggle }) => {
  const inner = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selecting ? (
          <span className={cn('inline-flex size-5 items-center justify-center rounded-xs border', selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong')} aria-hidden>
            {selected ? '✓' : ''}
          </span>
        ) : null}
        <Badge variant="soft" tone={PRIORITY_TONE[item.priority]}>{item.priority.toUpperCase()}</Badge>
        <Badge variant="outline">{SURFACE_LABEL[item.surface]}</Badge>
        {item.label === 'wellbeing' ? <Badge variant="soft" tone="info">Wellbeing</Badge> : null}
        {item.category ? <span className="type-caption text-ink-2">{categoryLabel(item.category)}</span> : null}
        <span className="ml-auto type-caption text-ink-3">
          <TimeAgo ts={item.createdAt} />
        </span>
      </div>
      <ExcerptBlock text={item.excerpt} anon={item.anon} />
      <div className="flex flex-wrap items-center gap-1.5 type-caption text-ink-3">
        <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
        {item.reportCount > 0 ? (
          <Badge variant="soft" tone="neutral">
            <Flag className="mr-1 size-3" aria-hidden />
            {item.reportCount} {item.reportCount === 1 ? 'report' : 'reports'}
          </Badge>
        ) : null}
        {item.contentStatus && item.contentStatus !== 'active' ? <Badge variant="outline" tone="warning">{item.contentStatus}</Badge> : null}
        <span className="ml-auto flex items-center gap-1.5">
          <SlaChip item={item} />
          <StatusChip item={item} />
        </span>
      </div>
    </div>
  );
  const cls = cn('border-l-[3px] p-3', SEVERITY_RAIL[item.severity], selected ? 'ring-1 ring-accent-line' : '');
  if (selecting) {
    return (
      <Card className={cls} onClick={onToggle} aria-label={selected ? 'Deselect item' : 'Select item'}>
        {inner}
      </Card>
    );
  }
  return (
    <Card className={cls} to={routes.adminQueueItem(item.id)}>
      {inner}
    </Card>
  );
};

export const QueueCardSkeleton: FC = () => (
  <Card className="border-l-[3px] border-l-line p-3">
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Skeleton w={36} h={18} />
        <Skeleton w={64} h={18} />
        <Skeleton w={90} h={14} className="ml-auto" />
      </div>
      <div className="rounded-md bg-surface-2 p-3">
        <SkeletonText lines={2} />
      </div>
      <div className="flex gap-2">
        <Skeleton w={70} h={14} />
        <Skeleton w={50} h={14} className="ml-auto" />
      </div>
    </div>
  </Card>
);

export const RowSkeleton: FC<{ lines?: number }> = ({ lines = 2 }) => (
  <Card className="p-3">
    <SkeletonText lines={lines} />
  </Card>
);

/* ------------------------------------------------------------------ sections + stats */

export const Section: FC<{ title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }> = ({ title, hint, action, children, className }) => (
  <section className={cn('flex flex-col gap-2', className)}>
    <div className="flex items-center gap-2 px-1">
      <h2 className="type-label text-ink">{title}</h2>
      {hint ? <span className="type-caption text-ink-3">{hint}</span> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
    {children}
  </section>
);

export const KeyValue: FC<{ rows: { k: string; v: ReactNode }[] }> = ({ rows }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 type-footnote">
    {rows.map((r) => (
      <div key={r.k} className="contents">
        <dt className="text-ink-3">{r.k}</dt>
        <dd className="min-w-0 break-words text-ink">{r.v}</dd>
      </div>
    ))}
  </dl>
);

export const StatTile: FC<{ label: string; value: string; hint?: string; children?: ReactNode }> = ({ label, value, hint, children }) => (
  <Card variant="raised" className="flex flex-col gap-1 p-3">
    <span className="type-caption text-ink-3">{label}</span>
    <span className="type-title-1 tabular-nums text-ink">{value}</span>
    {hint ? <span className="type-caption text-ink-2">{hint}</span> : null}
    {children}
  </Card>
);

/** Inline SVG sparkline (no chart library; design §7.10). */
export const Sparkline: FC<{ points: number[]; className?: string; label?: string }> = ({ points, className, label }) => {
  const n = points.length;
  if (n < 2) return <div className={cn('h-8', className)} aria-hidden />;
  const max = Math.max(1, ...points);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (n - 1)) * 100).toFixed(2)},${(30 - (p / max) * 28).toFixed(2)}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('h-8 w-full text-accent-ink', className)} role="img" aria-label={label ?? 'Trend'}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

export const FunnelBars: FC<{ rows: { label: string; value: number }[] }> = ({ rows }) => {
  const top = Math.max(1, rows[0]?.value ?? 0);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const pct = Math.round((r.value / top) * 100);
        return (
          <div key={r.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between type-footnote">
              <span className="text-ink-2">{r.label}</span>
              <span className="tabular-nums text-ink">
                {r.value.toLocaleString()} <span className="text-ink-3">· {pct}%</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${r.label}: ${pct} percent`}>
              <div className="h-2 rounded-full bg-hero" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const LimitationsPanel: FC<{ items: typeof LIMITATIONS }> = ({ items }) => (
  <Section title="Known limitations" hint="safety §8.3">
    <div className="flex flex-col gap-2">
      {items.map((l) => (
        <Card key={l.id} className="p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 type-micro font-mono text-ink-2">{l.id}</span>
            <div className="min-w-0">
              <h3 className="type-label-sm text-ink">{l.title}</h3>
              <p className="mt-1 type-footnote text-ink-2">{l.body}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  </Section>
);

export const BlindNote: FC = () => (
  <div className="flex items-start gap-2 rounded-md bg-info-soft p-3 type-footnote text-ink-2">
    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
    <span>Anonymous surface. You are acting on the author of this item; the server resolves the account and never shows it here.</span>
  </div>
);
