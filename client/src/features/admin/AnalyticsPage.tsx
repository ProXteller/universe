/**
 * Analytics (product §2.11, safety §6.7): growth tiles with inline-SVG sparklines, the Apartments engagement funnel
 * (Constitution §0.6 — T1), and the moderation metrics. Buzz numbers are aggregates only.
 */
import { useMemo, useState, type FC } from 'react';
import { ChartBar } from 'lucide-react';
import type { ModerationPriority } from '@shared/core';
import type { AnalyticsQuery, ModerationMetrics } from '@shared/admin';
import { SANCTION_KIND_LABELS, UNMASK_REASON_LABELS } from '@shared/admin';
import { Card, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { formatCount } from '@/lib/format';
import { useFunnel, useMetrics, useOverview } from './api';
import { FunnelBars, KeyValue, PRIORITY_TONE, Section, Sparkline, StatTile } from './parts';
import { AdminShell } from './shell';

type Range = '7d' | '30d' | '90d';
const RANGE_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const satisfies readonly { value: Range; label: string }[];
const DAY = 24 * 60 * 60_000;
const RANGE_MS: Record<Range, number> = { '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
const PRIORITIES: ModerationPriority[] = ['p0', 'p1', 'p2', 'p3'];
/** Static class map (Tailwind cannot emit computed class names). */
const TONE_BG: Record<string, string> = { danger: 'bg-danger-soft', warning: 'bg-warning-soft', info: 'bg-info-soft', neutral: 'bg-surface-3' };

const TileSkeleton: FC = () => (
  <Card variant="raised" className="flex flex-col gap-2 p-3">
    <Skeleton w={70} h={12} />
    <Skeleton w={90} h={28} />
    <Skeleton w="100%" h={32} />
  </Card>
);

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`);
const mins = (v: number | null): string => (v === null ? '—' : v >= 120 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`);

export const AnalyticsPage: FC = () => {
  const [range, setRange] = useState<Range>('30d');
  // `from` is anchored to the hour so the query key stays stable across renders
  const query: AnalyticsQuery = useMemo(() => {
    const to = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return { from: to - RANGE_MS[range], to };
  }, [range]);
  useScreenView('admin_analytics', { range });
  const overview = useOverview(query);
  const funnel = useFunnel(query);
  const metrics = useMetrics(query);

  const o = overview.data;
  const f = funnel.data;
  const m = metrics.data;
  const signups = o?.signupsByCampus.reduce((n, x) => n + x.count, 0) ?? 0;
  const noData = o && signups === 0 && o.dau.every((d) => d.count === 0) && o.contentPerDay.length === 0;
  const contentByDay = useMemo(() => {
    if (!o) return [];
    const byDay = new Map<string, number>();
    for (const d of o.dau) byDay.set(d.day, 0);
    for (const c of o.contentPerDay) byDay.set(c.day, (byDay.get(c.day) ?? 0) + c.count);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, n]) => n);
  }, [o]);

  return (
    <AdminShell tab="analytics">
      <div className="px-4">
        <SegmentedControl<Range> value={range} onChange={setRange} options={RANGE_OPTIONS} fullWidth size="sm" aria-label="Date range" />
      </div>

      <Section title="Growth" className="px-4">
        {overview.isLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <TileSkeleton key={i} />
            ))}
          </div>
        ) : overview.isError || !o ? (
          <ErrorState title="Couldn't load analytics" error={overview.error} onRetry={() => void overview.refetch()} inline />
        ) : noData ? (
          <EmptyState icon={ChartBar} title="Not enough data yet. Charts appear after the first day of activity." compact />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Sign-ups" value={formatCount(signups)} hint={o.signupsByCampus[0] ? `${o.signupsByCampus[0].universityShortName} leads` : undefined} />
            <StatTile label="Weekly active" value={formatCount(o.wau)} hint="last 7 days of range" />
            <StatTile label="Daily active" value={formatCount(o.dau[o.dau.length - 1]?.count ?? 0)} hint="today">
              <Sparkline points={o.dau.map((d) => d.count)} label="Daily active users" />
            </StatTile>
            <StatTile label="Content / day" value={formatCount(contentByDay[contentByDay.length - 1] ?? 0)} hint="reels, posts, events, buzzes">
              <Sparkline points={contentByDay} label="Content per day" />
            </StatTile>
            <StatTile label="Activation" value={pct(o.activationRate)} hint="new accounts that did something" />
            <StatTile label="Reports / 1k" value={String(o.reportsPer1k)} hint="per 1,000 items" />
            <StatTile label="Time to action" value={mins(o.medianTimeToActionMin)} hint="median, first staff action" />
            <Card variant="raised" className="flex flex-col gap-1 p-3">
              <span className="type-caption text-ink-3">Sign-ups by campus</span>
              <KeyValue rows={o.signupsByCampus.slice(0, 5).map((c) => ({ k: c.universityShortName, v: String(c.count) }))} />
            </Card>
          </div>
        )}
      </Section>

      <Section title="Apartments funnel" hint="Constitution §0.6" className="px-4">
        {funnel.isLoading ? (
          <TileSkeleton />
        ) : funnel.isError || !f ? (
          <ErrorState title="Couldn't load the funnel" error={funnel.error} onRetry={() => void funnel.refetch()} inline />
        ) : f.totals.views === 0 && f.totals.waitlist === 0 ? (
          <EmptyState icon={ChartBar} title="Not enough data yet. Charts appear after the first day of activity." compact />
        ) : (
          <Card variant="raised" className="flex flex-col gap-3 p-3">
            <FunnelBars
              rows={[
                { label: 'Views', value: f.totals.views },
                { label: 'Get-notified taps', value: f.totals.ctaClicks },
                { label: 'Survey started', value: f.totals.surveyStarts },
                { label: 'Survey completed', value: f.totals.surveyCompletes },
              ]}
            />
            <div className="type-footnote text-ink-2">
              <span className="text-ink">{f.totals.waitlist.toLocaleString()}</span> on the waitlist right now
            </div>
            {f.byCampus.length > 1 ? (
              <KeyValue rows={f.byCampus.slice(0, 6).map((c) => ({ k: c.universityShortName, v: `${c.views} views · ${c.ctaClicks} taps · ${c.surveyCompletes} surveys · ${c.waitlist} waiting` }))} />
            ) : null}
          </Card>
        )}
      </Section>

      <Section title="Moderation" hint="safety §6.7" className="px-4">
        {metrics.isLoading ? (
          <TileSkeleton />
        ) : metrics.isError || !m ? (
          <ErrorState title="Couldn't load moderation metrics" error={metrics.error} onRetry={() => void metrics.refetch()} inline />
        ) : (
          <ModerationBlock m={m} />
        )}
      </Section>
    </AdminShell>
  );
};

