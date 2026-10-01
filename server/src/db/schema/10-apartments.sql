-- 10-apartments: tables owned by the `apartments` slice (SPEC §5.10).
-- Survey answers are option ids (no free text → no moderation columns). One row per (user, question).
CREATE TABLE IF NOT EXISTS apartment_survey_answers (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL,
  question      TEXT NOT NULL CHECK (question IN ('when','budget','priorities')),
  answer_json   TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, question)
);
CREATE INDEX IF NOT EXISTS idx_apartment_survey_campus ON apartment_survey_answers (university_id, question);
