/** Analytics routes (SPEC §5.11): overview, Apartments funnel (T1), moderation metrics. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, typed, validate } from '../../lib/http';
import { apartmentsFunnel, moderationMetrics, overview } from '../../services/admin/analytics';

const router = Router();

const rangeQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  universityId: z.string().max(64).optional(),
});
type RangeQuery = z.infer<typeof rangeQuery>;

router.get(
  '/analytics/overview',
  validate({ query: rangeQuery }),
  asyncHandler((req, res) => {
    res.json(overview(typed<unknown, RangeQuery>(req).query));
  }),
);

router.get(
  '/analytics/apartments',
  validate({ query: rangeQuery }),
  asyncHandler((req, res) => {
    res.json(apartmentsFunnel(typed<unknown, RangeQuery>(req).query));
  }),
);

router.get(
  '/analytics/moderation',
  validate({ query: rangeQuery }),
  asyncHandler((req, res) => {
    res.json(moderationMetrics(typed<unknown, RangeQuery>(req).query));
  }),
);

export default router;
