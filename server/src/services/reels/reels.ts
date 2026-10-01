/**
 * Reels: rows, viewer-scoped queries, serializer and the write paths (SPEC §5.2, §3.1).
 * Every public list/detail ANDs in `sqlNotBlocked` + `sqlAuthorVisible` + `sqlNotReported` + the viewer's
 * "not interested" rows; authors additionally see their own held / hidden / removed rows.
 * Prepared statements are created lazily through `prep()` (R4: no DB work at import time).
 */
import type { ContentStatus, EpochMs, FeedScope, Id, Paginated, UserListItem, UserSummary } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { CreateReelRequest, LikeState, Reel } from '@shared/reels';
import { db, inClause, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { DAY, now } from '../../lib/clock';
import { sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, keysetWhere, paginate, type CursorValue } from '../../lib/http';
import { notify, removeNotificationsFor } from '../../lib/notify';
import { assertOwnUpload, type UploadRow } from '../../lib/uploads';
import { markPublicActivity, unmarkPublicActivity, userListItemsByIds, userSummariesByIds, type AuthedUser } from '../../lib/users';

/* ───────────────────────────── rows ───────────────────────────── */

export interface ReelRow {
  id: Id;
  author_id: Id;
  university_id: Id;
  caption: string;
  video_url: string;
  poster_url: string | null;
  duration_ms: number;
  width: number | null;
  height: number | null;
  visibility: FeedScope;
  status: ContentStatus;
  auto_hide_immune: number;
  like_count: number;
  comment_count: number;
  view_count: number;
  share_count: number;
  created_at: EpochMs;
  updated_at: EpochMs;
}

export const REEL_MAX_MS = LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs;
export const REEL_TOO_LONG = 'Reels max out at 60 seconds.';
export const FOLLOWING_WINDOW_MS = 7 * DAY;

export function getReelRow(id: Id): ReelRow | null {
  return (prep('SELECT * FROM reels WHERE id = ?').get(id) as ReelRow | undefined) ?? null;
}

export function reelHref(id: Id): string {
  return `/reel/${encodeURIComponent(id)}`;
}

/* ───────────────────────────── visibility ───────────────────────────── */

interface Clause {
  sql: string;
  params: (string | number)[];
}

/**
 * "May `viewer` see this row in a public list?" — active rows from visible, unblocked, unreported authors, plus the
 * viewer's own non-deleted rows (held / hidden / removed carry the author-only chip). `alias` = the reels table alias.
 */
export function visibleReelSql(viewerId: Id, alias = 'r'): Clause {
  const nb = sqlNotBlocked(viewerId, `${alias}.author_id`);
  const nr = sqlNotReported(viewerId, 'reel', `${alias}.id`);
  return {
    // visibility 'campus' reels stay on the author's campus (the author always sees their own).
    sql: `((${alias}.status = 'active' AND ${sqlAuthorVisible(`${alias}.author_id`)} AND ${nb.sql} AND ${nr.sql}
            AND (${alias}.visibility = 'global' OR ${alias}.author_id = ?
                 OR ${alias}.university_id = (SELECT _vu.university_id FROM users _vu WHERE _vu.id = ?)))
           OR (${alias}.author_id = ? AND ${alias}.status IN ('held','hidden','removed')))`,
    params: [...nb.params, ...nr.params, viewerId, viewerId, viewerId],
  };
}

function notHiddenSql(viewerId: Id, alias = 'r'): Clause {
  return { sql: `NOT EXISTS (SELECT 1 FROM reel_hidden _rh WHERE _rh.user_id = ? AND _rh.reel_id = ${alias}.id)`, params: [viewerId] };
}

/** True when the viewer may interact with (like / view / comment on) the reel: active + visible, or their own. */
export function canSeeReel(viewer: AuthedUser, row: ReelRow): boolean {
  if (row.status === 'deleted') return false;
  if (row.author_id === viewer.id) return true;
  if (row.status !== 'active') return false;
  const vis = visibleReelSql(viewer.id, 'r');
  return prep(`SELECT 1 FROM reels r WHERE r.id = ? AND ${vis.sql}`).get(row.id, ...vis.params) !== undefined;
}

/** The reel the viewer may see, else the generic 404. */
export function requireVisibleReel(viewer: AuthedUser, id: Id): ReelRow {
  const row = getReelRow(id);
  if (!row || !canSeeReel(viewer, row)) throw ApiError.notFound("This reel isn't available");
  return row;
}

/* ───────────────────────────── serializer ───────────────────────────── */

const cursorKey = (r: ReelRow): CursorValue => ({ k: r.created_at, id: r.id });

function viewerSets(viewerId: Id, rows: ReelRow[]): { liked: Set<Id>; following: Set<Id> } {
  const liked = new Set<Id>();
  const following = new Set<Id>();
  if (rows.length === 0) return { liked, following };
  const reelIds = inClause(rows.map((r) => r.id));
  for (const r of db.prepare(`SELECT reel_id AS id FROM reel_likes WHERE user_id = ? AND reel_id IN ${reelIds.sql}`).all(viewerId, ...reelIds.params) as { id: Id }[]) liked.add(r.id);
  const authorIds = inClause([...new Set(rows.map((r) => r.author_id))]);
  for (const r of db.prepare(`SELECT followee_id AS id FROM follows WHERE follower_id = ? AND followee_id IN ${authorIds.sql}`).all(viewerId, ...authorIds.params) as { id: Id }[]) following.add(r.id);
  return { liked, following };
}

function toReel(row: ReelRow, viewerId: Id, authors: Map<Id, UserSummary>, liked: Set<Id>, following: Set<Id>): Reel {
  const author = authors.get(row.author_id) ?? tombstoneAuthor(row.author_id, row.university_id);
  return {
    id: row.id,
    author,
    caption: row.caption,
    videoUrl: row.video_url,
    posterUrl: row.poster_url,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    visibility: row.visibility,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    viewCount: row.view_count,
    viewer: { liked: liked.has(row.id), isSelf: row.author_id === viewerId, isFollowingAuthor: following.has(row.author_id) },
    status: row.status,
    createdAt: row.created_at,
  };
}

function tombstoneAuthor(id: Id, universityId: Id): UserSummary {
  return {
    id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '/api/avatars/deleted.svg?t=student',
    accountType: 'student', isVerified: false, universityId, universityShortName: 'Campus',
  };
}

/** Batch serializer: one query for authors, one for likes, one for follows. */
export function serializeReels(rows: ReelRow[], viewerId: Id): Reel[] {
  if (rows.length === 0) return [];
  const authors = userSummariesByIds([...new Set(rows.map((r) => r.author_id))]);
  const { liked, following } = viewerSets(viewerId, rows);
  return rows.map((r) => toReel(r, viewerId, authors, liked, following));
}

export function serializeReel(row: ReelRow, viewerId: Id): Reel {
  return serializeReels([row], viewerId)[0]!;
}

/* ───────────────────────────── lists ───────────────────────────── */

interface Page {
  cursor?: string;
  limit: number;
}

function pageRows(where: string, params: (string | number)[], page: Page): Paginated<ReelRow> {
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('r.created_at', 'r.id', cur, 'desc');
  const rows = db
    .prepare(`SELECT r.* FROM reels r WHERE ${where} AND ${ks.sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`)
    .all(...params, ...ks.params, page.limit + 1) as ReelRow[];
  return paginate(rows, page.limit, cursorKey, (r) => r);
}

function toPage(p: Paginated<ReelRow>, viewerId: Id): Paginated<Reel> {
  return { items: serializeReels(p.items, viewerId), nextCursor: p.nextCursor };
}

/** campus: `university_id = viewer's`; global: `visibility = 'global'` from any campus. Newest first; excludes "not interested". */
export function listFeed(viewer: AuthedUser, scope: FeedScope, page: Page): Paginated<Reel> {
  const vis = visibleReelSql(viewer.id);
  const nh = notHiddenSql(viewer.id);
  const scopeSql = scope === 'campus' ? 'r.university_id = ?' : "r.visibility = 'global'";
  const scopeParams = scope === 'campus' ? [viewer.universityId] : [];
  return toPage(pageRows(`${vis.sql} AND ${nh.sql} AND ${scopeSql}`, [...vis.params, ...nh.params, ...scopeParams], page), viewer.id);
}

/** Reels by accounts the viewer follows, last 7 days, newest first (the `FollowingReelsRail`). */
export function listFollowing(viewer: AuthedUser, page: Page): Paginated<Reel> {
  const vis = visibleReelSql(viewer.id);
  const nh = notHiddenSql(viewer.id);
  const where = `r.status = 'active' AND ${vis.sql} AND ${nh.sql} AND r.created_at > ?
    AND EXISTS (SELECT 1 FROM follows _f WHERE _f.follower_id = ? AND _f.followee_id = r.author_id)`;
  return toPage(pageRows(where, [...vis.params, ...nh.params, now() - FOLLOWING_WINDOW_MS, viewer.id], page), viewer.id);
}

/** One author's reels (the profile grid). Self sees every non-deleted row; others see active + visible only. */
export function listByUser(viewer: AuthedUser, userId: Id, page: Page): Paginated<Reel> {
  if (userId === viewer.id) {
    return toPage(pageRows("r.author_id = ? AND r.status != 'deleted'", [userId], page), viewer.id);
  }
  const vis = visibleReelSql(viewer.id);
  return toPage(pageRows(`r.author_id = ? AND r.status = 'active' AND ${vis.sql}`, [userId, ...vis.params], page), viewer.id);
}

/**
 * People who liked the reel (newest first), as a public list. Blocked (either way) and non-active likers are filtered
 * in SQL before the page cut, so a page is never short while a cursor remains; `userListItemsByIds` only serialises.
 */
export function listLikers(viewer: AuthedUser, reelId: Id, page: Page): Paginated<UserListItem> {
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('l.created_at', 'l.user_id', cur, 'desc');
  const nb = sqlNotBlocked(viewer.id, 'l.user_id');
  const rows = db
    .prepare(
      `SELECT l.user_id AS id, l.created_at FROM reel_likes l
        WHERE l.reel_id = ? AND ${sqlAuthorVisible('l.user_id')} AND ${nb.sql} AND ${ks.sql}
        ORDER BY l.created_at DESC, l.user_id DESC LIMIT ?`,
    )
    .all(reelId, ...nb.params, ...ks.params, page.limit + 1) as { id: Id; created_at: EpochMs }[];
  const p = paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => r.id);
  return { items: userListItemsByIds(p.items, viewer.id), nextCursor: p.nextCursor };
}

