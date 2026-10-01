-- 07-roommates: tables owned by the `roommates` slice (SPEC §5.7).
-- A row with published_at IS NULL is a "match preferences" row (Just browse & match): it exists only to compute
-- its owner's match %, is never listed, never counted, never a card and never reportable.

CREATE TABLE IF NOT EXISTS roommate_profiles (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  university_id      TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  mode               TEXT NULL CHECK (mode IS NULL OR mode IN ('need','have')),
  budget             INTEGER NULL,
  move_in            TEXT NULL,                      -- 'YYYY-MM'
  lease_months       INTEGER NULL,
  neighborhoods_json TEXT NOT NULL DEFAULT '[]',
  living_with        TEXT NOT NULL DEFAULT 'anyone' CHECK (living_with IN ('anyone','same_gender')),
  gender             TEXT NULL CHECK (gender IS NULL OR gender IN ('woman','man','nonbinary')),
  about              TEXT NOT NULL DEFAULT '',
  photos_json        TEXT NOT NULL DEFAULT '[]',
  place_json         TEXT NULL,                      -- { rent, roomType, beds, baths, furnished, utilitiesIncluded }
  answers_json       TEXT NOT NULL,                  -- RoommateAnswers
  dealbreak_smoking  INTEGER NOT NULL DEFAULT 0,
  dealbreak_pets     INTEGER NOT NULL DEFAULT 0,
  archetype          TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune   INTEGER NOT NULL DEFAULT 0,
  paused             INTEGER NOT NULL DEFAULT 0,
  low_price_flag     INTEGER NOT NULL DEFAULT 0,
  published_at       INTEGER NULL,
  confirmed_at       INTEGER NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_browse ON roommate_profiles(university_id, status, paused);
CREATE INDEX IF NOT EXISTS idx_roommate_profiles_user ON roommate_profiles(user_id);

CREATE TABLE IF NOT EXISTS roommate_saves (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES roommate_profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_roommate_saves_profile ON roommate_saves(profile_id);
