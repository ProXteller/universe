-- 11-admin: tables owned by the `admin` slice (SPEC §5.11). Idempotent. The moderation tables themselves
-- (mod_queue, reports, moderation_actions, strikes, user_sanctions, appeals, audit_log) are core (00-core.sql);
-- admin writes them through lib/moderation/staff.ts + lib/audit.ts.

CREATE TABLE IF NOT EXISTS admin_rule_pack_state (
  pack_id    TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_saved_filters (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_saved_filters_staff ON admin_saved_filters(staff_id, created_at DESC);
