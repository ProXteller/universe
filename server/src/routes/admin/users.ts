/** Staff user routes (SPEC §5.11): lookup, detail, role (admin), verify (admin), direct sanctions, lift (admin). */
import { Router } from 'express';
import { z } from 'zod';
import type { LiftSanctionRequest, StaffRoleRequest, StaffSanctionRequest, StaffVerifyRequest } from '@shared/admin';
import { asyncHandler, pageQuery, typed, validate } from '../../lib/http';
import { authed, requireRole } from '../../middleware/auth';
import { applyDirectSanction, liftUserSanction, searchStaffUsers, setUserRole, setUserVerified, staffUserDetail } from '../../services/admin/users';
import { idParams, zCategory } from './shared';

const router = Router();

const searchQuery = pageQuery.extend({ q: z.string().max(80).default('') });

router.get(
  '/users',
  validate({ query: searchQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, z.infer<typeof searchQuery>>(req);
    res.json(searchStaffUsers(authed(req), query.q, query.cursor, query.limit));
  }),
);

router.get(
  '/users/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    res.json(staffUserDetail(authed(req), params.id));
  }),
);

router.post(
  '/users/:id/role',
  requireRole('admin'),
  validate({ params: idParams, body: z.object({ role: z.enum(['user', 'moderator', 'admin']) }) }),
  asyncHandler((req, res) => {
    const { params, body } = typed<StaffRoleRequest, unknown, { id: string }>(req);
    res.json(setUserRole(authed(req), params.id, body.role));
  }),
);

router.post(
  '/users/:id/verify',
  requireRole('admin'),
  validate({ params: idParams, body: z.object({ verified: z.boolean() }) }),
  asyncHandler((req, res) => {
    const { params, body } = typed<StaffVerifyRequest, unknown, { id: string }>(req);
    res.json(setUserVerified(authed(req), params.id, body.verified));
  }),
);

const sanctionBody = z.object({
  kind: z.enum(['warning', 'mute', 'suspension', 'ban']),
  durationMs: z.number().int().positive().max(400 * 24 * 60 * 60_000).optional(),
  scope: z.enum(['all', 'buzz_only', 'requests']).optional(),
  category: zCategory,
  note: z.string().max(2000),
});

router.post(
  '/users/:id/sanctions',
  validate({ params: idParams, body: sanctionBody }),
  asyncHandler((req, res) => {
    const { params, body } = typed<StaffSanctionRequest, unknown, { id: string }>(req);
    res.json(applyDirectSanction(authed(req), params.id, body));
  }),
);

router.post(
  '/sanctions/:id/lift',
  requireRole('admin'),
  // anon-origin rows carry a sealed handle (longer than a raw id)
  validate({ params: z.object({ id: z.string().min(1).max(128) }), body: z.object({ note: z.string().max(2000) }) }),
  asyncHandler((req, res) => {
    const { params, body } = typed<LiftSanctionRequest, unknown, { id: string }>(req);
    res.json(liftUserSanction(authed(req), params.id, body.note));
  }),
);

export default router;
