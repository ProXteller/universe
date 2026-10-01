/** `GET /limitations` — the Limitations panel (safety §8.3 G1–G5 + A1), never paged. */
import { Router } from 'express';
import { LIMITATIONS } from '@shared/admin';
import { asyncHandler } from '../../lib/http';

const router = Router();

router.get(
  '/limitations',
  asyncHandler((_req, res) => {
    res.json({ items: LIMITATIONS, nextCursor: null });
  }),
);

export default router;
