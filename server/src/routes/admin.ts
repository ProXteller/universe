/**
 * `admin` slice router — mount `/api/admin` (SPEC §5.11). Router-level `requireRole('moderator','admin')` answers 404
 * to everyone else (the surface does not admit it exists); every response is `no-store`.
 *
 * Import-time work (R4): the eleven `admin.<category>` rule packs are registered (pure) and the persisted
 * `admin_rule_pack_state` is re-applied through `onDbReady` — never a top-level query.
 */
import { Router } from 'express';
import { noStore } from '../lib/http';
import { requireRole } from '../middleware/auth';
import { installRulePackStateHook } from '../services/admin/rulePacks';
import { registerAdminRulePacks } from '../services/admin/rules/index';
import analyticsRouter from './admin/analytics';
import appealsRouter from './admin/appeals';
import auditRouter from './admin/audit';
import limitationsRouter from './admin/limitations';
import queueRouter from './admin/queue';
import rulePacksRouter from './admin/rulePacks';
import unmaskRouter from './admin/unmask';
import usersRouter from './admin/users';

registerAdminRulePacks();
installRulePackStateHook();

const router = Router();

router.use(requireRole('moderator', 'admin'));
router.use((_req, res, next) => {
  noStore(res);
  next();
});

router.use(queueRouter);
router.use(unmaskRouter);
router.use(auditRouter);
router.use(usersRouter);
router.use(appealsRouter);
router.use(analyticsRouter);
router.use(rulePacksRouter);
router.use(limitationsRouter);

export default router;
