/** Appeals routes (SPEC §5.11, safety §4.5): blind list, detail, decide (reviewer ≠ actor). */
import { Router } from 'express';
import { z } from 'zod';
import type { AppealDecisionRequest } from '@shared/admin';
import { asyncHandler, pageQuery, typed, validate } from '../../lib/http';
import { authed } from '../../middleware/auth';
import { decideAppeal, getStaffAppeal, listAppeals } from '../../services/admin/appeals';
import { idParams } from './shared';

const router = Router();

const listQuery = pageQuery.extend({ status: z.enum(['open', 'upheld', 'reversed', 'reduced', 'all']).default('open') });

router.get(
  '/appeals',
  validate({ query: listQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, z.infer<typeof listQuery>>(req);
    res.json(listAppeals(authed(req), query.status, query.cursor, query.limit));
  }),
);

router.get(
  '/appeals/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    res.json(getStaffAppeal(authed(req), params.id));
  }),
);

const decideBody = z.object({
  outcome: z.enum(['upheld', 'reversed', 'reduced']),
  note: z.string().max(2000),
  reducedUntil: z.number().int().positive().optional(),
});

router.post(
  '/appeals/:id/decide',
  validate({ params: idParams, body: decideBody }),
  asyncHandler((req, res) => {
    const { params, body } = typed<AppealDecisionRequest, unknown, { id: string }>(req);
    res.json(decideAppeal(authed(req), params.id, body));
  }),
);

export default router;
