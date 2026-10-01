/**
 * `discover` seed (SPEC §5.5 / §7.5): 3 dismissed suggestions for Maya. Deterministic (fixed persona ids, fixed
 * offsets — no `kit.rng` needed), identical at both scales, idempotent under `db:reset` (tables are dropped first;
 * `INSERT OR IGNORE` covers a re-run against an existing DB). No denormalised counters exist for this table.
 *
 * Maya (CS, junior, UT Austin) dismissed three same-campus "People you may know" cards, so the section still shows
 * `bellarossi`, `meitanaka`, `fatima_as`… (§7.5) while proving the dismiss path with real rows.
 */
import type { SeedKit } from '../../lib/seedKit';

const MAYA_DISMISSALS: { handle: string; daysAgo: number }[] = [
  { handle: 'calebt', daysAgo: 6 },
  { handle: 'chloedub', daysAgo: 4 },
  { handle: 'ryanoc', daysAgo: 1 },
];

export default function seed(kit: SeedKit): void {
  const maya = kit.users.get('mayachen');
  const insert = kit.db.prepare(
    'INSERT OR IGNORE INTO discover_dismissals (user_id, target_id, section, created_at) VALUES (?,?,?,?)',
  );
  for (const d of MAYA_DISMISSALS) {
    const target = kit.users.get(d.handle);
    insert.run(maya.id, target.id, 'people_you_may_know', kit.ago({ d: d.daysAgo, h: 3 }));
  }
}
