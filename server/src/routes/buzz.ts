/**
 * `buzz` slice router — mount `/api/buzz` (SPEC §5.3). Foundation adds `requireAuth + requireOnboarded`; this router
 * adds `requireBuzzGate` and `noStore` to EVERY route (the gate is required before the first Buzz read).
 *
 * Firewall summary (Constitution §5, SPEC §3.2): every response goes through `services/buzz/serialize.ts`; no block
 * filter and no author-visibility filter anywhere; ownership errors are a generic 404 for non-owners; notifications
 * only via `notifyAnonymous`; ws only `{ type:'buzz.thread_updated', threadId }` to thread participants; analytics
 * only the `buzz_*` (anonymous) names; NEVER `markPublicActivity`.
 */
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthorNotice, FeedScope, Id, ModerationResult, WithModeration } from '@shared/core';
import { LIMITS } from '@shared/core';
import type {
  Buzz, BuzzFeedMeta, BuzzMedia, BuzzKarma, BuzzPoll, BuzzReply, BuzzThread, BuzzVoteState, CreateBuzzReplyRequest, CreateBuzzRequest, MyBuzzItem,
} from '@shared/buzz';
import { BUZZ_POLL_DURATIONS, BUZZ_SORTS, BUZZ_TOP_WINDOWS } from '@shared/buzz';
import { config } from '../config';
import { prep, tx } from '../db/index';
import { requireBuzzGate } from '../middleware/auth';
import { trackEvent } from '../lib/analytics';
import { DAY, HOUR, MIN, now } from '../lib/clock';
import { ApiError, asyncHandler, decodeCursor, encodeCursor, keysetWhere, noStore, pageQuery, typed, validate } from '../lib/http';
import { log } from '../lib/logger';
import { blockedTarget, commitModeration, modCtx, moderateWrite, toAuthorNotice } from '../lib/moderation/index';
import { notifyAnonymous, removeNotificationsFor } from '../lib/notify';
import { assertAccountAge, enforceRateLimit, requireCanPost } from '../lib/rateLimit';
import { assertOwnUpload, scrubMp4Metadata } from '../lib/uploads';
import { publishToUsers } from '../lib/realtime';
import type { AuthedUser } from '../lib/users';
import { registerBuzz } from '../services/buzz/registry';
import {
  headline, pageReplies, serializeBuzz, serializeFeed, serializeMine, serializeReply, serializeThread, snippet, threadContext, visibleReplies,
} from '../services/buzz/serialize';
import {
  campusUserCount, getPost, getRoot, insertPoll, insertPost, isThreadHidden, pollsFor, promptById, queryFeed, recountReplies,
  setPostStatus, SMALL_CAMPUS_USERS, threadParticipantIds, todaysPrompt, type BuzzRow,
} from '../services/buzz/store';
import { castVote, threadHref } from '../services/buzz/votes';

registerBuzz();

const router = Router();

const POLL_MIN_ACCOUNT_AGE_MS = 24 * HOUR;
const GENERIC_404 = "That buzz isn't available.";

router.use(requireBuzzGate);
router.use((_req, res, next) => {
  noStore(res);
  next();
});

function user(req: { user?: AuthedUser }): AuthedUser {
  if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return req.user;
}

function smallCampus(u: AuthedUser, scope: FeedScope): boolean {
  return scope === 'campus' && campusUserCount(u.universityId) < SMALL_CAMPUS_USERS;
}

/**
 * Root reachable by the viewer: exists, not deleted, and not `held` unless the viewer wrote it — other viewers never
 * learn a `held` state exists (SPEC §3.1 "no shadow states"; same generic 404 as a missing id). Hidden / removed roots
 * stay reachable as placeholders.
 */
function loadThread(threadId: Id, viewerId: Id): BuzzRow {
  const root = getRoot(threadId);
  if (!root || root.status === 'deleted' || (root.status === 'held' && root.author_id !== viewerId)) throw ApiError.notFound(GENERIC_404);
  return root;
}

/**
 * The author notice of a create that ran two `moderateWrite` passes (text + poll options): its `status` MUST equal the
 * persisted status, so the held result (whichever pass produced it) supplies status + copy; support merges from both.
 */
function mergedNotice(textMod: ModerationResult, pollMod: ModerationResult | null): AuthorNotice {
  const held = textMod.persistStatus === 'held' ? textMod : pollMod?.persistStatus === 'held' ? pollMod : textMod;
  return { ...toAuthorNotice(held), support: textMod.support ?? pollMod?.support ?? null };
}

