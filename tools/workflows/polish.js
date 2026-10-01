export const meta = {
  name: 'universe-polish',
  description: 'Apply the orchestrator walkthrough polish list (P1–P6) in 4 non-overlapping lanes, then a final gate',
  phases: [
    { title: 'Polish', detail: '4 lanes in parallel: foundation client, reels+messages, buzz seed, admin unmask' },
    { title: 'Gate', detail: 'typecheck x2, full suite, db:reset, vite build' },
  ],
}

const ROOT = '/Users/ankurbasnet/Library/Application Support/Claude/scratch-workspaces/3fa03a1d-e11f-44f5-adc4-3fd2c89f5866/214025d0-553e-465e-87ae-d756765a1646/scratch-2026-09-21-68c752'

const PRE = `Project root (path contains spaces — ALWAYS quote it): "${ROOT}"
Read "${ROOT}/tools/reports/polish.md" (the list you are working from), then docs/CONSTITUTION.md, the SPEC sections for the code you touch, and the code itself.
Rules: never run npm install or git; never edit docs/ or shared/src/core.ts or frozen stub export names; surgical edits only; other agents are editing OTHER files in parallel — stay inside the files your items need. Bounded tests: \`npx vitest run <file> --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1\`. No dev servers, no vite build. Finish with the relevant test files + both typechecks (\`npx tsc --noEmit\` in server/ and client/) green for your paths.
Report: per item — what changed (file:line), how you verified it, anything you could not do.`

const LANES = [
  { key: 'foundation-client', items: 'P1 and P2', note: 'Files: client/src/components/ModerationHost.tsx, client/src/lib/moderation.tsx, client/src/app/AppShell.tsx if needed, client/src/ui/Dialog.tsx (and ui/Sheet.tsx only if the surface plumbing needs it). Keep every exported signature backward compatible — slices already call these.' },
  { key: 'reels-messages', items: 'P3 and P5', note: 'Files: client/src/features/reels/** (upload composer banner copy) and client/src/features/messages/** (inbox row layout).' },
  { key: 'buzz-seed', items: 'P4', note: 'File: server/src/db/seeds/03-buzz.ts only. After editing run tests/buzz.test.ts, tests/admin.test.ts and tests/core/integration.test.ts, and `npm run db:reset` from server/ (it must print "counter drift: none").' },
  { key: 'admin-unmask', items: 'P6', note: 'Files: server/src/services/admin/**, server/src/routes/admin*.ts, server/tests/admin.test.ts, client/src/features/admin/**. Read-only: foundation staff libs (lib/moderation/staff.ts, lib/audit.ts) — if the blocked-text author is not reachable through them, report it rather than editing foundation.' },
]

phase('Polish')
const lanes = (await parallel(LANES.map(l => () =>
  agent(`${PRE}\n\nYour lane: **${l.key}** — do items ${l.items} from polish.md. ${l.note}`, { label: `polish:${l.key}`, phase: 'Polish' })
    .then(report => ({ lane: l.key, report }))
))).filter(Boolean)

const GATE = { type: 'object', properties: {
  serverTypecheck: { type: 'string', enum: ['pass', 'fail'] }, clientTypecheck: { type: 'string', enum: ['pass', 'fail'] },
  serverTests: { type: 'object', properties: { files: { type: 'number' }, passed: { type: 'number' }, failed: { type: 'number' }, skipped: { type: 'number' }, failingTests: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'failed'] },
  dbReset: { type: 'string', enum: ['pass', 'fail'] }, seedSummary: { type: 'string' }, clientBuild: { type: 'string', enum: ['pass', 'fail'] },
  fixesMade: { type: 'array', items: { type: 'string' } }, unresolved: { type: 'array', items: { type: 'string' } } },
  required: ['serverTypecheck', 'clientTypecheck', 'serverTests', 'dbReset', 'clientBuild', 'unresolved'] }

phase('Gate')
const gate = await agent(`${PRE}

You are the FINAL GATE. Run and report real results: server \`npx tsc --noEmit\`; client \`npx tsc --noEmit\`; server \`npx vitest run --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1\` (full suite incl. tests/hardening/** if present); server \`npm run db:reset\`; client \`npx vite build\`. Fix anything red with surgical edits (never by deleting or skipping a test; re-run a test alone before blaming load). Leave nothing running.`,
  { label: 'gate:final', phase: 'Gate', schema: GATE })

return { lanes, gate }
