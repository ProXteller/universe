// Ownership manifest — orchestrator-only (DECISIONS D3: there is no git here).
//   node tools/manifest.mjs snapshot   → hash every NON-slice file into tools/.manifest.json
//   node tools/manifest.mjs check      → report non-slice files that were modified / deleted / added since the snapshot
// "Slice-owned" paths (SPEC §4.6 / Constitution §3) are excluded, because slices are SUPPOSED to change those.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'tools/.manifest.json')
const SLICES = ['auth', 'reels', 'buzz', 'orbit', 'discover', 'messages', 'roommates', 'market', 'campus', 'apartments', 'admin']
const S = `(${SLICES.join('|')})`

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
const SKIP = [/\.db(-shm|-wal)?$/, /^server\/uploads\//, /^server\/seed-media\/generated\//, /^tools\/\.manifest\.json$/, /\.DS_Store$/, /package-lock\.json$/]
const SLICE_OWNED = [
  new RegExp(`^client/src/features/${S}/`),
  new RegExp(`^server/src/routes/${S}\\.ts$`),
  new RegExp(`^server/src/routes/${S}/`),
  new RegExp(`^server/src/services/${S}/`),
  new RegExp(`^server/src/db/schema/(0[1-9]|1[0-9])-${S}\\.sql$`),
  new RegExp(`^server/src/db/seeds/(0[1-9]|1[0-9])-${S}\\.ts$`),
  new RegExp(`^server/tests/${S}\\.test\\.ts$`),
  new RegExp(`^server/tests/${S}/`),
  new RegExp(`^shared/src/${S}\\.ts$`),
]

/** Which slice owns this path, or null when it is foundation/orchestrator-owned. */
export function ownerOf(rel) {
  for (const re of SLICE_OWNED) { const m = rel.match(re); if (m) return m.find((g, i) => i > 0 && SLICES.includes(g)) }
  return null
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)) }
    else if (e.isFile()) yield path.join(dir, e.name)
  }
}
function scan() {
  const out = {}
  for (const abs of walk(ROOT)) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (SKIP.some(re => re.test(rel)) || ownerOf(rel)) continue
    out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
  }
  return out
}

const cmd = process.argv[2]
if (cmd === 'snapshot') {
  const files = scan()
  fs.writeFileSync(OUT, JSON.stringify({ files }, null, 0))
  console.log(`snapshot: ${Object.keys(files).length} non-slice files hashed → tools/.manifest.json`)
} else if (cmd === 'check') {
  if (!fs.existsSync(OUT)) { console.error('no snapshot yet — run: node tools/manifest.mjs snapshot'); process.exit(2) }
  const before = JSON.parse(fs.readFileSync(OUT, 'utf8')).files, after = scan()
  const modified = Object.keys(before).filter(f => f in after && after[f] !== before[f])
  const deleted = Object.keys(before).filter(f => !(f in after))
  const added = Object.keys(after).filter(f => !(f in before))
  const show = (label, list) => { console.log(`${label}: ${list.length}`); list.forEach(f => console.log('  ' + f)) }
  show('MODIFIED (non-slice files changed since snapshot)', modified)
  show('DELETED', deleted)
  show('ADDED (new files outside every slice lane)', added)
  process.exit(modified.length || deleted.length ? 1 : 0)
} else if (cmd === 'owner') {
  console.log(ownerOf(process.argv[3]) ?? 'foundation/orchestrator')
} else {
  console.log('usage: node tools/manifest.mjs snapshot | check | owner <relative-path>')
}
