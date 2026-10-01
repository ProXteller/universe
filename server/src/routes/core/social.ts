/**
 * Foundation endpoints #25–#26 (SPEC §4.3): follow / unfollow, block / unblock.
 */
import { Router } from 'express';
import type { BlockResult, FollowResult } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { blockUser, followUser, unblockUser, unfollowUser } from '../../lib/graph';
import { asyncHandler, noStore } from '../../lib/http';

const router = Router();
const onboarded = [requireAuth, requireOnboarded];

/* #25 POST / DELETE /users/:id/follow */
router.post(
  '/users/:id/follow',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: FollowResult = followUser(req.user!, req.params.id);
    res.json(out);
  }),
);
router.delete(
  '/users/:id/follow',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: FollowResult = unfollowUser(req.user!, req.params.id);
    res.json(out);
  }),
);

/* #26 POST / DELETE /users/:id/block */
router.post(
  '/users/:id/block',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: BlockResult = blockUser(req.user!, req.params.id);
    res.json(out);
  }),
);
router.delete(
  '/users/:id/block',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: BlockResult = unblockUser(req.user!, req.params.id);
    res.json(out);
  }),
);

export default router;
