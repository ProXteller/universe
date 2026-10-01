/**
 * THE ONLY DB row → JSON exit for Buzz entities (Constitution §5.2, SPEC §3.2 #1, safety L1).
 *
 * Every object is built FIELD BY FIELD from an allow-list — a DB row is never spread. Forbidden keys anywhere in a
 * Buzz response: authorId, author_id, userId, user_id, handle, name, displayName, avatar, avatarUrl, email,
 * universityEmail, profile. The alias is HMAC-derived here and never stored; `isOp` / `isMine` are booleans computed
 * from ids that never leave this module; `createdAt` is floored to the minute (L2).
 *
 * Visibility (SPEC §3.1 / safety §3.2 / L16): other viewers get `active` rows with text, `hidden` / `removed` /
 * `deleted` rows as placeholders (`text: ''`, status kept so the client renders "[hidden pending review]" /
 * "[removed by moderators]" / "[deleted]"), and never a `held` row. Authors see their own rows with text (+ chip).
 * The blind staff context (`staff: true`, admin queue only) lifts ONLY the text blanking — every status keeps its text
 * so root / parent chain / siblings are readable — while `isMine` stays false and no identity field ever exists.
 */
import type { EpochMs, FeedScope, Id } from '@shared/core';
import type { Buzz, BuzzAlias, BuzzItemStatus, BuzzMedia, BuzzPoll, BuzzReply, BuzzThread, MyBuzzItem } from '@shared/buzz';
import { MIN, now } from '../../lib/clock';
import { aliasBook, aliasFor } from './alias';
import {
  campusShortNames, getPost, getRoot, hiddenAuthorsFor, isCollapsed, myVotesFor, parseMedia, pollsFor, threadParticipants, threadReplies,
  type BuzzRow, type PollData,
} from './store';

const SNIPPET_MAX = 120;

/** `null` viewer = staff blind context (isMine always false, no votes / choices). */
export interface SerializeContext {
  viewerId: Id | null;
  /** Blind staff context: text of every status is readable (nothing else changes). Never set for a member request. */
  staff?: boolean;
  scope: FeedScope;
  rootAuthorId: Id;
  alias(userId: Id): BuzzAlias;
  myVotes: Map<Id, -1 | 1>;
  /** Author ids the viewer hid in this thread. */
  hiddenAuthors: Set<Id>;
  polls: Map<Id, PollData>;
  campusNames: Map<Id, string>;
  at: EpochMs;
}

function floorMinute(ts: EpochMs): EpochMs {
  return Math.floor(ts / MIN) * MIN;
}

function itemStatus(row: BuzzRow): BuzzItemStatus {
  switch (row.status) {
    case 'active':
    case 'held':
    case 'hidden':
    case 'removed':
    case 'deleted':
      return row.status;
    default:
      return 'hidden';
  }
}

/** Text the viewer may read; '' for a placeholder. Staff (blind context) read every status. */
function visibleText(row: BuzzRow, ctx: Pick<SerializeContext, 'viewerId' | 'staff'>): string {
  if (ctx.staff) return row.text;
  if (row.status === 'deleted') return '';
  if (row.status === 'active') return row.text;
  return ctx.viewerId !== null && row.author_id === ctx.viewerId ? row.text : '';
}

/** Title + media follow the text rule exactly: a placeholder carries none of them. */
function visibleTitle(row: BuzzRow, ctx: Pick<SerializeContext, 'viewerId' | 'staff'>): string {
  return visibleText({ ...row, text: row.title ?? '' }, ctx);
}

function visibleMedia(row: BuzzRow, ctx: Pick<SerializeContext, 'viewerId' | 'staff'>): BuzzMedia[] {
  // field by field from the allow-list (a stored object is never spread into a response)
  if (visibleText({ ...row, text: 'x' }, ctx) === '') return [];
  return parseMedia(row.media).map((m) => ({ type: m.type, url: m.url, width: m.width, height: m.height, durationMs: m.durationMs }));
}

function serializePoll(data: PollData | undefined, isMine: boolean, at: EpochMs): BuzzPoll | null {
  if (!data) return null;
  // minute-floored like createdAt: `closesAt − durationDays` must not recover the exact creation instant (L2)
  const closesAt = floorMinute(data.poll.closes_at);
  const closed = closesAt <= at;
  const total = data.options.reduce((n, o) => n + o.vote_count, 0);
  const resultsVisible = closed || data.myChoice !== null || isMine;
  return {
    options: data.options.map((o) => ({
      id: o.id,
      text: o.text,
      votes: resultsVisible ? o.vote_count : null,
      pct: resultsVisible ? (total === 0 ? 0 : Math.round((o.vote_count / total) * 100)) : null,
    })),
    totalVotes: resultsVisible ? total : null,
    closesAt,
    closed,
    myChoice: data.myChoice,
    resultsVisible,
  };
}

