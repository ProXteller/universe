# UniVerse — Binding Build Spec

> Authority: `docs/CONSTITUTION.md` > **this file** > `docs/blueprint/*.md`. Read-only after the blueprint phase.
> `shared/src/core.ts` is the type-level half of this contract; where prose and `core.ts` differ, `core.ts` wins.
> Keywords MUST / MUST NOT / SHOULD / MAY per RFC 2119. "Foundation" = the single agent that builds everything
> outside `features/<slice>`, `routes/<slice>`, `services/<slice>`, `NN-<slice>.*`, `shared/src/<slice>.ts`. Foundation
> works through the ordered milestones M1 → M2 → M3 of §8 (typecheck + tests green at each) and never starts a later
> milestone before the earlier one is green.

Slice numbers (used for `NN-` file prefixes and seed order):
`01 auth · 02 reels · 03 buzz · 04 orbit · 05 discover · 06 messages · 07 roommates · 08 market · 09 campus · 10 apartments · 11 admin`.

Global rules for parallel work (in addition to Constitution §3):

- **R1** A slice imports from: its own files, `@shared/core`, its own `@shared/<slice>`, foundation modules listed in §4,
  and the *cross-slice React components* listed in §6. Nothing else. No slice imports another slice's `@shared/<x>`
  file, server service, or table.
- **R2** Slices MAY `SELECT` from core tables (§4.1). Slices MUST write to core tables only through foundation helpers
  (§4.2). Exception: the `admin` slice is the designated writer of `mod_queue`, `reports.status/closed_at`,
  `moderation_actions`, `strikes` (through the helpers in `lib/moderation/staff.ts` where one exists).
- **R3** Cross-slice component props use only primitives and `@shared/core` types.
- **R4** Feature `index.tsx` files MUST have no import-time side effects. The client entry of every slice is exactly
  `client/src/features/<slice>/index.tsx` (the stub foundation creates); a slice MUST keep that filename and MUST NOT
  create a sibling `index.ts` (it would shadow the entry). Server slice routers MAY register adapters/resolvers/hooks at
  import time (that is the intended mechanism). Slices MUST NOT touch the DB at import time (no top-level
  `db.prepare(...)`, no top-level queries): prepared statements are created lazily inside functions (memoise in a
  module-level `let`), and import-time DB work goes through `onDbReady(fn)` (§4.2.2) only. All registries are
  last-write-wins and never throw (§4.2.10).
- **R5** The stub signatures in §4.6 are frozen. A slice replaces stub *bodies*, never names or prop types.
- **R6** If a dependency from another slice is missing at integration time the consumer MUST degrade silently
  (render nothing / hide the control), never crash.
- **R7** **No dead controls.** A control shown in `design.md` §7 or implied by `product.md` copy that has no endpoint or
  type in §4–§5 of this file MUST NOT be rendered; the slice lists it in its final report instead of inventing an
  endpoint. The known cases are decided in §2.3.
- **R8** **Tiers** (§1.3). A slice passes its T1 acceptance + tests before starting any T2 item. A T2 item MAY be dropped
  with a note in the final report; its controls then MUST NOT render (R7) and its endpoints MAY return 404.

---

## 1. Product summary & final feature list

**UniVerse**: a social super-app for verified university students. Passwordless sign-up with a university email.
Bottom nav (fixed order, six items): **Home** (swipeable Reels · Buzz · Orbit) · **Discover** · **Messages** ·
**Roommates** · **Market** · **Apartments**. Everything else hangs off the Home top bar (avatar → Me sheet; bell →
Notifications) and the Campus hub.

Product rules adopted from `product.md §0` (testable, binding):

1. **Density over breadth.** Feeds default to the viewer's campus. **Cold-start rule:** a campus-scoped *Reels* or
   *Buzz* feed returning 0 items on first page auto-switches the pane to Global with a dismissible banner
   "{university} is just getting started — showing Global." + [Post the first one]. Market, Roommates, Events never go global.
2. **Two identities, never blended** (Constitution §5; §3 below).
3. **Utility floor:** course chats, Marketplace, Roommates are fully useful with zero follows.
4. **Notifications only for human actions aimed at you or things you subscribed to.** No fabricated activity.
5. **Numbers are real.** Every on-screen count derives from DB rows, including seed data.

All UI copy in `product.md` §1–§2 (titles, empty states, error strings) is adopted verbatim unless this file
overrides it. No emoji in UI copy except Buzz aliases and message reactions.

### 1.1 Final feature list per slice

| slice | ships (v1) |
|---|---|
| `auth` | Welcome → Email (live campus chip via domain lookup) → Code (OTPInput, paste, auto-submit, resend 30s, dev-inbox toast) → Public profile (DiceBear shuffle / photo, name, handle w/ live availability + alternatives, class-year chips, major typeahead, bio, student↔org switch, required two-option choice "Are you 18 or older? Yes / No" with no default — §5.1) → Guidelines accept → Follow suggestions (inviter pinned, "Follow top 5", never blocks) → rings-expand exit to Home/`next`. `?next=` and `?invite=` survive the whole flow; refresh resumes at the right step. |
| `reels` | Vertical snap feed (one playing, preload window ±1, poster fallback), Campus/Global, mute pill, tap pause, double-tap like burst, comments sheet (1 level replies, comment likes), share, not-interested, report/block, upload (.mp4 / .mov / .webm; ≤60s enforced client+server with one shared tolerance; cover from first frame, caption ≤150, visibility Campus/Global, progress), view counts, `UserReelsGrid`, `FollowingReelsRail`, single-reel deep link page. |
| `buzz` | Guidelines gate **before first read**, rendered **inline inside the Buzz pane** — never a modal; swipe, top-bar tabs and bottom nav stay usable, "Not now" leaves (safety wins over product on *when*, §5.3 on *how*), Hot/New/Top(day/week/all) × Campus/Global, text ≤500 + polls (2–4 options; 1/3/7 days; results hidden until vote/close), per-thread aliases, threads (2 visual levels, deeper flatten), votes (no self-vote), community collapse (≤−5 & ≥8 eligible votes) and auto-hide (≤−10 & ≥12), Hide thread, Hide this anon in this thread, Report, Delete own, My buzzes + private karma, Daily Campus Prompt, share card (text only), anonymous notifications (reply / milestone / poll closed), cold-start rule, small-campus note (<50 users). **No images, no edit, no Block, no DM-the-author.** |
| `orbit` | Strictly reverse-chron feed of follows + self, `FollowingReelsRail` on top, text ≤1000 + ≤4 photos + poll, likes (double-tap photo), comments (1 level replies), lightbox, post detail, "New posts" pill (ws + 60s), "New since your last visit" divider, caught-up end cap, internal link → compact card, share, report/block, `UserPostsList`. |
| `discover` | Discover home (Campus hub hero card, People you may know, Active creators, Popular orgs — each with a visible reason, dismissible), search (250ms debounce, People/Orgs, campus first, highlight, local recents), profile page (banner from id, stats, mutual line, Follow/Message, Reels · Posts · About tabs, org: Events tab), follow lists, edit profile (avatar, name, handle 1/14d, bio, major, year, pronouns, ≤5 interests), block/report profile, founding-member + new-account chips, org starter card. |
| `messages` | Inbox (Chats / Requests), DMs, groups, course chats (joined from Campus), realtime (ws) send/receive, typing, read receipts ("Seen", group avatar stack), presence (5-min buckets, accepted DM partners only), image attachments (withheld in requests), reactions (6), delete-for-everyone, message kinds text/image/card/offer/system, live pinned context card, offer accept/decline → "Mark as sold?", quick replies, safety tip + recipient banners, requests (accept / delete / block / report; one message until accepted; 30-day cooldown after delete), new chat / group create / group info / mute / leave, reconnect bar, report with last-10-messages opt-in. |
| `roommates` | Browse · Saved · My profile; **two entry paths** — "Post that I'm looking" (published post) **or** "Just browse & match" (answers + filters only; never listed anywhere); basics + 8-question questionnaire + 2 dealbreakers; compatibility % with per-dimension breakdown and "You both…" sentence; archetype label; filters (mode, budget range, move-in, lease, neighborhoods, living-with); sort best/newest/budget; save (silent); pause/resume; "Still looking?" after 30 days (auto-pause at 60); safety card; message with roommate context card + trait-based opener; under-18 cannot publish; first name only on cards. Campus-only. |
| `market` | 2-col grid, types sell/trade/free/wanted/**lost/found** (trade listings carry a required "for {tradeFor}" + **Propose a trade**), categories, filter sheet, sort, title search, optional **course code** on Textbooks, detail (carousel, seller card w/ trust chips, safety card, Message seller, Make offer −10/−20%, save, share, report), create/edit (photos first ≤6, prohibited-item copy), mark sold/returned, my listings (views/saves/chats), saved, price-drop notifications, low-price flag, first-contact interstitial, "Post a Wanted for {q}", 30-day expiry, sold leaves browse after 7 days. Campus-only. |
| `campus` | Hub (member count + launch meter, Today strip, Your courses rail, Upcoming, quick links, invite), events (filters incl. **Free food**, RSVP going/interested, friends-going stack, attendees, .ics, share, report, host edit/cancel → notifies, 1-hour reminder generated lazily), create event (8 cover presets or upload, capacity, private-address option), course chats directory (search, normalised code, dedupe per university+code+term, join → lands in chat, create, invite link `/c/:courseId`, "Textbooks for {code}" deep link), `OrgEventsList`, milestone notifications. |
| `apartments` | Coming-soon poster, Get notified (waitlist join/leave, real campus count), 3-question micro-survey with live campus split, full engagement tracking, roommates cross-link; **Notifications center** (groups, filter chips, collapse, inline Follow back, mark all read); **Settings** (Account, Notifications + quiet hours, Privacy & safety: who can message, blocked users, My buzzes link, "How Buzz anonymity works"; Appearance; Invite friends; About: Guidelines, Terms, Privacy, version; Sign out; Delete account) and static **Terms / Privacy** pages. |
| `admin` | Trust & Safety app (role-gated, 404 for others): queue views (Priority, Wellbeing, Held, Auto-hidden, Reports, Escalated, Appeals, Mine, Closed), item detail (blind author standing for Buzz), actions + bulk, claim, sanctions ladder w/ suggestion, unmask-with-reason (admin, audited, 5-min on-screen re-mask), audit log, users (lookup, standing, role grant, org verify), appeals (user-facing submit + staff review), analytics (signups by campus, DAU/WAU, activation, content/day, reports per 1k, time-to-action, **Apartments funnel**), moderation metrics, rule-pack toggles, Limitations panel (G1–G5), upgraded rule packs, **Community Guidelines page** + `GuidelinesContent`. |

Additions beyond the brief (all five from `product.md §3` adopted): share-to-chat cards for everything (`ShareCard`,
foundation `openShare`), Free-food flag, Daily Campus Prompt, course-code tag on listings, Lost & Found listing types.
Growth loops adopted: personal invite link `/i/:code`, campus launch meter + Founding member badge, course-chat link,
org onboarding, listing/event share links via `?next=`.

### 1.2 Cut from v1 (do not build)

Everything in `product.md §3 "Cut"` stays cut (anonymous DMs, Buzz media, stories, dating, professor ratings,
payments/shipping, ride-share, contact upload, public karma, reel editing/hashtags, live/audio/voice/video calls,
message editing, timetable/GPA/maps/dining, AI helper, sublets, QR, logged-out previews, alumni, gamified checklists).
Additionally cut by the architect:

- Discover "Trending on campus" section (would require reading Orbit tables).
- Buzz edit (delete + repost instead) → no `edited` flag. Buzz-internal search.
- Push notifications / service worker (PWA manifest only; nothing caches `/api`).
- Data export. Map views. Drag-reorder of listing photos (use "Make cover"). Reels trim slider (over-60s is refused).
- Second-admin confirmation for bans (replaced by typed `BAN` + note ≥ 30; listed in Limitations). `escalate_external`
  stores a reference number only.
- Seed scale reduced from ~600 to ~300 users (RAM budget); proportions kept.
- Home top-bar left slot: **Me button → Me sheet** instead of the campus chip (product). The button is identity-aware:
  it crossfades with the pager's `progress` (§4.4.1 `useHomeTab`) between the viewer `Avatar` (`ring="orbit"`; opacity 1 at
  rest on Reels and Orbit) and a **neutral account glyph** (`CircleUser` IconButton, no photo, no ring, no aurora; opacity 1
  at rest on Buzz): `avatarOpacity = clamp(|progress − 1|, 0, 1)`, `glyphOpacity = 1 − avatarOpacity`; the layer at opacity 0
  is `visibility:hidden` + `aria-hidden`. Both open the Me sheet (a public-mode overlay the user asked for — allowed).
  **At rest on `/home/buzz` no element inside `#frame` shows the viewer's avatar, name or handle.** Campus hub is the first
  row of the Me sheet and the hero card on Discover.

### 1.3 Tiers — what to finish first (R8)

**T1** = the brief (Constitution §0) + the Constitution §7 scope of each slice + everything §3 marks binding. T1 always
includes: university-email gate + OTP, the swipe pager, ≤60 s enforcement, following-only Orbit, Discover from public
profiles only, DMs + requests, roommate post **and** browse-&-match, buy/sell/trade listings + offers, Apartments
Get-notified + engagement tracking, the anonymity firewall, moderation + reports + blocks, the staff queue + unmask + audit.
**T2** = every other item of §1.1. Named T2 items (not exhaustive — if it is not in the sentence above or Constitution §7, it is T2):

| slice | T2 items |
|---|---|
| foundation | AI second-pass interface, quiet-hours suppression, presence, `useDwell` extras beyond Apartments, launch-meter helpers |
| auth | rings-expand exit + coach mark, handle alternatives, DiceBear shuffle polish |
| reels | not-interested, comment likes, likers list, view-count overlays |
| buzz | private karma, milestone notifications, poll-closed notifications, "Hide this anon", Daily Campus Prompt, share card, small-campus note |
| orbit | "New since your last visit" divider, internal link → compact card, likers list |
| discover | dismissible suggestions, local recents, founding-member / new-account chips, org starter card, interests |
| messages | presence, reactions, reply-to, quick replies, 30-day cooldowns, delete-for-everyone, group read avatar stack |
| roommates | archetype label, "Still looking?" + auto-pause, low-price flag, budget sort |
| market | Lost & Found types, price-drop fan-out, relist, low-price flag, course-code tag, "Post a Wanted for {q}", first-contact interstitial, view stats |
| campus | `.ics` export, milestones, lazy reminders, friends-going stack, private-address option, capacity |
| apartments | quiet hours, Appearance settings, notification grouping polish |
| admin | bulk actions, claim leases, conflict-of-interest filter, saved filters, moderation metrics, CSV export, rule-pack toggle UI, DAU/WAU + content/day charts (the **Apartments funnel is T1**) |

Contract surface (types, tables, stub exports, registries) of T2 items is still frozen — dropping a T2 item never changes a signature.

---

## 2. Design system (binding; full rationale in `docs/blueprint/design.md`)

`design.md` §0–§9 is adopted for look, layout, motion and component visuals. Foundation implements §1–§6 and §9; slices
follow §7–§8. Where `design.md` or `product.md` differs from this file on **routes, props, export names, features, controls
or copy**, **this file wins**; the known differences are decided in §2.3, and anything else without an endpoint/type here
falls under R7 (do not render; report). Non-negotiables:

- Semantic slots only (`accent`, `canvas`, `surface-*`, `ink-*`); default Tailwind palette is wiped.
- `type-*` role utilities only; Sora = display, Inter = text; inputs 16px.
- `<Surface mode="incognito">` may be mounted **only** by `buzz`, by Buzz excerpts inside `admin`, and by foundation (the Home pager's Buzz
  section, `ReportSheet` opened from Buzz, `ShareCardView` for kind `'buzz'`). Nothing in Buzz
  renders `Avatar`/`UserAvatar`/`@handle`/aurora; nothing outside Buzz renders `AliasAvatar`/Phosphor/`VenetianMask`
  (exceptions: Home tab indicator, Buzz-origin notification rows, Settings "My buzzes"/"How Buzz anonymity works" rows).
  The Home top bar overlays all three panes, so its left slot follows the same rule: on Buzz it shows the neutral account
  glyph, never the viewer's `Avatar` (§1.2). The Me sheet, ReportSheet and ShareSheet are overlays the user opens on purpose
  and are not "in Buzz".
- Nested horizontal scrollers (chip rows, `FollowingReelsRail`, carousels, `Tabs scrollable`) MUST use the foundation
  utility class `scroll-x` (`overflow-x:auto; overscroll-behavior-x:contain; touch-action:pan-x pan-y; scrollbar-width:none`)
  so a swipe inside them — including at their edges — never moves the Home pager.
- No `position: fixed`, no `100vh/100vw`; everything lives inside `#frame`. Overlays portal into `#overlay-root`.
- Skeletons not spinners; every list = skeleton → content → `InfiniteSentinel`; EmptyState + ErrorState everywhere.
- Motion presets from `client/src/lib/motion.ts` only; `bouncy` for celebrations only; reduced motion honoured.
- lucide-react named imports only; canonical glyph table in design §8.1.
- Alias colour: the Buzz serializer emits a **hex string** from safety §5.1 `ALIAS_COLORS`; `AliasAvatar.color` accepts
  that string (the `--color-alias-N` tokens remain available for index-based use).

### 2.1 Final theme — `client/src/app/styles/theme.css` (verbatim; foundation pastes this)

```css
@import "tailwindcss";

@theme {
  /* ---- reset defaults we do not want used ---- */
  --color-*: initial;

  --color-white: #ffffff;
  --color-black: #000000;

  /* ---- background layers (public / default) ---- */
  --color-void: #04050a;        /* desktop backdrop behind the phone frame */
  --color-canvas: #090b14;      /* app background */
  --color-surface-1: #10131f;   /* cards, list containers */
  --color-surface-2: #171b2b;   /* inputs, raised cards, sheets */
  --color-surface-3: #20253a;   /* chips, hover/pressed, dialogs */
  --color-surface-4: #2b3150;   /* selected rows, slider tracks, strongest fill */
  --color-scrim: rgb(2 3 8 / 0.64);           /* behind sheets/dialogs */
  --color-glass: rgb(16 19 31 / 0.72);        /* glass fill */
  --color-glass-strong: rgb(16 19 31 / 0.88); /* glass fallback / reduced transparency */

  /* ---- borders ---- */
  --color-line-subtle: rgb(255 255 255 / 0.06);  /* dividers inside cards */
  --color-line: rgb(255 255 255 / 0.10);         /* card + input borders */
  --color-line-strong: rgb(255 255 255 / 0.18);  /* hover borders, phone frame */

  /* ---- text tiers ---- */
  --color-ink: #f2f4fb;
  --color-ink-2: #b6bcd2;
  --color-ink-3: #838ba8;
  --color-ink-4: #565e7a;
  --color-ink-inverse: #090b14;

  /* ---- brand: Aurora (public world) ---- */
  --color-brand-200: #d6ccff;
  --color-brand-300: #bcacff;
  --color-brand-400: #a08bff;   /* links / accent text on dark */
  --color-brand-500: #7c5cff;   /* icons, rings, indicators */
  --color-brand-600: #6d4ff2;   /* filled buttons (white text 5.2:1) */
  --color-brand-700: #5a3cd9;   /* pressed */
  --color-aurora-violet: #8b5cff;
  --color-aurora-azure: #5b7cff;
  --color-aurora-cyan: #22d3ee;
  --color-aurora-mint: #5eead4;
  --color-aurora-orchid: #c04dff;   /* backdrop blobs only */

  /* ---- incognito: Phosphor (Buzz world) ---- */
  --color-incog-200: #ecffad;
  --color-incog-300: #e0ff85;
  --color-incog-400: #d3fb5c;   /* accent text on incog canvas */
  --color-incog-500: #c5f53b;   /* fills, indicators */
  --color-incog-600: #a6d822;   /* pressed */
  --color-incog-700: #7da912;
  --color-incog-ink: #0c1400;   /* text on Phosphor fills */
  --color-incog-canvas: #070908;
  --color-incog-surface-1: #0e120f;
  --color-incog-surface-2: #151b16;
  --color-incog-surface-3: #1d261f;
  --color-incog-surface-4: #28342a;
  --color-incog-down: #ff8a65;  /* downvote only */

  /* ---- semantic slots (public defaults; remapped below) ---- */
  --color-accent: #6d4ff2;                     /* filled interactive */
  --color-accent-hover: #7c5cff;
  --color-accent-press: #5a3cd9;
  --color-accent-ink: #a08bff;                 /* accent-coloured text/icons on canvas */
  --color-accent-soft: rgb(124 92 255 / 0.16); /* selected chip, active nav pill */
  --color-accent-line: rgb(124 92 255 / 0.42); /* selected borders */
  --color-on-accent: #ffffff;
  --color-focus: #a08bff;                      /* focus ring */

  /* ---- semantic status ---- */
  --color-success: #34d399;
  --color-success-soft: rgb(52 211 153 / 0.14);
  --color-warning: #fbbf24;
  --color-warning-soft: rgb(251 191 36 / 0.14);
  --color-danger: #ff5a5f;                     /* text/icons */
  --color-danger-fill: #d5383e;                /* destructive buttons (white text) */
  --color-danger-soft: rgb(255 90 95 / 0.14);
  --color-info: #38bdf8;
  --color-info-soft: rgb(56 189 248 / 0.14);
  --color-love: #ff3d81;                       /* like heart only */
  --color-online: #3ddc97;                     /* presence dot only */
  --color-gold: #f5c451;                       /* verified org tick, "free" tag */

  /* ---- alias palette (index-based use) ---- */
  --color-alias-0: #f87171;  --color-alias-1: #fb923c;  --color-alias-2: #fbbf24;
  --color-alias-3: #a3e635;  --color-alias-4: #34d399;  --color-alias-5: #2dd4bf;
  --color-alias-6: #38bdf8;  --color-alias-7: #93a5ff;  --color-alias-8: #e5e7eb;
  --color-alias-9: #f0abfc;  --color-alias-10: #fb7185; --color-alias-11: #d6b98c;

  /* ---- typography ---- */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "Sora Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --text-2xs: 0.6875rem;  /* 11 */
  --text-xs: 0.75rem;     /* 12 */
  --text-sm: 0.8125rem;   /* 13 */
  --text-base: 0.9375rem; /* 15 */
  --text-md: 1rem;        /* 16 */
  --text-lg: 1.0625rem;   /* 17 */
  --text-xl: 1.125rem;    /* 18 */
  --text-2xl: 1.375rem;   /* 22 */
  --text-3xl: 1.75rem;    /* 28 */
  --text-4xl: 2.125rem;   /* 34 */
  --text-5xl: 2.75rem;    /* 44 */

  /* ---- radii ---- */
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-2xl: 36px;
  --radius-3xl: 44px;

  /* ---- elevation ---- */
  --shadow-*: initial;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-md: 0 8px 24px -6px rgb(0 0 0 / 0.55), 0 2px 6px rgb(0 0 0 / 0.35);
  --shadow-lg: 0 24px 64px -12px rgb(0 0 0 / 0.7), 0 8px 20px rgb(0 0 0 / 0.4);
  --shadow-frame: 0 40px 120px -20px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(255 255 255 / 0.08);
  --shadow-glow: 0 0 0 1px var(--color-accent-line), 0 8px 28px -6px var(--color-accent-soft);
  --inset-shadow-hairline: inset 0 1px 0 rgb(255 255 255 / 0.06);

  /* ---- z-index + easing ---- */
  --z-sticky: 10; --z-topbar: 30; --z-fab: 35; --z-nav: 40; --z-scrim: 50; --z-sheet: 51; --z-dialog: 60; --z-toast: 70;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

