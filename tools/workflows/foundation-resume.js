export const meta = {
  name: 'universe-foundation-resume',
  description: 'Resume the foundation build: M1 and C1 are done on disk; run M2a∥M2b → M3 and finish C2, then review, fix and gate',
  phases: [
    { title: 'Build', detail: 'server chain and client chain run in parallel' },
    { title: 'Review', detail: 'contract/security reviewer (server) and contract/design reviewer (client)' },
    { title: 'Fix', detail: 'one fixer per side applies review findings' },
    { title: 'Gate', detail: 'db:reset, typecheck x2, tests, build, live auth smoke test' },
  ],
}

const ROOT = '/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752'

const PRE = `Project root (the path contains spaces — ALWAYS quote it, and prefer absolute paths): "${ROOT}"

Read these first, in this order, before writing anything:
1. "${ROOT}/docs/CONSTITUTION.md" (root authority)
2. "${ROOT}/docs/DECISIONS.md" (orchestrator addendum — note your LANE in D1; you edit only your lane)
3. "${ROOT}/docs/SPEC.md" — the intro rules R1–R8 (lines 1–40), §8 (the last ~50 lines: commands, milestones, "Foundation done when"), and then every section named in your task below, in full. Use grep -n '^##' to find sections.
4. "${ROOT}/shared/src/core.ts" — the frozen type contract. Import from '@shared/core'. Never edit it; if a type you need is missing, define it locally and report it.

Hard rules:
- Dependencies are already installed in client/ and server/. NEVER run npm install, never add a dependency, never run git.
- Stay in your lane. Files shared between lanes: surgical Edit only, re-Read right before editing, never overwrite with Write.
- Exported names, signatures, endpoint paths and response shapes must match SPEC exactly — eleven feature agents will later code against the SPEC text without seeing your code.
- No Date.now() in server code outside the single clock helper SPEC defines. No network at runtime.
- This machine has 8 GB RAM and other agents are running: run tsc/vitest only when you have something to check, and never leave a process running when you finish.
- Finish GREEN: your side's typecheck passes and your tests pass. If something outside your lane is broken, do not fix it — report it precisely.
- Your final message is data for the orchestrator: list files created, what is verified (with the command you ran), anything stubbed or deferred, every deviation from SPEC and why, and gaps you found in SPEC.`

