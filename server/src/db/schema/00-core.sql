-- UniVerse core schema (SPEC §4.1). Foundation-owned. Every statement is idempotent.
-- Conventions: id TEXT PRIMARY KEY; *_at INTEGER epoch-ms; booleans INTEGER NOT NULL DEFAULT 0; *_json TEXT holds JSON;
-- FKs ON DELETE CASCADE unless noted. Slice tables reference users(id) / universities(id) only.

/* ───────────────────────────── universities ───────────────────────────── */

CREATE TABLE IF NOT EXISTS universities (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  short_name         TEXT NOT NULL,
  domain             TEXT NOT NULL UNIQUE,
  extra_domains_json TEXT NOT NULL DEFAULT '[]',
  country_code       TEXT NOT NULL DEFAULT 'US',
  city               TEXT,
  is_auto_created    INTEGER NOT NULL DEFAULT 0,
  is_hidden          INTEGER NOT NULL DEFAULT 0,   -- 1 only for the staff-bootstrap record uni_team
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campus_places (
  id            TEXT PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('meetup','neighborhood','venue')),
  name          TEXT NOT NULL,
  sort          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_campus_places_uni ON campus_places(university_id, kind, sort);

/* ───────────────────────────── users & auth ───────────────────────────── */

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  handle                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name            TEXT NOT NULL,
  avatar_url              TEXT,
  avatar_seed             TEXT NOT NULL,
  account_type            TEXT NOT NULL DEFAULT 'student' CHECK (account_type IN ('student','org')),
  role                    TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned','deleted')),
  university_id           TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  bio                     TEXT NOT NULL DEFAULT '',
  major                   TEXT,
  class_year              INTEGER,
  class_kind              TEXT CHECK (class_kind IS NULL OR class_kind IN ('undergrad','grad','other')),
  pronouns                TEXT,
  interests_json          TEXT NOT NULL DEFAULT '[]',
  org_category            TEXT,
  is_verified             INTEGER NOT NULL DEFAULT 0,
  is_adult                INTEGER,
  is_adult_edited         INTEGER NOT NULL DEFAULT 0,
  campus_rank             INTEGER NOT NULL DEFAULT 0,
  invite_code             TEXT NOT NULL UNIQUE,
  invited_by              TEXT REFERENCES users(id) ON DELETE SET NULL,
  guidelines_version      TEXT,
  guidelines_accepted_at  INTEGER,
  buzz_gate_version       TEXT,
  buzz_gate_accepted_at   INTEGER,
  profile_completed_at    INTEGER,
  onboarding_completed_at INTEGER,
  settings_json           TEXT NOT NULL DEFAULT '{}',
  handle_changed_at       INTEGER,
  follower_count          INTEGER NOT NULL DEFAULT 0,
  following_count         INTEGER NOT NULL DEFAULT 0,
  post_count              INTEGER NOT NULL DEFAULT 0,
  reel_count              INTEGER NOT NULL DEFAULT 0,
  last_public_post_at     INTEGER,               -- written ONLY by markPublicActivity()
  last_active_at          INTEGER,               -- 5-min buckets; bumped uniformly by requireAuth
  restricted_until        INTEGER,               -- "treated as new" until (72 h after a suspension ends)
  deleted_at              INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_uni_type ON users(university_id, account_type);
CREATE INDEX IF NOT EXISTS idx_users_uni_public ON users(university_id, last_public_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL COLLATE NOCASE,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  invite_code  TEXT,
  last_sent_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at DESC);

-- Optional password sign-in (DECISIONS D9). One row per user who set a password; no row = email-code only.
-- password_hash is `scrypt$N$r$p$salt$hash` (base64url). two_factor = 1 → a password sign-in also needs an email code.
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash   TEXT NOT NULL,
  two_factor      INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,
  set_at          INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- The step between a correct password and the email code when two-factor is on (10-minute, single use).
CREATE TABLE IF NOT EXISTS login_challenges (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signup_tokens (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL COLLATE NOCASE,
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  invite_code   TEXT,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS banned_emails (
  email_hash TEXT PRIMARY KEY,          -- sha256(lower-cased email)
  created_at INTEGER NOT NULL
);

/* ───────────────────────────── graph ───────────────────────────── */

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS public_activity (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('reel','post','event')),
  entity_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (kind, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_public_activity_user ON public_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_activity_uni ON public_activity(university_id, created_at DESC);

/* ───────────────────────────── uploads ───────────────────────────── */

CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video')),
  purpose     TEXT,
  mime        TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);

/* ───────────────────────────── conversations & messages ───────────────────────────── */

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('dm','group','course')),
  title           TEXT,
  avatar_url      TEXT,
  university_id   TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  dm_key          TEXT UNIQUE,                     -- 'minId:maxId' for DMs
  context_kind    TEXT CHECK (context_kind IS NULL OR context_kind IN ('listing','roommate')),
  context_id      TEXT,
  course_id       TEXT,                            -- denormalised by createCourseConversation; the ONLY source of CourseChatMeta
  course_code     TEXT,
  course_title    TEXT,
  course_term     TEXT,
  name_locked     INTEGER NOT NULL DEFAULT 0,
  last_message_id TEXT,
  last_message_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_context ON conversations(context_kind, context_id);
CREATE INDEX IF NOT EXISTS idx_conversations_course ON conversations(course_id);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  state                TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','request','declined','left')),
  muted                INTEGER NOT NULL DEFAULT 0,
  last_read_message_id TEXT,
  last_read_at         INTEGER,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  joined_at            INTEGER NOT NULL,
  left_at              INTEGER,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id, state);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('text','image','card','offer','system')),
  text             TEXT NOT NULL DEFAULT '',
  images_json      TEXT NOT NULL DEFAULT '[]',
  card_kind        TEXT,
  card_id          TEXT,
  offer_listing_id TEXT,
  offer_amount     INTEGER,
  offer_status     TEXT CHECK (offer_status IS NULL OR offer_status IN ('pending','accepted','declined','withdrawn')),
  reply_to_id      TEXT,
  client_id        TEXT,
  banner           TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  deleted_at       INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_request_cooldowns (
  sender_id    TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  until        INTEGER NOT NULL,
  PRIMARY KEY (sender_id, recipient_id)
);

