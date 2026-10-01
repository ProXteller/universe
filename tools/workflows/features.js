export const meta = {
  name: 'universe-features',
  description: 'Build the 11 feature slices in parallel on the finished foundation (build → contract review → fix per slice, pipelined), then an integration gate',
  phases: [
    { title: 'Build', detail: 'one agent per slice, all in parallel' },
    { title: 'Review', detail: 'per-slice contract + firewall reviewer as soon as its build lands' },
    { title: 'Fix', detail: 'per-slice fixer applies the review' },
    { title: 'Integrate', detail: 'ownership check, full typecheck, full test suite, db:reset, build' },
  ],
}

const ROOT = '/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752'

// Slice table: number, name, SPEC §5 section, extra reading, and which slices it may import client components from (SPEC §6).
const SLICES = [
  { n: '01', key: 'auth',       sec: '5.1',  extra: 'product.md §1 (onboarding copy) · design.md §7.1 · SPEC §1.1 auth row, §1.2, §2.3', imports: 'admin (GuidelinesContent only)' },
  { n: '02', key: 'reels',      sec: '5.2',  extra: 'design.md §6 (nested vertical snap inside the pager) and §7.2 · DECISIONS D5 (seed reel files exist) · SPEC §4.2.12 uploads', imports: 'none' },
  { n: '03', key: 'buzz',       sec: '5.3',  extra: 'Constitution §5 (anonymity firewall) · SPEC §3.2 checklist · safety.md §5 (threat model) · design.md §7.3 (Phosphor / incognito surface)', imports: 'none' },
  { n: '04', key: 'orbit',      sec: '5.4',  extra: 'design.md §7.4', imports: 'reels (FollowingReelsRail only)' },
  { n: '05', key: 'discover',   sec: '5.5',  extra: 'design.md §7.5 · SPEC §4.2.15 publicActivityStats', imports: 'reels (UserReelsGrid), orbit (UserPostsList), campus (OrgEventsList)' },
  { n: '06', key: 'messages',   sec: '5.6',  extra: 'SPEC §4.2.11 conversations (you consume it; foundation is the only writer) · §4.2.8 realtime · design.md §7.6', imports: 'none' },
  { n: '07', key: 'roommates',  sec: '5.7',  extra: 'product.md roommates section (questionnaire + weights) · design.md §7.7', imports: 'none' },
  { n: '08', key: 'market',     sec: '5.8',  extra: 'product.md marketplace section · safety.md §7 (scam warnings, safe meetup) · design.md §7.8 · SPEC §4.2.11 offers', imports: 'none' },
  { n: '09', key: 'campus',     sec: '5.9',  extra: 'product.md campus/events section · design.md §7.9 · SPEC §4.2.11 createCourseConversation', imports: 'none' },
  { n: '10', key: 'apartments', sec: '5.10', extra: 'SPEC §4.4.4 (notification renderer table — you render every type) · design.md §7.10–7.12', imports: 'none' },
  { n: '11', key: 'admin',      sec: '5.11', extra: 'Constitution §5 · SPEC §3 in full · safety.md §1 (guidelines text), §2 (rule packs), §4 (sanctions), §6 (tooling) · SPEC §4.2.14 staff lib', imports: 'none' },
]

