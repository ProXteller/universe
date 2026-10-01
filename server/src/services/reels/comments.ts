/**
 * Reel comments: one level of replies, comment likes, viewer-scoped lists (SPEC §5.2).
 * `reels.comment_count` = active comments the public can reach: top-level rows plus replies whose parent is active
 * (a hidden / removed parent takes its replies out of reach, so out of the count). `reel_comments.reply_count` =
 * active replies of that parent, whatever the parent's own status.
 */
import type { ContentStatus, EpochMs, Id, Paginated, UserSummary } from '@shared/core';
import type { LikeState, ReelComment } from '@shared/reels';
import { db, inClause, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { now } from '../../lib/clock';
import { sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, keysetWhere, paginate } from '../../lib/http';
import { notify, removeNotificationsFor } from '../../lib/notify';
import { userSummariesByIds, type AuthedUser } from '../../lib/users';
import { getReelRow, reelHref, requireVisibleReel, type ReelRow } from './reels';

export interface ReelCommentRow {
  id: Id;
  reel_id: Id;
  author_id: Id;
  parent_id: Id | null;
  text: string;
  status: ContentStatus;
  auto_hide_immune: number;
  like_count: number;
  reply_count: number;
  created_at: EpochMs;
}

export const REPLIES_PREVIEW = 2;

export function getCommentRow(id: Id): ReelCommentRow | null {
  return (prep('SELECT * FROM reel_comments WHERE id = ?').get(id) as ReelCommentRow | undefined) ?? null;
}

function parentIsActive(parentId: Id): boolean {
  return prep("SELECT 1 FROM reel_comments WHERE id = ? AND status = 'active'").get(parentId) !== undefined;
}

function activeReplyCount(parentId: Id): number {
  return (prep("SELECT COUNT(*) AS n FROM reel_comments WHERE parent_id = ? AND status = 'active'").get(parentId) as { n: number }).n;
}

/* ───────────────────────────── visibility ───────────────────────────── */

function visibleCommentSql(viewerId: Id, alias = 'c'): { sql: string; params: string[] } {
  const nb = sqlNotBlocked(viewerId, `${alias}.author_id`);
  const nr = sqlNotReported(viewerId, 'reel_comment', `${alias}.id`);
  return {
    sql: `((${alias}.status = 'active' AND ${sqlAuthorVisible(`${alias}.author_id`)} AND ${nb.sql} AND ${nr.sql})
           OR (${alias}.author_id = ? AND ${alias}.status IN ('held','hidden','removed')))`,
    params: [...nb.params, ...nr.params, viewerId],
  };
}

/* ───────────────────────────── serializer ───────────────────────────── */

function tombstone(id: Id, universityId: Id): UserSummary {
  return {
    id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '/api/avatars/deleted.svg?t=student',
    accountType: 'student', isVerified: false, universityId, universityShortName: 'Campus',
  };
}

function likedSet(viewerId: Id, ids: Id[]): Set<Id> {
  const out = new Set<Id>();
  if (ids.length === 0) return out;
  const inc = inClause(ids);
  for (const r of db.prepare(`SELECT comment_id AS id FROM reel_comment_likes WHERE user_id = ? AND comment_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[]) out.add(r.id);
  return out;
}

function previewReplies(viewerId: Id, parentIds: Id[]): Map<Id, ReelCommentRow[]> {
  const out = new Map<Id, ReelCommentRow[]>();
  if (parentIds.length === 0) return out;
  const vis = visibleCommentSql(viewerId);
  const inc = inClause(parentIds);
  // The per-parent cut happens in SQL (window function), so a comment with hundreds of replies never loads them all.
  const rows = db
    .prepare(
      `SELECT id, reel_id, author_id, parent_id, text, status, auto_hide_immune, like_count, reply_count, created_at FROM (
         SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.parent_id ORDER BY c.created_at ASC, c.id ASC) AS _rn
           FROM reel_comments c WHERE c.parent_id IN ${inc.sql} AND ${vis.sql}
       ) WHERE _rn <= ? ORDER BY created_at ASC, id ASC`,
    )
    .all(...inc.params, ...vis.params, REPLIES_PREVIEW) as ReelCommentRow[];
  for (const r of rows) {
    const list = out.get(r.parent_id!) ?? [];
    list.push(r);
    out.set(r.parent_id!, list);
  }
  return out;
}

/** Batch serializer; top-level rows get their first 2 visible replies (oldest first). */
export function serializeComments(rows: ReelCommentRow[], viewerId: Id, opts?: { withReplies?: boolean }): ReelComment[] {
  if (rows.length === 0) return [];
  const withReplies = opts?.withReplies ?? true;
  const topIds = withReplies ? rows.filter((r) => r.parent_id === null).map((r) => r.id) : [];
  const replies = previewReplies(viewerId, topIds);
  const replyRows = [...replies.values()].flat();
  const all = [...rows, ...replyRows];
  const authors = userSummariesByIds([...new Set(all.map((r) => r.author_id))]);
  const liked = likedSet(viewerId, all.map((r) => r.id));
  const reelUni = new Map<Id, Id>();
  const toComment = (r: ReelCommentRow, nested: ReelComment[]): ReelComment => {
    let uni = reelUni.get(r.reel_id);
    if (!uni) {
      uni = getReelRow(r.reel_id)?.university_id ?? '';
      reelUni.set(r.reel_id, uni);
    }
    return {
      id: r.id,
      reelId: r.reel_id,
      parentId: r.parent_id,
      author: authors.get(r.author_id) ?? tombstone(r.author_id, uni),
      text: r.text,
      likeCount: r.like_count,
      replyCount: r.reply_count,
      replies: nested,
      viewer: { liked: liked.has(r.id), isSelf: r.author_id === viewerId },
      status: r.status,
      createdAt: r.created_at,
    };
  };
  return rows.map((r) => toComment(r, (replies.get(r.id) ?? []).map((x) => toComment(x, []))));
}

export function serializeComment(row: ReelCommentRow, viewerId: Id): ReelComment {
  return serializeComments([row], viewerId)[0]!;
}

/* ───────────────────────────── lists ───────────────────────────── */

interface Page {
  cursor?: string;
  limit: number;
}

/** Top-level comments, newest first, each with its first 2 replies. */
export function listComments(viewer: AuthedUser, reelId: Id, page: Page): Paginated<ReelComment> {
  requireVisibleReel(viewer, reelId);
  const vis = visibleCommentSql(viewer.id);
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('c.created_at', 'c.id', cur, 'desc');
  const rows = db
    .prepare(`SELECT c.* FROM reel_comments c WHERE c.reel_id = ? AND c.parent_id IS NULL AND ${vis.sql} AND ${ks.sql}
              ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
    .all(reelId, ...vis.params, ...ks.params, page.limit + 1) as ReelCommentRow[];
  const p = paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => r);
  return { items: serializeComments(p.items, viewer.id), nextCursor: p.nextCursor };
}

/** Replies of one top-level comment, oldest first. */
export function listReplies(viewer: AuthedUser, commentId: Id, page: Page): Paginated<ReelComment> {
  const parent = requireVisibleComment(viewer, commentId);
  const vis = visibleCommentSql(viewer.id);
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('c.created_at', 'c.id', cur, 'asc');
  const rows = db
    .prepare(`SELECT c.* FROM reel_comments c WHERE c.parent_id = ? AND ${vis.sql} AND ${ks.sql} ORDER BY c.created_at ASC, c.id ASC LIMIT ?`)
    .all(parent.id, ...vis.params, ...ks.params, page.limit + 1) as ReelCommentRow[];
  const p = paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => r);
  return { items: serializeComments(p.items, viewer.id, { withReplies: false }), nextCursor: p.nextCursor };
}

