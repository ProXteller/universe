/**
 * Mount table (SPEC §4.3): `SLICE_MOUNTS` + `mountCore()`. Used by both `routes/index.ts` (static imports of every
 * slice router) and `createTestApp` isolation mode (dynamic imports of only the named slice routers).
 *
 * Shared between lanes (DECISIONS D1): surgical Edit only, re-Read right before editing, never overwrite.
 */
import type { Router } from 'express';
import { optionalAuth, requireAuth, requireOnboarded } from '../middleware/auth';
import analyticsRouter from './core/analytics';
import authRouter from './core/auth';
import avatarsRouter from './core/avatars';
import cardsRouter from './core/cards';
import dmRouter from './core/dm';
import healthRouter from './core/health';
import meRouter from './core/me';
import notificationsRouter from './core/notifications';
import reportsRouter from './core/reports';
import shareRouter from './core/share';
import socialRouter from './core/social';
import uploadsRouter from './core/uploads';
import usersRouter from './core/users';
import waitlistRouter from './core/waitlist';

export type SliceName =
  | 'auth' | 'reels' | 'buzz' | 'orbit' | 'discover' | 'messages' | 'roommates' | 'market' | 'campus' | 'apartments' | 'admin';

export interface SliceMount {
  slice: SliceName;
  /** Mount path under `/api`. */
  mount: string;
  /** `requireAuth + requireOnboarded` (true) or `requireAuth` only (false — the auth slice). */
  onboarded: boolean;
}

/** In mount order (SPEC §4.3). */
export const SLICE_MOUNTS: readonly SliceMount[] = [
  { slice: 'auth', mount: '/onboarding', onboarded: false },
  { slice: 'reels', mount: '/reels', onboarded: true },
  { slice: 'buzz', mount: '/buzz', onboarded: true },
  { slice: 'orbit', mount: '/orbit', onboarded: true },
  { slice: 'discover', mount: '/discover', onboarded: true },
  { slice: 'messages', mount: '/conversations', onboarded: true },
  { slice: 'roommates', mount: '/roommates', onboarded: true },
  { slice: 'market', mount: '/market', onboarded: true },
  { slice: 'campus', mount: '/campus', onboarded: true },
  { slice: 'apartments', mount: '/apartments', onboarded: true },
  { slice: 'admin', mount: '/admin', onboarded: true },
];

/** Mounts every foundation router (SPEC §4.3 #1–#40) on `router` (which app.ts mounts at `/api`). */
export function mountCore(router: Router): void {
  router.use(healthRouter);
  router.use(avatarsRouter);
  // `optionalAuth` only on /auth/*, /invites/:code and POST /analytics/track (SPEC §4.2.5).
  router.use('/auth', optionalAuth);
  router.use('/invites', optionalAuth);
  router.use(authRouter);
  router.use(meRouter);
  router.use(usersRouter);
  router.use(socialRouter);
  router.use(uploadsRouter);
  router.use(reportsRouter);
  router.use(notificationsRouter);
  router.use(analyticsRouter);
  router.use(waitlistRouter);
  router.use(dmRouter);
  router.use(shareRouter);
  router.use(cardsRouter);
}

/** Mounts one slice router with the middleware SPEC §4.3 prescribes. */
export function mountSlice(router: Router, mount: SliceMount, sliceRouter: Router): void {
  if (mount.onboarded) router.use(mount.mount, requireAuth, requireOnboarded, sliceRouter);
  else router.use(mount.mount, requireAuth, sliceRouter);
}
