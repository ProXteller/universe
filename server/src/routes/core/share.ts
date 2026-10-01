/**
 * Foundation endpoints #37–#38 (SPEC §4.3): share targets + share.       LANE S-M2b owns this file.
 * STATUS: implemented — thin handlers over `lib/share.ts`.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ConversationSummary, Paginated, ShareRequest, ShareResponse } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { asyncHandler, noStore, typed, validate } from '../../lib/http';
import { listShareTargets, shareCard } from '../../lib/share';

const router = Router();
const onboarded = [requireAuth, requireOnboarded];

const cardKinds = ['listing', 'roommate', 'reel', 'post', 'event', 'buzz', 'profile', 'course'] as const;

export const shareSchema = z.object({
  card: z.object({ kind: z.enum(cardKinds), id: z.string().min(1).max(64) }),
  conversationIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  text: z.string().trim().max(500).optional(),
});

router.get(
  '/share/targets',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: Paginated<ConversationSummary> = listShareTargets(req.user!);
    res.json(out);
  }),
);

router.post(
  '/share',
  ...onboarded,
  validate({ body: shareSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<ShareRequest>(req);
    const out: ShareResponse = shareCard(req.user!, body);
    res.json(out);
  }),
);

export default router;