function requireVisibleComment(viewer: AuthedUser, id: Id): ReelCommentRow {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This comment isn't available");
  requireVisibleReel(viewer, row.reel_id);
  if (row.author_id === viewer.id) return row;
  const vis = visibleCommentSql(viewer.id);
  const ok = prep(`SELECT 1 FROM reel_comments c WHERE c.id = ? AND ${vis.sql}`).get(id, ...vis.params) !== undefined;
  if (!ok) throw ApiError.notFound("This comment isn't available");
  return row;
}

/* ───────────────────────────── writes ───────────────────────────── */

export interface CreateCommentInput {
  user: AuthedUser;
  reel: ReelRow;
  text: string;
  parentId: Id | null;
  status: Extract<ContentStatus, 'active' | 'held'>;
}

/** The parent (when given) must be a visible top-level comment on the same reel. Returns the parent row or null. */
export function resolveParent(viewer: AuthedUser, reelId: Id, parentId: Id | null | undefined): ReelCommentRow | null {
  if (!parentId) return null;
  const parent = requireVisibleComment(viewer, parentId);
  if (parent.reel_id !== reelId) throw new ApiError(400, 'validation_failed', 'parentId: not a comment on this reel');
  if (parent.parent_id !== null) throw new ApiError(400, 'validation_failed', 'parentId: replies go one level deep');
  return parent;
}

