/**
 * Queue views, counts and the item detail (SPEC §5.11, safety §6.2 / §6.3). Everything reads `mod_queue` through
 * `queueVisibleTo` (conflict of interest + legal hold) and serializes through foundation's `serializeQueueItem`;
 * the detail extras are built from `moderation_events`, `reports`, `moderation_actions` and the content adapter.
 *
 * FIREWALL: for anon entity types the author panel is `blindAuthorStanding` (bucketed) and the ladder suggestion
 * quotes a blind bucket, never the exact strike total (rule 5, every role); reporters are never joined to identities
 * for moderators; `history[].note` is scrubbed of handles / ids. On public items the suggestion is computed from the
 * viewer's own standing numbers (`staffStandingFor`), so a moderator cannot diff it against the author panel (rule 2).
 *
 * KNOWN CAP: `held` / `auto_hidden` depend on the live content status, which only the adapter knows (no SQL marker
 * exists for auto-hide). Those two views and their counts therefore scan at most `MAX_CANDIDATES` open rows through
 * the adapter per request — above that the count is reported as the cap. Every other view is pure SQL, and the keyset
 * cursor is part of the `WHERE` for all views, so page N never rescans earlier rows.
 */
import type { ContentEntityType, Id, ModerationCategory, ModerationMatch, ModerationResult, ModerationSeverity, Paginated, Role } from '@shared/core';
import { ANON_ENTITY_TYPES } from '@shared/core';
import type { QueueCounts, QueueListQuery, QueueView, StaffAction, StaffQueueItem, StaffQueueItemDetail } from '@shared/admin';
import { QUEUE_VIEWS } from '@shared/admin';
import { json, prep } from '../../db/index';
import { audit } from '../../lib/audit';
import { DAY, MIN, now } from '../../lib/clock';
import { getContentAdapter, type ContentSnapshot } from '../../lib/content';
import { ApiError, decodeCursor, encodeCursor, type CursorValue } from '../../lib/http';
import { log } from '../../lib/logger';
import {
  anonStrikePoints, blindAuthorStanding, claimQueueItem, getQueueRow, hasAnonWarning, isAnonEntity, queueVisibleTo, releaseQueueItem, resolveAuthorId, serializeQueueItem,
  staffStandingFor, visibleQueueRow, CLAIM_LEASE_MS, STRIKE_POINTS, type BlindBucket, type ModQueueRow,
} from '../../lib/moderation/staff';
import { reporterTrustFor, type ReportRow } from '../../lib/reports';
import { activeStrikePoints, suggestSanction } from '../../lib/sanctions';
import { getUserRow, toUserSummary, type AuthedUser } from '../../lib/users';
import { scrubIdentity } from './common';
import { canUnmaskQueueRow } from './unmask';

const CLOSED_WINDOW_MS = 30 * DAY;
/** Upper bound of open rows the adapter-resolved views (`held`, `auto_hidden`) scan per request — see the header. */
const MAX_CANDIDATES = 2000;

export type QueueFilters = Required<Pick<QueueListQuery, 'view' | 'limit'>> & Omit<QueueListQuery, 'view' | 'limit'>;

/* ───────────────────────────── list ───────────────────────────── */

function viewSql(view: QueueView, staff: AuthedUser, at: number): { sql: string; params: (string | number)[] } {
  switch (view) {
    case 'priority':
      return { sql: "status != 'closed'", params: [] };
    case 'wellbeing':
      return { sql: "status != 'closed' AND label = 'wellbeing'", params: [] };
    case 'held':
    case 'auto_hidden':
      return { sql: "status != 'closed'", params: [] };
    case 'reports':
      return { sql: "status != 'closed' AND (source = 'user_report' OR report_count > 0)", params: [] };
    case 'escalated':
      return { sql: "status = 'escalated'", params: [] };
    case 'appeals':
      return { sql: "status != 'closed' AND source = 'appeal'", params: [] };
    case 'mine':
      return { sql: "status != 'closed' AND claimed_by = ? AND claimed_at > ?", params: [staff.id, at - CLAIM_LEASE_MS] };
    case 'closed':
      return { sql: "status = 'closed' AND closed_at >= ?", params: [at - CLOSED_WINDOW_MS] };
  }
}

/** Views that depend on the live content status resolve it through the adapter (no SQL marker exists for auto-hide). */
function needsContentStatus(view: QueueView): boolean {
  return view === 'held' || view === 'auto_hidden';
}

