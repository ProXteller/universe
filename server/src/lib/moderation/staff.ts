/**
 * Staff write path to the core moderation tables (SPEC §4.2.14, safety §4 / §6).   LANE S-M3 owns this file.
 *
 * The admin slice is the designated writer of `mod_queue`, `reports.status`, `moderation_actions`, `strikes`,
 * `user_sanctions`, `appeals` and `audit_log` — through the helpers here (R2).
 *
 * FIREWALL (anon-origin rule, SPEC §4.2.14): a sanction, strike, queue item, moderation action or audit row is
 * *anon-origin* when its entity_type ∈ ANON_ENTITY_TYPES (or its queue_id points at such an item). No payload that
 * names a user may let staff connect that user to Buzz content except the unmask endpoint:
 *  1. `StaffSanctionRowCore` = `SanctionNotice` without contentExcerpt / contentLabel, plus `origin`.
 *  2. `staffStandingFor(userId, role)`: for non-admins anon-origin sanctions and strikes are omitted and excluded from
 *     `strikePoints` / `openQueueItems` / `status`; for admins they are present with `origin:'anon'`, day-floored
 *     timestamps and a SEALED id (`sealStaffSanctionId`) that cannot be joined with entity-targeted audit metadata.
 *  3. `recordAction` / `applySanction` / `addStrike` on an anon-origin item write `audit_log` / `moderation_actions`
 *     with the ENTITY as target; `moderation_actions.target_user_id` is server-internal. No `target_type:'user'` row.
 *  4. `serializeAuditRow`: `targetId` is null for `target_type='user'` rows tied to an anon-origin queue item unless
 *     the viewer is admin AND action = 'buzz_unmask'; metadata is stripped for moderators on `buzz_unmask`.
 *  5. `blindAuthorStanding` stays bucketed for every role and reads anon-origin rows only (no public-origin oracle).
 * `StaffQueueItemCore` has NO author / reporter / user field of any kind, for any entity type.
 */
import crypto from 'node:crypto';
import type {
  ContentEntityType, ContentStatus, EpochMs, Id, ModerationCategory, ModerationPriority, ModerationSeverity,
  ModerationSurface, PublicNotificationType, Role, SanctionKind, SanctionNotice, SanctionScope,
} from '@shared/core';
import { ANON_ENTITY_TYPES } from '@shared/core';
import { json, newId, prep, tx } from '../../db/index';
import { audit, type AuditLogRow } from '../audit';
import { DAY, HOUR, MIN, now } from '../clock';
import { getContentAdapter, runUserLifecycleHooks, type ContentSnapshot } from '../content';
import { ApiError, sealValue, unsealValue } from '../http';
import { log } from '../logger';
import { notify } from '../notify';
import { revokeUserSockets } from '../realtime';
import { reporterTrustFor } from '../reports';
import {
  activeSanctionRows, activeStrikePoints, getSanctionRow, MUTE_24H_MS, SUSPENSION_7D_MS, toSanctionNotice, type UserSanctionRow,
} from '../sanctions';
import { revokeAllSessions } from '../sessions';
import { getUniversityRow } from '../universities';
import { getAuthedUser, getUserRow, type AuthedUser, type UserRow } from '../users';
import type { QueueRow } from './queue';

export type { AuditLogRow } from '../audit';

/* ───────────────────────────── types ───────────────────────────── */

/** EXACTLY the fields of `StaffQueueItem` (shared/src/admin.ts, SPEC §5.11) and nothing else. */
export interface StaffQueueItemCore {
  id: Id;
  entityType: ContentEntityType;
  entityId: Id | null;
  surface: ModerationSurface;
  anon: boolean;
  universityShortName: string;
  source: string;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label: string | null;
  status: 'open' | 'claimed' | 'escalated' | 'closed';
  resolution: string | null;
  reportCount: number;
  /** ≤ 140 chars from adapter.load().fields, or blocked_text, else ''. */
  excerpt: string;
  /** adapter.load()?.status ?? null */
  contentStatus: ContentStatus | null;
  claimedByMe: boolean;
  claimedByOther: boolean;
  slaDueAt: EpochMs;
  createdAt: EpochMs;
  closedAt: EpochMs | null;
}

/** `SanctionNotice` WITHOUT contentExcerpt / contentLabel, plus origin (rule 1). */
export interface StaffSanctionRowCore extends Omit<SanctionNotice, 'contentExcerpt' | 'contentLabel'> {
  origin: 'public' | 'anon';
}

/** Structurally identical to `AuditRow` (shared/src/admin.ts, SPEC §5.11). */
export interface AuditRowCore {
  id: Id;
  actor: { id: Id; displayName: string; role: Role } | null;
  action: string;
  targetType: string | null;
  /** null for targetType 'user' rows tied to an anon-origin queue item, except action 'buzz_unmask' for admins (rule 4). */
  targetId: Id | null;
  queueId: Id | null;
  batchId: Id | null;
  reasonCode: string | null;
  reason: string | null;
  /** Stripped for moderators on buzz_unmask. */
  metadata: Record<string, unknown> | null;
  createdAt: EpochMs;
}

/** Raw `mod_queue` row (same shape as `QueueRow` of ./queue). */
export type ModQueueRow = QueueRow;

export type BlindBucket = '0' | '1' | '2' | '3-5' | '6+';

export interface BlindAuthorStanding {
  accountAge: '<24h' | '<7d' | '<30d' | '30d+';
  strikePoints: BlindBucket;
  priorByCategory: Record<string, string>;
  sanction: SanctionKind | null;
  otherOpenItems: BlindBucket;
}

