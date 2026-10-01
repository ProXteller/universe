/**
 * Foundation endpoint #36 (SPEC §4.3): POST /dm.                          LANE S-M2b owns this file.
 * STATUS: implemented — thin handler over `openDm` in `lib/conversations.ts`.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { OpenDmRequest, OpenDmResponse } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { openDm } from '../../lib/conversations';
import { asyncHandler, noStore, typed, validate } from '../../lib/http';

const router = Router();

export const openDmSchema = z.object({
  userId: z.string().min(1).max(64),
  context: z.object({ kind: z.enum(['listing', 'roommate']), id: z.string().min(1).max(64) }).optional(),
});

router.post(
  '/dm',
  requireAuth,
  requireOnboarded,
  validate({ body: openDmSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<OpenDmRequest>(req);
    const out: OpenDmResponse = openDm(req.user!, body.userId, body.context);
    res.json(out);
  }),
);

export default router;
