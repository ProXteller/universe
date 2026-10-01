/** Queue routes (SPEC §5.11): list, counts, detail (claims 10 min), claim / release, actions, bulk. */
import { Router } from 'express';
import { z } from 'zod';
import type { BulkActionRequest, QueueView, StaffActionRequest } from '@shared/admin';
import { QUEUE_VIEWS } from '@shared/admin';
import { asyncHandler, pageQuery, typed, validate } from '../../lib/http';
import { authed } from '../../middleware/auth';
import { applyBulk, applyQueueAction } from '../../services/admin/actions';
import { claim, listQueue, queueCounts, queueDetail, release, type QueueFilters } from '../../services/admin/queue';
import { idParams, zCategory, zId, zNote, zStaffAction, zSurface } from './shared';

const router = Router();

const VIEW_IDS = QUEUE_VIEWS.map((v) => v.id) as [QueueView, ...QueueView[]];

const listQuery = pageQuery.extend({
  view: z.enum(VIEW_IDS).default('priority'),
  surface: zSurface.optional(),
  category: zCategory.optional(),
  universityId: z.string().max(64).optional(),
  source: z.string().max(40).optional(),
  q: z.string().max(40).optional(),
});

router.get(
  '/queue',
  validate({ query: listQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, z.infer<typeof listQuery>>(req);
    const filters: QueueFilters = { ...query };
    res.json(listQueue(authed(req), filters));
  }),
);

router.get(
  '/queue/counts',
  asyncHandler((req, res) => {
    res.json(queueCounts(authed(req)));
  }),
);

router.get(
  '/queue/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    res.json(queueDetail(params.id, authed(req)));
  }),
);

router.post(
  '/queue/:id/claim',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    res.json(claim(params.id, authed(req)));
  }),
);

router.post(
  '/queue/:id/release',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    res.json(release(params.id, authed(req)));
  }),
);

const actionBody = z.object({
  action: zStaffAction,
  category: zCategory,
  note: zNote,
  reference: z.string().max(200).optional(),
  confirmText: z.string().max(20).optional(),
  badFaith: z.boolean().optional(),
});

router.post(
  '/queue/:id/actions',
  validate({ params: idParams, body: actionBody }),
  asyncHandler((req, res) => {
    const { params, body } = typed<StaffActionRequest, unknown, { id: string }>(req);
    const staff = authed(req);
    applyQueueAction(params.id, staff, body);
    res.json(queueDetail(params.id, staff, { afterAction: true }));
  }),
);

const bulkBody = z.object({
  ids: z.array(zId).min(1).max(50),
  action: z.enum(['approve', 'remove', 'dismiss_reports']),
  category: zCategory,
  note: zNote,
});

router.post(
  '/queue/bulk',
  validate({ body: bulkBody }),
  asyncHandler((req, res) => {
    const { body } = typed<BulkActionRequest>(req);
    res.json(applyBulk(authed(req), body));
  }),
);

export default router;