function matchesContentView(view: QueueView, row: ModQueueRow, contentStatus: StaffQueueItem['contentStatus']): boolean {
  if (view === 'held') return contentStatus === 'held';
  if (view === 'auto_hidden') return contentStatus === 'hidden' || row.source === 'community_score' || row.source === 'ai_flag';
  return true;
}

function keyOf(view: QueueView, row: ModQueueRow): CursorValue {
  if (view === 'closed') return { k: row.closed_at ?? 0, id: row.id };
  return { k: `${row.priority}:${row.created_at}`, id: row.id };
}

/** The keyset seek for the view's ORDER BY, pushed into SQL. A cursor from another view fails its tag check here. */
function cursorSql(view: QueueView, cur: CursorValue | null): { sql: string; params: (string | number)[] } | null {
  if (!cur) return null;
  const bad = (): ApiError => new ApiError(400, 'invalid_cursor', 'Invalid cursor');
  if (view === 'closed') {
    const closedAt = Number(cur.k);
    if (!Number.isFinite(closedAt)) throw bad();
    return { sql: '(closed_at < ? OR (closed_at = ? AND id < ?))', params: [closedAt, closedAt, cur.id] };
  }
  const m = /^(p[0-3]):(\d+)$/.exec(String(cur.k));
  if (!m) throw bad();
  const priority = m[1]!;
  const createdAt = Number(m[2]);
  return {
    sql: '(priority > ? OR (priority = ? AND created_at > ?) OR (priority = ? AND created_at = ? AND id > ?))',
    params: [priority, priority, createdAt, priority, createdAt, cur.id],
  };
}

