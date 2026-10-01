/**
 * Orbit comments (SPEC §5.4): flat top-level comments (newest first) with ONE level of replies (oldest first, all
 * of them — there is no separate replies endpoint). `orbit_posts.comment_count` counts ACTIVE comments + replies;
 * `orbit_comments.reply_count` counts ACTIVE replies. Deleting a top-level comment cascades to its replies.
 */
import type { ContentStatus, EpochMs, Id, UserSummary } from '@shared/core';
import type { PostComment } from '@shared/orbit';
import { db, inClause, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { now } from '../../lib/clock';
import { sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, keysetWhere, paginate } from '../../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite, toAuthorNotice } from '../../lib/moderation/index';
import { notify, removeNotificationsFor } from '../../lib/notify';
import { enforceRateLimit } from '../../lib/rateLimit';
import { userSummariesByIds, type AuthedUser } from '../../lib/users';
import { getPostRow, loadVisiblePost, snippetOf, type PostRow } from './posts';

export interface CommentRow {
  id: Id;
  post_id: Id;
  author_id: Id;
  parent_id: Id | null;
  text: string;
  status: ContentStatus;
  auto_hide_immune: number;
  reply_count: number;
  created_at: EpochMs;
}

export const COMMENT_NOT_FOUND = "This comment isn't available";

export function getCommentRow(id: Id): CommentRow | null {
  return (prep('SELECT * FROM orbit_comments WHERE id = ?').get(id) as CommentRow | undefined) ?? null;
}

/* ───────────────────────────── visibility ───────────────────────────── */

function visibleCommentsWhere(viewerId: Id): { sql: string; params: (string | number)[] } {
  const nb = sqlNotBlocked(viewerId, 'c.author_id');
  const nr = sqlNotReported(viewerId, 'orbit_comment', 'c.id');
  return {
    sql: `(c.status = 'active' OR (c.author_id = ? AND c.status != 'deleted'))
      AND ${nb.sql} AND ${sqlAuthorVisible('c.author_id')} AND ${nr.sql}`,
    params: [viewerId, ...nb.params, ...nr.params],
  };
}

/* ───────────────────────────── serializers ───────────────────────────── */

function tombstone(id: Id): UserSummary {
  return {
    id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '/api/avatars/deleted.svg?t=student', accountType: 'student',
    isVerified: false, universityId: '', universityShortName: '',
  };
}

function toComment(row: CommentRow, authors: Map<Id, UserSummary>, replies: PostComment[], viewerId: Id): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    author: authors.get(row.author_id) ?? tombstone(row.author_id),
    text: row.text,
    replyCount: row.reply_count,
    replies,
    viewer: { isSelf: row.author_id === viewerId },
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Top-level rows + every visible reply of each, in one users lookup. */
export function serializeComments(rows: CommentRow[], viewerId: Id): PostComment[] {
  if (rows.length === 0) return [];
  const tops = rows.filter((r) => r.parent_id === null);
  const vis = visibleCommentsWhere(viewerId);
  const replies = new Map<Id, CommentRow[]>();
  for (let i = 0; i < tops.length; i += 400) {
    const inc = inClause(tops.slice(i, i + 400).map((r) => r.id));
    const rs = db
      .prepare(`SELECT c.* FROM orbit_comments c WHERE c.parent_id IN ${inc.sql} AND ${vis.sql} ORDER BY c.created_at ASC, c.id ASC`)
      .all(...inc.params, ...vis.params) as CommentRow[];
    for (const r of rs) {
      const list = replies.get(r.parent_id!) ?? [];
      list.push(r);
      replies.set(r.parent_id!, list);
    }
  }
  const authorIds = [...rows.map((r) => r.author_id), ...[...replies.values()].flat().map((r) => r.author_id)];
  const authors = userSummariesByIds(authorIds);
  return rows.map((row) =>
    toComment(row, authors, row.parent_id === null ? (replies.get(row.id) ?? []).map((r) => toComment(r, authors, [], viewerId)) : [], viewerId),
  );
}

export function serializeComment(row: CommentRow, viewerId: Id): PostComment {
  return serializeComments([row], viewerId)[0]!;
}

/* ───────────────────────────── reads ───────────────────────────── */

export function listComments(viewer: AuthedUser, postId: Id, page: { cursor?: string; limit: number }): { items: PostComment[]; nextCursor: string | null } {
  loadVisiblePost(viewer, postId);
  const cur = decodeCursor(page.cursor);
  const vis = visibleCommentsWhere(viewer.id);
  const ks = keysetWhere('c.created_at', 'c.id', cur, 'desc');
  const rows = db
    .prepare(
      `SELECT c.* FROM orbit_comments c WHERE c.post_id = ? AND c.parent_id IS NULL AND ${vis.sql} AND ${ks.sql}
        ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    )
    .all(postId, ...vis.params, ...ks.params, page.limit + 1) as CommentRow[];
  const paged = paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => r);
  return { items: serializeComments(paged.items, viewer.id), nextCursor: paged.nextCursor };
}

/* ───────────────────────────── create / delete ───────────────────────────── */

function loadVisibleComment(viewerId: Id, id: Id): CommentRow | null {
  const vis = visibleCommentsWhere(viewerId);
  return (db.prepare(`SELECT c.* FROM orbit_comments c WHERE c.id = ? AND ${vis.sql}`).get(id, ...vis.params) as CommentRow | undefined) ?? null;
}

export function createComment(
  user: AuthedUser,
  postId: Id,
  body: { text: string; parentId?: Id },
): { comment: PostComment; moderation: ReturnType<typeof toAuthorNotice> } {
  const post: PostRow = loadVisiblePost(user, postId);
  const text = body.text.trim();
  if (!text) throw new ApiError(400, 'validation_failed', 'Write a comment first.');

  // one level only: a reply to a reply is STORED under the top-level comment, but the person being answered is the
  // tapped comment's author — they get the `post.comment_reply` (not only the thread opener)
  let parent: CommentRow | null = null; // storage parent (always top-level)
  let answered: CommentRow | null = null; // the comment the viewer tapped "Reply" on
  if (body.parentId) {
    answered = loadVisibleComment(user.id, body.parentId);
    if (!answered || answered.post_id !== postId) throw ApiError.notFound(COMMENT_NOT_FOUND);
    parent = answered.parent_id ? loadVisibleComment(user.id, answered.parent_id) : answered;
    if (!parent) throw ApiError.notFound(COMMENT_NOT_FOUND);
  }

  enforceRateLimit(user, 'comment');
  const mod = moderateWrite([{ text, field: 'body' }], modCtx(user, 'comment'), blockedTarget(user, 'orbit_comment'));
  const status: Extract<ContentStatus, 'active' | 'held'> = mod.persistStatus ?? 'active';
  const at = now();
  const id = newId();

  tx(() => {
    prep(
      'INSERT INTO orbit_comments (id, post_id, author_id, parent_id, text, status, auto_hide_immune, reply_count, created_at) VALUES (?,?,?,?,?,?,0,0,?)',
    ).run(id, postId, user.id, parent?.id ?? null, text, status, at);
    commitModeration(mod, { ...blockedTarget(user, 'orbit_comment'), entityId: id });
    if (status === 'active') applyCommentCounters(id, +1);
  });

  if (status === 'active') {
    if (answered) {
      notify({
        userId: answered.author_id, type: 'post.comment_reply', actorId: user.id, href: `/post/${postId}`,
        target: { entityType: 'orbit_comment', entityId: answered.id }, data: { snippet: snippetOf(text), commentId: id },
      });
      if (post.author_id !== answered.author_id) {
        notify({
          userId: post.author_id, type: 'post.comment', actorId: user.id, href: `/post/${postId}`,
          target: { entityType: 'orbit_post', entityId: postId }, data: { snippet: snippetOf(text), commentId: id },
        });
      }
    } else {
      notify({
        userId: post.author_id, type: 'post.comment', actorId: user.id, href: `/post/${postId}`,
        target: { entityType: 'orbit_post', entityId: postId }, data: { snippet: snippetOf(text), commentId: id },
      });
    }
  }
  trackEvent('post_comment', { userId: user.id, universityId: user.universityId }, { reply: parent !== null, status });
  return { comment: serializeComment(getCommentRow(id)!, user.id), moderation: toAuthorNotice(mod) };
}

/** Keeps `orbit_posts.comment_count` / `orbit_comments.reply_count` equal to the ACTIVE rows. */
export function applyCommentCounters(commentId: Id, delta: 1 | -1): void {
  const row = getCommentRow(commentId);
  if (!row) return;
  const op = delta > 0 ? 'comment_count + 1' : 'MAX(comment_count - 1, 0)';
  prep(`UPDATE orbit_posts SET comment_count = ${op} WHERE id = ?`).run(row.post_id);
  if (row.parent_id) {
    const rop = delta > 0 ? 'reply_count + 1' : 'MAX(reply_count - 1, 0)';
    prep(`UPDATE orbit_comments SET reply_count = ${rop} WHERE id = ?`).run(row.parent_id);
  }
}

/** Own comment, or any comment on the viewer's own post. Cascades to replies. Non-owners → generic 404. */
export function deleteComment(user: AuthedUser, id: Id): void {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound(COMMENT_NOT_FOUND);
  const post = getPostRow(row.post_id);
  if (row.author_id !== user.id && post?.author_id !== user.id) throw ApiError.notFound(COMMENT_NOT_FOUND);
  tx(() => {
    const victims = [row, ...(row.parent_id === null ? (prep('SELECT * FROM orbit_comments WHERE parent_id = ?').all(row.id) as CommentRow[]) : [])];
    for (const v of victims) {
      if (v.status === 'deleted') continue;
      if (v.status === 'active') applyCommentCounters(v.id, -1);
      prep("UPDATE orbit_comments SET status = 'deleted' WHERE id = ?").run(v.id);
      removeNotificationsFor({ entityType: 'orbit_comment', entityId: v.id });
    }
  });
}
