/**
 * DB handle, migrations runner, helpers (SPEC §4.2.2).
 *
 * `migrate()` runs SYNCHRONOUSLY AT MODULE LOAD (bottom of this file), so every importer — routers, libs, tests —
 * always sees the tables. Slices MUST NOT touch the DB at import time except through `onDbReady(fn)` (R4).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Id } from '@shared/core';
import { config } from '../config';
import { log } from '../lib/logger';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema');
const CORE_SCHEMA = '00-core';

function open(): Database.Database {
  const memory = config.dbPath === ':memory:';
  if (!memory) fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const handle = new Database(config.dbPath);
  if (!memory) handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 4000');
  return handle;
}

export const db: Database.Database = open();

/* ───────────────────────────── onDbReady ───────────────────────────── */

const readyHooks = new Set<() => void>();

function runHook(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log.error('onDbReady hook failed', err);
  }
}

/**
 * Runs `fn` immediately (tables exist) and again after every `migrate()` / `resetDb()`.
 * Returns an unregister function. A hook never aborts boot (try/catch + log.error).
 */
export function onDbReady(fn: () => void): () => void {
  readyHooks.add(fn);
  runHook(fn);
  return () => {
    readyHooks.delete(fn);
  };
}

/* ───────────────────────────── migrate / reset ───────────────────────────── */

export interface MigrateOptions {
  /** File stems, e.g. ['00-core', '03-buzz']. Default: every file in schema/. */
  only?: string[];
  /** A failing SLICE file is logged and skipped (00-core errors always throw). */
  tolerant?: boolean;
}

function schemaFiles(only?: string[]): { stem: string; file: string }[] {
  const all = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ stem: f.replace(/\.sql$/, ''), file: path.join(SCHEMA_DIR, f) }));
  if (!only) return all;
  const wanted = new Set(only);
  wanted.add(CORE_SCHEMA);
  return all.filter((f) => wanted.has(f.stem));
}

export function migrate(opts: MigrateOptions = {}): void {
  for (const { stem, file } of schemaFiles(opts.only)) {
    const sql = fs.readFileSync(file, 'utf8');
    try {
      db.exec(sql);
    } catch (err) {
      if (stem !== CORE_SCHEMA && opts.tolerant) {
        log.error(`schema ${stem}.sql failed and was skipped (tolerant mode)`, err);
        continue;
      }
      throw err;
    }
  }
  statementCache.clear();
  for (const fn of [...readyHooks]) runHook(fn);
}

/** Drops every table / view / trigger, then `migrate(opts)`. Used by tests and `db:reset`. */
export function resetDb(opts: { only?: string[] } = {}): void {
  statementCache.clear();
  db.pragma('foreign_keys = OFF');
  try {
    const objects = db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { type: string; name: string }[];
    const quote = (n: string): string => `"${n.replace(/"/g, '""')}"`;
    for (const o of objects) if (o.type === 'trigger') db.exec(`DROP TRIGGER IF EXISTS ${quote(o.name)}`);
    for (const o of objects) if (o.type === 'view') db.exec(`DROP VIEW IF EXISTS ${quote(o.name)}`);
    for (const o of objects) if (o.type === 'table') db.exec(`DROP TABLE IF EXISTS ${quote(o.name)}`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  migrate({ only: opts.only, tolerant: config.env === 'test' });
}

/* ───────────────────────────── seeds ───────────────────────────── */

/**
 * Runs the named seeds (default: all twelve) in NN order, one transaction per seed.
 * Names are file stems ('00-core', '08-market'); a bare slice name ('market') is accepted too.
 * ASYNC (dynamic loaders) — every caller MUST `await` it (DECISIONS D4.6).
 */
export async function runSeeds(names?: string[]): Promise<void> {
  const { SEEDS } = await import('./seeds/index');
  const { createSeedKit } = await import('../lib/seedKit');
  const wanted = names ? new Set(names) : null;
  for (const entry of SEEDS) {
    if (wanted && !wanted.has(entry.name) && !wanted.has(entry.name.replace(/^\d+-/, ''))) continue;
    const mod = await entry.load();
    const kit = createSeedKit(entry.name);
    tx(() => {
      mod.default(kit);
    });
    kit.finish();
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function newId(): Id {
  return nanoid(14);
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** `'(?,?,?)'` + params; `(NULL)` for an empty list (matches nothing, stays valid SQL). */
export function inClause(ids: readonly string[]): { sql: string; params: string[] } {
  if (ids.length === 0) return { sql: '(NULL)', params: [] };
  return { sql: `(${ids.map(() => '?').join(',')})`, params: [...ids] };
}

const statementCache = new Map<string, Database.Statement>();

/**
 * Lazily prepared + cached statement (foundation convenience; slices may use it too).
 * Safe across `resetDb()` — the cache is cleared whenever the schema is rebuilt.
 */
export function prep(sql: string): Database.Statement {
  let s = statementCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statementCache.set(sql, s);
  }
  return s;
}

/* Module-load migration: MUST stay the last statement of this module. */
migrate({ tolerant: config.env === 'test' });
