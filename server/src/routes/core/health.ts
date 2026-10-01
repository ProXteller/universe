/** Foundation endpoint #1 (SPEC §4.3). */
import { Router } from 'express';
import { APP_NAME } from '@shared/core';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, name: APP_NAME });
});

export default router;