export function createComment(input: CreateCommentInput): ReelCommentRow {
  const { user, reel, parentId } = input;
  const id = newId();
  const at = now();
  tx(() => {
    prep('INSERT INTO reel_comments (id, reel_id, author_id, parent_id, text, status, created_at) VALUES (?,?,?,?,?,?,?)').run(
      id, reel.id, user.id, parentId, input.text, input.status, at,
    );
    if (input.status === 'active') {
      if (parentId) prep('UPDATE reel_comments SET reply_count = reply_count + 1 WHERE id = ?').run(parentId);
      // A reply under a hidden parent (only its author can reach it) joins comment_count when the parent is restored.
      if (!parentId || parentIsActive(parentId)) prep('UPDATE reels SET comment_count = comment_count + 1 WHERE id = ?').run(reel.id);
    }
  });
  if (input.status === 'active') {
    const snippet = input.text.slice(0, 80);
    const href = `${reelHref(reel.id)}?comments=1`;
    const parent = parentId ? getCommentRow(parentId) : null;
    if (parent) {
      notify({
        userId: parent.author_id, type: 'reel.comment_reply', actorId: user.id, href, collapse: false,
        target: { entityType: 'reel_comment', entityId: id }, thumbnailUrl: reel.poster_url, data: { snippet, commentId: id },
      });
    }
    if (!parent || parent.author_id !== reel.author_id) {
      notify({
        userId: reel.author_id, type: 'reel.comment', actorId: user.id, href, collapse: false,
        target: { entityType: 'reel_comment', entityId: id }, thumbnailUrl: reel.poster_url, data: { snippet, commentId: id },
      });
    }
  }
  trackEvent('reel_comment', { userId: user.id, universityId: user.universityId }, { reply: parentId !== null });
  return getCommentRow(id)!;
}

