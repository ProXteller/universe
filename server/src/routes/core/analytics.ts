/**
 * Foundation endpoint #33 (SPEC §4.3): POST /analytics/track (`optionalAuth`).   LANE S-M2b owns this file.
 *
 * Always 204, even when every event was dropped. Unknown names are dropped silently. Signed-in callers: every
 * `AnalyticsEventName` (Buzz names go through the anonymous path of `trackEvent`). Signed-out callers: ONLY
 * `PRE_AUTH_ANALYTICS_EVENTS` are stored, with `user_id NULL` and `university_id NULL`. The client clock `ts` is
 * kept only as the `clientTs` prop; the server stores its own time.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { AnalyticsProps, TrackRequest } from '@shared/core';
import { optionalAuth } from '../../middleware/auth';
import { isAnalyticsEventName, isPreAuthAnalyticsEvent, trackEvent } from '../../lib/analytics';
import { asyncHandler, typed, validate } from '../../lib/http';

const router = Router();

const propValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

export const trackSchema = z.object({
  events: z
    .array(z.object({ name: z.string().min(1).max(60), props: z.record(propValue).optional(), ts: z.number().optional() }))
    .max(50),
});

router.post(
  '/analytics/track',
  optionalAuth,
  validate({ body: trackSchema }),
  asyncHandler((req, res) => {
    const { body } = typed<TrackRequest>(req);
    const user = req.user;
    for (const event of body.events) {
      if (!isAnalyticsEventName(event.name)) continue;
      if (!user && !isPreAuthAnalyticsEvent(event.name)) continue;
      const props: AnalyticsProps = { ...(event.props ?? {}) };
      if (typeof event.ts === 'number' && Number.isFinite(event.ts)) props.clientTs = event.ts;
      trackEvent(
        event.name,
        user ? { userId: user.id, universityId: user.universityId, sessionId: req.sessionId ?? null } : { userId: null, universityId: null },
        props,
      );
    }
    res.status(204).end();
  }),
);

export default router;