const LANES = {
  SM1: `LANE S-M1 — server skeleton (SPEC milestone M1, server half). Read SPEC §4.1, §4.2.1–§4.2.5, §4.2.9, §4.2.15, §4.2.16, §4.3 (the auth/me/users/social endpoints), §4.6 (Server stubs + Seed kit), §6 and ALL of §7 (seed world; ids are FINAL).
Build: config, db (module-load migrate, onDbReady, resetDb, tolerant migrate in test), the COMPLETE 00-core.sql (every core table of §4.1, including the ones later lanes use), http helpers, graph, auth middleware, users lib, rate limit, mailer interface (console + Resend-over-fetch), the university email gate + bundled universities dataset + academic-domain patterns + personal/disposable blocklist + STAFF_EMAILS bootstrap + 503 mail_unavailable in production, OTP (hashed, expiry, attempts, cooldown), sessions, the auth/me/users/follow/block endpoints, app.ts/index.ts, routes/index.ts + routes/mounts.ts, the test harness lib/testing.ts (isolation + full mode), seedKit + seedArt (offline SVG art + DiceBear avatars), seeds/index.ts (dynamic loaders, async runSeeds), seeds/ids.ts, the 00-core seed (universities, 40 personas, 12 orgs, staff, background users, follows), db/reset.ts, every server-side and shared slice stub of §4.6.
ALSO (DECISIONS D1): create a compiling stub with the FINAL exported signatures for every foundation module that lanes S-M2a, S-M2b and S-M3 will implement, and every routes/core/*.ts file for all 40 endpoints (bodies throw HttpError 501 not_implemented), already mounted — so those lanes only replace bodies. seedKit methods that depend on those modules call them through the stub signatures.
Tests (server/tests/core/**): auth flow incl. domain gate, OTP limits, devCode never in production, mail_unavailable, STAFF_EMAILS bootstrap; follow/block semantics; cursor tamper → 400; stubs check; seed counts at lite scale.
Done when: server typecheck passes, \`npx vitest run\` passes, and \`npm run db:reset\` (from server/) completes and prints the §7 counts.`,

  SM2a: `LANE S-M2a — safety engines (SPEC milestone M2, first half). S-M1 has already created compiling stubs for your modules: replace bodies, keep signatures. Read SPEC §3 in full (binding), §4.2.6, §4.2.10, §4.2.12, the reports/blocks/uploads/cards rows of §4.3, and "${ROOT}/docs/blueprint/safety.md" §2–§3 for the engine detail (SPEC §3.3 lists the deviations).
Build: the moderation engine in lib/moderation/** (normalisation: leetspeak, spacing, homoglyphs; category taxonomy; BLOCK / FLAG / ALLOW with severities and user-facing messages; PII detectors; the baseline rule pack; a supportive self-harm response path; the OPTIONAL second-pass AI hook as an interface that is inert without its env var — do not call any network), reports + distinct-reporter auto-hide + mod_queue insertion, the content registry + card resolvers (last-write-wins, never throw, register returns unregister), uploads (magic-byte sniffing, filename sanitising, EXIF stripping strategy per SPEC, per-kind limits, disk storage for video, the MP4/QuickTime/WebM duration probe incl. moov-at-end, the single 60 500 ms tolerance).
Another agent (S-M2b) is working in parallel on notify/realtime/conversations — do not touch its files.
Tests: engine fixtures #6–#8 of SPEC §8, reports + auto-hide, registries, uploads sanitising + magic bytes + duration probe (build tiny synthetic MP4/WebM buffers in the test).`,

  SM2b: `LANE S-M2b — realtime engines (SPEC milestone M2, second half). S-M1 has already created compiling stubs for your modules: replace bodies, keep signatures. Read SPEC §4.2.7, §4.2.8, §4.2.11, §4.2.13, the waitlist/share parts of §4.2.15, §4.4.4 (notification types, data keys, copy), and the notifications/dm/share/waitlist/analytics rows of §4.3.
Build: notify (collapse rules, seed-only actorIds, the anonymous variant that cannot carry an actor + its CHECK constraint behaviour, quiet-hours hook left for S-M3), the ws hub (cookie-authenticated upgrade on /ws, sendToUser/sendToUsers, heartbeat, presence buckets interface), conversations as the ONLY writer of conversation/message tables (DMs, groups, course conversations with code/title/term columns, requests: one message until accepted, offer cap-exemption + 409 on a second pending offer, implicit accept, addMember addedBy/silent semantics, touchContext → conversation.updated, serializers), share, waitlist, analytics (incl. the signed-out allow-list for endpoint #33).
Another agent (S-M2a) is working in parallel on moderation/reports/content/uploads — do not touch its files. conversations must call moderateText through its existing signature even while that body is still a stub.
Tests: notify collapse + actorIds + anonymous constraint; conversations request rules, offers, implicit accept, addedBy semantics, conversation.updated producers, course meta; waitlist; analytics allow-list; a ws round-trip test.`,

  SM3: `LANE S-M3 — staff, sanctions and integration (SPEC milestone M3). M1 and M2 are done. Read SPEC §3.2 (anonymity firewall checklist — especially #9, the anon-origin rule), §4.2.9, §4.2.14, §4.2.15, the appeals / account-status / sanctions rows of §4.3, and §1.3 (foundation T2 items).
Build: audit (+ serializeAuditRow and the audit triggers), lib/moderation/staff.ts (recordAction, applySanction, addStrike, staffStandingFor with the moderator-vs-admin anon-origin behaviour, serializeQueueItem → StaffQueueItemCore), sanctions ladder + enforcement in requireAuth's allow-list for restricted sessions, appeals endpoint, anything in §4.2.15 still stubbed, then the T2 foundation items (quiet hours in notify, presence, launch-meter helpers) if time allows.
Then write the full-mode integration tests SPEC §8 asks of foundation (they must skip gracefully while slices are stubs), run the ENTIRE server suite and typecheck, and fix anything red in server foundation code (you may touch any S-* lane file for fixes at this point; keep edits surgical).`,

  C1: `LANE C-1 — theme and UI kit (SPEC milestone M1, client half, part 1). Read SPEC §2 in full (§2.1 theme block is pasted VERBATIM into client/src/app/styles/theme.css; §2.2 is the component/prop table; §2.3 deltas), then "${ROOT}/docs/blueprint/design.md" §1–§5 and the base-CSS appendix for the detail behind each component.
Build: index.html (viewport-fit=cover, theme-color, manifest link), public/ (PWA manifest + SVG app icons), self-hosted fonts via @fontsource-variable imports, base CSS (body never scrolls; #frame rules; no position:fixed, no 100vh), the type-* utilities, lib/motion.ts (the five springs + durations + reduced-motion helpers), lib/cn.ts, and EVERY component of §2.2 in client/src/ui/** with a barrel client/src/ui/index.ts: exact export names and props, forwardRef, className passthrough, all variants/sizes/states, keyboard + focus behaviour, reduced motion. The Sheet needs detents and velocity-aware drag-to-dismiss and must render inside the frame's overlay root, inheriting the Surface mode (Aurora vs incognito) through context. Also a minimal main.tsx and the dev-only gallery client/src/app/dev/KitGallery.tsx showing every component and state in BOTH modes.
This is the layer that makes the app feel premium — spend your effort on finish: spacing, states, motion restraint.
Done when: \`npx tsc --noEmit\` in client/ passes.`,

  C2: `RESUME NOTE: a previous agent on this lane was cut off. It already wrote client/src/lib/* (api, query, realtime, analytics, links, format, upload, session, dm, share, report, toast, hooks, moderation, navigation), client/src/stores/* (session, ui, home), client/src/components/* (UserAvatar, UserRow, FollowButton, MediaPicker, MediaBox, Composer, ShareCardView, Wordmark, feed, text — but NO components/index.ts barrel yet), and client/src/app/contracts.ts. Typecheck currently passes. READ those files first and keep them (fix/extend, do not rewrite). It did NOT write: app/App.tsx, app/router.tsx, the AppShell, bottom nav, Home pager, top bar, Me sheet, SanctionGate, the eleven features/<slice>/index.tsx stubs, the components barrel, ReportSheet/ShareSheet hosts. main.tsx currently boots the KitGallery via an import.meta.glob of ./app/App.tsx — once you create app/App.tsx it is picked up automatically; simplify main.tsx to import App directly.

LANE C-2 — client platform and app shell (SPEC milestone M1, client half, part 2). The UI kit exists in client/src/ui — read its barrel and use it; do not re-implement components. Read SPEC §1.2 (Home top-bar Me button), §4.4 in full (4.4.1 lib/stores, 4.4.2 shared composites, 4.4.3 app, 4.4.4 notification table, 4.4.5 reserved query keys), §4.5 (route table), §4.6 (client stubs + contracts.ts), the pager criteria 1–8 under "Foundation done when" in §8, DECISIONS D2, and "${ROOT}/docs/blueprint/design.md" §6.
Build: lib/* (api with the welcome/legal redirect exemptions, query client, realtime with reconnect + invalidation of the reserved keys, analytics/track that never throws + useDwell, links/routes builders, format incl. formatPrice, the client twin of normalizeCourseCode, uploads helpers), stores/*, every shared composite of §4.4.2 (UserAvatar, UserRow, FollowButton, ReportSheet + openReport, block flow, ShareSheet + openShare, MediaPicker, ComposerModeBanner, MediaBox, …) with a barrel, app/contracts.ts, app/router.tsx with lazy slice routes and guards, the AppShell (phone frame ≥768px over an aurora backdrop, safe areas, overlay root), the floating six-item bottom nav (active item expands with a shared layoutId; Phosphor only on Buzz), the Home pager (pure CSS scroll-snap, scroll-snap-stop: always, per-pane vertical scrollers, initial scrollLeft before first paint, URL replace on settle, ←/→ keys, the sanctioned mouse click-drag handler, the scroll-x utility contract, useHomeTab with progress), the Home top bar (identity-aware Me button crossfade, scroll-linked indicator white → lime → violet, bell with unread badge), the Me sheet, SanctionGate, all eleven features/<slice>/index.tsx stubs with the exact exports (DECISIONS D2: the auth stub is a minimal WORKING sign-in), and the /dev/kit route. Update main.tsx as needed.
Done when: \`npx tsc --noEmit\` in client/ passes and \`npx vite build\` succeeds.`,
}