/** Own comment, or any comment on the viewer's own reel. Replies of a deleted top-level comment go with it. */
export function deleteComment(user: AuthedUser, id: Id): void {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This comment isn't available");
  const reel = getReelRow(row.reel_id);
  if (!reel) throw ApiError.notFound("This comment isn't available");
  if (row.author_id !== user.id && reel.author_id !== user.id) throw ApiError.notFound("This comment isn't available");
  tx(() => {
    const children = row.parent_id === null
      ? (prep("SELECT id, status FROM reel_comments WHERE parent_id = ? AND status != 'deleted'").all(id) as { id: Id; status: ContentStatus }[])
      : [];
    // Rows leaving comment_count: an active top-level row with its active replies; an active reply under an active parent.
    // A hidden parent's replies already left the count when it was hidden (setCommentStatus), so they are not subtracted twice.
    let removedActive = 0;
    if (row.status === 'active') {
      if (row.parent_id === null) removedActive = 1 + children.filter((c) => c.status === 'active').length;
      else if (parentIsActive(row.parent_id)) removedActive = 1;
    }
    prep("UPDATE reel_comments SET status = 'deleted' WHERE id = ?").run(id);
    removeNotificationsFor({ entityType: 'reel_comment', entityId: id });
    for (const c of children) {
      prep("UPDATE reel_comments SET status = 'deleted' WHERE id = ?").run(c.id);
      removeNotificationsFor({ entityType: 'reel_comment', entityId: c.id });
    }
    if (removedActive > 0) prep('UPDATE reels SET comment_count = MAX(comment_count - ?, 0) WHERE id = ?').run(removedActive, reel.id);
    if (row.parent_id && row.status === 'active') prep('UPDATE reel_comments SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?').run(row.parent_id);
  });
}

function commentLikeState(commentId: Id, viewerId: Id): LikeState {
  const count = (prep('SELECT like_count AS n FROM reel_comments WHERE id = ?').get(commentId) as { n: number } | undefined)?.n ?? 0;
  const liked = prep('SELECT 1 FROM reel_comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, viewerId) !== undefined;
  return { liked, likeCount: count };
}

export function likeComment(viewer: AuthedUser, id: Id): LikeState {
  requireVisibleComment(viewer, id);
  tx(() => {
    const res = prep('INSERT OR IGNORE INTO reel_comment_likes (comment_id, user_id, created_at) VALUES (?,?,?)').run(id, viewer.id, now());
    if (res.changes > 0) prep('UPDATE reel_comments SET like_count = like_count + 1 WHERE id = ?').run(id);
  });
  return commentLikeState(id, viewer.id);
}

export function unlikeComment(viewer: AuthedUser, id: Id): LikeState {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This comment isn't available");
  tx(() => {
    const res = prep('DELETE FROM reel_comment_likes WHERE comment_id = ? AND user_id = ?').run(id, viewer.id);
    if (res.changes > 0) prep('UPDATE reel_comments SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(id);
  });
  return commentLikeState(id, viewer.id);
}

/* ───────────────────────────── moderation status (content adapter) ───────────────────────────── */

/**
 * Keeps `reels.comment_count` / `reply_count` equal to the reachable ACTIVE rows; drops notifications on removal.
 * A top-level row leaving `active` takes its active replies out of `comment_count` with it (they stay `active` but
 * nobody except their authors can reach them) and brings them back when restored — the cascade `deleteComment` applies.
 */
export function setCommentStatus(id: Id, status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>, opts?: { immune?: boolean }): void {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted') return;
  tx(() => {
    if (opts?.immune !== undefined) prep('UPDATE reel_comments SET auto_hide_immune = ? WHERE id = ?').run(opts.immune ? 1 : 0, id);
    if (row.status === status) return;
    prep('UPDATE reel_comments SET status = ? WHERE id = ?').run(status, id);
    const wasActive = row.status === 'active';
    const isActive = status === 'active';
    if (wasActive !== isActive) {
      const sign = isActive ? 1 : -1;
      let reachable = 0;
      if (row.parent_id === null) {
        reachable = 1 + activeReplyCount(id);
      } else {
        prep('UPDATE reel_comments SET reply_count = MAX(reply_count + ?, 0) WHERE id = ?').run(sign, row.parent_id);
        if (parentIsActive(row.parent_id)) reachable = 1;
      }
      if (reachable > 0) prep('UPDATE reels SET comment_count = MAX(comment_count + ?, 0) WHERE id = ?').run(sign * reachable, row.reel_id);
    }
    if (status === 'removed') removeNotificationsFor({ entityType: 'reel_comment', entityId: id });
  });
}
