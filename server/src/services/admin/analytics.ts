/**
 * Growth, Apartments funnel and moderation metrics (SPEC §5.11, safety §6.7, product §2.11). Reads only
 * `analytics_events`, `waitlist`, `users`, `universities`, `public_activity` and the moderation tables. Buzz numbers
 * are aggregates of anonymous events (user_id NULL) and are never broken down by user.
 */
import type { Id, ModerationPriority, SanctionKind } from '@shared/core';
import type { AnalyticsOverview, AnalyticsQuery, ApartmentsFunnel, ModerationMetrics } from '@shared/admin';
import { json, prep } from '../../db/index';
import { DAY, MIN, now } from '../../lib/clock';
import { SLA_MS } from '../../lib/moderation/staff';
import { dayKey, median, percentile, round1 } from './common';

const DEFAULT_RANGE_MS = 30 * DAY;
const MAX_RANGE_MS = 365 * DAY;
const PRIORITIES: ModerationPriority[] = ['p0', 'p1', 'p2', 'p3'];
const ACTIVATION_EVENTS = ['post_create', 'reel_upload', 'message_send', 'listing_create', 'event_rsvp', 'roommate_profile_publish', 'follow', 'course_join', 'listing_offer', 'reel_like', 'post_like'];

export interface Range {
  from: number;
  to: number;
}

export function resolveRange(q: AnalyticsQuery): Range {
  const at = now();
  const to = typeof q.to === 'number' ? Math.min(q.to, at) : at;
  let from = typeof q.from === 'number' ? q.from : to - DEFAULT_RANGE_MS;
  if (from > to) from = to - DEFAULT_RANGE_MS;
  if (to - from > MAX_RANGE_MS) from = to - MAX_RANGE_MS;
  return { from, to };
}

function uniFilter(col: string, universityId: Id | undefined): { sql: string; params: string[] } {
  return universityId ? { sql: ` AND ${col} = ?`, params: [universityId] } : { sql: '', params: [] };
}

function dayRange(r: Range): string[] {
  const days: string[] = [];
  for (let d = Math.floor(r.from / DAY) * DAY; d <= r.to; d += DAY) days.push(dayKey(d));
  return days;
}

