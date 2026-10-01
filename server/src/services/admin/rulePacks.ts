/**
 * Rule-pack on/off (SPEC §5.11; admin only, audited). The in-memory state lives in lib/moderation; the persisted state
 * (`admin_rule_pack_state`) is re-applied through `onDbReady` — never as a top-level query (R4): on a fresh / `:memory:`
 * DB the table may not exist yet, and `onDbReady` re-runs after every `resetDb()`.
 */
import type { Id, Paginated } from '@shared/core';
import type { RulePackRow } from '@shared/admin';
import { onDbReady, prep, tx } from '../../db/index';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { ApiError } from '../../lib/http';
import { log } from '../../lib/logger';
import { listRulePacks, setRulePackEnabled } from '../../lib/moderation/index';
import type { AuthedUser } from '../../lib/users';
import { requireAdmin, tableExists } from './common';

export function listPacks(): Paginated<RulePackRow> {
  return { items: listRulePacks().sort((a, b) => a.id.localeCompare(b.id)), nextCursor: null };
}

export function setPackEnabled(staff: AuthedUser, id: Id, enabled: boolean): RulePackRow {
  requireAdmin(staff);
  const pack = listRulePacks().find((p) => p.id === id);
  if (!pack) throw ApiError.notFound('Unknown rule pack.');
  tx(() => {
    setRulePackEnabled(id, enabled);
    if (tableExists('admin_rule_pack_state')) {
      prep('INSERT OR REPLACE INTO admin_rule_pack_state (pack_id, enabled, updated_by, updated_at) VALUES (?,?,?,?)').run(id, enabled ? 1 : 0, staff.id, now());
    }
    audit({ actor: staff, action: 'rule_pack_toggle', targetType: 'rule_pack', targetId: id, metadata: { enabled, version: pack.version } });
  });
  return { ...pack, enabled };
}

/** Re-applies the persisted pack state now and after every migrate / reset. Returns the unregister function. */
export function installRulePackStateHook(): () => void {
  return onDbReady(() => {
    if (!tableExists('admin_rule_pack_state')) return;
    try {
      const rows = prep('SELECT pack_id, enabled FROM admin_rule_pack_state').all() as { pack_id: string; enabled: number }[];
      for (const r of rows) setRulePackEnabled(r.pack_id, r.enabled === 1);
    } catch (err) {
      log.error('admin: could not re-apply rule pack state', err);
    }
  });
}
