/**
 * Orbit posts (SPEC §5.4, DECISIONS D8): rows → `Post`, the feed (follows ∪ self ∪ campus highlights), per-user lists,
 * detail, create / delete, likes, polls. Every public read ANDs in `sqlNotBlocked` + `sqlAuthorVisible` +
 * `sqlNotReported`; authors also see their own held / hidden / removed rows (never `deleted`). No import-time DB access
 * (R4): statements are prepared lazily.
 */
import type { ContentStatus, EpochMs, Id, MediaImage, UserListItem, UserSummary } from '@shared/core';
import type { CreatePostRequest, LikeState, OrbitFeedResponse, OrbitHighlight, Post, PostPoll } from '@shared/orbit';
import { db, inClause, json, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { DAY, HOUR, now } from '../../lib/clock';
import { followerIdsOf, sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, keysetWhere, paginate, type CursorValue } from '../../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite, toAuthorNotice } from '../../lib/moderation/index';
import { assertAccountAge, enforceRateLimit } from '../../lib/rateLimit';
import { notify, removeNotificationsFor } from '../../lib/notify';
import { publishToUsers } from '../../lib/realtime';
import { assertOwnImages } from '../../lib/uploads';
import {
  markPublicActivity, NEW_ACCOUNT_WINDOW_MS, unmarkPublicActivity, userListItemsByIds, userSummariesByIds, type AuthedUser,
} from '../../lib/users';

/* ───────────────────────────── rows ───────────────────────────── */

export interface PostRow {
  id: Id;
  author_id: Id;
  university_id: Id;
  text: string;
  images_json: string;
  has_poll: number;
  status: ContentStatus;
  auto_hide_immune: number;
  like_count: number;
  comment_count: number;
  created_at: EpochMs;
  updated_at: EpochMs;
}

interface PollOptionRow {
  id: Id;
  post_id: Id;
  idx: number;
  text: string;
  vote_count: number;
}

export const POST_NOT_FOUND = "This post isn't available";

export function getPostRow(id: Id): PostRow | null {
  return (prep('SELECT * FROM orbit_posts WHERE id = ?').get(id) as PostRow | undefined) ?? null;
}

/* ───────────────────────────── visibility ───────────────────────────── */

/**
 * The WHERE fragment every public read of `orbit_posts p` ANDs in for `viewerId`:
 * active rows from visible, unblocked, unreported authors — plus the viewer's own non-deleted rows.
 */
export function visiblePostsWhere(viewerId: Id): { sql: string; params: (string | number)[] } {
  const nb = sqlNotBlocked(viewerId, 'p.author_id');
  const nr = sqlNotReported(viewerId, 'orbit_post', 'p.id');
  return {
    sql: `(p.status = 'active' OR (p.author_id = ? AND p.status != 'deleted'))
      AND ${nb.sql} AND ${sqlAuthorVisible('p.author_id')} AND ${nr.sql}`,
    params: [viewerId, ...nb.params, ...nr.params],
  };
}

/** Feed membership, part 1: authors the viewer follows (any campus), plus the viewer. */
function feedAuthorsWhere(viewerId: Id): { sql: string; params: string[] } {
  return {
    sql: '(p.author_id = ? OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))',
    params: [viewerId, viewerId],
  };
}

/* ───────────────────────────── campus highlights (DECISIONS D8) ───────────────────────────── */

/** How far back a campus post can count as popular. */
export const HIGHLIGHT_WINDOW_MS = 7 * DAY;
/** How long a verified campus org's post counts as an official update. */
export const OFFICIAL_WINDOW_MS = 3 * DAY;
/** "Popular" never means less than this, however quiet the campus is. */
export const HIGHLIGHT_MIN_SCORE = 5;
/** Below this many campus posts in the window there is no meaningful "typical post": the floor alone applies. */
export const HIGHLIGHT_MEDIAN_SAMPLE = 10;

/** Engagement of `orbit_posts p`: likes + 2 × comments (a conversation) + half the poll votes. */
const SCORE_SQL = `(p.like_count + 2 * p.comment_count + COALESCE((SELECT SUM(_po.vote_count) FROM orbit_poll_options _po WHERE _po.post_id = p.id), 0) / 2)`;

export interface HighlightRule {
  /** Posts created before this are never highlights. */
  since: EpochMs;
  /** Verified-org posts created at or after this are "official" highlights without needing engagement. */
  officialSince: EpochMs;
  /** Engagement a campus post needs to be "popular". */
  minScore: number;
}

/**
 * "Popular" = more engagement than the typical (lower-median) active post of that campus in the window — so the bar
 * scales with the campus — and never less than `HIGHLIGHT_MIN_SCORE`. With fewer than `HIGHLIGHT_MEDIAN_SAMPLE` posts
 * in the window only the floor applies (a handful of posts has no "typical").
 */
export function campusHighlightRule(universityId: Id, at: EpochMs = now()): HighlightRule {
  const since = at - HIGHLIGHT_WINDOW_MS;
  const scores = (
    db
      .prepare(`SELECT ${SCORE_SQL} AS s FROM orbit_posts p WHERE p.university_id = ? AND p.status = 'active' AND p.created_at >= ? ORDER BY s`)
      .all(universityId, since) as { s: number }[]
  ).map((r) => r.s);
  const median = scores.length >= HIGHLIGHT_MEDIAN_SAMPLE ? scores[Math.floor((scores.length - 1) / 2)]! : 0;
  return { since, officialSince: at - OFFICIAL_WINDOW_MS, minScore: Math.max(HIGHLIGHT_MIN_SCORE, median + 1) };
}

/**
 * Feed membership, part 2 — campus highlights: posts from the viewer's OWN campus by someone they don't follow, active,
 * inside the window, that are popular (or a recent post by a verified campus org). Only established accounts are ever
 * pushed to non-followers: never a minor's post, never an account younger than 72 h, never one still restricted after a
 * suspension. Blocks, reports and author status apply on top through `visiblePostsWhere`.
 */
function highlightWhere(viewer: Pick<AuthedUser, 'id' | 'universityId'>, rule: HighlightRule, at: EpochMs): { sql: string; params: (string | number)[] } {
  return {
    sql: `(p.university_id = ? AND p.author_id != ? AND p.status = 'active' AND p.created_at >= ?
      AND NOT EXISTS (SELECT 1 FROM follows _hf WHERE _hf.follower_id = ? AND _hf.followee_id = p.author_id)
      AND EXISTS (SELECT 1 FROM users _hu WHERE _hu.id = p.author_id
        AND (_hu.account_type = 'org' OR _hu.is_adult = 1)
        AND _hu.created_at <= ?
        AND (_hu.restricted_until IS NULL OR _hu.restricted_until <= ?)
        AND (${SCORE_SQL} >= ? OR (_hu.account_type = 'org' AND _hu.is_verified = 1 AND p.created_at >= ?))))`,
    params: [viewer.universityId, viewer.id, rule.since, viewer.id, at - NEW_ACCOUNT_WINDOW_MS, at, rule.minScore, rule.officialSince],
  };
}

/** The post as `viewer` may see it, else the generic 404. */
export function loadVisiblePost(viewer: AuthedUser, id: Id): PostRow {
  const vis = visiblePostsWhere(viewer.id);
  const row = db.prepare(`SELECT p.* FROM orbit_posts p WHERE p.id = ? AND ${vis.sql}`).get(id, ...vis.params) as PostRow | undefined;
  if (!row) throw ApiError.notFound(POST_NOT_FOUND);
  return row;
}

/* ───────────────────────────── serializers ───────────────────────────── */

export function pollFor(postId: Id, viewerId: Id | null): PostPoll {
  return pollsFor([postId], viewerId).get(postId)!;
}

/**
 * Batch: the options of every poll in `postIds` plus the viewer's votes, two statements per 400 ids (a feed page
 * full of polls must not cost two queries per row). Every requested id gets an entry (empty poll if no options).
 */
export function pollsFor(postIds: readonly Id[], viewerId: Id | null): Map<Id, PostPoll> {
  const out = new Map<Id, PostPoll>();
  if (postIds.length === 0) return out;
  const options = new Map<Id, PollOptionRow[]>();
  const mine = new Map<Id, Id>();
  for (let i = 0; i < postIds.length; i += 400) {
    const inc = inClause(postIds.slice(i, i + 400));
    for (const o of db.prepare(`SELECT * FROM orbit_poll_options WHERE post_id IN ${inc.sql} ORDER BY post_id, idx`).all(...inc.params) as PollOptionRow[]) {
      const list = options.get(o.post_id) ?? [];
      list.push(o);
      options.set(o.post_id, list);
    }
    if (viewerId) {
      const votes = db
        .prepare(`SELECT post_id, option_id FROM orbit_poll_votes WHERE user_id = ? AND post_id IN ${inc.sql}`)
        .all(viewerId, ...inc.params) as { post_id: Id; option_id: Id }[];
      for (const v of votes) mine.set(v.post_id, v.option_id);
    }
  }
  for (const postId of postIds) {
    const opts = options.get(postId) ?? [];
    const total = opts.reduce((n, o) => n + o.vote_count, 0);
    out.set(postId, {
      options: opts.map((o) => ({ id: o.id, text: o.text, votes: o.vote_count, pct: total === 0 ? 0 : Math.round((o.vote_count / total) * 100) })),
      totalVotes: total,
      myChoice: mine.get(postId) ?? null,
    });
  }
  return out;
}

export function postImages(row: Pick<PostRow, 'images_json'>): MediaImage[] {
  const raw = json<unknown>(row.images_json, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is MediaImage => !!i && typeof i === 'object' && typeof (i as MediaImage).url === 'string')
    .map((i) => ({ url: i.url, width: i.width ?? null, height: i.height ?? null, ...(i.alt ? { alt: i.alt } : {}) }));
}

/** Batch serializer: one users lookup + one likes lookup + one polls lookup for the whole page. */
export function serializePosts(rows: PostRow[], viewerId: Id): Post[] {
  if (rows.length === 0) return [];
  const authors = userSummariesByIds(rows.map((r) => r.author_id));
  const ids = rows.map((r) => r.id);
  const liked = new Set<Id>();
  for (let i = 0; i < ids.length; i += 400) {
    const inc = inClause(ids.slice(i, i + 400));
    for (const r of db.prepare(`SELECT post_id FROM orbit_likes WHERE user_id = ? AND post_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { post_id: Id }[]) {
      liked.add(r.post_id);
    }
  }
  const polls = pollsFor(rows.filter((r) => r.has_poll).map((r) => r.id), viewerId);
  return rows.map((row) => {
    const author = authors.get(row.author_id) ?? tombstone(row.author_id);
    return toPost(row, author, liked.has(row.id), polls.get(row.id) ?? null, viewerId);
  });
}

export function serializePost(row: PostRow, viewerId: Id): Post {
  return serializePosts([row], viewerId)[0]!;
}

function tombstone(id: Id): UserSummary {
  return {
    id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '/api/avatars/deleted.svg?t=student', accountType: 'student',
    isVerified: false, universityId: '', universityShortName: '',
  };
}

function toPost(row: PostRow, author: UserSummary, liked: boolean, poll: PostPoll | null, viewerId: Id): Post {
  return {
    id: row.id,
    author,
    text: row.text,
    images: postImages(row),
    poll: row.has_poll ? poll : null,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    viewer: { liked, isSelf: row.author_id === viewerId },
    status: row.status,
    createdAt: row.created_at,
  };
}

/* ───────────────────────────── reads ───────────────────────────── */

const postKey = (r: PostRow): CursorValue => ({ k: r.created_at, id: r.id });

type FeedRow = PostRow & { _score: number; _followed: number };

/**
 * Follows ∪ self (any campus) ∪ campus highlights, strictly `created_at DESC, id DESC` — highlights are interleaved by
 * time, never pinned or re-ranked, so paging and "New since your last visit" keep working. A highlight carries
 * `highlight: 'popular' | 'official'` so the card can say why it is there.
 */
export function listFeed(viewer: AuthedUser, page: { cursor?: string; limit: number }): OrbitFeedResponse {
  const at = now();
  const cur = decodeCursor(page.cursor);
  const vis = visiblePostsWhere(viewer.id);
  const who = feedAuthorsWhere(viewer.id);
  const rule = campusHighlightRule(viewer.universityId, at);
  const hl = highlightWhere(viewer, rule, at);
  const ks = keysetWhere('p.created_at', 'p.id', cur, 'desc');
  const rows = db
    .prepare(
      `SELECT p.*, ${SCORE_SQL} AS _score, ${who.sql} AS _followed FROM orbit_posts p
        WHERE (${who.sql} OR ${hl.sql}) AND ${vis.sql} AND ${ks.sql}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    )
    .all(...who.params, ...who.params, ...hl.params, ...vis.params, ...ks.params, page.limit + 1) as FeedRow[];
  const paged = paginate(rows, page.limit, postKey, (r) => r);
  const posts = serializePosts(paged.items, viewer.id);
  const items = posts.map((post, i): Post => {
    const row = paged.items[i]!;
    if (row._followed) return post;
    const highlight: OrbitHighlight = row._score >= rule.minScore ? 'popular' : 'official';
    return { ...post, highlight };
  });
  const visit = prep('SELECT last_seen_at FROM orbit_visits WHERE user_id = ?').get(viewer.id) as { last_seen_at: EpochMs } | undefined;
  const following = prep('SELECT following_count AS n FROM users WHERE id = ?').get(viewer.id) as { n: number } | undefined;
  return {
    items,
    nextCursor: paged.nextCursor,
    lastVisitAt: visit?.last_seen_at ?? null,
    followingCount: following?.n ?? 0,
  };
}

/**
 * How many posts from FOLLOWED authors (and the viewer) arrived after `since` (the client's newest loaded `createdAt`).
 * Campus highlights never drive the "New posts" pill: they are picked up on the next refresh.
 */
export function countNewSince(viewer: AuthedUser, since: EpochMs): number {
  const vis = visiblePostsWhere(viewer.id);
  const who = feedAuthorsWhere(viewer.id);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM orbit_posts p WHERE ${who.sql} AND ${vis.sql} AND p.created_at > ?`)
    .get(...who.params, ...vis.params, since) as { n: number };
  return row.n;
}

export function markFeedSeen(viewerId: Id, at: EpochMs = now()): void {
  prep('INSERT INTO orbit_visits (user_id, last_seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at').run(
    viewerId, at,
  );
}

/** A user's posts (self also sees their own non-active rows through `visiblePostsWhere`). */
export function listUserPosts(viewer: AuthedUser, userId: Id, page: { cursor?: string; limit: number }): { items: Post[]; nextCursor: string | null } {
  const cur = decodeCursor(page.cursor);
  const vis = visiblePostsWhere(viewer.id);
  const ks = keysetWhere('p.created_at', 'p.id', cur, 'desc');
  const rows = db
    .prepare(`SELECT p.* FROM orbit_posts p WHERE p.author_id = ? AND ${vis.sql} AND ${ks.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .all(userId, ...vis.params, ...ks.params, page.limit + 1) as PostRow[];
  const paged = paginate(rows, page.limit, postKey, (r) => r);
  return { items: serializePosts(paged.items, viewer.id), nextCursor: paged.nextCursor };
}

export function listLikers(viewer: AuthedUser, postId: Id, page: { cursor?: string; limit: number }): { items: UserListItem[]; nextCursor: string | null } {
  loadVisiblePost(viewer, postId);
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('l.created_at', 'l.user_id', cur, 'desc');
  const rows = db
    .prepare(`SELECT l.user_id, l.created_at FROM orbit_likes l WHERE l.post_id = ? AND ${ks.sql} ORDER BY l.created_at DESC, l.user_id DESC LIMIT ?`)
    .all(postId, ...ks.params, page.limit + 1) as { user_id: Id; created_at: EpochMs }[];
  const paged = paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.user_id }), (r) => r.user_id);
  return { items: userListItemsByIds(paged.items, viewer.id), nextCursor: paged.nextCursor };
}

/* ───────────────────────────── create / delete ───────────────────────────── */

export const POLL_MIN_ACCOUNT_AGE_MS = 24 * HOUR;

export function createPost(user: AuthedUser, body: CreatePostRequest): { post: Post; moderation: ReturnType<typeof toAuthorNotice> } {
  const text = body.text.trim();
  const images = body.images ?? [];
  const pollOptions = (body.poll?.options ?? []).map((o) => o.trim());
  if (!text && images.length === 0 && pollOptions.length === 0) {
    throw new ApiError(400, 'validation_failed', 'Write something, add a photo or start a poll.');
  }
  if (pollOptions.length > 0) assertAccountAge(user, POLL_MIN_ACCOUNT_AGE_MS, 'Polls unlock 24 hours after you join.');
  enforceRateLimit(user, 'orbit_post');
  const cleanImages = assertOwnImages(user, images, 4);

  const mod = moderateWrite(
    [{ text, field: 'body' }, ...pollOptions.map((o) => ({ text: o, field: 'option' as const }))],
    modCtx(user, 'orbit_post'),
    blockedTarget(user, 'orbit_post'),
  );
  const status: Extract<ContentStatus, 'active' | 'held'> = mod.persistStatus ?? 'active';
  const at = now();
  const id = newId();

  tx(() => {
    prep(
      `INSERT INTO orbit_posts (id, author_id, university_id, text, images_json, has_poll, status, auto_hide_immune, like_count, comment_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,0,0,0,?,?)`,
    ).run(id, user.id, user.universityId, text, JSON.stringify(cleanImages), pollOptions.length > 0 ? 1 : 0, status, at, at);
    const insOpt = prep('INSERT INTO orbit_poll_options (id, post_id, idx, text, vote_count) VALUES (?,?,?,?,0)');
    pollOptions.forEach((o, idx) => insOpt.run(newId(), id, idx, o));
    commitModeration(mod, { ...blockedTarget(user, 'orbit_post'), entityId: id });
    if (status === 'active') markPublicActivity(user.id, 'post', id, at);
  });

  if (status === 'active') {
    const followers = followerIdsOf(user.id);
    if (followers.length > 0) publishToUsers(followers, { type: 'orbit.new_post' });
  }
  trackEvent('post_create', { userId: user.id, universityId: user.universityId }, {
    hasImages: cleanImages.length > 0, hasPoll: pollOptions.length > 0, status,
  });
  const row = getPostRow(id)!;
  return { post: serializePost(row, user.id), moderation: toAuthorNotice(mod) };
}

/** Own only; non-owners get the same 404 as a missing post. */
export function deletePost(user: AuthedUser, id: Id): void {
  const row = getPostRow(id);
  if (!row || row.author_id !== user.id || row.status === 'deleted') throw ApiError.notFound(POST_NOT_FOUND);
  tx(() => {
    prep("UPDATE orbit_posts SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), id);
    unmarkPublicActivity('post', id);
    purgePostNotifications(id);
  });
}

/**
 * Drops every notification that deep-links to `/post/:id`: the post's own rows (likes, comments) AND the
 * comment-targeted `post.comment_reply` rows of every comment on it. Shared by the author delete and staff removal.
 */
export function purgePostNotifications(postId: Id): void {
  removeNotificationsFor({ entityType: 'orbit_post', entityId: postId });
  const comments = prep('SELECT id FROM orbit_comments WHERE post_id = ?').all(postId) as { id: Id }[];
  for (const c of comments) removeNotificationsFor({ entityType: 'orbit_comment', entityId: c.id });
}

/* ───────────────────────────── likes ───────────────────────────── */

function likeCount(postId: Id): number {
  return (prep('SELECT like_count AS n FROM orbit_posts WHERE id = ?').get(postId) as { n: number } | undefined)?.n ?? 0;
}

export function likePost(viewer: AuthedUser, postId: Id): LikeState {
  const row = loadVisiblePost(viewer, postId);
  const inserted = tx(() => {
    const res = prep('INSERT OR IGNORE INTO orbit_likes (post_id, user_id, created_at) VALUES (?,?,?)').run(postId, viewer.id, now());
    if (res.changes === 0) return false;
    prep('UPDATE orbit_posts SET like_count = like_count + 1 WHERE id = ?').run(postId);
    return true;
  });
  if (inserted) {
    notify({
      userId: row.author_id,
      type: 'post.like',
      actorId: viewer.id,
      href: `/post/${row.id}`,
      target: { entityType: 'orbit_post', entityId: row.id },
      thumbnailUrl: postImages(row)[0]?.url ?? null,
      data: { snippet: snippetOf(row.text) },
    });
    trackEvent('post_like', { userId: viewer.id, universityId: viewer.universityId });
  }
  return { liked: true, likeCount: likeCount(postId) };
}

export function unlikePost(viewer: AuthedUser, postId: Id): LikeState {
  loadVisiblePost(viewer, postId);
  tx(() => {
    const res = prep('DELETE FROM orbit_likes WHERE post_id = ? AND user_id = ?').run(postId, viewer.id);
    if (res.changes > 0) prep('UPDATE orbit_posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(postId);
  });
  return { liked: false, likeCount: likeCount(postId) };
}

/* ───────────────────────────── polls ───────────────────────────── */

/** One vote per viewer; a repeat with the same option is idempotent, a different option → 409. */
export function votePoll(viewer: AuthedUser, postId: Id, optionId: Id): PostPoll {
  const row = loadVisiblePost(viewer, postId);
  if (!row.has_poll) throw ApiError.badRequest('This post has no poll.');
  const option = prep('SELECT * FROM orbit_poll_options WHERE id = ? AND post_id = ?').get(optionId, postId) as PollOptionRow | undefined;
  if (!option) throw new ApiError(400, 'validation_failed', 'That option is not part of this poll.');
  tx(() => {
    const existing = prep('SELECT option_id FROM orbit_poll_votes WHERE post_id = ? AND user_id = ?').get(postId, viewer.id) as { option_id: Id } | undefined;
    if (existing) {
      if (existing.option_id !== optionId) throw ApiError.conflict("You've already voted in this poll.");
      return;
    }
    prep('INSERT INTO orbit_poll_votes (post_id, user_id, option_id, created_at) VALUES (?,?,?,?)').run(postId, viewer.id, optionId, now());
    prep('UPDATE orbit_poll_options SET vote_count = vote_count + 1 WHERE id = ?').run(optionId);
  });
  return pollFor(postId, viewer.id);
}

/* ───────────────────────────── helpers ───────────────────────────── */

export function snippetOf(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
