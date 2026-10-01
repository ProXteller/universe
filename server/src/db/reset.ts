/**
 * `npm run db:reset` (SPEC §8): delete the dev DB, migrate, run all seeds (SEED_SCALE defaults to full), print the §7
 * counts. Imports `routes/index.ts` BEFORE seeding so adapters / resolvers are registered.
 */
import { config } from '../config';
import { db, resetDb, runSeeds } from './index';
import { log } from '../lib/logger';
import { ensureEventCovers } from '../lib/seedArt';

async function main(): Promise<void> {
  if (config.env === 'production') throw new Error('db:reset refuses to run in production');
  const started = performance.now();
  await import('../routes/index');
  ensureEventCovers();
  resetDb();
  await runSeeds();

  const count = (sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...params) as { n: number }).n;
  const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];

  const lines: string[] = [];
  lines.push(`db:reset complete (${config.seedScale}) → ${config.dbPath}`);
  lines.push(`  universities: ${count('SELECT COUNT(*) AS n FROM universities')}`);
  lines.push(`  campus places: ${count('SELECT COUNT(*) AS n FROM campus_places')}`);
  lines.push(`  users: ${count('SELECT COUNT(*) AS n FROM users')} (personas ${count("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'u\\_%' ESCAPE '\\' AND role = 'user'")}, orgs ${count("SELECT COUNT(*) AS n FROM users WHERE account_type = 'org'")}, staff ${count("SELECT COUNT(*) AS n FROM users WHERE role IN ('moderator','admin')")}, background ${count("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'bg\\_%' ESCAPE '\\'")})`);
  for (const r of rows(
    `SELECT u.short_name AS campus, COUNT(x.id) AS n FROM universities u LEFT JOIN users x ON x.university_id = u.id GROUP BY u.id ORDER BY n DESC, u.short_name`,
  )) {
    lines.push(`    ${String(r.campus).padEnd(12)} ${r.n}`);
  }
  lines.push(`  follows: ${count('SELECT COUNT(*) AS n FROM follows')}`);
  const maya = db.prepare('SELECT follower_count, following_count, invite_code FROM users WHERE id = ?').get('u_mayachen') as
    | { follower_count: number; following_count: number; invite_code: string }
    | undefined;
  if (maya) {
    lines.push(`  maya: follows ${maya.following_count}, followers ${maya.follower_count}, invite ${maya.invite_code}, invited ${count("SELECT COUNT(*) AS n FROM users WHERE invited_by = 'u_mayachen'")}, notifications ${count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_mayachen'")} (${count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_mayachen' AND read_at IS NULL")} unread)`);
  }
  const counterDrift = count(
    `SELECT COUNT(*) AS n FROM users u WHERE u.follower_count != (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id)
        OR u.following_count != (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id)`,
  );
  lines.push(`  counter drift: ${counterDrift === 0 ? 'none' : `${counterDrift} users`}`);
  const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => String(r.name));
  const nonEmpty = tables.map((t) => [t, count(`SELECT COUNT(*) AS n FROM "${t}"`)] as const).filter(([, n]) => n > 0);
  lines.push(`  tables with rows: ${nonEmpty.map(([t, n]) => `${t}=${n}`).join(', ')}`);
  lines.push(`  took ${Math.round(performance.now() - started)} ms`);
  console.log(lines.join('\n'));
}

main()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    log.error('db:reset failed', err);
    process.exit(1);
  });