function publishThreadUpdated(threadId: Id): void {
  try {
    publishToUsers(threadParticipantIds(threadId), { type: 'buzz.thread_updated', threadId });
  } catch (err) {
    log.error('buzz.thread_updated publish failed', err);
  }
}

/* ───────────────────────────── schemas ───────────────────────────── */

const feedQuery = pageQuery.extend({
  sort: z.enum(BUZZ_SORTS as [string, ...string[]]).default('hot'),
  window: z.enum(BUZZ_TOP_WINDOWS as [string, ...string[]]).default('day'),
  scope: z.enum(['campus', 'global']).default('campus'),
  /** Search: every word must appear in the title or the body. */
  q: z.string().trim().max(LIMITS.buzzSearch).optional(),
});

const scopeQuery = z.object({ scope: z.enum(['campus', 'global']).default('campus') });

const idParam = z.string().min(1).max(64);

const uploadRef = z.string().min(1).max(200);

const createBuzzSchema = z
  .object({
  text: z.string().trim().max(LIMITS.buzzText).default(''),
  title: z.string().trim().max(LIMITS.buzzTitle).optional(),
  scope: z.enum(['campus', 'global']).default('campus'),
  images: z.array(uploadRef).max(LIMITS.buzzImages, `You can attach up to ${LIMITS.buzzImages} photos.`).optional(),
  video: uploadRef.optional(),
  poll: z
    .object({
      options: z
        .array(z.string().trim().min(1).max(LIMITS.pollOptionText))
        .min(LIMITS.pollMinOptions)
        .max(LIMITS.pollMaxOptions)
        .refine((o) => new Set(o.map((s) => s.toLowerCase())).size === o.length, 'Poll options must be different.'),
      durationDays: z.union([z.literal(1), z.literal(3), z.literal(7)]),
    })
    .optional(),
  promptId: z.string().min(1).max(64).optional(),
})
  .refine((b) => b.text.length > 0 || (b.title ?? '').length > 0, { message: 'Say something first.', path: ['text'] })
  .refine((b) => !(b.video && b.images && b.images.length > 0), { message: 'Add photos or one video, not both.', path: ['video'] });

/**
 * The caller's own uploads → the stored media list. Each file is claimed for Buzz (`purpose = 'buzz'`, so it can never
 * be reused on a public surface) and videos are scrubbed of their location / device / time metadata first.
 */
function claimBuzzMedia(u: AuthedUser, body: { images?: string[]; video?: string }): BuzzMedia[] {
  if (body.video) {
    const row = assertOwnUpload(u, body.video, 'video', { allowBuzz: true });
    if (row.purpose !== null && row.purpose !== 'buzz') throw ApiError.notFound('Upload not found');
    if (row.mime === 'video/mp4' && !scrubMp4Metadata(path.join(config.uploadsDir, path.basename(row.url)))) {
      throw new ApiError(415, 'unsupported_media', "We couldn't process that video. Try a different file.");
    }
    if (row.mime !== 'video/mp4') throw new ApiError(415, 'unsupported_media', 'Buzz videos must be MP4 or MOV.');
    return [{ type: 'video', url: row.url, width: row.width, height: row.height, durationMs: row.duration_ms }];
  }
  const seen = new Set<string>();
  const out: BuzzMedia[] = [];
  for (const ref of body.images ?? []) {
    const row = assertOwnUpload(u, ref, 'image', { allowBuzz: true });
    if (row.purpose !== null && row.purpose !== 'buzz') throw ApiError.notFound('Upload not found');
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ type: 'image', url: row.url, width: row.width, height: row.height, durationMs: null });
  }
  return out;
}

const createReplySchema = z.object({
  text: z.string().trim().min(1, 'Say something first.').max(LIMITS.buzzReplyText),
  parentId: z.string().min(1).max(64).optional(),
});

const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });
const pollVoteSchema = z.object({ optionId: z.string().min(1).max(64) });
const mineQuery = pageQuery.extend({ kind: z.enum(['threads', 'replies']).default('threads') });

/* ───────────────────────────── feed / meta (static segments first) ───────────────────────────── */

router.get(
  '/feed',
  validate({ query: feedQuery }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { query } = typed<unknown, z.infer<typeof feedQuery>>(req);
    const page = queryFeed(u, {
      sort: query.sort as 'hot' | 'new' | 'top', window: query.window as 'day' | 'week' | 'all', scope: query.scope as FeedScope,
      q: query.q, cursor: query.cursor, limit: query.limit,
    });
    const items = serializeFeed(u.id, query.scope as FeedScope, page.rows);
    if (!query.cursor) {
      trackEvent('buzz_feed_view', { userId: u.id, universityId: u.universityId }, { sort: query.sort, scope: query.scope, search: Boolean(query.q) });
    }
    res.json({ items, nextCursor: page.nextCursor });
  }),
);

