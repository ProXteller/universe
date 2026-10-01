/**
 * The ONLY test harness (SPEC §4.2.16). Slices MUST use `createTestApp({ slices: ['<slice>'] })`.
 *
 * ISOLATION MODE (`slices` given): mounts the core routers plus ONLY the named slice routers (dynamic import through
 * routes/mounts.ts); `resetDb({ only: ['00-core', ...their schemas] })`; seeds core (+ the named slices' seeds when
 * asked). Another slice's half-written router, schema or seed can never break this run.
 * FULL MODE (`slices` omitted): the static routes/index.ts + every schema (integration tests).
 * Routers are imported BEFORE seeding so adapters / resolvers are registered.
 *
 * Shared between lanes (DECISIONS D1): surgical Edit only, re-Read right before editing, never overwrite.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { Database } from 'better-sqlite3';
import { Router, type Express } from 'express';
import supertest from 'supertest';
import type { AccountType, EpochMs, Id, Role, WsServerEvent } from '@shared/core';
import { GUIDELINES_VERSION, SESSION_COOKIE } from '@shared/core';
import { createApp } from '../app';
import { config, type Config } from '../config';
import { db, resetDb, runSeeds, tx } from '../db/index';
import { DAY, MIN, now, setNow } from './clock';
import { setMailer } from './mailer';
import { setRealtimeTap } from './realtime';
import { createSession } from './sessions';
import { getAuthedUser, type AuthedUser } from './users';
import { mountCore, mountSlice, SLICE_MOUNTS, type SliceName } from '../routes/mounts';

export interface TestCtx {
  app: Express;
  db: Database;
  /** Cookie session pre-installed; the user must exist. */
  as(userIdOrHandle: string): ReturnType<typeof supertest.agent>;
  anon(): ReturnType<typeof supertest.agent>;
  createUser(
    o?: Partial<{
      id: Id; handle: string; displayName: string; email: string; universityId: Id; role: Role; accountType: AccountType;
      /** Default now − 30 d. */
      createdAt: EpochMs; isAdult: boolean;
      /** Default true. */
      buzzGate: boolean; follows: Id[]; followedBy: Id[];
    }>,
  ): AuthedUser;
  /** Every users.id / handle / display_name / email (firewall tests). */
  seededIdentityStrings(): string[];
  /** Captured publishToUser payloads. */
  wsEventsFor(userId: Id): WsServerEvent[];
  /** Global fetch is stubbed to throw + count. */
  fetchSpy: { calls: number };
}

export interface CreateTestAppOptions {
  slices?: string[];
  /** DEFAULT 'core'. In isolation mode 'all' = core + the named slices' seeds. */
  seed?: 'none' | 'core' | 'all' | string[];
}

const NN: Record<SliceName, string> = {
  auth: '01', reels: '02', buzz: '03', orbit: '04', discover: '05', messages: '06', roommates: '07', market: '08',
  campus: '09', apartments: '10', admin: '11',
};

const stemOf = (slice: SliceName): string => `${NN[slice]}-${slice}`;

/* ───────────────────────────── global test plumbing ───────────────────────────── */

const wsEvents = new Map<Id, WsServerEvent[]>();
let fetchStubbed = false;
const fetchSpy = { calls: 0 };
/** The loopback server behind every `as()` / `anon()` agent of the latest ctx (see createTestApp step 4). */
let harnessServer: http.Server | null = null;

function installGlobalStubs(): void {
  setRealtimeTap((userId, event) => {
    const list = wsEvents.get(userId) ?? [];
    list.push(event);
    wsEvents.set(userId, list);
  });
  if (!fetchStubbed) {
    fetchStubbed = true;
    const g = globalThis as { fetch: typeof fetch };
    g.fetch = ((..._args: unknown[]) => {
      fetchSpy.calls += 1;
      return Promise.reject(new Error('network is disabled in tests'));
    }) as unknown as typeof fetch;
  }
}

