/**
 * `reels` router — mounted at `/api/reels` by foundation with `requireAuth + requireOnboarded` (SPEC §5.2).
 * Every handler: `validate()` → (`requireCanPost()` → `enforceRateLimit()` → `moderateWrite()` on writes) → service.
 * Registry entries (adapters + card resolver) are registered at import time (R4); no DB access happens here at import.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Paginated, UserListItem } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { CreateReelCommentRequest, CreateReelRequest, LikeState, Reel, ReelComment, ReelViewRequest } from '@shared/reels';
import { authed } from '../middleware/auth';
import { asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite, toAuthorNotice } from '../lib/moderation/index';
import { enforceRateLimit, requireCanPost } from '../lib/rateLimit';
import {
  createComment, deleteComment, likeComment, listComments, listReplies, resolveParent, serializeComment, unlikeComment,
} from '../services/reels/comments';
import {
  createReel, deleteReel, hideReel, likeReel, listByUser, listFeed, listFollowing, listLikers, recordView, requireVisibleReel,
  resolveReelUploads, serializeReel, unlikeReel,
} from '../services/reels/reels';
import { registerReelsRegistry } from '../services/reels/registry';

registerReelsRegistry();

const router = Router();

const idParam = z.object({ id: z.string().min(1).max(64) });
const commentIdParam = z.object({ commentId: z.string().min(1).max(64) });
const userIdParam = z.object({ userId: z.string().min(1).max(64) });

const createReelSchema = z.object({
  videoUploadId: z.string().min(1).max(200),
  posterUploadId: z.string().min(1).max(200).nullable().optional(),
  caption: z.string().trim().max(LIMITS.reelCaption).default(''),
  visibility: z.enum(['campus', 'global']).default('global'),
});

const createCommentSchema = z.object({
  text: z.string().trim().min(1, 'Write something first.').max(LIMITS.commentText),
  parentId: z.string().min(1).max(64).optional(),
});

const viewSchema = z.object({ completed: z.boolean().optional() });

type PageQ = { cursor?: string; limit: number };

/* ───────────────────────────── feeds ───────────────────────────── */

router.get(
  '/feed',
  validate({ query: pageQuery.extend({ scope: z.enum(['campus', 'global']).default('campus') }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, PageQ & { scope: 'campus' | 'global' }>(req);
    const out: Paginated<Reel> = listFeed(authed(req), query.scope, query);
    res.json(out);
  }),
);

router.get(
  '/following',
  validate({ query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, PageQ>(req);
    const out: Paginated<Reel> = listFollowing(authed(req), query);
    res.json(out);
  }),
);

router.get(
  '/user/:userId',
  validate({ params: userIdParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, PageQ, { userId: string }>(req);
    const out: Paginated<Reel> = listByUser(authed(req), params.userId, query);
    res.json(out);
  }),
);

/* ───────────────────────────── comments by id (before /:id so "comments" is never read as a reel id) ───────────────────────────── */

router.get(
  '/comments/:commentId/replies',
  validate({ params: commentIdParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, PageQ, { commentId: string }>(req);
    const out: Paginated<ReelComment> = listReplies(authed(req), params.commentId, query);
    res.json(out);
  }),
);

router.delete(
  '/comments/:commentId',
  validate({ params: commentIdParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { commentId: string }>(req);
    deleteComment(authed(req), params.commentId);
    res.status(204).end();
  }),
);

router.put(
  '/comments/:commentId/like',
  validate({ params: commentIdParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { commentId: string }>(req);
    const out: LikeState = likeComment(authed(req), params.commentId);
    res.json(out);
  }),
);

router.delete(
  '/comments/:commentId/like',
  validate({ params: commentIdParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { commentId: string }>(req);
    const out: LikeState = unlikeComment(authed(req), params.commentId);
    res.json(out);
  }),
);

/* ───────────────────────────── create / delete ───────────────────────────── */

router.post(
  '/',
  validate({ body: createReelSchema }),
  requireCanPost('public'),
  asyncHandler((req, res) => {
    noStore(res);
    const user = authed(req);
    const { body } = typed<CreateReelRequest & { caption: string; visibility: 'campus' | 'global' }>(req);
    // Upload ownership + the duration re-check come first: a 404 / 422 here must not spend a reel_upload token.
    const uploads = resolveReelUploads(user, body);
    enforceRateLimit(user, 'reel_upload');
    const mod = moderateWrite([{ text: body.caption, field: 'body' }], modCtx(user, 'reel_caption'), blockedTarget(user, 'reel'));
    const row = createReel({ user, body, uploads, status: mod.persistStatus ?? 'active' });
    commitModeration(mod, { ...blockedTarget(user, 'reel'), entityId: row.id });
    res.status(201).json({ ...serializeReel(row, user.id), moderation: toAuthorNotice(mod) });
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = authed(req);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: Reel = serializeReel(requireVisibleReel(user, params.id), user.id);
    res.json(out);
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    deleteReel(authed(req), params.id);
    res.status(204).end();
  }),
);

/* ───────────────────────────── likes / views / not interested ───────────────────────────── */

router.put(
  '/:id/like',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: LikeState = likeReel(authed(req), params.id);
    res.json(out);
  }),
);

router.delete(
  '/:id/like',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: LikeState = unlikeReel(authed(req), params.id);
    res.json(out);
  }),
);

router.post(
  '/:id/view',
  validate({ params: idParam, body: viewSchema }),
  asyncHandler((req, res) => {
    const { params, body } = typed<ReelViewRequest, unknown, { id: string }>(req);
    recordView(authed(req), params.id, body.completed === true);
    res.status(204).end();
  }),
);

router.post(
  '/:id/not-interested',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    hideReel(authed(req), params.id);
    res.status(204).end();
  }),
);

router.get(
  '/:id/likers',
  validate({ params: idParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = authed(req);
    const { params, query } = typed<unknown, PageQ, { id: string }>(req);
    requireVisibleReel(user, params.id);
    const out: Paginated<UserListItem> = listLikers(user, params.id, query);
    res.json(out);
  }),
);

/* ───────────────────────────── comments ───────────────────────────── */

router.get(
  '/:id/comments',
  validate({ params: idParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, PageQ, { id: string }>(req);
    const out: Paginated<ReelComment> = listComments(authed(req), params.id, query);
    res.json(out);
  }),
);

router.post(
  '/:id/comments',
  validate({ params: idParam, body: createCommentSchema }),
  requireCanPost('public'),
  asyncHandler((req, res) => {
    noStore(res);
    const user = authed(req);
    const { params, body } = typed<CreateReelCommentRequest & { text: string }, unknown, { id: string }>(req);
    const reel = requireVisibleReel(user, params.id);
    const parent = resolveParent(user, reel.id, body.parentId ?? null);
    enforceRateLimit(user, 'comment');
    const mod = moderateWrite([{ text: body.text, field: 'body' }], modCtx(user, 'comment'), blockedTarget(user, 'reel_comment'));
    const row = createComment({ user, reel, text: body.text, parentId: parent?.id ?? null, status: mod.persistStatus ?? 'active' });
    commitModeration(mod, { ...blockedTarget(user, 'reel_comment'), entityId: row.id });
    res.status(201).json({ ...serializeComment(row, user.id), moderation: toAuthorNotice(mod) });
  }),
);

export default router;
