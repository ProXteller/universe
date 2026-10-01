-- 05-discover: tables owned by the `discover` slice (SPEC §5.5).
-- Discover otherwise READS core tables only (users, follows, blocks, public_activity, universities). Never Buzz.

CREATE TABLE IF NOT EXISTS discover_dismissals (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section    TEXT    NOT NULL CHECK (section IN ('people_you_may_know', 'active_creators', 'popular_orgs')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_id, section)
);

CREATE INDEX IF NOT EXISTS idx_discover_dismissals_user ON discover_dismissals(user_id, section);
