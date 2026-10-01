-- 03-buzz: tables owned by the `buzz` slice (SPEC §5.3). Conventions of §4.1: ids TEXT, epoch-ms INTEGER timestamps.
-- FIREWALL: author_id exists for moderation only. No alias column anywhere (aliases are HMAC-derived at serialization).

CREATE TABLE IF NOT EXISTS buzz_posts (
  id TEXT PRIMARY KEY,
  root_id TEXT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,      -- NULL = root buzz ('buzz'); else a reply ('buzz_reply')
  parent_id TEXT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,    -- the post replied to (root for depth-1 replies)
  depth INTEGER NOT NULL DEFAULT 0,                                   -- true depth (0 root, 1, 2, 3 …); serialized ≤ 2
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,     -- moderation only; never serialized
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  prompt_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',                              -- ContentStatus
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,                                  -- root only
  upvotes INTEGER NOT NULL DEFAULT 0,                                 -- all votes (displayed)
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,                                   -- upvotes − downvotes (displayed, hot ranking)
  eligible_votes INTEGER NOT NULL DEFAULT 0,                          -- count of eligible votes (safety §3.2)
  eligible_score INTEGER NOT NULL DEFAULT 0,                          -- eligible up − down (collapse / auto-hide thresholds)
  reply_count INTEGER NOT NULL DEFAULT 0,                             -- root only: active replies at any depth
  support_link INTEGER NOT NULL DEFAULT 0,                            -- text triggered the self-harm support resources
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NULL
);
CREATE INDEX IF NOT EXISTS buzz_posts_campus ON buzz_posts(university_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS buzz_posts_thread ON buzz_posts(root_id, created_at);
CREATE INDEX IF NOT EXISTS buzz_posts_author ON buzz_posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS buzz_posts_parent ON buzz_posts(parent_id);

CREATE TABLE IF NOT EXISTS buzz_votes (
  post_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  eligible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS buzz_polls (
  post_id TEXT PRIMARY KEY REFERENCES buzz_posts(id) ON DELETE CASCADE,
  closes_at INTEGER NOT NULL,
  closed_notified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS buzz_poll_options (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS buzz_poll_options_post ON buzz_poll_options(post_id, idx);

CREATE TABLE IF NOT EXISTS buzz_poll_votes (
  post_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES buzz_poll_options(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS buzz_hidden_threads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);

-- "Hide this anon in this thread": keyed on thread + author server-side so it can never link across threads (safety L14).
CREATE TABLE IF NOT EXISTS buzz_hidden_authors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, thread_id, author_id)
);

CREATE TABLE IF NOT EXISTS buzz_prompts (
  id TEXT PRIMARY KEY,
  idx INTEGER NOT NULL UNIQUE,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buzz_milestones (
  post_id TEXT NOT NULL REFERENCES buzz_posts(id) ON DELETE CASCADE,
  milestone INTEGER NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (post_id, milestone)
);