export interface RecordActionInput {
  queueId?: Id | null;
  entityType: ContentEntityType;
  entityId: Id | null;
  /** Filled for enforcement; server-internal and never serialized for anon-origin rows (rule 3). */
  targetUserId?: Id | null;
  actor: AuthedUser | 'system';
  action: string;
  category?: ModerationCategory | null;
  note?: string | null;
  batchId?: Id | null;
  sanctionId?: Id | null;
  reasonCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplySanctionInput {
  userId: Id;
  kind: SanctionKind;
  durationMs?: number;
  scope?: SanctionScope;
  category: ModerationCategory | null;
  entity?: { entityType: ContentEntityType; entityId: Id };
  actor: AuthedUser | 'system';
  actionId?: Id;
  /** Force / suppress the random 5–30 min `effective_at` delay (default: anon-origin warnings and mutes on non-P0 items). */
  delayed?: boolean;
}

export interface ModerationActionRow {
  id: Id;
  queue_id: Id | null;
  entity_type: ContentEntityType;
  entity_id: Id | null;
  target_user_id: Id | null;
  actor_id: string;
  actor_role: string;
  action: string;
  category: ModerationCategory | null;
  note: string | null;
  batch_id: Id | null;
  sanction_id: Id | null;
  created_at: EpochMs;
}

/* ───────────────────────────── constants ───────────────────────────── */

/** Queue priority targets (safety §3.3 "SLA"): P0 1 h · P1 12 h · P2 24 h · P3 72 h. */
export const SLA_MS: Record<ModerationPriority, number> = { p0: HOUR, p1: 12 * HOUR, p2: 24 * HOUR, p3: 72 * HOUR };
/** A claim auto-releases after 10 minutes (safety §6.2). */
export const CLAIM_LEASE_MS = 10 * MIN;
/** Strike points per confirmed severity (safety §2.5); `none` counts as a confirmed low violation. */
export const STRIKE_POINTS: Record<ModerationSeverity, number> = { none: 1, low: 1, medium: 2, high: 3, critical: 5 };
/** Strike expiry (safety §4.2): low / medium 90 d, high 180 d, critical never. */
export const STRIKE_TTL_MS: Record<ModerationSeverity, number | null> = { none: 90 * DAY, low: 90 * DAY, medium: 90 * DAY, high: 180 * DAY, critical: null };
/** "Treated as new" for 72 h after a suspension is lifted (safety §3.4). */
export const POST_SUSPENSION_RESTRICTION_MS = 72 * HOUR;
const ANON_DELAY_MIN_MS = 5 * MIN;
const ANON_DELAY_MAX_MS = 30 * MIN;
const EXCERPT_MAX = 140;
const SANCTION_HREF = '/settings/account-status';
/** Metadata keys that could name a user; stripped from anon-origin audit / action metadata. */
const IDENTITY_META_KEYS: readonly string[] = ['userId', 'user_id', 'targetUserId', 'target_user_id', 'authorId', 'author_id', 'handle', 'email', 'displayName', 'name'];

/* ───────────────────────────── helpers ───────────────────────────── */

export function isAnonEntity(t: string | null | undefined): boolean {
  return !!t && (ANON_ENTITY_TYPES as readonly string[]).includes(t);
}

export function getQueueRow(id: Id): ModQueueRow | null {
  return (prep('SELECT * FROM mod_queue WHERE id = ?').get(id) as ModQueueRow | undefined) ?? null;
}

export function getModerationAction(id: Id): ModerationActionRow | null {
  return (prep('SELECT * FROM moderation_actions WHERE id = ?').get(id) as ModerationActionRow | undefined) ?? null;
}

/** True when the queue item's entity type is anonymous (Buzz). Unknown ids → false. */
export function isAnonQueueItem(queueId: Id | null | undefined): boolean {
  if (!queueId) return false;
  const row = prep('SELECT entity_type FROM mod_queue WHERE id = ?').get(queueId) as { entity_type: string } | undefined;
  return isAnonEntity(row?.entity_type);
}

function loadSnapshot(entityType: ContentEntityType, entityId: Id | null): ContentSnapshot | null {
  if (!entityId) return null;
  try {
    return getContentAdapter(entityType)?.load(entityId) ?? null;
  } catch (err) {
    log.error(`content adapter "${entityType}".load failed`, err);
    return null;
  }
}

function excerptOf(snap: ContentSnapshot | null, fallback: string | null = null): string {
  const text = snap ? snap.fields.map((f) => f.text).join(' ') : (fallback ?? '');
  return text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
}

function bucket(n: number): BlindBucket {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n <= 5) return '3-5';
  return '6+';
}

function floorDay(t: EpochMs | null): EpochMs | null {
  return t === null ? null : Math.floor(t / DAY) * DAY;
}

function stripIdentityMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) if (!IDENTITY_META_KEYS.includes(k)) out[k] = v;
  return out;
}

