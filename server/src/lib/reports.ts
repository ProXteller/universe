/**
 * Reports + auto-hide (SPEC §4.3 #30, safety §3.1–§3.2).                 LANE S-M2a owns this file.
 *
 * - One report per (reporter, entity); a repeat returns the first report (200, `alreadyReported: true`).
 * - 404 when no adapter / `load()` is null; self-report 400; `other` needs a note ≥ 10 chars.
 * - Eligible reporter = account age ≥ 24 h, no active mute / suspension, trust ≠ low, not the author, not blocked
 *   either way with a public author. Weight: high trust 2, normal 1, low 0 (a single high reporter never hides).
 * - Every report upserts the entity's open `mod_queue` item (source `user_report`) and evaluates auto-hide in the
 *   SAME transaction. `self_harm` reports go to P0 (label `wellbeing`) and never hide.
 * - The reported user is never told. Reporter identity is admin-only (staff.ts, S-M3).
 */
import type { ContentEntityType, CreateReportRequest, Id, ModerationPriority, ReportReason } from '@shared/core';
import { ANON_ENTITY_TYPES, REPORT_REASONS } from '@shared/core';
import { newId, prep, tx } from '../db/index';
import { trackEvent } from './analytics';
import { DAY, now } from './clock';
import { getContentAdapter, type ContentSnapshot } from './content';
import { isBlockedBetween } from './graph';
import { ApiError } from './http';
import { log } from './logger';
import { moderateText } from './moderation/index';
import { raisePriority, PRIORITY_RANK } from './moderation/policy';
import { openQueueItemFor, upsertQueueItem } from './moderation/queue';
import { notify } from './notify';
import { enforceRateLimit } from './rateLimit';
import { activeSanctionRows } from './sanctions';
import { soft } from './stub';
import { getUserRow, type AuthedUser } from './users';

export interface ReportRow {
  id: Id;
  reporter_id: Id;
  entity_type: ContentEntityType;
  entity_id: Id;
  reason: ReportReason;
  sub_reason: string | null;
  note: string | null;
  context_json: string | null;
  university_id: Id;
  eligible: number;
  weight: number;
  status: 'open' | 'actioned' | 'dismissed';
  bad_faith: number;
  queue_id: Id | null;
  created_at: number;
  closed_at: number | null;
}

export type ReporterTrust = 'high' | 'normal' | 'low';

/**
 * safety §3.1: `low` when ≥ 3 reports were dismissed in the last 30 days and the confirmed rate is below 20 %;
 * `high` when ≥ 5 confirmed and confirmed rate ≥ 70 %. (staff.ts may re-export this as `reporterTrust`.)
 */
export function reporterTrustFor(userId: Id): ReporterTrust {
  const at = now();
  const all = prep(
    `SELECT status, bad_faith, closed_at FROM reports WHERE reporter_id = ? AND status != 'open'`,
  ).all(userId) as { status: string; bad_faith: number; closed_at: number | null }[];
  const confirmed = all.filter((r) => r.status === 'actioned').length;
  const closed = all.length;
  const rate = closed === 0 ? 0 : confirmed / closed;
  const dismissed30d = all.filter((r) => r.status === 'dismissed' && (r.closed_at ?? 0) > at - 30 * DAY).length;
  const badFaith = all.some((r) => r.bad_faith === 1);
  if (badFaith || (dismissed30d >= 3 && rate < 0.2)) return 'low';
  if (confirmed >= 5 && rate >= 0.7) return 'high';
  return 'normal';
}

const REASON_DEF = new Map(REPORT_REASONS.map((r) => [r.id, r] as const));

function isEligibleReporter(user: AuthedUser, snap: ContentSnapshot, trust: ReporterTrust): boolean {
  if (user.accountAgeMs < DAY) return false;
  if (trust === 'low') return false;
  if (user.id === snap.authorId) return false;
  if (activeSanctionRows(user.id).some((s) => s.kind === 'mute' || s.kind === 'suspension' || s.kind === 'ban')) return false;
  if (!snap.anon && isBlockedBetween(user.id, snap.authorId)) return false;
  return true;
}

function receipt(row: ReportRow, alreadyReported: boolean): import('@shared/core').ReportReceipt {
  return { id: row.id, entityType: row.entity_type, entityId: row.entity_id, reason: row.reason, createdAt: row.created_at, alreadyReported };
}