/* gradients are not a Tailwind namespace: plain custom properties + utilities */
:root {
  --gradient-aurora: linear-gradient(135deg, #8b5cff 0%, #5b7cff 46%, #22d3ee 100%);
  --gradient-aurora-soft: linear-gradient(135deg, rgb(139 92 255 / .22), rgb(91 124 255 / .14) 46%, rgb(34 211 238 / .18));
  --gradient-aurora-ring: conic-gradient(from 210deg, #8b5cff, #5b7cff, #22d3ee, #5eead4, #8b5cff);
  --gradient-phosphor: linear-gradient(135deg, #e0ff85 0%, #c5f53b 52%, #6ee7a0 100%);
  --gradient-phosphor-soft: linear-gradient(135deg, rgb(197 245 59 / .16), rgb(110 231 160 / .08));
  --gradient-scrim-top: linear-gradient(to bottom, rgb(0 0 0 / .58), rgb(0 0 0 / 0));
  --gradient-scrim-bottom: linear-gradient(to top, rgb(0 0 0 / .72), rgb(0 0 0 / .28) 55%, rgb(0 0 0 / 0));
  --gradient-hero: var(--gradient-aurora);
  --gradient-hero-soft: var(--gradient-aurora-soft);

  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --topbar-h: 52px;
  --nav-h: 64px;
  --nav-gap: 12px;
  --nav-clearance: calc(var(--nav-h) + var(--nav-gap) * 2 + var(--safe-bottom));
}
@media (min-width: 768px) { :root { --safe-top: 10px; --safe-bottom: 6px; } }

[data-surface="incognito"] {
  --color-canvas: #070908;
  --color-surface-1: #0e120f;
  --color-surface-2: #151b16;
  --color-surface-3: #1d261f;
  --color-surface-4: #28342a;
  --color-glass: rgb(14 18 15 / 0.76);
  --color-glass-strong: rgb(14 18 15 / 0.9);
  --color-ink-2: #b9c2b4;
  --color-ink-3: #869183;
  --color-ink-4: #586155;
  --color-accent: #c5f53b;
  --color-accent-hover: #d3fb5c;
  --color-accent-press: #a6d822;
  --color-accent-ink: #d3fb5c;
  --color-accent-soft: rgb(197 245 59 / 0.13);
  --color-accent-line: rgb(197 245 59 / 0.34);
  --color-on-accent: #0c1400;
  --color-focus: #d3fb5c;
  --gradient-hero: var(--gradient-phosphor);
  --gradient-hero-soft: var(--gradient-phosphor-soft);
  background-color: var(--color-canvas);
  color: var(--color-ink);
}

@utility bg-hero { background-image: var(--gradient-hero); }
@utility bg-hero-soft { background-image: var(--gradient-hero-soft); }
@utility bg-aurora-ring { background-image: var(--gradient-aurora-ring); }
@utility bg-scrim-top { background-image: var(--gradient-scrim-top); }
@utility bg-scrim-bottom { background-image: var(--gradient-scrim-bottom); }
@utility text-hero {
  background-image: var(--gradient-hero);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
@utility focus-ring { outline: 2px solid var(--color-focus); outline-offset: 2px; }
@utility scroll-x { overflow-x: auto; overscroll-behavior-x: contain; touch-action: pan-x pan-y; scrollbar-width: none; }
@utility glass {
  background-color: var(--color-glass);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--color-line);
  box-shadow: var(--inset-shadow-hairline), var(--shadow-lg);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background-color: var(--color-glass-strong); }
}
@media (prefers-reduced-transparency: reduce) { .glass { background-color: var(--color-glass-strong); backdrop-filter: none; } }

@utility type-display   { font-family: var(--font-display); font-size: 2.125rem; line-height: 2.5rem;   font-weight: 700; letter-spacing: -0.025em; }
@utility type-title-1   { font-family: var(--font-display); font-size: 1.75rem;  line-height: 2.125rem; font-weight: 700; letter-spacing: -0.02em; }
@utility type-title-2   { font-family: var(--font-display); font-size: 1.375rem; line-height: 1.75rem;  font-weight: 600; letter-spacing: -0.015em; }
@utility type-title-3   { font-family: var(--font-display); font-size: 1.125rem; line-height: 1.5rem;   font-weight: 600; letter-spacing: -0.01em; }
@utility type-headline  { font-family: var(--font-sans); font-size: 1rem;      line-height: 1.375rem; font-weight: 600; letter-spacing: -0.01em; }
@utility type-body-lg   { font-family: var(--font-sans); font-size: 1.0625rem; line-height: 1.625rem; font-weight: 400; letter-spacing: -0.008em; }
@utility type-body      { font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.375rem; font-weight: 400; letter-spacing: -0.005em; }
@utility type-footnote  { font-family: var(--font-sans); font-size: 0.8125rem; line-height: 1.125rem; font-weight: 400; letter-spacing: 0; }
@utility type-caption   { font-family: var(--font-sans); font-size: 0.75rem;   line-height: 1rem;     font-weight: 500; letter-spacing: 0.005em; }
@utility type-micro     { font-family: var(--font-sans); font-size: 0.6875rem; line-height: 0.875rem; font-weight: 600; letter-spacing: 0.02em; }
@utility type-overline  { font-family: var(--font-sans); font-size: 0.6875rem; line-height: 0.875rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
@utility type-label     { font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.25rem;  font-weight: 600; letter-spacing: -0.005em; }
@utility type-label-sm  { font-family: var(--font-sans); font-size: 0.8125rem; line-height: 1rem;     font-weight: 600; letter-spacing: 0; }
```

`client/src/app/styles/base.css` = design §9 verbatim (base layer, `shimmer` keyframes, `skeleton` utility) plus the
reduced-motion CSS guard of design §4.4. `client/src/main.tsx` imports the two fontsource packages, `theme.css`, `base.css`.

### 2.2 UI kit — `client/src/ui/*` (barrel `client/src/ui/index.ts`; named exports; all accept `className`, forward `ref`)

Visual specs: design §5. Props are frozen here.

| export | props |
|---|---|
| `Surface` | `{ mode: 'public'\|'incognito'; className?; children }` · `useSurfaceMode(): 'public'\|'incognito'` |
| `Button` | `ButtonHTMLAttributes & { variant?: 'primary'\|'hero'\|'secondary'\|'ghost'\|'outline'\|'danger'\|'danger-ghost'; size?: 'sm'\|'md'\|'lg'; fullWidth?: boolean; loading?: boolean; leftIcon?: LucideIcon; rightIcon?: LucideIcon; to?: string }` (`to` renders a router `<Link>`; replaces design's `asChild`) |
| `IconButton` | `ButtonHTMLAttributes & { icon: LucideIcon; 'aria-label': string; variant?: 'ghost'\|'filled'\|'glass'\|'accent'; size?: 'sm'\|'md'\|'lg'; badge?: number\|'dot'; active?: boolean; activeTone?: 'accent'\|'love'; to?: string }` |
| `FAB` | `{ icon: LucideIcon; label: string; extended?: boolean; onClick(): void; hideOnScroll?: RefObject<HTMLElement\|null>; badgeIcon?: LucideIcon }` |
| `Input` | `Omit<InputHTMLAttributes,'size'\|'prefix'> & { label?; helper?; error?; size?: 'md'\|'lg'; variant?: 'field'\|'search'; leftIcon?: LucideIcon; rightSlot?: ReactNode; prefix?: string; onClear?(): void }` |
| `Textarea` | `TextareaHTMLAttributes & { label?; helper?; error?; minRows?: number; maxRows?: number; maxLength?: number; showCount?: boolean; variant?: 'field'\|'bare' }` |
| `Select<T extends string>` | `{ label?; value: T\|null; onChange(v: T): void; options: { value: T; label: string; description?: string; icon?: LucideIcon }[]; placeholder?; error?; sheetTitle? }` · `MultiSelect<T>`: same with `value: T[]; onChange(v: T[]); max?: number` |
| `Switch` | `{ checked: boolean; onChange(v: boolean): void; disabled?; 'aria-label'?: string }` |
| `Slider` / `RangeSlider` | `{ min; max; step?; value: number; onChange(v); format?(v): string; label? }` / `value: [number,number]; onChange(v: [number,number]); minGap?` |
| `OTPInput` | `{ value: string; onChange(v): void; onComplete?(v): void; status?: 'idle'\|'verifying'\|'error'\|'success'; autoFocus?: boolean }` |
| `Chip` | `{ variant?: 'filter'\|'choice'\|'tag'\|'removable'; size?: 'sm'\|'md'; selected?: boolean; onClick?(): void; onRemove?(): void; leftIcon?: LucideIcon; count?: number; children }` |
| `ChipGroup<T extends string>` | `{ options: { value: T; label: string; icon?: LucideIcon }[]; value: T\|T[]\|null; onChange(v: any): void; multiple?: boolean; max?: number; scroll?: 'x'\|'wrap'; size?: 'sm'\|'md'; 'aria-label': string }` |
| `Badge` | `{ variant?: 'count'\|'dot'\|'soft'\|'outline'; tone?: 'neutral'\|'accent'\|'success'\|'warning'\|'danger'\|'info'\|'gold'; count?: number; children? }` · `VerifiedBadge` `{ size?: number }` · `OpBadge` · `CampusBadge` `{ name: string }` |
| `SegmentedControl<T extends string>` | `{ value: T; onChange(v: T): void; options: { value: T; label: string; icon?: LucideIcon }[]; size?: 'sm'\|'md'; fullWidth?: boolean; 'aria-label': string }` |
| `Tabs<T extends string>` | `{ value: T; onChange(v: T): void; tabs: { value: T; label: string; count?: number }[]; scrollable?: boolean; sticky?: boolean }` |
| `ProgressBar` | `{ value?: number /*0–1; undefined = indeterminate*/; className? }` · `StepDots` `{ total: number; current: number; label?: boolean }` · `ProgressRing` `{ value: number /*0–1*/; size?: 40\|64\|96; label?: ReactNode; animate?: boolean }` · `NumberStepper` `{ value; min?; max?; onChange(v) }` |
| `Avatar` | `{ src?: string\|null; name: string; size?: 'xs'\|'sm'\|'md'\|'lg'\|'xl'\|'2xl'; shape?: 'circle'\|'org'; ring?: 'none'\|'orbit'\|'seen'\|'live'; presence?: 'online'\|'offline'; badge?: 'verified'; onClick?(): void }` · `AvatarStack` `{ users: { src?: string\|null; name: string; shape?: 'circle'\|'org' }[]; max?: number; size?: 'xs'\|'sm'\|'md'; total?: number }` |
| `AliasAvatar` | `{ emoji: string; color: string /*hex*/; size?: 'sm'\|'md' }` — Buzz only |
| `Card` (+ `Card.Header/Body/Footer`) | `{ variant?: 'flat'\|'raised'\|'hero'\|'media'; interactive?: boolean; to?: string; onClick?(): void; children }` |
| `ListRow` | `{ leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; trailing?: ReactNode\|'chevron'; onClick?(): void; to?: string; unread?: boolean; destructive?: boolean; disabled?: boolean }` |
| `PageHeader` | `{ title: ReactNode; subtitle?: ReactNode; mode?: 'large'\|'compact'; back?: boolean\|(() => void); actions?: ReactNode; below?: ReactNode; transparent?: boolean }` |
| `Screen` | `{ nav?: boolean; bleed?: boolean; header?: ReactNode; footer?: ReactNode; scrollRef?: RefObject<HTMLDivElement\|null>; className?; children }` — sets nav visibility for the route |
| `Sheet` | `{ open: boolean; onOpenChange(o: boolean): void; title?: ReactNode; description?: ReactNode; detents?: ('auto'\|'half'\|'full')[]; initialDetent?: number; footer?: ReactNode; dismissible?: boolean; children }` · `ActionSheet` `{ open; onOpenChange; title?; actions: { icon?: LucideIcon; label: string; destructive?: boolean; onSelect(): void }[] }` |
| `Dialog` | `{ open; onOpenChange; title: string; description?: ReactNode; icon?: LucideIcon; tone?: 'default'\|'danger'; confirmLabel: string; cancelLabel?: string; onConfirm(): void\|Promise<void>; confirmDisabled?: boolean; persistent?: boolean; children? }` |
| `Toaster` + `toast` (`client/src/lib/toast.ts`) | `toast.success(msg, opts?) / .error / .info / .show`, `opts: { action?: { label; onClick() }; duration?: number }`, `toast.devInbox(code: string, onFill: () => void)` |
| `Skeleton` / `SkeletonText` | `{ w?: number\|string; h?: number\|string; circle?: boolean; className? }` / `{ lines: number }` |
| `EmptyState` | `{ icon: LucideIcon; title: string; description?: string; action?: { label; onClick() }; secondary?: { label; onClick() }; compact?: boolean }` |
| `ErrorState` | `{ title?: string; error?: unknown; onRetry?(): void; inline?: boolean }` |
| `InfiniteSentinel` | `{ onReach(): void; hasMore: boolean; isFetching: boolean; error?: unknown; onRetry?(): void; rootRef?: RefObject<HTMLElement\|null>; skeleton?: ReactNode; endLabel?: string\|null }` |
| `PullToRefresh` | `{ onRefresh(): Promise<unknown>; disabled?: boolean; children }` |
| `Lightbox` | `{ open; onOpenChange; images: MediaImage[]; index: number; onIndexChange(i: number): void }` (added by architect: used by orbit, messages, market) |

Shared composites (`client/src/components/*`) are listed with props in §4.4.

### 2.3 Deltas from `design.md` / `product.md` (binding v1 decisions; see R7)

| shown in the blueprint | v1 decision |
|---|---|
| design §7: **Save** (bookmark) on the reel right rail, on the Orbit post action row, and "Save" in the `OverflowMenu` preset | Not in v1 — no endpoint. Not rendered. `Bookmark` exists only in Market (saved listings) and Roommates (saved profiles). |
| design §7: Orbit composer **audience Select** | Not rendered. Orbit posts go to followers + profile visitors; no audience field exists. |
| design §7: reel upload trim **RangeSlider** | Cut (§1.2). Over-limit files are refused before upload with the product copy (§5.2). |
| design §7: Discover **"Trending on campus"** | Cut (§1.2). |
| design §7: Roommates `SegmentedControl` **Browse / My listing**; filter sheet lifestyle ChipGroups; Switch **"Same campus only"** | Tabs **Browse · Saved · My profile** (product). Filter sheet = `RoommateFilters` only. Lifestyle chips are not filters (they drive match %). No campus switch — always campus-only. |
| design §7: Inbox chips **All · Unread · Groups** | Not rendered. Tabs **Chats \| Requests (n)** + a client-side filter box over loaded rows. |
| design §7: Apartments survey **budget / bedrooms / move-in term** + **waitlist position** | Survey = `SURVEY` (`when`, `budget`, `priorities`; product §2.10). No position exists — show the real `campusCount` line only. |
| product §2.11: unmask reason ≥ 20 chars | `reasonCode` + reason ≥ 30 + typed `UNMASK` (§3.3). |
| design §7.10: admin tabs **Queue · Reports · Flagged · Users · Audit · Analytics** | **Queue · Users · Appeals · Audit · Analytics · Rules**; Reports / Flagged / Held are `QueueView`s inside Queue. |
| design §5 Tabs example: profile **Posts / Reels / About** | **Reels · Posts · About** (orgs: + **Events**). |
| design §7.1: `StepDots` (5) | `StepDots total={5}` covers email → code → profile → guidelines → follow; the Welcome screen has none. |
| design §7.1: guidelines step required **Switch** "I agree…" | No Switch. One primary button **"I agree"** (product) → `POST /me/guidelines {kind:'app'}`. |
| design §7.1: **"Follow all"** | **"Follow top 5"** (`POST /onboarding/follow-many`, ≤ 10). |
| product §1 / design: age as a checkbox "I'm 18 or older" | Required two-option choice, no default (§5.1). |
| design §7.2: Buzz gate as a **non-dismissible full Sheet** | Inline in-pane panel, only when the pane is active, with "Not now" (§5.3). |
| design §6.4: viewer `Avatar` in the Home top-bar left slot on every pane | Crossfades to a neutral account glyph on Buzz (§1.2). |
| design §6.5: pager is pure CSS scroll-snap, "no drag gesture libraries" | Still no libraries; foundation adds one small `pointerType === 'mouse'` drag handler so the framed desktop layout can swipe (§8). |
| product / design: prices written as "$60" | `formatPrice(n, currency)` with the campus currency (§4.4.1). |
| design §7: `ComposerModeBanner` only on Buzz / Orbit / Market composers | On **every** create/edit surface (§5 common rules). |

---

## 3. Trust & safety requirements (binding)

`docs/blueprint/safety.md` is adopted **in full and is binding**, with only the scoped deviations in §3.3. The points
every engineer must hold in their head:

### 3.1 Every UGC write (all slices)

```ts
// server: inside asyncHandler, after validate() and enforceRateLimit()
const mod = moderateWrite(
  [{ text: body.title, field: 'title' }, { text: body.text }],
  modCtx(req.user, 'market_listing'),
  blockedTarget(req.user, 'market_listing'),
);                                                     // throws ApiError(422,'content_blocked') on block
const row = insert({ ...body, status: mod.persistStatus });
commitModeration(mod, { ...blockedTarget(req.user, 'market_listing'), entityId: row.id });
res.status(201).json({ ...serialize(row, req.user), moderation: toAuthorNotice(mod) });
```
```ts
// client: every create/update mutation
onError: (e) => { if (!handleModerationError(e)) toast.error(errorMessage(e)); },
onSuccess: (res) => { showModerationNotice(res.moderation); /* held chip / support sheet */ },
```

- Every UGC table has `status TEXT NOT NULL DEFAULT 'active'` ∈ `ContentStatus`. List queries for *other* viewers
  return only `active`; authors also see their own `held`/`hidden`/`removed` with the chips of safety §2.1. No shadow states.
- Every UGC entity type has a **ContentAdapter** registered by its owner slice (§4.2.10) so reports, auto-hide, the
  admin queue and removal work without cross-slice table access.
- Every public list/detail query MUST exclude blocked users both ways in SQL (`sqlNotBlocked`, §4.2.4) and items the
  viewer reported (`reportedIdsFor`). **Buzz MUST NOT apply either the block filter or any public-graph input** (L14);
  Buzz applies only `reportedIdsFor` + its own hides.
- Every create route applies `requireCanPost()` (mute/suspension → 403 `muted`/`suspended`) and `enforceRateLimit()`
  with the action key from §4.2.9. New-account restrictions (safety §3.4) are enforced inside those two helpers and
  `moderateWrite` — slices add only: polls (<24h cannot create), group chats (<24h), DM images to non-followers (<24h),
  event capacity > 50 (<7d).
- Report + (public) Block on every UGC item via `openReport()` / `openBlock()`.

### 3.2 Anonymity firewall (Buzz) — checklist

1. One serializer per Buzz entity, allow-list built field by field, in `server/src/services/buzz/serialize.ts`. Forbidden
   keys anywhere in a Buzz response: `authorId, author_id, userId, user_id, handle, name, displayName, avatar, avatarUrl,
   email, universityEmail, profile`.
2. Alias = safety §5.1 exactly (HMAC-SHA256 over `threadId + ':' + userId` with `config.buzzAliasSecret`; 64 nouns ×
   12 colours; computed at serialization; never stored; collision suffix "Anon Comet 2"). Lists live server-side.
3. `createdAt` floored to the minute; true order only inside the opaque cursor. Responses: `Cache-Control: no-store`, `Vary: Cookie`.
4. Notifications through `notifyAnonymous()` only (no actor parameter exists). ws: `{ type:'buzz.thread_updated', threadId }` only.
5. No Buzz data in Discover, Orbit, profiles, suggestions, `public_activity`, `markPublicActivity`, localStorage.
   Logout clears the query cache and all zustand stores (foundation `logout()`).
6. Ownership-dependent errors → generic 404 for non-owners. Public blocks/follows have zero effect on Buzz responses.
7. Request logger records only method + route template + status + duration for `/api/buzz/**` and `/api/admin/**/buzz/**`.
8. Analytics: Buzz events are in `ANON_ANALYTICS_EVENTS`; stored with `user_id NULL`.
9. Staff: `serializeQueueItem` emits no author fields for anon entity types for any role; only
   `POST /api/admin/buzz/:entityType/:id/unmask` returns identity (admin, reason ≥ 30, audit row inserted first).
   **The reverse direction is closed too** (§4.2.14 anon-origin rule): no staff payload that names a user (`/admin/users*`, `/admin/audit`,
   public author panels) may carry Buzz text, an anon-origin sanction/strike (moderators), counters that move when a Buzz item is actioned
   (moderators), or a `targetType:'user'` audit target tied to a Buzz queue item. The excerpt-bearing `SanctionNotice` is returned only to
   the affected user by `GET /me/sanctions`. No admin endpoint joins Buzz rows to users other than unmask.
10. Tests: safety §8.2 #1–#5 live in `server/tests/buzz.test.ts` (buzz) and `server/tests/admin.test.ts` (admin).

### 3.3 Scoped deviations from safety.md (everything else stands)

| safety.md | v1 decision |
|---|---|
| §2.8 `ModerationTarget.entityType` has `'comment'` | split into `'orbit_comment' \| 'reel_comment'`; unified as `ContentEntityType` in core.ts |
| §4.1 ban needs second admin confirm | typed `BAN` + note ≥ 30 chars; two admins are seeded so appeals `reviewer ≠ actor` is testable |
| §4.4 push/lock-screen copy, §5.2 L4 service worker | no push, no service worker in v1 |
| §5.2 L20 data export | not built; account deletion tombstones as specified |
| §6.4 `escalate_external` legal hold | stores `reference` + sets `mod_queue.legal_hold = 1`; no external integration |
| §7.5 map circle | no map |
| §7.2 vs product §2.6 (context-card messages skip Requests) | **safety wins**: first contact from a non-follower is always a request; requests carrying a context card sort first, are labelled "About your listing / roommate post", and raise a `message.request` notification |
| product §2.11 unmask (≥20 chars) | safety wins: `reasonCode` + reason ≥ 30 + typed `UNMASK`; product's 5-minute on-screen re-mask is kept |
| §2.9 AI second pass | foundation ships the interface + a minimal `fetch` classifier, inert unless `MODERATION_AI_API_KEY` is set; tests assert zero outbound requests |
| §1.1 Buzz gate "Got it" | button label "I understand" (product); gate is required before first Buzz **read** (server: `requireBuzzGate`); client presentation is the inline panel of §5.3, not a modal |

Ownership of safety work: **foundation** = engine core + baseline rule pack + PII + behavioural detectors + copy table +
`commitModeration` + queue upsert + reports endpoint + auto-hide thresholds + rate limits + sanctions enforcement +
blocks + upload sanitising + audit helper. **admin** = upgraded rule packs (full term/combo lists per category),
queue UI/API, actions, sanctions application, appeals, unmask, audit UI, metrics, Guidelines page (final copy = safety §1).
**buzz** = firewall. **messages** = §7.2–7.3. **market** = §7.4. **roommates** = §7.5. **campus** = §7.7 events rules.

---

## 4. FOUNDATION CONTRACT

Foundation owns everything in Constitution §3 marked "foundation", plus these paths (not slice names, so no clash):
`server/src/routes/core/**` (foundation endpoints), `server/src/db/seeds/index.ts`, `server/src/db/seeds/ids.ts`,
`server/src/db/reset.ts`, `server/src/types/**`, `server/seed-media/generated/**` (written at seed time),
`client/index.html`, `client/public/**`, `client/src/main.tsx`. Foundation also appends `server/data/` to `.gitignore`.

All server code reads time through `now()` from `server/src/lib/clock.ts` (never `Date.now()`), so tests can move the clock.

### 4.1 `server/src/db/schema/00-core.sql`

Conventions: every table `CREATE TABLE IF NOT EXISTS`; `id TEXT PRIMARY KEY`; `*_at INTEGER` epoch-ms; booleans
`INTEGER NOT NULL DEFAULT 0`; `*_json TEXT` holds JSON; FKs `ON DELETE CASCADE` unless noted. Slice tables MUST
reference `users(id)` / `universities(id)` with FKs and MUST NOT reference another slice's tables.

```
universities(id, name, short_name, domain UNIQUE, extra_domains_json DEFAULT '[]', country_code DEFAULT 'US',
  city NULL, is_auto_created, is_hidden, created_at)
  -- is_hidden = 1 only for the staff-bootstrap record `uni_team` ("UniVerse Team", domain 'team.universe.invalid'), created
  --   lazily by the STAFF_EMAILS path (§4.2.15). Hidden universities and their users are excluded from user search,
  --   suggestions, member counts, analytics-by-campus and every campus picker; their users see empty campus feeds and use /admin.
campus_places(id, university_id→universities, kind CHECK IN('meetup','neighborhood','venue'), name, sort INTEGER)
  -- auto-created universities get 3 generic meetup rows ("Main library lobby","Student union front desk",
  --   "Campus police safe-exchange zone") and neighborhoods ("On campus","Near campus")

users(id, email UNIQUE COLLATE NOCASE, handle UNIQUE COLLATE NOCASE, display_name, avatar_url NULL, avatar_seed,
  account_type CHECK IN('student','org') DEFAULT 'student', role CHECK IN('user','moderator','admin') DEFAULT 'user',
  status CHECK IN('active','suspended','banned','deleted') DEFAULT 'active',
  university_id→universities, bio DEFAULT '', major NULL, class_year INTEGER NULL,
  class_kind NULL CHECK IN('undergrad','grad','other'), pronouns NULL, interests_json DEFAULT '[]',
  org_category NULL, is_verified, is_adult INTEGER NULL, is_adult_edited, campus_rank INTEGER,
  invite_code UNIQUE, invited_by NULL→users ON DELETE SET NULL,
  guidelines_version NULL, guidelines_accepted_at NULL, buzz_gate_version NULL, buzz_gate_accepted_at NULL,
  profile_completed_at NULL, onboarding_completed_at NULL, settings_json DEFAULT '{}', handle_changed_at NULL,
  follower_count DEFAULT 0, following_count DEFAULT 0, post_count DEFAULT 0, reel_count DEFAULT 0,
  last_public_post_at NULL,            -- written ONLY by markPublicActivity(); Discover reads this, never slice tables
  last_active_at NULL,                 -- bucketed to 5 min; bumped uniformly by requireAuth
  restricted_until NULL,               -- "treated as new" until (72 h after a suspension ends)
  deleted_at NULL, created_at, updated_at)
  INDEX users(university_id, account_type), users(university_id, last_public_post_at DESC), users(invited_by)

sessions(id, token_hash UNIQUE, user_id→users, user_agent NULL, created_at, last_seen_at, expires_at, revoked_at NULL)
otp_codes(id, email COLLATE NOCASE, code_hash, attempts DEFAULT 0, invite_code NULL, last_sent_at, expires_at,
  consumed_at NULL, created_at)   INDEX(email, created_at DESC)
signup_tokens(id, token_hash UNIQUE, email, university_id→universities, invite_code NULL, expires_at, consumed_at NULL, created_at)
banned_emails(email_hash PRIMARY KEY, created_at)

follows(follower_id→users, followee_id→users, created_at, PRIMARY KEY(follower_id, followee_id))  INDEX(followee_id)
blocks(blocker_id→users, blocked_id→users, created_at, PRIMARY KEY(blocker_id, blocked_id))       INDEX(blocked_id)
public_activity(id, user_id→users, university_id, kind CHECK IN('reel','post','event'), entity_id, created_at,
  UNIQUE(kind, entity_id))   INDEX(user_id, created_at DESC), (university_id, created_at DESC)

uploads(id, user_id→users, kind CHECK IN('image','video'), purpose NULL, mime, url UNIQUE, size, width NULL, height NULL,
  duration_ms NULL, created_at)

conversations(id, kind CHECK IN('dm','group','course'), title NULL, avatar_url NULL, university_id NULL,
  created_by NULL→users ON DELETE SET NULL, dm_key NULL UNIQUE,        -- 'minId:maxId' for DMs
  context_kind NULL CHECK IN('listing','roommate'), context_id NULL,
  course_id NULL, course_code NULL, course_title NULL, course_term NULL,   -- denormalised by createCourseConversation; the ONLY source of CourseChatMeta
  name_locked, last_message_id NULL, last_message_at NULL, created_at, updated_at)
  INDEX(context_kind, context_id), (course_id)
conversation_members(conversation_id→conversations, user_id→users, role CHECK IN('owner','member') DEFAULT 'member',
  state CHECK IN('active','request','declined','left') DEFAULT 'active', muted, last_read_message_id NULL,
  last_read_at NULL, unread_count DEFAULT 0, joined_at, left_at NULL, PRIMARY KEY(conversation_id, user_id))
  INDEX(user_id, state)
messages(id, conversation_id→conversations, sender_id NULL→users ON DELETE SET NULL,
  kind CHECK IN('text','image','card','offer','system'), text DEFAULT '', images_json DEFAULT '[]',
  card_kind NULL, card_id NULL, offer_listing_id NULL, offer_amount INTEGER NULL,
  offer_status NULL CHECK IN('pending','accepted','declined','withdrawn'), reply_to_id NULL, client_id NULL,
  banner NULL, status DEFAULT 'active', deleted_at NULL, created_at)
  INDEX(conversation_id, created_at DESC, id)
message_reactions(message_id→messages, user_id→users, emoji, created_at, PRIMARY KEY(message_id, user_id))
message_request_cooldowns(sender_id, recipient_id, until, PRIMARY KEY(sender_id, recipient_id))

notifications(id, user_id→users, type, category, anonymous, actor_id NULL→users ON DELETE CASCADE,   -- NULL when anonymous=1 (CHECK)
  actor_count DEFAULT 1, target_type NULL, target_id NULL, href, thumbnail_url NULL, data_json DEFAULT '{}',
  collapse_key NULL, read_at NULL, created_at,
  CHECK (anonymous = 0 OR actor_id IS NULL))
  INDEX(user_id, created_at DESC), (user_id, read_at), (user_id, collapse_key)
notification_actors(notification_id→notifications, actor_id, PRIMARY KEY(notification_id, actor_id))

reports(id, reporter_id→users, entity_type, entity_id, reason, sub_reason NULL, note NULL, context_json NULL,
  university_id, eligible, weight INTEGER DEFAULT 1, status CHECK IN('open','actioned','dismissed') DEFAULT 'open',
  bad_faith, queue_id NULL, created_at, closed_at NULL, UNIQUE(reporter_id, entity_type, entity_id))
  INDEX(entity_type, entity_id), (reporter_id)
mod_queue(id, entity_type, entity_id NULL, surface, university_id, author_id NULL,   -- author_id is server-internal; NEVER serialized for anon types
  source CHECK IN('rule_flag','rule_block_escalation','ai_flag','user_report','community_score','appeal','system'),
  category NULL, severity DEFAULT 'none', priority CHECK IN('p0','p1','p2','p3'), label NULL,   -- 'wellbeing'
  status CHECK IN('open','claimed','escalated','closed') DEFAULT 'open', claimed_by NULL, claimed_at NULL,
  report_count DEFAULT 0, reporter_weight DEFAULT 0, blocked_text NULL, rule_ids_json DEFAULT '[]', ai_verdict_json NULL,
  legal_hold, reference NULL, appeal_id NULL, created_at, first_action_at NULL, closed_at NULL,
  resolution NULL CHECK IN('approved','removed','dismissed','sanctioned','escalated_external'))
  UNIQUE INDEX one_open_per_entity ON mod_queue(entity_type, entity_id) WHERE status != 'closed' AND entity_id IS NOT NULL
moderation_events(id, entity_type, entity_id NULL, surface, field, author_id, university_id, action, visibility,
  category NULL, subcode NULL, severity, rule_ids_json, matches_json, signals_json, text_hash, engine_version, created_at)
moderation_actions(id, queue_id NULL, entity_type, entity_id NULL, target_user_id NULL, actor_id, actor_role, action,
  category NULL, note NULL, batch_id NULL, sanction_id NULL, created_at)
strikes(id, user_id→users, entity_type, entity_id, category, severity, points, action_id, expires_at NULL, revoked_at NULL, created_at)
user_sanctions(id, user_id→users, kind CHECK IN('warning','mute','suspension','ban','removal'),
  scope CHECK IN('all','buzz_only','requests') DEFAULT 'all', category NULL, entity_type NULL, entity_id NULL,
  content_excerpt NULL, content_label NULL, action_id NULL, actor_id NULL, starts_at, effective_at, ends_at NULL,
  acknowledged_at NULL, lifted_at NULL, lifted_by NULL, created_at)   INDEX(user_id, kind, ends_at)
appeals(id, user_id→users, sanction_id→user_sanctions UNIQUE, text, status CHECK IN('open','upheld','reversed','reduced') DEFAULT 'open',
  reviewer_id NULL, outcome_note NULL, created_at, decided_at NULL)
audit_log(id, actor_id, actor_role, action, target_type NULL, target_id NULL, queue_id NULL, batch_id NULL,
  reason_code NULL, reason NULL, metadata_json DEFAULT '{}', created_at)
  TRIGGER audit_no_update BEFORE UPDATE → RAISE(ABORT,'audit_log is append-only'); TRIGGER audit_no_delete (same)

analytics_events(id, name, user_id NULL, anon_hash NULL, university_id NULL, session_id NULL, props_json DEFAULT '{}', created_at)
  INDEX(name, created_at), (university_id, name, created_at)
waitlist(id, feature, user_id→users, university_id, source NULL, created_at, left_at NULL, UNIQUE(feature, user_id))
rate_events(user_id, action, created_at)   INDEX(user_id, action, created_at)
recent_text_hashes(user_id, surface_group, hash, conversation_id NULL, created_at)   INDEX(user_id, surface_group, created_at)
```

### 4.2 Foundation server helpers (slices import these; never edit)

Import style: relative paths with `.ts`-less specifiers, e.g. `import { notify } from '../lib/notify'`.
`server/src/types/express.d.ts` augments `Express.Request` with `user?: AuthedUser`.

#### 4.2.1 `server/src/config.ts`
`export const config: { env: 'development'|'test'|'production'; port: number /*4000*/; dbPath: string /*DB_PATH ?? server/data/universe.db*/;
uploadsDir: string; seedMediaDir: string; buzzAliasSecret: string; cursorSecret: string; resendApiKey: string|null;
mailFrom: string; moderationAi: { apiKey: string|null; provider: string; model: string|null; timeoutMs: number };
seedScale: 'full'|'lite'; sessionTtlDays: 30; staffEmails: ReadonlyMap<string /*lower-cased email*/, 'moderator'|'admin'> }`.
Secrets: production requires env (boot fails); otherwise generated once and persisted under `server/data/` (in test: random per process).
`STAFF_EMAILS` = comma-separated `email:role` pairs (`dana@company.com:admin,sam@company.com:moderator`); malformed entries fail boot.
Production boot additionally logs `log.error` (does not exit) when **no `admin` user exists and `staffEmails` is empty** ("Buzz is
unmonitored: set STAFF_EMAILS") and when `mailProviderConfigured()` is false ("sign-up is disabled: set RESEND_API_KEY").

#### 4.2.2 `server/src/db/index.ts`
- `export const db: BetterSqlite3.Database` (WAL unless `:memory:`, `foreign_keys = ON`). **`db/index.ts` runs `migrate()`
  synchronously at module load, before `db` is exported**, so every importer (routers, libs, tests) always sees the tables —
  ESM evaluates statically imported routers before `index.ts`/`createTestApp` bodies run, so migrating later is too late.
- `migrate(opts?: { only?: string[] /* file stems, e.g. ['00-core','03-buzz'] */; tolerant?: boolean }): void` — executes
  `schema/*.sql` in filename order (idempotent), then runs the `onDbReady` callbacks. `00-core.sql` errors always throw. With
  `tolerant` (the module-load call uses `tolerant: config.env === 'test'`), a failing **slice** file is logged and skipped so one
  slice's SQL typo cannot break another slice's tests; outside tests every error throws.
- `onDbReady(fn: () => void): () => void` — runs `fn` immediately (tables exist) **and again after every `migrate()` /
  `resetDb()`**; returns an unregister function; each call is wrapped in try/catch + `log.error` (a hook never aborts boot).
  This is the ONLY sanctioned way for a slice to touch the DB at import time (R4), e.g. admin re-applying `admin_rule_pack_state`.
- `runSeeds(names?: string[]): Promise<void>` — `seeds/index.ts` is a registry of `{ name, load: () => import('./NN-<slice>') }`
  (**dynamic imports**, so a half-written seed in one slice cannot break another slice's tests); runs the named seeds (default
  all) in NN order, one transaction per seed.
- `resetDb(opts?: { only?: string[] }): void` — drops every table/trigger, then `migrate(opts)` (used by tests and `db:reset`).
- `tx<T>(fn: () => T): T` · `newId(): Id` (`nanoid(14)`) · `json<T>(s: string|null, fallback: T): T`
- `inClause(ids: readonly string[]): { sql: string; params: string[] }` → `'(?,?,?)'` (returns `(NULL)` for empty).
- `server/src/lib/clock.ts`: `now(): EpochMs`, `setNow(ms: EpochMs|null): void` (tests only), `MIN=60_000, HOUR, DAY`.
- Boot (`index.ts`): tables already exist (module-load `migrate()`); when `users` is empty and env ≠ production →
  `await runSeeds()`; production checks of §4.2.1; then listen + attach ws. Seeds never run in production — the first staff
  accounts come from `STAFF_EMAILS` (§4.2.15).

#### 4.2.3 `server/src/lib/http.ts`
- `class ApiError extends Error { constructor(status: number, code: ApiErrorCode|string, message: string, details?: unknown) }`
  plus `ApiError.notFound(msg?)`, `.forbidden(msg?)`, `.badRequest(msg, details?)`, `.conflict(msg)`.
- `asyncHandler(fn: (req, res, next) => unknown|Promise<unknown>): RequestHandler`
- `validate<T extends { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }>(schemas: T): RequestHandler` — parses and
  **replaces** `req.body/query/params` with parsed values; failure → 400 `validation_failed`, `details = zodError.flatten()`.
  Companion `typed<B = unknown, Q = unknown, P = unknown>(req): { body: B; query: Q; params: P }`.
- `pageQuery` zod: `{ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }`.
- `encodeCursor(v: { k: number|string; id: Id }): Cursor` / `decodeCursor(c?: string): { k: number|string; id: Id } | null`
  (HMAC-tagged with `config.cursorSecret`; bad tag → `ApiError(400,'invalid_cursor','Invalid cursor')`).
- `paginate<Row, T>(rows: Row[], limit: number, key: (r: Row) => { k: number|string; id: Id }, map: (r: Row) => T): Paginated<T>` —
  caller fetches `limit + 1` rows. Keyset SQL fragment helper: `keysetWhere(col: string, idCol: string, cur, dir: 'desc'|'asc'): { sql; params }`.
- `errorMiddleware`, `notFoundMiddleware` (JSON `ApiErrorBody`; unknown errors → 500 `internal`, no stack/rows in body or logs).
- `noStore(res)` sets `Cache-Control: no-store` + `Vary: Cookie`.

#### 4.2.4 `server/src/lib/graph.ts` — follows, blocks, viewer filters
- `isFollowing(a: Id, b: Id): boolean` · `followerIdsOf(userId): Id[]` · `followingIdsOf(userId): Id[]` · `mutualsBetween(viewerId, userId, limit = 3): { count: number; sample: Id[] }`
- `followUser(viewer: AuthedUser, targetId): FollowResult` / `unfollowUser(...)` — rate limit `follow`, block check (404),
  counters, `notify('follow.new')`, `trackEvent`. (Used by foundation routes; exported for seeds/tests.)
- `isBlockedBetween(a: Id, b: Id): boolean` (either direction) · `blockedIdsFor(userId): Set<Id>` (both directions; cached per request via `req`-less LRU 5 s)
- `sqlNotBlocked(viewerId: Id, authorCol: string): { sql: string; params: Id[] }` →
  `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = ${authorCol}) OR (b.blocker_id = ${authorCol} AND b.blocked_id = ?))`.
  **Every public list/detail query MUST AND this in. Buzz MUST NOT.**
- `sqlAuthorVisible(authorCol: string): string` → `EXISTS (SELECT 1 FROM users u WHERE u.id = ${authorCol} AND u.status = 'active')` (hides suspended/banned/deleted authors; public surfaces MUST AND this in; Buzz MUST NOT — L16).
- `reportedIdsFor(userId: Id, entityType: ContentEntityType): Set<Id>` and `sqlNotReported(viewerId, entityType, idCol): { sql; params }`.
- `blockUser(viewer, targetId): BlockResult` / `unblockUser` — deletes both follow edges, deletes notifications from target, max `LIMITS.maxBlocks`, rate limit `block`.
- `assertVisibleUser(viewerId: Id|null, targetId: Id): UserRow` — throws the generic 404 ("This account isn't available") for missing / non-active / blocked-me targets.

#### 4.2.5 `server/src/middleware/auth.ts`, `server/src/lib/users.ts`
- `interface AuthedUser { id; email; handle; displayName; avatarUrl: string; role: Role; accountType: AccountType; status: UserStatus;
  universityId: Id; universityShortName: string; countryCode: string; isAdult: boolean|null; createdAt: EpochMs; accountAgeMs: number;
  isNewAccount: boolean /*<72h or restricted_until>now*/; activeStrikePoints: number; onboardingCompleted: boolean }`
- `requireAuth`: 401 `unauthenticated`; `suspended|banned` sessions → 403 (`suspended`/`banned` + details) on everything except
  `GET /api/me`, `GET /api/me/sanctions`, `POST /api/me/sanctions/:id/ack`, `POST /api/appeals`, `POST /api/auth/logout`.
  Bumps `last_active_at` (5-min bucket) uniformly.
- `requireOnboarded`: 403 `onboarding_required` until `profile_completed_at` and app guidelines (current `GUIDELINES_VERSION`) are set. Applied by
  `routes/index.ts` to **every slice router** (auth slice's router gets only `requireAuth`). Slices never add either middleware themselves.
- `optionalAuth` (only `/api/invites/:code`, `/api/auth/*`, `POST /api/analytics/track`).
- `requireRole(...roles: Role[])`: non-staff → **404 `not_found`** (not 403).
- `requireBuzzGate`: 403 `buzz_gate_required` unless `users.buzz_gate_version === GUIDELINES_VERSION` (buzz slice applies it to its whole router).
- `lib/users.ts`: `getUserRow(id): UserRow|null` · `getUserByHandle(handle)` ·
  `toUserSummary(row: UserRow): UserSummary` · `userSummariesByIds(ids: Id[]): Map<Id, UserSummary>` (tombstones deleted users as
  `{ handle:'deleted', displayName:'Deleted account' }`) · `toUserListItem(row, viewerId)` · `userListItemsByIds(ids, viewerId): UserListItem[]` (order preserved, blocked/non-active removed) ·
  `toPublicUser(row, viewerId: Id|null): PublicUser` · `toMeUser(row): MeUser` · `avatarUrlFor(row)` (`avatar_url ?? /api/avatars/<seed>.svg?t=<student|org>`) ·
  `universityRef(id): UniversityRef` · `getUniversity(id): University`.
- **`markPublicActivity(userId: Id, kind: PublicActivityKind, entityId: Id, at: EpochMs = now()): void`** — upserts `public_activity`,
  sets `users.last_public_post_at = MAX(old, at)`, increments `post_count` (`post`) / `reel_count` (`reel`). Call ONLY when the row is `active`.
  **`unmarkPublicActivity(kind: PublicActivityKind, entityId: Id): void`** — delete/removal/hide: removes the row, decrements the counter,
  recomputes `last_public_post_at`. Callers: `reels` (reel), `orbit` (post), `campus` (event). **Buzz MUST NEVER call either.**
- `publicActivityStats(userIds: Id[], sinceMs: EpochMs): Map<Id, { reels: number; posts: number; events: number }>` (Discover/auth reason lines).

#### 4.2.6 `server/src/lib/moderation/index.ts` (engine in `lib/moderation/**`; safety §2 binding)
- `moderateText(text: string, ctx: ModerationContext): ModerationResult` — pure, sync, never throws (fail-closed hold).
- `moderateWrite(fields: { text: string|null|undefined; field?: ModerationContext['field'] }[], ctx: Omit<ModerationContext,'field'|'recentHashes'>, blockedTarget: Omit<ModerationTarget,'entityId'>): ModerationResult`
  — skips empty fields, loads/records `recent_text_hashes`, merges strictest, on block: `commitModeration` (if escalate) then
  throws `ApiError(422,'content_blocked', userMessage.body, ContentBlockedDetails)`.
- `interface ModerationTarget { entityType: ContentEntityType; entityId: Id|null; authorId: Id; universityId: Id; blockedText?: string }`
- `commitModeration(result: ModerationResult, target: ModerationTarget): void` — events + queue upsert (+ second pass enqueue).
- `toAuthorNotice(result: ModerationResult): AuthorNotice` · `NO_NOTICE: AuthorNotice` (`{status:'active',userMessage:null,support:null}`) for writes without text.
- `modCtx(user: AuthedUser, surface: ModerationSurface, extra?: { isMessageRequest?: boolean }): Omit<ModerationContext,'field'|'recentHashes'>`
- `blockedTarget(user: AuthedUser, entityType: ContentEntityType): Omit<ModerationTarget,'entityId'>`
- `enqueueSystemFlag(input: { entityType; entityId: Id; authorId: Id; universityId: Id; surface: ModerationSurface; source: 'community_score'|'system'; priority: ModerationPriority; category?: ModerationCategory|null }): void`
  (Buzz score auto-hide, Market/Roommates low-price flag).
- `registerRulePack(pack: RulePack): void`, `listRulePacks(): { id; version; ruleCount; enabled }[]`, `setRulePackEnabled(id, enabled): void`;
  types `RulePack`, `ModerationRule` exported from `lib/moderation/types.ts`. Foundation ships pack `baseline` (every category has ≥ 1 working
  rule so safety §8.2 #6–#7 pass without admin); admin registers `admin.<category>` packs.
- `getSecondPassClassifier(): SecondPassClassifier|null`; `setSecondPassClassifier(c|null)` (tests).
- `supportResourcesFor(countryCode): SupportResources`.

#### 4.2.7 `server/src/lib/notify.ts`
```ts
interface NotifyInput { userId: Id; type: PublicNotificationType; actorId: Id | null; href: string;
  target?: NotificationTargetRef | null; thumbnailUrl?: string | null; data?: NotificationData;
  collapse?: boolean /* default true for *.like, follow.new=false */; createdAt?: EpochMs /* seeds */; read?: boolean /* seeds */;
  actorIds?: Id[] /* SEED-ONLY (ignored unless called through SeedKit): writes ONE row with these distinct actors into
                     notification_actors, actor_count = actorIds.length, actor_id = last entry; works with read:true */ }