const PRE = (s) => `Project root (path contains spaces — ALWAYS quote it; prefer absolute paths): "${ROOT}"

You are the **${s.key}** slice engineer (slice ${s.n}). Ten other slice engineers are working in parallel in the same tree right now. You edit ONLY your owned files (SPEC §5 intro "Owned files", with <s>=${s.key}, NN=${s.n}):
  shared/src/${s.key}.ts · server/src/routes/${s.key}.ts (+ routes/${s.key}/**) · server/src/services/${s.key}/** · server/src/db/schema/${s.n}-${s.key}.sql · server/src/db/seeds/${s.n}-${s.key}.ts · server/tests/${s.key}.test.ts (+ tests/${s.key}/**) · client/src/features/${s.key}/**
Anything else is read-only. If foundation lacks something you need, work around it inside your files and report the gap. Editing a file outside your lane is detected by a hash manifest and reverted.

Read, in order, before writing anything:
1. "${ROOT}/docs/CONSTITUTION.md" — root authority.
2. "${ROOT}/docs/DECISIONS.md" — orchestrator rulings.
3. "${ROOT}/docs/SPEC.md" — rules R1–R8 (top of file), §1 (feature list + tiers, your row), §3 (safety, binding), §4.6 (your frozen stub exports), **§${s.sec} (your contract, in full)**, §6 (dependency matrix), §7 (seed world — ids are FINAL; use \`kit.users.get('<handle>')\`), §8 ("Every slice done when"). Extra reading for you: ${s.extra}.
4. "${ROOT}/shared/src/core.ts" — the frozen type contract (\`@shared/core\`). Then your own \`@shared/${s.key}\` file (currently \`export {}\`) — you own it: put your slice's request/response types there exactly as §${s.sec} sketches them.
5. The foundation CODE you build on — read the actual files, not just the SPEC: server \`src/lib/*.ts\` you call (http, graph, users, moderation/index, notify, realtime, conversations, content, uploads, analytics, seedKit, testing), \`src/middleware/auth.ts\`, \`src/db/schema/00-core.sql\`; client \`src/ui/index.ts\`, \`src/components/*\`, \`src/lib/*\`, \`src/app/contracts.ts\`, \`src/app/router.tsx\`, and your current stub \`client/src/features/${s.key}/index.tsx\`. Foundation may deviate slightly from SPEC (its report is in "${ROOT}/docs/FOUNDATION-NOTES.md" — read it); **code wins over SPEC prose where they differ in signatures.**
Cross-slice client imports allowed for you (SPEC §6): ${s.imports}. Import nothing else from other slices; consume other slices only through HTTP and foundation helpers.

Build order (R8): T1 first — pass its acceptance + tests — then T2 items. Every create/edit surface shows \`ComposerModeBanner\`. No control without an endpoint (R7). All lists: skeleton, empty, error+retry, infinite scroll. Report + Block (public surfaces) on every UGC item. All UGC text through \`moderateText\`/\`moderateWrite\` on write.

Hard rules:
- NEVER run npm install, never add a dependency, never run git, never edit docs/ or shared/src/core.ts.
- Keep the exact stub export names and prop types (R5); keep \`index.tsx\`, never create \`index.ts\`.
- Server: no \`Date.now()\` (use the clock lib); no import-time DB access (R4); prepared statements lazily; \`CREATE TABLE IF NOT EXISTS\`; ids via nanoid or deterministic seed ids; every handler in asyncHandler with zod validation.
- Client: TanStack Query with your reserved key prefix (§4.4.5), zustand for UI state only, all requests via \`@/lib/api\`, no position:fixed / 100vh / raw hex / spinners / hard-coded "$" (use formatPrice) / network URLs.
- Tests: \`server/tests/${s.key}.test.ts\` using \`createTestApp({ slices: ['${s.key}'] })\` from \`src/lib/testing.ts\` — the SPEC's listed tests for your slice, plus anything your acceptance list implies. Run ONLY your own test file: \`cd "${ROOT}/server" && npx vitest run tests/${s.key}.test.ts\`.
- Typecheck once near the end, once after fixes: \`npx tsc --noEmit\` in server/ and in client/ — filter the output to your owned paths; errors elsewhere are REPORTED, never fixed.
- 8 GB machine, 11 agents at once: no dev servers, no vite build, no long-running processes; kill anything you start.
- Seeds: deterministic (\`kit.rng\` only), both scales, counters equal rows, \`markPublicActivity\` for seeded public content, honour §7.5 (Maya's demo state) for your slice.

Your final message is data for the orchestrator. Report: files created; the exact commands you ran and their real results; T1 acceptance items verified; T2 items dropped; R7 controls omitted; foundation gaps worked around; tsc errors seen outside your lane (path + message, not fixed).`

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
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'fix'],
      },
    },
    ownedFilesOnly: { type: 'boolean' },
    stubExportsIntact: { type: 'boolean' },
  },
  required: ['findings', 'ownedFilesOnly', 'stubExportsIntact'],
}

const reviewPrompt = (s, buildReport) => `Project root (quote it): "${ROOT}"
You are reviewing the **${s.key}** slice (${s.n}) that another agent just built. Do NOT edit files. Read docs/CONSTITUTION.md §3–§5, docs/SPEC.md rules R1–R8, §3, §4.6 (its stub exports), **§${s.sec}** in full, §6, then the slice's files: shared/src/${s.key}.ts, server/src/routes/${s.key}*(.ts|/**), server/src/services/${s.key}/**, server/src/db/schema/${s.n}-${s.key}.sql, server/src/db/seeds/${s.n}-${s.key}.ts, server/tests/${s.key}*, client/src/features/${s.key}/**.
Also run: \`cd "${ROOT}" && node tools/manifest.mjs check\` — any MODIFIED/DELETED line is a lane violation (report which files; ADDED lines are informational).

The builder's own report:
---
${buildReport}
---

Check, in order, and report only REAL problems (quote line numbers):
1. CONTRACT: every §${s.sec} endpoint exists at the exact path/method with the specified auth, validation and response type; every table/column; stub export names + prop types unchanged (R5); no sibling index.ts; shared types match the SPEC sketch; reserved query keys used.
2. SAFETY + FIREWALL: every UGC write goes through moderateText/moderateWrite; Report (and Block on public surfaces) present; blocks respected in reads (sqlNotBlocked / graph helpers); ${s.key === 'buzz' || s.key === 'admin' ? 'THE ANONYMITY FIREWALL (Constitution §5, SPEC §3.2): trace every Buzz-related response serializer and prove no user id/handle/name/avatar/email or cross-thread-stable identifier can leave the server for non-admins; moderators never see identity; unmask only via the audited endpoint; notifications carry no actor; analytics events carry no user-linkable props.' : 'no Buzz data or anonymous content leaks into this public surface.'}
3. CORRECTNESS: SQL injection (string-built SQL), counters drifting from rows, missing pagination, N+1 in list endpoints, unvalidated input, cursor handling, ownership checks (can user A edit/delete user B's item?), rate limits on writes.
4. UX BANS: position:fixed, 100vh, raw hex, spinners, "$" literals, hard-coded hrefs, dead controls (R7), missing ComposerModeBanner, missing skeleton/empty/error states.
5. TESTS: does tests/${s.key}.test.ts cover the SPEC's listed tests? Run it yourself: \`cd "${ROOT}/server" && npx vitest run tests/${s.key}.test.ts\` and report the real result.`

