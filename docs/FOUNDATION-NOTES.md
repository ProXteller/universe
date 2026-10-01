# Foundation notes — what the foundation agents actually built (read this after SPEC.md)

> Auto-assembled from the foundation agents' final reports. Where a signature here differs from SPEC prose, the CODE wins.



---

## Report: client:C1-ui-kit

LANE C-1 report — theme + UI kit (client half of M1, part 1). Project root: `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752` (all paths below are under `client/`).

## Files created (46)

- `index.html` — `viewport-fit=cover`, `theme-color #090b14`, manifest link, SVG favicon/apple-touch icon, inline pre-CSS backdrop paint.
- `public/manifest.webmanifest`, `public/icons/{icon,icon-maskable,favicon}.svg` — orbit ring + dot on the aurora gradient, maskable safe zone 80%.
- `src/main.tsx` — imports the two `@fontsource-variable` packages, `theme.css`, `base.css`; `<MotionConfig reducedMotion>` wrapper; picks up `app/App.tsx` via `import.meta.glob` when C-2 lands it, otherwise boots the kit gallery in a bare `#frame` (that is how it was reviewed).
- `src/app/styles/theme.css` — SPEC §2.1 pasted verbatim (verified with `diff` against SPEC lines 159–371).
- `src/app/styles/base.css` — design §9 base layer + `shimmer`/`skeleton`, `#frame`/`#screen-root`/`#overlay-root` rules (no `position:fixed`, no `100vh/vw`; ≥768 px = 430 px rounded frame, `container-type: size`), reduced-motion CSS guard (OS media query AND `html[data-reduce-motion="true"]`, `.motion-safe-keep` opt-out), press/dots/caret/indeterminate keyframes, and a `[data-surface="incognito"] [data-surface="public"]` reverse remap.
- `src/lib/motion.ts` — design §4.1 verbatim (5 springs, `duration`, `ease`, `press`, `pressIcon`, `fadeUp`, `stagger`) + `useReducedMotionPref()`, `prefersReducedMotion()`, `setReducedMotionSetting(bool)` (the hook C-2's `lib/session.ts` calls with `me.settings.reduceMotion`), `reducedTween`, `exitTween`, `fadeOnly`, `motionSafe()`, `useSpringPreset()`, `useFadeUp()`.
- `src/lib/cn.ts` — `cn()` with tailwind-merge extended for `text-md/2xs`, `shadow-glow/frame`, `inset-shadow-hairline` and a `type-*` class group (so two type roles never both survive a merge).
- `src/ui/index.ts` barrel + every §2.2 component, one file each: `Surface`, `Button`, `IconButton`, `FAB`, `Input`, `Textarea`, `Select` (+`MultiSelect`), `Switch`, `Slider` (+`RangeSlider`), `OTPInput`, `Chip` (+`ChipGroup`), `Badge` (+`VerifiedBadge`, `OpBadge`, `CampusBadge`), `SegmentedControl`, `Tabs`, `Progress` (`ProgressBar`, `StepDots`, `ProgressRing`, `NumberStepper`), `Avatar` (+`AvatarStack`), `AliasAvatar`, `Card` (+`.Header/.Body/.Footer`), `ListRow`, `PageHeader`, `Screen`, `Sheet`, `ActionSheet`, `Dialog`, `Toaster` + `toast` (store in `src/ui/toast.ts`), `Skeleton`/`SkeletonText`, `EmptyState`, `ErrorState`, `InfiniteSentinel`, `PullToRefresh`, `Lightbox`. Internal helpers: `Field.tsx`, `overlay.tsx` (`OverlayPortal`, layer stack, Esc, focus trap, keyboard inset, `useMergedRef`), `navVisibility.ts`, `useScrollEdges.ts`.
- `src/app/dev/KitGallery.tsx` — every component and state, Aurora/Incognito toggle (whole page incl. portaled overlays), reduced-motion switch, only local SVG data-URI art.

## Verified

- `npx tsc --noEmit` in `client/` → clean (run after every fix; final run green).
- Rendered in the browser pane with a scratch Vite on port 5199 (killed afterwards; confirmed no listener/process left) at 390×844, 360×740 (no horizontal overflow) and 1100×900 (430 px centred frame, safe-top 10 px), zero console errors. Checked by hand: fonts load; large `PageHeader` → compact glass on scroll; `Sheet` renders inside `#overlay-root`, focus lands on the dialog, 1:1 drag, slow short drag settles back, fling (>600 px/s) dismisses, `['half','full']` opens at 56 % and flings to full with body scrolling + pinned footer, Esc closes; nested `Select` sheet; `ActionSheet` → danger `Dialog` with async confirm (`aria-busy` during, closes on resolve, toast); toasts stack top-centre; incognito mode remaps to Phosphor and the portal wrapper carries `data-surface="incognito"` (Cancel button bg = incog surface-3); OTP autofill path via one native input → success state; FAB hides on scroll down / returns on scroll up / collapses past 80 px; reduce-motion switch stamps `html[data-reduce-motion]` and the skeleton stops shimmering.

## Deviations from SPEC (and why)

1. Generic components (`Select`, `MultiSelect`, `SegmentedControl`, `Tabs`) declare `onChange: (v: T) => void` (property) instead of the method form `onChange(v: T): void`, and `options`/`tabs` are `readonly …[]`. Reason: with the method form TS infers `T = string` when a `useState` setter is passed, breaking callers; call sites are unchanged. `ChipGroup.onChange` stays `(v: any) => void` per SPEC.
2. `Textarea.showCount` defaults to `true` when `maxLength` is set (SPEC leaves the default unspecified).
3. `FAB` outside a `<Screen>` renders in place; inside one it portals into the screen's non-scrolling float layer (so it can be written anywhere in the JSX). `FAB` gained an optional `className`.
4. `Switch` accepts `aria-labelledby`/`id` in addition to `aria-label` (needed for `ListRow` pairing). `Sheet` accepts `'aria-label'` for title-less sheets. `ProgressBar`/`ProgressRing`/`Slider` accept `disabled`/`aria-label` extras. All additive.
5. `Button`/`IconButton`/`Card` with `to` forward the ref to the `<a>`; the `ref` type stays `HTMLButtonElement` per SPEC's `ButtonHTMLAttributes` framing.
6. `base.css` is plain CSS with native `@layer` and a `.skeleton` class in `@layer utilities` rather than `@utility skeleton`: `@tailwindcss/vite` only compiles files containing `@tailwind`/`@apply`/`theme()`, so an `@utility` in `base.css` would never be emitted. Same class name and declarations as design §9.
7. `StepDots.current` is documented as 1-based ("Step 2 of 5"); SPEC did not say.

## Stubbed / deferred

- Nothing stubbed. Not in this lane (C-2): `lib/toast.ts` should be `export { toast, type ToastOptions } from '@/ui/toast';` — the store lives with `<Toaster/>` so there is exactly one; `stores/ui.ts`'s `useNavVisible` should re-export `useNavVisibility` from `@/ui` (only `<Screen nav>` writes it, `FAB`/`BottomNav` read it); `lib/session.ts` should call `setReducedMotionSetting(me.settings.reduceMotion)` and `setReducedMotionSetting(false)` on logout; the kit gallery route `/dev/kit` must be added to `router.tsx` (dev-only, lazy).
- `toast.devInbox` is not gated on `import.meta.env.DEV` (it's only reachable through `devCode`, which production never returns).

## Gaps found in SPEC

- §2.2 lists no `'aria-label'` on `Sheet`, `ProgressBar`, `ProgressRing`, `Slider`, `NumberStepper`, `Tabs`; added as optional props with sensible defaults.
- §2.2 gives `Screen` "sets nav visibility for the route" but names no reader other than `stores/ui.ts useNavVisible()`; the kit exposes `useNavVisibility/setNavVisibility` for that wiring.
- SPEC §2.1 `[data-surface="incognito"]` paints `background-color: var(--color-canvas)` unlayered, so a Tailwind `bg-*` on a `<Surface>` cannot override it (documented on `Surface`; portal wrappers use `display: contents` to avoid a full-frame paint).
- The Home pager's Phosphor-only-on-Buzz toast rule needs `Toaster mode` to be driven by the active tab; `Toaster` takes `mode?: SurfaceMode` for that, but SPEC does not say who sets it (C-2/AppShell).
- No `.claude/launch.json` entry exists for a kit-only preview; I ran Vite on a scratch port instead of editing the shared file.


---

## Report: server:M1-skeleton

LANE S-M1 — GREEN. Server typecheck passes, `npx vitest run` passes (16 files / 54 tests), `npm run db:reset` prints §7 counts. No processes left running.

## Files created

Root: `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/`

**Foundation core (working):** `server/src/{config,app,index}.ts` · `server/src/db/{index,reset}.ts` · `server/src/db/schema/00-core.sql` (all 30 §4.1 tables + audit triggers + partial unique index) · `server/src/db/seeds/{index,ids,core-data,00-core}.ts` · `server/src/lib/{clock,logger,http,stub,sessions,otp,mailer,universities,handles,courseCode,avatars,seedArt,seedKit,users,graph,rateLimit,sanctions*,audit,testing}.ts` · `server/src/lib/data/{universities (≈290 rows),personalDomains,disposableDomains,academicAllowList}.ts` · `server/src/middleware/auth.ts` · `server/src/types/express.d.ts` · `server/src/routes/{index,mounts}.ts` · `server/src/routes/core/{health,auth,me,users,social,avatars,cards}.ts`

**M2/M3 stubs with FINAL signatures (D1):** `server/src/lib/{notify,realtime,analytics,conversations,content,uploads,waitlist,share,reports}.ts`, `server/src/lib/moderation/{index,types,staff}.ts`, `server/src/routes/core/{uploads,reports,notifications,analytics,waitlist,dm,share}.ts` — all mounted; bodies throw `ApiError(501,'not_implemented')` unless the SPEC contract says "never throws" (then no-op: `trackEvent`, `commitModeration`, `touchContext`, `publishTo*`) or M1 needs a working body (`moderateText/moderateWrite` = allow-all pass-through, all registries, `badgesFor`, `activeSanctionFor`, `activeStrikePoints`, `audit()`, `resolveCard`, `assertOwnUpload/assertOwnImages`).

**Slice stubs (§4.6):** `server/src/routes/<slice>.ts`, `server/src/db/schema/NN-<slice>.sql`, `server/src/db/seeds/NN-<slice>.ts`, `server/tests/<slice>.test.ts`, `shared/src/<slice>.ts` for all 11 slices.

**Tests:** `server/tests/core/{auth,graph,http,seed,stubs}.test.ts` (42 tests).

**Other:** appended `server/data/` and `server/seed-media/generated/` to `.gitignore`; `db:reset` wrote `server/data/universe.db` + `secrets.json` and the 8 event covers under `server/seed-media/generated/event-covers/`.

## Verified

- `cd server && npx tsc --noEmit` → exit 0 (95 files).
- `cd server && npx vitest run` → 16 files, 54 tests pass. Core tests cover: domain gate (known/new/personal/disposable/invalid/alumni, product copy), full sign-up incl. campus auto-create + generic places, returning sign-in + logout, OTP (hashed, 5 attempts → 423, 10-min expiry → 410, 30 s cooldown → 429), handle rules (invalid/reserved/taken+suggestions), invites + `invited_by`, devCode absent with a provider and in production, **503 `mail_unavailable` in production with no provider**, **STAFF_EMAILS** (non-academic exact address passes gate → `uni_team` hidden, role admin, `role_bootstrap` audit row, absent from search; sibling address and gmail still rejected; role raised on sign-in, never demoted), PATCH /me rules, settings safety=true, DELETE /me tombstone; follow/unfollow/counters, block semantics (§8.2 #12: 404 byte-identical to nonexistent, shell for blocker, search/list exclusion, follow edges deleted, notifications removed, shared groups, unblock never restores), `sqlNotBlocked`/`sqlAuthorVisible`; cursor tamper → 400 `invalid_cursor` (unit + endpoint), paginate/keyset, validation 400, audit append-only triggers, notifications anonymous CHECK; seed counts at lite (11 unis, 40 personas, 12 orgs, 3 staff, 61 bg, 66 places, Maya 28/41/MAYA2026/4 invited, zero counter drift, determinism); stubs check (all files, every §4.3 path mounted, isolation mode mounts only named routers, registries last-write-wins + unregister, no `Date.now()` outside clock.ts).
- `npm run db:reset` (full): 11 universities, 66 places, 308 users (UT Austin 180 / UMich 35 / Stanford 35 / NYU 30 / 4 each elsewhere), 2849 follows, Maya follows 28 / followers 41 / invited 4, counter drift none, 259 ms.
- Manual boot on scratch DB/port 4137 (dev): health, `/auth/start` with devCode + console mail, avatar SVG, event-cover static; production boot with `STAFF_EMAILS=dev@example.com:admin` and no `RESEND_API_KEY`: logs "sign-up is disabled: set RESEND_API_KEY", `/auth/start` → 503, gmail → 422, `/auth/domain?email=dev@example.com` → `uni_team`; malformed `STAFF_EMAILS` fails boot. All servers killed.

## Stubbed / deferred (for later lanes)

- S-M2a: `lib/moderation/index.ts` engine + `baseline` pack (currently allow-all — **nothing is moderated yet**), `lib/reports.ts`, `lib/uploads.ts` (`handleUpload`, `probeVideoDurationMs`), `routes/core/{uploads,reports}.ts`, `supportResourcesFor`.
- S-M2b: `lib/notify.ts` (`notify`, `notifyAnonymous`, `notifySeeded`, `removeNotificationsFor`, `serializeNotification`), `lib/realtime.ts` (sockets; tap contract documented in file header — `lib/testing.ts` depends on `setRealtimeTap`), `lib/conversations.ts` (all), `lib/waitlist.ts`, `lib/share.ts`, `lib/analytics.ts` (`trackEvent` no-op), `routes/core/{notifications,waitlist,dm,share}.ts`, `#33` storage.
- S-M3: `lib/moderation/staff.ts` (all), `lib/sanctions.ts` (`sanctionNoticesFor`, `suggestSanction`), endpoints #17–#19 bodies in `routes/core/me.ts`.
- Because `notify` is a stub, the core seed's two `follow.new` rows for Maya are skipped (warning printed once); they appear automatically once S-M2b implements `notifySeeded`. `db:reset` currently shows `notifications 0`.

## Deviations from SPEC (and why)

1. `sqlNotBlocked` / `sqlAuthorVisible` / `sqlNotReported` use inner aliases `_blk` / `_av` / `_rep` instead of SPEC's `b` / `u` / `r` — SPEC's literal `users u` self-shadows when the caller's outer alias is also `u` (found by test). Semantics identical.
2. SeedKit calls `notifySeeded()` (new export in `lib/notify.ts`) rather than `notify()` so `actorIds` is honoured only from seeds; `lib/conversations.ts` gained seed-only `seedDm` / `seedGroup` and optional `id/createdAt/silent` on `createCourseConversation` — SPEC names no lib path for `kit.convo.dm/group`.
3. `db:reset` drops every table instead of deleting the DB file (works for `:memory:` too; same outcome).
4. Request logger logs the concrete path for non-sensitive routes and `/api/buzz/*` / `/api/admin/*` for sensitive ones (route template is unavailable at `finish` time in Express 4).
5. `lib/stub.ts` (`notImplemented`, `soft`) and `lib/{sessions,otp}.ts` are extra foundation modules not named in SPEC.
6. `createTestApp` full mode calls `createApiRouter()` (named export added to `routes/index.ts`) so each test gets a fresh router.
7. Seed follows at full = 2849 (SPEC "~2,500"); org follower targets alone sum to ~1,200.
8. `lib/testing.ts` exports `overrideConfig()` / `resetTestState()` (needed to test production-mode and STAFF_EMAILS behaviour without re-importing the module graph); `config` is therefore a mutable plain object.

## SPEC gaps found

- §4.2.15 `lookupDomain` for an exact `STAFF_EMAILS` address whose campus record does not exist yet: SPEC does not say what `university` to return — I return the provisional `uni_team` ref (created lazily at `/auth/verify`).
- §4.3 #3 `AuthStartResponse.university` for an unknown academic domain: nothing may be created before the code is verified, so `id` is the placeholder `'uni_pending'` with `isNew: true`; the real record (auto-created at `/auth/verify`) is returned by #4.
- §4.3 #21 search cursor: SPEC gives a keyset cursor but the ordering is "campus first, prefix first, follower_count" — the cursor carries an offset (HMAC-tagged, still opaque).
- `SeedKit.notify` cannot satisfy "13 likers, read" until S-M2b lands; SPEC does not specify a seed-time fallback (I skip + warn once).
- SPEC §4.2.5 `AuthedUser` has no `sessionId`; `req.sessionId` was added (express.d.ts) for `POST /auth/logout`.
- `mail_unavailable` is also returned when the Resend request itself fails (SPEC only covers "no provider").

---

## Report: server:M2a-safety

All green. Final state:

**Verification (commands run from `server/`)**
- `npx tsc --noEmit` → no errors.
- `npx vitest run` → 25 files, 330 tests passed (incl. all pre-existing `tests/core/**`, `tests/core/stubs.test.ts` Date.now / registry checks, and the S-M2b notify/realtime/conversations files).
- Per-file: `tests/core/moderation.test.ts` 204 · `tests/core/reports.test.ts` 10 · `tests/core/content.test.ts` 6 · `tests/core/uploads.test.ts` 13.
- No processes left running; `server/uploads/` untouched (tests use a temp `uploadsDir`); no npm install, no git.

**Files created / replaced (all under `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/server/`)**
- `src/lib/moderation/index.ts` — real bodies for `moderateText` (fail-closed), `moderateWrite` (recent hashes, strictest merge, 422 `content_blocked` + `ContentBlockedDetails`), `commitModeration` (events + queue upsert + second-pass enqueue), `enqueueSystemFlag`, `supportResourcesFor`, rule-pack registry, baseline registration. Signatures unchanged (only widening: `moderateWrite` ctx accepts optional `conversationId`).
- `src/lib/moderation/types.ts` — one optional matcher field added: `ModerationRule.minSquashLength`; slot syntax documented.
- `src/lib/moderation/normalize.ts` (new) — N1–N10 views with original-offset maps, homoglyph/leet/repeat/separator folds, emoji tokens, signals.
- `src/lib/moderation/pii.ts` (new) — phone (formatted/spelled/+intl, price/ZIP/course/date guards), email ((at)/(dot), TLD list), street address, room number (1st vs 3rd person, classroom guard), id number, license plate, full names (given-name list + titles + stop-list + public figures), urls/mentions.
- `src/lib/moderation/policy.ts` (new) — the §2.5 outcome matrix, account modifiers, severity/priority helpers.
- `src/lib/moderation/copy.ts` (new) — all M-* messages, S-HEAD/S-BODY/S-METHOD, country crisis lines, banners.
- `src/lib/moderation/engine.ts` (new) — pure evaluation: rule compilation cache, term/combo/guard/squashed matching, behavioural detectors, merge.
- `src/lib/moderation/rules/baseline.ts` (new) — pack `baseline` v1.0.0, 55 rules, every category covered.
- `src/lib/moderation/data/lists.ts` (new) — TLDs, shorteners, titles, given names, stop-list, public figures.
- `src/lib/moderation/queue.ts` (new) — `upsertQueueItem` / `openQueueItemFor` / `raiseQueuePriority` (one open item per entity; also re-exported from `moderation/index.ts` for admin/S-M3).
- `src/lib/moderation/secondPass.ts` (new) — interface + minimal `fetch` classifier, null without `MODERATION_AI_API_KEY`, in-memory queue (cap 500), retries, breaker, escalate-only; `flushSecondPass`/`resetSecondPass` for tests.
- `src/lib/reports.ts` — `createReport`, `evaluateAutoHide`, `reporterTrustFor` (exported for S-M3's `reporterTrust`).
- `src/lib/content.ts` — final `resolveCard`; foundation `profile` card resolver + `profile` ContentAdapter registered at module load; `registerContentAdapter` never throws on malformed input.
- `src/lib/uploads.ts` — custom multer engine (memory for images, disk temp for video), magic-byte sniff, JPEG/PNG/WebP metadata stripping with dimension extraction, MP4/QuickTime/WebM probe (moov-at-end, 64-bit sizes, mvhd v0/v1, unknown-size Segment), single `VIDEO_MAX_MS = 60_500` rule, sync temp cleanup.
- `src/routes/core/{reports,cards,uploads}.ts` — header comments only.
- Tests: `tests/core/moderation.test.ts`, `tests/core/reports.test.ts`, `tests/core/content.test.ts`, `tests/core/uploads.test.ts` (new).

**Stubbed / deferred**: nothing in the lane. The real Anthropic network path of the second pass is unexercised by design (tests assert `fetchSpy.calls === 0` and use a stub classifier).

**Deviations from SPEC / safety.md (and why)**
1. Given-name list ≈ 700 names (safety §2.6 asks ≥ 5,000); admin packs can extend. Named-accusation fixtures pass with it.
2. Variation selectors U+FE00–FE0F are stripped but not counted toward `invisibleChars`/evasion (ordinary emoji carry them).
3. Duplicate detector applies only to folded text ≥ 20 chars (spec gives no floor; short repeats like "same" are legit). PRIVATE "≥ 5 distinct conversations" counts distinct `ctx.conversationId` when the messages route passes it, else distinct sends.
4. Added message id `M-NAME-PROFANE` ("Pick a different name") — safety §2.10 lists no copy for the profile/handle/group_name severe-profanity block.
5. "chink(s)" lives in the ambiguous slur rule (medium, idiom guards) rather than the critical severe list, so "chinks in the armor" is not blocked.
6. Second pass: raw `fetch` (SPEC §3.3 mandates it; no SDK can be added under the locked stack), default model `claude-opus-5` unless `MODERATION_AI_MODEL`; allow→flag needs confidence ≥ 0.7 (spec fixes only the hide threshold: ≥ 0.9 and severity ≥ high). Plain allows are still sent (spec scope "allow or flag").
7. `moderation_events` row is also written for allow+support (self-harm) and for every block; queue item only when `escalate` — "plain allow" read as allow without support/escalation.
8. Profile adapter `setStatus('hidden'|'removed')` blanks bio + custom avatar (profiles have no status column; standing is a sanction).
9. Auto-hide: `self_harm` reports are excluded from the weighted count (rather than immunising an item that has one), and ≥ 2 distinct eligible reporters are required so a single `high` reporter never hides.
10. Uploads: a `qt  `-brand file declared `video/mp4` (and vice versa) is accepted — both are stored/served as `video/mp4`; the 8 MB image cap is enforced in-stream (multer's `fileSize` is the 150 MB video cap).

**SPEC gaps found**
- Safety §2.8 "edits re-run the full pipeline" conflicts with the duplicate detector: re-moderating unchanged text within 10 min yields M-DUP. Slices should skip `moderateWrite` for unchanged text fields (or SPEC should let edits pass an entity hint).
- `ModerationResult`/`ModerationTarget` carry no surface, field, text hash or queue label; `commitModeration` gets them through a WeakMap keyed by the result object `moderateText` returned. A hand-built result gets surface derived from `entityType` and no hash/label.
- `enqueueSystemFlag` has no `label` parameter (wellbeing label is only derivable from category).
- `reports.context_json` for message/conversation reports stores `adapter.staffContext(id)`; the shape is whatever S-M2b's `message` adapter returns.
- `reporterTrust` is specified in `staff.ts` (S-M3) but needed by reports now: implemented as `reporterTrustFor` in `lib/reports.ts`.
- Handle surface: a 3-char term inside a handle (`kys_master`) is not caught (squashed matching floor is 4 chars to avoid "Sky Smith"-style false positives).

---

## Report: server:M2b-realtime

Final state: server `tsc --noEmit` exit 0; full `npx vitest run` 21 files / 97 tests green. The running `tsx src/index.ts` (PIDs 59008/59028, started 11:21:01, parented by launchd) is not mine — I only ran `tsc` and `vitest` — so I left it alone.

## S-M2b report

**Files written (lane-owned; bodies replaced, exported names/signatures unchanged):**
- `server/src/lib/notify.ts` — notify / notifyAnonymous / notifySeeded / removeNotificationsFor / serializeNotification(+`serializeNotifications`) / badgesFor; new exports `currentBadges` (badges without running hooks — used in ws payloads so a hook can never recurse), `listNotificationRows`, `markNotificationsRead`, `setQuietHoursCheck` (S-M3 hook, defaults to "never"), `ANON_DATA_FORBIDDEN_KEYS`.
- `server/src/lib/realtime.ts` — `attachRealtime` (noServer `WebSocketServer` on `/ws`, `uv_session` cookie → `resolveSession`, non-active accounts rejected 401, `hello`, 30 s ping/pong heartbeat, cleared on `server.close`), `publishToUser/Users/Conversation` (tap kept), `isOnline`, `revokeUserSockets` (sends `session.revoked`, close 4001); client events `ping`, `typing.set` (active members only, never in a pending DM request, never across a block), `conversation.focus`, `presence.subscribe` (accepted-DM partners with `showPresence`, 5-min buckets, pushed on connect/disconnect). Extra exports: `presenceOf`, `canSeePresence`, `focusedConversationOf`, `socketCountFor`, `HEARTBEAT_MS`.
- `server/src/lib/conversations.ts` — every §4.2.11 function + `seedDm`/`seedGroup`, `getConversationRow`, `reportWindowFor`; registers the `message` and `conversation` ContentAdapters at import (pure registry, no DB).
- `server/src/lib/share.ts` — `listShareTargets`, `shareCard`.
- `server/src/lib/waitlist.ts`, `server/src/lib/analytics.ts` (+ `ANALYTICS_EVENT_NAMES`, `isAnalyticsEventName`, `isPreAuthAnalyticsEvent`, `anonHashFor`, `sanitizeProps`).
- `server/src/routes/core/notifications.ts` (#31/#32), `server/src/routes/core/analytics.ts` (#33). `dm.ts`, `share.ts`, `waitlist.ts` routes were already wired to the libs — untouched. `index.ts` already calls `attachRealtime(server)` — untouched.
- Tests: `server/tests/core/{notify,conversations,realtime,waitlist,analytics}.test.ts` (43 tests).

**Verified:** `cd server && npx tsc --noEmit` → exit 0. `npx vitest run` → 21 files, 97 tests pass (incl. my 43; realtime test boots an ephemeral-port http server per test and closes it in `afterEach`). No files outside my lane touched (S-M2a, testing.ts, seedKit.ts, app/index/mounts, 00-core.sql all untouched).

**Deviations / interpretations (SPEC ambiguous or silent):**
1. `notify` `collapse` default = **true for every type except `follow.new`** (SPEC: "default true for *.like, follow.new=false"; product §2.10 says same-type same-target within an hour collapses). Rows without a `target` never collapse. `buzz.milestone` keeps the opening row's `created_at` so the 24 h window can't slide.
2. `notifyAnonymous` **strips** forbidden `data` keys (+ non-primitive values) and `log.error`s instead of throwing; `actor_count` is pinned to 1 on anonymous rows (a distinct-actor count would be a cross-thread identifier). CHECK constraint behaviour is tested via raw SQL.
3. `conversation.updated` producers beyond the four listed: `removeMember` (leaver + remaining members), `openDm` when it re-pins/changes a context, `declineRequest` (decliner only), `updateConversation({muted})` (that member only).
4. `sendMessage`: `message.new` goes to recipients only (not the sender's own sockets); system messages never bump `unread_count`; `message.request` fires on the first message of a request **of any kind** (an offer-first request will also get market's `market.offer` — two notices for one action; flagging).
5. `acceptRequest` notifies `message.request_accepted` for DMs only (groups have no single requester).
6. `setOfferStatus` posts a system line `"{first} accepted|declined|withdrew the offer"` (copy not in SPEC); `withdraw` sends no notification.
7. `openDm` on an existing DM revives `left`/`declined` memberships (peer `declined` → cooldown check → back to `request`/`active` by follow); privacy/minor gates apply to new conversations only.
8. `createGroup`/`updateConversation` run a defence-in-depth `moderateText(title, {…modCtx(user,'group_name'), field:'name'})` → 422 `content_blocked` on block (the route's `moderateWrite` remains the real gate) — this is the "conversations must call moderateText" requirement.
9. `markRead` is a no-op for a member in state `request` (§5.6 "reading a request does NOT mark read"); `assertMember` default states = `['active','request']`; `ConversationSummary.memberCount`/`memberPreview`/`listMembers` count active **and** request members.
10. `shareCard`: card `unavailable` → 404; caption moderated with `moderateWrite` (surface `message`) + `commitModeration(entityId:null)`; rate `message_send` once per call; targets exclude chats where the viewer's own request is pending (they'd hit the cap).
11. Analytics daily salt = HMAC(`config.cursorSecret`, UTC day); hidden universities (`uni_team`) stored with `university_id NULL`; `ts` kept as `clientTs` prop; anon events drop `sessionId`.
12. Waitlist re-join restarts `created_at` (so `joinedAt` reflects the current membership) and replaces `source` when given.
13. `conversation` adapter `setStatus('removed')` only clears a group title (conversations have no status column); `message` adapter `staffContext(id)` returns `{ messages: reportWindowFor(id) }` (reported + ≤ 10 preceding) — S-M2a's reports lib should call `adapter.staffContext?.(id)` when `includeContext`.

**Stubbed / deferred:** quiet-hours predicate (`setQuietHoursCheck`, S-M3 — needs the viewer's local time; `UserSettings.quietHours` carries no timezone, SPEC gap). Nothing else stubbed.

**Gaps found in SPEC / core.ts:** no runtime array of `AnalyticsEventName` in `core.ts` (defined `ANALYTICS_EVENT_NAMES` locally with a `Record<AnalyticsEventName,true>` completeness check); no timezone for quiet hours; `memberCount` semantics unspecified; `openDm` behaviour on left/declined memberships unspecified; `conversation` ContentAdapter has nothing to set status on; whether `message.new` should echo to the sender's other devices unspecified.

**Outside my lane, not fixed:** none broken. Note for the orchestrator: a `tsx src/index.ts` API server (PIDs 59008/59028, started 11:21:01) is running under launchd — started by another agent/lane, not by me.

---

## Report: server:M3-staff+integration

GREEN. No leftover processes.

## LANE S-M3 — final report

**Base path:** `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/server/`

### Files created
- `src/lib/quietHours.ts` — T2 quiet-hours predicate (window math wrapping midnight, campus-country UTC offset, `installQuietHours()` → `setQuietHoursCheck`; inert in `test` env unless `QUIET_HOURS=on`, mirroring the rate-limit convention).
- `tests/core/staff.test.ts` — 20 tests: ladder/suggestion table, strikes + expiry + revoke, warning/mute/suspension/ban enforcement incl. restricted-session allow-list, `session.revoked`, `banned_emails` + re-registration 403, lift → active + 72 h restriction, anon-origin rule (`staffStandingFor` mod vs admin, day-floored timestamps, `serializeAuditRow` rule 4, entity-targeted audit rows, random 5–30 min `effective_at`), `serializeQueueItem` exact key set + forbidden-key/identity checks, claims/lease/409, `queueVisibleTo`, `blindAuthorStanding`, `applyContentStatus`/`closeReportsFor` notices, audit triggers, `POST /appeals` + `/me/sanctions` + ack, quiet hours.
- `tests/core/integration.test.ts` — full-mode integration (`createTestApp({ seed:'all' })`): boots every router/schema/seed, every mount guarded (401 / 404 / `onboarding_required`), suspended session vs every mount + core routes, core invariants; **skips gracefully** (vitest `t.skip`) while a slice's router is the empty stub for: Maya 12/7 notifications + `GET /me/badges → 7` twice (§7.5), Buzz firewall smoke (feed/thread/mine), admin seed counts (9/14, 1 `buzz_unmask`, `ryanoc` mute public-origin, no user-targeted anon audit row, moderator audit list). Currently 5 pass / 3 skipped.

### Files rewritten (lane-owned)
- `src/lib/sanctions.ts` — `sanctionNoticesFor`, `suggestSanction` (safety §4.2 table), `toSanctionNotice`, `getSanctionRow`, `appealableUntil`, `canAppeal`, ladder duration constants; `activeSanctionFor`/`activeStrikePoints` kept (true totals).
- `src/lib/audit.ts` — `audit()` unchanged; added `AuditLogRow`, `getAuditRow`.
- `src/lib/moderation/staff.ts` — all 17 SPEC functions implemented (`serializeQueueItem`, `blindAuthorStanding`, `queueVisibleTo`, `claimQueueItem`, `releaseQueueItem`, `applyContentStatus`, `closeReportsFor`, `addStrike`, `revokeStrikesFor`, `applySanction`, `liftSanction`, `recordAction`, `reporterTrust`, `resolveAuthorId`, `staffStandingFor`, `serializeAuditRow`) + helpers `visibleQueueRow`, `getQueueRow`, `getModerationAction`, `isAnonQueueItem`, constants `SLA_MS`, `CLAIM_LEASE_MS`, `STRIKE_POINTS`, `STRIKE_TTL_MS`.

### Surgical edits to shared / other-lane files
- `src/routes/core/me.ts` — #17 wired to `sanctionNoticesFor`; #18 ack; #19 appeals (one per sanction, 14 d, warnings 400, other's 404, dup 409; queue item `source:'appeal'` + `appeal_id`, audit `appeal_create` with actor `system` and target = appeal, `mod.appeal_received`; returns **201**).
- `src/app.ts` — one import + `installQuietHours()` call at the top of `createApp`.
- `tests/core/stubs.test.ts` (S-M1) — the mount probe for `POST /me/sanctions/:id/ack` now uses a real inserted `san_probe` row (a real body correctly answers 404 for an unknown id).

### Verified
- `npx tsc --noEmit` in `server/` → clean.
- `npx vitest run --minWorkers=1 --maxWorkers=2` → **27 files, 355 passed, 3 skipped (integration, by design), 0 failed** (baseline before the lane: 25 files / 330).
- `requireAuth` allow-list (`GET /me`, `GET /me/sanctions`, `POST /me/sanctions/:id/ack`, `POST /appeals`, `POST /auth/logout`) already matched §4.2.5; now exercised end-to-end in both test files.

### Stubbed / deferred
- **Launch-meter helpers** (foundation T2): not built — SPEC §4.2 defines no signature for them; `LAUNCH_GOALS` + `campus_milestones` + the milestone notification are the campus slice's (§5.9), so a foundation helper would have no consumer.
- **Presence** and **AI second-pass interface**: already delivered by S-M2b / S-M2a (`realtime.ts` `presence.subscribe`, `secondPass.ts`); nothing left to do.
- `mod.appeal_received` for a *suspended* appellant is dropped by `notify()`'s "recipient must be active" rule (§4.2.7); the `AppealReceipt` response still works. Reported, not worked around.

### Deviations from SPEC (all additive, SPEC-conformant callers unaffected)
- `applyContentStatus` `opts` accepts optional `category` / `sanctionId` for the author notice; without them `category` falls back to the entity's latest queue item.
- `blindAuthorStanding(authorId, currentQueueId?)` — optional 2nd arg to exclude the item being viewed from `otherOpenItems`.
- `applySanction` audit rows: anon-origin → target = entity (or `queue`/queue id when the action has no entity, e.g. `blocked_text` items); public → `targetType:'user'`. `addStrike` writes `strike_add`, `revokeStrikesFor` `strike_revoke`, `liftSanction` `sanction_lift`, `applySanction` `sanction_apply` audit rows; `recordAction` audits under the caller's `action` name. The random 5–30 min delay applies to warnings/mutes only (suspensions/bans are immediate); `delayed:false` suppresses it.
- `addStrike` also inserts the user-facing `kind:'removal'` `user_sanctions` row (excerpt + label) — the source of removal notices on `GET /me/sanctions`; `revokeStrikesFor` lifts them.
- `queueVisibleTo` additionally hides `status='escalated'` items from moderators ("item leaves moderator queues", safety §6.4). Its SQL uses bare column names and must be ANDed into a query whose `FROM` is `mod_queue` un-aliased.
- `serializeQueueItem` reports `status:'open'` for a `claimed` row whose 10-min lease expired (DB column untouched).
- Ban notices use `mod.suspended` with `until:null` (core.ts has no `mod.banned` type).
- `POST /appeals` returns 201 (table says "200 response" generically; client `api.ts` uses `res.ok`).

### Gaps found in SPEC
- No signature/contract for the "launch-meter helpers" foundation T2 item (see above).
- Quiet hours need "the viewer's local time" but no timezone is stored anywhere (users/universities); approximated from campus `country_code`.
- No `mod.banned` notification type; no `SanctionNotice.liftedAt` field, so a lifted sanction is indistinguishable from an expired one in the user payload.
- `StaffSanctionRowCore` / `AuditRowCore` are absent from `core.ts` (defined locally in `staff.ts`, as the stub already did).
- §4.4.4 lists `mod.report_resolved` data as `outcome: 'actioned'|'no_violation'` while `closeReportsFor` takes `'actioned'|'dismissed'` — mapped `dismissed → no_violation`.

---

## Report: client:C2-shell

All gates are green and both servers are stopped (ports 4000/5173 free, `dist/` removed, no `features/*/index.ts` siblings).

## LANE C-2 — client platform & app shell: report

**Root:** `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752/client/src`

### Files created (this session)
- `app/App.tsx` (QueryClientProvider + BrowserRouter, navigator bridge, one `GET /me` boot, `app_open`), `app/AppShell.tsx` (AuroraBackdrop + brand block, `#frame` / `#screen-root` / `#overlay-root`, BottomNav, SanctionGate, MeSheet, Report/Block/Share/Moderation hosts, Toaster in incognito mode on Buzz, `useRealtimeConnection`, store resets registered), `app/AuroraBackdrop.tsx`, `app/BottomNav.tsx`, `app/router.tsx` (§4.5 table, lazy `pick()` per slice export, `RouteError` + `Suspense` per route, `/dev/kit`, `*` → NotFound), `app/guards.tsx` (`RequireOnboarded`, `RequireAuth`, `RedirectIfReady`, + `RequireStaff`), `app/InviteRedirect.tsx`, `app/home/HomePage.tsx`, `app/home/HomeTopBar.tsx`, `app/home/MeSheet.tsx`
- `components/fallbacks.tsx` (`PageLoader`, `RouteError`, `NotFound` "Lost in space"), `ReportSheet.tsx` (+`ReportHost`), `BlockDialog.tsx` (+`BlockHost`, `blockUser`), `ShareSheet.tsx` (+`ShareHost`), `ModerationHost.tsx`, `OverflowMenu.tsx`, `UserListSheet.tsx`, `SanctionGate.tsx` (restricted screen + warning-ack modal), `components/index.ts` barrel
- `features/{auth,reels,buzz,orbit,discover,messages,roommates,market,campus,apartments,admin}/index.tsx` — exact §4.6 exports; auth is the D2 working sign-in (welcome → email → code w/ dev-inbox toast → profile w/ 18+ chips → guidelines "I agree" → `POST /me/onboarding/complete` → `consumePendingNext()`)
- Edited: `main.tsx` (imports `App` directly, glob removed), `stores/ui.ts` (`ModerationOverlay.blocked.body`), `lib/moderation.tsx` (passes server message as body), `components/UserListSheet.tsx`. All pre-existing lib/store/component files kept as-is.

### Verified
- `npx tsc --noEmit` (client/) → clean. `npx vite build` → succeeds (one >500 kB main-chunk warning only).
- Browser run (API on :4000 with a temp DB in my scratchpad, `SEED_SCALE=lite`; Vite :5173; both killed afterwards): framed ≥768 layout over aurora + 375/360 full-bleed; sign-in as `maya.chen@utexas.edu` ("Welcome back, Maya."); fresh sign-up `new.student@utexas.edu` through all steps landing on the pending `next` (`/market?q=lamp`); signed-out `/market?q=lamp` → `/welcome?next=…` with `uv:auth:next` set; `/welcome` while ready → `/home/reels`; `/admin` as student → NotFound; `/dev/kit` renders.
- Pager criteria: tab tap, ←/→ and mouse click-drag (both directions, clamped at ends) each move exactly one pane with URL replace; reload on `/home/orbit` paints in place (`scrollLeft` = 2×width, no slide); indicator white → lime → violet; nav pill neutral on Reels / Phosphor on Buzz / Aurora on Orbit; **at rest on `/home/buzz` a DOM scan of `#frame` finds no avatar URL, name or handle** (avatar layer unmounted, glyph shown); last tab persisted; nav hides on `/settings` (y:96, aria-hidden); "Apartments" pill = 117 px, label 11 px at 360 px. Touch swipes could not be simulated by the tool (mouse only); CSS `snap-x snap-mandatory` + `snap-always` + `overscroll-x-contain` + `.scroll-x` exclusion are in place.

### Deviations / decisions (all additive or stricter)
1. Me-button layer at opacity 0 is **unmounted** rather than `visibility:hidden`+`aria-hidden` (so criterion 7's DOM assertion passes literally); both layers mounted during the crossfade.
2. `RedirectIfReady` also bounces `'restricted'` sessions to `/` (SanctionGate covers); consumes the stored `next`.
3. Messages nav badge = `badges.messages` count, else a `dot` when only `requests` > 0 (SPEC does not define requests on the nav).
4. Block "Leave group" offer degraded to an informational toast — no foundation endpoint to leave a group (R7).
5. `ModerationOverlay.blocked` carries `body` (server `ApiError.message`) because `ContentBlockedDetails` has no body field.
6. `RequireStaff` guard added (non-staff on `/admin/*` → `NotFound`). Extra optional props: `RouteError.title`, `OverflowMenu.title`, `UserListSheet.emptyTitle`; `ReportSheet`/`ShareSheet`/`BlockDialog`/`blockUser` exported alongside the hosts.
7. `home_tab_view` tracked on every settle; `share_click` tracked client-side on sheet open / copy / native (server tracks the send).
8. Mouse drag also ignores drags starting in inputs/textareas/selects/sliders/`[data-no-pager-drag]` (text selection cleared on activation).
9. `/dev/kit` is registered in all builds (lazy chunk).

### Gaps found in SPEC / other lanes (not fixed, reported)
- `routes` has no builders for the onboarding sub-steps (`/welcome/email|code|profile|guidelines|follow`); the auth stub hard-codes them.
- `ContentBlockedDetails` lacks a `body`; the block sheet uses `ApiError.message`.
- At verification time the server returned **501** for `GET /me/badges` (later 200) and `GET /me/sanctions` (S-M2b/S-M3 not landed); the client degrades (badges 0, no warning modal). `/ws` attach not observable yet; backoff is silent.
- `SanctionNotice` has no content-type field; the warning modal uses `contentLabel ?? 'post'`.
- Observed two boot `GET /me` 401s in dev (likely the browser pane loading the URL twice; `refreshMe` dedupes in-flight calls).

---

## Report: fix:server (post-review changes — these override the lane reports above where they conflict)

All green. Final state of the checks:

- `cd server && npx tsc --noEmit` → exit 0
- `cd server && npx vitest run --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1` → 27 files, 358 passed, 3 skipped (the `[error]` lines in the output are existing tests exercising failure paths). No process left running.

## Findings

**1. MAJOR — `conversations.ts` moderation status has no visible effect: FIXED (confirmed real).**
Verified by reading: `toMessage()` blanked only `deleted`, `listMessages()` had no status filter, adapter `setStatus()` re-pushed full text to everyone. Rule implemented (SPEC §3.1 / safety §2.1): a `held` / `hidden` / `removed` row exists only for its sender.
- `listMessages()`: SQL `AND (status NOT IN ('held','hidden','removed') OR sender_id = ?)` — other viewers never receive the row (pagination stays keyset-correct).
- `toMessage()`: any concealed row still reaching a non-sender serializes as the empty placeholder (`text ''`, `images []`, `card null`, `offer null`, `banner null`, `deleted: true`).
- `serializeConversation()` preview: new `lastVisibleMessage(conv, viewer)` — `last_message_id` wins whenever the viewer may see it (write-order kept for same-ms ties), else the newest visible row (a sender sees their own held message).
- `sendMessage({ status:'held' })`: not delivered — no `last_message_*`, no unread bump, no `message.new`/`badges`, no `message.request`; the row still counts toward the one-message request cap. Shared SQL moved into `markDelivered()`.
- adapter `setStatus`: `held → active` calls `deliverApproved()` (last_message_*, unread, `message.new`+`badges` per recipient, `message.request` if it is the requester's first message of a still-pending request). Otherwise per member: now-concealed → `message.deleted`; un-concealed (restore) → `message.new`; unchanged → `message.updated`; concealed both before and after → nothing. Same-status calls are no-ops.
- `setReaction()` → 404 on a row concealed from the reactor; `publishMessageUpdated()` skips concealed members.
- Staff `reportWindowFor` / adapter `load()` unchanged (staff must see the text).
- Test added: `tests/core/conversations.test.ts` "held / hidden / removed rows exist only for their sender" (list, preview, ws per viewer, reactions, held non-delivery + approval = delivery).

**2. MAJOR — deleted account's email can never sign in/up again: FIXED (confirmed real), option (a).**
Docs only lock an address through `banned_emails` (ban); deletion is a tombstone. `applySanction` already 404s on deleted users, so the real email on a tombstone had no ban use.
- `DELETE /me` (`routes/core/me.ts`): `email = tombstoneEmail(id)` (`deleted+<id>@deleted.invalid`) on the tombstone.
- `lib/users.ts`: `getUserByEmail()` now excludes `status='deleted'` (defence in depth); new export `tombstoneEmail(userId)`.
- `/auth/verify`: the redundant `status !== 'deleted'` branch removed (comment explains); `/auth/complete`: inside the insert transaction, any pre-existing deleted row still holding the address is tombstoned first (older rows), then the INSERT proceeds; the 401 `signup_token_invalid` duplicate check now only sees live accounts.
- Handle stays reserved on the tombstone (a freed handle would enable impersonation) — a returning user picks a new handle.
- Test added: `tests/core/auth.test.ts` "a deleted account releases its address…" (delete → start → verify `needs_profile` → complete 200 with a new id; later bare sign-in reaches the new account; tombstone keeps `status='deleted'` with an `@deleted.invalid` email).

**3. MINOR — unconditional `trust proxy = 1`: FIXED (confirmed real).**
`app.ts`: `trustProxyHops()` — dev/test `1` (Vite proxy); production `TRUST_PROXY` hop count, default `0` with a `log.warn` explaining the shared-bucket consequence behind a proxy; non-integer/negative → throws at `createApp` (same "malformed env fails boot" convention as `STAFF_EMAILS`). Read straight from `process.env` like the existing `RATE_LIMITS` so `config`'s SPEC §4.2.1 shape stays exact. Test added in `tests/core/http.test.ts`. I could not document it in SPEC §8 (docs are out of lane) — see gaps.

**4. Verification note: nothing to do.**

## Files modified (no files created)
- `server/src/lib/conversations.ts`
- `server/src/lib/users.ts`
- `server/src/routes/core/auth.ts`
- `server/src/routes/core/me.ts`
- `server/src/app.ts`
- `server/tests/core/conversations.test.ts`, `server/tests/core/auth.test.ts`, `server/tests/core/http.test.ts`

## Deviations from SPEC (all additive)
- `getUserByEmail()` (internal, not in §4.2.5) now ignores deleted rows; `tombstoneEmail()` is a new export in `lib/users.ts`.
- `DELETE /me` (#20) additionally rewrites `users.email`; §4.3 #20 lists only "profile fields blanked".
- Production `trust proxy` defaults to 0 unless `TRUST_PROXY` is set; SPEC never specifies production topology.
- "held" for messages interpreted as deferred delivery until staff approval (SPEC §4.2.11 only declares `status?: 'active'|'held'` without semantics).

## SPEC / core.ts gaps found
- `Message` (core.ts) has no `status`/`moderationStatus` field, so a sender cannot be shown the "In review" / "Removed" chip of §3.1 for their own messages (server keeps the sender's full view; the client can't distinguish). Suggest `status: ContentStatus` on `Message` in a future core.ts revision.
- §8 env list lacks `TRUST_PROXY`; no production reverse-proxy guidance.
- `applyContentStatus` (`staff.ts`) sends an author `mod.content_*` notice only for hidden/removed → active, not for held → active (approval); untouched here, outside the findings.
- A `held → hidden → active` double transition is delivered via the generic restore path (`message.new`) without `last_message_*`/unread bookkeeping; rare (PRIVATE surfaces only produce `held` on an engine fail-closed hold).

---

## Report: fix:client (post-review changes — these override the lane reports above where they conflict)

All eight findings verified against the code and SPEC; seven fixed, one partially rejected. Client typecheck and production build are green, no processes left running, no `dist/` left behind.

## Per-finding result

| # | Severity | File | Verdict | What changed |
|---|---|---|---|---|
| 1 | major | `client/src/ui/OTPInput.tsx` | **FIXED** | Added an effect keyed on `[digits, locked]` that fires `onComplete` when the *controlled* value reaches six digits (programmatic fill / paste / autofill), guarded by the same `completed` ref so the synchronous typing path never double-fires. The error effect no longer nulls `completed` (re-arm now happens only when the value drops below six digits), so an `error` status can never re-submit the same wrong code; `handleChange` also skips while locked. The dev-inbox "Fill" now auto-verifies without the stop-gap in the stub (stub left unchanged on that point; gallery's `Fill` calls `setCode + verify` in one batch → `locked` → no double call). |
| 2 | major | `client/src/ui/Sheet.tsx`, `client/src/components/UserListSheet.tsx` | **FIXED** | `SheetPanel` now provides its own `ScreenContext` (`scrollEl` = sheet body via a merged callback ref, `floatEl` = new `pointer-events-none absolute inset-0 z-(--z-fab)` layer inside the panel, `nav: false`, no-op `registerHeader`) wrapping the inner column. Any `InfiniteSentinel` / `PageHeader` / `PullToRefresh` / `FAB` inside any sheet (comments sheets with `['half','full']`, likers, attendees) resolves the sheet body. No prop added — `Sheet` props stay exactly as SPEC §2.2. `UserListSheet`: removed the misleading unused `rootRef`; body element got `data-sheet-scroll`. |
| 3 | minor | `client/src/app/home/HomePage.tsx` | **FIXED** | `HomePage` is now a thin route element: `useParams` → `isHomeTab` ? `<HomePager param={tab}/>` : `<Navigate to={routes.home(readLastTab())} replace/>`. The pager (`HomePager`, param typed `HomeTab`) only ever mounts with a valid tab, so `registerPager` and the initial `scrollLeft`/`settle` layout effects always run with a live scroller. |
| 4 | minor | `client/src/lib/realtime.ts` | **FIXED** | `session.revoked` (suspended/banned) → `markRestricted(reason)` then `void refreshMe()` (silent, allowed while restricted, endpoint #9) instead of the no-op `invalidateQueries(['me'])`; `SanctionGate` gets `activeSanction` (reason/`until`) without a reload. |
| 5 | minor | `HomeTopBar.tsx`, `BottomNav.tsx`, `AuroraBackdrop.tsx`, `base.css` | **FIXED (3 of 4) / REJECTED (base.css)** | HomeTopBar: indicator colour is now a CSS `color-mix(in oklab, …)` over `var(--color-white)` / `var(--color-incog-500)` / `var(--color-brand-500)`, driven by a `--home-p` custom property that motion writes from `progress` each frame (verified motion 11.18.2 routes CSS-var style keys through `setProperty`; typed via `as MotionStyle`). BottomNav: `bg-incog-500/13` (build emits `#c5f53b21`, derived from the token). AuroraBackdrop: blobs use `bg-aurora-violet` / `bg-aurora-cyan` / `bg-aurora-orchid`. Verified in the built CSS that `--color-brand-500`, `--color-incog-500`, `--color-white`, `--color-aurora-*` are all emitted (Tailwind 4.3.3 prunes unused theme vars; `--color-brand-500`/`--color-aurora-orchid` were absent before). **base.css rejected:** `theme.css` is byte-identical to SPEC §2.1 ("verbatim; foundation pastes this" — diff confirmed) and defines no `--color-public-*` aliases, so the incognito→public island block cannot reference them; it is a token *definition* block (the mirror of theme.css's own hex-valued `[data-surface="incognito"]` block), not a raw-colour usage. Left as is. Not touched (pure black, not tokens): `rgb(0 0 0 / …)` shadows/vignette in HomeTopBar/AuroraBackdrop and canvas `fillStyle '#000'` in `lib/upload.ts`. |
| 6 | minor | `client/src/app/router.tsx`, `client/src/app/dev/KitGallery.tsx` | **FIXED** | `const KitGallery = import.meta.env.DEV ? pick(…) : null` and `{KitGallery ? <Route path="/dev/kit" …/> : null}` — production build now emits **no** KitGallery chunk and no `dev/kit` string in any JS (verified). Gallery: `prefix={currencySymbol(DEMO_CURRENCY)}`, demo prices via `formatPrice(18|60, 'USD')`, hard-coded hrefs replaced by a local `KIT_PATH` constant (the gallery is dev-only, not a slice; router.tsx remains the one place declaring the path). |
| 7 | minor | `client/src/lib/links.ts`, `client/src/features/auth/index.tsx` | **FIXED** | Added `routes.welcomeStep(step: WelcomeStep)` (+ exported `WelcomeStep = 'email'|'code'|'profile'|'guidelines'|'follow'`) to links.ts. The stub now uses `routes.welcomeStep(…)`, `routes.welcome()`, `routes.home()` everywhere (zero hard-coded path strings remain — grep-verified); Terms / Privacy / "Read the full guidelines" are router `<Link>`s, no full-document navigation mid-onboarding. Relative nested navigation was not used: from `/welcome/email`, `navigate('code')` resolves to `/welcome/email/code`. |
| 8 | minor | `client/src/components/MediaPicker.tsx` | **FIXED** | Add-photos tile: `aria-label={`Add photos, ${n} of ${max}`}`; proxied file input: `tabIndex={-1} aria-hidden` (still opened by the labelled buttons via `.click()`). |

## Files changed (all absolute, all inside the client foundation lane)
- `…/scratch-2026-09-21-68c752/client/src/ui/OTPInput.tsx`
- `…/scratch-2026-09-21-68c752/client/src/ui/Sheet.tsx`
- `…/scratch-2026-09-21-68c752/client/src/components/UserListSheet.tsx`
- `…/scratch-2026-09-21-68c752/client/src/components/MediaPicker.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/home/HomePage.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/home/HomeTopBar.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/BottomNav.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/AuroraBackdrop.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/router.tsx`
- `…/scratch-2026-09-21-68c752/client/src/app/dev/KitGallery.tsx`
- `…/scratch-2026-09-21-68c752/client/src/lib/realtime.ts`
- `…/scratch-2026-09-21-68c752/client/src/lib/links.ts`
- `…/scratch-2026-09-21-68c752/client/src/features/auth/index.tsx` (foundation stub only; `AuthRoutes: FC` export unchanged)

(Prefix: `/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/`.) Not touched: `docs/**`, `shared/src/core.ts`, `theme.css`, `base.css`, anything under `server/`.

## Verification (final state)
- `cd client && npx tsc --noEmit` → exit 0, no errors.
- `cd client && npx vite build` → exit 0 (`✓ built`); checked the output: 0 `KitGallery` chunks, 0 JS files containing `dev/kit`; CSS contains `--color-brand-500`, `--color-incog-500`, `--color-white`, `--color-aurora-violet/cyan/orchid`, `.bg-incog-500\/13{background-color:#c5f53b21}`, `.bg-aurora-orchid{…var(--color-aurora-orchid)}`. `dist/` removed afterwards (it did not exist before).
- No client test suite exists (no vitest in `client/`); nothing to run. No processes left running.

## Deviations from SPEC and why
- `routes.welcomeStep(step)` + `WelcomeStep` type added to `lib/links.ts` — not in the §4.4.1 builder list. Additive; every listed builder is unchanged.
- `Sheet` now provides a `ScreenContext` internally (behavioural, no prop change) — the SPEC §2.2 `Sheet` prop table is untouched.
- `HomePage` export is now the validating wrapper around an internal `HomePager`; the route element name/props (`HomePage`, no props) are unchanged.

## SPEC gaps found
1. **§4.4.1 `lib/links.ts` has no builder for the canonical `/welcome/email|code|profile|guidelines|follow` sub-paths of §4.5** — the `auth` slice would hit this too. Foundation now exports `routes.welcomeStep(step)`; the orchestrator should tell the `auth` slice it exists (agents coding from the SPEC text alone will not see it).
2. **§2.2 `InfiniteSentinel.rootRef` cannot be satisfied inside a `Sheet`** as specced: `Sheet` forwards `ref` to the panel, not the scrolling body, and has no `scrollRef` prop. Fixed by the sheet-provided context (works with no slice cooperation), but SPEC does not document that `InfiniteSentinel`/`FAB`/`PageHeader` inside a sheet resolve the sheet body.
3. **§2.1 makes `theme.css` verbatim and defines only the public→incognito direction**, so the public-inside-incognito island in `base.css` has to re-declare the Aurora hex values; a `--color-public-*` alias set in the theme would remove the duplication but would require changing the frozen file.
4. SPEC §8 "no raw hex colours" gives no exemption for token *definition* files; the reviewer's base.css item is a consequence of that ambiguity.

---

## Report: gate:foundation

Server tests 358 passed / 3 skipped; both typechecks pass; vite build pass; db:reset pass.

Seed summary: `npm run db:reset` (server/, exit 0, full scale, 313 ms): universities 11 · campus places 66 · users 308 (personas 40, orgs 12, staff 3, background 253) — UT Austin 180, Stanford 35, UMich 35, NYU 30, ETH/IIT Bombay/Melbourne/NUS/Oxford/TUM/U of T 4 each · follows 2849 · Maya: follows 28, followers 41, invite MAYA2026, invited 4, notifications 2 (1 unread) · counter drift: none. Matches SPEC §7: 11 campuses, ~180/35/35/30 + 3–5 each abroad, total ≈300, ~2,500 follow edges (2849 is within "~"), Maya 28/41/MAYA2026/4, core notifications 2 (1 unread), campus_places 16 (UT) + 10×5 = 66.

Notes for slices:
- Test flake under memory pressure (not reproducible): the FIRST full `npx vitest run` exited 1 with one failure — tests/core/auth.test.ts › 'a deleted account releases its address…' timed out at 15000 ms (the file's other 15 tests took ~700 ms). At that moment the machine had ~46 MB of free pages and vitest forks up to 8 workers. The test passes alone (150 ms), the whole file passes alone (327 ms), and two subsequent full runs passed 358/358 in 3.7 s. Every request in that path is synchronous (no timers/awaits besides the console mailer), so I found no deterministic cause; the orchestrator's integration gate should be prepared for a re-run when the machine is loaded, or run vitest with fewer workers (e.g. --maxWorkers=4) during parallel phases.
- SPEC gap (no code change): AuthStartResponse.university.id for a never-seen academic domain is the placeholder 'uni_pending' (server/src/lib/universities.ts previewUniversityForEmail); the real university row is created at /auth/verify once the address is proven (Constitution §6 'auto-create' is satisfied at verify, not at start). SPEC §4.3 #3/#4 and core.ts do not name this placeholder. The foundation auth stub handles it (it overwrites university with the verify response), but the auth slice must not persist or navigate on the id from /auth/start for isNew campuses.
- Note for the orchestrator's manifest: server/src/lib/stub.ts is now dead code (no importer remains) — left in place as its own header says it may be deleted once every stub is implemented; not deleted to avoid an unrequested file removal.
- vite build emits the standard '(!) Some chunks are larger than 500 kB' warning (main chunk 643 kB / 200 kB gzip); build exit 0, no action taken.