function candidateStatement(staff: AuthedUser, f: QueueFilters, cur: CursorValue | null, limit: number): { sql: string; params: (string | number)[] } {
  const at = now();
  const vis = queueVisibleTo(staff);
  const view = viewSql(f.view, staff, at);
  const where = [vis.sql, view.sql];
  const params: (string | number)[] = [...vis.params, ...view.params];
  const seek = cursorSql(f.view, cur);
  if (seek) {
    where.push(seek.sql);
    params.push(...seek.params);
  }
  if (f.surface) {
    where.push('surface = ?');
    params.push(f.surface);
  }
  if (f.category) {
    where.push('category = ?');
    params.push(f.category);
  }
  if (f.universityId) {
    where.push('university_id = ?');
    params.push(f.universityId);
  }
  if (f.source) {
    where.push('source = ?');
    params.push(f.source);
  }
  if (f.view === 'closed' && f.q) {
    where.push('id LIKE ?');
    params.push(`${f.q.replace(/[%_]/g, '')}%`);
  }
  const order = f.view === 'closed' ? 'closed_at DESC, id DESC' : 'priority ASC, created_at ASC, id ASC';
  params.push(limit);
  return { sql: `SELECT * FROM mod_queue WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, params };
}

export function listQueue(staff: AuthedUser, f: QueueFilters): Paginated<StaffQueueItem> {
  const cur = decodeCursor(f.cursor);
  const scan = needsContentStatus(f.view);
  // pure-SQL views fetch exactly one page (+1 for the cursor); adapter-resolved views scan up to the cap
  const stmt = candidateStatement(staff, f, cur, scan ? MAX_CANDIDATES : f.limit + 1);
  const out: { key: CursorValue; item: StaffQueueItem }[] = [];
  for (const row of prep(stmt.sql).all(...stmt.params) as ModQueueRow[]) {
    const item = serializeQueueItem(row, staff);
    if (scan && !matchesContentView(f.view, row, item.contentStatus)) continue;
    out.push({ key: keyOf(f.view, row), item });
    if (out.length > f.limit) break;
  }
  const page = out.slice(0, f.limit);
  const last = page[page.length - 1];
  return { items: page.map((p) => p.item), nextCursor: out.length > f.limit && last ? encodeCursor(last.key) : null };
}

export function queueCounts(staff: AuthedUser): QueueCounts {
  const counts = {} as QueueCounts;
  const at = now();
  const vis = queueVisibleTo(staff);
  for (const v of QUEUE_VIEWS) {
    if (needsContentStatus(v.id)) continue;
    const view = viewSql(v.id, staff, at);
    counts[v.id] = (prep(`SELECT COUNT(*) AS n FROM mod_queue WHERE ${vis.sql} AND ${view.sql}`).get(...vis.params, ...view.params) as { n: number }).n;
  }
  // one adapter pass (bounded by MAX_CANDIDATES) serves both content-status views; only the status is loaded, not the whole item
  let held = 0;
  let autoHidden = 0;
  const stmt = candidateStatement(staff, { view: 'priority', limit: MAX_CANDIDATES }, null, MAX_CANDIDATES);
  for (const row of prep(stmt.sql).all(...stmt.params) as ModQueueRow[]) {
    const status = loadSnapshot(row)?.status ?? null;
    if (matchesContentView('held', row, status)) held += 1;
    if (matchesContentView('auto_hidden', row, status)) autoHidden += 1;
  }
  counts.held = held;
  counts.auto_hidden = autoHidden;
  return counts;
}

/* ───────────────────────────── claim / release ───────────────────────────── */

export function claim(id: Id, staff: AuthedUser): StaffQueueItem {
  claimQueueItem(id, staff);
  return serializeQueueItem(getQueueRow(id)!, staff);
}

export function release(id: Id, staff: AuthedUser): StaffQueueItem {
  if (!visibleQueueRow(id, staff)) throw ApiError.notFound();
  releaseQueueItem(id, staff);
  return serializeQueueItem(getQueueRow(id)!, staff);
}

/* ───────────────────────────── detail ───────────────────────────── */

interface EventRow {
  id: Id;
  matches_json: string;
  signals_json: string;
  created_at: number;
}

type MatchWithField = ModerationMatch & { field?: string };

function latestEvent(row: ModQueueRow): EventRow | null {
  if (row.entity_id) {
    return (
      (prep('SELECT id, matches_json, signals_json, created_at FROM moderation_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(
        row.entity_type, row.entity_id,
      ) as EventRow | undefined) ?? null
    );
  }
  if (!row.author_id) return null;
  return (
    (prep(
      `SELECT id, matches_json, signals_json, created_at FROM moderation_events
        WHERE entity_type = ? AND entity_id IS NULL AND author_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1`,
    ).get(row.entity_type, row.author_id, row.created_at - MIN, row.created_at + MIN) as EventRow | undefined) ?? null
  );
}

function loadSnapshot(row: ModQueueRow): ContentSnapshot | null {
  if (!row.entity_id) return null;
  try {
    return getContentAdapter(row.entity_type)?.load(row.entity_id) ?? null;
  } catch (err) {
    log.error('admin detail: adapter load failed', err);
    return null;
  }
}

/** One audit row per staff member, queue item and action per UTC day (the detail is re-fetched often). */
function auditOncePerDay(staff: AuthedUser, action: string, row: ModQueueRow): void {
  const at = now();
  const existing = prep('SELECT 1 FROM audit_log WHERE actor_id = ? AND action = ? AND queue_id = ? AND created_at > ? LIMIT 1').get(staff.id, action, row.id, at - DAY);
  if (existing) return;
  audit({ actor: staff, action, targetType: row.entity_type, targetId: row.entity_id ?? undefined, queueId: row.id });
}

const SUGGESTED_ACTION: Record<string, StaffAction> = {
  warning: 'remove_and_warn',
  removal: 'remove',
  ban: 'ban',
};

const ANON_LIST = (ANON_ENTITY_TYPES as readonly string[]).map(() => '?').join(',');
const ANON_PARAMS: string[] = [...(ANON_ENTITY_TYPES as readonly string[])];

/** Same thresholds as foundation's blind buckets (`blindAuthorStanding`), which it does not export. */
function bucketOf(n: number): BlindBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n <= 5) return '3-5';
  return '6+';
}

/** An unlifted warning on the account; `publicOnly` mirrors `staffStandingFor`'s anon-origin exclusion for moderators. */
function hasActiveWarning(authorId: Id, publicOnly: boolean): boolean {
  if (!publicOnly) return prep("SELECT 1 FROM user_sanctions WHERE user_id = ? AND kind = 'warning' AND lifted_at IS NULL LIMIT 1").get(authorId) !== undefined;
  return (
    prep(
      `SELECT 1 FROM user_sanctions s
         LEFT JOIN moderation_actions ma ON ma.id = s.action_id
         LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
        WHERE s.user_id = ? AND s.kind = 'warning' AND s.lifted_at IS NULL
          AND (s.entity_type IS NULL OR s.entity_type NOT IN (${ANON_LIST}))
          AND (mq.entity_type IS NULL OR mq.entity_type NOT IN (${ANON_LIST}))
        LIMIT 1`,
    ).get(authorId, ...ANON_PARAMS, ...ANON_PARAMS) !== undefined
  );
}

interface SuggestionScope {
  /** Anon entity: the tally is quoted as a blind bucket (rule 5, every role). */
  anon: boolean;
  /** Public entity with a known author: the viewer's own standing number (`staffStandingFor`) so the text agrees with the panel. */
  visibleStrikePoints: number | null;
  /** Public entity viewed by a moderator: prior warnings are public-origin only (rule 2). */
  publicOnly: boolean;
}

function suggestionFor(row: ModQueueRow, authorId: Id | null, hasContent: boolean, scope: SuggestionScope): StaffQueueItemDetail['suggestion'] {
  if (row.source === 'appeal') return null;
  if (row.category === 'self_harm' || row.label === 'wellbeing') return { action: 'approve', reason: 'Wellbeing item: never a sanction. Check in, then approve or dismiss.' };
  if (!row.category) return null;
  const severity: ModerationSeverity = row.severity === 'none' ? 'low' : row.severity;
  // anon (Buzz) items: only the Buzz persona's own anon-origin history counts, for every role — a public warning /
  // strike staff can put on a named account must never move a Buzz suggestion (hypothesis-testing oracle, §3.2 #9)
  const current = scope.visibleStrikePoints ?? (authorId ? (scope.anon ? anonStrikePoints(authorId) : activeStrikePoints(authorId)) : 0);
  const after = current + (STRIKE_POINTS[severity] ?? 1);
  const priorWarning = authorId ? (scope.anon ? hasAnonWarning(authorId) : hasActiveWarning(authorId, scope.publicOnly)) : false;
  const s = suggestSanction(after, priorWarning);
  let action: StaffAction;
  if (s.kind === 'mute') action = s.durationMs === 24 * 60 * MIN ? 'remove_and_mute_24h' : s.durationMs === 72 * 60 * MIN ? 'remove_and_mute_72h' : 'remove_and_mute_7d';
  else if (s.kind === 'suspension') action = s.durationMs === 7 * DAY ? 'suspend_7d' : 'suspend_30d';
  else action = SUGGESTED_ACTION[s.kind] ?? 'remove';
  if (!hasContent && (action === 'remove' || action.startsWith('remove_and'))) action = action === 'remove' ? 'warn_only' : action === 'remove_and_warn' ? 'warn_only' : action;
  const step = s.kind === 'removal' ? 'removal only' : s.kind === 'mute' ? `mute ${s.durationMs === 7 * DAY ? '7 days' : `${(s.durationMs ?? 0) / (60 * MIN)} hours`}` : s.kind === 'suspension' ? `suspension ${(s.durationMs ?? 0) / DAY} days` : s.kind;
  const tally = scope.anon
    ? `Strike points after this violation: ${bucketOf(after)}`
    : `${after} active strike point${after === 1 ? '' : 's'} after this violation`;
  return { action, reason: `${tally} → ${step} (safety ladder).` };
}

function actorRoleOf(raw: string): Role {
  return raw === 'moderator' || raw === 'user' ? raw : 'admin';
}

/**
 * The detail. `afterAction` = the caller just actioned this item: read it without the visibility filter (an escalated
 * item leaves the moderator's queues, but their own response still shows the result) and do not re-claim it.
 */
export function queueDetail(id: Id, staff: AuthedUser, opts: { afterAction?: boolean } = {}): StaffQueueItemDetail {
  const initial = opts.afterAction ? getQueueRow(id) : visibleQueueRow(id, staff);
  if (!initial) throw ApiError.notFound();
  // opening an item claims it for 10 minutes; "being reviewed" by someone else is shown, never thrown
  const at = now();
  const heldByOther = initial.claimed_by !== null && initial.claimed_by !== staff.id && initial.claimed_at !== null && initial.claimed_at + CLAIM_LEASE_MS > at;
  if (initial.status !== 'closed' && initial.status !== 'escalated' && !heldByOther && !opts.afterAction) {
    try {
      claimQueueItem(id, staff);
    } catch (err) {
      log.error('admin detail: claim failed', err);
    }
  }
  const row = getQueueRow(id) ?? initial;
  const base = serializeQueueItem(row, staff);
  const anon = isAnonEntity(row.entity_type);
  const snap = loadSnapshot(row);
  const ev = latestEvent(row);
  const matches = ev ? json<MatchWithField[]>(ev.matches_json, []) : [];

  const fieldsSource: { field: string; text: string }[] = snap ? snap.fields : row.blocked_text ? [{ field: 'body', text: row.blocked_text }] : [];
  const fields = fieldsSource.map((f) => ({
    field: f.field,
    text: f.text,
    spans: matches.filter((m) => (m.field ?? 'body') === f.field && Array.isArray(m.span)).map((m) => [m.span[0], m.span[1]] as [number, number]),
  }));

  const seen = new Set<string>();
  const ruleHits: StaffQueueItemDetail['ruleHits'] = [];
  for (const m of matches) {
    const key = `${m.ruleId}:${m.subcode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ruleHits.push({ ruleId: m.ruleId, category: m.category, subcode: m.subcode, severity: m.severity });
  }
  for (const ruleId of json<string[]>(row.rule_ids_json, [])) {
    if (ruleHits.some((h) => h.ruleId === ruleId) || !row.category) continue;
    ruleHits.push({ ruleId, category: row.category, subcode: 'rule', severity: row.severity });
  }

  let context: unknown = null;
  if (row.entity_id) {
    try {
      context = getContentAdapter(row.entity_type)?.staffContext?.(row.entity_id) ?? null;
    } catch (err) {
      log.error('admin detail: staffContext failed', err);
    }
    if (context && (row.entity_type === 'message' || row.entity_type === 'conversation')) auditOncePerDay(staff, 'dm_context_viewed', row);
  }

  const reportRows = row.entity_id
    ? (prep('SELECT * FROM reports WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 50').all(row.entity_type, row.entity_id) as ReportRow[])
    : [];
  const admin = staff.role === 'admin';
  // reporter identity: admin only, audited — and never on anon entity types (the L1 key walk is binding for every role)
  const revealReporters = admin && !anon;
  if (revealReporters && reportRows.length) auditOncePerDay(staff, 'reporter_viewed', row);
  const reports = reportRows.map((r) => {
    const reporterRow = revealReporters ? getUserRow(r.reporter_id) : null;
    return {
      id: r.id,
      reason: r.reason,
      subReason: r.sub_reason,
      note: anon ? scrubIdentity(r.note) : r.note,
      reporterTrust: reporterTrustFor(r.reporter_id),
      reporter: reporterRow ? toUserSummary(reporterRow) : null,
      createdAt: r.created_at,
    };
  });

  const actionRows = prep(
    `SELECT * FROM moderation_actions WHERE queue_id = ? OR (entity_id IS NOT NULL AND entity_type = ? AND entity_id = ?) ORDER BY created_at ASC, id ASC LIMIT 100`,
  ).all(row.id, row.entity_type, row.entity_id ?? '') as { actor_id: string; actor_role: string; action: string; note: string | null; created_at: number }[];
  // actor names: admins and the actor themselves on public items; role only on anon items (the payload passes the identity walk for every role)
  const history = actionRows.map((a) => {
    const self = a.actor_id === staff.id;
    const name = anon ? null : a.actor_id === 'system' ? 'System' : admin || self ? (getUserRow(a.actor_id)?.display_name ?? 'Staff') : null;
    return { action: a.action, actorRole: actorRoleOf(a.actor_role), actorName: name, note: anon ? scrubIdentity(a.note) : a.note, createdAt: a.created_at };
  });

  const authorId = row.author_id ?? (row.entity_id ? resolveAuthorId(row.entity_type, row.entity_id) : null);
  let author: StaffQueueItemDetail['author'];
  let standing: ReturnType<typeof staffStandingFor> | null = null;
  const authorRow = !anon && authorId ? getUserRow(authorId) : null;
  if (!anon && authorRow) {
    standing = staffStandingFor(authorRow.id, staff.role);
    author = {
      kind: 'public',
      user: toUserSummary(authorRow),
      accountAgeDays: Math.max(0, Math.floor((at - authorRow.created_at) / DAY)),
      strikePoints: standing.strikePoints,
      sanctions: standing.sanctions,
    };
  } else if (authorId) {
    author = { kind: 'blind', ...blindAuthorStanding(authorId, row.id) };
  } else {
    author = { kind: 'blind', accountAge: '30d+', strikePoints: '0', priorByCategory: {}, sanction: null, otherOpenItems: '0' };
  }

  return {
    ...base,
    fields,
    media: snap?.media ?? [],
    ruleHits,
    signals: ev ? json<ModerationResult['signals'] | null>(ev.signals_json, null) : null,
    aiVerdict: json<unknown>(row.ai_verdict_json, null),
    context,
    reports,
    history,
    author,
    suggestion: suggestionFor(row, authorId, snap !== null, { anon, visibleStrikePoints: standing?.strikePoints ?? null, publicOnly: !anon && !admin }),
    // admins on anon items: an entity, or BLOCKED text that is a threat / self-harm risk (polish P6)
    canUnmask: canUnmaskQueueRow(row, staff),
  };
}

export type { ContentEntityType, ModerationCategory };