export function serializeBuzz(row: BuzzRow, ctx: SerializeContext): Buzz {
  const isMine = ctx.viewerId !== null && row.author_id === ctx.viewerId;
  return {
    kind: 'buzz',
    id: row.id,
    threadId: row.id,
    alias: ctx.alias(row.author_id),
    isOp: row.author_id === ctx.rootAuthorId,
    isMine,
    text: visibleText(row, ctx),
    title: visibleTitle(row, ctx),
    media: visibleMedia(row, ctx),
    scope: row.scope === 'global' ? 'global' : 'campus',
    score: row.score,
    myVote: ctx.myVotes.get(row.id) ?? 0,
    collapsed: isCollapsed(row),
    status: itemStatus(row),
    supportLink: row.support_link === 1,
    createdAt: floorMinute(row.created_at),
    poll: serializePoll(ctx.polls.get(row.id), isMine, ctx.at),
    replyCount: row.reply_count,
    locked: row.locked === 1,
    campusShortName: row.scope === 'global' ? (ctx.campusNames.get(row.university_id) ?? null) : null,
    promptId: row.prompt_id,
  };
}

export interface ReplyShape {
  /** Depth-1 ancestor for flattened replies (the client nests under it). */
  parentId: Id;
  depth: 1 | 2;
  /** Author of the ACTUAL parent when flattened (depth > 2). */
  replyingToAuthorId: Id | null;
}

export function serializeReply(row: BuzzRow, shape: ReplyShape, ctx: SerializeContext): BuzzReply {
  const isMine = ctx.viewerId !== null && row.author_id === ctx.viewerId;
  return {
    kind: 'reply',
    id: row.id,
    threadId: row.root_id ?? row.id,
    alias: ctx.alias(row.author_id),
    isOp: row.author_id === ctx.rootAuthorId,
    isMine,
    text: visibleText(row, ctx),
    score: row.score,
    myVote: ctx.myVotes.get(row.id) ?? 0,
    collapsed: isCollapsed(row) || ctx.hiddenAuthors.has(row.author_id),
    status: itemStatus(row),
    supportLink: row.support_link === 1,
    createdAt: floorMinute(row.created_at),
    parentId: shape.parentId,
    depth: shape.depth,
    replyingTo: shape.replyingToAuthorId ? ctx.alias(shape.replyingToAuthorId) : null,
  };
}

/* ───────────────────────────── contexts ───────────────────────────── */

/** Feed cards are roots only — no collision handling needed (safety §5.1 rule 2). */
export function feedContext(viewerId: Id | null, scope: FeedScope, rows: readonly BuzzRow[]): Map<Id, SerializeContext> {
  const ids = rows.map((r) => r.id);
  const myVotes = myVotesFor(viewerId, ids);
  const polls = pollsFor(viewerId, ids);
  const globalRows = rows.filter((r) => r.scope === 'global');
  const campusNames = globalRows.length > 0 ? campusShortNames(globalRows.map((r) => r.university_id)) : new Map<Id, string>();
  const at = now();
  const out = new Map<Id, SerializeContext>();
  for (const row of rows) {
    out.set(row.id, {
      viewerId, scope, rootAuthorId: row.author_id, alias: (userId) => aliasFor(row.id, userId), myVotes,
      hiddenAuthors: new Set(), polls, campusNames, at,
    });
  }
  return out;
}

export function serializeFeed(viewerId: Id | null, scope: FeedScope, rows: readonly BuzzRow[]): Buzz[] {
  const ctx = feedContext(viewerId, scope, rows);
  return rows.map((row) => serializeBuzz(row, ctx.get(row.id)!));
}

/* ───────────────────────────── threads ───────────────────────────── */

export interface VisibleReply {
  row: BuzzRow;
  shape: ReplyShape;
}

export interface VisibleRepliesOptions {
  rows?: BuzzRow[];
  /** Blind staff walk: every row of every status is part of the tree (the queue needs the real surroundings). */
  staff?: boolean;
}