const ModerationBlock: FC<{ m: ModerationMetrics }> = ({ m }) => {
  const open = PRIORITIES.reduce((n, p) => n + m.openByPriority[p], 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Open items" value={String(open)} hint={m.oldestOpenMin === null ? 'queue clear' : `oldest ${mins(m.oldestOpenMin)}`}>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {PRIORITIES.map((p) => (
              <span key={p} className={`rounded-xs px-1.5 py-0.5 type-micro ${m.openByPriority[p] ? `${TONE_BG[PRIORITY_TONE[p]] ?? 'bg-surface-3'} text-ink` : 'bg-surface-2 text-ink-3'}`}>
                {p.toUpperCase()} {m.openByPriority[p]}
              </span>
            ))}
          </div>
        </StatTile>
        <StatTile label="Wellbeing / week" value={String(m.wellbeingPerWeek)} hint="P0 self-harm items" />
        <StatTile label="Appeal overturn" value={pct(m.appealOverturnRate)} hint="reversed or reduced" />
        <StatTile label="Auto-hide reversal" value={`${pct(m.autoHideReversalRate.reports)} · ${pct(m.autoHideReversalRate.score)}`} hint="reports · score" />
      </div>
      <Card variant="raised" className="p-3">
        <div className="mb-2 type-caption text-ink-3">Time to first action vs SLA</div>
        <KeyValue rows={PRIORITIES.map((p) => ({ k: p.toUpperCase(), v: `median ${mins(m.timeToFirstAction[p].medianMin)} · p90 ${mins(m.timeToFirstAction[p].p90Min)} · SLA ${mins(m.timeToFirstAction[p].slaMin)}` }))} />
      </Card>
      <Card variant="raised" className="p-3">
        <div className="mb-2 type-caption text-ink-3">Active sanctions · unmasks by reason</div>
        <KeyValue
          rows={[
            ...(['warning', 'mute', 'suspension', 'ban'] as const).map((k) => ({ k: SANCTION_KIND_LABELS[k], v: String(m.activeSanctions[k]) })),
            ...Object.entries(m.unmasksByReason).map(([code, n]) => ({ k: `Unmask · ${UNMASK_REASON_LABELS[code as keyof typeof UNMASK_REASON_LABELS] ?? code}`, v: String(n) })),
          ]}
        />
      </Card>
      {m.rulePrecision.length ? (
        <Card variant="raised" className="p-3">
          <div className="mb-2 type-caption text-ink-3">Rule precision (closed items)</div>
          <KeyValue rows={m.rulePrecision.slice(0, 8).map((r) => ({ k: r.ruleId, v: `${r.flagged} flagged · ${r.removed} removed · ${r.approved} approved` }))} />
        </Card>
      ) : null}
    </div>
  );
};