phase('Build')
const run = (key, label) => agent(`${PRE}\n\n${LANES[key]}`, { label, phase: 'Build' })

const [serverBuild, clientBuild] = await parallel([
  async () => {
    log('server M1 already complete on disk (54 tests green) — resuming at M2')
    const m2 = await parallel([() => run('SM2a', 'server:M2a-safety'), () => run('SM2b', 'server:M2b-realtime')])
    const m3 = await run('SM3', 'server:M3-staff+integration')
    return { m1: 'done in previous run', m2a: m2[0], m2b: m2[1], m3 }
  },
  async () => {
    log('client C1 (UI kit) already complete on disk — resuming C2')
    const c2 = await run('C2', 'client:C2-shell')
    return { c1: 'done in previous run', c2 }
  },
])
if (!serverBuild) log('WARNING: server build chain returned null')
if (!clientBuild) log('WARNING: client build chain returned null')

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          specRef: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const REVIEWERS = [
  {
    key: 'server',
    prompt: `You are reviewing the SERVER foundation (server/src/** outside routes/<slice>.ts and services/). Do not edit files. Read SPEC §3, §4.1–§4.3, §4.6, §7 and then the code.
Check three things, in this order:
1. CONTRACT: every helper in §4.2 and endpoint in §4.3 exists with the exact exported name, signature, path, auth level and response shape; every §4.1 table/column exists; every §4.6 server stub exists; nothing is still a 501 stub. List each mismatch individually — feature agents will code against the SPEC text.
2. SECURITY: OTP stored hashed + expiry + attempt cap + cooldown; session cookie flags; devCode impossible in production; rate limits; cursor tampering; upload magic-byte checks and path traversal; SQL built only with bound parameters; helmet/cors posture; error bodies never leak internals.
3. ANONYMITY: the anonymous notification variant cannot carry an actor; the staff lib's anon-origin rule (moderators never see anon-origin rows; admins see them without excerpt and day-floored); audit serialisation; analytics events for Buzz carry no user-linkable props; logs never print Buzz author ids.
Only real, verified problems (quote the line). No style nits.`,
  },
  {
    key: 'client',
    prompt: `You are reviewing the CLIENT foundation (client/src/** ). Do not edit files. Read SPEC §1.2, §2, §4.4–§4.6, the eight pager criteria in §8, DECISIONS D2, then the code.
Check, in this order:
1. CONTRACT: every UI-kit component of §2.2 and every module/composite/export of §4.4 and §4.6 exists with the exact name and props; contracts.ts matches; every route of §4.5 is wired to the right stub; reserved query keys match §4.4.5; theme.css matches §2.1 verbatim. List each mismatch individually.
2. PAGER + SHELL: walk the code against each of the eight pager criteria and say which would fail and why (nested horizontal scrollers, initial paint on /home/orbit, URL replace, mouse drag vs click, Reels pause via \`active\`, identity: no avatar/name/handle in #frame at rest on Buzz).
3. BANS + QUALITY: position: fixed, 100vh, raw hex colours outside theme.css, spinners, hard-coded hrefs or "$", CDN/network references, missing focus rings/labels, reduced-motion ignored, Sheet not inheriting incognito mode, the auth stub not actually able to sign a user in.
Only real, verified problems (quote the line). No style nits.`,
  },
]

