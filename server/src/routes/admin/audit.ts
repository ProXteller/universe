/** Audit routes (SPEC §5.11): list (mods: own rows) + CSV export (admin). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pageQuery, typed, validate } from '../../lib/http';
import { authed, requireRole } from '../../middleware/auth';
import { exportAuditCsv, listAudit } from '../../services/admin/audit';

const router = Router();

const filters = {
  actor: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  targetType: z.string().max(40).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
};
const listQuery = pageQuery.extend(filters);
const csvQuery = z.object(filters);

router.get(
  '/audit',
  validate({ query: listQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, z.infer<typeof listQuery>>(req);
    res.json(listAudit(authed(req), query));
  }),
);

router.get(
  '/audit/export.csv',
  requireRole('admin'),
  validate({ query: csvQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, z.infer<typeof csvQuery>>(req);
    const csv = exportAuditCsv(authed(req), query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  }),
);

export default router;