/* ───────────────────────────── notifications ───────────────────────────── */

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  category      TEXT NOT NULL,
  anonymous     INTEGER NOT NULL DEFAULT 0,
  actor_id      TEXT REFERENCES users(id) ON DELETE CASCADE,   -- NULL when anonymous = 1 (CHECK below)
  actor_count   INTEGER NOT NULL DEFAULT 1,
  target_type   TEXT,
  target_id     TEXT,
  href          TEXT NOT NULL,
  thumbnail_url TEXT,
  data_json     TEXT NOT NULL DEFAULT '{}',
  collapse_key  TEXT,
  read_at       INTEGER,
  created_at    INTEGER NOT NULL,
  CHECK (anonymous = 0 OR actor_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_collapse ON notifications(user_id, collapse_key);

CREATE TABLE IF NOT EXISTS notification_actors (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  actor_id        TEXT NOT NULL,
  PRIMARY KEY (notification_id, actor_id)
);

/* ───────────────────────────── reports & moderation ───────────────────────────── */

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  reporter_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  sub_reason    TEXT,
  note          TEXT,
  context_json  TEXT,
  university_id TEXT NOT NULL,
  eligible      INTEGER NOT NULL DEFAULT 0,
  weight        INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  bad_faith     INTEGER NOT NULL DEFAULT 0,
  queue_id      TEXT,
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  UNIQUE (reporter_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);

CREATE TABLE IF NOT EXISTS mod_queue (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  surface         TEXT NOT NULL,
  university_id   TEXT NOT NULL,
  author_id       TEXT,                 -- server-internal; NEVER serialized for anon entity types
  source          TEXT NOT NULL CHECK (source IN ('rule_flag','rule_block_escalation','ai_flag','user_report','community_score','appeal','system')),
  category        TEXT,
  severity        TEXT NOT NULL DEFAULT 'none',
  priority        TEXT NOT NULL CHECK (priority IN ('p0','p1','p2','p3')),
  label           TEXT,                 -- 'wellbeing'
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','escalated','closed')),
  claimed_by      TEXT,
  claimed_at      INTEGER,
  report_count    INTEGER NOT NULL DEFAULT 0,
  reporter_weight INTEGER NOT NULL DEFAULT 0,
  blocked_text    TEXT,
  rule_ids_json   TEXT NOT NULL DEFAULT '[]',
  ai_verdict_json TEXT,
  legal_hold      INTEGER NOT NULL DEFAULT 0,
  reference       TEXT,
  appeal_id       TEXT,
  created_at      INTEGER NOT NULL,
  first_action_at INTEGER,
  closed_at       INTEGER,
  resolution      TEXT CHECK (resolution IS NULL OR resolution IN ('approved','removed','dismissed','sanctioned','escalated_external'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_entity ON mod_queue(entity_type, entity_id)
  WHERE status != 'closed' AND entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mod_queue_status ON mod_queue(status, priority, created_at);

CREATE TABLE IF NOT EXISTS moderation_events (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  surface        TEXT NOT NULL,
  field          TEXT NOT NULL DEFAULT 'body',
  author_id      TEXT NOT NULL,
  university_id  TEXT NOT NULL,
  action         TEXT NOT NULL,
  visibility     TEXT NOT NULL,
  category       TEXT,
  subcode        TEXT,
  severity       TEXT NOT NULL DEFAULT 'none',
  rule_ids_json  TEXT NOT NULL DEFAULT '[]',
  matches_json   TEXT NOT NULL DEFAULT '[]',
  signals_json   TEXT NOT NULL DEFAULT '{}',
  text_hash      TEXT NOT NULL DEFAULT '',
  engine_version TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_events_entity ON moderation_events(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id             TEXT PRIMARY KEY,
  queue_id       TEXT,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  target_user_id TEXT,                  -- server-internal for anon-origin rows (SPEC §4.2.14 rule 3)
  actor_id       TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  action         TEXT NOT NULL,
  category       TEXT,
  note           TEXT,
  batch_id       TEXT,
  sanction_id    TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_queue ON moderation_actions(queue_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_entity ON moderation_actions(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS strikes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL,
  points      INTEGER NOT NULL,
  action_id   TEXT NOT NULL,
  expires_at  INTEGER,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strikes_user ON strikes(user_id);

CREATE TABLE IF NOT EXISTS user_sanctions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('warning','mute','suspension','ban','removal')),
  scope           TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','buzz_only','requests')),
  category        TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  content_excerpt TEXT,
  content_label   TEXT,
  action_id       TEXT,
  actor_id        TEXT,
  starts_at       INTEGER NOT NULL,
  effective_at    INTEGER NOT NULL,
  ends_at         INTEGER,
  acknowledged_at INTEGER,
  lifted_at       INTEGER,
  lifted_by       TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sanctions_user ON user_sanctions(user_id, kind, ends_at);

CREATE TABLE IF NOT EXISTS appeals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sanction_id  TEXT NOT NULL UNIQUE REFERENCES user_sanctions(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','reversed','reduced')),
  reviewer_id  TEXT,
  outcome_note TEXT,
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL,          -- user id or 'system'
  actor_role    TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  queue_id      TEXT,
  batch_id      TEXT,
  reason_code   TEXT,
  reason        TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

/* ───────────────────────────── analytics, waitlist, rate limits ───────────────────────────── */

CREATE TABLE IF NOT EXISTS analytics_events (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  user_id       TEXT,
  anon_hash     TEXT,
  university_id TEXT,
  session_id    TEXT,
  props_json    TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_uni_name ON analytics_events(university_id, name, created_at);

CREATE TABLE IF NOT EXISTS waitlist (
  id            TEXT PRIMARY KEY,
  feature       TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL,
  source        TEXT,
  created_at    INTEGER NOT NULL,
  left_at       INTEGER,
  UNIQUE (feature, user_id)
);

CREATE TABLE IF NOT EXISTS rate_events (
  user_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(user_id, action, created_at);

CREATE TABLE IF NOT EXISTS recent_text_hashes (
  user_id         TEXT NOT NULL,
  surface_group   TEXT NOT NULL,
  hash            TEXT NOT NULL,
  conversation_id TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_text_hashes ON recent_text_hashes(user_id, surface_group, created_at);
