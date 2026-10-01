/**
 * The API router (SPEC §4.3): core routers → every slice router, statically imported (Constitution §3), in the
 * order of `SLICE_MOUNTS`. Slices never touch this file; foundation pre-creates their router stubs.
 *
 * Shared between lanes (DECISIONS D1): surgical Edit only, re-Read right before editing, never overwrite.
 */
import { Router } from 'express';
import adminRouter from './admin';
import apartmentsRouter from './apartments';
import authRouter from './auth';
import buzzRouter from './buzz';
import campusRouter from './campus';
import discoverRouter from './discover';
import marketRouter from './market';
import messagesRouter from './messages';
import { mountCore, mountSlice, SLICE_MOUNTS, type SliceName } from './mounts';
import orbitRouter from './orbit';
import reelsRouter from './reels';
import roommatesRouter from './roommates';

const SLICE_ROUTERS: Record<SliceName, Router> = {
  auth: authRouter,
  reels: reelsRouter,
  buzz: buzzRouter,
  orbit: orbitRouter,
  discover: discoverRouter,
  messages: messagesRouter,
  roommates: roommatesRouter,
  market: marketRouter,
  campus: campusRouter,
  apartments: apartmentsRouter,
  admin: adminRouter,
};

export function createApiRouter(): Router {
  const router = Router();
  mountCore(router);
  for (const mount of SLICE_MOUNTS) mountSlice(router, mount, SLICE_ROUTERS[mount.slice]);
  return router;
}

const apiRouter = createApiRouter();
export default apiRouter;
