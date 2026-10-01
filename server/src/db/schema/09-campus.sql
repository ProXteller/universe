-- 09-campus: tables owned by the `campus` slice (SPEC §5.9). Idempotent; ids TEXT (nanoid / seed ids); epoch-ms times.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('academic','social','sports','career','arts')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  location_name TEXT NOT NULL,
  address TEXT,
  address_private INTEGER NOT NULL DEFAULT 0,
  cover_url TEXT NOT NULL,
  free_food INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  cancelled_at INTEGER,
  going_count INTEGER NOT NULL DEFAULT 0,
  interested_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_campus_upcoming ON events(university_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id, starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('going','interested')),
  reminded_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user ON event_rsvps(user_id, state);

-- One row per (event, attendee) the host has been told is going. SPEC §5.9 "first `going` → notify": the marker
-- outlives un-RSVP / re-RSVP (the `event_rsvps` row is deleted on un-RSVP), so a host hears about each attendee once.
CREATE TABLE IF NOT EXISTS event_rsvp_pings (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  term TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (university_id, code, term)
);
CREATE INDEX IF NOT EXISTS idx_courses_conversation ON courses(conversation_id);

CREATE TABLE IF NOT EXISTS campus_milestones (
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  goal INTEGER NOT NULL,
  reached_at INTEGER NOT NULL,
  PRIMARY KEY (university_id, goal)
);
