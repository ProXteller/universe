/** Foundation endpoint #40 (SPEC §4.3): generated avatars, immutable cache. Public. */
import { Router } from 'express';
import { z } from 'zod';
import { renderAvatarSvg } from '../../lib/avatars';
import { asyncHandler, typed, validate } from '../../lib/http';

const router = Router();

router.get(
  '/avatars/:seed.svg',
  validate({
    params: z.object({ seed: z.string().min(1).max(64) }),
    query: z.object({ t: z.enum(['student', 'org']).default('student') }),
  }),
  asyncHandler((req, res) => {
    const { params, query } = typed<unknown, { t: 'student' | 'org' }, { seed: string }>(req);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(renderAvatarSvg(params.seed, query.t));
  }),
);

export default router;