export function overview(q: AnalyticsQuery): AnalyticsOverview {
  const r = resolveRange(q);
  const uniUsers = uniFilter('u.university_id', q.universityId);
  const uniEvents = uniFilter('e.university_id', q.universityId);

  const signupsByCampus = (prep(
    `SELECT un.short_name AS universityShortName, COUNT(*) AS count FROM users u JOIN universities un ON un.id = u.university_id
      WHERE u.created_at BETWEEN ? AND ? AND u.status != 'deleted' AND un.is_hidden = 0${uniUsers.sql}
      GROUP BY un.id ORDER BY count DESC, un.short_name ASC LIMIT 12`,
  ).all(r.from, r.to, ...uniUsers.params) as { universityShortName: string; count: number }[]);

  const dauRows = prep(
    `SELECT CAST(e.created_at / ${DAY} AS INTEGER) AS d, COUNT(DISTINCT e.user_id) AS n FROM analytics_events e
      WHERE e.user_id IS NOT NULL AND e.created_at BETWEEN ? AND ?${uniEvents.sql} GROUP BY d`,
  ).all(r.from, r.to, ...uniEvents.params) as { d: number; n: number }[];
  const dauMap = new Map(dauRows.map((x) => [dayKey(x.d * DAY), x.n]));
  const dau = dayRange(r).map((day) => ({ day, count: dauMap.get(day) ?? 0 }));

  const wau = (prep(
    `SELECT COUNT(*) AS n FROM users u WHERE u.status = 'active' AND u.last_active_at >= ? AND u.last_active_at <= ?${uniUsers.sql}`,
  ).get(r.to - 7 * DAY, r.to, ...uniUsers.params) as { n: number }).n;

  const signups = (prep(
    `SELECT COUNT(*) AS n FROM users u JOIN universities un ON un.id = u.university_id
      WHERE u.created_at BETWEEN ? AND ? AND u.status != 'deleted' AND un.is_hidden = 0${uniUsers.sql}`,
  ).get(r.from, r.to, ...uniUsers.params) as { n: number }).n;
  const activated = signups
    ? (prep(
        `SELECT COUNT(*) AS n FROM users u JOIN universities un ON un.id = u.university_id
          WHERE u.created_at BETWEEN ? AND ? AND u.status != 'deleted' AND un.is_hidden = 0${uniUsers.sql}
            AND (EXISTS (SELECT 1 FROM public_activity pa WHERE pa.user_id = u.id)
              OR EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = u.id AND e.name IN (${ACTIVATION_EVENTS.map(() => '?').join(',')})))`,
      ).get(r.from, r.to, ...uniUsers.params, ...ACTIVATION_EVENTS) as { n: number }).n
    : 0;

  const uniPa = uniFilter('pa.university_id', q.universityId);
  const contentRows = prep(
    `SELECT CAST(pa.created_at / ${DAY} AS INTEGER) AS d, pa.kind AS surface, COUNT(*) AS n FROM public_activity pa
      WHERE pa.created_at BETWEEN ? AND ?${uniPa.sql} GROUP BY d, pa.kind`,
  ).all(r.from, r.to, ...uniPa.params) as { d: number; surface: string; n: number }[];
  const buzzRows = prep(
    `SELECT CAST(e.created_at / ${DAY} AS INTEGER) AS d, COUNT(*) AS n FROM analytics_events e
      WHERE e.name = 'buzz_post' AND e.created_at BETWEEN ? AND ?${uniEvents.sql} GROUP BY d`,
  ).all(r.from, r.to, ...uniEvents.params) as { d: number; n: number }[];
  const contentPerDay = [
    ...contentRows.map((x) => ({ day: dayKey(x.d * DAY), surface: x.surface === 'post' ? 'orbit' : x.surface === 'reel' ? 'reels' : 'events', count: x.n })),
    ...buzzRows.map((x) => ({ day: dayKey(x.d * DAY), surface: 'buzz', count: x.n })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.surface.localeCompare(b.surface));
  const contentTotal = contentPerDay.reduce((n, x) => n + x.count, 0);

  const uniReports = uniFilter('rp.university_id', q.universityId);
  const reportCount = (prep(`SELECT COUNT(*) AS n FROM reports rp WHERE rp.created_at BETWEEN ? AND ?${uniReports.sql}`).get(r.from, r.to, ...uniReports.params) as { n: number }).n;
  const reportsPer1k = contentTotal > 0 ? round1((reportCount / contentTotal) * 1000) : 0;

  const uniQueue = uniFilter('mq.university_id', q.universityId);
  const tta = (prep(
    `SELECT (mq.first_action_at - mq.created_at) AS ms FROM mod_queue mq WHERE mq.first_action_at IS NOT NULL AND mq.created_at BETWEEN ? AND ?${uniQueue.sql}`,
  ).all(r.from, r.to, ...uniQueue.params) as { ms: number }[]).map((x) => x.ms / MIN);
  const med = median(tta);

  return {
    range: r,
    signupsByCampus,
    dau,
    wau,
    activationRate: signups > 0 ? round1((activated / signups) * 100) / 100 : 0,
    contentPerDay,
    reportsPer1k,
    medianTimeToActionMin: med === null ? null : round1(med),
  };
}

export function apartmentsFunnel(q: AnalyticsQuery): ApartmentsFunnel {
  const r = resolveRange(q);
  const uniEvents = uniFilter('e.university_id', q.universityId);
  const rows = prep(
    `SELECT un.short_name AS uni, e.name AS name, COUNT(*) AS n FROM analytics_events e JOIN universities un ON un.id = e.university_id
      WHERE e.name IN ('apartments.page_view','apartments.cta_click','apartments.survey_start','apartments.survey_complete')
        AND e.created_at BETWEEN ? AND ?${uniEvents.sql} GROUP BY un.id, e.name`,
  ).all(r.from, r.to, ...uniEvents.params) as { uni: string; name: string; n: number }[];
  const uniWait = uniFilter('w.university_id', q.universityId);
  const waitRows = prep(
    `SELECT un.short_name AS uni, COUNT(*) AS n FROM waitlist w JOIN universities un ON un.id = w.university_id
      WHERE w.feature = 'apartments' AND w.left_at IS NULL${uniWait.sql} GROUP BY un.id`,
  ).all(...uniWait.params) as { uni: string; n: number }[];

  const byUni = new Map<string, ApartmentsFunnel['byCampus'][number]>();
  const entry = (uni: string): ApartmentsFunnel['byCampus'][number] => {
    let e = byUni.get(uni);
    if (!e) {
      e = { universityShortName: uni, views: 0, ctaClicks: 0, surveyStarts: 0, surveyCompletes: 0, waitlist: 0 };
      byUni.set(uni, e);
    }
    return e;
  };
  for (const x of rows) {
    const e = entry(x.uni);
    if (x.name === 'apartments.page_view') e.views += x.n;
    else if (x.name === 'apartments.cta_click') e.ctaClicks += x.n;
    else if (x.name === 'apartments.survey_start') e.surveyStarts += x.n;
    else if (x.name === 'apartments.survey_complete') e.surveyCompletes += x.n;
  }
  for (const x of waitRows) entry(x.uni).waitlist += x.n;
  const byCampus = [...byUni.values()].sort((a, b) => b.views - a.views || a.universityShortName.localeCompare(b.universityShortName));
  const totals = byCampus.reduce(
    (t, e) => ({ views: t.views + e.views, ctaClicks: t.ctaClicks + e.ctaClicks, surveyStarts: t.surveyStarts + e.surveyStarts, surveyCompletes: t.surveyCompletes + e.surveyCompletes, waitlist: t.waitlist + e.waitlist }),
    { views: 0, ctaClicks: 0, surveyStarts: 0, surveyCompletes: 0, waitlist: 0 },
  );
  return { byCampus, totals };
}

export function moderationMetrics(q: AnalyticsQuery): ModerationMetrics {
  const r = resolveRange(q);
  const at = now();
  const uniQueue = uniFilter('mq.university_id', q.universityId);

  const openByPriority = { p0: 0, p1: 0, p2: 0, p3: 0 } as Record<ModerationPriority, number>;
  for (const x of prep(`SELECT mq.priority AS p, COUNT(*) AS n FROM mod_queue mq WHERE mq.status != 'closed'${uniQueue.sql} GROUP BY mq.priority`).all(...uniQueue.params) as { p: ModerationPriority; n: number }[]) {
    openByPriority[x.p] = x.n;
  }
  const oldest = prep(`SELECT MIN(mq.created_at) AS t FROM mod_queue mq WHERE mq.status != 'closed'${uniQueue.sql}`).get(...uniQueue.params) as { t: number | null };
  const oldestOpenMin = oldest.t === null ? null : Math.round((at - oldest.t) / MIN);

  const timeToFirstAction = {} as ModerationMetrics['timeToFirstAction'];
  for (const p of PRIORITIES) {
    const mins = (prep(
      `SELECT (mq.first_action_at - mq.created_at) AS ms FROM mod_queue mq WHERE mq.priority = ? AND mq.first_action_at IS NOT NULL AND mq.created_at BETWEEN ? AND ?${uniQueue.sql}`,
    ).all(p, r.from, r.to, ...uniQueue.params) as { ms: number }[]).map((x) => x.ms / MIN);
    const med = median(mins);
    const p90 = percentile(mins, 90);
    timeToFirstAction[p] = { medianMin: med === null ? null : round1(med), p90Min: p90 === null ? null : round1(p90), slaMin: SLA_MS[p] / MIN };
  }

  const closed = prep(
    `SELECT mq.rule_ids_json AS rules, mq.resolution AS resolution, mq.source AS source, mq.report_count AS reports FROM mod_queue mq
      WHERE mq.status = 'closed' AND mq.closed_at BETWEEN ? AND ?${uniQueue.sql}`,
  ).all(r.from, r.to, ...uniQueue.params) as { rules: string; resolution: string | null; source: string; reports: number }[];
  const precision = new Map<string, { flagged: number; removed: number; approved: number }>();
  let reportsApproved = 0;
  let reportsActioned = 0;
  let scoreApproved = 0;
  let scoreActioned = 0;
  for (const c of closed) {
    const removed = c.resolution === 'removed' || c.resolution === 'sanctioned';
    const approved = c.resolution === 'approved';
    for (const ruleId of json<string[]>(c.rules, [])) {
      const e = precision.get(ruleId) ?? { flagged: 0, removed: 0, approved: 0 };
      e.flagged += 1;
      if (removed) e.removed += 1;
      if (approved) e.approved += 1;
      precision.set(ruleId, e);
    }
    if (c.source === 'user_report' && c.reports >= 2) {
      if (approved) reportsApproved += 1;
      if (removed) reportsActioned += 1;
    }
    if (c.source === 'community_score') {
      if (approved) scoreApproved += 1;
      if (removed) scoreActioned += 1;
    }
  }
  const rulePrecision = [...precision.entries()].map(([ruleId, e]) => ({ ruleId, ...e })).sort((a, b) => b.flagged - a.flagged).slice(0, 40);
  const rate = (a: number, b: number): number | null => (a + b > 0 ? round1((a / (a + b)) * 100) / 100 : null);

  const appeals = prep("SELECT status, COUNT(*) AS n FROM appeals WHERE status != 'open' AND decided_at BETWEEN ? AND ? GROUP BY status").all(r.from, r.to) as { status: string; n: number }[];
  const decided = appeals.reduce((n, x) => n + x.n, 0);
  const overturned = appeals.filter((x) => x.status === 'reversed' || x.status === 'reduced').reduce((n, x) => n + x.n, 0);

  const activeSanctions = { warning: 0, mute: 0, suspension: 0, ban: 0 } as Record<SanctionKind, number>;
  for (const x of prep(
    `SELECT kind, COUNT(*) AS n FROM user_sanctions WHERE kind IN ('warning','mute','suspension','ban') AND lifted_at IS NULL
       AND (ends_at IS NULL OR ends_at > ?) AND (kind != 'warning' OR (acknowledged_at IS NULL AND created_at > ?)) GROUP BY kind`,
  ).all(at, at - 30 * DAY) as { kind: SanctionKind; n: number }[]) {
    activeSanctions[x.kind] = x.n;
  }

  const unmasksByReason: Record<string, number> = {};
  for (const x of prep("SELECT COALESCE(reason_code, 'unspecified') AS code, COUNT(*) AS n FROM audit_log WHERE action = 'buzz_unmask' AND created_at BETWEEN ? AND ? GROUP BY code").all(r.from, r.to) as { code: string; n: number }[]) {
    unmasksByReason[x.code] = x.n;
  }
  const wellbeingPerWeek = (prep(`SELECT COUNT(*) AS n FROM mod_queue mq WHERE mq.label = 'wellbeing' AND mq.created_at > ?${uniQueue.sql}`).get(at - 7 * DAY, ...uniQueue.params) as { n: number }).n;

  return {
    openByPriority,
    oldestOpenMin,
    timeToFirstAction,
    rulePrecision,
    appealOverturnRate: decided > 0 ? round1((overturned / decided) * 100) / 100 : null,
    autoHideReversalRate: { reports: rate(reportsApproved, reportsActioned), score: rate(scoreApproved, scoreActioned) },
    activeSanctions,
    unmasksByReason,
    wellbeingPerWeek,
  };
}