router.get(
  '/meta',
  validate({ query: scopeQuery }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { query } = typed<unknown, z.infer<typeof scopeQuery>>(req);
    const prompt = todaysPrompt();
    const out: BuzzFeedMeta = {
      prompt: prompt ? { id: prompt.id, text: prompt.text } : null,
      smallCampusNote: smallCampus(u, query.scope as FeedScope),
    };
    res.json(out);
  }),
);

/* ───────────────────────────── create ───────────────────────────── */

router.post(
  '/',
  validate({ body: createBuzzSchema }),
  requireCanPost('buzz'),
  asyncHandler((req, res) => {
    const u = user(req);
    const { body } = typed<CreateBuzzRequest>(req);
    enforceRateLimit(u, 'buzz_post');
    if (body.poll) assertAccountAge(u, POLL_MIN_ACCOUNT_AGE_MS, 'Polls unlock 24 hours after you join.');
    if (body.promptId && !promptById(body.promptId)) throw new ApiError(400, 'validation_failed', 'That prompt has expired.');

    const textMod = moderateWrite(
      [...(body.title ? [{ text: body.title, field: 'title' as const }] : []), { text: body.text }],
      modCtx(u, 'buzz'),
      blockedTarget(u, 'buzz'),
    );
    const media = claimBuzzMedia(u, body);
    const pollMod = body.poll
      ? moderateWrite(body.poll.options.map((text) => ({ text, field: 'option' as const })), modCtx(u, 'buzz_poll'), blockedTarget(u, 'buzz'))
      : null;
    const status = textMod.persistStatus === 'held' || pollMod?.persistStatus === 'held' ? 'held' : 'active';

    const row = tx(() => {
      const created = insertPost({
        rootId: null, parentId: null, depth: 0, authorId: u.id, universityId: u.universityId, text: body.text,
        title: body.title ?? '', media, scope: body.scope ?? 'campus',
        promptId: body.promptId ?? null, status, supportLink: Boolean(textMod.support ?? pollMod?.support),
      });
      if (media.length > 0) {
        const mark = prep("UPDATE uploads SET purpose = 'buzz' WHERE user_id = ? AND url = ?");
        for (const m of media) mark.run(u.id, m.url);
      }
      // minute-floored: an exact `closesAt` minus the duration would give away the exact creation instant (L2)
      if (body.poll) insertPoll(created.id, Math.floor(now() / MIN) * MIN + body.poll.durationDays * DAY, body.poll.options);
      return created;
    });
    commitModeration(textMod, { ...blockedTarget(u, 'buzz'), entityId: row.id });
    if (pollMod) commitModeration(pollMod, { ...blockedTarget(u, 'buzz'), entityId: row.id });
    trackEvent('buzz_post', { userId: u.id, universityId: u.universityId }, {
      hasPoll: Boolean(body.poll), fromPrompt: Boolean(body.promptId), scope: body.scope ?? 'campus', hasTitle: Boolean(body.title),
      photos: media.filter((m) => m.type === 'image').length, hasVideo: media.some((m) => m.type === 'video'),
    });

    const out: WithModeration<Buzz> = { ...serializeBuzz(getPost(row.id)!, threadContext(row, u.id, [])), moderation: mergedNotice(textMod, pollMod) };
    res.status(201).json(out);
  }),
);

/* ───────────────────────────── votes / delete / hide-author (by post id) ───────────────────────────── */

router.put(
  '/posts/:postId/vote',
  validate({ params: z.object({ postId: idParam }), body: voteSchema }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { body, params } = typed<{ value: -1 | 0 | 1 }, unknown, { postId: Id }>(req);
    const post = getPost(params.postId);
    if (!post || post.status === 'deleted') throw ApiError.notFound(GENERIC_404);
    enforceRateLimit(u, 'buzz_vote');
    const state: BuzzVoteState = castVote(u, post, body.value);
    trackEvent('buzz_vote', { userId: u.id, universityId: u.universityId }, { value: body.value, kind: post.root_id ? 'reply' : 'buzz' });
    res.json(state);
  }),
);

