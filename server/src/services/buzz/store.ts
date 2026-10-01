/**
 * Buzz row access (slice-private). Prepared statements are created lazily through `prep()` (R4: no import-time DB work).
 * Nothing here serializes: every row → JSON exit is `serialize.ts`.
 */
import type { ContentStatus, EpochMs, FeedScope, Id } from '@shared/core';
import { db, inClause, newId, prep } from '../../db/index';
import { DAY, now } from '../../lib/clock';
import { decodeCursor, encodeCursor, keysetWhere, type CursorValue } from '../../lib/http';
import { sqlNotReported } from '../../lib/graph';
import type { BuzzSort, BuzzTopWindow } from '@shared/buzz';

export interface BuzzRow {
  id: Id;
  root_id: Id | null;
  parent_id: Id | null;
  depth: number;
  author_id: Id;
  university_id: Id;
  text: string;
  prompt_id: Id | null;
  status: ContentStatus;
  auto_hide_immune: number;
  locked: number;
  upvotes: number;
  downvotes: number;
  score: number;
  eligible_votes: number;
  eligible_score: number;
  reply_count: number;
  support_link: number;
  created_at: EpochMs;
  deleted_at: EpochMs | null;
}

export interface PollRow {
  post_id: Id;
  closes_at: EpochMs;
  closed_notified: number;
}

export interface PollOptionRow {
  id: Id;
  post_id: Id;
  idx: number;
  text: string;
  vote_count: number;
}

export interface PromptRow {
  id: Id;
  idx: number;
  text: string;
}

/* ───────────────────────────── reads ───────────────────────────── */

export function getPost(id: Id): BuzzRow | null {
  return (prep('SELECT * FROM buzz_posts WHERE id = ?').get(id) as BuzzRow | undefined) ?? null;
}

export function getRoot(id: Id): BuzzRow | null {
  const row = getPost(id);
  return row && row.root_id === null ? row : null;
}

/** Every reply of a thread, oldest first (any status — the serializer decides visibility / placeholders). */
export function threadReplies(threadId: Id): BuzzRow[] {
  return prep('SELECT * FROM buzz_posts WHERE root_id = ? ORDER BY created_at ASC, id ASC').all(threadId) as BuzzRow[];
}

/** Distinct authors of a thread with their first post (for the alias book; any status — rows are soft-deleted only). */
export function threadParticipants(threadId: Id): { userId: Id; firstAt: EpochMs; firstId: Id }[] {
  const rows = prep(
    `SELECT author_id, created_at, id FROM buzz_posts WHERE id = ? OR root_id = ? ORDER BY created_at ASC, id ASC`,
  ).all(threadId, threadId) as { author_id: Id; created_at: EpochMs; id: Id }[];
  const seen = new Map<Id, { userId: Id; firstAt: EpochMs; firstId: Id }>();
  for (const r of rows) if (!seen.has(r.author_id)) seen.set(r.author_id, { userId: r.author_id, firstAt: r.created_at, firstId: r.id });
  return [...seen.values()];
}

/** Distinct author ids of a thread (ws `buzz.thread_updated` recipients). */
export function threadParticipantIds(threadId: Id): Id[] {
  return threadParticipants(threadId).map((p) => p.userId);
}

export function myVotesFor(viewerId: Id | null, postIds: readonly Id[]): Map<Id, -1 | 1> {
  const out = new Map<Id, -1 | 1>();
  if (!viewerId || postIds.length === 0) return out;
  const inc = inClause(postIds);
  const rows = db.prepare(`SELECT post_id, value FROM buzz_votes WHERE user_id = ? AND post_id IN ${inc.sql}`).all(viewerId, ...inc.params) as {
    post_id: Id; value: -1 | 1;
  }[];
  for (const r of rows) out.set(r.post_id, r.value);
  return out;
}

export function hiddenAuthorsFor(viewerId: Id | null, threadId: Id): Set<Id> {
  if (!viewerId) return new Set();
  const rows = prep('SELECT author_id FROM buzz_hidden_authors WHERE user_id = ? AND thread_id = ?').all(viewerId, threadId) as { author_id: Id }[];
  return new Set(rows.map((r) => r.author_id));
}

