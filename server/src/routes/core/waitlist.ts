/**
 * Foundation endpoints #34–#35 (SPEC §4.3): waitlist state / join / leave.   LANE S-M2b owns this file.
 * STATUS: implemented — thin handlers over `lib/waitlist.ts`.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { WaitlistFeature, WaitlistState } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { asyncHandler, noStore, typed, validate } from '../../lib/http';
import { joinWaitlist, leaveWaitlist, waitlistStateFor } from '../../lib/waitlist';

const router = Router();
const onboarded = [requireAuth, requireOnboarded];
const featureParams = z.object({ feature: z.enum(['apartments']) });

router.get(
  '/waitlist/:feature',
  ...onboarded,
  validate({ params: featureParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { feature: WaitlistFeature }>(req);
    const out: WaitlistState = waitlistStateFor(req.user!.id, params.feature);
    res.json(out);
  }),
);

router.post(
  '/waitlist/:feature',
  ...onboarded,
  validate({ params: featureParams, body: z.object({ source: z.string().trim().max(60).optional() }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<{ source?: string }, unknown, { feature: WaitlistFeature }>(req);
    joinWaitlist(req.user!.id, params.feature, body.source !== undefined ? { source: body.source } : undefined);
    const out: WaitlistState = waitlistStateFor(req.user!.id, params.feature);
    res.json(out);
  }),
);

router.delete(
  '/waitlist/:feature',
  ...onboarded,
  validate({ params: featureParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { feature: WaitlistFeature }>(req);
    leaveWaitlist(req.user!.id, params.feature);
    const out: WaitlistState = waitlistStateFor(req.user!.id, params.feature);
    res.json(out);
  }),
);

export default router;
