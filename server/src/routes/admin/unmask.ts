/** `POST /buzz/:entityType/:id/unmask` — admin only (moderators → 404), SPEC §5.11 / safety §6.5. */
import { Router } from 'express';
import { z } from 'zod';
import type { UnmaskRequest } from '@shared/admin';
import { asyncHandler, typed, validate } from '../../lib/http';
import { authed, requireRole } from '../../middleware/auth';
import { unmaskBuzzAuthor } from '../../services/admin/unmask';
import { zId, zUnmaskReason } from './shared';

const router = Router();

const params = z.object({ entityType: z.enum(['buzz', 'buzz_reply']), id: zId });
const body = z.object({
  reasonCode: zUnmaskReason,
  reason: z.string().max(2000),
  confirmText: z.string().max(20),
  caseRef: z.string().max(100).optional(),
});

router.post(
  '/buzz/:entityType/:id/unmask',
  requireRole('admin'),
  validate({ params, body }),
  asyncHandler((req, res) => {
    const t = typed<UnmaskRequest, unknown, z.infer<typeof params>>(req);
    res.json(unmaskBuzzAuthor(authed(req), t.params.entityType, t.params.id, t.body));
  }),
);

export default router;
