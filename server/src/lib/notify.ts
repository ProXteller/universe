/**
 * Notifications (SPEC §4.2.7, types/copy §4.4.4).                       LANE S-M2b owns this file.
 *
 * Rules (SPEC §4.2.7):
 *  - `notify` is a no-op when `actorId === userId`, when `isBlockedBetween`, when the recipient is not `active`, or
 *    when the recipient's category toggle is off (`safety` is always on).
 *  - Collapse: same `(user, type, target)` UNREAD row within 60 min → update `actor_id`, `actor_count` (distinct via
 *    `notification_actors`), `data_json`, `created_at`. Default `collapse` = true except `follow.new` (SPEC:
 *    "default true for *.like, follow.new=false"; product §2.10: "same-type same-target within an hour collapses").
 *    Rows without a `target` never collapse.
 *  - `buzz.milestone`: max one per thread per day (the existing row is updated in place).
 *  - After insert/update → `publishToUser(userId, { type:'notification', notification, badges })`; inside quiet hours
 *    only `{ type:'badges' }` is sent. The quiet-hours predicate is a hook (`setQuietHoursCheck`) that lane S-M3
 *    installs (T2, needs the viewer's local time); it defaults to "never".
 *  - `notifyAnonymous` has NO actor parameter: rows are written with `anonymous = 1`, `actor_id = NULL` (the table's
 *    CHECK constraint rejects an actor on an anonymous row), `actor_count = 1`, `thumbnail_url = NULL`; `data` keys
 *    from the identity forbidden list are stripped.
 *  - `notifySeeded` (SeedKit only) honours the seed-only `actorIds` and skips the block / settings / self checks.
 */
import type {
  AnonymousNotificationType, Badges, EpochMs, Id, Notification, NotificationCategory, NotificationData,
  NotificationTargetRef, PublicNotificationType, UserSummary,
} from '@shared/core';
import { NOTIFICATION_CATEGORY } from '@shared/core';
import { db, inClause, json, newId, prep, tx } from '../db/index';
import { DAY, HOUR, MIN, now } from './clock';
import { log } from './logger';
import { publishToUser } from './realtime';
import { getUserRow, settingsOf, userSummariesByIds } from './users';

export interface NotifyInput {
  userId: Id;
  type: PublicNotificationType;
  actorId: Id | null;
  href: string;
  target?: NotificationTargetRef | null;
  thumbnailUrl?: string | null;
  data?: NotificationData;
  /** Default true (`*.like`, comments, RSVPs …); `follow.new` = false. Rows without a target never collapse. */
  collapse?: boolean;
  /** Seeds. */
  createdAt?: EpochMs;
  /** Seeds. */
  read?: boolean;
  /**
   * SEED-ONLY — honoured by `notifySeeded()` (SeedKit), IGNORED by `notify()`: writes ONE row with these distinct
   * actors into notification_actors, actor_count = actorIds.length, actor_id = last entry; works with read:true.
   */
  actorIds?: Id[];
}

export interface NotifyAnonymousInput {
  userId: Id;
  type: AnonymousNotificationType;
  threadId: Id;
  href: string;
  /** Validated: values only string|number|boolean|null, keys ∉ the forbidden identity list. */
  data?: NotificationData;
  createdAt?: EpochMs;
  read?: boolean;
}

export interface NotificationRow {
  id: Id;
  user_id: Id;
  type: string;
  category: string;
  anonymous: number;
  actor_id: Id | null;
  actor_count: number;
  target_type: string | null;
  target_id: Id | null;
  href: string;
  thumbnail_url: string | null;
  data_json: string;
  collapse_key: string | null;
  read_at: EpochMs | null;
  created_at: EpochMs;
}

/** Keys that may never appear in an anonymous notification's `data` (SPEC §3.2 #1). */
export const ANON_DATA_FORBIDDEN_KEYS: readonly string[] = [
  'authorId', 'author_id', 'userId', 'user_id', 'handle', 'name', 'displayName', 'avatar', 'avatarUrl', 'email',
  'universityEmail', 'profile', 'actorId', 'actor_id', 'actor',
];