phase('Review')
const reviews = (await parallel(REVIEWERS.map(r => () =>
  agent(`${PRE}\n\n${r.prompt}`, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS })
    .then(res => ({ key: r.key, findings: (res && res.findings) || [] }))
))).filter(Boolean)
for (const r of reviews) {
  log(`review:${r.key} → ${r.findings.length} findings (${r.findings.filter(f => f.severity === 'blocker').length} blocker, ${r.findings.filter(f => f.severity === 'major').length} major)`)
}

phase('Fix')
const fixes = (await parallel(reviews.filter(r => r.findings.length).map(r => () =>
  agent(`${PRE}

You are the ${r.key.toUpperCase()} foundation fixer. For this task your lane is all foundation code under ${r.key}/ (never features/<slice> bodies beyond the stubs, never docs/, never shared/src/core.ts).
A reviewer produced the findings below. For each: verify it against the code and SPEC, fix it if real (surgical edits), or reject it with a reason. Blockers and majors first. Then re-run the ${r.key} typecheck${r.key === 'server' ? ' and the full vitest suite' : ' and `npx vite build`'} and leave it green.

Findings (JSON):
${JSON.stringify(r.findings, null, 2)}

Return: fixed / rejected (with reason) per finding, and the final status of the checks you ran.`,
    { label: `fix:${r.key}`, phase: 'Fix' })
    .then(report => ({ key: r.key, report }))
))).filter(Boolean)