/**
 * The visible reply list of a thread, oldest first, with flattening (depth > 2 → depth 2 + `replyingTo`) and
 * placeholders. Rules: others never see `held`; `deleted` rows appear only as placeholders when they still have
 * visible descendants; a reply whose parent is invisible re-attaches to the nearest visible ancestor.
 */
export function visibleReplies(threadId: Id, viewerId: Id | null, opts: VisibleRepliesOptions = {}): VisibleReply[] {
  const all = opts.rows ?? threadReplies(threadId);
  const staff = opts.staff === true;
  const byId = new Map<Id, BuzzRow>();
  for (const r of all) byId.set(r.id, r);

  // 1. which rows are candidates (own rows: anything; others: not held; staff: everything)
  const candidate = (r: BuzzRow): boolean => staff || r.status !== 'held' || (viewerId !== null && r.author_id === viewerId);

  // 2. deleted rows survive only as placeholders when a candidate descendant exists (walk children bottom-up)
  const hasVisibleChild = new Set<Id>();
  for (const r of [...all].reverse()) {
    if (!candidate(r)) continue;
    const isVisible = r.status !== 'deleted' || hasVisibleChild.has(r.id);
    if (!isVisible) continue;
    let p = r.parent_id;
    while (p && p !== threadId) {
      if (hasVisibleChild.has(p)) break;
      hasVisibleChild.add(p);
      p = byId.get(p)?.parent_id ?? null;
    }
  }
  const visible = new Map<Id, BuzzRow>();
  for (const r of all) {
    if (!candidate(r)) continue;
    if (!staff && r.status === 'deleted' && !hasVisibleChild.has(r.id)) continue;
    visible.set(r.id, r);
  }

  // 3. shape: nearest visible ancestor; depth-1 ancestor for flattening
  const out: VisibleReply[] = [];
  const shapes = new Map<Id, ReplyShape>();
  for (const r of all) {
    const row = visible.get(r.id);
    if (!row) continue;
    // nearest visible ancestor (or the root)
    let anc = row.parent_id;
    while (anc && anc !== threadId && !visible.has(anc)) anc = byId.get(anc)?.parent_id ?? null;
    const parentVisible = anc && anc !== threadId ? visible.get(anc) ?? null : null;
    let shape: ReplyShape;
    if (!parentVisible) shape = { parentId: threadId, depth: 1, replyingToAuthorId: null };
    else {
      const parentShape = shapes.get(parentVisible.id)!;
      if (parentShape.depth === 1) shape = { parentId: parentVisible.id, depth: 2, replyingToAuthorId: null };
      else shape = { parentId: parentShape.parentId, depth: 2, replyingToAuthorId: parentVisible.author_id };
    }
    shapes.set(row.id, shape);
    out.push({ row, shape });
  }
  return out;
}

export function threadContext(root: BuzzRow, viewerId: Id | null, postIds: readonly Id[], opts: { staff?: boolean } = {}): SerializeContext {
  const book = aliasBook(root.id, threadParticipants(root.id));
  return {
    viewerId,
    staff: opts.staff === true,
    scope: 'campus',
    rootAuthorId: root.author_id,
    alias: (userId) => book.get(userId) ?? aliasFor(root.id, userId),
    myVotes: myVotesFor(viewerId, [root.id, ...postIds]),
    hiddenAuthors: hiddenAuthorsFor(viewerId, root.id),
    polls: pollsFor(viewerId, [root.id]),
    campusNames: root.scope === 'global' ? campusShortNames([root.university_id]) : new Map(),
    at: now(),
  };
}

export interface ReplyPage {
  items: BuzzReply[];
  nextCursor: { k: number; id: Id } | null;
}

/** Keyset (created_at asc, id asc) over the visible reply list. */
export function pageReplies(root: BuzzRow, viewerId: Id | null, cursor: { k: number | string; id: Id } | null, limit: number): ReplyPage {
  const list = visibleReplies(root.id, viewerId);
  let start = 0;
  if (cursor) {
    const k = typeof cursor.k === 'number' ? cursor.k : Number(cursor.k);
    start = list.findIndex((v) => v.row.created_at > k || (v.row.created_at === k && v.row.id > cursor.id));
    if (start < 0) start = list.length;
  }
  const slice = list.slice(start, start + limit);
  const more = start + limit < list.length;
  const ctx = threadContext(root, viewerId, slice.map((v) => v.row.id));
  const items = slice.map((v) => serializeReply(v.row, v.shape, ctx));
  const last = slice[slice.length - 1];
  return { items, nextCursor: more && last ? { k: last.row.created_at, id: last.row.id } : null };
}

