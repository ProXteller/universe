/**
 * `orbit` router — mounted at `/api/orbit` by foundation with `requireAuth + requireOnboarded` (SPEC §5.4).
 * Every handler: `validate()` → (`requireCanPost()` on creates) → service. Adapters + the `post` card resolver are
 * registered at import time (R4 allows registry writes; no DB access happens here until a request arrives).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { UserListItem } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { CreatePostCommentRequest, CreatePostRequest, LikeState, NewPostCount, OrbitFeedResponse, Post, PostComment, PostPoll } from '@shared/orbit';
import { assertVisibleUser } from '../lib/graph';
import { asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { requireCanPost } from '../lib/rateLimit';
import { createComment, deleteComment, listComments } from '../services/orbit/comments';
import {
  countNewSince, createPost, deletePost, likePost, listFeed, listLikers, listUserPosts, loadVisiblePost, markFeedSeen,
  serializePost, unlikePost, votePoll,
} from '../services/orbit/posts';
import { registerOrbit } from '../services/orbit/registry';

registerOrbit();

const router = Router();

const idParam = z.object({ id: z.string().min(1).max(64) });

const mediaImage = z.object({
  url: z.string().min(1).max(512),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  alt: z.string().max(200).optional(),
});

const createPostBody = z.object({
  text: z.string().max(LIMITS.postText).default(''),
  images: z.array(mediaImage).max(LIMITS.postImages).optional(),
  poll: z
    .object({
      options: z.array(z.string().trim().min(1).max(LIMITS.pollOptionText)).min(LIMITS.pollMinOptions).max(LIMITS.pollMaxOptions),
    })
    .optional(),
});

const createCommentBody = z.object({
  text: z.string().trim().min(1).max(LIMITS.commentText),
  parentId: z.string().min(1).max(64).optional(),
});

/* ───────────────────────────── feed ───────────────────────────── */

router.get(
  '/feed',
  validate({ query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, { cursor?: string; limit: number }>(req);
    const out: OrbitFeedResponse = listFeed(req.user!, query);
    res.json(out);
  }),
);

router.get(
  '/feed/new-count',
  validate({ query: z.object({ since: z.coerce.number().int().nonnegative() }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, { since: number }>(req);
    const out: NewPostCount = { count: countNewSince(req.user!, query.since) };
    res.json(out);
  }),
);

router.post(
  '/feed/seen',
  asyncHandler((req, res) => {
    markFeedSeen(req.user!.id);
    res.status(204).end();
  }),
);

/* ───────────────────────────── per-user list ───────────────────────────── */

router.get(
  '/users/:userId/posts',
  validate({ params: z.object({ userId: z.string().min(1).max(64) }), query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number }, { userId: string }>(req);
    assertVisibleUser(req.user!.id, params.userId);
    res.json(listUserPosts(req.user!, params.userId, query));
  }),
);

/* ───────────────────────────── posts ───────────────────────────── */

router.post(
  '/posts',
  validate({ body: createPostBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<CreatePostRequest>(req);
    const { post, moderation } = createPost(req.user!, body);
    res.status(201).json({ ...post, moderation });
  }),
);

router.get(
  '/posts/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: Post = serializePost(loadVisiblePost(req.user!, params.id), req.user!.id);
    res.json(out);
  }),
);

router.delete(
  '/posts/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    deletePost(req.user!, params.id);
    res.status(204).end();
  }),
);

router.put(
  '/posts/:id/like',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: LikeState = likePost(req.user!, params.id);
    res.json(out);
  }),
);

router.delete(
  '/posts/:id/like',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: LikeState = unlikePost(req.user!, params.id);
    res.json(out);
  }),
);

router.get(
  '/posts/:id/likers',
  validate({ params: idParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number }, { id: string }>(req);
    const out: { items: UserListItem[]; nextCursor: string | null } = listLikers(req.user!, params.id, query);
    res.json(out);
  }),
);

router.post(
  '/posts/:id/poll/vote',
  validate({ params: idParam, body: z.object({ optionId: z.string().min(1).max(64) }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<{ optionId: string }, unknown, { id: string }>(req);
    const out: PostPoll = votePoll(req.user!, params.id, body.optionId);
    res.json(out);
  }),
);

/* ───────────────────────────── comments ───────────────────────────── */

router.get(
  '/posts/:id/comments',
  validate({ params: idParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number }, { id: string }>(req);
    const out: { items: PostComment[]; nextCursor: string | null } = listComments(req.user!, params.id, query);
    res.json(out);
  }),
);

router.post(
  '/posts/:id/comments',
  validate({ params: idParam, body: createCommentBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<CreatePostCommentRequest, unknown, { id: string }>(req);
    const { comment, moderation } = createComment(req.user!, params.id, body);
    res.status(201).json({ ...comment, moderation });
  }),
);

router.delete(
  '/comments/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    deleteComment(req.user!, params.id);
    res.status(204).end();
  }),
);

export default router;
