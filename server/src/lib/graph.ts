/**
 * Follows, blocks, viewer filters (SPEC §4.2.4, safety §7.1).
 *
 * Every PUBLIC list/detail query MUST AND in `sqlNotBlocked` + `sqlAuthorVisible` (+ `sqlNotReported`).
 * **Buzz MUST NOT use `sqlNotBlocked` / `sqlAuthorVisible`** (a block must have zero effect on Buzz — L14/L16).
 */
import type { BlockResult, ContentEntityType, FollowResult, Id } from '@shared/core';
import { LIMITS } from '@shared/core';
import { onDbReady, prep, tx } from '../db/index';
import { trackEvent } from './analytics';
import { now } from './clock';
import { ApiError } from './http';
import { notify } from './notify';
import { enforceRateLimit } from './rateLimit';
import { soft } from './stub';
import { getUserRow, mutualsBetween as mutualsBetweenImpl, type AuthedUser, type UserRow } from './users';

export const ACCOUNT_UNAVAILABLE = "This account isn't available";

/* ───────────────────────────── follows ───────────────────────────── */

export function isFollowing(a: Id, b: Id): boolean {
  return prep('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(a, b) !== undefined;
}

export function followerIdsOf(userId: Id): Id[] {
  return (prep('SELECT follower_id AS id FROM follows WHERE followee_id = ? ORDER BY created_at DESC').all(userId) as { id: Id }[]).map((r) => r.id);
}

export function followingIdsOf(userId: Id): Id[] {
  return (prep('SELECT followee_id AS id FROM follows WHERE follower_id = ? ORDER BY created_at DESC').all(userId) as { id: Id }[]).map((r) => r.id);
}

export function mutualsBetween(viewerId: Id, userId: Id, limit = 3): { count: number; sample: Id[] } {
  return mutualsBetweenImpl(viewerId, userId, limit);
}

function followerCount(userId: Id): number {
  return (prep('SELECT follower_count AS n FROM users WHERE id = ?').get(userId) as { n: number } | undefined)?.n ?? 0;
}

/** Deletes one edge and keeps both counters equal to the rows. Returns true when an edge existed. */
function removeFollowEdge(followerId: Id, followeeId: Id): boolean {
  const res = prep('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(followerId, followeeId);
  if (res.changes === 0) return false;
  prep('UPDATE users SET following_count = MAX(following_count - 1, 0) WHERE id = ?').run(followerId);
  prep('UPDATE users SET follower_count = MAX(follower_count - 1, 0) WHERE id = ?').run(followeeId);
  return true;
}

/** Rate limit `follow`, block check (generic 404), counters, `notify('follow.new')`, `trackEvent('follow')`. Idempotent. */
export function followUser(viewer: AuthedUser, targetId: Id): FollowResult {
  if (viewer.id === targetId) throw ApiError.badRequest("You can't follow yourself.");
  const target = assertVisibleUser(viewer.id, targetId);
  if (isBlockedBetween(viewer.id, target.id)) throw ApiError.notFound(ACCOUNT_UNAVAILABLE);
  if (isFollowing(viewer.id, target.id)) {
    return { userId: target.id, isFollowing: true, followerCount: followerCount(target.id) };
  }
  enforceRateLimit(viewer, 'follow');
  tx(() => {
    const res = prep('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, target.id, now());
    if (res.changes === 0) return;
    prep('UPDATE users SET following_count = following_count + 1 WHERE id = ?').run(viewer.id);
    prep('UPDATE users SET follower_count = follower_count + 1 WHERE id = ?').run(target.id);
    soft(() =>
      notify({
        userId: target.id, type: 'follow.new', actorId: viewer.id, href: `/u/${viewer.handle}`,
        target: { entityType: 'user', entityId: viewer.id }, collapse: false,
      }),
    );
  });
  trackEvent('follow', { userId: viewer.id, universityId: viewer.universityId }, { targetType: target.account_type });
  return { userId: target.id, isFollowing: true, followerCount: followerCount(target.id) };
}

export function unfollowUser(viewer: AuthedUser, targetId: Id): FollowResult {
  const target = getUserRow(targetId);
  if (!target) throw ApiError.notFound(ACCOUNT_UNAVAILABLE);
  const removed = tx(() => removeFollowEdge(viewer.id, target.id));
  if (removed) trackEvent('unfollow', { userId: viewer.id, universityId: viewer.universityId });
  return { userId: target.id, isFollowing: false, followerCount: followerCount(target.id) };
}

/* ───────────────────────────── blocks ───────────────────────────── */

export function isBlockedBetween(a: Id, b: Id): boolean {
  if (a === b) return false;
  return (
    prep('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a) !== undefined
  );
}

const BLOCK_CACHE_TTL_MS = 5_000;
const BLOCK_CACHE_MAX = 500;
const blockCache = new Map<Id, { at: number; ids: Set<Id> }>();

function invalidateBlockCache(...userIds: Id[]): void {
  for (const id of userIds) blockCache.delete(id);
}

/** Everyone `userId` blocked or was blocked by (both directions). `req`-less LRU, 5 s; invalidated on (un)block. */
export function blockedIdsFor(userId: Id): Set<Id> {
  const at = now();
  const hit = blockCache.get(userId);
  if (hit && Math.abs(at - hit.at) < BLOCK_CACHE_TTL_MS) {
    blockCache.delete(userId);
    blockCache.set(userId, hit);
    return new Set(hit.ids);
  }
  const rows = prep(
    'SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?',
  ).all(userId, userId) as { id: Id }[];
  const ids = new Set(rows.map((r) => r.id));
  blockCache.set(userId, { at, ids });
  if (blockCache.size > BLOCK_CACHE_MAX) {
    const oldest = blockCache.keys().next().value;
    if (oldest !== undefined) blockCache.delete(oldest);
  }
  return new Set(ids);
}

/** Tests / resetDb. */
export function clearBlockCache(): void {
  blockCache.clear();
}
onDbReady(clearBlockCache);

/**
 * `authorCol` is a trusted SQL column reference (e.g. `p.author_id`), never user input.
 * The inner aliases are deliberately unusual (`_blk`, `_av`, `_rep`) so a caller's own `b` / `u` / `r` alias is never shadowed.
 */
export function sqlNotBlocked(viewerId: Id, authorCol: string): { sql: string; params: Id[] } {
  return {
    sql: `NOT EXISTS (SELECT 1 FROM blocks _blk WHERE (_blk.blocker_id = ? AND _blk.blocked_id = ${authorCol}) OR (_blk.blocker_id = ${authorCol} AND _blk.blocked_id = ?))`,
    params: [viewerId, viewerId],
  };
}

/** Hides suspended / banned / deleted authors on PUBLIC surfaces. Buzz MUST NOT use it (L16). */
export function sqlAuthorVisible(authorCol: string): string {
  return `EXISTS (SELECT 1 FROM users _av WHERE _av.id = ${authorCol} AND _av.status = 'active')`;
}

export function reportedIdsFor(userId: Id, entityType: ContentEntityType): Set<Id> {
  const rows = prep('SELECT entity_id AS id FROM reports WHERE reporter_id = ? AND entity_type = ?').all(userId, entityType) as { id: Id }[];
  return new Set(rows.map((r) => r.id));
}

export function sqlNotReported(viewerId: Id, entityType: ContentEntityType, idCol: string): { sql: string; params: string[] } {
  return {
    sql: `NOT EXISTS (SELECT 1 FROM reports _rep WHERE _rep.reporter_id = ? AND _rep.entity_type = ? AND _rep.entity_id = ${idCol})`,
    params: [viewerId, entityType],
  };
}

function sharedGroupConversationIds(a: Id, b: Id): Id[] {
  const rows = prep(
    `SELECT c.id AS id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ? AND m1.state IN ('active','request')
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ? AND m2.state IN ('active','request')
      WHERE c.kind IN ('group','course') ORDER BY c.updated_at DESC`,
  ).all(a, b) as { id: Id }[];
  return rows.map((r) => r.id);
}

/**
 * Silent, symmetric in effect, immediate (safety §7.1): deletes both follow edges (counters kept), deletes the
 * notifications the two produced for each other, max `LIMITS.maxBlocks`, rate limit `block`. Idempotent.
 */
export function blockUser(viewer: AuthedUser, targetId: Id): BlockResult {
  if (viewer.id === targetId) throw ApiError.badRequest("You can't block yourself.");
  const target = getUserRow(targetId);
  if (!target || target.status === 'deleted') throw ApiError.notFound(ACCOUNT_UNAVAILABLE);
  const already = prep('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(viewer.id, target.id) !== undefined;
  if (!already) {
    const count = (prep('SELECT COUNT(*) AS n FROM blocks WHERE blocker_id = ?').get(viewer.id) as { n: number }).n;
    if (count >= LIMITS.maxBlocks) throw ApiError.conflict(`You can block up to ${LIMITS.maxBlocks} accounts. Unblock someone first.`);
    enforceRateLimit(viewer, 'block');
    tx(() => {
      prep('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(viewer.id, target.id, now());
      removeFollowEdge(viewer.id, target.id);
      removeFollowEdge(target.id, viewer.id);
      prep('DELETE FROM notifications WHERE (user_id = ? AND actor_id = ?) OR (user_id = ? AND actor_id = ?)').run(
        viewer.id, target.id, target.id, viewer.id,
      );
    });
    invalidateBlockCache(viewer.id, target.id);
    trackEvent('block', { userId: viewer.id, universityId: viewer.universityId });
  }
  return { userId: target.id, isBlocked: true, sharedGroupConversationIds: sharedGroupConversationIds(viewer.id, target.id) };
}

/** Unblocking never restores follows. */
export function unblockUser(viewer: AuthedUser, targetId: Id): BlockResult {
  prep('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(viewer.id, targetId);
  invalidateBlockCache(viewer.id, targetId);
  return { userId: targetId, isBlocked: false, sharedGroupConversationIds: [] };
}

/**
 * Throws the generic 404 ("This account isn't available") for missing / non-active / blocked-me targets — the body is
 * byte-identical in all three cases. A target the VIEWER blocked is returned (the profile renders its shell).
 */
export function assertVisibleUser(viewerId: Id | null, targetId: Id): UserRow {
  const row = getUserRow(targetId);
  if (!row || row.status !== 'active') throw ApiError.notFound(ACCOUNT_UNAVAILABLE);
  if (viewerId && viewerId !== row.id) {
    const blockedMe = prep('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(row.id, viewerId) !== undefined;
    if (blockedMe) throw ApiError.notFound(ACCOUNT_UNAVAILABLE);
  }
  return row;
}