const fixPrompt = (s, review) => `${PRE(s)}

You are the FIXER for the ${s.key} slice. A reviewer produced the findings below. For each: verify against code + SPEC; fix if real (surgical edits, owned files only); reject with a reason if not. Blockers → majors → minors. If ownedFilesOnly is false, the builder edited files outside the lane: DO NOT try to restore them yourself (the orchestrator will) — instead make sure the slice does not DEPEND on those edits, and list them.
Then re-run \`npx vitest run tests/${s.key}.test.ts\` and both typechecks filtered to your paths; leave them green.

Review (JSON):
${JSON.stringify(review, null, 2)}

Return: fixed / rejected (with reason) per finding, the final real test + typecheck results, and any out-of-lane edits the builder made.`

phase('Build')
const results = await pipeline(
  SLICES,
  s => agent(`${PRE(s)}\n\nBuild the ${s.key} slice now.`, { label: `build:${s.key}`, phase: 'Build' })
        .then(report => ({ s, report: report || '(no report — agent returned null)' })),
  ({ s, report }) => agent(reviewPrompt(s, report), { label: `review:${s.key}`, phase: 'Review', schema: FINDINGS })
        .then(review => ({ s, report, review: review || { findings: [], ownedFilesOnly: true, stubExportsIntact: true, note: 'reviewer returned null' } })),
  ({ s, report, review }) => {
    log(`review:${s.key} → ${review.findings.length} findings (${review.findings.filter(f => f.severity === 'blocker').length} blocker, ${review.findings.filter(f => f.severity === 'major').length} major); ownedFilesOnly=${review.ownedFilesOnly} stubs=${review.stubExportsIntact}`)
    if (!review.findings.length && review.ownedFilesOnly && review.stubExportsIntact) return { s: s.key, report, review, fix: 'clean — no fixer needed' }
    return agent(fixPrompt(s, review), { label: `fix:${s.key}`, phase: 'Fix' }).then(fix => ({ s: s.key, report, review, fix }))
  },
)
const done = results.filter(Boolean)
log(`slices through the pipeline: ${done.length}/${SLICES.length}` + (done.length < SLICES.length ? ` — MISSING: ${SLICES.filter(s => !done.find(d => d.s === s.key)).map(s => s.key).join(', ')}` : ''))

const GATE = {
  type: 'object',
  properties: {
    manifestCheck: { type: 'string' },
    serverTypecheck: { type: 'string', enum: ['pass', 'fail'] },
    clientTypecheck: { type: 'string', enum: ['pass', 'fail'] },
    serverTests: { type: 'object', properties: { files: { type: 'number' }, passed: { type: 'number' }, failed: { type: 'number' }, skipped: { type: 'number' }, failingFiles: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'failed'] },
    dbReset: { type: 'string', enum: ['pass', 'fail'] },
    seedSummary: { type: 'string' },
    clientBuild: { type: 'string', enum: ['pass', 'fail'] },
    fixesMade: { type: 'array', items: { type: 'string' } },
    unresolved: { type: 'array', items: { type: 'string' } },
  },
  required: ['manifestCheck', 'serverTypecheck', 'clientTypecheck', 'serverTests', 'dbReset', 'clientBuild', 'unresolved'],
}

phase('Integrate')
const gate = await agent(`Project root (quote it): "${ROOT}"
You are the INTEGRATION GATE after the feature phase. Read docs/CONSTITUTION.md, docs/DECISIONS.md, SPEC.md §8. You may make surgical fixes ANYWHERE in application code (foundation or slices) to get the tree green — but never change a frozen contract (core.ts, stub export names, endpoint paths), never edit docs/, never run npm install or git. Report only real command results; capture exit codes directly.
1. \`cd "${ROOT}" && node tools/manifest.mjs check\` — record the MODIFIED/DELETED/ADDED lists verbatim (do not revert anything; the orchestrator decides).
2. server: \`npx tsc --noEmit\`; client: \`npx tsc --noEmit\` — fix errors (typical: a slice used a foundation signature wrongly; fix on the SLICE side unless foundation is plainly wrong).
3. server: \`npx vitest run\` (full suite, both foundation and all slices) — record files/passed/failed/skipped and name failing files; fix real bugs, never delete or skip tests to go green.
4. server: \`npm run db:reset\` — record the printed summary (counts per table) and any seed warnings.
5. client: \`npx vite build\` — must succeed; record the largest chunks.
6. Confirm nothing is left listening on any port you used.
Loop steps 2–5 until green or until a problem is genuinely unresolvable; list those.`,
  { label: 'gate:integration', phase: 'Integrate', schema: GATE })

return { slices: done, gate }