const COLLAPSE_WINDOW_MS = HOUR;
const MAX_DATA_KEYS = 24;
const MAX_DATA_STRING = 500;

/* ───────────────────────────── quiet hours hook (S-M3) ───────────────────────────── */

type QuietHoursCheck = (userId: Id, at: EpochMs) => boolean;
let quietHoursCheck: QuietHoursCheck = () => false;

/**
 * Lane S-M3 installs the real predicate (settings.quietHours + the viewer's local time); `null` restores "never".
 * While it says true, `notify` still writes the row but publishes only `{ type:'badges' }`.
 */
export function setQuietHoursCheck(fn: QuietHoursCheck | null): void {
  quietHoursCheck = fn ?? (() => false);
}

function inQuietHours(userId: Id, at: EpochMs): boolean {
  try {
    return quietHoursCheck(userId, at);
  } catch (err) {
    log.error('quiet-hours check failed', err);
    return false;
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

function cleanData(data: NotificationData | undefined, anonymous: boolean): NotificationData {
  const out: NotificationData = {};
  if (!data || typeof data !== 'object') return out;
  let n = 0;
  for (const [key, value] of Object.entries(data)) {
    if (n >= MAX_DATA_KEYS) break;
    if (anonymous && ANON_DATA_FORBIDDEN_KEYS.includes(key)) {
      log.error(`notifyAnonymous: dropped forbidden data key "${key}"`);
      continue;
    }
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
    } else if (typeof value === 'string') out[key] = value.length > MAX_DATA_STRING ? value.slice(0, MAX_DATA_STRING) : value;
    else continue;
    n += 1;
  }
  return out;
}

function collapseKeyFor(type: string, target: NotificationTargetRef | null | undefined): string | null {
  if (!target) return null;
  return `${type}:${target.entityType}:${target.entityId}`;
}

function categoryOf(type: string): NotificationCategory {
  return (NOTIFICATION_CATEGORY as Record<string, NotificationCategory>)[type] ?? 'system';
}

function recipientAllows(userId: Id, category: NotificationCategory): boolean {
  const row = getUserRow(userId);
  if (!row || row.status !== 'active') return false;
  if (category === 'safety') return true;
  return settingsOf(row).notifications[category] !== false;
}

function blockedBetween(a: Id, b: Id): boolean {
  if (a === b) return false;
  return prep('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a) !== undefined;
}

function getRow(id: Id): NotificationRow {
  return prep('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow;
}

function insertRow(o: {
  userId: Id; type: string; category: NotificationCategory; anonymous: boolean; actorId: Id | null; actorCount: number;
  target: NotificationTargetRef | null; href: string; thumbnailUrl: string | null; data: NotificationData; collapseKey: string | null;
  readAt: EpochMs | null; createdAt: EpochMs;
}): Id {
  const id = newId();
  prep(
    `INSERT INTO notifications (id, user_id, type, category, anonymous, actor_id, actor_count, target_type, target_id, href,
       thumbnail_url, data_json, collapse_key, read_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, o.userId, o.type, o.category, o.anonymous ? 1 : 0, o.actorId, o.actorCount, o.target?.entityType ?? null, o.target?.entityId ?? null,
    o.href, o.thumbnailUrl, JSON.stringify(o.data), o.collapseKey, o.readAt, o.createdAt,
  );
  return id;
}

function addActor(notificationId: Id, actorId: Id): number {
  prep('INSERT OR IGNORE INTO notification_actors (notification_id, actor_id) VALUES (?,?)').run(notificationId, actorId);
  return (prep('SELECT COUNT(*) AS n FROM notification_actors WHERE notification_id = ?').get(notificationId) as { n: number }).n;
}

function publish(userId: Id, id: Id, at: EpochMs): void {
  try {
    const badges = currentBadges(userId);
    if (inQuietHours(userId, at)) {
      publishToUser(userId, { type: 'badges', badges });
      return;
    }
    publishToUser(userId, { type: 'notification', notification: serializeNotification(getRow(id)), badges });
  } catch (err) {
    log.error('notification publish failed', err);
  }
}

/* ───────────────────────────── public API ───────────────────────────── */

export function notify(input: NotifyInput): void {
  const { userId, type, actorId } = input;
  if (actorId !== null && actorId === userId) return;
  const category = categoryOf(type);
  if (!recipientAllows(userId, category)) return;
  if (actorId && blockedBetween(userId, actorId)) return;
  if (actorId && !getUserRow(actorId)) return; // FK: the actor must exist

  const at = input.createdAt ?? now();
  const target = input.target ?? null;
  const collapse = input.collapse ?? type !== 'follow.new';
  const collapseKey = collapse ? collapseKeyFor(type, target) : null;
  const data = cleanData(input.data, false);
  const readAt = input.read ? at : null;

  const id = tx((): Id => {
    if (collapseKey) {
      const existing = prep(
        `SELECT * FROM notifications WHERE user_id = ? AND collapse_key = ? AND read_at IS NULL AND created_at > ?
          ORDER BY created_at DESC LIMIT 1`,
      ).get(userId, collapseKey, at - COLLAPSE_WINDOW_MS) as NotificationRow | undefined;
      if (existing) {
        const count = actorId ? addActor(existing.id, actorId) : Math.max(existing.actor_count, 1);
        prep('UPDATE notifications SET actor_id = ?, actor_count = ?, data_json = ?, href = ?, thumbnail_url = ?, created_at = ? WHERE id = ?').run(
          actorId ?? existing.actor_id, Math.max(count, 1), JSON.stringify({ ...json<NotificationData>(existing.data_json, {}), ...data }),
          input.href, input.thumbnailUrl ?? existing.thumbnail_url, Math.max(at, existing.created_at), existing.id,
        );
        return existing.id;
      }
    }
    const created = insertRow({
      userId, type, category, anonymous: false, actorId, actorCount: 1, target, href: input.href,
      thumbnailUrl: input.thumbnailUrl ?? null, data, collapseKey, readAt, createdAt: at,
    });
    if (actorId) addActor(created, actorId);
    return created;
  });
  if (!input.read) publish(userId, id, at);
}

/** NO actor parameter exists (anonymity firewall). Rows are written with actor_id = NULL, anonymous = 1. */
export function notifyAnonymous(input: NotifyAnonymousInput): void {
  const { userId, type, threadId } = input;
  const category = categoryOf(type);
  if (!recipientAllows(userId, category)) return;
  // minute-floored like every Buzz createdAt (SPEC §3.2 #3): the stored / served / pushed time of an anonymous row must
  // not be an exact clock of the anonymous reply or vote that triggered it (L2)
  const at = Math.floor((input.createdAt ?? now()) / MIN) * MIN;
  const target: NotificationTargetRef = { entityType: 'buzz', entityId: threadId };
  const collapseKey = collapseKeyFor(type, target);
  const data = cleanData(input.data, true);
  const readAt = input.read ? at : null;

  const id = tx((): Id => {
    if (type === 'buzz.milestone') {
      // max one per thread per day: update the day's row (read or not) instead of adding another
      const sameDay = prep(
        'SELECT * FROM notifications WHERE user_id = ? AND collapse_key = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1',
      ).get(userId, collapseKey, at - DAY) as NotificationRow | undefined;
      if (sameDay) {
        // keep created_at: the day window is measured from the row that opened it
        prep('UPDATE notifications SET data_json = ?, href = ? WHERE id = ?').run(
          JSON.stringify({ ...json<NotificationData>(sameDay.data_json, {}), ...data }), input.href, sameDay.id,
        );
        return sameDay.id;
      }
    } else {
      const existing = prep(
        `SELECT * FROM notifications WHERE user_id = ? AND collapse_key = ? AND read_at IS NULL AND created_at > ?
          ORDER BY created_at DESC LIMIT 1`,
      ).get(userId, collapseKey, at - COLLAPSE_WINDOW_MS) as NotificationRow | undefined;
      if (existing) {
        // never a distinct-actor count on an anonymous row (it would be a cross-thread identifier)
        prep('UPDATE notifications SET actor_id = NULL, actor_count = 1, data_json = ?, href = ?, created_at = ? WHERE id = ?').run(
          JSON.stringify({ ...json<NotificationData>(existing.data_json, {}), ...data }), input.href, Math.max(at, existing.created_at), existing.id,
        );
        return existing.id;
      }
    }
    return insertRow({
      userId, type, category, anonymous: true, actorId: null, actorCount: 1, target, href: input.href, thumbnailUrl: null, data,
      collapseKey, readAt, createdAt: at,
    });
  });
  if (!input.read) publish(userId, id, at);
}

/**
 * SeedKit-only entry point (`kit.notify`): same as `notify` but silent (no ws), skips the block / settings /
 * self checks that make no sense for fixtures, and honours the seed-only `actorIds` (one collapsed row).
 */
export function notifySeeded(input: NotifyInput & { createdAt: EpochMs; read: boolean }): void {
  const actorIds = [...new Set((input.actorIds ?? []).filter((id) => id && id !== input.userId))];
  const actorId = actorIds.length > 0 ? actorIds[actorIds.length - 1]! : input.actorId;
  const target = input.target ?? null;
  const collapse = input.collapse ?? input.type !== 'follow.new';
  tx(() => {
    const id = insertRow({
      userId: input.userId, type: input.type, category: categoryOf(input.type), anonymous: false, actorId,
      actorCount: Math.max(1, actorIds.length), target, href: input.href, thumbnailUrl: input.thumbnailUrl ?? null,
      data: cleanData(input.data, false), collapseKey: collapse ? collapseKeyFor(input.type, target) : null,
      readAt: input.read ? input.createdAt : null, createdAt: input.createdAt,
    });
    if (actorIds.length > 0) for (const a of actorIds) addActor(id, a);
    else if (actorId) addActor(id, actorId);
  });
}

/** Content deleted / removed → its notifications disappear. */
export function removeNotificationsFor(target: NotificationTargetRef): void {
  prep('DELETE FROM notifications WHERE target_type = ? AND target_id = ?').run(target.entityType, target.entityId);
}

/* ───────────────────────────── lazy generators (hooks) ───────────────────────────── */

const hooks = new Map<string, (userId: Id) => void>();

/** Run (try/catch) before the notification list + badges. Last write wins by name; never throws. */
export function registerNotificationHook(name: string, fn: (userId: Id) => void): () => void {
  const previous = hooks.get(name);
  hooks.set(name, fn);
  return () => {
    if (hooks.get(name) !== fn) return;
    if (previous) hooks.set(name, previous);
    else hooks.delete(name);
  };
}

export function runNotificationHooks(userId: Id): void {
  for (const [name, fn] of [...hooks]) {
    try {
      fn(userId);
    } catch (err) {
      log.error(`notification hook "${name}" failed`, err);
    }
  }
}

/** Plain counts without running the hooks (used inside ws payloads so a hook can never recurse into itself). */
export function currentBadges(userId: Id): Badges {
  const n = prep('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number };
  const m = prep(
    `SELECT COALESCE(SUM(unread_count), 0) AS n FROM conversation_members WHERE user_id = ? AND state = 'active' AND muted = 0`,
  ).get(userId) as { n: number };
  const r = prep(
    `SELECT COUNT(*) AS n FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ? AND cm.state = 'request' AND c.last_message_at IS NOT NULL`,
  ).get(userId) as { n: number };
  return { notifications: n.n, messages: m.n, requests: r.n };
}

/** Runs the hooks, then counts: unread notifications · unread messages in active chats · pending requests. */
export function badgesFor(userId: Id): Badges {
  runNotificationHooks(userId);
  return currentBadges(userId);
}

/* ───────────────────────────── list / read (routes #31–#32) ───────────────────────────── */

export function listNotificationRows(userId: Id, categories: readonly NotificationCategory[] | null, cur: { k: number | string; id: Id } | null, limit: number): NotificationRow[] {
  const params: unknown[] = [userId];
  let where = 'user_id = ?';
  if (categories) {
    const inc = inClause(categories);
    where += ` AND category IN ${inc.sql}`;
    params.push(...inc.params);
  }
  if (cur) {
    where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    params.push(cur.k, cur.k, cur.id);
  }
  params.push(limit);
  return db.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as NotificationRow[];
}

/** Marks read; returns how many rows changed. `ids` omitted / 'all' → everything. */
export function markNotificationsRead(userId: Id, ids: Id[] | 'all' | undefined, at: EpochMs = now()): number {
  if (ids === undefined || ids === 'all') {
    return prep('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, userId).changes;
  }
  if (ids.length === 0) return 0;
  const inc = inClause(ids);
  return db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN ${inc.sql}`).run(at, userId, ...inc.params).changes;
}

/* ───────────────────────────── serializers ───────────────────────────── */

function toNotification(row: NotificationRow, actors: Map<Id, UserSummary>, follows: Set<Id>): Notification {
  const base = {
    id: row.id,
    category: row.category as NotificationCategory,
    href: row.href,
    target: row.target_type && row.target_id ? ({ entityType: row.target_type, entityId: row.target_id } as NotificationTargetRef) : null,
    data: json<NotificationData>(row.data_json, {}),
    actorCount: Math.max(1, row.actor_count),
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
  if (row.anonymous === 1) {
    // Allow-list, field by field: no actor, no thumbnail, actorCount pinned to 1 (never a distinct-actor count).
    return {
      ...base, createdAt: Math.floor(row.created_at / MIN) * MIN, thumbnailUrl: null, actorCount: 1, type: row.type as AnonymousNotificationType, anonymous: true, actor: null,
    };
  }
  const actor = row.actor_id ? (actors.get(row.actor_id) ?? null) : null;
  return {
    ...base,
    thumbnailUrl: row.thumbnail_url,
    type: row.type as PublicNotificationType,
    anonymous: false,
    actor,
    actorFollowedByViewer: actor !== null && follows.has(actor.id),
  };
}

/** Batch variant: one user lookup + one follows query for the whole page. */
export function serializeNotifications(rows: NotificationRow[]): Notification[] {
  const actorIds = rows.filter((r) => r.anonymous === 0 && r.actor_id).map((r) => r.actor_id as Id);
  const actors = userSummariesByIds(actorIds);
  const follows = new Set<Id>();
  if (actorIds.length > 0) {
    const byViewer = new Map<Id, Id[]>();
    for (const r of rows) if (r.anonymous === 0 && r.actor_id) byViewer.set(r.user_id, [...(byViewer.get(r.user_id) ?? []), r.actor_id]);
    for (const [viewer, ids] of byViewer) {
      const inc = inClause([...new Set(ids)]);
      const hits = db.prepare(`SELECT followee_id AS id FROM follows WHERE follower_id = ? AND followee_id IN ${inc.sql}`).all(viewer, ...inc.params) as { id: Id }[];
      for (const h of hits) follows.add(h.id);
    }
  }
  return rows.map((r) => toNotification(r, actors, follows));
}

/** Fills `PublicNotification.actorFollowedByViewer = isFollowing(row.user_id, row.actor_id)` (false when actor is null). */
export function serializeNotification(row: NotificationRow): Notification {
  return serializeNotifications([row])[0]!;
}
