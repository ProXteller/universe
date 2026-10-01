AUTH SLICE (01) — REPORT

Root: `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/`

## Files created / replaced (all inside the owned lane)
- `shared/src/auth.ts` — `RESERVED_DISPLAY_WORDS`, `OnboardingStep`, `OnboardingSuggestionRow`, `OnboardingSuggestions` (+ `OnboardingSuggestionSection`, `OnboardingSectionId`), `FollowManyRequest/Response`, constants (`ONBOARDING_SECTION_ROWS=8`, `ONBOARDING_FOLLOW_MANY_MAX=10`, `ONBOARDING_NEW_CAMPUS_THRESHOLD=5`, `ONBOARDING_ACTIVE_WINDOW_DAYS=14`). Type-only import of `./core`, zero npm imports.
- `server/src/routes/auth.ts` — `GET /suggestions`, `POST /follow-many` (zod, asyncHandler, `noStore`; mounted by foundation at `/api/onboarding` with `requireAuth` only).
- `server/src/services/auth/suggestions.ts` — core tables only (`users`, `follows`, `blocks`, `universities`, `public_activity` via `publicActivityStats`); sections popular_orgs → in_major (falls back to class_year) → active; dedupe across sections; excludes self / followed / blocked both ways / non-active / hidden campuses; inviter pinned (stays pinned once followed, never when blocked); `isNewCampus` (< 5 other active users) widens scope to every non-hidden campus. Lazy `prep()` only (R4).
- `server/src/services/auth/followMany.ts` — loops foundation `followUser` (block check, `follow` rate limit, counters, `follow.new`); skips self/404/400; 429 re-thrown only when nothing was followed, else partial list; `trackEvent('onboarding_step', {step:'follow', followed})`.
- `server/src/db/schema/01-auth.sql`, `server/src/db/seeds/01-auth.ts` — explicit no-ops (SPEC §5.1: no tables, no seeds).
- `server/tests/auth.test.ts` — 16 tests.
- `client/src/features/auth/index.tsx` (export `AuthRoutes: FC` unchanged, no sibling `index.ts`), `store.ts` (`useAuthFlow`, sessionStorage `uv:auth:flow`, reset registered via effect), `api.ts` (keys `['auth', …]`), `shared.tsx` (StepScreen with `StepDots total=5`, resume logic, class-year chips, DiceBear URL twin, hooks), `OrbitIllustration.tsx`, `RingsExit.tsx`, `screens/{Welcome,Email,Code,Profile,Guidelines,Follow}.tsx`.

## Commands run and real results
- `cd server && npx vitest run tests/auth.test.ts` → **1 file, 16 passed** (run 3×, last: 16/16 in 971 ms).
- `cd server && npx tsc --noEmit` → exit 0, 0 errors (also `--noUnusedLocals --noUnusedParameters` filtered to lane: none).
- `cd client && npx tsc --noEmit` → first run exit 0 / 0 errors; final run: **0 errors in `features/auth` / `shared/src/auth`**, 2 errors outside my lane (below).
- No dev server, no vite build, no npm install, no git; `pgrep` confirms no processes left.

## T1 acceptance verified
- Server: suggestions shape + honest reason lines (counts equal DB rows), popular orgs ordered by follower_count, in_major → class_year fallback, exclusions (self/followed/blocked-both-ways/suspended), inviter pinned first + tagged + still pinned after follow + gone when blocked, new-campus variant (ETH at lite → `isNewCampus:true`, rows from UT Austin, never `uni_team`), "Active on campus" only from `markPublicActivity` (campus-scoped, 14-day window, "Radio-TV-Film · 2 reels this month"), org viewers get no major/year section, response identical on repeat with only core tables present + no private fields, follow-many happy path (counters = rows, idempotent, skips self/blocked/missing, followed rows leave suggestions), rate limit 429 when nothing followed / partial list mid-loop (`RATE_LIMITS=on`), `follow.new` notification via foundation, 401 signed-out, 400 validation (0 / 11 ids / wrong shape), reachable pre-onboarding while `/me/badges` still 403s.
- Client (by construction, typechecked; browser not run per machine budget): email → code (dev-inbox toast + Fill auto-verifies) → profile (18+ Yes/No ChipGroup, no default, Continue gated) → guidelines ("I agree" → `POST /me/guidelines`) → follow → `POST /me/onboarding/complete`; refresh resumes (email/code/profile draft from sessionStorage; guidelines/follow from `me.onboarding`); `?next=`/`?invite=` honoured (invite → `/auth/start` + `/auth/complete`, inviter pill from `GET /invites/:code`, pinned row; `next` consumed by foundation `RedirectIfReady` when the session flips to ready); returning user → "Welcome back, {firstName}."; every error inline with product copy (personal/disposable/not-academic/malformed/rate-limited/wrong "{n} tries left"/expired/locked/handle taken+alternatives/expired sign-up session).

