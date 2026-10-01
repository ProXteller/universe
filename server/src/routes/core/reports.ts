/**
 * Foundation endpoint #30 (SPEC §4.3): POST /reports.                    LANE S-M2a owns this file.
 * Body: `lib/reports.ts` (idempotent 200, 404 without adapter, self-report 400, `other` note ≥ 10, auto-hide in-tx, rate `report`).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { CreateReportRequest, ReportReceipt } from '@shared/core';
import { LIMITS, LISTING_REPORT_SUBREASONS, REPORT_REASONS } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { asyncHandler, noStore, typed, validate } from '../../lib/http';
import { createReport } from '../../lib/reports';

const router = Router();

const entityTypes = [
  'buzz', 'buzz_reply', 'orbit_post', 'orbit_comment', 'reel', 'reel_comment', 'message', 'conversation',
  'market_listing', 'roommate_listing', 'event', 'profile',
] as const;

export const createReportSchema = z.object({
  entityType: z.enum(entityTypes),
  entityId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS.map((r) => r.id) as [string, ...string[]]),
  subReason: z.enum(LISTING_REPORT_SUBREASONS.map((s) => s.id) as [string, ...string[]]).optional(),
  note: z.string().trim().max(LIMITS.reportNote).optional(),
  includeContext: z.boolean().optional(),
});

router.post(
  '/reports',
  requireAuth,
  requireOnboarded,
  validate({ body: createReportSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<CreateReportRequest>(req);
    const out: ReportReceipt = createReport(req.user!, body);
    res.json(out);
  }),
);

export default router;