/**
 * Tests only: temporarily change config (env, staffEmails, resendApiKey …). Returns a restore function.
 * `config` is a plain object, so every module sees the change immediately.
 */
export function overrideConfig(patch: Partial<Config>): () => void {
  const saved: Partial<Record<keyof Config, unknown>> = {};
  for (const key of Object.keys(patch) as (keyof Config)[]) {
    saved[key] = config[key];
    (config as unknown as Record<string, unknown>)[key] = patch[key];
  }
  return () => {
    for (const key of Object.keys(saved) as (keyof Config)[]) (config as unknown as Record<string, unknown>)[key] = saved[key];
  };
}

/** Tests only: reset the clock, mailer override and captured ws events (createTestApp does this too). */
export function resetTestState(): void {
  setNow(null);
  setMailer(null);
  wsEvents.clear();
  fetchSpy.calls = 0;
}

/* ───────────────────────────── createTestApp ───────────────────────────── */

async function isolationRouter(slices: SliceName[]): Promise<Router> {
  const router = Router();
  mountCore(router);
  for (const mount of SLICE_MOUNTS) {
    if (!slices.includes(mount.slice)) continue;
    const mod = (await import(`./../routes/${mount.slice}.ts`)) as { default: Router };
    mountSlice(router, mount, mod.default);
  }
  return router;
}