function emailHash(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

function leaseLive(row: Pick<ModQueueRow, 'claimed_by' | 'claimed_at' | 'status'>, at: EpochMs = now()): boolean {
  return row.status !== 'closed' && row.claimed_by !== null && row.claimed_at !== null && row.claimed_at + CLAIM_LEASE_MS > at;
}

/** Latest queue item (open first, else most recent) for an entity — used to derive a category / priority. */
function latestQueueItemFor(entityType: ContentEntityType, entityId: Id): ModQueueRow | null {
  return (
    (prep(
      `SELECT * FROM mod_queue WHERE entity_type = ? AND entity_id = ?
        ORDER BY CASE WHEN status != 'closed' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    ).get(entityType, entityId) as ModQueueRow | undefined) ?? null
  );
}

/* ───────────────────────────── queue ───────────────────────────── */

/** No author fields for ANON_ENTITY_TYPES — for ANY role (there is no author field for any type). */
export function serializeQueueItem(row: ModQueueRow, viewer: AuthedUser): StaffQueueItemCore {
  const at = now();
  const snap = loadSnapshot(row.entity_type, row.entity_id);
  const uni = getUniversityRow(row.university_id);
  const claimed = leaseLive(row, at);
  const status: StaffQueueItemCore['status'] = row.status === 'claimed' && !claimed ? 'open' : row.status;
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    surface: row.surface,
    anon: isAnonEntity(row.entity_type),
    universityShortName: uni?.short_name ?? 'Campus',
    source: row.source,
    category: row.category,
    severity: row.severity,
    priority: row.priority,
    label: row.label,
    status,
    resolution: row.resolution,
    reportCount: row.report_count,
    excerpt: excerptOf(snap, row.blocked_text),
    contentStatus: snap?.status ?? null,
    claimedByMe: claimed && row.claimed_by === viewer.id,
    claimedByOther: claimed && row.claimed_by !== viewer.id,
    slaDueAt: row.created_at + (SLA_MS[row.priority] ?? SLA_MS.p3),
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

const ANON_SQL_LIST = (ANON_ENTITY_TYPES as readonly string[]).map(() => '?').join(',');
const ANON_SQL_PARAMS: string[] = [...(ANON_ENTITY_TYPES as readonly string[])];

/**
 * SQL predicate "this strike / sanction row is anon-origin" over a row aliased `alias` that is LEFT JOINed to
 * `moderation_actions ma` (on `alias.action_id`) and `mod_queue mq` (on `ma.queue_id`).
 */
function anonOriginSql(alias: string): { sql: string; params: string[] } {
  return {
    sql: `(${alias}.entity_type IN (${ANON_SQL_LIST}) OR mq.entity_type IN (${ANON_SQL_LIST}))`,
    params: [...ANON_SQL_PARAMS, ...ANON_SQL_PARAMS],
  };
}

/** Active strike points of ANON-ORIGIN strikes only (the Buzz persona's own history; blind panel / Buzz ladder). */
export function anonStrikePoints(userId: Id, at: EpochMs = now()): number {
  const anon = anonOriginSql('st');
  return (prep(
    `SELECT COALESCE(SUM(st.points), 0) AS points FROM strikes st
       LEFT JOIN moderation_actions ma ON ma.id = st.action_id
       LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
      WHERE st.user_id = ? AND st.revoked_at IS NULL AND (st.expires_at IS NULL OR st.expires_at > ?) AND ${anon.sql}`,
  ).get(userId, at, ...anon.params) as { points: number }).points;
}

/** An unlifted ANON-ORIGIN warning (Buzz ladder suggestion). */
export function hasAnonWarning(userId: Id): boolean {
  const anon = anonOriginSql('s');
  return (
    prep(
      `SELECT 1 FROM user_sanctions s
         LEFT JOIN moderation_actions ma ON ma.id = s.action_id
         LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
        WHERE s.user_id = ? AND s.kind = 'warning' AND s.lifted_at IS NULL AND ${anon.sql}
        LIMIT 1`,
    ).get(userId, ...anon.params) !== undefined
  );
}

/**
 * Bucketed standing for anon queue items — for every role (rule 5). Built ONLY from anon-origin rows (the Buzz
 * persona's own history): nothing a staff member can see or change on a named account (a direct public mute /
 * warning, a public queue item, public strikes) may move this panel, or it becomes a hypothesis-testing oracle.
 * `otherOpenItems` counts the author's other open anon queue items except `currentQueueId` (when given).
 */
export function blindAuthorStanding(authorId: Id, currentQueueId?: Id): BlindAuthorStanding {
  const at = now();
  const user = getUserRow(authorId);
  const age = user ? at - user.created_at : Number.POSITIVE_INFINITY;
  const accountAge: BlindAuthorStanding['accountAge'] = age < DAY ? '<24h' : age < 7 * DAY ? '<7d' : age < 30 * DAY ? '<30d' : '30d+';
  const anonStrike = anonOriginSql('st');
  const byCategory = prep(
    `SELECT st.category AS category, COUNT(*) AS n FROM strikes st
       LEFT JOIN moderation_actions ma ON ma.id = st.action_id
       LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
      WHERE st.user_id = ? AND st.revoked_at IS NULL AND (st.expires_at IS NULL OR st.expires_at > ?) AND ${anonStrike.sql}
      GROUP BY st.category`,
  ).all(authorId, at, ...anonStrike.params) as { category: string; n: number }[];
  const priorByCategory: Record<string, string> = {};
  for (const r of byCategory) priorByCategory[r.category] = bucket(r.n);
  const open = (prep(
    `SELECT COUNT(*) AS n FROM mod_queue WHERE author_id = ? AND status != 'closed' AND id != ? AND entity_type IN (${ANON_SQL_LIST})`,
  ).get(authorId, currentQueueId ?? '', ...ANON_SQL_PARAMS) as { n: number }).n;
  const anonSanction = anonOriginSql('s');
  const sanctions = prep(
    `SELECT s.* FROM user_sanctions s
       LEFT JOIN moderation_actions ma ON ma.id = s.action_id
       LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
      WHERE s.user_id = ? AND s.kind IN ('mute','suspension','ban') AND s.lifted_at IS NULL
        AND s.effective_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?) AND ${anonSanction.sql}`,
  ).all(authorId, at, at, ...anonSanction.params) as UserSanctionRow[];
  const RANK: Record<string, number> = { ban: 3, suspension: 2, mute: 1 };
  const top = sanctions.sort((a, b) => (RANK[b.kind] ?? 0) - (RANK[a.kind] ?? 0))[0];
  return {
    accountAge,
    strikePoints: bucket(anonStrikePoints(authorId, at)),
    priorByCategory,
    sanction: (top?.kind as SanctionKind | undefined) ?? null,
    otherOpenItems: bucket(open),
  };
}

/**
 * Conflict-of-interest + legal-hold filter to AND into a query whose FROM is `mod_queue` (bare column names — do not
 * alias the table): never items the staff member authored, reported or is a DM participant in; legal-hold and
 * escalated items only for admins (safety §6.1, §6.4, §6.5).
 */
export function queueVisibleTo(staff: AuthedUser): { sql: string; params: (string | number)[] } {
  const parts = [
    '(author_id IS NULL OR author_id != ?)',
    "NOT ((entity_type || ':' || COALESCE(entity_id, '')) IN (SELECT rp.entity_type || ':' || rp.entity_id FROM reports rp WHERE rp.reporter_id = ?))",
    "NOT (entity_type = 'conversation' AND entity_id IN (SELECT cm.conversation_id FROM conversation_members cm WHERE cm.user_id = ?))",
    "NOT (entity_type = 'message' AND entity_id IN (SELECT m.id FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE cm.user_id = ?))",
  ];
  const params: (string | number)[] = [staff.id, staff.id, staff.id, staff.id];
  if (staff.role !== 'admin') {
    parts.push('legal_hold = 0');
    parts.push("status != 'escalated'");
  }
  return { sql: `(${parts.join(' AND ')})`, params };
}

/** The queue row when it exists AND `queueVisibleTo(staff)` admits it; null otherwise (callers answer 404). */
export function visibleQueueRow(id: Id, staff: AuthedUser): ModQueueRow | null {
  const vis = queueVisibleTo(staff);
  return (prep(`SELECT * FROM mod_queue WHERE id = ? AND ${vis.sql}`).get(id, ...vis.params) as ModQueueRow | undefined) ?? null;
}

/** 10-minute lease. 404 when invisible (conflict of interest), 409 when closed or held by someone else. */
export function claimQueueItem(id: Id, staff: AuthedUser): void {
  const row = visibleQueueRow(id, staff);
  if (!row) throw ApiError.notFound();
  if (row.status === 'closed') throw ApiError.conflict('This item is closed.');
  const at = now();
  if (leaseLive(row, at) && row.claimed_by !== staff.id) throw ApiError.conflict('Being reviewed by another staff member.');
  prep(
    `UPDATE mod_queue SET claimed_by = ?, claimed_at = ?, status = CASE WHEN status = 'open' THEN 'claimed' ELSE status END WHERE id = ?`,
  ).run(staff.id, at, id);
}

/** Releases a claim held by `staff` (admins and expired leases release anyone's). */
export function releaseQueueItem(id: Id, staff: AuthedUser): void {
  const row = getQueueRow(id);
  if (!row) throw ApiError.notFound();
  if (row.claimed_by === null) return;
  if (row.claimed_by !== staff.id && staff.role !== 'admin' && leaseLive(row)) {
    throw ApiError.conflict('Being reviewed by another staff member.');
  }
  prep(
    `UPDATE mod_queue SET claimed_by = NULL, claimed_at = NULL, status = CASE WHEN status = 'claimed' THEN 'open' ELSE status END WHERE id = ?`,
  ).run(id);
}

/* ───────────────────────────── content ───────────────────────────── */

const STATUS_NOTICE: Record<'hidden' | 'removed' | 'active', PublicNotificationType> = {
  hidden: 'mod.content_hidden', removed: 'mod.content_removed', active: 'mod.content_restored',
};

/**
 * Adapter `setStatus` + author notification `mod.content_hidden` / `_removed` / `_restored` (data: `label`, `excerpt`,
 * `category`, `sanctionId`). `category` falls back to the entity's latest queue item. 404 when there is no adapter or
 * the entity is gone. `active` on an already-active item (approve → immune) sends nothing.
 */
export function applyContentStatus(
  entityType: ContentEntityType,
  entityId: Id,
  status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>,
  opts: { immune?: boolean; category?: ModerationCategory | null; sanctionId?: Id | null } = {},
): void {
  const adapter = getContentAdapter(entityType);
  if (!adapter) throw ApiError.notFound("That content isn't available.");
  const before = adapter.load(entityId);
  if (!before) throw ApiError.notFound("That content isn't available.");
  adapter.setStatus(entityId, status, opts.immune !== undefined ? { immune: opts.immune } : undefined);

  let type: PublicNotificationType | null = null;
  if (status === 'active') type = before.status === 'hidden' || before.status === 'removed' ? STATUS_NOTICE.active : null;
  else if (status !== before.status) type = STATUS_NOTICE[status];
  if (!type) return;
  const category = opts.category !== undefined ? opts.category : (latestQueueItemFor(entityType, entityId)?.category ?? null);
  try {
    notify({
      userId: before.authorId, type, actorId: null, href: SANCTION_HREF, target: { entityType, entityId }, collapse: false,
      data: { label: before.label, excerpt: excerptOf(before), category, sanctionId: opts.sanctionId ?? null, anon: isAnonEntity(entityType) },
    });
  } catch (err) {
    log.error('applyContentStatus: author notice failed', err);
  }
}

/** Closes every open report on the entity; reporters get `mod.report_resolved` (`outcome: 'actioned' | 'no_violation'`); bad-faith lowers trust. */
export function closeReportsFor(
  entityType: ContentEntityType,
  entityId: Id,
  outcome: 'actioned' | 'dismissed',
  opts: { badFaith?: boolean } = {},
): void {
  const at = now();
  const open = prep("SELECT id, reporter_id FROM reports WHERE entity_type = ? AND entity_id = ? AND status = 'open'").all(entityType, entityId) as {
    id: Id; reporter_id: Id;
  }[];
  if (open.length === 0) return;
  prep("UPDATE reports SET status = ?, closed_at = ?, bad_faith = ? WHERE entity_type = ? AND entity_id = ? AND status = 'open'").run(
    outcome, at, opts.badFaith ? 1 : 0, entityType, entityId,
  );
  for (const r of open) {
    try {
      notify({
        userId: r.reporter_id, type: 'mod.report_resolved', actorId: null, href: '/guidelines',
        target: { entityType: 'report', entityId: r.id }, collapse: false,
        data: { outcome: outcome === 'actioned' ? 'actioned' : 'no_violation' },
      });
    } catch (err) {
      log.error('closeReportsFor: reporter notice failed', err);
    }
  }
}

/* ───────────────────────────── strikes ───────────────────────────── */

/**
 * Records the strike (points per severity, expiry per safety §4.2) and the user-facing `removal` notice row (with the
 * user's own excerpt — only ever shown to them by GET /me/sanctions). Audit target = the entity. Returns the user's
 * ACTIVE points after the strike (true total).
 */
export function addStrike(input: {
  userId: Id;
  entityType: ContentEntityType;
  entityId: Id;
  category: ModerationCategory;
  severity: ModerationSeverity;
  actionId: Id;
}): number {
  const at = now();
  const points = STRIKE_POINTS[input.severity] ?? 1;
  const ttl = STRIKE_TTL_MS[input.severity];
  const snap = loadSnapshot(input.entityType, input.entityId);
  const action = getModerationAction(input.actionId);
  const anon = isAnonEntity(input.entityType) || isAnonQueueItem(action?.queue_id);
  const actor = action && action.actor_id !== 'system' ? (getAuthedUser(action.actor_id) ?? 'system') : 'system';
  tx(() => {
    const strikeId = newId();
    prep(
      `INSERT INTO strikes (id, user_id, entity_type, entity_id, category, severity, points, action_id, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(strikeId, input.userId, input.entityType, input.entityId, input.category, input.severity, points, input.actionId, ttl === null ? null : at + ttl, at);
    const noticeId = newId();
    prep(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, category, entity_type, entity_id, content_excerpt, content_label, action_id, actor_id,
         starts_at, effective_at, ends_at, created_at)
       VALUES (?,?,'removal','all',?,?,?,?,?,?,?,?,?,NULL,?)`,
    ).run(
      noticeId, input.userId, input.category, input.entityType, input.entityId, snap ? excerptOf(snap) : null, snap?.label ?? null,
      input.actionId, action?.actor_id ?? null, at, at, at,
    );
    audit({
      actor, action: 'strike_add', targetType: input.entityType, targetId: input.entityId, queueId: action?.queue_id ?? undefined,
      metadata: { strikeId, points, severity: input.severity, category: input.category, expiresAt: ttl === null ? null : at + ttl, ...(anon ? {} : { userId: input.userId }) },
    });
  });
  return activeStrikePoints(input.userId);
}

/** Revokes every live strike on the entity and lifts its `removal` notices (restore / reversed appeal). */
export function revokeStrikesFor(entityType: ContentEntityType, entityId: Id): void {
  const at = now();
  tx(() => {
    const strikes = prep('UPDATE strikes SET revoked_at = ? WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL').run(at, entityType, entityId);
    prep("UPDATE user_sanctions SET lifted_at = ? WHERE kind = 'removal' AND entity_type = ? AND entity_id = ? AND lifted_at IS NULL").run(at, entityType, entityId);
    if (strikes.changes > 0) {
      audit({ actor: 'system', action: 'strike_revoke', targetType: entityType, targetId: entityId, metadata: { revoked: strikes.changes } });
    }
  });
}

/* ───────────────────────────── sanctions ───────────────────────────── */

const SANCTION_NOTICE: Record<SanctionKind, PublicNotificationType> = {
  warning: 'mod.warning', mute: 'mod.muted', suspension: 'mod.suspended', ban: 'mod.suspended',
};

/**
 * Applies a sanction: the `user_sanctions` row, the audit row (entity-targeted for anon origin), the user notice
 * (`mod.warning` / `mod.muted` / `mod.suspended`), and for suspension / ban: `users.status`, session revocation, ws
 * `session.revoked`, `banned_emails` + lifecycle hooks (ban). Anon-origin warnings and mutes on non-P0 items get a
 * random 5–30 min `effective_at` so the moment of enforcement cannot be matched to the staff action. Returns the id.
 */
export function applySanction(input: ApplySanctionInput): Id {
  const user = getUserRow(input.userId);
  if (!user || user.status === 'deleted') throw ApiError.notFound("This account isn't available");
  const action = input.actionId ? getModerationAction(input.actionId) : null;
  const entity = input.entity ?? (action && action.entity_id ? { entityType: action.entity_type, entityId: action.entity_id } : undefined);
  const anon = isAnonEntity(entity?.entityType) || isAnonQueueItem(action?.queue_id);
  const at = now();
  const scope: SanctionScope = input.scope ?? 'all';

  let delay = false;
  if (input.kind === 'warning' || input.kind === 'mute') {
    if (input.delayed === true) delay = true;
    else if (input.delayed === undefined && anon) {
      const queue = action?.queue_id ? getQueueRow(action.queue_id) : entity ? latestQueueItemFor(entity.entityType, entity.entityId) : null;
      delay = queue?.priority !== 'p0';
    }
  }
  const effectiveAt = delay ? at + crypto.randomInt(ANON_DELAY_MIN_MS, ANON_DELAY_MAX_MS + 1) : at;
  let endsAt: EpochMs | null = null;
  if (input.kind === 'mute') endsAt = effectiveAt + (input.durationMs ?? MUTE_24H_MS);
  if (input.kind === 'suspension') endsAt = effectiveAt + (input.durationMs ?? SUSPENSION_7D_MS);

  const snap = entity ? loadSnapshot(entity.entityType, entity.entityId) : null;
  const actorId = input.actor === 'system' ? null : input.actor.id;
  const id = newId();

  tx(() => {
    prep(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, category, entity_type, entity_id, content_excerpt, content_label, action_id, actor_id,
         starts_at, effective_at, ends_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, input.userId, input.kind, scope, input.category, entity?.entityType ?? null, entity?.entityId ?? null,
      snap ? excerptOf(snap) : null, snap?.label ?? null, input.actionId ?? null, actorId, effectiveAt, effectiveAt, endsAt, at,
    );
    if (input.actionId) prep('UPDATE moderation_actions SET sanction_id = ? WHERE id = ? AND sanction_id IS NULL').run(id, input.actionId);
    audit({
      actor: input.actor,
      action: 'sanction_apply',
      targetType: anon ? (entity?.entityType ?? action?.entity_type ?? 'queue') : 'user',
      targetId: anon ? (entity?.entityId ?? action?.queue_id ?? undefined) : input.userId,
      queueId: action?.queue_id ?? undefined,
      metadata: {
        sanctionId: id, kind: input.kind, scope, category: input.category, durationMs: input.durationMs ?? null, effectiveAt, endsAt,
        ...(anon ? {} : entity ? { entityType: entity.entityType, entityId: entity.entityId } : {}),
      },
    });
    // the notice goes out BEFORE a status flip (notify() only delivers to active accounts)
    try {
      notify({
        userId: input.userId, type: SANCTION_NOTICE[input.kind], actorId: null, href: SANCTION_HREF,
        target: { entityType: 'sanction', entityId: id }, collapse: false,
        data: { category: input.category, until: endsAt, sanctionId: id, scope, kind: input.kind },
      });
    } catch (err) {
      log.error('applySanction: user notice failed', err);
    }
    if (input.kind === 'suspension' || input.kind === 'ban') {
      const status = input.kind === 'ban' ? 'banned' : user.status === 'banned' ? 'banned' : 'suspended';
      prep('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, at, input.userId);
      revokeAllSessions(input.userId);
      if (input.kind === 'ban') prep('INSERT OR IGNORE INTO banned_emails (email_hash, created_at) VALUES (?,?)').run(emailHash(user.email), at);
    }
  });

  if (input.kind === 'suspension' || input.kind === 'ban') {
    try {
      revokeUserSockets(input.userId, input.kind === 'ban' ? 'banned' : 'suspended');
    } catch (err) {
      log.error('applySanction: socket revocation failed', err);
    }
    if (input.kind === 'ban') runUserLifecycleHooks('onBanned', input.userId);
  }
  return id;
}

/**
 * Lifts a sanction (no-op when already lifted): account status is recomputed from the remaining active rows
 * (a lifted suspension leaves the account "treated as new" for 72 h), a lifted ban clears `banned_emails`.
 */
export function liftSanction(id: Id, actor: AuthedUser | 'system'): void {
  const row = getSanctionRow(id);
  if (!row) throw ApiError.notFound();
  if (row.lifted_at !== null) return;
  const at = now();
  const action = row.action_id ? getModerationAction(row.action_id) : null;
  const anon = isAnonEntity(row.entity_type) || isAnonQueueItem(action?.queue_id);
  tx(() => {
    prep('UPDATE user_sanctions SET lifted_at = ?, lifted_by = ? WHERE id = ?').run(at, actor === 'system' ? 'system' : actor.id, id);
    if (row.kind === 'suspension' || row.kind === 'ban') {
      const remaining = activeSanctionRows(row.user_id, at);
      const status = remaining.some((s) => s.kind === 'ban') ? 'banned' : remaining.some((s) => s.kind === 'suspension') ? 'suspended' : 'active';
      const user = getUserRow(row.user_id);
      if (user && user.status !== 'deleted' && user.status !== status) {
        if (status === 'active') {
          prep('UPDATE users SET status = ?, restricted_until = ?, updated_at = ? WHERE id = ?').run(status, at + POST_SUSPENSION_RESTRICTION_MS, at, row.user_id);
        } else {
          prep('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, at, row.user_id);
        }
      }
      if (row.kind === 'ban' && user && !remaining.some((s) => s.kind === 'ban')) {
        prep('DELETE FROM banned_emails WHERE email_hash = ?').run(emailHash(user.email));
      }
    }
    const entityType = row.entity_type ?? action?.entity_type ?? null;
    const entityId = row.entity_id ?? action?.entity_id ?? null;
    audit({
      actor, action: 'sanction_lift',
      targetType: anon ? (entityType ?? 'queue') : 'user',
      targetId: anon ? (entityId ?? action?.queue_id ?? undefined) : row.user_id,
      queueId: action?.queue_id ?? undefined,
      metadata: { sanctionId: id, kind: row.kind },
    });
  });
}

/* ───────────────────────────── actions / audit ───────────────────────────── */

/**
 * Writes `moderation_actions` + `audit` in the caller's transaction (target = the entity; `targetUserId` is stored
 * server-internally, and copied into audit metadata only for public-origin rows). Sets `mod_queue.first_action_at`.
 * Returns the action id.
 */
export function recordAction(input: RecordActionInput): Id {
  const id = newId();
  const at = now();
  const queue = input.queueId ? getQueueRow(input.queueId) : null;
  const anon = isAnonEntity(input.entityType) || isAnonEntity(queue?.entity_type);
  const targetUserId = input.targetUserId ?? (input.entityId ? resolveAuthorId(input.entityType, input.entityId) : null);
  const actorId = input.actor === 'system' ? 'system' : input.actor.id;
  const actorRole = input.actor === 'system' ? 'system' : input.actor.role;
  const note = input.note ?? null;
  tx(() => {
    prep(
      `INSERT INTO moderation_actions (id, queue_id, entity_type, entity_id, target_user_id, actor_id, actor_role, action, category, note, batch_id, sanction_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, input.queueId ?? null, input.entityType, input.entityId, targetUserId, actorId, actorRole, input.action, input.category ?? null, note,
      input.batchId ?? null, input.sanctionId ?? null, at,
    );
    if (queue && queue.first_action_at === null) prep('UPDATE mod_queue SET first_action_at = ? WHERE id = ?').run(at, queue.id);
    const extra = anon ? stripIdentityMeta(input.metadata) : { ...(input.metadata ?? {}) };
    audit({
      actor: input.actor, action: input.action, targetType: input.entityType, targetId: input.entityId ?? undefined,
      queueId: input.queueId ?? undefined, batchId: input.batchId ?? undefined, reasonCode: input.reasonCode, reason: note ?? undefined,
      metadata: {
        actionId: id, category: input.category ?? null, sanctionId: input.sanctionId ?? null, ...extra,
        ...(anon || !targetUserId ? {} : { targetUserId }),
      },
    });
  });
  return id;
}

export function reporterTrust(userId: Id): 'high' | 'normal' | 'low' {
  return reporterTrustFor(userId);
}

/** Server-internal; MUST NOT be serialized outside the unmask endpoint. Adapter → queue item → moderation event. */
export function resolveAuthorId(entityType: ContentEntityType, entityId: Id): Id | null {
  const snap = loadSnapshot(entityType, entityId);
  if (snap?.authorId) return snap.authorId;
  const q = prep('SELECT author_id FROM mod_queue WHERE entity_type = ? AND entity_id = ? AND author_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(
    entityType, entityId,
  ) as { author_id: Id } | undefined;
  if (q?.author_id) return q.author_id;
  const e = prep('SELECT author_id FROM moderation_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(
    entityType, entityId,
  ) as { author_id: Id } | undefined;
  return e?.author_id ?? null;
}

interface StandingSanctionRow extends UserSanctionRow {
  queue_entity_type: string | null;
}

function originOf(row: Pick<StandingSanctionRow, 'entity_type' | 'queue_entity_type'>): 'public' | 'anon' {
  return isAnonEntity(row.entity_type) || isAnonEntity(row.queue_entity_type) ? 'anon' : 'public';
}

/**
 * Firewall-critical (rule 2): for `viewerRole !== 'admin'` anon-origin sanctions and strikes are OMITTED and excluded
 * from `strikePoints` / `openQueueItems`; for admins they are included with `origin:'anon'` and day-floored timestamps.
 * Enforcement never reads this — it uses the true totals in lib/sanctions.ts.
 */
export function staffStandingFor(
  userId: Id,
  viewerRole: Role,
): { strikePoints: number; openQueueItems: number; sanctions: StaffSanctionRowCore[]; status: UserRow['status'] | null } {
  const admin = viewerRole === 'admin';
  const at = now();
  const rows = prep(
    `SELECT s.*, mq.entity_type AS queue_entity_type
       FROM user_sanctions s
       LEFT JOIN moderation_actions ma ON ma.id = s.action_id
       LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC, s.id DESC`,
  ).all(userId) as StandingSanctionRow[];
  const appeals = new Map(
    (prep('SELECT sanction_id, status FROM appeals WHERE user_id = ?').all(userId) as { sanction_id: Id; status: SanctionNotice['appealStatus'] }[]).map(
      (a) => [a.sanction_id, a.status] as const,
    ),
  );
  const sanctions: StaffSanctionRowCore[] = [];
  for (const row of rows) {
    const origin = originOf(row);
    if (origin === 'anon' && !admin) continue;
    const notice = toSanctionNotice(row, appeals.get(row.id) ?? 'none');
    const { contentExcerpt: _excerpt, contentLabel: _label, ...rest } = notice;
    const out: StaffSanctionRowCore = { ...rest, origin };
    if (origin === 'anon') {
      // the raw id also sits in the entity-targeted audit rows (sanction_apply / lift metadata); an admin must not be
      // able to join the two without the unmask endpoint → a sealed handle only `liftUserSanction` can open
      out.id = sealStaffSanctionId(row.id);
      out.startsAt = floorDay(out.startsAt) ?? out.startsAt;
      out.until = floorDay(out.until);
      out.acknowledgedAt = floorDay(out.acknowledgedAt);
      out.appealDeadline = floorDay(out.appealDeadline);
      out.createdAt = floorDay(out.createdAt) ?? out.createdAt;
    }
    sanctions.push(out);
  }

  const anonList = (ANON_ENTITY_TYPES as readonly string[]).map(() => '?').join(',');
  const anonParams = [...(ANON_ENTITY_TYPES as readonly string[])];
  const strikePoints = admin
    ? activeStrikePoints(userId)
    : (prep(
        `SELECT COALESCE(SUM(st.points), 0) AS points FROM strikes st
           LEFT JOIN moderation_actions ma ON ma.id = st.action_id
           LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
          WHERE st.user_id = ? AND st.revoked_at IS NULL AND (st.expires_at IS NULL OR st.expires_at > ?)
            AND st.entity_type NOT IN (${anonList}) AND (mq.entity_type IS NULL OR mq.entity_type NOT IN (${anonList}))`,
      ).get(userId, at, ...anonParams, ...anonParams) as { points: number }).points;
  const openQueueItems = (prep(
    `SELECT COUNT(*) AS n FROM mod_queue WHERE author_id = ? AND status != 'closed'${admin ? '' : ` AND entity_type NOT IN (${anonList})`}`,
  ).get(userId, ...(admin ? [] : anonParams)) as { n: number }).n;

  // Account status as this viewer may see it. Moderators: derived from active PUBLIC-origin rows only, so a Buzz
  // zero-tolerance / escalation suspension never flips a named account's status in their view (SPEC §3.2 #9).
  // Enforcement keeps using users.status.
  const user = getUserRow(userId);
  let status: UserRow['status'] | null = user?.status ?? null;
  if (!admin && user && (user.status === 'suspended' || user.status === 'banned')) {
    const visible = rows.filter(
      (r) => originOf(r) === 'public' && r.lifted_at === null && r.effective_at <= at && (r.ends_at === null || r.ends_at > at),
    );
    status = visible.some((r) => r.kind === 'ban') ? 'banned' : visible.some((r) => r.kind === 'suspension') ? 'suspended' : 'active';
  }
  return { strikePoints, openQueueItems, sanctions, status };
}

const STAFF_SANCTION_SEAL = 'staff-anon-sanction';
const STAFF_SANCTION_PREFIX = 'sx_';

/** Opaque, stable handle for an anon-origin sanction in admin user payloads (not joinable with audit metadata). */
export function sealStaffSanctionId(id: Id): Id {
  return `${STAFF_SANCTION_PREFIX}${sealValue(STAFF_SANCTION_SEAL, id)}`;
}

/** The raw sanction id behind a `sealStaffSanctionId` handle; null for anything else. */
export function openStaffSanctionId(handle: string): Id | null {
  if (!handle.startsWith(STAFF_SANCTION_PREFIX)) return null;
  return unsealValue(STAFF_SANCTION_SEAL, handle.slice(STAFF_SANCTION_PREFIX.length));
}

/** 'anon' when the sanction's entity (or its action's queue item) is a Buzz entity. Unknown ids → null. */
export function sanctionOrigin(id: Id): 'public' | 'anon' | null {
  const row = prep(
    `SELECT s.entity_type AS entity_type, mq.entity_type AS queue_entity_type FROM user_sanctions s
       LEFT JOIN moderation_actions ma ON ma.id = s.action_id
       LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
      WHERE s.id = ?`,
  ).get(id) as Pick<StandingSanctionRow, 'entity_type' | 'queue_entity_type'> | undefined;
  return row ? originOf(row) : null;
}

/**
 * Firewall-critical (rule 4): `targetId` is null for `target_type = 'user'` rows whose `queue_id` is an anon-origin
 * item, unless the viewer is admin AND action = 'buzz_unmask'; `metadata` is null for moderators on `buzz_unmask`
 * (and identity-like keys are stripped from anon-origin rows for non-admins).
 */
export function serializeAuditRow(row: AuditLogRow, viewer: AuthedUser): AuditRowCore {
  const admin = viewer.role === 'admin';
  const anonQueue = isAnonQueueItem(row.queue_id) || (row.target_type !== null && row.target_type !== 'user' && isAnonEntity(row.target_type));
  let actor: AuditRowCore['actor'] = null;
  if (row.actor_id !== 'system') {
    const u = getUserRow(row.actor_id);
    actor = { id: row.actor_id, displayName: u?.display_name ?? 'Staff', role: (row.actor_role as Role) || 'moderator' };
  }
  let targetId = row.target_id;
  if (row.target_type === 'user' && isAnonQueueItem(row.queue_id) && !(admin && row.action === 'buzz_unmask')) targetId = null;
  let metadata: Record<string, unknown> | null = json<Record<string, unknown>>(row.metadata_json, {});
  if (row.action === 'buzz_unmask' && !admin) metadata = null;
  else if (anonQueue && !admin) metadata = stripIdentityMeta(metadata);
  return {
    id: row.id,
    actor,
    action: row.action,
    targetType: row.target_type,
    targetId,
    queueId: row.queue_id,
    batchId: row.batch_id,
    reasonCode: row.reason_code,
    reason: row.reason,
    metadata,
    createdAt: row.created_at,
  };
}
