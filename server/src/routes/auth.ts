/**
 * `auth` slice router (SPEC §5.1) — mounted at `/api/onboarding` with `requireAuth` ONLY (foundation `routes/index.ts`;
 * the slice never adds middleware itself). Tables: none. Everything else in the flow uses foundation endpoints #2–#12,
 * #25, #8.
 *
 *   GET  /suggestions   → OnboardingSuggestions (core tables only; never Buzz)
 *   POST /follow-many   { userIds: Id[] (≤ 10) } → { followed: Id[] }
 */
import { Router } from 'express';
import { z } from 'zod';
import { ONBOARDING_FOLLOW_MANY_MAX, type FollowManyRequest, type FollowManyResponse, type OnboardingSuggestions } from '@shared/auth';
import { authed } from '../middleware/auth';
import { asyncHandler, noStore, typed, validate } from '../lib/http';
import { followMany } from '../services/auth/followMany';
import { buildSuggestions } from '../services/auth/suggestions';

const router = Router();

router.get(
  '/suggestions',
  asyncHandler((req, res) => {
    noStore(res);
    const out: OnboardingSuggestions = buildSuggestions(authed(req));
    res.json(out);
  }),
);

const followManySchema = z.object({
  userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(ONBOARDING_FOLLOW_MANY_MAX),
});

router.post(
  '/follow-many',
  validate({ body: followManySchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<FollowManyRequest>(req);
    const out: FollowManyResponse = { followed: followMany(authed(req), body.userIds) };
    res.json(out);
  }),
);

export default router;