export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestCtx> {
  installGlobalStubs();
  resetTestState();

  const slices = (opts.slices ?? []).filter((s): s is SliceName => s in NN);
  const isolation = opts.slices !== undefined;

  // 1. schema
  if (isolation) resetDb({ only: ['00-core', ...slices.map(stemOf)] });
  else resetDb();

  // 2. routers BEFORE seeding (adapters / resolvers / hooks register at import time)
  let apiRouter: Router;
  if (isolation) {
    apiRouter = await isolationRouter(slices);
  } else {
    const mod = (await import('../routes/index')) as { default: Router; createApiRouter: () => Router };
    apiRouter = mod.createApiRouter();
  }
  const app = createApp(apiRouter);

  // 3. seeds (lite)
  const seed = opts.seed ?? 'core';
  if (seed !== 'none') {
    let names: string[] | undefined;
    if (seed === 'core') names = ['00-core'];
    else if (seed === 'all') names = isolation ? ['00-core', ...slices.map(stemOf)] : undefined;
    else names = ['00-core', ...seed];
    await runSeeds(names);
  }

  // 4. ONE loopback-bound server for every agent. Handing supertest the bare app makes it `listen(0)` on the dual-stack
  //    wildcard (`::`) and then dial `127.0.0.1:<port>`; on macOS that wildcard bind succeeds on a port ANOTHER process
  //    already holds on 127.0.0.1, whose listener then answers (foreign 401s, timeouts, `Parse Error: Expected HTTP/`).
  //    Binding 127.0.0.1 makes the kernel skip occupied loopback ports. Request semantics are unchanged: superagent still
  //    opens one `Connection: close` connection per request (no keep-alive pool: an early response to an unfinished
  //    upload would leave a pooled socket busy and ref'd forever). Unref'd so it never holds a worker open.
  harnessServer?.close();
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.unref();
  harnessServer = server;
  const newAgent = (): ReturnType<typeof supertest.agent> => supertest.agent(server);

  const agentFor = (userId: Id): ReturnType<typeof supertest.agent> => {
    const agent = newAgent();
    const { token } = createSession(userId, 'vitest');
    agent.set('Cookie', `${SESSION_COOKIE}=${token}`);
    return agent;
  };

  const ctx: TestCtx = {
    app,
    db,
    as(userIdOrHandle) {
      const user = getAuthedUser(userIdOrHandle);
      if (!user) throw new Error(`createTestApp.as(): unknown user "${userIdOrHandle}"`);
      return agentFor(user.id);
    },
    anon() {
      return newAgent();
    },
    createUser(o = {}) {
      const at = now();
      const suffix = crypto.randomBytes(4).toString('hex');
      const id = o.id ?? `t_${suffix}`;
      const handle = o.handle ?? `test_${suffix}`;
      const universityId = o.universityId ?? 'uni_utexas';
      const domain = (db.prepare('SELECT domain FROM universities WHERE id = ?').get(universityId) as { domain: string } | undefined)?.domain;
      if (!domain) throw new Error(`createTestApp.createUser(): unknown university "${universityId}" (seed core first)`);
      const createdAt = o.createdAt ?? at - 30 * DAY;
      tx(() => {
        const rank = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE university_id = ?').get(universityId) as { n: number }).n + 1;
        db.prepare(
          `INSERT INTO users (id, email, handle, display_name, avatar_seed, account_type, role, university_id, is_adult, campus_rank,
             invite_code, guidelines_version, guidelines_accepted_at, buzz_gate_version, buzz_gate_accepted_at, profile_completed_at,
             onboarding_completed_at, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id, o.email ?? `${handle}@${domain}`, handle, o.displayName ?? `Test ${suffix}`, id, o.accountType ?? 'student',
          o.role ?? 'user', universityId, o.isAdult === false ? 0 : 1, rank, `T${suffix.toUpperCase()}`, GUIDELINES_VERSION,
          createdAt + MIN, o.buzzGate === false ? null : GUIDELINES_VERSION, o.buzzGate === false ? null : createdAt + MIN,
          createdAt, createdAt + MIN, createdAt, createdAt,
        );
        const insFollow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)');
        const bump = (follower: Id, followee: Id): void => {
          db.prepare('UPDATE users SET following_count = following_count + 1 WHERE id = ?').run(follower);
          db.prepare('UPDATE users SET follower_count = follower_count + 1 WHERE id = ?').run(followee);
        };
        for (const target of o.follows ?? []) if (insFollow.run(id, target, at).changes) bump(id, target);
        for (const source of o.followedBy ?? []) if (insFollow.run(source, id, at).changes) bump(source, id);
      });
      const user = getAuthedUser(id);
      if (!user) throw new Error('createTestApp.createUser(): insert failed');
      return user;
    },
    seededIdentityStrings() {
      const rows = db.prepare('SELECT id, handle, display_name, email FROM users').all() as {
        id: string; handle: string; display_name: string; email: string;
      }[];
      const out = new Set<string>();
      for (const r of rows) for (const v of [r.id, r.handle, r.display_name, r.email]) if (v && v.length >= 3) out.add(v);
      return [...out];
    },
    wsEventsFor(userId) {
      return [...(wsEvents.get(userId) ?? [])];
    },
    fetchSpy,
  };
  return ctx;
}

/* ───────────────────────────── assertions ───────────────────────────── */

/** Forbidden keys anywhere in a Buzz response (SPEC §3.2 #1, safety L1). */
export const FORBIDDEN_KEYS: readonly string[] = [
  'authorId', 'author_id', 'userId', 'user_id', 'handle', 'name', 'displayName', 'avatar', 'avatarUrl', 'email',
  'universityEmail', 'profile',
];

function walk(value: unknown, path: string, visit: (key: string, path: string, value: unknown) => void, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit, seen));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    visit(k, `${path}.${k}`, v);
    walk(v, `${path}.${k}`, visit, seen);
  }
}

/** Throws when any object key (at any depth) is in FORBIDDEN_KEYS. */
export function assertNoForbiddenKeys(body: unknown): void {
  const hits: string[] = [];
  walk(body, '$', (key, path) => {
    if (FORBIDDEN_KEYS.includes(key)) hits.push(path);
  });
  if (hits.length) throw new Error(`forbidden keys in response: ${hits.join(', ')}`);
}

/** Throws when the serialized body contains any of `strings` (case-insensitive substring). */
export function assertNoIdentityLeak(body: unknown, strings: string[]): void {
  const text = JSON.stringify(body ?? null).toLowerCase();
  const hits = strings.filter((s) => s.length >= 3 && text.includes(s.toLowerCase()));
  if (hits.length) throw new Error(`identity leak in response: ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ` (+${hits.length - 5})` : ''}`);
}
