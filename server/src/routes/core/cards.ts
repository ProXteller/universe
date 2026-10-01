/**
 * Foundation endpoint #39 (SPEC §4.3): GET /cards/:kind/:id — always 200 (`status:'unavailable'` when gone).
 *                                                                        LANE S-M2a owns this file.
 * Body: `lib/content.ts#resolveCard` (registry-backed; block + status rules; `currency` filled by foundation).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ShareCard, ShareCardKind } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { resolveCard } from '../../lib/content';
import { asyncHandler, noStore, typed, validate } from '../../lib/http';

const router = Router();

router.get(
  '/cards/:kind/:id',
  requireAuth,
  requireOnboarded,
  validate({
    params: z.object({
      kind: z.enum(['listing', 'roommate', 'reel', 'post', 'event', 'buzz', 'profile', 'course']),
      id: z.string().min(1).max(64),
    }),
  }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { kind: ShareCardKind; id: string }>(req);
    const out: ShareCard = resolveCard({ kind: params.kind, id: params.id }, req.user!.id);
    res.json(out);
  }),
);

export default router;
