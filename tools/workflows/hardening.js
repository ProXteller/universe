export const meta = {
  name: 'universe-hardening',
  description: 'Adversarial hardening after the feature phase: 3 anonymity attackers, 2 security auditors, 1 brief-fidelity critic — each proves findings with a real test — then fixers and a re-gate',
  phases: [
    { title: 'Attack', detail: 'anonymity firewall ×3 lenses, security ×2 lenses, brief fidelity ×1 — all in parallel' },
    { title: 'Fix', detail: 'one fixer per attacker group, confirmed findings only' },
    { title: 'Regate', detail: 'full typecheck + full suite incl. the new hardening tests' },
  ],
}

const ROOT = '/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752'

const PRE = `Project root (path contains spaces — ALWAYS quote it): "${ROOT}"
Read first: docs/CONSTITUTION.md (§5 anonymity firewall, §6 email gate), docs/SPEC.md §3 (safety, binding) and §3.2 (firewall checklist), docs/FOUNDATION-NOTES.md, then the code you are attacking. The whole app is built; the full server test suite is green.
Rules: never run npm install or git; never edit docs/ or shared/src/core.ts; bounded test workers: \`npx vitest run <file> --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1\`; no dev servers (use createTestApp from src/lib/testing.ts in full mode with seeds, or a scratch DB on a port ≥ 4200 that you kill afterwards); 8 GB machine, other agents running.
EVIDENCE RULE: a finding counts only if you wrote a test that demonstrates it. Put your tests in server/tests/hardening/<lens>.test.ts (create the directory). A test that FAILS is a confirmed finding (leave it failing — the fixer makes it pass). A probe that finds nothing stays as a PASSING regression test. Report each finding with severity, file:line, the test name that proves it, and the fix you recommend. Do not fix anything yourself.`

const LENSES = [
  { group: 'firewall', key: 'firewall-api', prompt: `LENS: Buzz identity through the API surface. You are a hostile student with a valid session (and a second account) trying to learn WHO wrote a Buzz post or reply. Try everything: every /api/buzz response body (feed, thread, replies, polls, my-buzzes, karma, search if any), field-by-field — ids, alias derivation (is the alias stable ACROSS threads for the same author? compute two threads by the same seeded author and compare), timestamps vs the author's public activity timestamps, pagination cursors (decode them), error messages (e.g. voting on your own post — does the error reveal isMine to someone else?), rate-limit responses, 404-vs-403 differences between own and others' posts, Report payloads, share cards, notifications (/api/notifications — do Buzz notifications carry actor fields, ids, avatar URLs?), analytics events, the profile/discover endpoints (do buzz counts or 'last active' leak activity?), block lists (blocking a Buzz author must be impossible — is it?). Also grep every serializer in services/buzz for author_id / user fields.` },
  { group: 'firewall', key: 'firewall-staff', prompt: `LENS: Buzz identity through the staff and data layer. You are (a) a MODERATOR (seed mod@utexas.edu) — prove you cannot learn a Buzz author's identity through ANY /api/admin endpoint: queue items, item detail, reports, user lookup, standing, strike history, audit log, CSV/exports, sanction rows, appeals — including by correlation (sanction timestamps, strike deltas, 'open queue items' counters that change when you act on a Buzz item). Then (b) as ADMIN — prove unmask works ONLY through the dedicated endpoint, requires a written reason, writes an audit row, and that no other admin endpoint leaks the author more cheaply. Then (c) at the DB level: which tables reference buzz author ids, and does every read path filter them; do server logs (src/lib/logger.ts) ever print a Buzz author id or full text; does moderation_events / mod_queue / analytics_events store anything that joins a Buzz post to a user for non-admin readers.` },
  { group: 'firewall', key: 'firewall-client', prompt: `LENS: Buzz identity in the client and cross-surface leaks. Read client/src/features/buzz/** and the foundation shell. Hunt for: the viewer's own avatar/name/handle rendered anywhere inside the Buzz pane or Buzz thread page or Buzz composer or Buzz-originated sheets (comments, report, share); isMine styling that would let a shoulder-surfer identify the poster on a shared device (is there a way to hide 'yours' marks?); Buzz content reachable from public profiles, Discover, Orbit, search, notifications deep links that jump from a public identity into a Buzz thread with 'isMine' set; share-to-chat of a Buzz post (does the shared card carry alias, author, or thread ids that combine with the recipient's knowledge?); localStorage / sessionStorage / query cache keys that store Buzz author ids; analytics track() calls from Buzz screens with user-linkable props; the ws events for Buzz notifications. Write tests where the behaviour is server-observable (e.g. share payload, notification payload); for pure client findings quote the file:line and explain — those count without a test.` },
  { group: 'security', key: 'security-authz', prompt: `LENS: authorization across every slice (IDOR). With two seeded student accounts A and B (and an org), for EVERY mutating endpoint in routes/{reels,buzz,orbit,discover,messages,roommates,market,campus,apartments,admin}.ts and routes/core/*: can A edit/delete/mark-sold/cancel/RSVP-as/accept-offer/read-DM/add-member/remove-member on B's resource? Can a student reach any /api/admin route (must be 404)? Can an org do student-only things and vice versa? Can a suspended user post? Can a signed-out request do anything mutating? Can a user act on content from a campus that is not theirs where SPEC says campus-only (market, roommates, events)? Can B read A's private roommate answers when A chose "browse & match only"? Can A see B's message requests? Write one test file that sweeps these systematically.` },
  { group: 'security', key: 'security-input', prompt: `LENS: input handling and abuse. Uploads: path traversal in filenames, polyglot files (PNG header + HTML), oversized bodies, MIME/extension mismatch, SVG uploads (script), EXIF retention, video probe with malicious box sizes. Auth: OTP brute force across IPs, resend flooding, signup token reuse, session fixation, cookie flags in production config, the STAFF_EMAILS parser. Rate limits on every write endpoint (posts, comments, messages, listings, reports, follows, votes). SQL: grep every db.prepare/exec for template-literal or concatenated SQL. Zod: endpoints missing validation, or accepting extra keys that hit the DB. Cursor tampering on every paginated endpoint. Moderation bypass: unicode/zero-width/homoglyph text that slips past moderateText on each UGC surface (test with the real engine). Denial-of-wallet: endpoints that do unbounded work per request (unlimited limit=, N+1 without cap).` },
  { group: 'brief', key: 'brief-fidelity', prompt: `LENS: brief fidelity — is everything the founder asked for actually there and reachable? Read Constitution §0 sentence by sentence. For each requirement, find the CODE that satisfies it (route wired in client/src/app/router.tsx → feature component → endpoint → table) and write a full-mode supertest that exercises it end-to-end as the seeded demo student where server-observable: university-email gate (personal rejected, academic accepted, unknown academic auto-created); reels ≤ 60 s enforced (a 61 s upload rejected); Buzz post + thread + anonymity; Orbit shows ONLY followed accounts (post from a non-followed account must be absent); Discover search finds people/orgs but NEVER surfaces Buzz or anonymous data; DMs deliver; roommates: post a listing AND match-without-posting with filters; marketplace: list, buy path (message seller + offer), sell (mark sold), trade type; Apartments: coming-soon endpoint + Get-notified join/leave + an analytics event recorded for the page; community guidelines exist and Buzz requires acceptance. Also list any nav item, tab, or route in the router that lazy-loads a component which is STILL the 'Coming together' stub (grep for it). Report anything missing, stubbed or unreachable as a finding.` },
]

