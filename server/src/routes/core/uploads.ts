/**
 * Foundation endpoint #29 (SPEC §4.3): POST /uploads.                   LANE S-M2a owns this file.
 * Auth: `requireAuth` only (kind 'avatar' works right after /auth/complete); the handler throws 403
 * `onboarding_required` itself for other kinds when the user is not onboarded.
 * Body: `lib/uploads.ts#handleUpload` (multer inside; 413 / 415 / 422; rate `upload`).
 */
import { Router } from 'express';
import type { UploadResult } from '@shared/core';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, noStore } from '../../lib/http';
import { handleUpload } from '../../lib/uploads';

const router = Router();

router.post(
  '/uploads',
  requireAuth,
  asyncHandler(async (req, res) => {
    noStore(res);
    const out: UploadResult = await handleUpload(req);
    res.status(201).json(out);
  }),
);

export default router;
