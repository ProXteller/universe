-- 08-market: tables owned by the `market` slice (SPEC §5.8). Campus-only marketplace.

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sell','trade','free','wanted','lost','found')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NULL,
  trade_for TEXT NULL,
  condition TEXT NULL CHECK (condition IS NULL OR condition IN ('new','like_new','good','fair')),
  course_code TEXT NULL,
  meetup_spot TEXT NULL,
  location_text TEXT NULL,
  occurred_on TEXT NULL,
  photos_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  auto_hide_immune INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','sold','returned')),
  closed_at INTEGER NULL,
  expires_at INTEGER NOT NULL,
  low_price_flag INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  save_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_listings_browse ON market_listings(university_id, status, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_market_listings_course ON market_listings(university_id, course_code);

CREATE TABLE IF NOT EXISTS market_saves (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  saved_price INTEGER NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_market_saves_listing ON market_saves(listing_id);

CREATE TABLE IF NOT EXISTS market_views (
  listing_id TEXT NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  PRIMARY KEY (listing_id, user_id, day)
);