/* ───────────────────────────── writes ───────────────────────────── */

export interface ReelUploads {
  video: UploadRow;
  poster: UploadRow | null;
  /** The upload's measured length (non-null, ≤ REEL_MAX_MS). */
  durationMs: number;
}

/**
 * Resolves + validates the uploads (own, right kind, ≤ 60.5 s): 404 for someone else's / the wrong kind, 422 when too
 * long. The route runs this BEFORE `enforceRateLimit`, so a request that cannot be written spends no `reel_upload` token.
 */
export function resolveReelUploads(user: AuthedUser, body: Pick<CreateReelRequest, 'videoUploadId' | 'posterUploadId'>): ReelUploads {
  const video = assertOwnUpload(user, body.videoUploadId, 'video');
  const durationMs = video.duration_ms;
  if (durationMs === null) throw new ApiError(400, 'validation_failed', "We couldn't read the video length. Try a different file.");
  if (durationMs > REEL_MAX_MS) throw new ApiError(422, 'validation_failed', REEL_TOO_LONG, { durationMs, maxMs: REEL_MAX_MS });
  const poster = body.posterUploadId ? assertOwnUpload(user, body.posterUploadId, 'image') : null;
  return { video, poster, durationMs };
}

export interface CreateReelInput {
  user: AuthedUser;
  body: CreateReelRequest;
  uploads: ReelUploads;
  status: Extract<ContentStatus, 'active' | 'held'>;
}