const GATE = {
  type: 'object',
  properties: {
    serverTypecheck: { type: 'string', enum: ['pass', 'fail'] },
    clientTypecheck: { type: 'string', enum: ['pass', 'fail'] },
    serverTests: { type: 'object', properties: { passed: { type: 'number' }, failed: { type: 'number' }, skipped: { type: 'number' } }, required: ['passed', 'failed'] },
    clientBuild: { type: 'string', enum: ['pass', 'fail'] },
    dbReset: { type: 'string', enum: ['pass', 'fail'] },
    seedCounts: { type: 'string' },
    authSmoke: { type: 'string', enum: ['pass', 'fail'] },
    authSmokeDetail: { type: 'string' },
    remaining501: { type: 'array', items: { type: 'string' } },
    fixesMade: { type: 'array', items: { type: 'string' } },
    unresolved: { type: 'array', items: { type: 'string' } },
  },
  required: ['serverTypecheck', 'clientTypecheck', 'serverTests', 'clientBuild', 'dbReset', 'authSmoke', 'unresolved'],
}

phase('Gate')
const gate = await agent(`${PRE}

You are the FOUNDATION GATE. For this task you may make surgical fixes anywhere in foundation code (server or client; not docs/, not core.ts). Report real command results only — never assume a pass.
Run, from the right directories, and capture exit codes directly (do not pipe the command whose exit code you are reading):
1. server: \`npm run db:reset\` → record the printed seed counts and compare with SPEC §7.
2. server: \`npx tsc --noEmit\`; client: \`npx tsc --noEmit\`.
3. server: \`npx vitest run\` → record passed/failed/skipped.
4. client: \`npx vite build\`.
5. grep the server for any remaining 'not_implemented' 501 stubs in foundation modules and list them.
6. LIVE auth smoke test: boot the API with PORT=4190 and a temp DB_PATH (seeded), then with curl and a cookie jar: request a code for a brand-new @utexas.edu address → read devCode from the response → verify → complete signup → GET /api/me returns the user; request a code for a gmail.com address → rejected with the friendly error; request a code for a never-seen valid .edu domain → a university is auto-created. Then KILL the server and confirm nothing is listening on 4190.
If anything fails, fix it and re-run that step. When you stop, every field must reflect the LAST real run.`,
  { label: 'gate:foundation', phase: 'Gate', schema: GATE })

return { serverBuild, clientBuild, reviews, fixes, gate }