export function isThreadHidden(viewerId: Id, threadId: Id): boolean {
  return prep('SELECT 1 FROM buzz_hidden_threads WHERE user_id = ? AND thread_id = ?').get(viewerId, threadId) !== undefined;
}

export interface PollData {
  poll: PollRow;
  options: PollOptionRow[];
  myChoice: Id | null;
}

export function pollsFor(viewerId: Id | null, postIds: readonly Id[]): Map<Id, PollData> {
  const out = new Map<Id, PollData>();
  if (postIds.length === 0) return out;
  const inc = inClause(postIds);
  const polls = db.prepare(`SELECT * FROM buzz_polls WHERE post_id IN ${inc.sql}`).all(...inc.params) as PollRow[];
  if (polls.length === 0) return out;
  const pollIds = polls.map((p) => p.post_id);
  const inc2 = inClause(pollIds);
  const options = db.prepare(`SELECT * FROM buzz_poll_options WHERE post_id IN ${inc2.sql} ORDER BY idx ASC`).all(...inc2.params) as PollOptionRow[];
  const choices = new Map<Id, Id>();
  if (viewerId) {
    const mine = db.prepare(`SELECT post_id, option_id FROM buzz_poll_votes WHERE user_id = ? AND post_id IN ${inc2.sql}`).all(viewerId, ...inc2.params) as {
      post_id: Id; option_id: Id;
    }[];
    for (const c of mine) choices.set(c.post_id, c.option_id);
  }
  for (const p of polls) {
    out.set(p.post_id, { poll: p, options: options.filter((o) => o.post_id === p.post_id), myChoice: choices.get(p.post_id) ?? null });
  }
  return out;
}

/**
 * Below this many active users a campus is "small" (safety L18): the composer shows the small-campus note, and the
 * campus is never NAMED next to a buzz (global feed label, share-card subtitle) — its anonymity set is too small.
 */
export const SMALL_CAMPUS_USERS = 50;

/** Short names of the campuses that are large enough to be named next to a buzz (small campuses are omitted → null). */
export function campusShortNames(universityIds: readonly Id[]): Map<Id, string> {
  const out = new Map<Id, string>();
  const ids = [...new Set(universityIds)];
  if (ids.length === 0) return out;
  const inc = inClause(ids);
  const rows = db
    .prepare(
      `SELECT un.id, un.short_name,
              (SELECT COUNT(*) FROM users u WHERE u.university_id = un.id AND u.status = 'active') AS members
         FROM universities un WHERE un.id IN ${inc.sql}`,
    )
    .all(...inc.params) as { id: Id; short_name: string; members: number }[];
  for (const r of rows) if (r.members >= SMALL_CAMPUS_USERS) out.set(r.id, r.short_name);
  return out;
}