/** Inserts the row from already-resolved uploads (`resolveReelUploads`), marks public activity when active. */
export function createReel(input: CreateReelInput): ReelRow {
  const { user, body } = input;
  const { video, poster, durationMs } = input.uploads;
  const at = now();
  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO reels (id, author_id, university_id, caption, video_url, poster_url, duration_ms, width, height, visibility, status,
         created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, user.id, user.universityId, body.caption, video.url, poster?.url ?? null, Math.min(durationMs, LIMITS.reelMaxDurationMs),
      video.width, video.height, body.visibility, input.status, at, at,
    );
    if (input.status === 'active') markPublicActivity(user.id, 'reel', id, at);
  });
  trackEvent('reel_upload', { userId: user.id, universityId: user.universityId }, { visibility: body.visibility, durationMs });
  return getReelRow(id)!;
}

/** Own reels only (generic 404 otherwise). Status `deleted`, public activity unmarked, notifications removed. */
export function deleteReel(user: AuthedUser, id: Id): void {
  const row = getReelRow(id);
  if (!row || row.status === 'deleted' || row.author_id !== user.id) throw ApiError.notFound("This reel isn't available");
  tx(() => {
    prep("UPDATE reels SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), id);
    unmarkPublicActivity('reel', id);
    removeNotificationsFor({ entityType: 'reel', entityId: id });
    const comments = prep('SELECT id FROM reel_comments WHERE reel_id = ?').all(id) as { id: Id }[];
    for (const c of comments) removeNotificationsFor({ entityType: 'reel_comment', entityId: c.id });
  });
}

function likeState(reelId: Id, viewerId: Id): LikeState {
  const count = (prep('SELECT like_count AS n FROM reels WHERE id = ?').get(reelId) as { n: number } | undefined)?.n ?? 0;
  const liked = prep('SELECT 1 FROM reel_likes WHERE reel_id = ? AND user_id = ?').get(reelId, viewerId) !== undefined;
  return { liked, likeCount: count };
}

/** Idempotent; the counter equals the rows; `notify('reel.like')` to the author (no-op for self). */
export function likeReel(viewer: AuthedUser, id: Id): LikeState {
  const row = requireVisibleReel(viewer, id);
  const inserted = tx(() => {
    const res = prep('INSERT OR IGNORE INTO reel_likes (reel_id, user_id, created_at) VALUES (?,?,?)').run(id, viewer.id, now());
    if (res.changes === 0) return false;
    prep('UPDATE reels SET like_count = like_count + 1 WHERE id = ?').run(id);
    return true;
  });
  if (inserted) {
    if (row.status === 'active') {
      notify({
        userId: row.author_id, type: 'reel.like', actorId: viewer.id, href: reelHref(id),
        target: { entityType: 'reel', entityId: id }, thumbnailUrl: row.poster_url, data: { caption: row.caption.slice(0, 80) },
      });
    }
    trackEvent('reel_like', { userId: viewer.id, universityId: viewer.universityId });
  }
  return likeState(id, viewer.id);
}

export function unlikeReel(viewer: AuthedUser, id: Id): LikeState {
  const row = getReelRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This reel isn't available");
  tx(() => {
    const res = prep('DELETE FROM reel_likes WHERE reel_id = ? AND user_id = ?').run(id, viewer.id);
    if (res.changes > 0) prep('UPDATE reels SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(id);
  });
  return likeState(id, viewer.id);
}

/** One `reel_views` row per viewer (view_count = distinct viewers); `completed` flips once. */
export function recordView(viewer: AuthedUser, id: Id, completed: boolean): void {
  const row = requireVisibleReel(viewer, id);
  const at = now();
  const { firstView, firstComplete } = tx(() => {
    const res = prep('INSERT OR IGNORE INTO reel_views (reel_id, user_id, completed, first_viewed_at) VALUES (?,?,?,?)').run(id, viewer.id, completed ? 1 : 0, at);
    let firstView = false;
    let firstComplete = false;
    if (res.changes > 0) {
      firstView = true;
      firstComplete = completed;
      prep('UPDATE reels SET view_count = view_count + 1 WHERE id = ?').run(id);
    } else if (completed) {
      const upd = prep('UPDATE reel_views SET completed = 1 WHERE reel_id = ? AND user_id = ? AND completed = 0').run(id, viewer.id);
      firstComplete = upd.changes > 0;
    }
    return { firstView, firstComplete };
  });
  const ctx = { userId: viewer.id, universityId: viewer.universityId };
  if (firstView) trackEvent('reel_view', ctx, { authorCampus: row.university_id === viewer.universityId ? 'campus' : 'global' });
  if (firstComplete) trackEvent('reel_complete', ctx);
}

/** "Not interested": the reel leaves this viewer's feeds. Idempotent. */
export function hideReel(viewer: AuthedUser, id: Id): void {
  const row = getReelRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This reel isn't available");
  prep('INSERT OR IGNORE INTO reel_hidden (user_id, reel_id, created_at) VALUES (?,?,?)').run(viewer.id, id, now());
}

/* ───────────────────────────── moderation status (content adapter) ───────────────────────────── */

/** Keeps `public_activity` + `users.reel_count` in sync and drops notifications on removal. */
export function setReelStatus(id: Id, status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>, opts?: { immune?: boolean }): void {
  const row = getReelRow(id);
  if (!row || row.status === 'deleted') return;
  tx(() => {
    if (row.status !== status) prep('UPDATE reels SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
    if (opts?.immune !== undefined) prep('UPDATE reels SET auto_hide_immune = ? WHERE id = ?').run(opts.immune ? 1 : 0, id);
    if (status === 'active') markPublicActivity(row.author_id, 'reel', id, row.created_at);
    else unmarkPublicActivity('reel', id);
    if (status === 'removed') removeNotificationsFor({ entityType: 'reel', entityId: id });
  });
}