export function notify(input: NotifyInput): void;
interface NotifyAnonymousInput { userId: Id; type: AnonymousNotificationType; threadId: Id; href: string;
  data?: NotificationData /* validated: values only string|number|boolean|null, keys ∉ forbidden list */;
  createdAt?: EpochMs; read?: boolean }
export function notifyAnonymous(input: NotifyAnonymousInput): void;      // NO actor parameter exists
export function removeNotificationsFor(target: NotificationTargetRef): void;   // content deleted/removed
export function registerNotificationHook(name: string, fn: (userId: Id) => void): () => void;  // run (try/catch) before list + badges; last-write-wins by name
export function badgesFor(userId: Id): Badges;
export function serializeNotification(row): Notification;   // fills PublicNotification.actorFollowedByViewer = isFollowing(row.user_id, row.actor_id) (false when actor is null)
```
`notify` rules: no-op when `actorId === userId`, when `isBlockedBetween`, when the recipient is not `active`, or when the
recipient's category toggle is off (`safety` is always on). Collapse: same `(user, type, target)` unread row within 60 min →
update `actor_id`, `actor_count` (distinct via `notification_actors`), `data_json`, `created_at`. `buzz.milestone`: max one per
thread per day. After insert/update → `publishToUser(userId, { type:'notification', notification, badges })` (suppressed inside
quiet hours: only `{ type:'badges' }` is sent). Lazy generators registered through `registerNotificationHook`:
campus (event reminders), roommates (`roommate.still_looking`), buzz (`buzz.poll_closed`).

#### 4.2.8 `server/src/lib/realtime.ts`
`attachRealtime(server: http.Server): void` (path `WS_PATH`, cookie auth, 30 s heartbeat) ·
`publishToUser(userId: Id, e: WsServerEvent): void` · `publishToUsers(ids: Id[], e): void` ·
`publishToConversation(conversationId: Id, e: WsServerEvent, opts?: { exceptUserId?: Id; onlyStates?: MemberState[] /*default ['active']*/ }): void` ·
`isOnline(userId): boolean` · `revokeUserSockets(userId, reason)`.
Foundation handles client events itself: `typing.set` (relayed to active members, never in unaccepted requests, never across a block),
`conversation.focus`, `presence.subscribe` (answers only for accepted-DM partners with `showPresence`; `lastActiveAt` bucketed 5 min), `ping`.
Buzz may publish only `{ type:'buzz.thread_updated', threadId }` (to participants of the thread + nobody else).

#### 4.2.9 `server/src/lib/rateLimit.ts`, `server/src/lib/sanctions.ts`
- `type RateAction = 'buzz_post'|'buzz_reply'|'buzz_vote'|'orbit_post'|'comment'|'reel_upload'|'message_send'|'message_request'|'group_create'|'listing_create'|'roommate_edit'|'event_create'|'course_create'|'follow'|'report'|'block'|'search'|'profile_edit'|'upload'|'unmask'`
- `enforceRateLimit(user: AuthedUser, action: RateAction): void` — sliding windows from safety §3.3 (new-account column when
  `user.isNewAccount`; org ×2 for `orbit_post`,`event_create`); throws 429 `rate_limited` + `RateLimitedDetails`; records a `rate_events` row.
  Disabled when `config.env === 'test'` unless `process.env.RATE_LIMITS === 'on'`.
- `enforceActiveCap(user, kind: 'listing', currentActive: number): void` (30 / 5 new).
- `requireCanPost(scope: 'public'|'buzz'|'message_request' = 'public'): RequestHandler` — active mute (scope match) → 403 `muted` + `MutedDetails`;
  unacknowledged warning → 403 `forbidden` with `details.warningId`. Apply on **every create/edit route** of buzzes, replies, posts,
  comments, reels, listings, roommate profile, events, polls, group chats, course create. Not on votes/likes/saves/RSVP/reports/blocks/replies in accepted DMs.
- `assertAccountAge(user, minMs, message): void` (polls / groups / DM images to non-followers < 24 h; event capacity > 50 < 7 d).
- `lib/sanctions.ts`: `activeSanctionFor(userId): ActiveSanction|null` · `sanctionNoticesFor(userId): SanctionNotice[]` ·
  `activeStrikePoints(userId): number` · `suggestSanction(points: number, hasPriorWarning: boolean): { kind: SanctionKind|'removal'; durationMs: number|null }`.

#### 4.2.10 `server/src/lib/content.ts` — content registry + card resolvers (the cross-slice seam)
```ts
export interface ContentSnapshot {
  entityType: ContentEntityType; entityId: Id; authorId: Id; universityId: Id; status: ContentStatus;
  surface: ModerationSurface; anon: boolean; autoHideImmune: boolean; createdAt: EpochMs;
  label: string;                                  // "reel" | "buzz" | "reply" | "post" | "comment" | "listing" | "roommate post" | "event" …
  fields: { field: string; text: string }[];      // original text per field
  media: { url: string; kind: 'image' | 'video' }[];
  href: string | null;                            // in-app route
  parent: { entityType: ContentEntityType; entityId: Id } | null;
}
export interface ContentAdapter {
  entityType: ContentEntityType;
  load(id: Id): ContentSnapshot | null;                                   // any status
  setStatus(id: Id, status: Extract<ContentStatus,'active'|'hidden'|'removed'>, opts?: { immune?: boolean }): void;
      // MUST keep counters + public_activity consistent (unmark on hidden/removed, mark on active) and removeNotificationsFor on removed
  staffContext?(id: Id): unknown;                 // anon types: built ONLY with the blind Buzz serializer
  setLocked?(id: Id, locked: boolean): void;      // buzz root only
}
export function registerContentAdapter(a: ContentAdapter): () => void;    // at router import time (R4)
export function getContentAdapter(t: ContentEntityType): ContentAdapter | null;
export type CardResolver = (id: Id, viewerId: Id) => Omit<ShareCard,'kind'|'id'|'currency'> | null;   // null → unavailable; resolveCard fills `currency` from the owner's (else viewer's) university
export function registerCardResolver(kind: ShareCardKind, fn: CardResolver): () => void;
export function resolveCard(ref: ShareCardRef, viewerId: Id): ShareCard;  // never throws; missing/blocked → status 'unavailable', title 'No longer available'
export function registerUserLifecycleHook(name: string, h: { onBanned?(userId: Id): void; onDeleted?(userId: Id): void }): () => void;
```
**Registry semantics (all registries: content adapters, card resolvers, notification hooks, lifecycle hooks, rule packs):**
keyed by `entityType` / `kind` / `name` / pack `id`; **last write wins; registering never throws**; every `register*` returns an
`unregister()` that restores the previous entry (tests use it to install and remove stubs — e.g. the `listing` resolver stub of
§5.6 keeps working after market's real resolver lands, because the stub is registered later and restored in `afterEach`).
Owners: see `ENTITY_OWNER` (core.ts). Card resolvers: `listing`→market · `roommate`→roommates · `reel`→reels · `post`→orbit ·
`event`,`course`→campus · `buzz`→buzz (text snippet + "Buzz · {shortName}", `ownerId:null`, `imageUrl:null`) · `profile`→foundation.
Resolvers MUST apply block + status rules for `viewerId` (Buzz: status only).

#### 4.2.11 `server/src/lib/conversations.ts` — the only writer of conversation/message tables
```ts
openDm(viewer: AuthedUser, peerId: Id, context?: ContextCardRef): OpenDmResponse
  // finds/creates by dm_key. New + peer does NOT follow viewer → peer member state 'request' (safety §7.2), rate limit 'message_request',
  // requireCanPost('message_request'). Throws 403 'cannot_message' ("You can't message this account.") for: block either way, peer not active,
  // whoCanMessage violation, minor cross-campus rule, active cooldown, self. context is validated through resolveCard (must be 'available'
  // and owned by peer) and (re)pinned on the conversation.
createGroup(creator: AuthedUser, input: { title?: string|null; memberIds: Id[] }): Id      // non-followers of creator join as 'request'; >10 members → everyone 'request'
createCourseConversation(input: { universityId: Id; courseId: Id; code: string /* normalised, "CS 314" */; title: string /* course name */;
  term: string; createdBy: Id|null }): Id
  // kind 'course', name_locked=1; stores course_id/course_code/course_title/course_term; conversations.title = code.
  // serializeConversation builds CourseChatMeta { courseId, code, title, term } from those columns ONLY (foundation never reads
  // campus' `courses` table) and sets ConversationSummary.title = code.
addMember(conversationId: Id, userId: Id, opts?: { state?: MemberState; role?: 'owner'|'member'; joinedAt?: EpochMs;
  addedBy?: Id; silent?: boolean }): void
  // idempotent; revives 'left'. notify('message.group_added', actorId: addedBy) fires ONLY when addedBy is set, addedBy !== userId
  // and silent is not set. The messages route POST /:id/members passes addedBy: req.user.id; createGroup passes the creator;
  // campus course join/create omit it (self-join → no notification). Publishes ws 'conversation.updated' unless silent.
removeMember(conversationId: Id, userId: Id): void                                          // state 'left'
getMembership(conversationId: Id, userId: Id): { state: MemberState; role: string; muted: boolean } | null
assertMember(conversationId: Id, userId: Id, states?: MemberState[]): void                  // else 404
interface SendInput { conversationId: Id; sender: AuthedUser | null /* null = system */; kind: MessageKind; text?: string; images?: MediaImage[];
  card?: ShareCardRef; offer?: { listingId: Id; amount: number }; replyToId?: Id; clientId?: string; banner?: RecipientBanner | null;
  status?: 'active'|'held'; createdAt?: EpochMs /* seeds */; silent?: boolean /* seeds: no ws/notifications */ }
sendMessage(input: SendInput): Message
  // enforces: membership, DM block → 403 cannot_message, one-message-until-accepted, images withheld flag, unread counters,
  // last_message_*, ws 'message.new' per recipient (serialized per viewer), 'badges', notify('message.request') on the first
  // message of a request. Does NOT moderate: the calling ROUTE runs moderateWrite first (surface 'message'|'group_message').
  // Request cap details (buyers and sellers are usually strangers, so this is the DOMINANT market path):
  //  · the cap counts the requester's text/image/card messages only → the 2nd one throws 403 'forbidden' with
  //    details { reason: 'request_pending' } ("Wait for {firstName} to accept your request.");
  //  · kind 'offer' is EXEMPT from the cap, but at most ONE pending offer may exist per conversation
  //    (a second → 409 'conflict' "You already have a pending offer."); withdraw first to change it;
  //  · a message sent by the member whose state is 'request' (the recipient replying) implicitly calls acceptRequest first.
sendSystemMessage(conversationId: Id, text: string, createdAt?: EpochMs): Message
acceptRequest(conversationId, user: AuthedUser): void      // state → 'active'; notify('message.request_accepted'); ws 'conversation.updated' to both
declineRequest(conversationId, user: AuthedUser): void     // state → 'declined'; DM: 30-day cooldown row
markRead(conversationId, userId, messageId): void          // ws 'read' only when conversation accepted + no block
setReaction(messageId, userId, emoji: MessageReactionEmoji|null): Message   // publishes ws 'message.updated'
deleteMessage(messageId, user: AuthedUser): Message        // own only; status 'deleted', text ''; publishes ws 'message.deleted'
setOfferStatus(messageId: Id, actor: AuthedUser, action: 'accept'|'decline'|'withdraw'): Message
  // accept/decline: only the listing owner (resolveCard(listing).ownerId); withdraw: only sender. Posts a system line,
  // notify('market.offer_accepted'|'market.offer_declined') to the buyer, publishes ws 'message.updated'.
  // 'accept' while the owner's member state is 'request' implicitly calls acceptRequest (the chat moves to Chats for both);
  // 'decline' leaves the request state untouched.
updateConversation(conversationId, user, patch: { title?: string; muted?: boolean }): void   // title: groups only, !name_locked, caller moderates; publishes 'conversation.updated'
touchContext(kind: ContextCardKind, id: Id): void
  // publishes ws { type:'conversation.updated', conversationId } to the ACTIVE + REQUEST members of every conversation whose
  // context is (kind,id), so the pinned live card re-resolves. Callers: market (sold / returned / relist / price change / edit /
  // delete / status change), roommates (pause / resume / unpublish / delete / status change). Never throws.
listConversations(userId: Id, tab: 'chats'|'requests', page: { cursor?: string; limit: number }): Paginated<ConversationSummary>
  // chats: state 'active' AND last_message_at NOT NULL (or created_by = me); DMs blocked by me are hidden; requests with context sort first