export function campusUserCount(universityId: Id): number {
  return (prep("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(universityId) as { n: number }).n;
}

export function promptCount(): number {
  return (prep('SELECT COUNT(*) AS n FROM buzz_prompts').get() as { n: number }).n;
}

export function promptById(id: Id): PromptRow | null {
  return (prep('SELECT * FROM buzz_prompts WHERE id = ?').get(id) as PromptRow | undefined) ?? null;
}

/** Daily Campus Prompt: `prompts[dayIndex % count]`. */
export function todaysPrompt(at: EpochMs = now()): PromptRow | null {
  const count = promptCount();
  if (count === 0) return null;
  const idx = Math.floor(at / DAY) % count;
  return (prep('SELECT * FROM buzz_prompts WHERE idx = ?').get(idx) as PromptRow | undefined) ?? null;
}

/* ───────────────────────────── feed ───────────────────────────── */

export interface FeedQuery {
  sort: BuzzSort;
  window: BuzzTopWindow;
  scope: FeedScope;
  cursor?: string;
  limit: number;
}

export interface FeedPage {
  rows: BuzzRow[];
  nextCursor: string | null;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_MIN = 60_000;

/**
 * hot = (score + 2·reply_count) / (ageHours + 2)^1.5. The cursor of a hot page carries the `now` the ranking was
 * computed with, so every later page ranks against the same instant (no drift, no repeats).
 */
export function queryFeed(viewer: { id: Id; universityId: Id }, q: FeedQuery): FeedPage {
  const cur = decodeCursor(q.cursor);
  const at = now();
  const where: string[] = ['p.root_id IS NULL', "p.status != 'deleted'"];
  const params: unknown[] = [];

  // status: active for everyone; the author also sees their own held / hidden / removed rows (SPEC §3.1)
  where.push("(p.status = 'active' OR p.author_id = ?)");
  params.push(viewer.id);
  if (q.scope === 'campus') {
    where.push('p.university_id = ?');
    params.push(viewer.universityId);
  }
  // viewer's own hides + reports. NO block filter, NO author-visibility filter (safety L14 / L16).
  where.push('NOT EXISTS (SELECT 1 FROM buzz_hidden_threads _ht WHERE _ht.user_id = ? AND _ht.thread_id = p.id)');
  params.push(viewer.id);
  const rep = sqlNotReported(viewer.id, 'buzz', 'p.id');
  where.push(rep.sql);
  params.push(...rep.params);

  let order: string;
  let rankAt = at;
  let from = 'buzz_posts p';
  if (q.sort === 'hot' || q.sort === 'top') {
    where.push('NOT (p.eligible_score <= -5 AND p.eligible_votes >= 8)'); // community-collapsed items leave hot / top
  }
  if (q.sort === 'hot') {
    let cursorHot: number | null = null;
    if (cur && typeof cur.k === 'string') {
      const [n, h] = cur.k.split(':');
      const parsedAt = Number(n);
      const parsedHot = Number(h);
      if (Number.isFinite(parsedAt) && parsedAt > 0 && Number.isFinite(parsedHot)) {
        rankAt = parsedAt;
        cursorHot = parsedHot;
      }
    }
    // the ranking column lives in a subquery so the keyset WHERE can reference it; its `?` is the FIRST placeholder
    // age is measured from the MINUTE-FLOORED created_at (the only precision the API ever serves, SPEC §3.2 #3): the
    // plain `rankAt:hot` cursor, together with the public score / replyCount, then solves to the minute and no finer.
    from = `(SELECT p.*, ((p.score + 2 * p.reply_count) * 1.0 / power(((? - (p.created_at / ${MS_PER_MIN}) * ${MS_PER_MIN}) / ${MS_PER_HOUR}.0) + 2, 1.5)) AS hot FROM buzz_posts p) p`;
    params.unshift(rankAt);
    order = 'p.hot DESC, p.id DESC';
    if (cursorHot !== null && cur) {
      where.push('(p.hot < ? OR (p.hot = ? AND p.id < ?))');
      params.push(cursorHot, cursorHot, cur.id);
    }
  } else if (q.sort === 'top') {
    const span = q.window === 'day' ? DAY : q.window === 'week' ? 7 * DAY : null;
    if (span !== null) {
      where.push('p.created_at >= ?');
      params.push(at - span);
    }
    const ks = keysetWhere('p.score', 'p.id', cur, 'desc');
    where.push(ks.sql);
    params.push(...ks.params);
    order = 'p.score DESC, p.id DESC';
  } else {
    const ks = keysetWhere('p.created_at', 'p.id', cur, 'desc');
    where.push(ks.sql);
    params.push(...ks.params);
    order = 'p.created_at DESC, p.id DESC';
  }

  const sql = `SELECT p.* FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`;
  params.push(q.limit + 1);
  const rows = db.prepare(sql).all(...params) as (BuzzRow & { hot?: number })[];

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  let nextCursor: string | null = null;
  if (rows.length > q.limit && last) {
    const key: CursorValue =
      q.sort === 'hot' ? { k: `${rankAt}:${last.hot ?? 0}`, id: last.id } : q.sort === 'top' ? { k: last.score, id: last.id } : { k: last.created_at, id: last.id };
    // new / top keys are sealed: the true created_at must stay inside the cursor (SPEC §3.2 #3, L2)
    nextCursor = encodeCursor(key, { seal: q.sort !== 'hot' });
  }
  return { rows: page.map(({ hot: _hot, ...r }) => r as BuzzRow), nextCursor };
}

/* ───────────────────────────── writes ───────────────────────────── */

export interface InsertPostInput {
  id?: Id;
  rootId: Id | null;
  parentId: Id | null;
  depth: number;
  authorId: Id;
  universityId: Id;
  text: string;
  promptId?: Id | null;
  status: ContentStatus;
  supportLink?: boolean;
  createdAt?: EpochMs;
}

export function insertPost(input: InsertPostInput): BuzzRow {
  const id = input.id ?? newId();
  prep(
    `INSERT INTO buzz_posts (id, root_id, parent_id, depth, author_id, university_id, text, prompt_id, status, support_link, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, input.rootId, input.parentId, input.depth, input.authorId, input.universityId, input.text, input.promptId ?? null, input.status,
    input.supportLink ? 1 : 0, input.createdAt ?? now(),
  );
  return getPost(id)!;
}

export function insertPoll(postId: Id, closesAt: EpochMs, options: string[], ids?: Id[]): void {
  prep('INSERT INTO buzz_polls (post_id, closes_at, closed_notified) VALUES (?,?,0)').run(postId, closesAt);
  const ins = prep('INSERT INTO buzz_poll_options (id, post_id, idx, text, vote_count) VALUES (?,?,?,?,0)');
  options.forEach((text, idx) => ins.run(ids?.[idx] ?? newId(), postId, idx, text));
}

/** reply_count on the root counts ACTIVE replies at any depth. */
export function recountReplies(rootId: Id): number {
  const n = (prep("SELECT COUNT(*) AS n FROM buzz_posts WHERE root_id = ? AND status = 'active'").get(rootId) as { n: number }).n;
  prep('UPDATE buzz_posts SET reply_count = ? WHERE id = ?').run(n, rootId);
  return n;
}

/** Recomputes upvotes / downvotes / score / eligible_* from `buzz_votes`. */
export function recountVotes(postId: Id): Pick<BuzzRow, 'upvotes' | 'downvotes' | 'score' | 'eligible_votes' | 'eligible_score'> {
  const agg = prep(
    `SELECT
       COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS up,
       COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS down,
       COALESCE(SUM(CASE WHEN eligible = 1 THEN 1 ELSE 0 END), 0) AS ev,
       COALESCE(SUM(CASE WHEN eligible = 1 THEN value ELSE 0 END), 0) AS es
     FROM buzz_votes WHERE post_id = ?`,
  ).get(postId) as { up: number; down: number; ev: number; es: number };
  const out = { upvotes: agg.up, downvotes: agg.down, score: agg.up - agg.down, eligible_votes: agg.ev, eligible_score: agg.es };
  prep('UPDATE buzz_posts SET upvotes = ?, downvotes = ?, score = ?, eligible_votes = ?, eligible_score = ? WHERE id = ?').run(
    out.upvotes, out.downvotes, out.score, out.eligible_votes, out.eligible_score, postId,
  );
  return out;
}

export function setPostStatus(id: Id, status: ContentStatus, opts: { immune?: boolean; deletedAt?: EpochMs | null } = {}): void {
  const sets = ['status = ?'];
  const params: unknown[] = [status];
  if (opts.immune !== undefined) {
    sets.push('auto_hide_immune = ?');
    params.push(opts.immune ? 1 : 0);
  }
  if (opts.deletedAt !== undefined) {
    sets.push('deleted_at = ?');
    params.push(opts.deletedAt);
  }
  params.push(id);
  db.prepare(`UPDATE buzz_posts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function isCollapsed(row: Pick<BuzzRow, 'eligible_score' | 'eligible_votes'>): boolean {
  return row.eligible_score <= -5 && row.eligible_votes >= 8;
}

export function shouldAutoHide(row: Pick<BuzzRow, 'eligible_score' | 'eligible_votes'>): boolean {
  return row.eligible_score <= -10 && row.eligible_votes >= 12;
}
