/**
 * The admin rule packs (SPEC §5.11): `admin.<category>` upgrades over foundation's `baseline`. `registerAdminRulePacks()`
 * is PURE (no DB) and idempotent — the router calls it at import time (R4). Re-applying `admin_rule_pack_state` happens
 * separately through `onDbReady` (services/admin/rulePacks.ts).
 */
import { registerRulePack } from '../../../lib/moderation/index';
import type { RulePack } from '../../../lib/moderation/types';
import { ACADEMIC_PACK } from './academic';
import { COMMERCE_PACK } from './commerce';
import { DRUGS_PACK } from './drugs';
import { HARASSMENT_PACK } from './harassment';
import { HATE_PACK } from './hate';
import { IMPERSONATION_PACK } from './impersonation';
import { PII_PACK } from './pii';
import { SELFHARM_PACK } from './selfharm';
import { SEXUAL_PACK } from './sexual';
import { SPAM_PACK } from './spam';
import { THREATS_PACK } from './threats';

export const ADMIN_RULE_PACKS: readonly RulePack[] = [
  THREATS_PACK, HARASSMENT_PACK, HATE_PACK, SEXUAL_PACK, DRUGS_PACK, SELFHARM_PACK, PII_PACK, IMPERSONATION_PACK, SPAM_PACK, ACADEMIC_PACK, COMMERCE_PACK,
];

export const ADMIN_RULE_PACK_IDS: readonly string[] = ADMIN_RULE_PACKS.map((p) => p.id);

/** Pure registration (last-write-wins registry; never throws). */
export function registerAdminRulePacks(): void {
  for (const pack of ADMIN_RULE_PACKS) registerRulePack(pack);
}