const FINDINGS = {
  type: 'object',
  properties: {
    testFile: { type: 'string' },
    testsWritten: { type: 'number' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      file: { type: 'string' }, testName: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'file', 'problem', 'fix'] } },
    probesThatPassed: { type: 'array', items: { type: 'string' } },
  },
  required: ['testFile', 'testsWritten', 'findings', 'probesThatPassed'],
}

phase('Attack')
const attacks = (await parallel(LENSES.map(l => () =>
  agent(`${PRE}\n\n${l.prompt}`, { label: `attack:${l.key}`, phase: 'Attack', schema: FINDINGS, effort: 'high' })
    .then(r => r && ({ ...l, ...r }))
))).filter(Boolean)
for (const a of attacks) log(`attack:${a.key} → ${a.findings.length} findings (${a.findings.filter(f => f.severity === 'critical').length} critical, ${a.findings.filter(f => f.severity === 'high').length} high), ${a.testsWritten} tests in ${a.testFile}`)

phase('Fix')
const groups = ['firewall', 'security', 'brief']
const fixes = (await parallel(groups.map(g => () => {
  const mine = attacks.filter(a => a.group === g)
  const findings = mine.flatMap(a => a.findings.map(f => ({ lens: a.key, testFile: a.testFile, ...f })))
  if (!findings.length) { log(`fix:${g} — nothing to fix`); return Promise.resolve({ group: g, report: 'no findings' }) }
  return agent(`${PRE}

You are the FIXER for the "${g}" group. Attackers wrote failing tests in server/tests/hardening/ that demonstrate each finding below. Your job: make every one of those tests pass by fixing the APPLICATION code (any slice or foundation file; surgical edits; never weaken or delete a hardening test, never change frozen contracts in core.ts or stub export names; if a finding is a false positive, say so and fix the TEST's expectation with a one-line justification in a comment). Critical → high → medium → low. When a fix touches a serializer, re-run that slice's own test file too. Finish with the hardening files and the affected slice files green and both typechecks passing.

Findings (JSON):
${JSON.stringify(findings, null, 2)}

Return: per finding — fixed (what changed) / false positive (why); final real test results.`, { label: `fix:${g}`, phase: 'Fix', effort: 'high' }).then(report => ({ group: g, findings: findings.length, report }))
}))).filter(Boolean)

const REGATE = { type: 'object', properties: {
  serverTypecheck: { type: 'string', enum: ['pass', 'fail'] }, clientTypecheck: { type: 'string', enum: ['pass', 'fail'] },
  serverTests: { type: 'object', properties: { files: { type: 'number' }, passed: { type: 'number' }, failed: { type: 'number' }, skipped: { type: 'number' }, failingTests: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'failed'] },
  clientBuild: { type: 'string', enum: ['pass', 'fail'] }, dbReset: { type: 'string', enum: ['pass', 'fail'] },
  fixesMade: { type: 'array', items: { type: 'string' } }, unresolved: { type: 'array', items: { type: 'string' } } },
  required: ['serverTypecheck', 'clientTypecheck', 'serverTests', 'clientBuild', 'dbReset', 'unresolved'] }

phase('Regate')
const regate = await agent(`${PRE}

You are the RE-GATE. Run from the right directories and report real results: server \`npx tsc --noEmit\`; client \`npx tsc --noEmit\`; server \`npx vitest run --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1\` (full suite INCLUDING tests/hardening/**); server \`npm run db:reset\`; client \`npx vite build\`. Fix what is red with surgical edits (never by deleting or skipping a test); a test that only fails under load is re-run alone before you conclude. List every unresolved item precisely.`,
  { label: 'regate', phase: 'Regate', schema: REGATE })

return { attacks: attacks.map(a => ({ key: a.key, testFile: a.testFile, testsWritten: a.testsWritten, findings: a.findings, probesThatPassed: a.probesThatPassed })), fixes, regate }