router.delete(
  '/posts/:postId',
  validate({ params: z.object({ postId: idParam }) }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params } = typed<unknown, unknown, { postId: Id }>(req);
    const post = getPost(params.postId);
    // non-owner → identical 404 to a missing id (safety L8)
    if (!post || post.status === 'deleted' || post.author_id !== u.id) throw ApiError.notFound(GENERIC_404);
    tx(() => {
      setPostStatus(post.id, 'deleted', { deletedAt: now() });
      if (post.root_id) recountReplies(post.root_id);
      removeNotificationsFor({ entityType: post.root_id ? 'buzz_reply' : 'buzz', entityId: post.id });
      if (!post.root_id) removeNotificationsFor({ entityType: 'buzz', entityId: post.id });
    });
    if (post.root_id) publishThreadUpdated(post.root_id);
    res.status(204).end();
  }),
);

router.post(
  '/posts/:postId/hide-author',
  validate({ params: z.object({ postId: idParam }) }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params } = typed<unknown, unknown, { postId: Id }>(req);
    const post = getPost(params.postId);
    if (!post || post.status === 'deleted') throw ApiError.notFound(GENERIC_404);
    // keyed on thread + author SERVER-SIDE: the client never learns the author (safety L14)
    if (post.author_id !== u.id) {
      prep('INSERT OR IGNORE INTO buzz_hidden_authors (user_id, thread_id, author_id, created_at) VALUES (?,?,?,?)').run(
        u.id, post.root_id ?? post.id, post.author_id, now(),
      );
    }
    res.status(204).end();
  }),
);

/* ───────────────────────────── mine / karma ───────────────────────────── */