export function serializeThread(root: BuzzRow, viewerId: Id | null, replies: { items: BuzzReply[]; nextCursor: string | null }, smallCampusNote: boolean): BuzzThread {
  const ctx = threadContext(root, viewerId, []);
  return { root: serializeBuzz(root, ctx), replies, smallCampusNote };
}

/* ───────────────────────────── "my buzzes" ───────────────────────────── */

interface MineThread {
  root: BuzzRow;
  shapes: Map<Id, ReplyShape>;
  ctx: SerializeContext;
}

/** One feed context for the page's roots; one thread walk + one context per DISTINCT thread for its replies (never per row). */
export function serializeMine(viewerId: Id, rows: readonly BuzzRow[]): MyBuzzItem[] {
  const feedCtx = feedContext(viewerId, 'campus', rows.filter((r) => r.root_id === null));
  const replyIdsByThread = new Map<Id, Id[]>();
  for (const r of rows) {
    if (r.root_id === null) continue;
    const ids = replyIdsByThread.get(r.root_id);
    if (ids) ids.push(r.id);
    else replyIdsByThread.set(r.root_id, [r.id]);
  }
  const threads = new Map<Id, MineThread>();
  for (const [threadId, ids] of replyIdsByThread) {
    const root = getRoot(threadId);
    if (!root) continue;
    const shapes = new Map(visibleReplies(root.id, viewerId).map((v) => [v.row.id, v.shape] as const));
    threads.set(threadId, { root, shapes, ctx: threadContext(root, viewerId, ids) });
  }
  const out: MyBuzzItem[] = [];
  for (const row of rows) {
    if (row.root_id === null) {
      out.push({ item: serializeBuzz(row, feedCtx.get(row.id)!), threadSnippet: snippet(headline(row)) });
      continue;
    }
    const t = threads.get(row.root_id);
    if (!t) continue;
    const shape: ReplyShape = t.shapes.get(row.id) ?? { parentId: t.root.id, depth: 1, replyingToAuthorId: null };
    out.push({ item: serializeReply(row, shape, t.ctx), threadSnippet: t.root.status === 'active' || t.root.author_id === viewerId ? snippet(headline(t.root)) : '' });
  }
  return out;
}

/** What a buzz is "about" in one line: its title when it has one, else its body. */
export function headline(row: Pick<BuzzRow, 'title' | 'text'>): string {
  return row.title?.trim() ? row.title : row.text;
}

export function snippet(text: string, max = SNIPPET_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/* ───────────────────────────── staff (blind) ───────────────────────────── */

/**
 * Blind context for the admin queue (SPEC §5.3 adapters): root + parent chain + 3 siblings each side, all through this
 * serializer with `viewerId = null` (isMine always false, myVote 0, no hidden-author data) and `staff: true`, which only
 * lifts the text blanking so a held / hidden / removed target and its surroundings stay readable. Nothing else about
 * the author is ever attached.
 */
export function blindStaffContext(id: Id): unknown {
  const target = getPost(id);
  if (!target) return null;
  const rootId = target.root_id ?? target.id;
  const root = getRoot(rootId);
  if (!root) return null;
  const replies = visibleReplies(root.id, null, { staff: true });
  const ctx = threadContext(root, null, replies.map((v) => v.row.id), { staff: true });
  const rootJson = serializeBuzz(root, ctx);
  if (target.root_id === null) {
    return { entityType: 'buzz', item: rootJson, root: rootJson, parents: [], siblings: replies.slice(0, 6).map((v) => serializeReply(v.row, v.shape, ctx)) };
  }
  const idx = replies.findIndex((v) => v.row.id === target.id);
  const byId = new Map(replies.map((v) => [v.row.id, v]));
  const parents: BuzzReply[] = [];
  let p = target.parent_id;
  while (p && p !== root.id) {
    const v = byId.get(p);
    if (!v) break;
    parents.unshift(serializeReply(v.row, v.shape, ctx));
    p = v.row.parent_id;
  }
  const around = idx >= 0 ? replies.slice(Math.max(0, idx - 3), idx + 4) : [];
  const targetShape = idx >= 0 ? replies[idx]!.shape : { parentId: root.id, depth: 1 as const, replyingToAuthorId: null };
  return {
    entityType: 'buzz_reply',
    item: serializeReply(target, targetShape, ctx),
    root: rootJson,
    parents,
    siblings: around.filter((v) => v.row.id !== target.id).map((v) => serializeReply(v.row, v.shape, ctx)),
  };
}
