-- 02-reels: tables owned by the `reels` slice (SPEC §5.2). Conventions of §4.1: epoch-ms INTEGER timestamps,
-- id TEXT PRIMARY KEY, every UGC table carries status + auto_hide_immune, FKs only to core tables.

CREATE TABLE IF NOT EXISTS reels (
  id               TEXT PRIMARY KEY,
  author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id    TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  caption          TEXT NOT NULL DEFAULT '',
  video_url        TEXT NOT NULL,
  poster_url       TEXT,
  duration_ms      INTEGER NOT NULL,
  width            INTEGER,
  height           INTEGER,
  visibility       TEXT NOT NULL DEFAULT 'global' CHECK (visibility IN ('campus','global')),
  status           TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  like_count       INTEGER NOT NULL DEFAULT 0,
  comment_count    INTEGER NOT NULL DEFAULT 0,
  view_count       INTEGER NOT NULL DEFAULT 0,
  share_count      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reels_campus_idx ON reels(university_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reels_author_idx ON reels(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reels_global_idx ON reels(visibility, status, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_likes (
  reel_id    TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (reel_id, user_id)
);
CREATE INDEX IF NOT EXISTS reel_likes_user_idx ON reel_likes(user_id);

-- view_count = distinct viewers (one row per viewer)
CREATE TABLE IF NOT EXISTS reel_views (
  reel_id         TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed       INTEGER NOT NULL DEFAULT 0,
  first_viewed_at INTEGER NOT NULL,
  PRIMARY KEY (reel_id, user_id)
);

-- "Not interested"
CREATE TABLE IF NOT EXISTS reel_hidden (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reel_id    TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, reel_id)
);

CREATE TABLE IF NOT EXISTS reel_comments (
  id               TEXT PRIMARY KEY,
  reel_id          TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id        TEXT REFERENCES reel_comments(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  like_count       INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reel_comments_reel_idx ON reel_comments(reel_id, parent_id, status, created_at);
CREATE INDEX IF NOT EXISTS reel_comments_author_idx ON reel_comments(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_comment_likes (
  comment_id TEXT NOT NULL REFERENCES reel_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