router.get(
  '/mine',
  validate({ query: mineQuery }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { query } = typed<unknown, z.infer<typeof mineQuery>>(req);
    const cur = decodeCursor(query.cursor);
    const ks = keysetWhere('created_at', 'id', cur, 'desc');
    const rows = prep(
      `SELECT * FROM buzz_posts WHERE author_id = ? AND status != 'deleted' AND root_id IS ${query.kind === 'threads' ? '' : 'NOT '}NULL AND ${ks.sql}
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(u.id, ...ks.params, query.limit + 1) as BuzzRow[];
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const items: MyBuzzItem[] = serializeMine(u.id, page);
    res.json({ items, nextCursor: rows.length > query.limit && last ? encodeCursor({ k: last.created_at, id: last.id }, { seal: true }) : null });
  }),
);

router.get(
  '/karma',
  asyncHandler((req, res) => {
    const u = user(req);
    const row = prep("SELECT COALESCE(SUM(score), 0) AS karma FROM buzz_posts WHERE author_id = ? AND status != 'deleted'").get(u.id) as { karma: number };
    const out: BuzzKarma = { karma: row.karma };
    res.json(out);
  }),
);

/* ───────────────────────────── thread ───────────────────────────── */

router.get(
  '/:threadId',
  validate({ params: z.object({ threadId: idParam }), query: pageQuery }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params, query } = typed<unknown, z.infer<typeof pageQuery>, { threadId: Id }>(req);
    const root = loadThread(params.threadId, u.id);
    const page = pageReplies(root, u.id, null, query.limit);
    const out: BuzzThread = serializeThread(
      root, u.id, { items: page.items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor, { seal: true }) : null }, smallCampus(u, 'campus') && root.university_id === u.universityId,
    );
    res.json(out);
  }),
);

router.get(
  '/:threadId/replies',
  validate({ params: z.object({ threadId: idParam }), query: pageQuery }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params, query } = typed<unknown, z.infer<typeof pageQuery>, { threadId: Id }>(req);
    const root = loadThread(params.threadId, u.id);
    const page = pageReplies(root, u.id, decodeCursor(query.cursor), query.limit);
    res.json({ items: page.items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor, { seal: true }) : null });
  }),
);

router.post(
  '/:threadId/replies',
  validate({ params: z.object({ threadId: idParam }), body: createReplySchema }),
  requireCanPost('buzz'),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params, body } = typed<CreateBuzzReplyRequest, unknown, { threadId: Id }>(req);
    const root = loadThread(params.threadId, u.id);
    if (root.status !== 'active') throw ApiError.notFound(GENERIC_404);
    if (root.locked === 1) throw new ApiError(403, 'forbidden', 'This thread is locked.', { reason: 'locked' });
    let parent: BuzzRow = root;
    if (body.parentId && body.parentId !== root.id) {
      const p = getPost(body.parentId);
      if (!p || p.root_id !== root.id || p.status === 'deleted' || (p.status !== 'active' && p.author_id !== u.id)) throw ApiError.notFound(GENERIC_404);
      parent = p;
    }
    enforceRateLimit(u, 'buzz_reply');
    const mod = moderateWrite([{ text: body.text }], modCtx(u, 'buzz_reply'), blockedTarget(u, 'buzz_reply'));
    const status = mod.persistStatus ?? 'active';

    const row = tx(() => {
      const created = insertPost({
        rootId: root.id, parentId: parent.id, depth: parent.depth + 1, authorId: u.id, universityId: root.university_id, text: body.text,
        status, supportLink: Boolean(mod.support),
      });
      recountReplies(root.id);
      return created;
    });
    commitModeration(mod, { ...blockedTarget(u, 'buzz_reply'), entityId: row.id });

    if (status === 'active') {
      // "Someone replied to your buzz" — to the parent's author and the root author, never self, never twice
      const recipients = new Set<Id>();
      if (parent.author_id !== u.id) recipients.add(parent.author_id);
      if (root.author_id !== u.id) recipients.add(root.author_id);
      for (const to of recipients) {
        const own = to === root.author_id ? root : parent; // snippet = the recipient's OWN buzz only
        try {
          notifyAnonymous({ userId: to, type: 'buzz.reply', threadId: root.id, href: threadHref(root.id), data: { snippet: snippet(headline(own), 80) } });
        } catch (err) {
          log.error('buzz.reply notice failed', err);
        }
      }
      publishThreadUpdated(root.id);
    }
    trackEvent('buzz_reply', { userId: u.id, universityId: u.universityId }, { depth: Math.min(row.depth, 3) });

    const shape = visibleReplies(root.id, u.id).find((v) => v.row.id === row.id)?.shape ?? { parentId: root.id, depth: 1 as const, replyingToAuthorId: null };
    const out: WithModeration<BuzzReply> = { ...serializeReply(row, shape, threadContext(root, u.id, [row.id])), moderation: toAuthorNotice(mod) };
    res.status(201).json(out);
  }),
);

/* ───────────────────────────── poll vote ───────────────────────────── */

router.post(
  '/:threadId/poll/vote',
  validate({ params: z.object({ threadId: idParam }), body: pollVoteSchema }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params, body } = typed<{ optionId: Id }, unknown, { threadId: Id }>(req);
    const root = loadThread(params.threadId, u.id);
    if (root.status !== 'active') throw ApiError.notFound(GENERIC_404);
    const data = pollsFor(u.id, [root.id]).get(root.id);
    if (!data) throw ApiError.notFound('This buzz has no poll.');
    if (root.author_id === u.id) throw ApiError.badRequest("You can't vote in your own poll.");
    if (data.poll.closes_at <= now()) throw ApiError.conflict('This poll has closed.');
    const option = data.options.find((o) => o.id === body.optionId);
    if (!option) throw new ApiError(400, 'validation_failed', 'Pick one of the options.');
    if (data.myChoice !== null && data.myChoice !== option.id) throw ApiError.conflict('You already voted in this poll.');
    if (data.myChoice === null) {
      tx(() => {
        prep('INSERT INTO buzz_poll_votes (post_id, user_id, option_id, created_at) VALUES (?,?,?,?)').run(root.id, u.id, option.id, now());
        prep('UPDATE buzz_poll_options SET vote_count = vote_count + 1 WHERE id = ?').run(option.id);
      });
      trackEvent('buzz_poll_vote', { userId: u.id, universityId: u.universityId });
    }
    const fresh = serializeBuzz(getPost(root.id)!, threadContext(root, u.id, []));
    const out: BuzzPoll = fresh.poll!;
    res.json(out);
  }),
);

/* ───────────────────────────── hide thread ───────────────────────────── */

router.post(
  '/:threadId/hide',
  validate({ params: z.object({ threadId: idParam }) }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params } = typed<unknown, unknown, { threadId: Id }>(req);
    const root = loadThread(params.threadId, u.id);
    prep('INSERT OR IGNORE INTO buzz_hidden_threads (user_id, thread_id, created_at) VALUES (?,?,?)').run(u.id, root.id, now());
    res.status(204).end();
  }),
);

router.delete(
  '/:threadId/hide',
  validate({ params: z.object({ threadId: idParam }) }),
  asyncHandler((req, res) => {
    const u = user(req);
    const { params } = typed<unknown, unknown, { threadId: Id }>(req);
    if (isThreadHidden(u.id, params.threadId)) prep('DELETE FROM buzz_hidden_threads WHERE user_id = ? AND thread_id = ?').run(u.id, params.threadId);
    res.status(204).end();
  }),
);

export default router;