## T2 items — none dropped
Rings-expand exit (900 ms, portaled into the Screen float layer, skipped under reduced motion) + one-time coach mark toast "Swipe for Buzz and Orbit" (`uv:auth:coach`, only when landing on Home); handle alternatives (tappable chips from `/auth/handle-available` suggestions and from 409 `details.suggestions`); DiceBear shuffle (random seed, preview via `/api/avatars/<seed>.svg`, seed sent as `avatarSeed`); photo upload after complete (`uploadImage(kind:'avatar')` → `PATCH /me`, failure = non-blocking toast).

## R7 controls omitted
- `ComposerModeBanner` is NOT rendered on the profile step: it is not a UGC composer and the banner needs a signed-in viewer (`@handle`), which does not exist before `/auth/complete`. No other create/edit surface exists in this slice.
- No `InfiniteSentinel` on the follow list: `GET /onboarding/suggestions` is unpaged by contract (≤ 8 rows × ≤ 4 sections). Skeleton / EmptyState / ErrorState+retry are present.
- Design §7.1 "Follow all" → "Follow top 5" (SPEC §2.3); guidelines Switch → single "I agree" (SPEC §2.3); design's Select for major/class year → product's chips + typeahead.

## Foundation gaps worked around
1. **`/api/auth/*` IP limiter is 10 req/min and includes the two live-lookup endpoints** (`GET /auth/domain`, `GET /auth/handle-available`) that share the budget with start/verify/complete. Worked around: domain lookup keyed by domain only, 500 ms debounce, 10-min cache; handle check 500 ms debounce, 60 s cache; if a lookup itself 429s/fails, Send/Continue stay enabled and the server decides (`/auth/start`, `/auth/complete` errors are shown inline). Suggest a separate/looser limiter for the two GETs.
2. No client twin of `avatarUrlFor` for a not-yet-created account → `generatedAvatarUrl(seed, type)` in `features/auth/shared.tsx` builds `${API_BASE}/avatars/<seed>.svg?t=<type>`.
3. `GuidelinesContent` stub (admin) renders `null` and cannot be detected statically → the sheet checks `childElementCount` after mount and degrades to a link to `/guidelines` (R6).
4. `RedirectIfReady` copies `?invite=` into sessionStorage in an effect (after the first child render) → Welcome reads `useSearchParams().get('invite') ?? getPendingInvite()`.
5. Exit/returning-user navigation is delegated to `RedirectIfReady` (setting `me` with `completed:true` makes the guard navigate to the stored `next`); a manual `navigate()` would race it. Documented in `Follow.tsx` / `Code.tsx`.
6. `track('signup_verified')` client-side is impossible (not a pre-auth event, user still signed out) — the server already tracks it in `/auth/verify`; `screen_view` on the pre-session steps is dropped by `track()` by design.

## tsc errors seen outside my lane (not fixed)
- `client/src/features/orbit/api.ts(93,34): error TS4104: The type 'readonly ["orbit", "user", string]' is 'readonly' and cannot be assigned to the mutable type 'unknown[]'.`
- `client/src/features/orbit/api.ts(97,41): error TS4104: The type 'readonly ["orbit", "comments", string]' is 'readonly' and cannot be assigned to the mutable type 'unknown[]'.`
- Server: none.