-- 04-orbit: tables owned by the `orbit` slice (SPEC §5.4). Public posts, likes, polls, comments, visit marker.
-- Conventions: id TEXT PK (nanoid / seed ids), epoch-ms INTEGER timestamps, FKs to core tables only.

CREATE TABLE IF NOT EXISTS orbit_posts (
  id               TEXT PRIMARY KEY,
  author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id    TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  text             TEXT NOT NULL DEFAULT '',
  images_json      TEXT NOT NULL DEFAULT '[]',
  has_poll         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  like_count       INTEGER NOT NULL DEFAULT 0,
  comment_count    INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orbit_posts_author ON orbit_posts(author_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orbit_posts_created ON orbit_posts(created_at DESC, id DESC);
-- campus highlights (DECISIONS D8): the median-engagement scan + the per-campus membership test
CREATE INDEX IF NOT EXISTS idx_orbit_posts_campus ON orbit_posts(university_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS orbit_poll_options (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES orbit_posts(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orbit_poll_options_post ON orbit_poll_options(post_id, idx);

CREATE TABLE IF NOT EXISTS orbit_poll_votes (
  post_id    TEXT NOT NULL REFERENCES orbit_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES orbit_poll_options(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS orbit_likes (
  post_id    TEXT NOT NULL REFERENCES orbit_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_orbit_likes_post ON orbit_likes(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orbit_likes_user ON orbit_likes(user_id);

CREATE TABLE IF NOT EXISTS orbit_comments (
  id               TEXT PRIMARY KEY,
  post_id          TEXT NOT NULL REFERENCES orbit_posts(id) ON DELETE CASCADE,
  author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id        TEXT REFERENCES orbit_comments(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orbit_comments_post ON orbit_comments(post_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orbit_comments_author ON orbit_comments(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orbit_visits (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at INTEGER NOT NULL
);