serializeConversation(conversationId: Id, viewerId: Id): ConversationSummary
serializeMessage(row: MessageRow, viewerId: Id): Message
listMessages(conversationId, viewerId, page): Paginated<Message>          // newest first
listMembers(conversationId, viewerId): (UserListItem & { role: 'owner'|'member'; lastReadMessageId: Id|null })[]
conversationCountForContext(kind: ContextCardKind, id: Id): number        // market "chats" stat
```
Foundation registers the `message` and `conversation` ContentAdapters (report window = reported message + ≤ 10 preceding, only when `includeContext`).

#### 4.2.12 `server/src/lib/uploads.ts`
`handleUpload(req): Promise<UploadResult>` (used by the route) · `getUpload(id: Id): UploadRow|null` ·
`assertOwnUpload(user: AuthedUser, uploadIdOrUrl: string, kind: 'image'|'video'): UploadRow` (404 otherwise) ·
`assertOwnImages(user, images: MediaImage[], max: number): MediaImage[]` (every `url` must be an `/uploads/` row owned by the user, or a `/seed-media/` url; returns normalised list) ·
`probeVideoDurationMs(filePath: string, mime: UploadMime): number|null` — **file-based** box walk (reads box headers with `fs.readSync`,
never the whole file; phone recordings put `moov` at the END): MP4 **and QuickTime** `moov/mvhd` (same parser), WebM `Duration`.
Sanitising per safety §7.6. Limits: `LIMITS.imageMaxBytes`, `LIMITS.videoMaxBytes` (150 MB — a native 60 s 1080p phone clip).
Storage: multer **disk** storage for `kind:'video'` (temp file under `uploadsDir/tmp`, renamed on success, unlinked on failure),
memory storage for images. Accepted video types: `video/mp4`, `video/quicktime` (iOS `.mov`; magic `ftyp` brand `qt  `), `video/webm`.
QuickTime uploads are stored as `.mp4` and served as `video/mp4` (`UploadResult.mime = 'video/mp4'`; no transcoding exists — a codec the
browser cannot play falls back to the poster player, §5.2).
Video rule — **one tolerance everywhere**: `maxMs = LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs` (60 000 + 500).
`duration = probe ?? clientDurationMs`; missing both → 400; `duration > maxMs` → 422 `validation_failed` "Reels max out at 60 seconds.";
`uploads.duration_ms = min(duration, LIMITS.reelMaxDurationMs)`. The client pre-check and `POST /reels` use the same `maxMs`.

#### 4.2.13 `server/src/lib/analytics.ts`
`trackEvent(name: AnalyticsEventName, ctx: { userId: Id|null; universityId: Id|null; sessionId?: string|null }, props?: AnalyticsProps, at?: EpochMs): void`
— for `ANON_ANALYTICS_EVENTS`: `user_id = NULL`, `anon_hash = HMAC(dailySalt,userId)`, time floored to the minute, props keys matching `/id$/i` dropped.
Never throws. Slices call it on server-side conversions (create/like/RSVP/…); the client `track()` covers views and taps.

#### 4.2.14 `server/src/lib/audit.ts`, `server/src/lib/moderation/staff.ts` (admin slice's write path to core tables)
- `audit(input: { actor: AuthedUser | 'system'; action: string; targetType?: string; targetId?: Id; queueId?: Id; batchId?: Id; reasonCode?: string; reason?: string; metadata?: Record<string, unknown> }): Id`
- `staff.ts` exports `interface StaffQueueItemCore` — **exactly** the fields of `StaffQueueItem` (§5.11) and nothing else:
  `{ id; entityType; entityId; surface; anon; universityShortName; source; category; severity; priority; label; status; resolution;
  reportCount; excerpt /* ≤ 140 chars from adapter.load().fields, or blocked_text, else '' */; contentStatus /* adapter.load()?.status ?? null */;
  claimedByMe; claimedByOther; slaDueAt; createdAt; closedAt }`. It has **no author, reporter, `authorId`, `targetUserId` or user field of
  any kind**, for any entity type (public authors are shown only through `StaffAuthorPanel` in the detail). Foundation fills every
  field (it owns the content registry); admin adds nothing and declares `StaffQueueItem` structurally identical in `shared/src/admin.ts`
  (foundation cannot import that file) — admin's test file holds a compile-time assignability check in both directions.
- `staff.ts`:
  `serializeQueueItem(row, viewer: AuthedUser): StaffQueueItemCore` — **no author fields for `ANON_ENTITY_TYPES` for any role** ·
  `blindAuthorStanding(authorId: Id): { accountAge: '<24h'|'<7d'|'<30d'|'30d+'; strikePoints: '0'|'1'|'2'|'3-5'|'6+'; priorByCategory: Record<string,string>; sanction: SanctionKind|null; otherOpenItems: '0'|'1'|'2'|'3-5'|'6+' }` ·
  `queueVisibleTo(staff: AuthedUser): { sql; params }` (conflict-of-interest + legal-hold filter) ·
  `claimQueueItem(id, staff)`, `releaseQueueItem(id, staff)` (10-min lease) ·
  `applyContentStatus(entityType, entityId, status, opts: { immune?: boolean }): void` (adapter + author notification `mod.content_*`) ·
  `closeReportsFor(entityType, entityId, outcome: 'actioned'|'dismissed', opts?: { badFaith?: boolean }): void` (reporter `mod.report_resolved` notices + trust) ·
  `addStrike(input: { userId; entityType; entityId; category; severity; actionId }): number /*active points*/` · `revokeStrikesFor(entityType, entityId)` ·
  `applySanction(input: { userId: Id; kind: SanctionKind; durationMs?: number; scope?: SanctionScope; category: ModerationCategory|null; entity?: { entityType; entityId }; actor: AuthedUser|'system'; actionId?: Id; delayed?: boolean }): Id`
  (session revocation, `banned_emails`, lifecycle hooks, ws `session.revoked`, user notice, random 5–30 min `effective_at` for Buzz non-P0) ·
  `liftSanction(id, actor)` · `recordAction(input): Id` (writes `moderation_actions` + `audit` in the caller's transaction) ·
  `reporterTrust(userId): 'high'|'normal'|'low'` · `resolveAuthorId(entityType, entityId): Id|null` (server-internal; MUST NOT be serialized outside the unmask endpoint) ·
  `staffStandingFor(userId: Id, viewerRole: Role): { strikePoints: number; openQueueItems: number; sanctions: StaffSanctionRowCore[] }` and
  `serializeAuditRow(row, viewer: AuthedUser): AuditRowCore` — the two firewall-critical staff serializers below.

**Anon-origin rule (the named-account side of the firewall; Constitution §5.1/§5.5, safety L10/L21).** A sanction, strike, queue item,
moderation action or audit row is *anon-origin* when its `entity_type ∈ ANON_ENTITY_TYPES` (or its `queue_id` points at such an item).
Any payload that names a user MUST NOT let staff connect that user to Buzz content except through the unmask endpoint:
1. `StaffSanctionRowCore` = `SanctionNotice` **without `contentExcerpt` / `contentLabel`**, plus `origin: 'public' | 'anon'`. The user-facing
   `SanctionNotice` (with the excerpt) is returned ONLY by `GET /me/sanctions` to the affected user. Staff payloads never reuse it.
2. `staffStandingFor(userId, role)`: for `role !== 'admin'`, anon-origin sanctions and strikes are **omitted entirely** and excluded from
   `strikePoints` and `openQueueItems` (so a moderator cannot diff the numbers before/after acting on a Buzz item). For `admin` they are
   included with `origin:'anon'` and `startsAt` / `createdAt` / `until` floored to the UTC day. (Enforcement itself always uses the true totals.)
3. `recordAction` / `applySanction` / `addStrike` on an anon-origin queue item write `audit_log` and `moderation_actions` with the **entity**
   as the target (`target_type = entityType`, `target_id = entityId`); `moderation_actions.target_user_id` is filled for enforcement but is
   **server-internal** and never serialized for anon-origin rows. No `target_type:'user'` audit row is written for them.
4. `serializeAuditRow`: for any row with `target_type = 'user'` whose `queue_id` is an anon-origin item (legacy/seeded rows), `targetId` is
   `null` — unless the viewer is `admin` **and** `action = 'buzz_unmask'`. `metadata` is stripped for moderators on `buzz_unmask`.
5. Blind standing on anon queue items stays bucketed (`blindAuthorStanding`), for every role.

#### 4.2.15 Other foundation libs
- `lib/mailer.ts`: `interface Mailer { send(to, subject, text): Promise<void> }`, `getMailer()`, `mailProviderConfigured(): boolean`.
  **Production without a provider:** the console transport MUST NOT be used; `POST /auth/start` returns **503 `mail_unavailable`**
  ("We can't send sign-in codes right now. Please try again soon.") and boot logs the error of §4.2.1. (`devCode` is never returned in production.)
- `lib/universities.ts`: `lookupDomain(emailOrDomain: string): DomainLookupResponse`, `resolveUniversityForEmail(email): { university: UniversityRow; isNew: boolean }` (auto-creates), bundled dataset `lib/data/universities.ts` (≥ 150 rows incl. all §7 campuses), `personalDomains.ts`, `disposableDomains.ts`, `academicAllowList.ts`.
  `currencyFor(countryCode): string` (from `CURRENCY_BY_COUNTRY` / `DEFAULT_CURRENCY`, core.ts) fills `University.currency`, `MeUser.currency`, `ShareCard.currency`, `MessageOffer.currency`.
- **Staff bootstrap (`STAFF_EMAILS`, §4.2.1)** — how "monitored by the developers" works on a production DB where seeds never run:
  an **exact** address in `config.staffEmails` bypasses the academic-domain check in `lookupDomain` / `POST /auth/start` (status `known`)
  but goes through the **normal OTP**; if its domain is not an academic one it attaches to the hidden university `uni_team`
  (created lazily, `is_hidden = 1`; an academic address keeps its real campus). At `/auth/complete` **and** on every `/auth/verify`
  sign-in, `users.role` is raised to the mapped role when lower, with `audit({ actor:'system', action:'role_bootstrap', targetType:'user', targetId, metadata:{ role } })`.
  Removing an address from the env never demotes (use `POST /admin/users/:id/role`). Nothing else about the gate changes: every other
  address still needs an academic domain (Constitution §6). *Fallback if the orchestrator rules the domain bypass out:* keep the role
  bootstrap, drop the bypass + `uni_team` (staff then need an academic address); no other section changes.
- `lib/waitlist.ts`: `joinWaitlist(userId: Id, feature: WaitlistFeature, opts?: { source?: string; at?: EpochMs }): void` (idempotent; re-join clears `left_at`) ·
  `leaveWaitlist(userId, feature, at?: EpochMs): void` · `waitlistStateFor(userId, feature): WaitlistState`. Used by routes #34–#35 and `kit.waitlist` — the only writers of `waitlist`.
- `lib/avatars.ts`: `renderAvatarSvg(seed: string, type: AccountType): string` (DiceBear `notionists` / `shapes`, tinted backgrounds of design §8.2).
- `lib/seedArt.ts`: `nebulaSvg(o: { seed: string; title?: string; aspect: '9:16'|'4:5'|'1:1'|'16:9'; glyph?: string }): string` ·
  `productTileSvg(o: { category: string; variant: number }): string` · `eventCoverSvg(preset: EventCoverPreset): string` ·
  `writeSeedSvg(relPath: string, svg: string): string` (writes under `server/seed-media/generated/`, returns `/seed-media/generated/<relPath>`) ·
  `EVENT_COVER_PRESETS = ['academic','social','sports','career','arts','food','music','outdoors'] as const`; the 8 preset covers are also
  pre-generated at boot as `/seed-media/generated/event-covers/<preset>.svg`.
- `lib/courseCode.ts`: `normalizeCourseCode(input: string): string | null` — trim, uppercase, collapse whitespace, insert one space between the
  department letters and the number (`"cs314"` → `"CS 314"`, `"bio 311c"` → `"BIO 311C"`, `"E E 302"` stays); must match `/^[A-Z]( ?[A-Z]){0,4} \d{2,4}[A-Z]?$/` else `null`.
  Used by `campus` (courses) and `market` (listing `courseCode`) so deep links match. Client twin: `normalizeCourseCode` in `lib/format.ts`.
- `lib/handles.ts`: `validateHandle(h): 'ok'|'invalid'|'reserved'`, `suggestHandles(base: string, n = 3): string[]`, `RESERVED_HANDLES`.
- `lib/logger.ts`: `log.info/warn/error`; request logger obeys §3.2 #7.

#### 4.2.16 `server/src/lib/testing.ts` (the only test harness; slices MUST use it)
```ts
createTestApp(opts?: {
  slices?: string[];   // ISOLATION MODE (slice tests MUST pass their own name: { slices: ['market'] }). Mounts the core routers plus ONLY the
                       // named slice routers, loaded with dynamic import() through routes/mounts.ts; resetDb({ only: ['00-core', ...their schemas] });
                       // another slice's half-written router, schema or seed can never break this test run.
                       // Omitted → FULL MODE: imports the static routes/index.ts + every schema (orchestrator integration + tests/core/integration*).
  seed?: 'none' | 'core' | 'all' | string[] /* seed names, core implied */;   // DEFAULT 'core'. In isolation mode 'all' = core + the named slices' seeds.
}): Promise<TestCtx>   // resetDb + seeds(lite); routers are imported BEFORE seeding so adapters/resolvers are registered
interface TestCtx {
  app: Express; db: Database;
  as(userIdOrHandle: string): supertest.Agent;          // cookie session pre-installed; user must exist
  anon(): supertest.Agent;
  createUser(o?: Partial<{ id; handle; displayName; email; universityId; role: Role; accountType: AccountType; createdAt: EpochMs /* default now-30d */;
             isAdult: boolean; buzzGate: boolean /* default true */; follows: Id[]; followedBy: Id[] }>): AuthedUser;
  seededIdentityStrings(): string[];                    // every users.id/handle/display_name/email (firewall tests)
  wsEventsFor(userId: Id): WsServerEvent[];             // captured publishToUser payloads
  fetchSpy: { calls: number };                          // global fetch is stubbed to throw + count
}
assertNoForbiddenKeys(body: unknown): void              // safety L1 key walk
assertNoIdentityLeak(body: unknown, strings: string[]): void
```

### 4.3 Foundation endpoints (`server/src/routes/core/*.ts`; all under `/api`)

Auth column: `—` public · `A` requireAuth · `O` requireAuth + requireOnboarded. IP limiter: auth routes 10/min, else 300/min.

| # | method path | auth | request | 200 response | errors / behaviour |
|---|---|---|---|---|---|
| 1 | `GET /health` | — | | `{ ok: true, name: APP_NAME }` | |
| 2 | `GET /auth/domain?email=` | — | query `email` (full address or bare domain) | `DomainLookupResponse` | always 200; copy from product §1.2 |
| 3 | `POST /auth/start` | — | `AuthStartRequest` | `AuthStartResponse` | 422 `email_personal`/`email_disposable`/`email_not_academic` (exact `STAFF_EMAILS` addresses bypass these three), 403 `email_banned`, 429 `otp_cooldown` (`retryAfterSec`), **503 `mail_unavailable`** in production with no mail provider; `devCode` only when env ≠ production **and** no mail provider |
| 4 | `POST /auth/verify` | — | `AuthVerifyRequest` | `AuthVerifyResponse` (sets `uv_session` when `signed_in`) | 400 `otp_invalid` (`OtpInvalidDetails`), 410 `otp_expired`, 423 `otp_locked` |
| 5 | `GET /auth/handle-available?handle=` | — | | `HandleAvailabilityResponse` | 429 |
| 6 | `POST /auth/complete` | — | `AuthCompleteRequest` | `AuthCompleteResponse` (sets cookie; sets `profile_completed_at`, `campus_rank`, `invited_by`; applies the `STAFF_EMAILS` role bootstrap, §4.2.15) | 401 `signup_token_invalid`, 409 `handle_taken`, 422 `handle_invalid`/`handle_reserved`/`content_blocked` (surfaces `profile`,`handle`) |
| 7 | `POST /auth/logout` | A | | 204 (clears cookie, revokes session + sockets) | |
| 8 | `GET /invites/:code` | — | | `InvitePreview` | 404 |
| 9 | `GET /me` | A | | `MeUser` | 401 |
| 10 | `PATCH /me` | A | `UpdateMeRequest` | `WithModeration<MeUser>` | handle 1/14 d → 409 `conflict`; `requireCanPost` for text fields; rate `profile_edit`; `isAdult` editable once |
| 11 | `POST /me/guidelines` | A | `AcceptGuidelinesRequest` | `MeUser` | version must equal `GUIDELINES_VERSION`; `kind:'buzz'` also tracks `buzz_gate_accepted` |
| 12 | `POST /me/onboarding/complete` | A | | `MeUser` | idempotent |
| 13 | `GET /me/settings` · `PATCH /me/settings` | A | — · `UpdateSettingsRequest` | `UserSettings` | `notifications.safety` forced true |
| 14 | `GET /me/badges` | O | | `Badges` | runs notification hooks |
| 15 | `GET /me/blocks?cursor&limit` | O | | `Paginated<BlockedUserRow>` | |
| 16 | `GET /me/invite` | O | | `InviteStats` (`url = {origin}/i/{code}`) | |
| 17 | `GET /me/sanctions` | A | | `Paginated<SanctionNotice>` (all rows, `nextCursor: null`) | allowed while suspended; the ONLY endpoint that returns `contentExcerpt` |
| 18 | `POST /me/sanctions/:id/ack` | A | | 204 | allowed while suspended |
| 19 | `POST /appeals` | A | `CreateAppealRequest` | `AppealReceipt` | one per sanction, ≤ 14 d, creates queue item `source:'appeal'`, `notify('mod.appeal_received')`; allowed while suspended |
| 20 | `DELETE /me` | A | `DeleteAccountRequest` | 204 | status `deleted`, profile fields blanked, sessions revoked, lifecycle hooks |
| 21 | `GET /users/search?q&type&scope&cursor&limit` | O | `UserSearchQuery` | `Paginated<UserListItem>` | name/handle/major prefix+substring; campus first; blocks excluded; rate `search` |
| 22 | `GET /users/:handle` | O | | `PublicUser` | generic 404 (`assertVisibleUser`); if viewer blocked target → 200 with `viewer.isBlockedByMe` and zeroed counts/bio |
| 23 | `GET /users/by-id/:id` | O | | `PublicUser` | same |
| 24 | `GET /users/:id/followers` · `/following` `?cursor&limit&q` | O | | `Paginated<UserListItem>` | |
| 25 | `POST /users/:id/follow` · `DELETE /users/:id/follow` | O | | `FollowResult` | 404 blocked/missing; 429 |
| 26 | `POST /users/:id/block` · `DELETE /users/:id/block` | O | | `BlockResult` | 409 when over `maxBlocks` |
| 27 | `GET /universities/me` | O | | `University` | |
| 28 | `GET /universities/me/places?kind=` | O | | `Paginated<CampusPlace>` (`nextCursor: null`) | |
| 29 | `POST /uploads` | **A** (`kind:'avatar'`) / O (other kinds — the handler throws 403 `onboarding_required` itself) | multipart: `file`, `kind: UploadKind`, `durationMs?`, `width?`, `height?` | `UploadResult` | 413 `payload_too_large`, 415 `unsupported_media`, 422; rate `upload` (60/h). Avatar uploads need only a session so the auth slice can upload right after `/auth/complete`, before the guidelines step |
| 30 | `POST /reports` | O | `CreateReportRequest` | `ReportReceipt` | idempotent 200; 404 when adapter/`load()` is null; self-report 400; `other` needs note ≥ 10; evaluates auto-hide (safety §3.2) in-transaction; rate `report` |
| 31 | `GET /notifications?filter=&cursor&limit` | O | `filter: NotificationFilter` | `NotificationListResponse` | runs notification hooks first |
| 32 | `POST /notifications/read` | O | `MarkNotificationsReadRequest` | `Badges` | |
| 33 | `POST /analytics/track` | `optionalAuth` | `TrackRequest` (≤ 50 events) | 204 (always, even when every event was dropped) | unknown names dropped silently. **Signed-out callers:** only `PRE_AUTH_ANALYTICS_EVENTS` (`app_open`, `signup_started`, `signup_code_sent`, `invite_link_opened`) are stored, with `user_id NULL`, `university_id NULL`; everything else is dropped |
| 34 | `GET /waitlist/:feature` | O | | `WaitlistState` | |
| 35 | `POST /waitlist/:feature` · `DELETE /waitlist/:feature` | O | `{ source?: string }` | `WaitlistState` | idempotent; leave sets `left_at` |
| 36 | `POST /dm` | O | `OpenDmRequest` | `OpenDmResponse` | 403 `cannot_message`, 429 |
| 37 | `GET /share/targets` | O | | `Paginated<ConversationSummary>` (≤ 12 most recent active chats, `nextCursor: null`) | |
| 38 | `POST /share` | O | `ShareRequest` | `ShareResponse` | sends `kind:'card'` via `sendMessage`; tracks `share_click` |
| 39 | `GET /cards/:kind/:id` | O | | `ShareCard` | always 200 (`status:'unavailable'` when gone) |
| 40 | `GET /avatars/:seed.svg?t=student|org` | — | | `image/svg+xml`, immutable cache | |

**List envelope (Constitution §4):** every list response in this file — paged or not — is `{ items, nextCursor }`; lists that are never
paged return `nextCursor: null`. A list response MAY carry extra top-level fields (`unreadCount`, `lastVisitAt`), never a different shape.

Static: `/uploads/*` (nosniff, inline), `/seed-media/*`. WebSocket: `/ws` (events in core.ts).
`routes/mounts.ts` holds the mount table (`SLICE_MOUNTS: { slice; mount; onboarded: boolean }[]`) and `mountCore(router)`; both
`routes/index.ts` (static imports of every slice router — Constitution §3) and `createTestApp` isolation mode (dynamic imports) use it.
`routes/index.ts` mounts, in this order: core routers → `/onboarding` (auth) → `/reels` → `/buzz` → `/orbit` → `/discover` →
`/conversations` (messages) → `/roommates` → `/market` → `/campus` → `/apartments` → `/admin`, each as
`router.use('/<mount>', requireAuth, requireOnboarded, sliceRouter)` (auth slice: `requireAuth` only).

### 4.4 Foundation client modules (`client/src/**` outside `features/`)

Import alias `@/` = `client/src/`. Everything is a named export.

#### 4.4.1 `lib/*`, `stores/*`

| file | exports |
|---|---|
| `lib/api.ts` | `api.get<T>(path, query?: Record<string, string\|number\|boolean\|null\|undefined>)`, `api.post<T>(path, body?)`, `api.put<T>`, `api.patch<T>`, `api.delete<T>(path, body?)` — `path` is relative to `/api` (`'/market/listings'`); `credentials:'include'`; 204 → `undefined`. `class ApiClientError extends Error { status: number; code: string; details: unknown }`. `isApiError(e: unknown, code?: string): e is ApiClientError`. `errorMessage(e: unknown): string` (friendly fallback "Something went wrong. Try again."). Global handling: 401 → session store reset + redirect `/welcome?next=`; 403 `onboarding_required` → `/welcome`; 403 `suspended`/`banned` → SanctionGate; 403 `buzz_gate_required` is left to `buzz`. **While `location.pathname` starts with `/welcome` (or is `/legal/*`, `/guidelines`) neither the 401 nor the `onboarding_required` redirect is performed** — the error is simply thrown to the caller (no bounce mid-onboarding, no redirect loop). |
| `lib/query.ts` | `queryClient` (staleTime 30 s, retry 1, no retry on 4xx) · `useInfiniteList<T>(opts: { queryKey: unknown[]; path: string; query?: Record<string, unknown>; enabled?: boolean; limit?: number; refetchInterval?: number }): { items: T[]; isLoading; isError; error; refetch; fetchNextPage; hasNextPage; isFetchingNextPage; sentinelProps: Pick<InfiniteSentinelProps,'onReach'\|'hasMore'\|'isFetching'\|'error'\|'onRetry'> }` · `updateInfiniteItem<T extends { id: string }>(queryKey, id, fn: (t: T) => T)` · `removeInfiniteItem(queryKey, id)` · `prependInfiniteItem<T>(queryKey, item)` |
| `lib/session.ts` | `useMe(): MeUser` (throws outside the authed shell) · `useMeOptional(): MeUser\|null` · `useSessionStatus(): 'loading'\|'anon'\|'onboarding'\|'ready'\|'restricted'` · `refreshMe(): Promise<MeUser\|null>` · `setMe(me: MeUser)` · `logout(): Promise<void>` (API call, `queryClient.clear()`, resets **every** zustand store registered via `registerStoreReset(fn)`, closes ws, navigates `/welcome`) · `registerStoreReset(fn: () => void)` (slices with zustand stores MUST register) · `useBadges(): Badges` · `useCanPost(scope?: 'public'\|'buzz'): { allowed: boolean; mutedUntil: EpochMs\|null }` |
| `lib/realtime.ts` | `useRealtime<T extends WsEventType>(type: T, handler: (e: WsEventOf<T>) => void): void` · `sendWs(e: WsClientEvent): void` · `useWsStatus(): 'connecting'\|'open'\|'reconnecting'` · `onReconnect(fn): () => void`. Backoff 1→2→4→…→30 s; on reconnect invalidates the reserved keys `['messages']`, `['notifications']` (§4.4.5). Foundation itself consumes `notification`/`badges`/`session.revoked`. |
| `lib/analytics.ts` | `track(name: AnalyticsEventName, props?: AnalyticsProps): void` (batched 5 s / 20 events / `pagehide` via `sendBeacon`; posts with a **raw `fetch` / `sendBeacon`, never `lib/api.ts`**, so the global 401/403 handlers cannot fire; never throws, never retries; works signed-out for `PRE_AUTH_ANALYTICS_EVENTS`) · `useScreenView(screen: string, props?): void` · `useDwell(name: AnalyticsEventName, props?): void` (fires on unmount with `dwellBucket: '<5s'\|'5-15s'\|'15-60s'\|'60s+'`) |
| `lib/moderation.ts` | `handleModerationError(e: unknown, opts?: { onEdit?(): void }): boolean` (422 `content_blocked` → block sheet [Edit][Read the guidelines](+[Get help reporting] for M-NAMED) + support sheet; 403 `muted` → toast; 429 → toast "You're going fast…"; returns true when handled) · `showModerationNotice(n: AuthorNotice\|undefined): void` (held toast / support sheet) · `ContentStatusChip: FC<{ status: ContentStatus }>` ("In review" / "Hidden pending review" / "Removed") |
| `lib/report.ts` | `openReport(target: ReportTarget): void` · `openBlock(user: UserSummary, opts?: { onBlocked?(): void }): void` (ReportSheet/BlockDialog hosts live in AppShell; ReportSheet inherits the caller's surface mode via `useSurfaceMode` captured at call time: `openReport(target, mode?)` second optional arg `'public'\|'incognito'`) |
| `lib/share.ts` | `openShare(input: { card: ShareCardRef; url: string; title: string; text?: string }): void` (ShareSheet: recent chats row → `POST /share`, Copy link, `navigator.share` when present; tracks `share_click`) · `copyLink(url: string): Promise<void>` (toast "Link copied") · `absoluteUrl(path: string): string` |
| `lib/dm.ts` | `openDm(input: { userId: Id; context?: ContextCardRef; draft?: string }): Promise<void>` — `POST /dm`, then `navigate('/messages/' + conversationId, { state: { draft } })`; on `cannot_message` → toast "You can't message this account." |
| `lib/upload.ts` | `prepareImage(file: File, opts?: { maxEdge?: number /*2048*/; type?: 'image/jpeg'\|'image/webp' }): Promise<{ blob: Blob; width: number; height: number }>` (canvas re-encode) · `uploadImage(file: File, opts?: { kind?: 'image'\|'avatar'; onProgress?(p: number): void }): Promise<UploadResult>` · `uploadVideo(file: File, meta: { durationMs: number; width: number; height: number }, onProgress?): Promise<UploadResult>` · `readVideoMeta(file: File): Promise<{ durationMs; width; height; posterBlob: Blob }>` (first frame → canvas) · `toMediaImage(u: UploadResult, alt?: string): MediaImage` |
| `lib/format.ts` | `formatCount(n)` ("1.2K") · `formatPrice(n: number\|null, currency?: string /* default useMe().currency, else DEFAULT_CURRENCY */)` (`Intl.NumberFormat(undefined, { style:'currency', currency, maximumFractionDigits: 0 })` → "$60", "£60", "CHF 60" / "Free" for null) · `currencySymbol(currency)` (price `Input prefix`) · `timeAgo(ts)` ("3m", "2h", "5d", "Mar 4") · `formatDayTime(ts)` · `firstName(displayName)` · `classLabel(classYear, classKind)` ("Junior" / "Grad" / "Class of 2028") |
| `lib/links.ts` | `routes` object — the only place hrefs are built: `welcome(next?)`, `home(tab?)`, `reel(id, opts?: { comments?: boolean })`, `reelNew()`, `buzzThread(id)`, `buzzMine()`, `post(id)`, `profile(handle)`, `followers(handle)`, `following(handle)`, `editProfile()`, `discover()`, `search(q?)`, `messages()`, `messagesRequests()`, `messagesNew()`, `chat(id)`, `chatInfo(id)`, `roommates(query?: { mode?: 'need'\|'have' })`, `roommatesSaved()`, `roommatesMe()`, `roommatesMeEdit()`, `roommate(id)`, `market(query?: { q?; course?; type? })`, `marketSaved()`, `marketMine()`, `listing(id)`, `listingEdit(id)`, `listingNew(prefill?: { type?; title? })`, `campus()`, `events()`, `eventNew()`, `event(id)`, `eventEdit(id)`, `courses()`, `course(id)` (`/c/:courseId`), `apartments()`, `notifications()`, `settings(section?)`, `accountStatus()`, `legal(doc: 'terms'\|'privacy')`, `guidelines(anchor?)`, `admin(section?)`, `adminQueueItem(id)`, `adminUser(id)`, `invite(code)`. Slices MUST NOT hard-code path strings; a missing builder is a foundation gap to report. Server code builds the same strings by hand; the canonical patterns are the §4.5 table. |
| `lib/motion.ts` | design §4.1 verbatim + `useReducedMotionPref(): boolean` (OS setting OR `settings.reduceMotion`) |
| `lib/cn.ts` | `cn(...inputs): string` (clsx + tailwind-merge) |
| `lib/toast.ts` | §2.2 |
| `lib/hooks.ts` | `useDebounced<T>(v: T, ms: number): T` · `useLocalStorage<T>(key, initial)` (keys MUST be prefixed `uv:<slice>:`; **Buzz MUST NOT use it**) · `useIntersection(ref, opts)` · `useDoubleTap(onSingle, onDouble, ms = 250)` · `useOnScreenTop(scrollRef)` |
| `stores/home.ts` | **`useHomeTab(): { tab: HomeTab; setTab(t: HomeTab): void /* smooth-scrolls the pager */; isActive(t: HomeTab): boolean; progress: MotionValue<number> /* 0..2 pager position */; scrollTopSignal: number /* increments when the active Home tab/nav item is re-tapped */ }`**; last tab persisted in `localStorage['uv:home:tab']`; first-ever session → `'reels'`. |
| `stores/ui.ts` | `useNavVisible()`, internal hosts state (report/block/share/moderation sheets) |

#### 4.4.2 `components/*` (shared composites; barrel `client/src/components/index.ts`)

| export | props / behaviour |
|---|---|
| `Wordmark` | `{ size?: 'sm'\|'md'\|'lg'\|'display'; className? }` — renders `APP_NAME` lowercased, split at `APP_WORDMARK_SPLIT` |
| **`UserAvatar`** | `{ user: Pick<UserSummary,'id'\|'handle'\|'displayName'\|'avatarUrl'\|'accountType'\|'isVerified'>; size?: Avatar['size']; ring?: Avatar['ring']; presence?: 'online'\|'offline'; link?: boolean /* default true → /u/:handle */; className? }` — org shape + verified badge automatic |
| **`UserRow`** | `{ user: UserSummary \| UserListItem; subtitle?: ReactNode /* default "@handle · {universityShortName}" */; reason?: ReactNode; trailing?: ReactNode \| 'follow' \| 'none' /* default 'follow' unless self */; onClick?(): void /* default: navigate to profile */; size?: 'md'\|'lg'; tag?: string /* e.g. "Invited you" */ }` |
| **`FollowButton`** | `{ userId: Id; initialFollowing: boolean; followsMe?: boolean /* label "Follow back" */; size?: 'sm'\|'md'; variant?: 'default'\|'plus-badge' /* reel rail */; onChange?(r: FollowResult): void }` — optimistic, spring morph, invalidates the reserved keys `['users', userId]`, `['orbit','feed']`, `['reels','following']` (prefix match; §4.4.5); tracks `follow`/`unfollow`; renders nothing for self |
| `MediaBox` (design's "MediaImage" component; renamed to avoid clashing with the `MediaImage` type) | `{ src: string\|null; alt: string; aspect?: '1:1'\|'4:5'\|'4:3'\|'16:9'\|'9:16'\|number; rounded?: 'none'\|'sm'\|'md'\|'lg'; fit?: 'cover'\|'contain'; onClick?(): void; overlay?: ReactNode; className? }` — fixed ratio box, `bg-surface-2`, lazy, error glyph |
| **`MediaPicker`** | `{ value: MediaImage[]; onChange(v: MediaImage[]): void; max: number; variant?: 'tray'\|'grid'\|'avatar'; coverLabel?: boolean /* first = cover + "Make cover" action */; disabled?: boolean; hint?: string; onUploadingChange?(busy: boolean): void }` — images only; uses `prepareImage` + `uploadImage`; per-tile progress/retry/remove. (Video picking is private to `reels`, which uses `readVideoMeta` + `uploadVideo`.) |
| `ShareCardView` | `{ card: ShareCard; variant?: 'bubble'\|'pinned'\|'compact'; onClick?(): void /* default navigate(card.href) */ }` — used by messages (bubbles + pinned context), orbit (internal-link cards), share sheet. kind `'buzz'` renders in a nested incognito chip-frame with the mask glyph, never an avatar |
| `OverflowMenu` | `{ open; onOpenChange; items?: ActionSheet['actions'] /* extra, first */; share?: Parameters<typeof openShare>[0]; report?: ReportTarget; blockUser?: UserSummary \| null; onDelete?(): void; deleteLabel?: string }` — builds Share / Copy link / Report / Block @handle / Delete in the canonical order |
| `ComposerModeBanner` | `{ mode: 'public'\|'incognito' /* REQUIRED, no default */; verb?: string /* "Posting" \| "Listing" \| "Commenting" \| "Hosting" \| "Creating" */; note?: string; size?: 'md'\|'inline' /* 'inline' = one-line variant for comment bars */ }` — public: viewer avatar + "{verb} as @handle"; incognito: mask glyph + "You're anonymous". Mandatory on **every** create/edit surface (§5 common rules) |
| `ComposerGuard` | `{ scope?: 'public'\|'buzz'; children: ReactNode }` — replaces children with the disabled bar "Muted until {date} · Details" when `useCanPost` says no |
| `CountLabel` `{ value: number }` · `TimeAgo` `{ ts: EpochMs; className? }` · `SectionHeader` `{ title: string; action?: { label: string; to?: string; onClick?(): void } }` | |
| `CampusScopeToggle` | `{ value: FeedScope; onChange(v: FeedScope): void; size?: 'sm'\|'md' }` |
| `ColdStartBanner` | `{ universityName: string; onDismiss(): void; onPost(): void }` — copy of §1 rule 1 |
| `SafetyCard` | `{ title: string; points: string[]; storageKey: string /* open-by-default for the first 3 views */; tone?: 'warning'\|'info' }` |
| `UserListSheet` | `{ open; onOpenChange; title: string; path: string /* endpoint returning Paginated<UserListItem> */; queryKey: unknown[] }` — likers, attendees |
| `PageLoader`, `RouteError`, `NotFound` ("Lost in space") | route-level fallbacks |
| Hosts (mounted once by `AppShell`) | `ReportHost`, `BlockHost`, `ShareHost`, `ModerationHost`, `SanctionGate` (suspension/ban screen, warning acknowledge modal), `Toaster`, `ReconnectBar` is **messages-only** (slice renders it) |
| `SanctionGate` details | For session status `'restricted'` (suspended/banned) it covers **every route except `/settings/account-status`, `/guidelines`, `/legal/*`**. It shows the safety §4.4 copy + **[Appeal]** → `routes.accountStatus()` + [Sign out]. Foundation owns the gate; **apartments owns the appeal form** on `/settings/account-status`. Guard `A` admits `'restricted'` sessions on that one path only. That page MUST render with `useMeOptional()` (no `useMe()`-dependent shell chrome, no BottomNav) and MAY call only endpoints #7, #9, #17, #18, #19 — everything else 403s while restricted. |

#### 4.4.3 `app/*`
`App.tsx` (providers: QueryClient, Router) · `AppShell.tsx` (frame, `AuroraBackdrop`, `BottomNav`, hosts, `#overlay-root`) ·
`router.tsx` (§4.5) · `guards.tsx` (`RequireAuth`, `RequireOnboarded`, `RedirectIfReady`) · `home/HomePage.tsx` (pager per design §6.5 + the behaviour list in §8 "Foundation done when"; keeps 3 panes
mounted, wraps `BuzzPane` in `<Surface mode="incognito">`; CSS scroll-snap for touch/trackpad plus one small `pointerType === 'mouse'`
click-drag handler — sets `scrollLeft` while dragging past an 8 px slop, releases to snap, suppresses the click — the only sanctioned
exception to "no drag gesture code"; ignores drags that start inside a `.scroll-x` element) · `home/HomeTopBar.tsx` (left slot = the
identity-aware Me button of §1.2) · `home/MeSheet.tsx` (rows: profile, Campus hub, Saved
listings → `/market/saved`, Settings, Community Guidelines, Trust & Safety when staff) · `InviteRedirect.tsx` (`/i/:code` → `/welcome?invite=`) ·
`public/manifest.webmanifest`, icons (SVG). Signed-out users hitting any authed route → `/welcome?next=<path>`; `next` + `invite` are kept in
`sessionStorage['uv:auth:next'|'uv:auth:invite']` by foundation (`lib/session.ts`: `getPendingNext()`, `consumePendingNext(): string`, `getPendingInvite()`).

#### 4.4.4 Notification types — producer, `data` keys, href, in-app copy (renderer: `apartments`)

| type | producer | `data` keys | href | copy |
|---|---|---|---|---|
| `follow.new` | foundation | — | `/u/{actor.handle}` | "{name} started following you" [Follow back] |
| `system.announcement` | foundation/admin | `title`, `body` | any | `{title}` |
| `reel.like` | reels | `caption` | `/reel/{id}` | "{name} (and {n} others) liked your reel" |
| `reel.comment` / `reel.comment_reply` | reels | `snippet`, `commentId` | `/reel/{id}?comments=1` | "{name} commented: "{snippet}"" / "{name} replied: "{snippet}"" |
| `post.like` | orbit | `snippet` | `/post/{id}` | "{name} liked your post" |
| `post.comment` / `post.comment_reply` | orbit | `snippet`, `commentId` | `/post/{id}` | as reels |
| `message.request` | foundation (`sendMessage`) | `hasContext: boolean` | `/messages/{conversationId}` | "{name} sent you a message request" |
| `message.request_accepted` | foundation | — | `/messages/{id}` | "{name} accepted your message request" |
| `message.group_added` | foundation (`createGroup`/`addMember` with `addedBy`; never on self-join) | `title` | `/messages/{id}` | "{name} added you to {title}" |
| `market.offer` | market | `amount`, `title`, `listingId` | `/messages/{conversationId}` | "{name} offered {amount} for {title}" |
| `market.offer_accepted` / `_declined` | foundation (`setOfferStatus`) | `amount`, `title` | `/messages/{conversationId}` | "{name} accepted / declined your {amount} offer" |
| `market.price_drop` | market | `title`, `oldPrice`, `newPrice` | `/market/{id}` | "Price drop: {title} is now {new} (was {old})" |
| `roommate.still_looking` | roommates (hook) | — | `/roommates/me` | "Still looking for a roommate? Confirm to keep your post visible." |
| `event.rsvp` | campus | `title`, `state` | `/campus/events/{id}` | "{name} is going to {title}" |
| `event.reminder` | campus (hook) | `title`, `startsAt` | same | "Starts in 1 hour: {title}" |
| `event.cancelled` / `event.updated` | campus | `title` | same | "Cancelled: {title}" / "Updated: {title}" |
| `campus.milestone` | campus | `universityName`, `goal` | `/campus` | "{universityName} just passed {goal} students." |
| `mod.report_resolved` | foundation staff lib | `outcome: 'actioned'\|'no_violation'` | `/guidelines` | safety §3.1 copy |
| `mod.content_hidden` / `_restored` / `_removed` | foundation staff lib | `label`, `excerpt`, `category`, `sanctionId` | `/settings/account-status` | safety §3.2 / §4.4 copy |
| `mod.warning` / `mod.muted` / `mod.suspended` | foundation staff lib | `category`, `until`, `sanctionId` | `/settings/account-status` | safety §4.4 |
| `mod.appeal_received` / `mod.appeal_result` | foundation / staff lib | `outcome`, `sanctionId` | `/settings/account-status` | safety §4.4 |
| `admin.unmask_alert` | admin | `reasonCode`, `auditId` | `/admin/audit` | "An admin unmasked a Buzz author · {reasonCode}" |
| `buzz.reply` | buzz (`notifyAnonymous`) | `snippet?` (of the viewer's OWN buzz only) | `/buzz/{threadId}` | "Someone replied to your buzz" |
| `buzz.milestone` | buzz | `upvotes` | `/buzz/{threadId}` | "Your buzz passed {upvotes} upvotes" |
| `buzz.poll_closed` | buzz (hook) | `votes` | `/buzz/{threadId}` | "Your poll closed · {votes} votes" |

Money placeholders (`{amount}`, `{new}`, `{old}`) are numbers in `data`; the renderer formats them with `formatPrice(n)` (viewer's campus
currency — Market and Roommates are campus-only, so one currency per campus is always right). `follow.new` rows use
`PublicNotification.actorFollowedByViewer` for the inline `FollowButton` (`initialFollowing`), with `followsMe`.

#### 4.4.5 Reserved query keys (foundation invalidates these; the owning slice MUST use exactly these prefixes)

| key (prefix) | owner | used for | invalidated by foundation on |
|---|---|---|---|
| `['orbit','feed', …]` | orbit | Orbit feed list | follow / unfollow (`FollowButton`), block |
| `['reels','following']` | reels | `FollowingReelsRail` | follow / unfollow, block |
| `['users', userId]` (also `['users','handle', handle]` → the slice MUST `setQueryData(['users', user.id])` as well) | **foundation namespace**, consumed by discover's profile page | `PublicUser` of a profile | follow / unfollow, block / unblock, `PATCH /me` |
| `['notifications', filter]` | **foundation namespace**, consumed by apartments' `NotificationsPage` | notification list | ws reconnect, `POST /notifications/read` |
| `['messages', …]` | messages | inbox, thread, detail | ws reconnect |
| `['me']`, `['badges']` | foundation | session, nav badges | ws `badges` / `notification` |

`['users', …]` and `['notifications', …]` are foundation-namespaced keys for foundation endpoints (#22–#23, #31) — the explicit
exception to "query keys start with the slice name". Each entry is repeated in the owning slice's §5 section.

### 4.5 Client route table (`client/src/app/router.tsx`)

Every slice element is `React.lazy(() => import('@/features/<slice>').then(m => ({ default: m.<Export> })))` inside
`<Suspense fallback={<PageLoader/>}>` + an error boundary (`RouteError`). Wildcard mounts (`/*`) give the slice its own nested
`<Routes>`; the **sub-paths listed are canonical and MUST exist** (they are linked from other slices, cards and notifications).
Guards: `P` public-only (redirects ready users to `/`), `A` signed-in + onboarded (`'restricted'` sessions are admitted on
`/settings/account-status` only; everywhere else they get the `SanctionGate`).

| path | guard | element (slice · export) | canonical sub-paths the slice MUST implement |
|---|---|---|---|
| `/welcome/*` | P* | auth · `AuthRoutes` | `/welcome`, `/welcome/email`, `/welcome/code`, `/welcome/profile`, `/welcome/guidelines`, `/welcome/follow` (*signed-in but not onboarded users are allowed and resumed at the right step) |
| `/i/:code` | — | foundation `InviteRedirect` | |
| `/` | A | foundation → redirect `/home/{lastTab}` | |
| `/home/:tab` | A | foundation `HomePage` → reels · `ReelsPane`, buzz · `BuzzPane`, orbit · `OrbitPane` (props `{ active: boolean }`) | `tab ∈ HOME_TABS` |
| `/reel/*` | A | reels · `ReelsRoutes` | `/reel/new`, `/reel/:id` (`?comments=1` opens the sheet) |
| `/buzz/*` | A | buzz · `BuzzRoutes` | `/buzz/mine`, `/buzz/:threadId` (each wraps itself in `<Surface mode="incognito">`) |
| `/post/*` | A | orbit · `OrbitRoutes` | `/post/:id` |
| `/discover/*` | A | discover · `DiscoverRoutes` | `/discover`, `/discover/search?q=` |
| `/u/:handle/*` | A | discover · `ProfileRoutes` | `/u/:handle`, `/u/:handle/followers`, `/u/:handle/following` |
| `/me/edit` | A | discover · `EditProfilePage` | |
| `/messages/*` | A | messages · `MessagesRoutes` | `/messages`, `/messages/requests`, `/messages/new`, `/messages/:conversationId` (reads `location.state.draft`), `/messages/:conversationId/info` |
| `/roommates/*` | A | roommates · `RoommatesRoutes` | `/roommates` (`?mode=have` pre-filters), `/roommates/saved`, `/roommates/me`, `/roommates/me/edit`, `/roommates/:id` |
| `/market/*` | A | market · `MarketRoutes` | `/market` (`?course=`, `?q=`, `?type=`), `/market/new` (`?type=wanted&title=`), `/market/saved`, `/market/mine`, `/market/:id`, `/market/:id/edit` |
| `/apartments` | A | apartments · `ApartmentsPage` | |
| `/notifications` | A | apartments · `NotificationsPage` | |
| `/settings/*` | A | apartments · `SettingsRoutes` | `/settings`, `/settings/notifications`, `/settings/privacy`, `/settings/blocked`, `/settings/invite`, `/settings/account-status` (sanction notices + appeal), `/settings/buzz-anonymity`, `/settings/about` |
| `/legal/:doc` | — | apartments · `LegalPage` | `doc ∈ terms \| privacy` (public so Welcome can link) |
| `/campus/*` | A | campus · `CampusRoutes` | `/campus`, `/campus/events`, `/campus/events/new`, `/campus/events/:id`, `/campus/events/:id/edit`, `/campus/courses` |
| `/c/:courseId` | A | campus · `CourseJoinPage` | joins (or previews) then redirects to `/messages/:conversationId` |
| `/guidelines` | — | admin · `GuidelinesPage` | hash anchors = `GUIDELINE_ANCHORS` + `#buzz-anonymity`, `#enforcement` |
| `/admin/*` | A + staff | admin · `AdminRoutes` | `/admin`, `/admin/queue/:id`, `/admin/users`, `/admin/users/:id`, `/admin/audit`, `/admin/appeals`, `/admin/analytics`, `/admin/rules` (non-staff render `NotFound`) |
| `*` | | foundation `NotFound` | |

Bottom nav targets: `/home/{lastTab}` · `/discover` · `/messages` · `/roommates` · `/market` · `/apartments`. Nav visibility is set by each screen via `<Screen nav>`.

### 4.6 STUB EXPORTS foundation pre-creates (frozen names and prop types — R5)

The frozen prop interfaces live in foundation's `client/src/app/contracts.ts`; every slice `index.tsx` MUST import its prop types from
`@/app/contracts` (never redeclare them). After the stubs are created, `features/<slice>/**` belongs to the slice.

**Client `client/src/features/<slice>/index.tsx`** — exactly this filename (the bodies render JSX; a sibling `index.ts` would win module
resolution and silently keep serving the stub, so it MUST NOT exist — foundation's `tests/core/stubs.test.ts` fails when any
`client/src/features/*/index.ts` exists). Stub bodies: panes/pages render `<EmptyState icon={Hammer} title="Coming together"/>`;
embeddable components render `null`:

| slice | exports (exact) |
|---|---|
| auth | `AuthRoutes: FC` |
| reels | `ReelsPane: FC<HomePaneProps>` · `ReelsRoutes: FC` · `UserReelsGrid: FC<UserContentProps>` · `FollowingReelsRail: FC<{ className?: string }>` |
| buzz | `BuzzPane: FC<HomePaneProps>` · `BuzzRoutes: FC` |
| orbit | `OrbitPane: FC<HomePaneProps>` · `OrbitRoutes: FC` · `UserPostsList: FC<UserContentProps>` |
| discover | `DiscoverRoutes: FC` · `ProfileRoutes: FC` · `EditProfilePage: FC` |
| messages | `MessagesRoutes: FC` |
| roommates | `RoommatesRoutes: FC` |
| market | `MarketRoutes: FC` |
| campus | `CampusRoutes: FC` · `CourseJoinPage: FC` · `OrgEventsList: FC<UserContentProps>` |
| apartments | `ApartmentsPage: FC` · `NotificationsPage: FC` · `SettingsRoutes: FC` · `LegalPage: FC` |
| admin | `AdminRoutes: FC` · `GuidelinesPage: FC` · `GuidelinesContent: FC<GuidelinesContentProps>` |

```ts
// client/src/app/contracts.ts (foundation)
export interface HomePaneProps { active: boolean }
export interface UserContentProps { userId: Id; handle: string; isSelf: boolean }       // embedded in the profile <Screen>; MUST NOT create its own scroll container
export interface GuidelinesContentProps { variant?: 'page' | 'sheet'; anchor?: string }
```

**Server** (each compiles and is already wired):
- `server/src/routes/<slice>.ts` → `import { Router } from 'express'; const router = Router(); export default router;` for
  `auth, reels, buzz, orbit, discover, messages, roommates, market, campus, apartments, admin`.
- `server/src/db/schema/NN-<slice>.sql` → a single comment line. `server/src/db/seeds/NN-<slice>.ts` →
  `import type { SeedKit } from '../../lib/seedKit'; export default function seed(kit: SeedKit): void {}`.
  `seeds/index.ts` registers all twelve in NN order with **dynamic** `import()` loaders (§4.2.2).
- `server/tests/<slice>.test.ts` → one passing smoke test using `createTestApp({ slices: ['<slice>'] })`. Foundation's own tests live in `server/tests/core/**`.
- `shared/src/<slice>.ts` → `export {};` for all eleven slices.

**Seed kit** `server/src/lib/seedKit.ts`:
```ts
export interface SeedUser { id: Id; handle: string; displayName: string; universityId: Id; accountType: AccountType; major: string | null; classYear: number | null; createdAt: EpochMs; isPersona: boolean }
export interface SeedKit {
  db: Database; now: EpochMs; scale: 'full' | 'lite';
  rng(): number; int(min: number, max: number): number; pick<T>(a: readonly T[]): T; sample<T>(a: readonly T[], n: number): T[]; chance(p: number): boolean;
  id(prefix: string, n: number): Id;                        // deterministic, e.g. id('reel', 3) → 'reel_0003'
  ago(o: { m?: number; h?: number; d?: number }): EpochMs;  // now - …
  spread(i: number, total: number): EpochMs;                // 40 % last 24 h · 35 % last week · 25 % older (≤ 45 d), deterministic
  users: { all: SeedUser[]; personas: SeedUser[]; orgs: SeedUser[]; bg(universityId?: Id): SeedUser[]; get(idOrHandle: string): SeedUser; authed(idOrHandle: string): AuthedUser };
  follows(userId: Id): Id[];                                // who this user follows
  art: typeof import('./seedArt');
  notify(i: NotifyInput & { createdAt: EpochMs; read: boolean }): void;   // honours the seed-only `actorIds` (one collapsed row, e.g. 13 likers, read)
  notifyAnonymous(i: NotifyAnonymousInput & { createdAt: EpochMs; read: boolean }): void;
  convo: { dm(a: Id, b: Id, o?: { context?: ContextCardRef; peerState?: MemberState }): Id; group(title: string, ownerId: Id, memberIds: Id[]): Id;
           course(input: { id?: Id; universityId: Id; courseId: Id; code: string; title: string; term: string; createdBy: Id | null; createdAt: EpochMs }): Id;   // silent createCourseConversation
           join(conversationId: Id, userId: Id, joinedAt: EpochMs): void;                       // silent addMember (no notification, no ws)
           say(conversationId: Id, fromId: Id | null, text: string, at: EpochMs, extra?: Partial<SendInput>): Message; readAll(conversationId: Id, userId: Id): void };
           // every kit.convo.* call is silent: no notifications, no ws, no rate limits, no context validation
  waitlist(user: SeedUser, feature: WaitlistFeature, at: EpochMs, source?: string): void;   // joinWaitlist(); the only seed path into `waitlist`
  track(name: AnalyticsEventName, user: SeedUser, props: AnalyticsProps, at: EpochMs): void;
}
```
Seeds write their own tables with direct SQL, MUST be deterministic (`kit.rng` only), MUST work at both scales (`lite` = personas + orgs +
staff + 40 background users at the hero campus, 5 per medium campus), MUST keep every denormalised counter equal to its rows, and MUST call
`markPublicActivity` (with the row's `created_at`) for seeded reels/posts/events.

---

## 5. PER-SLICE CONTRACTS

Applies to every slice:

- **Owned files** (exactly these; `<s>` = slice name, `NN` = slice number): `shared/src/<s>.ts` · `server/src/routes/<s>.ts` (+ `routes/<s>/**`) ·
  `server/src/services/<s>/**` · `server/src/db/schema/NN-<s>.sql` · `server/src/db/seeds/NN-<s>.ts` · `server/tests/<s>.test.ts` (+ `tests/<s>/**`) ·
  `client/src/features/<s>/**`. Nothing else.
- Endpoint paths below are relative to the slice mount (§4.3). All are `requireAuth + requireOnboarded` (mounted by foundation).
  Lists return `Paginated<T>` and accept `?cursor&limit`; a list that is never paged still returns `{ items, nextCursor: null }` (§4.3
  list envelope). `DELETE` routes return 204 unless stated. Type names refer to the slice's `shared/src/<s>.ts` unless they are core types.
- Every create/edit route: `validate()` → `requireCanPost()` → `enforceRateLimit()` → `moderateWrite()` → insert → `commitModeration()` →
  `WithModeration<T>` (§3.1). Every list/detail for other viewers: `status = 'active'` + `sqlNotBlocked` + `sqlAuthorVisible` + `sqlNotReported`
  (Buzz: `sqlNotReported` only). Authors additionally see their own `held`/`hidden`/`removed` rows with `ContentStatusChip`.
- Every UGC table has `status TEXT NOT NULL DEFAULT 'active'` and `auto_hide_immune INTEGER NOT NULL DEFAULT 0`, and its owner registers a
  `ContentAdapter` + (if shareable) a `CardResolver` at router import time.
- Client: query keys start with the slice name (plus the reserved keys of §4.4.5, which the owning slice MUST use verbatim); every list
  has skeleton / EmptyState (copy from product.md) / ErrorState(retry) /
  `InfiniteSentinel`; every UGC item has `OverflowMenu` with Report (+ Block on public surfaces); mutations use
  `handleModerationError` / `showModerationNotice`; composers are wrapped in `ComposerGuard`; views/taps call `track()`; hrefs come
  from `routes.*` only; horizontal scrollers use `scroll-x`; prices go through `formatPrice`.
- **Composer mode is unmistakable everywhere (Constitution §5.4).** Every create/edit surface renders `ComposerModeBanner`:
  `mode="public"` with the right verb on reel upload ("Posting"), reel + Orbit comment bars (`size="inline"`, "Commenting"), Orbit post
  ("Posting"), listing create/edit ("Listing"), roommate publish review ("Posting", plus `note="Your post links to your public profile @handle"`),
  event create/edit ("Hosting"), group create + course create ("Creating"); `mode="incognito"` on the Buzz composer and Buzz reply bar. A create/edit
  surface without the banner fails the slice's done-check.
- Tests use `createTestApp({ slices: ['<s>'] })` (isolation mode, §4.2.16); no network; no dev servers. Minimum per slice: happy path per endpoint group, auth 401, validation 400,
  block filter (public slices), moderation block 422 + held visibility, author-notice hygiene (no `matches|ruleId|signals|engine` in any body),
  muted user 403 on every create route.
- Seeds reference §7 ids only through `kit.users` / `seeds/ids.ts`.

### 5.1 `auth` (01) — mount `/api/onboarding` (requireAuth only)

**Tables:** none. **Shared (`shared/src/auth.ts`):**
```ts
// MAJORS lives in @shared/core (discover's Edit profile edits the same field) — import it from there.
export const RESERVED_DISPLAY_WORDS: readonly string[];
export type OnboardingStep = 'email' | 'code' | 'profile' | 'guidelines' | 'follow';
export interface OnboardingSuggestionRow { user: UserListItem; reason: string; tag: 'invited_you' | null }
export interface OnboardingSuggestions {
  isNewCampus: boolean;                                  // < 5 other active users at the campus → sections come from other campuses
  inviter: OnboardingSuggestionRow | null;
  sections: { id: 'popular_orgs' | 'in_major' | 'class_year' | 'active'; title: string; rows: OnboardingSuggestionRow[] }[];
}
```
**Endpoints:** `GET /suggestions` → `OnboardingSuggestions` (core tables only: `users`, `follows`, `public_activity` via `publicActivityStats`;
orgs by `follower_count`; never Buzz) · `POST /follow-many` `{ userIds: Id[] (≤ 10) }` → `{ followed: Id[] }` (loops `followUser`; "Follow top 5").
Everything else uses foundation endpoints #2–#12, #25, #8.

**Client:** `AuthRoutes` with the six screens of product §1 (copy verbatim), zustand `useAuthFlow` (email, signupToken, resendAvailableAt, draft
profile; persisted in `sessionStorage`, registered with `registerStoreReset`). Step resolution on load: no session → welcome; session +
`!onboarding.profileCompleted` cannot occur (profile is part of `/auth/complete`), so: `needs_profile` token in store → profile;
`!guidelinesAccepted` → guidelines; `!completed` → follow; else `consumePendingNext()` or `/home/reels`. Guidelines screen opens
`GuidelinesContent variant="sheet"` (admin slice; degrade to a link to `/guidelines`); acceptance is the single primary button "I agree" (§2.3).
Avatar upload on the profile step happens **after** `/auth/complete` (upload needs a session): choose file → keep blob → after complete,
`uploadImage(kind:'avatar')` → `PATCH /me`. This works before the guidelines step because endpoint #29 needs only `requireAuth` for
`kind:'avatar'`, and `lib/api.ts` never redirects while under `/welcome`; an upload failure is a non-blocking toast ("Couldn't upload your photo. You can add it later.").
**Age question (profile step):** a required two-option `ChipGroup` "Are you 18 or older?" — **Yes / No, no default, never a checkbox**;
helper "Never shown on your profile."; Continue stays disabled until it is answered; maps to `AuthCompleteRequest.isAdult`.
Pre-session analytics (`signup_started`, `signup_code_sent`, `invite_link_opened`, `app_open`) go through `track()` as usual (#33 accepts them signed-out).
Footer links → `/legal/terms`, `/legal/privacy`. Exit: 900 ms rings-expand, then one-time coach mark "Swipe for Buzz and Orbit" (`uv:auth:coach`).

**Helpers:** `followUser`, `userListItemsByIds`, `publicActivityStats`, `trackEvent('onboarding_step'|'onboarding_completed')`; client `track('signup_started'…)`.
**Seeds:** none. **Tests:** suggestions exclude blocked/self/already-followed; inviter pinned first; new-campus variant; follow-many respects rate limit + blocks; no slice-derived input (suggestions are identical with every slice table empty).
**Acceptance:** new `.edu` email → code (dev toast Fill) → profile → guidelines → follow → Home in < 90 s; refresh at any step resumes; `?next=/market/x&invite=CODE` lands on `/market/x` with `invited_by` set and inviter pinned; returning user skips to Home with "Welcome back, {firstName}."; every error inline with product copy; personal/disposable emails rejected with friendly copy.

### 5.2 `reels` (02) — mount `/api/reels`

**Tables:**
```
reels(id, author_id→users, university_id, caption DEFAULT '', video_url, poster_url NULL, duration_ms, width NULL, height NULL,
  visibility CHECK IN('campus','global') DEFAULT 'global', status, auto_hide_immune, like_count, comment_count, view_count, share_count,
  created_at, updated_at)  INDEX(university_id, status, created_at DESC), (author_id, created_at DESC)
reel_likes(reel_id→reels, user_id→users, created_at, PK(reel_id,user_id))
reel_views(reel_id→reels, user_id→users, completed, first_viewed_at, PK(reel_id,user_id))        -- view_count = distinct viewers
reel_hidden(user_id→users, reel_id→reels, created_at, PK(user_id,reel_id))                        -- "Not interested"
reel_comments(id, reel_id→reels, author_id→users, parent_id NULL→reel_comments, text, status, auto_hide_immune, like_count, reply_count, created_at)
reel_comment_likes(comment_id→reel_comments, user_id→users, created_at, PK(comment_id,user_id))
```
**Shared:**
```ts
export interface Reel { id: Id; author: UserSummary; caption: string; videoUrl: string; posterUrl: string | null; durationMs: number;
  width: number | null; height: number | null; visibility: FeedScope; likeCount: number; commentCount: number; viewCount: number;
  viewer: { liked: boolean; isSelf: boolean; isFollowingAuthor: boolean }; status: ContentStatus; createdAt: EpochMs }
export interface CreateReelRequest { videoUploadId: Id; posterUploadId?: Id | null; caption: string; visibility: FeedScope }
export interface ReelComment { id: Id; reelId: Id; parentId: Id | null; author: UserSummary; text: string; likeCount: number; replyCount: number;
  replies: ReelComment[] /* first 2, top-level only */; viewer: { liked: boolean; isSelf: boolean }; status: ContentStatus; createdAt: EpochMs }
