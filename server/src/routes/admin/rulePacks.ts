/** Rule-pack routes (SPEC §5.11): admin only (moderators → 404); toggles are audited. */
import { Router } from 'express';
import { z } from 'zod';
import type { RulePackPatchRequest } from '@shared/admin';
import { asyncHandler, typed, validate } from '../../lib/http';
import { authed, requireRole } from '../../middleware/auth';
import { listPacks, setPackEnabled } from '../../services/admin/rulePacks';

const router = Router();

router.get(
  '/rule-packs',
  requireRole('admin'),
  asyncHandler((_req, res) => {
    res.json(listPacks());
  }),
);

router.patch(
  '/rule-packs/:id',
  requireRole('admin'),
  validate({ params: z.object({ id: z.string().min(1).max(64) }), body: z.object({ enabled: z.boolean() }) }),
  asyncHandler((req, res) => {
    const { params, body } = typed<RulePackPatchRequest, unknown, { id: string }>(req);
    res.json(setPackEnabled(authed(req), params.id, body.enabled));
  }),
);

export default router;
