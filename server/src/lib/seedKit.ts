/**
 * Seed kit (SPEC §4.6). One kit per seed run (`createSeedKit(seedName)`), so every seed has its OWN deterministic PRNG
 * stream — a slice seed produces the same rows in isolation mode and in a full `db:reset`.
 *
 * Seeds write their own tables with direct SQL, MUST be deterministic (`kit.rng` only), MUST work at both scales,
 * MUST keep every denormalised counter equal to its rows, and MUST call `markPublicActivity` (with the row's
 * created_at) for seeded reels / posts / events.
 *
 * Methods that depend on M2 modules (`notify*`, `convo.*`, `waitlist`, `track`) call them through their final
 * signatures. While such a module is still a 501 stub the call is SKIPPED and counted; `finish()` logs one warning per
 * kind — so seeds (and `db:reset`) run green during the foundation build-out and light up when the body lands.
 */
import type Database from 'better-sqlite3';
import type {
  AccountType, AnalyticsEventName, AnalyticsProps, ContextCardRef, EpochMs, Id, MemberState, Message, WaitlistFeature,
} from '@shared/core';
import { config } from '../config';
import { db, prep } from '../db/index';
import { ORG, STAFF, U } from '../db/seeds/ids';
import { trackEvent } from './analytics';
import { DAY, HOUR, MIN, now } from './clock';
import {
  addMember, createCourseConversation, markRead, seedDm, seedGroup, sendMessage, type SendInput,
} from './conversations';
import { log } from './logger';
import { notifyAnonymous, notifySeeded, type NotifyAnonymousInput, type NotifyInput } from './notify';
import * as seedArt from './seedArt';
import { isNotImplemented } from './stub';
import { getAuthedUser, type AuthedUser } from './users';
import { joinWaitlist } from './waitlist';

export interface SeedUser {
  id: Id;
  handle: string;
  displayName: string;
  universityId: Id;
  accountType: AccountType;
  major: string | null;
  classYear: number | null;
  createdAt: EpochMs;
  isPersona: boolean;
}

export interface SeedKit {
  db: Database.Database;
  now: EpochMs;
  scale: 'full' | 'lite';
  rng(): number;
  int(min: number, max: number): number;
  pick<T>(a: readonly T[]): T;
  sample<T>(a: readonly T[], n: number): T[];
  chance(p: number): boolean;
  /** Deterministic, e.g. id('reel', 3) → 'reel_0003'. */
  id(prefix: string, n: number): Id;
  /** now − … */
  ago(o: { m?: number; h?: number; d?: number }): EpochMs;
  /** 40 % last 24 h · 35 % last week · 25 % older (≤ 45 d), deterministic; i = 0 is the newest. */
  spread(i: number, total: number): EpochMs;
  users: {
    all: SeedUser[];
    personas: SeedUser[];
    orgs: SeedUser[];
    bg(universityId?: Id): SeedUser[];
    get(idOrHandle: string): SeedUser;
    authed(idOrHandle: string): AuthedUser;
  };
  /** Who this user follows. */
  follows(userId: Id): Id[];
  art: typeof import('./seedArt');
  /** Honours the seed-only `actorIds` (one collapsed row, e.g. 13 likers, read). */
  notify(i: NotifyInput & { createdAt: EpochMs; read: boolean }): void;
  notifyAnonymous(i: NotifyAnonymousInput & { createdAt: EpochMs; read: boolean }): void;
  /** Every kit.convo.* call is silent: no notifications, no ws, no rate limits, no context validation. */
  convo: {
    dm(a: Id, b: Id, o?: { context?: ContextCardRef; peerState?: MemberState }): Id;
    group(title: string, ownerId: Id, memberIds: Id[]): Id;
    course(input: { id?: Id; universityId: Id; courseId: Id; code: string; title: string; term: string; createdBy: Id | null; createdAt: EpochMs }): Id;
    join(conversationId: Id, userId: Id, joinedAt: EpochMs): void;
    say(conversationId: Id, fromId: Id | null, text: string, at: EpochMs, extra?: Partial<SendInput>): Message;
    readAll(conversationId: Id, userId: Id): void;
  };
  /** joinWaitlist(); the only seed path into `waitlist`. */
  waitlist(user: SeedUser, feature: WaitlistFeature, at: EpochMs, source?: string): void;
  track(name: AnalyticsEventName, user: SeedUser, props: AnalyticsProps, at: EpochMs): void;
}