/**
 * Idempotent (repeat → `alreadyReported: true`); 404 when the adapter / `load()` is null; self-report 400;
 * `other` needs a note ≥ 10; evaluates auto-hide in the same transaction; rate limit `report`.
 */
export function createReport(user: AuthedUser, input: CreateReportRequest): import('@shared/core').ReportReceipt {
  const def = REASON_DEF.get(input.reason);
  if (!def) throw new ApiError(400, 'validation_failed', 'Pick a reason.');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (def.noteRequired && note.length < 10) throw new ApiError(400, 'validation_failed', 'Tell us a bit more (at least 10 characters).');

  const existing = prep('SELECT * FROM reports WHERE reporter_id = ? AND entity_type = ? AND entity_id = ?').get(
    user.id, input.entityType, input.entityId,
  ) as ReportRow | undefined;
  if (existing) return receipt(existing, true);

  const adapter = getContentAdapter(input.entityType);
  const snap = adapter?.load(input.entityId) ?? null;
  if (!snap) throw ApiError.notFound("That content isn't available.");
  if (snap.authorId === user.id) throw ApiError.badRequest("You can't report your own content.");

  enforceRateLimit(user, 'report');
  // the note passes the engine with surface report_note (always allow; signals recorded in the result only)
  if (note) moderateText(note, { surface: 'report_note', userId: user.id, role: user.role, accountType: user.accountType, accountAgeMs: user.accountAgeMs, activeStrikePoints: user.activeStrikePoints, universityId: user.universityId });

  const trust = reporterTrustFor(user.id);
  const eligible = isEligibleReporter(user, snap, trust);
  const weight = !eligible ? 0 : trust === 'high' ? 2 : 1;
  const subReason = (input.entityType === 'market_listing' || input.entityType === 'roommate_listing') && input.reason === 'spam_scam' ? (input.subReason ?? null) : null;
  const includeContext = input.includeContext === true && (input.entityType === 'message' || input.entityType === 'conversation');
  const context = includeContext ? safeContext(adapter, input.entityId) : null;
  const at = now();
  const id = newId();

  const row = tx(() => {
    // priority: reason default; sexual + minor author → P0 (safety §7.7); profile with ≥ 5 reporters / 7 d → P1
    let priority: ModerationPriority = def.priority;
    if (input.reason === 'sexual' && !snap.anon && getUserRow(snap.authorId)?.is_adult === 0) priority = 'p0';
    prep(
      `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, sub_reason, note, context_json, university_id, eligible, weight, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
    ).run(id, user.id, input.entityType, input.entityId, input.reason, subReason, note || null, context ? JSON.stringify(context) : null, snap.universityId, eligible ? 1 : 0, weight, at);

    if (input.entityType === 'profile') {
      const n = (prep('SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE entity_type = ? AND entity_id = ? AND created_at > ?').get(
        'profile', input.entityId, at - 7 * DAY,
      ) as { n: number }).n;
      if (n >= 5 && PRIORITY_RANK[priority] > PRIORITY_RANK.p1) priority = 'p1';
    }

    const queueId = upsertQueueItem({
      entityType: input.entityType, entityId: input.entityId, surface: snap.surface, universityId: snap.universityId, authorId: snap.authorId,
      source: 'user_report', category: def.category, severity: 'none', priority, label: input.reason === 'self_harm' ? 'wellbeing' : null,
      reportDelta: 1, weightDelta: weight,
    });
    prep('UPDATE reports SET queue_id = ? WHERE id = ?').run(queueId, id);
    evaluateAutoHide(input.entityType, input.entityId);
    return prep('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow;
  });

  trackEvent('report_submitted', { userId: user.id, universityId: user.universityId }, { entityType: input.entityType, reason: input.reason });
  return receipt(row, false);
}

function safeContext(adapter: ReturnType<typeof getContentAdapter>, id: Id): unknown {
  try {
    return adapter?.staffContext?.(id) ?? null;
  } catch (err) {
    log.error('report context could not be built', err);
    return null;
  }
}

/* ───────────────────────────── auto-hide (safety §3.2) ───────────────────────────── */

const NEVER_HIDE: ReadonlySet<ContentEntityType> = new Set<ContentEntityType>(['message', 'conversation', 'profile']);
const P0_REASONS: ReadonlySet<ReportReason> = new Set<ReportReason>(['threat', 'minor_safety', 'doxxing']);

function baseThreshold(t: ContentEntityType, allSpam: boolean): number {
  switch (t) {
    case 'buzz':
    case 'buzz_reply':
    case 'orbit_comment':
    case 'reel_comment':
      return 3;
    case 'orbit_post':
    case 'reel':
    case 'event':
      return 5;
    case 'market_listing':
    case 'roommate_listing':
      return allSpam ? 2 : 4;
    default:
      return 5;
  }
}

/** True when the rule engine already flagged the entity (a `rule_flag` queue item or a flag event exists). */
function ruleFlagged(entityType: ContentEntityType, entityId: Id): boolean {
  const q = prep("SELECT 1 FROM mod_queue WHERE entity_type = ? AND entity_id = ? AND source IN ('rule_flag','ai_flag')").get(entityType, entityId);
  if (q) return true;
  return prep("SELECT 1 FROM moderation_events WHERE entity_type = ? AND entity_id = ? AND action = 'flag'").get(entityType, entityId) !== undefined;
}

/**
 * safety §3.2 thresholds over weighted DISTINCT eligible reporters (open reports; weights capped at 2 and at least
 * two distinct reporters so one `high` reporter alone can never hide). `self_harm` never hides; messages,
 * conversations and profiles never hide; immune (staff-approved) items never hide. Hides through the adapter,
 * raises the queue priority one level (never below P1) and notifies the author (N-HIDDEN). Never throws.
 */
export function evaluateAutoHide(entityType: ContentEntityType, entityId: Id): void {
  try {
    if (NEVER_HIDE.has(entityType)) return;
    const adapter = getContentAdapter(entityType);
    const snap = adapter?.load(entityId) ?? null;
    if (!adapter || !snap || snap.status !== 'active' || snap.autoHideImmune) return;

    const rows = prep(
      `SELECT reporter_id, reason, weight FROM reports WHERE entity_type = ? AND entity_id = ? AND status = 'open' AND eligible = 1 AND weight > 0`,
    ).all(entityType, entityId) as { reporter_id: Id; reason: ReportReason; weight: number }[];
    const counted = rows.filter((r) => r.reason !== 'self_harm');
    const distinct = new Map<Id, { weight: number; reason: ReportReason }>();
    for (const r of counted) {
      const prev = distinct.get(r.reporter_id);
      if (!prev || prev.weight < r.weight) distinct.set(r.reporter_id, { weight: Math.min(2, r.weight), reason: r.reason });
    }
    if (distinct.size < 2) return;
    const weighted = [...distinct.values()].reduce((n, r) => n + r.weight, 0);
    const p0Weighted = [...distinct.values()].filter((r) => P0_REASONS.has(r.reason)).reduce((n, r) => n + r.weight, 0);
    const allSpam = [...distinct.values()].every((r) => r.reason === 'spam_scam');
    let threshold = baseThreshold(entityType, allSpam);
    if (ruleFlagged(entityType, entityId)) threshold = Math.max(2, threshold - 1);
    const hide = weighted >= threshold || p0Weighted >= 2;
    if (!hide) return;

    adapter.setStatus(entityId, 'hidden');
    const item = openQueueItemFor(entityType, entityId);
    if (item) {
      const raised = raisePriority(item.priority);
      const next: ModerationPriority = PRIORITY_RANK[raised] > PRIORITY_RANK.p1 ? 'p1' : raised;
      prep('UPDATE mod_queue SET priority = ? WHERE id = ?').run(next, item.id);
    }
    // N-HIDDEN to the author only (their own text; for anon types the row still carries no actor)
    const excerpt = snap.fields.map((f) => f.text).join(' ').trim().slice(0, 140);
    soft(() =>
      notify({
        userId: snap.authorId, type: 'mod.content_hidden', actorId: null, href: '/settings/account-status',
        target: { entityType, entityId }, collapse: false,
        data: { label: snap.label, excerpt, category: null, sanctionId: null, anon: ANON_ENTITY_TYPES.includes(entityType) },
      }),
    );
  } catch (err) {
    log.error('evaluateAutoHide failed', err);
  }
}
