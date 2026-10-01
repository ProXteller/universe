## discover slice (05) — final report

### Files created / replaced (all owned; nothing outside the lane touched)
Root: `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/`

- `shared/src/discover.ts` — `SuggestionSection`, `Suggestion`, `DiscoverHome`, `SearchHit`, `DiscoverSearchResponse`, `DiscoverSearchType`, `DismissSuggestionRequest`, `INTEREST_OPTIONS` (42), `SUGGESTION_SECTIONS`, `DISCOVER_HOME_LIMITS`, `ACTIVE_CREATOR_WINDOW_DAYS`, recents key/cap.
- `server/src/db/schema/05-discover.sql` — `discover_dismissals(user_id, target_id, section CHECK, created_at, PK(user_id,target_id,section))` + index.
- `server/src/routes/discover.ts` — `GET /home`, `POST /dismiss` (204), `GET /search?q&type=all|people|orgs&cursor&limit`; zod via `validate()`, every handler in `asyncHandler`, `noStore`, rate `search`, `trackEvent('search'|'suggestion_dismiss')`.
- `server/src/services/discover/{common,home,search,dismiss}.ts` — reads core tables only (`users`, `follows`, `blocks`, `universities`, `public_activity` via `publicActivityStats`) + own table; hidden-campus (`uni_team`) + `sqlNotBlocked` + `status='active'` on every query; PYMK = same campus ∧ (same major ∨ same class year ∨ ≥1 mutual) ranked by mutuals; active creators = `last_public_post_at` within 14 d, campus first, minors never cross-campus (minor viewer campus-only); popular orgs = campus orgs by `follower_count`. Search = one list with composite sort key `campusTier·1e11 + matchTier·1e10 + (1e10−1−follower_count)` inside the HMAC keyset cursor, so campus-first holds across page boundaries. Reasons: `"CS · 3 mutuals"` / `"Class of 2028 · 2 mutuals"` / `"3 reels this week"` / `"1 post in the last 2 weeks"` / `"21 followers at UT Austin"`.
- `server/src/db/seeds/05-discover.ts` — 3 PYMK dismissals for Maya (`calebt`, `chloedub`, `ryanoc`), deterministic, both scales, `INSERT OR IGNORE`. Verified Maya's PYMK then reads `bellarossi — 6 mutuals, meitanaka — 5 mutuals, graceade — 4 mutuals, fatima_as — Class of 2028 · 3 mutuals, …` (§7.5).
- `server/tests/discover.test.ts` — 16 tests.
- `client/src/features/discover/index.tsx` (frozen exports `DiscoverRoutes`, `ProfileRoutes`, `EditProfilePage`; no sibling `index.ts`), `api.ts`, `DiscoverHome.tsx`, `SearchPage.tsx`, `ProfilePage.tsx`, `FollowListPage.tsx`, `EditProfilePage.tsx`, `suggestions.tsx`, `crossSlice.tsx`, `Highlight.tsx`, `banner.ts`, `recents.ts`.

### Commands run and real results
- `cd server && npx vitest run tests/discover.test.ts --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1` → **16 passed / 0 failed** (final run 208 ms). Note: plain `npx vitest run tests/discover.test.ts --poolOptions.forks.maxForks=1` errors with tinypool "minThreads and maxThreads must not conflict" — pass both min/max forks (or neither).
- `cd server && npx tsc --noEmit` → **0 errors** (whole package).
- `cd client && npx tsc --noEmit` → 2 errors total, **0 in my lane** (see below).
- Extra: `--noUnusedLocals` in both packages → nothing in my lane. Grep: no `Date.now`, no top-level `prep()/db.prepare()`, no `position: fixed`/`100vh`/raw hex/spinners/hard-coded hrefs/"$" in owned files. No dev server / vite build started; no processes left running.

### T1 acceptance verified
- Tests (SPEC §5.5 list): suggestions exclude followed / blocked (both directions) / dismissed / self; reasons derive from real rows (asserted against `follows`/`users` SQL); search is one `Paginated<SearchHit>` ordered campus-first across page boundaries (limit 5 paging, no dupes/gaps, tampered cursor → 400 `invalid_cursor`); block exclusion; suspended users and hidden-university `uni_team` users absent from home and search; runs with all other slice tables absent (isolation asserted on `sqlite_master`); no Buzz fields (`alias/isOp/isMine/threadId/karma/score/…`) in any response; 401 on all three endpoints; 400 validation (`section`, `type`, `limit`); dismiss idempotent, 404 unknown user, 400 self; `Cache-Control: no-store`.
- Client: search 250 ms debounce with `UserRow`-geometry skeleton rows, Top/People/Orgs, campus group then "Other campuses", matched text highlighted, product empty copy; every suggestion shows a reason and an (x) with optimistic removal; profile = id-derived token-only aurora banner, chips, campus · major · year, bio, real counts (tappable → follow lists), mutual line, `FollowButton` + Message (`openDm`) + overflow (Share / Copy link / Report `profile` / Block), tabs Reels · Posts · About (+ Events for orgs) via lazily loaded `UserReelsGrid`/`UserPostsList`/`OrgEventsList` inside a silent error boundary (render nothing on stub/throw, R6); own profile → Edit + Share + gear→`/settings`; blocked-by-me shell with Unblock; generic "This profile isn't available." on 404; follow lists with Tabs, search, product empty states, `InfiniteSentinel`; edit profile = `PATCH /me` with `MediaPicker variant="avatar"`, live handle availability (#5) + 14-day lock, bio, major datalist from `MAJORS`, year + program, pronouns, org category, `ComposerModeBanner mode="public" verb="Editing"` inside `ComposerGuard`, Save disabled until dirty, discard Dialog, `handleModerationError` / `showModerationNotice`. Query keys `['discover', …]` plus reserved `['users', id]` (set via `setQueryData`) and `['users','handle', handle]`.

### T2 items — all shipped, none dropped
Dismissible suggestions · local recents (`uv:discover:recent`, removable + clear all) · Founding member / New account / Unverified org chips · org starter card (own org profile: Add a logo → edit, Post your first event → `/campus/events/new`, Share your follow link → copy) · interests (≤5 chips on edit, shown on About).

### R7 controls omitted
- "Trending on campus" (cut, §1.2/§2.3). No Save/bookmark. No external links on profiles (product §2.5).

### Foundation gaps worked around / notes
- No foundation helper for "search hit highlight"; search rows are a local twin of `UserRow` geometry so the display name can be highlighted (UserRow has no title slot).
- `PageHeader` wraps the compact title in an `<h1>`, so the search screen keeps title "Search" with the input in `below` rather than design's "input as header".
- `discover` has no UGC create route (edit profile is foundation #10), so "moderation 422 / muted 403 on every create route" tests do not apply; `POST /dismiss` is not a UGC write and takes no `requireCanPost`.
- `Card variant="hero"` only on Discover home (Campus hub); the org starter card uses a plain `bg-hero-soft` section to respect "max one hero per screen".
- Not verified in a browser (per the no-dev-server rule); verified by tsc + tests only.

### tsc errors outside my lane (not fixed)
- `client/src/features/orbit/api.ts(93,34): error TS4104: The type 'readonly ["orbit", "user", string]' is 'readonly' and cannot be assigned to the mutable type 'unknown[]'.`
- `client/src/features/orbit/api.ts(97,41): error TS4104: The type 'readonly ["orbit", "comments", string]' is 'readonly' and cannot be assigned to the mutable type 'unknown[]'.`
- Server: none.