/** SPEC §7: background users come from a fixed name list with PRNG seed 20260921. */
export const SEED_PRNG_BASE = 20260921;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERSONA_IDS: ReadonlySet<string> = new Set<string>(Object.values(U));
const ORG_IDS: ReadonlySet<string> = new Set<string>(Object.values(ORG));
const STAFF_IDS: ReadonlySet<string> = new Set<string>(Object.values(STAFF));

interface SeedUserRow {
  id: Id; handle: string; display_name: string; university_id: Id; account_type: AccountType;
  major: string | null; class_year: number | null; created_at: EpochMs;
}

const warned = new Set<string>();

export function createSeedKit(seedName = '00-core'): SeedKit & { finish(): void } {
  const kitNow = now();
  // The core seed uses the SPEC'd PRNG seed verbatim; every other seed derives its own stream from it.
  const rng = mulberry32(seedName === '00-core' ? SEED_PRNG_BASE : (SEED_PRNG_BASE ^ hashString(seedName)) >>> 0);
  const skipped = new Map<string, number>();

  /** Calls into an M2 module; a 501 stub is skipped + counted, any other error propagates. */
  function viaStub<T>(what: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      if (!isNotImplemented(err)) throw err;
      skipped.set(what, (skipped.get(what) ?? 0) + 1);
      return undefined;
    }
  }

  /* users are read lazily from the DB (the core seed creates them during its own run) */
  let cache: { all: SeedUser[]; byKey: Map<string, SeedUser> } | null = null;
  function load(): { all: SeedUser[]; byKey: Map<string, SeedUser> } {
    if (cache) return cache;
    const rows = db
      .prepare(
        `SELECT id, handle, display_name, university_id, account_type, major, class_year, created_at
           FROM users WHERE status != 'deleted' ORDER BY id`,
      )
      .all() as SeedUserRow[];
    const all = rows.map<SeedUser>((r) => ({
      id: r.id, handle: r.handle, displayName: r.display_name, universityId: r.university_id, accountType: r.account_type,
      major: r.major, classYear: r.class_year, createdAt: r.created_at, isPersona: PERSONA_IDS.has(r.id),
    }));
    const byKey = new Map<string, SeedUser>();
    for (const u of all) {
      byKey.set(u.id, u);
      byKey.set(u.handle.toLowerCase(), u);
    }
    cache = { all, byKey };
    return cache;
  }

  const kit: SeedKit & { finish(): void; refreshUsers(): void } = {
    db,
    now: kitNow,
    scale: config.seedScale,
    rng,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(rng() * (hi - lo + 1));
    },
    pick<T>(a: readonly T[]): T {
      if (a.length === 0) throw new Error('kit.pick: empty list');
      return a[Math.floor(rng() * a.length)]!;
    },
    sample<T>(a: readonly T[], n: number): T[] {
      const copy = [...a];
      const take = Math.max(0, Math.min(n, copy.length));
      for (let i = 0; i < take; i++) {
        const j = i + Math.floor(rng() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy.slice(0, take);
    },
    chance(p) {
      return rng() < p;
    },
    id(prefix, n) {
      return `${prefix}_${String(n).padStart(4, '0')}`;
    },
    ago(o) {
      return kitNow - ((o.m ?? 0) * MIN + (o.h ?? 0) * HOUR + (o.d ?? 0) * DAY);
    },
    spread(i, total) {
      const t = Math.max(1, total);
      const f = Math.min(0.9999, Math.max(0, (i + 0.5) / t));
      // deterministic jitter from (i, total) only — never from kit.rng, so call order cannot change timestamps
      const jitter = (hashString(`spread:${i}:${t}`) % 1000) / 1000;
      let agoMs: number;
      if (f < 0.4) agoMs = (f / 0.4) * DAY;
      else if (f < 0.75) agoMs = DAY + ((f - 0.4) / 0.35) * 6 * DAY;
      else agoMs = 7 * DAY + ((f - 0.75) / 0.25) * 38 * DAY;
      agoMs += jitter * Math.min(20 * MIN, agoMs * 0.05);
      return Math.round(kitNow - Math.max(2 * MIN, agoMs));
    },
    users: {
      get all() {
        return load().all;
      },
      get personas() {
        return load().all.filter((u) => u.isPersona);
      },
      get orgs() {
        return load().all.filter((u) => ORG_IDS.has(u.id));
      },
      bg(universityId?: Id) {
        return load().all.filter((u) => u.id.startsWith('bg_') && (!universityId || u.universityId === universityId));
      },
      get(idOrHandle: string) {
        const u = load().byKey.get(idOrHandle) ?? load().byKey.get(idOrHandle.toLowerCase());
        if (!u) throw new Error(`kit.users.get: unknown seed user "${idOrHandle}"`);
        return u;
      },
      authed(idOrHandle: string) {
        const u = kit.users.get(idOrHandle);
        const a = getAuthedUser(u.id);
        if (!a) throw new Error(`kit.users.authed: unknown seed user "${idOrHandle}"`);
        return a;
      },
    },
    follows(userId) {
      return (prep('SELECT followee_id AS id FROM follows WHERE follower_id = ? ORDER BY followee_id').all(userId) as { id: Id }[]).map((r) => r.id);
    },
    art: seedArt,
    notify(i) {
      viaStub('notify', () => notifySeeded(i));
    },
    notifyAnonymous(i) {
      viaStub('notifyAnonymous', () => notifyAnonymous(i));
    },
    convo: {
      dm(a, b, o) {
        return seedDm(a, b, o);
      },
      group(title, ownerId, memberIds) {
        return seedGroup(title, ownerId, memberIds);
      },
      course(input) {
        return createCourseConversation({ ...input, silent: true });
      },
      join(conversationId, userId, joinedAt) {
        addMember(conversationId, userId, { state: 'active', joinedAt, silent: true });
      },
      say(conversationId, fromId, text, at, extra) {
        const sender = fromId ? kit.users.authed(fromId) : null;
        return sendMessage({
          kind: sender ? 'text' : 'system', ...extra, conversationId, sender, text, createdAt: at, silent: true,
        });
      },
      readAll(conversationId, userId) {
        const row = prep('SELECT last_message_id AS id FROM conversations WHERE id = ?').get(conversationId) as { id: Id | null } | undefined;
        if (row?.id) markRead(conversationId, userId, row.id);
      },
    },
    waitlist(user, feature, at, source) {
      viaStub('waitlist', () => joinWaitlist(user.id, feature, { at, ...(source !== undefined ? { source } : {}) }));
    },
    track(name, user, props, at) {
      trackEvent(name, { userId: user.id, universityId: user.universityId }, props, at);
    },
    /** Foundation-internal: the core seed calls this after inserting users. */
    refreshUsers() {
      cache = null;
    },
    /** Foundation-internal: `runSeeds` calls this after the seed's transaction. Warns once per process per kind. */
    finish() {
      for (const [what, n] of skipped) {
        const key = `${seedName}:${what}`;
        if (!warned.has(key)) {
          warned.add(key);
          log.warn(`seed ${seedName}: ${n} kit.${what}() call(s) skipped — the module behind it is still a 501 stub`);
        }
      }
      skipped.clear();
    },
  };
  return kit;
}

/** Foundation-internal helper for seeds/00-core.ts (the only seed that creates users). */
export function refreshSeedUsers(kit: SeedKit): void {
  (kit as SeedKit & { refreshUsers?: () => void }).refreshUsers?.();
}

export { STAFF_IDS as SEED_STAFF_IDS };
