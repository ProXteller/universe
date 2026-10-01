/**
 * Additive upgrades for Buzz tables created before a column existed (the schema files are `CREATE … IF NOT EXISTS`, so
 * they never touch an existing table). Runs through `onDbReady` — never at import time (R4) — and is idempotent.
 */
import { db, onDbReady } from '../../db/index';

const ADDED_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'title', ddl: "ALTER TABLE buzz_posts ADD COLUMN title TEXT NOT NULL DEFAULT ''" },
  { name: 'media', ddl: "ALTER TABLE buzz_posts ADD COLUMN media TEXT NOT NULL DEFAULT '[]'" },
  { name: 'scope', ddl: "ALTER TABLE buzz_posts ADD COLUMN scope TEXT NOT NULL DEFAULT 'campus'" },
];

export function upgradeBuzzSchema(): void {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'buzz_posts'").get();
  if (!table) return;
  const have = new Set((db.prepare('PRAGMA table_info(buzz_posts)').all() as { name: string }[]).map((c) => c.name));
  for (const c of ADDED_COLUMNS) if (!have.has(c.name)) db.exec(c.ddl);
  db.exec('CREATE INDEX IF NOT EXISTS buzz_posts_scope ON buzz_posts(scope, status, created_at DESC)');
}

let registered = false;
export function registerBuzzSchemaUpgrade(): void {
  if (registered) return;
  registered = true;
  onDbReady(upgradeBuzzSchema);
}