export interface CreateReelCommentRequest { text: string; parentId?: Id }
export interface LikeState { liked: boolean; likeCount: number }
```
**Endpoints:**
| method path | in | out |
|---|---|---|
| `GET /feed?scope=campus\|global` | | `Paginated<Reel>` — campus: `university_id = viewer's`; global: `visibility='global'` any campus; newest first; excludes `reel_hidden` |
| `GET /following?limit=` | | `Paginated<Reel>` — follows' reels from the last 7 days, newest first (rail) |
| `GET /user/:userId` | | `Paginated<Reel>` (self also sees non-active) |
| `GET /:id` | | `Reel` |
| `POST /` | `CreateReelRequest` | `WithModeration<Reel>` — `assertOwnUpload(video)`; `upload.duration_ms ≤ LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs` else 422 (defence in depth — #29 already stores `min(duration, 60_000)`), `reels.duration_ms = min(upload.duration_ms, 60_000)`; surface `reel_caption`; rate `reel_upload`; `markPublicActivity(…,'reel')` when active |
| `DELETE /:id` | | 204 (status `deleted`, `unmarkPublicActivity`, `removeNotificationsFor`) |
| `PUT /:id/like` · `DELETE /:id/like` | | `LikeState` — `notify('reel.like')` |
| `POST /:id/view` | `{ completed?: boolean }` | 204 (idempotent per viewer; `reel_view` / `reel_complete` events) |
| `POST /:id/not-interested` | | 204 |
| `GET /:id/comments` | | `Paginated<ReelComment>` (top-level, newest first) · `GET /comments/:commentId/replies` → `Paginated<ReelComment>` (oldest first) |
| `POST /:id/comments` | `CreateReelCommentRequest` | `WithModeration<ReelComment>` — surface `comment`, entity `reel_comment`, rate `comment`; notify `reel.comment` (author) / `reel.comment_reply` (parent author) |
| `DELETE /comments/:id` | | 204 (own, or reel author) |
| `PUT /comments/:id/like` · `DELETE` | | `LikeState` |
| `GET /:id/likers` | | `Paginated<UserListItem>` |

Adapters: `reel` (setStatus keeps `public_activity` in sync), `reel_comment`. Card resolver `reel` (title = caption or "Reel by @handle", image = poster).

**Exports:** `ReelsPane` (vertical snap feed per design §6.5; own FAB = avatar + plus badge → `/reel/new`; Campus/Global toggle; cold-start rule;
pauses when `!active`; reacts to `scrollTopSignal`) · `ReelsRoutes` · `UserReelsGrid` (3-col 9:16, view-count overlay, empty copy by `isSelf`) ·
`FollowingReelsRail` (avatars `ring="orbit"`, tap → `/reel/:id`; renders **nothing** when empty/loading/error; query key MUST be
`['reels','following']` — reserved, §4.4.5; container uses `scroll-x`).
Upload (`/reel/new`): file input `accept="video/mp4,video/quicktime,video/webm"`; `readVideoMeta` → if `durationMs > reelMaxDurationMs + reelDurationToleranceMs`
the file is refused **before upload** with "Reels max out at 60 seconds. This one is {m:ss}." (no trim UI); > `LIMITS.videoMaxBytes` refused with a size message;
public `ComposerModeBanner verb="Posting"`; progress bar; on success `prependInfiniteItem` into the campus feed + own grid. The comment bar carries the inline public banner.
Player: missing/erroring file → animated poster fallback (Ken Burns on `posterUrl` or a generated gradient) with identical controls.
Upload screen shows "Videos may include location data from your camera. Turn off location tagging in your camera settings." (G2).
**Seeds:** 12 reels ↔ `/seed-media/reels/reel-01…12.webm`, posters via `kit.art.nebulaSvg` (`reels/reel-NN.svg`); authors: noahg ×3, tbrooks ×2,
jordan_builds ×2, **mayachen ×2** (reel_0009, reel_0010), solarcar ×1, rafacruz ×1 (NYU), kaiyama ×1 (Stanford) = **10 hero-campus reels (7 `global`, 3 `campus`)
+ 2 `global` reels from other campuses**; likes/views/comments from bg users
(power-law; counters = rows); Maya notifications: `reel.like` (**one** collapsed row written with `kit.notify({ actorIds: [13 ids], read: true })` — never 13 calls, never direct SQL) + `reel.comment` (unread).
**Tests:** upload duration rule with synthetic MP4 / QuickTime (`ftyp qt  `, `moov` at end) / WebM headers: 60.3 s accepted and stored as 60 000, 61 s and 75 s rejected 422, `POST /` re-checks; `video/quicktime` accepted and served as `video/mp4`; feed scope rules; like idempotency + counter; block hides reels/comments both ways; hidden/held invisible to others but visible to author; view counted once; `public_activity` row created/removed; rail only follows.
**Acceptance:** **posting works from a phone:** a 20 s `.mp4` and a 20 s `.mov` each post with the "Posting as @handle" banner and appear first in the campus feed and in the own grid; a 75 s file is refused before upload with the product copy showing `m:ss`; a 60.3 s file is accepted; one video plays at a time; mute pill persists for session; double-tap burst; comments sheet keeps video playing; share sheet sends a card to a chat; works with all 12 files missing.

### 5.3 `buzz` (03) — mount `/api/buzz` (router-level `requireBuzzGate`, `noStore`)

**Tables:**
```
buzz_posts(id, root_id NULL→buzz_posts, parent_id NULL→buzz_posts, depth INTEGER DEFAULT 0, author_id→users /* moderation only */, university_id,
  text, prompt_id NULL, status, auto_hide_immune, locked, upvotes, downvotes, score, eligible_votes, reply_count, created_at, deleted_at NULL)
  INDEX(university_id, status, created_at DESC), (root_id, created_at), (author_id, created_at DESC)
buzz_votes(post_id→buzz_posts, user_id→users, value CHECK IN(-1,1), eligible, created_at, PK(post_id,user_id))
buzz_polls(post_id PK→buzz_posts, closes_at, closed_notified)
buzz_poll_options(id, post_id→buzz_posts, idx, text, vote_count)
buzz_poll_votes(post_id→buzz_posts, user_id→users, option_id→buzz_poll_options, created_at, PK(post_id,user_id))
buzz_hidden_threads(user_id, thread_id, created_at, PK)      buzz_hidden_authors(user_id, thread_id, author_id, created_at, PK(user_id,thread_id,author_id))
buzz_prompts(id, idx UNIQUE, text)                            buzz_milestones(post_id, milestone, day, PK(post_id, milestone))
```
Entity type = `root_id IS NULL ? 'buzz' : 'buzz_reply'`. No alias column anywhere. No images, no edit.
**Shared (no field may be named like a forbidden key, §3.2 #1):**
```ts
export interface BuzzAlias { emoji: string; label: string; color: string /* hex */ }
export type BuzzSort = 'hot' | 'new' | 'top';  export type BuzzTopWindow = 'day' | 'week' | 'all';
export interface BuzzPollOption { id: Id; text: string; votes: number | null; pct: number | null }     // null until resultsVisible
export interface BuzzPoll { options: BuzzPollOption[]; totalVotes: number | null; closesAt: EpochMs; closed: boolean; myChoice: Id | null; resultsVisible: boolean }
interface BuzzBase { id: Id; threadId: Id; alias: BuzzAlias; isOp: boolean; isMine: boolean; text: string /* '' when placeholder */;
  score: number; myVote: -1 | 0 | 1; collapsed: boolean; status: Extract<ContentStatus,'active'|'held'|'hidden'|'removed'|'deleted'>;
  supportLink: boolean; createdAt: EpochMs /* floored to the minute */ }
export interface Buzz extends BuzzBase { kind: 'buzz'; poll: BuzzPoll | null; replyCount: number; locked: boolean; campusShortName: string | null /* global scope only */; promptId: Id | null }
export interface BuzzReply extends BuzzBase { kind: 'reply'; parentId: Id; depth: 1 | 2; replyingTo: BuzzAlias | null /* set when flattened */ }
export interface BuzzThread { root: Buzz; replies: Paginated<BuzzReply> /* first page */; smallCampusNote: boolean }
export interface BuzzFeedMeta { prompt: { id: Id; text: string } | null; smallCampusNote: boolean }
export interface CreateBuzzRequest { text: string; poll?: { options: string[]; durationDays: 1 | 3 | 7 }; promptId?: Id }
export interface CreateBuzzReplyRequest { text: string; parentId?: Id }
export interface BuzzVoteState { score: number; myVote: -1 | 0 | 1; collapsed: boolean }
export interface MyBuzzItem { item: Buzz | BuzzReply; threadSnippet: string }
```
**Endpoints (static segments registered before `/:threadId`):**
| method path | in | out |
|---|---|---|
| `GET /feed?sort&window&scope` | | `Paginated<Buzz>` — hot = `(score + 2·reply_count)/(ageHours+2)^1.5`; collapsed items excluded from hot/top; excludes `buzz_hidden_threads` + reported; **no block filter, no status filter on author** |
| `GET /meta?scope` | | `BuzzFeedMeta` (Daily Campus Prompt = `prompts[dayIndex % count]` per campus; `smallCampusNote` when campus < 50 users) |
| `POST /` | `CreateBuzzRequest` | `WithModeration<Buzz>` — surfaces `buzz` (+ `buzz_poll` per option, field `option`); rate `buzz_post`; `requireCanPost('buzz')`; polls need account age ≥ 24 h |
| `GET /:threadId` | | `BuzzThread` (root + first page of replies; replies oldest first; depth > 2 flattened to 2 with `replyingTo`; collision suffixes; hidden-author replies returned as `collapsed`) |
| `GET /:threadId/replies?cursor&limit` | | `Paginated<BuzzReply>` — further pages (what `useInfiniteList` pages; seed its first page from `BuzzThread.replies`) |
| `POST /:threadId/replies` | `CreateBuzzReplyRequest` | `WithModeration<BuzzReply>` — locked → 403; `notifyAnonymous('buzz.reply')` to the parent's author and the root author (never self); ws `buzz.thread_updated` |
| `PUT /posts/:postId/vote` | `{ value: -1 \| 0 \| 1 }` | `BuzzVoteState` — voting on your own item → 400 `bad_request` (only the owner can ever trigger it, so it leaks nothing); eligibility per safety §3.2; collapse ≤ −5 & ≥ 8; auto-hide ≤ −10 & ≥ 12 → `setStatus hidden` + `enqueueSystemFlag(community_score, p2)`; milestones 10/25/50/100/250 → `notifyAnonymous('buzz.milestone')` |
| `POST /:threadId/poll/vote` | `{ optionId }` | `BuzzPoll` (one vote, no change) |
| `DELETE /posts/:postId` | | 204; non-owner → 404 identical to missing |
| `POST /:threadId/hide` · `DELETE /:threadId/hide` | | 204 |
| `POST /posts/:postId/hide-author` | | 204 (keyed thread + author server-side) |
| `GET /mine?kind=threads\|replies` | | `Paginated<MyBuzzItem>` · `GET /karma` → `{ karma: number }` |

`services/buzz/serialize.ts` = the only row→JSON exit (allow-list, field by field); `services/buzz/alias.ts` = safety §5.1 exactly (`ALIAS_NOUNS`, `ALIAS_COLORS` server-only).
Adapters `buzz`, `buzz_reply` (`anon:true`; `staffContext` = root + parent chain + 3 siblings each side through the blind serializer with `isMine:false`; `setLocked`).
Card resolver `buzz`. Notification hook: close due polls → `buzz.poll_closed`. Analytics via `trackEvent` with the `buzz_*` names only.
**Exports:** `BuzzPane` (already inside foundation's incognito Surface). **Gate = an inline in-pane panel, never a Sheet/Dialog/portal:** when
`useMe().buzzGateAcceptedVersion !== GUIDELINES_VERSION` the pane renders, inside the incognito Surface and below the top bar, a panel "Before your first buzz"
(safety §1.1 rules) with **[I understand]** → `POST /me/guidelines {kind:'buzz'}` and **[Not now]** → `setTab(previous non-Buzz tab ?? 'reels')`. It renders
only while `active === true` (all three panes are mounted on Home load — an inactive Buzz pane renders an empty incognito canvas and nothing else), and the slice
makes **no `/api/buzz` request** (queries `enabled: false`) until the gate is accepted. Top-bar tabs, horizontal swipe and the bottom nav stay fully usable, so a
swipe Reels → Buzz → Orbit never gets stuck and reloading on `/home/buzz` is not a trap. `/buzz/:threadId` and `/buzz/mine` show the same panel with a Back
button instead of "Not now". A 403 `buzz_gate_required` (version bump mid-session) → `refreshMe()` → the panel. After acceptance: sort/scope row; prompt card; cold-start; FAB = mask on dashed button; composer Sheet with
`ComposerModeBanner mode="incognito"`; no `UserAvatar`, no `@handle` linkify) · `BuzzRoutes` (`/buzz/mine`, `/buzz/:threadId`; mounts its own `<Surface mode="incognito">`).
`openReport({ entityType, entityId }, 'incognito')` — **never pass `author`**. No Block. No localStorage. Drafts in a zustand store registered with `registerStoreReset`.
**Seeds:** 60 prompts; 180 threads / ~900 replies / ~4,500 votes at `full` (30 / 120 / 400 at `lite`), 110 hero; power-law scores; 12 polls; 2 auto-hidden; 1 collapsed;
Maya: 3 own threads (`buzz_0001` with 14 replies, `buzz_0002` poll — **`closes_at` in the future** (3 days) so the lazy `buzz.poll_closed` hook cannot add a 13th notification; every already-closed seeded poll has `closed_notified = 1`; `buzz_0003`), notifications `buzz.reply` (unread) + `buzz.milestone` (read). Tone per product §5.
**Owner-seeded moderation fixtures (FINAL ids, §7.5; in addition to the counts above; authors = background users, never personas):** `buzz_0101` — the RA-insult buzz of product §5, `status 'hidden'`; `buzz_0102` — the vague building-threat buzz of product §5, `status 'active'`. The admin seed (NN = 11, runs last) builds their `mod_queue` / `reports` / `moderation_events` rows; buzz seeds only the content.
**Seed text hygiene:** Buzz seed text MUST NOT contain any §7.2–§7.4 handle or display name (students, orgs, staff — e.g. write "the hackathon club", not "Hack Night"), case-insensitive; the seed asserts this against `kit.users.all` and throws, because the firewall tests substring-match every seeded identity string.
**Tests (safety §8.2 #1–#4, mandatory):** forbidden-key walk + identity-substring walk over **every** endpoint above (all sort×scope), Buzz notifications, captured ws payloads;
alias stability/unlinkability/collision suffix/absent from DB; `createdAt % 60000 === 0`; block-oracle byte equality; 404 parity on foreign delete; gate 403;
**public-signal isolation (mandatory):** after user X posts a buzz, replies and votes — `public_activity` row count unchanged; X's `post_count`, `reel_count`, `last_public_post_at` unchanged; no `notifications` row with a non-null `actor_id` was created (the HTTP-level twin — `/api/discover/home` + `/api/onboarding/suggestions` byte-identical for another viewer before/after — lives in foundation's full-mode `tests/core/integration.firewall.test.ts`); self-harm text → allowed + support + P0 queue row; poll results hidden until vote; rate limit with `RATE_LIMITS=on`.
**Acceptance:** a fresh user lands on Reels with **no overlay**; can swipe Reels → Buzz → Orbit without accepting; "Not now" returns to the previous tab; reloading on `/home/buzz` is not a trap; no `/api/buzz` request is made before acceptance; cannot read Buzz before the gate; alias stable in-thread, different across threads; "You · {alias}" on own items; votes optimistic with undo; collapsed/hidden rules; logout wipes all Buzz state.

### 5.4 `orbit` (04) — mount `/api/orbit`

**Tables:**
```
orbit_posts(id, author_id→users, university_id, text DEFAULT '', images_json DEFAULT '[]', has_poll, status, auto_hide_immune,
  like_count, comment_count, created_at, updated_at)  INDEX(author_id, status, created_at DESC)
orbit_poll_options(id, post_id→orbit_posts, idx, text, vote_count)   orbit_poll_votes(post_id, user_id, option_id, created_at, PK(post_id,user_id))
orbit_likes(post_id→orbit_posts, user_id→users, created_at, PK)
orbit_comments(id, post_id→orbit_posts, author_id→users, parent_id NULL→orbit_comments, text, status, auto_hide_immune, reply_count, created_at)
orbit_visits(user_id PK→users, last_seen_at)
```
**Shared:**
```ts
export interface PostPoll { options: { id: Id; text: string; votes: number; pct: number }[]; totalVotes: number; myChoice: Id | null }
export interface Post { id: Id; author: UserSummary; text: string; images: MediaImage[]; poll: PostPoll | null; likeCount: number; commentCount: number;
  viewer: { liked: boolean; isSelf: boolean }; status: ContentStatus; createdAt: EpochMs }
export interface CreatePostRequest { text: string; images?: MediaImage[]; poll?: { options: string[] } }      // text or images or poll required
export interface PostComment { id: Id; postId: Id; parentId: Id | null; author: UserSummary; text: string; replyCount: number; replies: PostComment[];
  viewer: { isSelf: boolean }; status: ContentStatus; createdAt: EpochMs }
export interface OrbitFeedResponse extends Paginated<Post> { lastVisitAt: EpochMs | null; followingCount: number }
export interface LikeState { liked: boolean; likeCount: number }
```
**Endpoints:** `GET /feed` → `OrbitFeedResponse` (authors ∈ follows ∪ self, strictly `created_at DESC`, nothing injected) · `GET /feed/new-count?since=` → `{ count }` ·
`POST /feed/seen` → 204 · `GET /users/:userId/posts` → `Paginated<Post>` · `GET /posts/:id` → `Post` · `POST /posts` `CreatePostRequest` → `WithModeration<Post>`
(surface `orbit_post`, poll options moderated too; `assertOwnImages(≤4)`; rate `orbit_post`; polls need age ≥ 24 h; `markPublicActivity(…,'post')`;
`publishToUsers(followerIdsOf(author), { type:'orbit.new_post' })` when active) · `DELETE /posts/:id` → 204 (own; status `deleted`, `unmarkPublicActivity`, `removeNotificationsFor`) · `PUT|DELETE /posts/:id/like` → `LikeState` (`notify('post.like')`) ·
`GET /posts/:id/likers` → `Paginated<UserListItem>` · `POST /posts/:id/poll/vote` `{ optionId }` → `PostPoll` · `GET /posts/:id/comments` → `Paginated<PostComment>` ·
`POST /posts/:id/comments` `{ text, parentId? }` → `WithModeration<PostComment>` (surface `comment`, entity `orbit_comment`, rate `comment`, notify) · `DELETE /comments/:id` → 204 (own, or the post author).
Adapters `orbit_post`, `orbit_comment`. Card resolver `post`.
**Exports:** `OrbitPane` (feed query key MUST be `['orbit','feed', …]` — reserved, §4.4.5, so follow/unfollow refreshes it; renders `<FollowingReelsRail/>` from `@/features/reels` on top; "New posts" pill from `useRealtime('orbit.new_post')` + 60 s `new-count`;
"New since your last visit" divider; end cap "You're all caught up."; FAB avatar + plus; composer Sheet with public `ComposerModeBanner`, `MediaPicker max=4`; internal links
(`/market/:id`, `/campus/events/:id`, `/reel/:id`, `/u/:handle`) in text → `ShareCardView variant="compact"` via `GET /cards/:kind/:id`) · `OrbitRoutes` (`/post/:id`) · `UserPostsList`.
**Seeds:** ~90 posts (25 at lite), ~55 hero, 40 % with 1–4 images (`kit.art.nebulaSvg` with glyph), 8 polls, ⅓ from orgs; **Maya 5 posts** (`post_0001…0005`);
comments/likes from follows; Maya notifications `post.like` (read) + `post.comment` (unread).
**Tests:** feed contains only follows + self and is strictly chronological; unfollow removes; block both ways (posts, comments, likers); new-count; poll single vote; held post invisible to followers; images must be own uploads.
**Acceptance:** empty states per product; optimistic like + double-tap on photo; `Lightbox`; mosaic without layout shift; pill + divider + end cap work.

### 5.5 `discover` (05) — mount `/api/discover`

**Tables:** `discover_dismissals(user_id→users, target_id→users, section, created_at, PK(user_id,target_id,section))`.
**Reads only core tables** (`users`, `follows`, `blocks`, `public_activity` / `publicActivityStats`, `universities`). MUST NOT read any slice table. Never Buzz.
**Shared:**
```ts
export type SuggestionSection = 'people_you_may_know' | 'active_creators' | 'popular_orgs';
export interface Suggestion { user: UserListItem; reason: string /* "CS · 3 mutuals" | "4 reels this week" | "184 followers at UT Austin" */; section: SuggestionSection }
export interface DiscoverHome { peopleYouMayKnow: Suggestion[]; activeCreators: Suggestion[]; popularOrgs: Suggestion[]; isEarlyCampus: boolean }
export interface SearchHit { user: UserListItem; matched: 'name' | 'handle' | 'major'; sameCampus: boolean }
export type DiscoverSearchResponse = Paginated<SearchHit>;   // ONE list, ordered campus-first server-side (sameCampus DESC, then rank); the client splits on `sameCampus` for the two section headers
export const INTEREST_OPTIONS: readonly string[];       // ~40 chips for Edit profile
// MAJORS (major typeahead on Edit profile) comes from @shared/core.
```
**Endpoints:** `GET /home` → `DiscoverHome` (≤ 12 / 10 / 10; excludes followed, blocked, dismissed, self, non-active; minors never suggested cross-campus; PYMK = same campus ∧ (same major ∨ same class year ∨ ≥ 1 mutual), ranked by mutuals; active creators = `public_activity` in last 14 d; popular orgs = campus orgs by `follower_count`) ·
`POST /dismiss` `{ userId, section }` → 204 (`suggestion_dismiss`) · `GET /search?q&type=all|people|orgs&cursor&limit` → `DiscoverSearchResponse` = `Paginated<SearchHit>` (campus-first ordering is part of the keyset cursor; rate `search`; tracks `search`).
Profile, follow lists, follow, block, edit → foundation endpoints #10, #22–#26.
**Exports:** `DiscoverRoutes` (home with Campus-hub hero card linking `/campus`, `/campus/events`, `/campus/courses`, `/market`, `/roommates`; search with local recents `uv:discover:recent`, highlight) ·
`ProfileRoutes` (profile query key MUST be `['users', user.id]` — reserved foundation key, §4.4.5; when loading by handle use `['users','handle', handle]` and `setQueryData(['users', id])`; profile: banner derived from id, chips Founding member / New account / Unverified org, mutual line, `FollowButton` + Message (`openDm`) + overflow (Copy link, Share, Report `profile`, Block);
tabs **Reels** `<UserReelsGrid/>` · **Posts** `<UserPostsList/>` · **About** · orgs: **Events** `<OrgEventsList/>`; own profile: Edit + Share + gear → `/settings`; org starter card; blocked-by-me shell with Unblock; generic "This profile isn't available." on 404) · `EditProfilePage` (`PATCH /me`, `MediaPicker variant="avatar"`, handle availability, discard Dialog).
**Seeds:** 3 dismissals for Maya. **Tests:** suggestions exclude followed/blocked/dismissed; reasons derive from real rows; search is one `Paginated<SearchHit>` ordered campus-first across page boundaries + block exclusion + suspended users and hidden-university (`uni_team`) users absent; runs with **all slice tables empty** (proves isolation); no response contains Buzz fields.
**Acceptance:** search debounce 250 ms with skeleton rows; each suggestion shows a reason and can be dismissed; profile tabs render the other slices' components and degrade to nothing if they return null.

### 5.6 `messages` (06) — mount `/api/conversations`

**Tables:** none of its own (`06-messages.sql` stays a comment). All reads/writes go through `lib/conversations.ts` (§4.2.11); the slice MUST NOT
write `conversations`/`conversation_members`/`messages`/`message_reactions` with raw SQL (raw `SELECT` is allowed).
**Shared:**
```ts
export interface ConversationMember extends UserListItem { role: 'owner' | 'member'; lastReadMessageId: Id | null }
export interface ConversationDetail extends ConversationSummary { members: ConversationMember[]; canSend: boolean; cannotSendReason: 'request_pending' | 'blocked' | 'left' | null;
  requestBanner: RecipientBanner | null; mutualCount: number /* DM requests */ }
export interface CreateGroupRequest { title?: string; memberIds: Id[] /* 2..49 */ }
export interface UpdateConversationRequest { title?: string; muted?: boolean }
export interface OfferActionRequest { action: 'accept' | 'decline' | 'withdraw' }
export const QUICK_REPLIES: { listing: string[]; roommate: string[] };     // templates with {price10} {meetupSpot}
```
**Endpoints:**
| method path | in | out |
|---|---|---|
| `GET /?tab=chats\|requests` | | `Paginated<ConversationSummary>` |
| `GET /:id` | | `ConversationDetail` (404 for non-members / `declined` / `left`) |
| `GET /:id/messages` | | `Paginated<Message>` (newest first; reading a request does NOT mark read) |
| `POST /:id/messages` | `SendMessageRequest` | `WithModeration<Message>` — surface `message` (dm) / `group_message`; `modCtx(..., { isMessageRequest })`; rate `message_send`; `recipientBanner` → `SendInput.banner`; images: `assertOwnImages(≤4)`, refused (< 24 h account → non-follower); `kind:'offer'` refused here (offers are created by `market`); `kind:'card'` allowed (`resolveCard` must be available) |
| `DELETE /:id/messages/:messageId` | | `Message` (deleted-for-everyone, own only) |
| `PUT /:id/messages/:messageId/reaction` | `{ emoji: MessageReactionEmoji \| null }` | `Message` |
| `POST /:id/messages/:messageId/offer` | `OfferActionRequest` | `Message` (`setOfferStatus`) |
| `POST /:id/read` | `{ messageId }` | 204 |
| `POST /:id/accept` · `POST /:id/decline` | | 204 (`request_accept` / `request_decline` events) |
| `POST /groups` | `CreateGroupRequest` | `ConversationSummary` — `requireCanPost`, rate `group_create`, account age ≥ 24 h, title surface `group_name`, blocked pairs rejected |
| `PATCH /:id` | `UpdateConversationRequest` | `ConversationSummary` |
| `POST /:id/members` | `{ userIds: Id[] }` | `ConversationDetail` (groups only; owner or member; calls `addMember(…, { addedBy: req.user.id })` → `message.group_added`) |
| `DELETE /:id/members/me` | | 204 (leave; course chats too) |

Query keys MUST start with `['messages', …]` (reserved, §4.4.5 — foundation invalidates the prefix on ws reconnect). `useRealtime('conversation.updated')` →
invalidate that conversation's detail + inbox row (this is how the pinned card flips to "Sold" live — market/roommates call `touchContext`); `message.updated` / `message.deleted` patch the thread cache.
**Requests between strangers (the normal Market path):** the requester's composer shows "Request sent — waiting for {firstName}" (from `cannotSendReason:'request_pending'`) instead of a dead
input after their one message; an `offer` bubble may still arrive/leave in a pending request (cap exemption, §4.2.11); the recipient's Accept on the **offer** also accepts the request.
Report: `openReport({ entityType:'message'|'conversation', entityId, author })` — the ReportSheet shows the `includeContext` opt-in for these types (foundation).
**Exports:** `MessagesRoutes`. Inbox (Chats | Requests(n); requests with `context` first, labelled `contextLabel`; client filter box; course chip; mute icon) · thread (grouped bubbles,
day separators, optimistic send with `clientId`, "Not delivered. Tap to retry.", typing via `sendWs('typing.set')` + `useRealtime('typing')`, "Seen {time}" / group read stack,
`MediaPicker` + `Lightbox`, reactions (double-tap = ❤️), reply-to, delete, **pinned live `ShareCardView variant="pinned"`** from `ConversationSummary.context`, offer bubble with
Accept/Decline (seller) → on accept Dialog "Mark as sold?" → `POST /api/market/listings/:id/sold` (degrade: hide on 404), quick replies from `context` (`price`, `meetupSpot`),
one-time safety tip on first listing chat, recipient banners with Block & report, withheld images "Accept to view photos", request bar Accept / Delete / Block / Report, `collapsedByBlock`
rows, `ReconnectBar` from `useWsStatus`) · new chat (foundation `GET /users/search`, multi-select → group) · group info (rename, add, mute, leave; course chats not renamable;
course chats show "Textbooks for {code}" link → `/market?course=` and "Invite classmates" → copy `/c/:courseId`). Presence via `sendWs('presence.subscribe')`.
`location.state.draft` pre-fills the composer (used by roommates opener / market).
**Seeds:** for Maya: 6 DMs (sofiaram, arjunp, hannahkim, noahg, jordan_builds, priya_n; 8–25 messages each, 2 unread), 2 groups ("CS 429 project team", "Apartment hunt"),
2 requests (from `graceade` plain; from `owenpark` plain with a B-OFFPLATFORM banner); plus ~10 conversations among other personas; notification `message.request` (unread).
(Listing/roommate/course conversations are seeded by market/roommates/campus.)
**Tests:** request rules (non-follower → Requests, one message until accepted, images withheld, no read receipt before accept, decline → 30-day cooldown 403);
block → 403 `cannot_message` same copy as privacy setting; group collapse flag; offer accept only by listing owner (with a stub `listing` card resolver registered in the test and removed with the returned `unregister()`); **two users who do not follow each other:** text then offer in a pending request → offer delivered (cap exempt), second text 403 `request_pending`, second pending offer 409, owner `accept` → conversation `active` for both + `conversation.updated` + `message.updated`; `addMember` with `addedBy` notifies, self-join does not; ws events captured
(`message.new`, `read`, `typing` not leaked to requests); PRIVATE moderation: PII allowed, first-request phone → banner, scam → delivered + banner, threat → 422; report window ≤ 11 messages only with opt-in.
**Acceptance:** two browser sessions chat in realtime; reconnect bar + refetch; context card updates to "Sold" live; unread badges in nav match rows.

### 5.7 `roommates` (07) — mount `/api/roommates` (campus-only, always `university_id = viewer's`)

**Tables:**
```
roommate_profiles(id, user_id UNIQUE→users, university_id, mode NULL CHECK IN('need','have'), budget INTEGER NULL, move_in TEXT NULL /* 'YYYY-MM' */, lease_months INTEGER NULL,
  -- mode/budget/move_in are NULL only while published_at IS NULL ("match preferences" row of a user who chose "Just browse & match")
  neighborhoods_json DEFAULT '[]', living_with CHECK IN('anyone','same_gender') DEFAULT 'anyone', gender NULL CHECK IN('woman','man','nonbinary'), about DEFAULT '', photos_json DEFAULT '[]',
  place_json NULL /* { rent, roomType:'private'|'shared', beds, baths, furnished, utilitiesIncluded } */, answers_json /* RoommateAnswers */, dealbreak_smoking, dealbreak_pets,
  archetype, status, auto_hide_immune, paused, low_price_flag, published_at NULL, confirmed_at NULL, created_at, updated_at)  INDEX(university_id, status, paused)
roommate_saves(user_id→users, profile_id→roommate_profiles, created_at, PK(user_id,profile_id))
```
**Shared:**
```ts
export const ROOMMATE_QUESTIONS = ['sleep','clean','noise','guests','hosting','smoking','pets','sharing'] as const;
export type RoommateQuestion = (typeof ROOMMATE_QUESTIONS)[number];
export type RoommateAnswers = Record<RoommateQuestion, 0 | 1 | 2 | 3>;           // option copy + tags in QUESTION_DEFS
export const QUESTION_DEFS: Record<RoommateQuestion, { title: string; options: [string, string, string, string]; tags: [string, string, string, string] }>;
export const COMPAT_WEIGHTS: Record<RoommateQuestion, number> = { clean: 20, sleep: 20, noise: 15, smoking: 15, guests: 10, pets: 10, hosting: 5, sharing: 5 };   // sums to 100 (product's 7 weights + hosting split from guests)
export interface Compatibility { pct: number; capped: boolean; dimensions: { q: RoommateQuestion; similarity: number }[]; both: string[]; differs: string[]; sentence: string }
export interface RoommatePlace { rent: number; roomType: 'private' | 'shared'; beds: number; baths: number; furnished: boolean; utilitiesIncluded: boolean }
export interface RoommateCard { id: Id; user: UserSummary; firstName: string; classLabel: string | null; major: string | null; mode: 'need' | 'have'; budget: number; moveIn: string;
  neighborhoods: string[]; tags: string[] /* 3 */; archetype: string; coverUrl: string | null; compat: Compatibility | null /* null when viewer has no answers */;
  isNewAccount: boolean; lowPriceFlag: boolean; saved: boolean; createdAt: EpochMs }
export interface RoommateDetail extends RoommateCard { about: string; photos: MediaImage[]; leaseMonths: number | null; livingWith: 'anyone' | 'same_gender'; place: RoommatePlace | null; answers: RoommateAnswers }
export interface MyRoommateProfile extends Omit<RoommateDetail, 'mode' | 'budget' | 'moveIn'> { mode: 'need' | 'have' | null; budget: number | null; moveIn: string | null /* null only while unpublished */;
  status: ContentStatus; paused: boolean; published: boolean; publishedAt: EpochMs | null; needsConfirmation: boolean; gender: 'woman' | 'man' | 'nonbinary' | null; dealbreakSmoking: boolean; dealbreakPets: boolean }
/** publish:false ("Just browse & match") needs ONLY answers + the two dealbreakers; everything else is optional and may be null.
 *  publish:true ("Post that I'm looking") additionally REQUIRES mode, budget, moveIn, neighborhoods (≥ 1), livingWith → else 400 validation_failed. */
export interface UpsertRoommateProfileRequest { answers: RoommateAnswers; dealbreakSmoking: boolean; dealbreakPets: boolean; publish: boolean;
  mode?: 'need' | 'have' | null; budget?: number | null; moveIn?: string | null; leaseMonths?: number | null; neighborhoods?: string[]; livingWith?: 'anyone' | 'same_gender'; gender?;
  about?: string; photos?: MediaImage[]; place?: RoommatePlace | null }
export interface RoommateFilters { mode?: 'need' | 'have'; budgetMin?: number; budgetMax?: number; moveIn?: string; leaseMonths?: number; neighborhoods?: string[]; livingWith?: 'anyone' | 'same_gender'; sort?: 'best' | 'newest' | 'budget' }
```
Compatibility (in `services/roommates/compat.ts`, pure, unit-tested): `pct = round(Σ w_q · (1 − |a_q − b_q| / 3))`; dealbreaker conflict (`dealbreak_smoking` vs other `smoking ≥ 2`;
`dealbreak_pets` vs other `pets = 3`, either direction) → `min(pct, 35)`, `capped: true`. `both` = tags where answers are equal, `differs` = |Δ| ≥ 2.
Archetype = `{clean ≥ 2 ? 'Tidy' : 'Easygoing'} {sleep ≤ 1 ? 'Early Bird' : 'Night Owl'}`.
**Visibility rule (binding):** a profile is visible to anyone but its owner **only when `published_at IS NOT NULL`** (and `status='active'`, not paused). `GET /`, `GET /saved`,
`GET /:id` (→ 404 unless self) and the `roommate` card resolver (→ `null`/unavailable) all AND this in. An unpublished row exists solely to compute the owner's match %; it is never listed,
never counted, never a card, never reportable, and its owner can still browse, save and message published posts.
**Endpoints:** `GET /` (`RoommateFilters`) → `Paginated<RoommateCard>` (excludes **unpublished**, self, paused, non-active, blocks, `living_with` mismatch: a `same_gender` profile is only shown to viewers whose own profile has the same `gender`; `best` sort computed in memory over the campus set (≤ 500) then paged by offset cursor) ·
`GET /me` → `{ profile: MyRoommateProfile | null }` · `PUT /me` `UpsertRoommateProfileRequest` → `WithModeration<MyRoommateProfile>` (`publish:true` sets `published_at` (+ `confirmed_at`) when null and tracks `roommate_profile_publish`; `publish:false` never unpublishes an already-published post — use `POST /me/unpublish`; surface `roommate_listing`; `is_adult !== true` + `publish` → 403 `forbidden` "You need to be 18 or older to publish a roommate post."; rate `roommate_edit`; low-price flag: `have` rent < 50 % of campus median with ≥ 10 comparables → `enqueueSystemFlag(system,p3)` + `low_price_flag`) ·
`POST /me/pause` · `/me/resume` · `/me/confirm` · `/me/unpublish` (sets `published_at = NULL`, keeps answers and filters) → `MyRoommateProfile` (each calls `touchContext('roommate', id)`) · `DELETE /me` → 204 (`touchContext`) · `GET /saved` → `Paginated<RoommateCard>` · `GET /:id` → `RoommateDetail` · `PUT|DELETE /:id/save` → `{ saved }` (silent, no notification).
Adapter `roommate_listing`. Card resolver `roommate` (title "{firstName} · {mode label}", subtitle "{budget}/mo · {moveIn}", badge "{pct}% match" for the viewer, `status: 'paused'` when paused, `price = budget`).
Notification hook (published profiles only): `MAX(published_at, confirmed_at)` older than 30 d → one `roommate.still_looking`; older than 60 d → auto-pause. Lifecycle hook: banned/deleted → status `removed`.
**Exports:** `RoommatesRoutes`. Browse | Saved | My profile. **First run (no row yet)** shows two explicit, equal choices: **"Post that I'm looking"** (full editor → review step with
public `ComposerModeBanner verb="Posting" note="Your post links to your public profile @handle"` → `publish:true`) and **"Just browse & match"** (8 questions + 2 dealbreakers → `publish:false`
→ Browse with ranked match %; filters persist in `uv:roommates:filters`). My profile shows the state plainly: "Not posted — only you can see this. [Post it]" vs "Posted · visible at {university} [Pause] [Unpublish]".
Banner "Answer 8 quick questions to see your match %." when no answers; card = first name only; compat `ProgressRing` (≥ 85 % gets `bouncy`);
detail "Why you match" bars + sentence; `SafetyCard` (safety §7.5 copy) on detail and before first contact; Message → `openDm({ userId, context:{kind:'roommate', id}, draft: opener })` where opener =
"Hey {firstName} — looks like we're both {sharedTag} looking near {area} for {month}."; neighborhoods from `GET /universities/me/places?kind=neighborhood` + custom; `MediaPicker max=6` with hint
"Avoid photos that show house numbers, mail, or documents."; `/roommates?mode=have` deep link (from Apartments).
**Seeds:** Maya's `published_at` and `confirmed_at` are **≤ 14 days old** (so the `roommate.still_looking` hook cannot add a 13th notification); one bg user has an **unpublished** match-preferences row (never listed). ~35 published hero-campus profiles (12 at lite) incl. personas sofiaram (need, early/spotless), priya_n (have), emmalq (quiet), lucas_oli, zoemtz, calebt…; **Maya's profile complete**; compat vs Maya spans 38–96 %
(≥ 3 profiles ≥ 90 %, ≥ 4 < 50 %, ≥ 1 capped by dealbreaker); Maya saved 3; one roommate DM Maya ↔ `zoemtz` with context card via `kit.convo.dm(..., { context })` (never reuse a pair seeded by `messages`: sofiaram, arjunp, hannahkim, noahg, jordan_builds, priya_n).
**Tests:** compat math table (incl. cap), filter combos, **match-without-posting: a `publish:false` profile (answers only) is absent from `GET /`, `GET /saved`, 404 on `GET /:id` for others, `unavailable` as a card, yet `GET /` returns `compat` for its owner; `publish:true` without basics → 400; unpublish hides again**, under-18 publish 403, street address in `about` → 422 M-PII, discriminatory text → 422 M-LISTING-DISCRIM, paused hidden from browse + card `paused`, save silent (no notification row), block both ways, card resolver output.
**Acceptance:** a user with **no post** picks "Just browse & match", answers the 8 questions, sets filters, sees ranked % matches, messages a post — and never appears in Browse (verified from a second account); the other path publishes a post that does appear; questionnaire one tap per card ≤ 2 min; ranking visibly changes with answers; filters echo as chips; pause/resume; context card pinned in the opened chat.

### 5.8 `market` (08) — mount `/api/market` (campus-only)

**Tables:**
```
market_listings(id, seller_id→users, university_id, type CHECK IN('sell','trade','free','wanted','lost','found'), category, title, description DEFAULT '', price INTEGER NULL,
  trade_for TEXT NULL /* ≤ LIMITS.listingTradeFor; required when type='trade' */,
  condition NULL CHECK IN('new','like_new','good','fair'), course_code NULL, meetup_spot NULL, location_text NULL /* lost/found */, occurred_on TEXT NULL /* 'YYYY-MM-DD' */,
  photos_json DEFAULT '[]', status, auto_hide_immune, state CHECK IN('active','sold','returned') DEFAULT 'active', closed_at NULL, expires_at, low_price_flag,
  view_count, save_count, created_at, updated_at)  INDEX(university_id, status, state, created_at DESC), (seller_id), (university_id, course_code)
market_saves(user_id→users, listing_id→market_listings, saved_price INTEGER NULL, created_at, PK(user_id,listing_id))
market_views(listing_id, user_id, day TEXT, PK(listing_id,user_id,day))
```
**Shared:**
```ts
export const LISTING_TYPES = ['sell','trade','free','wanted','lost','found'] as const;  export type ListingType = (typeof LISTING_TYPES)[number];
export const LISTING_CATEGORIES = [{ id:'textbooks', label:'Textbooks' }, { id:'furniture', label:'Furniture' }, { id:'electronics', label:'Electronics' }, { id:'dorm_kitchen', label:'Dorm & Kitchen' },
  { id:'clothing', label:'Clothing' }, { id:'bikes_scooters', label:'Bikes & Scooters' }, { id:'tickets', label:'Tickets' }, { id:'other', label:'Other' }] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]['id'];  export type ListingCondition = 'new' | 'like_new' | 'good' | 'fair';  export type ListingState = 'active' | 'sold' | 'returned' | 'expired';
export interface ListingCard { id: Id; type: ListingType; category: ListingCategory; title: string; price: number | null /* whole units of the campus currency */; tradeFor: string | null; coverUrl: string | null; meetupSpot: string | null; courseCode: string | null;
  state: ListingState; saved: boolean; lowPriceFlag: boolean; createdAt: EpochMs }
export interface SellerTrust { memberSince: EpochMs; isNewAccount: boolean; activeListings: number; completedListings: number; classLabel: string | null }
export interface Listing extends ListingCard { description: string; condition: ListingCondition | null; photos: MediaImage[]; locationText: string | null; occurredOn: string | null; seller: UserSummary;
  sellerTrust: SellerTrust; viewer: { isSelf: boolean; hasConversation: boolean; conversationId: Id | null; requestPending: boolean /* my request is not accepted yet */; hasPendingOffer: boolean }; stats: { views: number; saves: number; chats: number } | null /* owner only */; status: ContentStatus; expiresAt: EpochMs }
export interface UpsertListingRequest { type; category; title; description?; price?: number | null; tradeFor?: string | null; condition?; courseCode?: string | null; meetupSpot?: string | null; locationText?; occurredOn?; photos: MediaImage[] }
export interface ListingFilters { q?; category?; type?; min?; max?; condition?; within?: '24h' | '7d' | '30d'; course?; sort?: 'newest' | 'price_asc' | 'price_desc' }
export interface OfferRequest { amount: number }   export interface OfferResponse { conversationId: Id; messageId: Id }
// MarketSummary (GET /summary) is a CROSS-SLICE payload (campus hub reads it) → it lives in @shared/core, not here.
export const PROHIBITED_ITEMS_COPY: string[];   export const MARKET_SAFETY_POINTS: string[];   // safety §7.4 final copy
```
**Endpoints:** `GET /listings` (`ListingFilters`) → `Paginated<ListingCard>` (active + not expired; sold/returned stay 7 days) · `GET /listings/:id` → `Listing` (records a view/day; removed/blocked → 404 "This listing is no longer available.") ·
`POST /listings` → `WithModeration<Listing>` (surface `market_listing`, fields title + body + **`tradeFor` (its own moderated field, `field:'body'`)**; rate `listing_create` + `enforceActiveCap`; `assertOwnImages(≤6)`; `courseCode` via `normalizeCourseCode`, only for `textbooks`;
**price / tradeFor rule for all six types** (else 400): `sell` → price required (> 0), tradeFor null · `trade` → **tradeFor required** (1–80 chars), price optional ("or {price}") · `free` / `wanted` / `lost` / `found` → price null, tradeFor null; `expires_at = now + 30 d`; low-price flag (electronics/tickets/bikes < 30 % median, ≥ 10 comparables) → `enqueueSystemFlag`) ·
`PATCH /listings/:id` `Partial<UpsertListingRequest>` → `WithModeration<Listing>` (price decrease → `notify('market.price_drop')` to every saver, `actorId = seller`; `touchContext('listing', id)`) · `DELETE /listings/:id` → 204 (own; status `deleted`; `touchContext`) ·
`POST /listings/:id/sold` `{ state: 'sold' | 'returned' }` → `Listing` (`listing_sold`; **`touchContext('listing', id)`** so the pinned card flips live in every open chat) · `POST /listings/:id/relist` → `Listing` (`touchContext`) · `PUT|DELETE /listings/:id/save` → `{ saved, saveCount }` ·
`GET /saved` → `Paginated<ListingCard>` · `GET /mine?state=active|closed` → `Paginated<ListingCard & { stats }>` · `POST /listings/:id/offers` `OfferRequest` → `OfferResponse`
(not own, listing `sell` + active; `openDm(viewer, seller, { kind:'listing', id })` → `sendMessage({ kind:'offer', offer })` → `notify('market.offer')`; `listing_offer`.
**Works inside a pending request** — buyers and sellers are usually strangers: the offer is exempt from the one-message cap, a second pending offer → 409 `conflict`, the seller accepting the offer also accepts the request, §4.2.11) · `GET /summary` → `MarketSummary` (core type).
`stats.chats = conversationCountForContext('listing', id)`. `Listing.viewer.conversationId / requestPending / hasPendingOffer` come from raw `SELECT`s on the core conversation tables (R2 allows reads). Adapter `market_listing`. Card resolver `listing` (status `sold`/`returned`/`unavailable` (expired/removed), `price`, `badge` "FREE"/"TRADE"/"WANTED"/"LOST"/"FOUND"/"Sold", subtitle "for {tradeFor}" on trade listings, `meetupSpot`, `ownerId`).
Adapter `setStatus` and the lifecycle hook also call `touchContext`.
Lifecycle hook: banned/deleted seller → listings `removed`. Admin rule packs cover prohibited items; market adds only the client copy "This looks like a prohibited item ({category label}). See what can't be listed."
**Exports:** `MarketRoutes`. Browse grid + chips + filter sheet + sort + search (`?q`, `?course`, `?type`); no-result action "Post a Wanted for "{q}"" → `/market/new?type=wanted&title=`; detail (carousel, seller card → profile,
trust chips, `SafetyCard`, "Price is unusually low. Take extra care.", Message seller → first-contact interstitial once (`uv:market:firstcontact`) → `openDm({ userId, context:{kind:'listing', id} })`, Make offer sheet with −10 % / −20 % chips (`sell` only), Save, `openShare`, Report with listing sub-reasons).
**Trade listings:** card + detail show "Trade · for {tradeFor}" (+ "or {price}" when set); Make offer is replaced by **Propose a trade** → `openDm({ userId, context, draft: "I could trade … for your {title}" })`.
**Request-aware buttons (no dead controls):** when `viewer.requestPending` the detail shows the chip "Request sent — waiting for {firstName}" and Message seller becomes "Open chat"; Make offer stays enabled unless `viewer.hasPendingOffer` (then disabled label "Offer sent"); 409 → toast;
create/edit (photos first, "Make cover", meetup presets from `GET /universities/me/places?kind=meetup` + custom, public `ComposerModeBanner verb="Listing"`); my listings (Active | Closed, stats, Edit / Mark sold|returned / Delete); saved.
**Seeds:** ~60 hero listings (20 at lite) + ~10 per medium campus: 8 sold, 6 free, 5 wanted, 4 lost/found, 12 textbooks with course codes matching campus seed codes; photos = `kit.art.productTileSvg` (≥ 3 variants per category);
**Maya: 2 active (`lst_0001` "TI-84 Plus CE" $45, `lst_0002` "IKEA desk lamp" $15) + 1 sold (`lst_0003`), 5 saved**; listing chat `ethan_ng → Maya` about `lst_0001` with a **pending $40 offer** (Maya follows him → lands in Chats, labelled "About your listing"); **a second listing chat from a buyer Maya does NOT follow — `chloedub → Maya` about `lst_0002`: one text ("Is the lamp still available?") + a pending $12 offer, seeded with `kit.convo.dm(…, { context, peerState:'request' })` so it sits first in Maya's Requests** (silent → no notification row; the 12/7 invariant holds); notifications `market.offer` (unread, from ethan_ng), `market.price_drop` (read). ≥ 4 `trade` listings with `trade_for`.
**Owner-seeded moderation fixture (FINAL id, §7.5):** `lst_0061` — the Rx-stimulant **Wanted** listing of product §5 by a background user, `status 'held'` (seeds write SQL directly, so the rule engine's 422 does not apply); the admin seed builds its queue rows.
**Tests:** filters/sort/search; campus isolation; price / tradeFor rules for all six types (table-driven); `tradeFor` moderated; **offer between two users who do not follow each other** (text then offer in a pending request → 201; second pending offer → 409; seller accept → both `active`); `touchContext` emits `conversation.updated` on sold; sold leaves browse after 7 d, expiry after 30 d (clock); save + price-drop notification fan-out; offer creates conversation + offer message + notification, own-listing offer 400; prohibited text (Rx stimulant wanted) → 422; block hides both ways; card resolver statuses; views counted once per day.
**Acceptance:** list an item in < 1 min; grid has no layout shift; sold ribbon; a **stranger** (no follow either way) messages, then offers — no dead button, "Request sent" state shown; seller accepts from Requests → chat moves to Chats → "Mark as sold?" → the pinned card flips to "Sold" live for the buyer; a trade listing shows "for {tradeFor}" and Propose a trade.

### 5.9 `campus` (09) — mount `/api/campus`

**Tables:**
```
events(id, host_id→users, university_id, title, description DEFAULT '', category CHECK IN('academic','social','sports','career','arts'), starts_at, ends_at, location_name,
  address NULL, address_private, cover_url, free_food, capacity INTEGER NULL, status, auto_hide_immune, cancelled_at NULL, going_count, interested_count, created_at, updated_at)
  INDEX(university_id, status, starts_at)
event_rsvps(event_id→events, user_id→users, state CHECK IN('going','interested'), reminded_at NULL, created_at, PK(event_id,user_id))
courses(id, university_id, code, title, term, conversation_id, created_by NULL→users, created_at, UNIQUE(university_id, code, term))
campus_milestones(university_id, goal INTEGER, reached_at, PK(university_id, goal))
```
**Shared:**
```ts
export const EVENT_CATEGORIES = ['academic','social','sports','career','arts'] as const;  export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventFilter = 'today' | 'week' | 'free_food' | EventCategory;   export type RsvpState = 'going' | 'interested';
export interface EventCard { id: Id; title: string; category: EventCategory; startsAt: EpochMs; endsAt: EpochMs; locationName: string; coverUrl: string; freeFood: boolean; host: UserSummary;
  goingCount: number; friendsGoing: UserSummary[] /* ≤ 3 follows */; myRsvp: RsvpState | null; cancelled: boolean }
export interface EventDetail extends EventCard { description: string; address: string | null /* null unless public or viewer is going/host */; addressPrivate: boolean; capacity: number | null; isFull: boolean;
  interestedCount: number; viewer: { isHost: boolean; isFollowingHost: boolean }; status: ContentStatus; createdAt: EpochMs }
export interface UpsertEventRequest { title; description?; category; startsAt; endsAt; locationName; address?: string | null; addressPrivate?: boolean; coverUrl: string /* preset url or own upload */; freeFood: boolean; capacity?: number | null }
export interface Course { id: Id; code: string; title: string; term: string; memberCount: number; lastActiveAt: EpochMs | null; joined: boolean; conversationId: Id | null /* when joined */; unread: number }
export interface CreateCourseRequest { code: string; title: string }
// `today.newListings` is filled client-side from GET /api/market/summary → `MarketSummary` (@shared/core).
export interface CampusHub { university: University; launch: { count: number; goal: number | null /* null → "5,000+ students" */ }; today: { events: number; freeFood: number; newListings: number | null };
  todayEvents: EventCard[]; upcoming: EventCard[]; myCourses: Course[] }
export const LAUNCH_GOALS = [25, 100, 500, 1000, 2500, 5000] as const;
```
**Endpoints:** `GET /hub` → `CampusHub` (`newListings` is filled **client-side** from `GET /api/market/summary`; server returns `null`) · `GET /events?filter=&hostId=` → `Paginated<EventCard>` (upcoming, `starts_at ASC`; campus-only) ·
`GET /events/:id` → `EventDetail` · `POST /events` → `WithModeration<EventDetail>` (surface `event`; rate `event_create`; capacity > 50 needs age ≥ 7 d; `coverUrl` ∈ preset urls ∪ own upload; `markPublicActivity(…,'event')`) ·
`PATCH /events/:id` `Partial<UpsertEventRequest>` → `WithModeration<EventDetail>` (host; time/place change → `notify('event.updated')` to RSVPs) · `POST /events/:id/cancel` → `EventDetail` (`notify('event.cancelled')`, `unmarkPublicActivity`) ·
`PUT /events/:id/rsvp` `{ state: RsvpState | null }` → `EventCard` (capacity; first `going` → `notify('event.rsvp')` to host, collapsed) · `GET /events/:id/attendees?state=` → `Paginated<UserListItem>` (follows first; blocks excluded) ·
`GET /users/:userId/events` → `Paginated<EventCard>` (hosted, upcoming then past) · `GET /courses?q=` → `Paginated<Course>` · `GET /courses/mine` → `Paginated<Course>` (all rows, `nextCursor: null`) · `GET /courses/:id` → `Course` (404 other campus) ·
`POST /courses` `CreateCourseRequest` → `Course` (`requireCanPost`, rate `course_create`, `normalizeCourseCode`, title surface `group_name`; duplicate → 409 `conflict` with `details: { course: Course }`;
`createCourseConversation({ universityId, courseId, code /* normalised */, title /* course name */, term, createdBy })` + `addMember(owner)` + first system message from product §2.9) · `POST /courses/:id/join` → `{ conversationId }` (`addMember` **without `addedBy`** → a self-join never raises `message.group_added`; system line "{firstName} joined", `course_join`) · `POST /courses/:id/leave` → 204.
Notification hook: `going` RSVPs with `starts_at − now ≤ 60 min` and `reminded_at IS NULL` → `event.reminder`. Milestones: on hub fetch, when `memberCount` crosses the next `LAUNCH_GOALS` entry → insert `campus_milestones` + `notify('campus.milestone')` to campus users (actor null). Adapter `event`. Card resolvers `event` (status `cancelled`/`ended`), `course`.
**Exports:** `CampusRoutes` (hub: member count + launch meter ring + [Share invite link] using `useMe().inviteCode`, Today sentence, Your courses rail with unread dots, Upcoming, quick links Roommates/Marketplace/Apartments/Guidelines/Invite; events list with chips incl. Free food; detail with RSVP pair, friends-going stack, attendees `UserListSheet`, `.ics` download (client-generated Blob), share, report, host edit/cancel, "Follow {org}?" prompt after RSVP to an unfollowed org host; create/edit with 8 cover presets or `MediaPicker max=1`; courses directory) · `CourseJoinPage` (`/c/:courseId`: preview → Join → `/messages/:conversationId`) · `OrgEventsList`.
**Seeds:** 20 events (8 at lite), 16 hero, all within the next 14 days, 2 today, 5 free food, 14 org-hosted, RSVPs 4–240 (full) from bg users, **Maya 3 RSVPs** (one starts in ~50 min → reminder demo: campus seeds the `event.reminder` notification (unread) **and sets that RSVP's `reminded_at`** — notification and `reminded_at` always together, never one without the other, so the lazy hook cannot create a duplicate);
25 hero course chats (8 at lite) with codes from product §5, 8–310 members, created with **`kit.convo.course(...)` + `kit.convo.join(...)`** (silent — never the live `createCourseConversation`/`addMember`, which would notify and publish), ≥ 15 messages each via `kit.convo.say`, last message < 48 h; **Maya in CS 429, M 408D, SDS 320E, GOV 310L**; `campus_milestones` rows consistent with seeded counts.
**Tests:** filters (today/week/free_food/category); RSVP counters + capacity; private address hidden until going; cancel notifies; lazy reminder generated once; course dedupe 409 with existing course; join is idempotent and lands in a `course` conversation; other-campus course 404; event with street address allowed, description "girls free" flagged; block excludes attendees/hosts.
**Acceptance:** Today strip reads as a sentence; course search → create → invite link → second user joins via `/c/:id`.

### 5.10 `apartments` (10) — mount `/api/apartments`

**Tables:** `apartment_survey_answers(id, user_id→users, university_id, question CHECK IN('when','budget','priorities'), answer_json, created_at, updated_at, UNIQUE(user_id, question))`.
**Shared:**
```ts
export const SURVEY: { id: 'when' | 'budget' | 'priorities'; title: string; multi: boolean; max: number; options: { id: string; label: string }[] }[];   // product §2.10 copy
export type SurveyQuestionId = (typeof SURVEY)[number]['id'];
export interface SurveySplit { question: SurveyQuestionId; total: number; options: { id: string; count: number; pct: number }[] }   // viewer's campus
export interface SurveyState { answers: Partial<Record<SurveyQuestionId, string[]>>; completed: boolean; splits: SurveySplit[] /* only for answered questions */ }
```
**Endpoints:** `GET /survey` → `SurveyState` · `PUT /survey/:question` `{ answer: string[] }` → `SurveySplit`. Waitlist = foundation #34–#35 (`feature:'apartments'`). Notifications = #31–#32. Settings = #9–#20, #15, #16.
**Analytics (binding, Constitution §0.6):** `apartments.page_view` (once per session, `{ source: 'nav' | 'campus' | 'link' }`) · `apartments.dwell` (on leave, `dwellBucket`) · `apartments.cta_click` · `apartments.cta_undo` · `apartments.survey_start` ·
`apartments.survey_answer` `{ question, answer }` · `apartments.survey_complete` · `apartments.share_click` · `apartments.roommates_crosslink_click`. All through `track()`; user + university + time are attached server-side.
**Exports:** `ApartmentsPage` (poster per design §7.7; count line "{n} students at {university} are waiting." when n ≥ 10 else "Be one of the first at {university}."; ring pulse on join; survey card with live split after each answer; cross-link → `/roommates?mode=have`) ·
`NotificationsPage` (groups Today / This week / Earlier; chips = `NOTIFICATION_FILTERS`; rows by §4.4.4 — `anonymous: true` rows render the mask disc and MUST NOT render `UserAvatar`; inline `FollowButton followsMe initialFollowing={n.actorFollowedByViewer}` on `follow.new` (no per-row profile fetch); list query key MUST be `['notifications', filter]` — reserved, §4.4.5; money in copy via `formatPrice`; tap → mark read + navigate `href`; Mark all read; `useRealtime('notification')` prepends) ·
`SettingsRoutes` (Account: email read-only, university, Edit profile → `/me/edit`; Notifications: toggles per `NotificationCategory` except `safety` + quiet hours; Privacy & safety: who can message, Blocked users (unblock), My buzzes → `/buzz/mine`, How Buzz anonymity works;
Appearance: reduce motion, autoplay; Invite friends: link, copy, "{n} joined from your link"; Account status (`/settings/account-status` — **the only screen a suspended/banned user can reach besides the `SanctionGate`; this slice owns the appeal form**, §4.4.2: render with `useMeOptional()`, no BottomNav, only endpoints #7/#9/#17–#19): `GET /me/sanctions`, acknowledge, appeal form → `POST /appeals`; About: Guidelines, Terms, Privacy, version; Trust & Safety row for staff → `/admin`; Sign out → `logout()`; Delete account typed `DELETE`) · `LegalPage` (static Terms / Privacy; public).
Survey `budget` bucket labels are rendered through `formatPrice` thresholds in the viewer's campus currency (numeric thresholds are not converted in v1).
**Seeds:** ~260 waitlist rows (40 at lite) across campuses incl. **Maya joined, survey unanswered** — written with **`kit.waitlist(user, 'apartments', at, source)`** (R2: `waitlist` is a core table; no direct SQL); survey answers for ~60 % of waitlisters; ~1,400 `apartments.*` analytics events over 30 days via `kit.track` shaped so the funnel reads ≈ 100 % views → 38 % CTA → 61 % of CTA completing the survey.
**Tests:** survey validation (options, `max` 2 for priorities), split math campus-scoped, idempotent waitlist join/leave + real counts, tracked events land in `analytics_events` with user + university, settings patch cannot disable `safety`, notification list filter mapping + anonymous rows carry `actor: null`.
**Acceptance:** Get notified morphs optimistically and survives reload; every tap listed above produces an event row; notifications deep-link and collapse; settings changes persist; blocked list unblocks.

### 5.11 `admin` (11) — mount `/api/admin` (router-level `requireRole('moderator','admin')` → 404 for others; `noStore`)

**Tables:** `admin_rule_pack_state(pack_id PK, enabled, updated_by, updated_at)` · `admin_saved_filters(id, staff_id→users, name, filter_json, created_at)`.
Writes core tables `mod_queue`, `reports`, `moderation_actions`, `strikes`, `user_sanctions`, `appeals`, `audit_log`, `users.role/is_verified` **through `lib/moderation/staff.ts`, `lib/audit.ts`** (direct SQL only where no helper exists, always with an `audit()` row in the same `tx`).
Content is touched only through `getContentAdapter()` / `applyContentStatus()` — never another slice's tables.
**Shared (`shared/src/admin.ts`):**
```ts
export type QueueView = 'priority' | 'wellbeing' | 'held' | 'auto_hidden' | 'reports' | 'escalated' | 'appeals' | 'mine' | 'closed';
export type StaffAction = 'approve' | 'remove' | 'remove_and_warn' | 'remove_and_mute_24h' | 'remove_and_mute_72h' | 'remove_and_mute_7d' | 'warn_only' | 'dismiss_reports' | 'lock_thread'
  | 'escalate' | 'escalate_external' | 'suspend_7d' | 'suspend_30d' | 'ban' | 'lift_sanction' | 'restore';
export interface StaffQueueItem { id: Id; entityType: ContentEntityType; entityId: Id | null; surface: ModerationSurface; anon: boolean; universityShortName: string; source: string; category: ModerationCategory | null;
  severity: ModerationSeverity; priority: ModerationPriority; label: string | null; status: 'open' | 'claimed' | 'escalated' | 'closed'; resolution: string | null; reportCount: number; excerpt: string; contentStatus: ContentStatus | null;
  claimedByMe: boolean; claimedByOther: boolean; slaDueAt: EpochMs; createdAt: EpochMs; closedAt: EpochMs | null }
/** Staff view of a sanction: SanctionNotice WITHOUT contentExcerpt/contentLabel (those exist only on GET /me/sanctions), plus origin.
 *  Mirrors foundation's StaffSanctionRowCore (§4.2.14). Anon-origin rows: omitted entirely for moderators; for admins present with day-floored timestamps. */
export interface StaffSanctionRow extends Omit<SanctionNotice, 'contentExcerpt' | 'contentLabel'> { origin: 'public' | 'anon' }
export interface StaffAuthorPanel { kind: 'public'; user: UserSummary; accountAgeDays: number; strikePoints: number; sanctions: StaffSanctionRow[] }   // public entity types ONLY; values from staffStandingFor()
export interface StaffBlindAuthorPanel { kind: 'blind'; accountAge: '<24h' | '<7d' | '<30d' | '30d+'; strikePoints: string; priorByCategory: Record<string, string>; sanction: SanctionKind | null; otherOpenItems: string }
export interface StaffQueueItemDetail extends StaffQueueItem { fields: { field: string; text: string; spans: [number, number][] }[]; media: { url: string; kind: 'image' | 'video' }[]; ruleHits: { ruleId: string; category: ModerationCategory; subcode: string; severity: ModerationSeverity }[];
  signals: ModerationResult['signals'] | null; aiVerdict: unknown | null; context: unknown | null /* adapter.staffContext */; reports: { id: Id; reason: ReportReason; subReason: string | null; note: string | null; reporterTrust: 'high' | 'normal' | 'low'; reporter: UserSummary | null /* admin only, audited */; createdAt: EpochMs }[];
  history: { action: string; actorRole: Role; actorName: string | null; note: string | null; createdAt: EpochMs }[]; author: StaffAuthorPanel | StaffBlindAuthorPanel; suggestion: { action: StaffAction; reason: string } | null; canUnmask: boolean }
export interface StaffActionRequest { action: StaffAction; category: ModerationCategory; note?: string; reference?: string; confirmText?: string /* 'BAN' */ }
export const UNMASK_REASON_CODES = ['credible_threat','self_harm_emergency','child_safety','severe_repeat_harassment','legal_request','ban_evasion'] as const;
export interface UnmaskRequest { reasonCode: (typeof UNMASK_REASON_CODES)[number]; reason: string /* ≥ 30 */; confirmText: 'UNMASK'; caseRef?: string }
export interface UnmaskResponse { user: { id: Id; handle: string; displayName: string; email: string; universityId: Id }; unmaskId: Id; expiresAt: EpochMs /* now + 5 min, UI re-mask */ }
export interface AuditRow { id: Id; actor: { id: Id; displayName: string; role: Role } | null; action: string; targetType: string | null; targetId: Id | null /* null for targetType 'user' rows tied to an anon-origin queue item, except action 'buzz_unmask' for admins — serializeAuditRow, §4.2.14 */; queueId: Id | null; batchId: Id | null; reasonCode: string | null; reason: string | null; metadata: Record<string, unknown> | null /* stripped for moderators on buzz_unmask */; createdAt: EpochMs }
export interface StaffUserDetail { user: PublicUser; email: string | null /* admin only */; role: Role; status: UserStatus;
  strikePoints: number /* moderators: public-origin strikes only */; sanctions: StaffSanctionRow[]; openQueueItems: number /* moderators: public-origin items only */ }   // all three from staffStandingFor(userId, viewer.role)
/** Appeals are reviewed BLIND: no user field, ever. For origin 'anon' the row carries the appealed content (so it can be judged) but `sanction.id` is replaced by the
 *  appeal id and timestamps are day-floored, so it cannot be joined with /admin/users; the reviewer decides on content + appeal text alone. */
export interface StaffAppeal { id: Id; sanction: StaffSanctionRow; contentExcerpt: string | null; contentLabel: string | null; text: string; status: AppealStatus; createdAt: EpochMs; queueId: Id | null; canReview: boolean }
export interface AnalyticsOverview { range: { from: EpochMs; to: EpochMs }; signupsByCampus: { universityShortName: string; count: number }[]; dau: { day: string; count: number }[]; wau: number; activationRate: number;
  contentPerDay: { day: string; surface: string; count: number }[]; reportsPer1k: number; medianTimeToActionMin: number | null }
export interface ApartmentsFunnel { byCampus: { universityShortName: string; views: number; ctaClicks: number; surveyStarts: number; surveyCompletes: number; waitlist: number }[]; totals: { views: number; ctaClicks: number; surveyStarts: number; surveyCompletes: number; waitlist: number } }
export interface ModerationMetrics { openByPriority: Record<ModerationPriority, number>; oldestOpenMin: number | null; timeToFirstAction: Record<ModerationPriority, { medianMin: number | null; p90Min: number | null; slaMin: number }>;
  rulePrecision: { ruleId: string; flagged: number; removed: number; approved: number }[]; appealOverturnRate: number | null; autoHideReversalRate: { reports: number | null; score: number | null }; activeSanctions: Record<SanctionKind, number>; unmasksByReason: Record<string, number>; wellbeingPerWeek: number }
export const LIMITATIONS: { id: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'A1'; title: string; body: string }[];   // A1 = single-admin ban confirmation (§3.3)
```
**Endpoints:**
| method path | role | in → out |
|---|---|---|
| `GET /queue?view&surface&category&universityId&source&cursor` | mod | → `Paginated<StaffQueueItem>` (priority, then oldest; `queueVisibleTo`) · `GET /queue/counts` → `Record<QueueView, number>` |
| `GET /queue/:id` | mod | → `StaffQueueItemDetail` (claims 10 min; reported DM window view writes `dm_context_viewed`; reporter identity (admin) writes `reporter_viewed`) |
| `POST /queue/:id/claim` · `/release` | mod | → `StaffQueueItem` |
| `POST /queue/:id/actions` | per safety §6.1 | `StaffActionRequest` → `StaffQueueItemDetail` (note ≥ 10 except approve/dismiss; suspend/ban/lift/escalate_external admin only; `ban` needs `confirmText:'BAN'` + note ≥ 30; zero-tolerance categories auto-apply 7-day suspension on confirm; self-harm never sanctions; all in one `tx` with `recordAction`) |
| `POST /queue/bulk` | mod | `{ ids: Id[] (≤ 50); action: 'approve' \| 'remove' \| 'dismiss_reports'; category; note? }` → `{ results: { id; ok; error? }[]; batchId }` (not for p0/wellbeing/escalated/appeals) |
| `POST /buzz/:entityType/:id/unmask` | **admin** (mod → 404) | `UnmaskRequest` → `UnmaskResponse` — requires a queue item for the entity; audit row inserted **before** `resolveAuthorId`; rate `unmask` 10/day; `notify('admin.unmask_alert')` to all other admins |
| `GET /audit?actor&action&targetType&from&to&cursor` | mod: own rows; admin: all | → `Paginated<AuditRow>` (every row through `serializeAuditRow`; the CSV too) · `GET /audit/export.csv` (admin) |
| `GET /users?q=` · `GET /users/:id` | mod (email admin-only) | → `Paginated<StaffUserDetail>` / `StaffUserDetail` — **never contains Buzz text or any anon-origin row for moderators** (`staffStandingFor`); there is no endpoint that lists a user's Buzz content, for any role |
| `POST /users/:id/role` `{ role }` · `POST /users/:id/verify` `{ verified }` | admin | → `StaffUserDetail` (audited) |
| `POST /users/:id/sanctions` `{ kind; durationMs?; scope?; category; note }` · `POST /sanctions/:id/lift` `{ note }` | per §6.1 | → `StaffUserDetail` (direct, public-origin sanctions only; sanctions for Buzz content are applied **only** through `POST /queue/:id/actions`, which returns the blind `StaffQueueItemDetail`) |
| `GET /appeals?status=` · `POST /appeals/:id/decide` `{ outcome: 'upheld' \| 'reversed' \| 'reduced'; note; reducedUntil? }` | reviewer ≠ actor (403); suspensions/bans admin only | → `Paginated<StaffAppeal>` / `StaffAppeal` |
| `GET /analytics/overview?from&to&universityId` · `/analytics/apartments` · `/analytics/moderation` | mod | → `AnalyticsOverview` / `ApartmentsFunnel` / `ModerationMetrics` (reads `analytics_events`, `waitlist`, `users`, `public_activity`, moderation tables only; never breaks Buzz data down by user) |
| `GET /rule-packs` · `PATCH /rule-packs/:id` `{ enabled }` | admin | → `Paginated<{ id; version; ruleCount; enabled }>` (`nextCursor: null`; audited) |
| `GET /limitations` | mod | → `Paginated<(typeof LIMITATIONS)[number]>` (`nextCursor: null`) |

`StaffQueueItem` is structurally identical to foundation's `StaffQueueItemCore` (§4.2.14): foundation's `serializeQueueItem` supplies **every** field incl. `excerpt` and
`contentStatus`; admin adds none. `StaffQueueItemDetail` extras are admin's, built from `moderation_events`, `reports`, `moderation_actions`, the adapter (`fields`, `media`, `staffContext`)
and `StaffAuthorPanel` (public types, via `staffStandingFor`) or `blindAuthorStanding` (anon types). For anon-origin items `history[].note` and audit metadata MUST NOT contain a user id/handle
(actions target the entity, §4.2.14 rule 3).

At import time the router calls `registerRulePack()` for `admin.threats`, `admin.harassment`, `admin.hate`, `admin.sexual`, `admin.drugs`, `admin.selfharm`, `admin.pii`, `admin.impersonation`, `admin.spam`, `admin.academic`, `admin.commerce` (data files under `server/src/services/admin/rules/**`, server-only) — registration is pure (no DB). Re-applying `admin_rule_pack_state` happens in
`onDbReady(() => …)` (§4.2.2), never as a top-level query: at import time the table may not exist yet on a fresh / `:memory:` DB, and `onDbReady` also re-runs after every `resetDb()`.
**Exports:** `AdminRoutes` (utilitarian shell, tabs Queue · Users · Appeals · Audit · Analytics · Rules; Buzz excerpts inside a nested incognito chip-frame with **no alias unless the adapter context provides it, never an avatar**; unmask Dialog: reason code + reason ≥ 30 + typed `UNMASK`, result panel `gcTime: 0`, auto re-mask at `expiresAt`; funnel bars; sparklines as inline SVG; Limitations panel) ·
`GuidelinesPage` + `GuidelinesContent` (final copy = safety §1 verbatim; section ids = `GUIDELINE_ANCHORS` values + `buzz-anonymity`, `enforcement`; `variant="sheet"` = condensed, no page header).
**Seeds (NN = 11, runs last):** 9 open queue items — `buzz_0101` RA-insult buzz [hidden; auto-hidden view], `lst_0061` Rx-stimulant Wanted listing [held], link spam ×3 (reported `message`s in a bg-user group chat this seed creates itself with `kit.convo.group` + `kit.convo.say` — `message` is a foundation entity), `buzz_0102` vague building threat in Escalated, 1 wellbeing P0 (`blocked_text`, `entity_id NULL`), 1 appeal (on `ryanoc`'s mute), 2 plain reports (`profile` of a bg user; one of the spam messages' `conversation`) — plus 14 closed, 20 audit rows incl. 1 `buzz_unmask` with reason (for `buzz_0102`), 1 muted user (`ryanoc`, 24 h, public-origin), strikes consistent with actions.
The content rows `buzz_0101`, `buzz_0102`, `lst_0061` are **owner-seeded** (buzz §5.3, market §5.8; FINAL ids in §7.5) — admin never creates content (`ContentAdapter` cannot create, and admin may not write other slices' tables). For each, the admin seed builds `mod_queue` / `reports` / `moderation_events` rows **only after `getContentAdapter(type)?.load(id)` returns non-null**; otherwise it falls back to an equivalent `blocked_text` item (`entity_id NULL`) so the seed never depends on another slice having landed and the 9/14 counts always hold.
Seeded audit / action rows for anon-origin items target the entity, never a user (§4.2.14 rule 3). Seed text follows the Buzz seed-text hygiene rule (§5.3): no §7.2–§7.4 handle or display name in any `blocked_text` / excerpt.
**Tests (safety §8.2 #1 admin half, #5, #9–#10 where admin-owned):** non-staff 404 on every route; moderator vs admin matrix; **named-account firewall: a user is sanctioned through a Buzz queue item, then as moderator no `/admin/users?q=`, `/admin/users/:id`, `/admin/audit` body contains any `buzz_posts.text` substring (and every `/admin/appeals` body passes `assertNoIdentityLeak` — appeals are blind), that user's `strikePoints` / `openQueueItems` / `sanctions` are unchanged before vs after, and no audit row visible to the moderator has `targetType:'user'` with that `targetId`; as admin the sanction appears with `origin:'anon'`, no excerpt, day-floored timestamps**; `StaffQueueItem` ⇄ `StaffQueueItemCore` compile-time assignability; queue list + detail for anon entities pass `assertNoForbiddenKeys` + `assertNoIdentityLeak` for both roles; unmask: mod 404, short reason 400, ok 200 + audit row precedes + other admins notified; audit UPDATE/DELETE raise; appeal reviewer ≠ actor; bulk limits; claim lease; conflict-of-interest filter; ban adds `banned_emails` and blocks re-registration; rule-pack toggle audited; engine fixture tables for every admin pack (≥ 5 block/flag + ≥ 5 allow each, incl. leetspeak/spacing/homoglyph/zero-width/idiom guards); funnel math from seeded events.
**Acceptance:** a moderator clears a Buzz item without ever seeing identity; admin unmask ritual + 5-min re-mask; reporter gets the closing notification; guidelines page reachable signed-out at `/guidelines`.

---

## 6. Cross-slice dependency matrix

Mechanisms: **C** = React component export (§4.6 stub, so it always resolves) · **H** = HTTP API declared in §5 · **F** = foundation helper/endpoint/component ·
**R** = registry (adapter / card resolver / hook) registered by the provider and read by foundation. There are **no other** cross-slice edges; anything not
listed here is a contract violation. Every C/H consumer follows R6 (render nothing / hide the control when the provider is a stub or 404s).

| consumer | needs | provider | mech. | satisfied by |
|---|---|---|---|---|
| foundation `HomePage` | 3 panes | reels, buzz, orbit | C | `ReelsPane`, `BuzzPane`, `OrbitPane` (`HomePaneProps`) |
| foundation router | every page | all slices | C | §4.5 exports; stubs in §4.6 |
| orbit | reels rail above the feed | reels | C | `FollowingReelsRail` (renders nothing when empty) |
| discover (profile) | Reels / Posts / Events tabs | reels, orbit, campus | C | `UserReelsGrid`, `UserPostsList`, `OrgEventsList` (`UserContentProps`) |
| discover, auth | "active creators" without reading slice tables | reels, orbit, campus | F | providers call `markPublicActivity`; consumers read `users.last_public_post_at`, `public_activity`, `publicActivityStats` |
| discover, auth | counts on profiles | reels, orbit | F | `users.post_count` / `reel_count` maintained by `markPublicActivity` / `unmarkPublicActivity` |
| auth | full guidelines in a sheet | admin | C | `GuidelinesContent variant="sheet"`; fallback link `/guidelines` |
| auth (Welcome footer) | Terms / Privacy | apartments | route | `/legal/terms`, `/legal/privacy` (public) |
| auth, discover, reels, campus, apartments | follow / unfollow | foundation | F | `FollowButton`, `POST/DELETE /users/:id/follow`, `followUser()` |
| every public slice | report / block | foundation | F | `openReport`, `openBlock`, `POST /reports`, `sqlNotBlocked`, `sqlNotReported` |
| foundation reports + auto-hide, admin | load / hide / remove any content | every UGC slice | R | `registerContentAdapter` per `ENTITY_OWNER` |
| admin | Buzz context without identity | buzz | R | `ContentAdapter.staffContext` (blind serializer) |
| admin | upgraded detection | foundation engine | R | `registerRulePack()` |
| market, roommates | open a DM with a pinned context card | foundation | F | client `openDm({ userId, context, draft })` → `POST /dm`; server `openDm()` |
| market | offer message + notification | foundation | F | `openDm()` + `sendMessage({ kind:'offer' })` (cap-exempt inside a pending request, §4.2.11) + `notify('market.offer')` |
| market, roommates | live update of the pinned card in open chats | foundation | F | `touchContext(kind, id)` → ws `conversation.updated` → messages refetches |
| messages | accept/decline offer | foundation | F | `setOfferStatus()` (ownership via the `listing` card resolver) |
| messages | "Mark as sold?" after accepting | market | H | `POST /api/market/listings/:id/sold`; hide prompt on 404 |
| messages, orbit, foundation ShareSheet | render any shared card live | reels, orbit, market, roommates, campus, buzz | R + F | `registerCardResolver` → `resolveCard()` → `Message.card`, `ConversationSummary.context`, `GET /cards/:kind/:id`, `ShareCardView` |
| reels, orbit, market, campus, buzz, discover | share to chat | foundation | F | `openShare()` → `GET /share/targets`, `POST /share` |
| messages (new chat) | people search | foundation | F | `GET /users/search` (not discover's API) |
| campus | course chats are group conversations | foundation | F | `createCourseConversation({ …, code, title, term })` (foundation denormalises the course meta into `conversations`, so `ConversationSummary.course` never needs campus' table), `addMember` (no `addedBy` on self-join), `removeMember`, `sendSystemMessage`; seeds use `kit.convo.course/join`; UI lives in messages at `/messages/:id` |
| messages (course chat header) | "Textbooks for {code}" | market | route | link `/market?course={code}` (market reads the query param) |
| campus (Today strip) | new listings count | market | H | `GET /api/market/summary` → `MarketSummary` (**core type**); `null` → omit the clause |
| auth, discover | majors typeahead | foundation | F | `MAJORS` in `@shared/core` |
| admin (queue seed) | real content to moderate | buzz, market | R | owner-seeded `buzz_0101`, `buzz_0102`, `lst_0061` (§7.5), read through `getContentAdapter().load()`; fallback `blocked_text` |
| foundation (`FollowButton`, realtime) | cache refresh after follow / reconnect | orbit, reels, discover, apartments, messages | F | reserved query keys, §4.4.5 |
| foundation `SanctionGate` | appeal form for suspended users | apartments | route | `/settings/account-status` (admits `'restricted'` sessions) |
| campus, roommates, market | campus places (meetup spots, neighborhoods) | foundation | F | `GET /universities/me/places` |
| apartments (Notifications) | all notification rows | every slice | F | producers call `notify` / `notifyAnonymous`; renderer uses §4.4.4 + `Notification` union |
| campus, roommates, buzz | lazy notifications | foundation | R | `registerNotificationHook` |
| apartments | waitlist, settings, blocks, invite, sanctions, appeals | foundation | F | endpoints #13–#19, #34–#35; seed via `kit.waitlist` |
| apartments → roommates | cross-link | roommates | route | `/roommates?mode=have` |
| apartments → buzz | "My buzzes" | buzz | route | `/buzz/mine` |
| admin (analytics) | Apartments funnel, DAU, content/day | apartments + all | F | `analytics_events` (via `track`/`trackEvent`), `waitlist`, `public_activity`, `users` — core tables only |
| market, roommates | ban/deletion cleanup | foundation | R | `registerUserLifecycleHook` |
| all | realtime | foundation | F | `publishTo*`, `useRealtime`, `WsServerEvent` |

Proof of closure: every row's "satisfied by" is declared in §4 (F), in the provider's §5 entry (C/H/R), or is a route in §4.5. No slice reads another
slice's table, imports another slice's `@shared/<x>` file, or imports another slice's server code. The only cross-slice client imports are
`@/features/reels` (from orbit, discover), `@/features/orbit` (discover), `@/features/campus` (discover), `@/features/admin` (auth) — each limited to the C exports above.

---

## 7. Seed world (`server/src/db/seeds/00-core.ts` + `seeds/ids.ts`; ids are FINAL)

`seeds/ids.ts` exports `UNI`, `U` (personas, keyed by handle), `ORG`, `STAFF`, `DEMO = { student: U.mayachen, admin: STAFF.dana_w, admin2: STAFF.victor_o, moderator: STAFF.rileyshaw }`.
Id scheme: university `uni_<key>` · student `u_<handle>` · org `o_<handle>` · background `bg_<4 digits>` · slice rows `kit.id(prefix, n)`.
Emails: students `first.last@<domain>`, orgs `<handle>@<domain>`. Avatars: DiceBear seed = user id. Class years are computed at seed time from the standing
(FR/SO/JR/SR → graduating year; GR → `class_kind:'grad'`). All personas are `is_adult = 1` except `u_graceade` (`0`, exercises minor rules). All have accepted app guidelines + Buzz gate
and completed onboarding; `created_at` 30–400 days ago, except `u_graceade` (2 days → "New account" chip + reduced limits) and `u_leofischer` (10 hours → brand-new restrictions).

### 7.1 Universities
| id | name | shortName | domain | city | cc | users (full / lite) |
|---|---|---|---|---|---|---|
| `uni_utexas` (**hero**) | The University of Texas at Austin | UT Austin | `utexas.edu` | Austin | US | ~180 / 40 bg + personas |
| `uni_umich` | University of Michigan | UMich | `umich.edu` | Ann Arbor | US | ~35 / 5 |
| `uni_stanford` | Stanford University | Stanford | `stanford.edu` | Stanford | US | ~35 / 5 |
| `uni_nyu` | New York University | NYU | `nyu.edu` | New York | US | ~30 / 5 |
| `uni_utoronto` · `uni_ethz` · `uni_tum` · `uni_oxford` · `uni_nus` · `uni_iitb` · `uni_unimelb` | Toronto · ETH Zürich · TU Munich · Oxford · NUS · IIT Bombay · Melbourne | | `utoronto.ca` · `ethz.ch` · `tum.de` · `ox.ac.uk` · `u.nus.edu` · `iitb.ac.in` · `student.unimelb.edu.au` | | CA CH DE GB SG IN AU | 3–5 each / 0–1 |

Total ≈ 300 users at `full`. `campus_rank` = join order per campus (personas first ⇒ Founding members). UT Austin `campus_places`: meetup — "PCL lobby", "Texas Union front desk",
"GDC atrium", "Gregory Gym entrance", "UTPD safe-exchange zone"; neighborhood — "West Campus", "North Campus", "Hyde Park", "Riverside", "On campus"; venue — "PCL", "Texas Union", "GDC", "McCombs", "Intramural Fields", "Welch Hall". Other seeded campuses get the three generic meetup rows + "On campus" / "Near campus".

### 7.2 Student personas (40) — id = `u_<handle>`
| # | handle | name | campus | major | standing | role in the world |
|---|---|---|---|---|---|---|
| 1 | `mayachen` | Maya Chen | utexas | Computer Science | JR | **demo user** (§7.5) |
| 2 | `jordan_builds` | Jordan Okafor | utexas | Mechanical Engineering | SR | solar-car lead; build reels |
| 3 | `sofiaram` | Sofia Ramirez | utexas | Nursing | SO | roommate: early bird, spotless, needs a place |
| 4 | `arjunp` | Arjun Patel | utexas | Finance | JR | textbook listings, career posts |
| 5 | `priya_n` | Priya Natarajan | utexas | MS Data Science | GR | has-a-place roommate post; furniture wanted |
| 6 | `tbrooks` | Tyler Brooks | utexas | Undeclared (Business) | FR | dorm-food reels, intramurals |
| 7 | `aaliyah_w` | Aaliyah Washington | utexas | Journalism | SR | photo posts; most-followed student |
| 8 | `lucas_oli` | Lucas Oliveira | utexas | Architecture (exchange) | JR | selling bike + desk |
| 9 | `hannahkim` | Hannah Kim | utexas | Biology | JR | study-session events; course chats |
| 10 | `noahg` | Noah Goldberg | utexas | Radio-TV-Film | JR | best reels on campus |
| 11 | `emmalq` | Emma Lindqvist | utexas | Chemistry PhD | GR | quiet roommate post; lab-move sale |
| 12 | `diegoh` | Diego Hernandez | utexas | Kinesiology | JR | pickup-soccer events |
| 13 | `zoemtz` | Zoe Martinez | utexas | Psychology | SO | roommate chat with Maya |
| 14 | `ethan_ng` | Ethan Nguyen | utexas | Electrical & Computer Engineering | SR | makes the $40 offer on Maya's TI-84 |
| 15 | `oliviab` | Olivia Bennett | utexas | Marketing | JR | events board volunteer; posts |
| 16 | `marcusj` | Marcus Johnson | utexas | Economics | SR | tickets + furniture listings |
| 17 | `bellarossi` | Isabella Rossi | utexas | Studio Art | SO | art posts; PYMK candidate |
| 18 | `calebt` | Caleb Thompson | utexas | Civil Engineering | JR | roommate post (night owl, smoker → dealbreaker) |
| 19 | `fatima_as` | Fatima Al-Sayed | utexas | Public Health | JR | pantry volunteer events |
| 20 | `ryanoc` | Ryan O'Connor | utexas | Government | SO | **muted 24 h** (admin seed) |
| 21 | `meitanaka` | Mei Tanaka | utexas | Mathematics | SR | tutoring posts; M 408D chat |
| 22 | `andresilva` | Andre Silva | utexas | Computer Science | SO | same major as Maya; hack night |
| 23 | `graceade` | Grace Adeyemi | utexas | Neuroscience | FR | **2-day-old** account (`isNewAccount` < 72 h → reduced limits), under 18; sends Maya a request |
| 24 | `bencarter` | Ben Carter | utexas | Accounting | SR | follows Maya (not followed back) |
| 25 | `laylah` | Layla Haddad | utexas | Architecture | SO | roommate post; pet owner |
| 26 | `owenpark` | Owen Park | utexas | Physics | JR | follows Maya; request with phone number (B-OFFPLATFORM) |
| 27 | `chloedub` | Chloe Dubois | utexas | Linguistics (exchange) | JR | wanted listings; **stranger-buyer demo**: not followed by Maya, requests about `lst_0002` with a $12 offer |
| 28 | `samirk` | Samir Khan | utexas | MS Information Studies | GR | follows Maya; has-a-place roommate post |
| 29 | `ninakow` | Nina Kowalski | umich | Industrial Engineering | JR | |
| 30 | `devonw` | Devon Wright | umich | Sport Management | SO | |
| 31 | `aisharahman` | Aisha Rahman | umich | Public Policy | SR | |
| 32 | `leofischer` | Leo Fischer | umich | Computer Science | FR | 10-hour-old account |
| 33 | `kaiyama` | Kai Yamamoto | stanford | Symbolic Systems | JR | global reels |
| 34 | `elenap` | Elena Petrova | stanford | Bioengineering | SR | |
| 35 | `jamaled` | Jamal Edwards | stanford | Product Design | SO | |
| 36 | `tessam` | Tessa Moreau | stanford | Earth Systems | GR | |
| 37 | `rafacruz` | Rafael Cruz | nyu | Film & TV | JR | global reels |
| 38 | `hanasato` | Hana Sato | nyu | Media, Culture & Communication | SO | |
| 39 | `imaniclarke` | Imani Clarke | nyu | Drama | SR | |
| 40 | `liamtrem` | Liam Tremblay | utoronto | Engineering Science | JR | |

### 7.3 Orgs (12, `account_type:'org'`) — id = `o_<handle>`
| handle | name | campus | category | verified | followers (full) |
|---|---|---|---|---|---|
| `wic_ut` | Women in Computing | utexas | Academic | yes | ~150 |
| `solarcar` | Solar Car Team | utexas | Academic | no | ~90 |
| `events_board` | Student Events Board | utexas | Student government | yes | ~210 |
| `campusdaily` | The Campus Daily | utexas | Arts & Media | yes | ~180 |
| `clubsoccer` | Club Soccer | utexas | Sports & Rec | no | ~70 |
| `climbing_club` | Climbing Club | utexas | Sports & Rec | no | ~40 |
| `isa_ut` | Indian Students Association | utexas | Cultural | no | ~110 |
| `premed_society` | Pre-Med Society | utexas | Professional | no | ~95 |
| `filmsociety` | Film Society | utexas | Arts & Media | no | ~60 |
| `hacknight` | Hack Night | utexas | Academic | no | ~120 |
| `umich_robotics` | Robotics Society | umich | Academic | no | ~25 |
| `acappella_su` | A Cappella Collective | stanford | Arts & Media | no | ~20 |

Follower counts scale with the user count at `lite`; `users.follower_count` always equals the rows.

### 7.4 Staff (hero campus; normal student profiles with roles)
| id | handle | name | email | role |
|---|---|---|---|---|
| `u_dana_w` | `dana_w` | Dana Whitfield | `admin@utexas.edu` | admin (**demo admin**) |
| `u_victor_o` | `victor_o` | Victor Osei | `safety@utexas.edu` | admin (second admin: appeals `reviewer ≠ actor`, unmask alerts) |
| `u_rileyshaw` | `rileyshaw` | Riley Shaw | `mod@utexas.edu` | moderator |

Sign-in for any seeded account: enter the email → the Dev inbox toast shows the code → Fill. Demo student: **`maya.chen@utexas.edu`**.

### 7.5 Demo-user invariants (who seeds what; every number is backed by rows)
| invariant | owner |
|---|---|
| Maya follows **28**: orgs `wic_ut, solarcar, events_board, campusdaily, clubsoccer, isa_ut, premed_society, filmsociety, hacknight` (9) + personas #2–#16, `andresilva`, `ninakow`, `kaiyama`, `rafacruz` (19) | core |
| Maya has **41** followers: those 19 personas + `bencarter`, `owenpark`, `samirk` (Follow-back demo) + 19 background users | core |
| Maya's `invite_code = 'MAYA2026'`; `bg_0001`–`bg_0004` have `invited_by = u_mayachen` ("4 joined from your link") | core |
| Notifications for Maya — **12 total, 7 unread**: core `follow.new` ×2 (1 unread) · reels 2 (1) · orbit 2 (1) · buzz 2 (1) · messages 1 (1) · market 2 (1) · campus 1 (1). **Nothing may add a 13th on first load:** the collapsed `reel.like` is ONE row (`actorIds`); the campus reminder RSVP has `reminded_at` set; Maya's roommate `published_at`/`confirmed_at` ≤ 14 d; `buzz_0002` closes in the future and closed polls have `closed_notified = 1`; all `kit.convo.*` calls are silent. Foundation's full-mode integration test asserts `GET /me/badges` → `notifications: 7` twice in a row | each owner |
| 2 reels, `reel.like` + `reel.comment` | reels |
| 3 own Buzz threads (one with 14 replies), karma > 0 | buzz |
| 5 Orbit posts | orbit |
| 3 dismissed suggestions; PYMK shows `bellarossi`, `meitanaka`, `fatima_as`… | discover |
| 6 DMs + 2 groups + 2 requests (`graceade`, `owenpark`) — with market's `chloedub` request the Requests tab shows **3** (`Badges.requests = 3`), the listing one first | messages (+ market) |
| roommate profile complete; 3 saved; roommate chat with `zoemtz` (context card) | roommates |
| 2 active listings + 1 sold; 5 saved; listing chat from `ethan_ng` about `lst_0001` with a pending $40 offer (lands in Chats: Maya follows him); **request from `chloedub` about `lst_0002` with one text + a pending $12 offer (lands in Requests: Maya does not follow her)** | market |
| moderation fixtures with FINAL ids: `buzz_0101` (RA insult, `hidden`), `buzz_0102` (vague building threat, `active`) — texts exactly per product §5 | buzz |
| moderation fixture `lst_0061` (Wanted, Rx stimulant, `held`) — text exactly per product §5 | market |
| 3 RSVPs (one starting in ~50 min); member of CS 429, M 408D, SDS 320E, GOV 310L course chats | campus |
| on the Apartments waitlist, survey unanswered | apartments |
| 9 open / 14 closed queue items (incl. items for `buzz_0101`, `buzz_0102`, `lst_0061`; `blocked_text` fallbacks when an owner adapter is absent), 20 audit rows (1 unmask), `ryanoc` muted | admin |

Core seed also creates ~2,500 follow edges at `full` (clustered by campus + major + org), background users from a fixed name list with PRNG seed `20260921`, and never seeds real people,
professors, businesses, Greek chapters, slurs or graphic content. Seeds that create conversations use `kit.convo.*` (no context validation, no notifications, `silent`).
`db/reset.ts` and full-mode `createTestApp` import `routes/index.ts` **before** seeding so adapters/resolvers are registered; isolation-mode
`createTestApp({ slices })` imports only the named routers first (§4.2.16), which is why cross-slice seed dependencies (admin → buzz/market) MUST degrade.

---

## 8. Commands & verification checklist

```
npm run db:reset        # root → server: delete DB, migrate, run all seeds (SEED_SCALE=full)
npm run dev             # root: API :4000 + Vite :5173 (integration phase only — not during the feature phase)
npm run typecheck       # server + client tsc --noEmit
npm test                # server vitest (in-memory DB, SEED_SCALE=lite, no network)
npm run build           # client production build
```
Env: `PORT`, `DB_PATH`, `NODE_ENV`, `BUZZ_ALIAS_SECRET`, `CURSOR_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `SEED_SCALE`, `RATE_LIMITS`, `MODERATION_AI_API_KEY|PROVIDER|MODEL|TIMEOUT_MS`,
**`STAFF_EMAILS`** (`email:role,…` with role `admin|moderator`; the production bootstrap for Trust & Safety staff — §4.2.1, §4.2.15. A production deploy needs `RESEND_API_KEY` **and** `STAFF_EMAILS`; boot logs an error for each that is missing).
Agents MUST NOT run `npm install`. Feature phase: run `tsc` once near the end and after fixes; run only your own test file (`npx vitest run tests/<slice>.test.ts`).

**Foundation milestones (in order; typecheck + `tests/core/**` green at the end of each; never start the next one red):**
- **M1 — the brief's skeleton:** config, db (module-load migrate, `onDbReady`), core schema, email gate + OTP + sessions (+ `STAFF_EMAILS`, `mail_unavailable`), users/graph, theme + UI kit, shell / pager / top bar / nav, `lib/*` client modules, all stubs (§4.6), test harness (isolation + full mode), core seed (§7).
- **M2 — the shared engines:** moderation engine + baseline pack, reports / blocks / auto-hide, notify, realtime, conversations (incl. request cap + offers + `touchContext`), uploads (incl. QuickTime + file probe), content registry, waitlist, analytics (incl. pre-auth events), share.
- **M3 — staff + extras:** staff lib (incl. the anon-origin rule), sanctions / appeals, SanctionGate, audit, T2 foundation items (§1.3: second-pass interface, quiet hours, presence).

**Foundation done when:** both typechecks pass with all stubs; `npm test` passes (`tests/core/**`: auth flow incl. domain gate + OTP limits + devCode never in production + **503 `mail_unavailable` in production without a provider** + **`STAFF_EMAILS`: non-academic staff address passes the gate, gets the role + a `role_bootstrap` audit row, lands in hidden `uni_team`, and is absent from search/suggestions; a non-listed `gmail.com` is still rejected**; follow/block semantics §8.2 #12;
reports + auto-hide #9; sanctions #10; engine fixtures #6–#8 with the baseline pack; notify collapse + seed `actorIds` + anonymous CHECK constraint; conversations request rules incl. offer cap-exemption, implicit accept, `addedBy` semantics, `conversation.updated` producers; course meta serialised from `conversations` columns; uploads sanitising + magic bytes + MP4/QuickTime/WebM duration probe with `moov` at end + the single 60 500 ms tolerance; staff lib anon-origin rule (`staffStandingFor`, `serializeAuditRow`); registries last-write-wins + `unregister`; `#33` signed-out allow-list; avatar upload before guidelines; stubs check (no `features/*/index.ts`); cursor tamper → 400; audit triggers; full-mode integration tests that skip gracefully while slices are stubs);
`db:reset` yields §7 counts; the shell renders all six nav targets with stub panes; Me sheet, report/block/share hosts, SanctionGate (+ reachable `/settings/account-status` while restricted). **Pager / top bar / nav — explicit criteria (replaces "per design §6"):**
1. A touch or trackpad swipe moves **exactly one** pane (`scroll-snap-stop: always`) and the URL becomes `/home/:tab` (replace, not push).
2. Vertical scrolling, and horizontal scrolling inside `FollowingReelsRail`, chip rows and carousels (`scroll-x`) — including at their edges — never moves the pager.
3. A tab tap, ← / →, **and a mouse click-drag** all switch panes (the `pointerType === 'mouse'` handler of §4.4.3; a plain click still clicks).
4. Each pane keeps its own scroll position; panes receive `active`; Reels pauses when inactive.
5. A deep link / reload on `/home/orbit` paints on Orbit with no visible slide (initial `scrollLeft` set before first paint, `scroll-behavior: auto`).
6. The indicator goes white → lime → violet with `progress`; the nav pill is Phosphor only on Buzz.
7. **Identity:** at rest on `/home/buzz`, a DOM assertion finds no element inside `#frame` showing the viewer's avatar URL, display name or handle (the Me button shows the neutral glyph; §1.2); on Reels and Orbit the avatar is back.
8. With the stub `BuzzPane`, and later with the real one un-accepted, swiping Reels → Buzz → Orbit is never blocked (no modal, §5.3).

**Every slice done when:** its **T1** acceptance + tests pass before any T2 work started (R8), then its remaining §5 acceptance list passes or the dropped T2 items are listed · only owned files changed (`git status` shows nothing outside §5 "Owned files") · stub export names/props unchanged; entry is still `features/<slice>/index.tsx` with no sibling `index.ts` ·
**`tsc --noEmit` reports no errors in the slice's owned paths** (run it once in `server/` and once in `client/`, filter the output to owned paths; errors elsewhere are **reported, never fixed** — other agents are mid-flight) · its test file passes alone in isolation mode (`createTestApp({ slices: ['<slice>'] })`) · every create/edit surface shows `ComposerModeBanner`; no control without an endpoint (R7) · seed runs at `lite` and `full` and is idempotent under `db:reset` · no `Date.now()` in server code ·
no import from another slice except the §6 C-edges · no `position: fixed` / `100vh` / raw hex colours / spinners · no hard-coded hrefs or "$" · no network at runtime · final report lists any foundation gaps worked around, dropped T2 items and R7 omissions.
Full `npm run typecheck` in both packages and the full `npm test` suite (Constitution §8) are **orchestrator integration gates** (checklist step 1), not per-slice gates.

**Integration checklist (orchestrator):**
1. `npm run db:reset && npm run typecheck && npm test`.
2. Sign up with a fresh `@utexas.edu` address → onboarding → Home; then with `someone@gmail.com` (rejected) and `x@newcollege.edu` (auto-created campus, cold-start banner on Reels/Buzz).
3. As Maya: run the eight pager criteria of "Foundation done when" by hand — touch/trackpad swipe = one pane + URL; nested horizontal scrollers and vertical scroll never move the pager; tab tap, ←/→ and mouse click-drag all work in the ≥ 768 px frame; per-pane scroll kept, Reels pauses; reload on `/home/orbit` paints in place; indicator white → lime → violet, Phosphor nav pill only on Buzz; **no avatar/name/handle visible at rest on Buzz**. Post in each pane (a real `.mp4` and a `.mov` reel; a 75 s file is refused with `m:ss`), confirm the composer mode banner differs; Buzz thread alias stable; bell shows 7 (and still 7 after a reload). As a **fresh** user: lands on Reels with no overlay, swipes through Buzz without accepting, "Not now" works, reload on `/home/buzz` is not a trap.
4. Discover → profile tabs show reels/posts/events; follow/unfollow updates Orbit; block hides the user everywhere **except Buzz**.
5. Market, **with a buyer the seller does not follow** (sign in as `isabella.rossi@utexas.edu` — `bellarossi`, no follow either way with Maya — or a fresh account; `chloedub` already has her seeded pending request): Message seller pins a live card and lands in the seller's Requests; "Request sent — waiting for Maya" replaces the composer; Make offer still works (one pending offer); as Maya accept the offer from Requests → chat moves to Chats for both → Mark as sold → the card flips to "Sold" live in the buyer's open chat. Also check Maya's seeded state: ethan_ng's $40 offer in Chats, chloedub's $12 offer first in Requests. A trade listing shows "for {tradeFor}" + Propose a trade. Roommates → as a user with **no post**: "Just browse & match" → match % + opener draft, and that user never appears in Browse from a second account. Campus → join CS 314 via `/c/:id` (no "added you" notification for a self-join; chat header shows the code + "Textbooks for CS 314"), RSVP, `.ics`.
6. Apartments → Get notified + survey; as `admin@utexas.edu` open `/admin/analytics` → funnel moved. Queue: act on the Buzz item `buzz_0101` blind (remove + mute); unmask `buzz_0102` with reason → audit row + alert for `safety@utexas.edu`; as `mod@utexas.edu` unmask control absent and endpoint 404, **and `/admin/users/:id` of the just-sanctioned author shows no new sanction, unchanged strike points, and no Buzz text anywhere**. Production bootstrap: boot a scratch DB with `NODE_ENV=production STAFF_EMAILS=dev@example.com:admin` and a stub mailer → that address signs in and reaches `/admin`; without `RESEND_API_KEY` `/auth/start` returns 503 `mail_unavailable`.
7. Firewall: `npx vitest run tests/buzz.test.ts tests/admin.test.ts` green; grep Buzz responses for `u_` ids manually once.
8. Reduced motion + 360 px width + ≥ 768 px framed layout; with `/seed-media/reels/*` absent the feed still plays posters.
9. Two browsers: realtime DM, typing, read receipts, reconnect bar after killing the API for 5 s (inbox + notifications refetch on reconnect).
10. **Premium review (nobody has seen the UI until now — slices were built blind).** Capture 390×844 and 360×740 screenshots of: the 6 nav roots, the 3 Home panes, every composer (reel upload, Buzz, Orbit, comment bar, listing, roommate editor + review, event, group), one detail screen per slice, the Buzz gate panel, the Apartments joined state, Notifications, Settings, the SanctionGate, and the framed ≥ 768 px layout. Review **each** against this fixed rubric and tick every line:
    (a) one accent per screen · (b) `type-*` hierarchy visible (title / body / meta distinguishable at a glance) · (c) 16 px gutters, no clipped or overflowing text at 360 px · (d) skeleton geometry = content geometry, no shift on load · (e) no dead or empty controls (R7) · (f) no broken seed art / missing avatars · (g) the nav pill label fits · (h) Aurora vs Phosphor correct per surface, no avatar on Buzz · (i) `ComposerModeBanner` present on every composer · (j) prices formatted via `formatPrice`.
    Every failure goes back to the owning slice **with the screenshot**; the integration owner re-captures after the fix. The checklist is not complete until every rubric line is ticked for every screenshot.
