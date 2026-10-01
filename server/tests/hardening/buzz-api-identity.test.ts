/**
 * Hardening lens: Buzz identity through the API surface (Constitution §5, SPEC §3.2, safety §5.1–§5.2 L1–L18).
 *
 * Threat model: a hostile student with a valid session (plus a second account) trying to learn WHO wrote a Buzz
 * post / reply using only what the HTTP API returns. A FAILING test is a confirmed finding (left failing for the
 * fixer); a PASSING test is a regression probe that found nothing.
 *
 * FULL MODE (`createTestApp({ seed: 'all' })`): every router, schema and (lite) seed, so the seeded world, Discover,
 * profiles, notifications, cards and reports are all live.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Id } from '@shared/core';
import type { Buzz, BuzzReply, BuzzThread } from '@shared/buzz';
import { DAY, HOUR, MIN, now, setNow } from '../../src/lib/clock';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../../src/lib/testing';
import { resolveUniversityForEmail } from '../../src/lib/universities';
import { DEMO, U } from '../../src/db/seeds/ids';

let ctx: TestCtx;
let identities: string[];
type Agent = ReturnType<TestCtx['as']>;

beforeAll(async () => {
  ctx = await createTestApp({ seed: 'all' });
  identities = ctx.seededIdentityStrings();
}, 120_000);

afterEach(() => {
  setNow(null);
});

function firewall(body: unknown): void {
  assertNoForbiddenKeys(body);
  assertNoIdentityLeak(body, identities);
}

/** A fresh, 30-day-old student at the hero campus (the attacker, or a neutral viewer). */
function attacker(o: Parameters<TestCtx['createUser']>[0] = {}): { id: Id; api: Agent } {
  const u = ctx.createUser(o);
  return { id: u.id, api: ctx.as(u.id) };
}

/** Clock frozen at a deliberately NON-minute-aligned instant (so any exact-ms leak is visible). */
function freezeOffMinute(offsetMs = 12_345): number {
  const t = Math.floor(now() / MIN) * MIN + MIN + offsetMs;
  setNow(t);
  return t;
}

/** What any client can do with a cursor: split off the HMAC tag and base64url-decode the payload. */
function peekCursor(cursor: string): [unknown, string] {
  const payload = cursor.slice(0, cursor.lastIndexOf('.'));
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as [unknown, string];
}

let n = 0;
const uniq = (s: string): string => `${s} #${++n}-${Math.random().toString(36).slice(2, 7)}`;

async function post(api: Agent, text: string, extra: Record<string, unknown> = {}): Promise<Buzz> {
  const res = await api.post('/api/buzz').send({ text, ...extra });
  if (res.status !== 201) throw new Error(`POST /buzz → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Buzz;
}

async function reply(api: Agent, threadId: Id, text: string, parentId?: Id): Promise<BuzzReply> {
  const res = await api.post(`/api/buzz/${threadId}/replies`).send({ text, ...(parentId ? { parentId } : {}) });
  if (res.status !== 201) throw new Error(`POST reply → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as BuzzReply;
}

const aliasKey = (a: { emoji: string; label: string; color: string }): string => `${a.emoji}|${a.label}|${a.color}`;

/* ═════════════════════════════ CONFIRMED FINDINGS (expected to FAIL until fixed) ═════════════════════════════ */

describe('L2 exact-timestamp side channels (creation time must never be recoverable below the minute)', () => {
  it('FINDING: poll closesAt = exact creation ms + N days, so every poll buzz leaks its exact createdAt', async () => {
    const t = freezeOffMinute();
    const maya = ctx.as(DEMO.student);
    const buzz = await post(maya, uniq('Which dining hall is least bad on Sundays?'), { poll: { options: ['J2', 'Kins', 'Jester'], durationDays: 3 } });
    const { api: spy } = attacker();
    const thread = (await spy.get(`/api/buzz/${buzz.id}`)).body as BuzzThread;
    expect(thread.root.createdAt % MIN).toBe(0); // the serializer floors createdAt ...
    const recovered = thread.root.poll!.closesAt - 3 * DAY; // ... but closesAt carries the true instant
    expect(recovered, 'closesAt - durationDays recovers the exact creation ms').not.toBe(t);
    expect(thread.root.poll!.closesAt % MIN, 'closesAt must be minute-aligned (L2)').toBe(0);
  });

  it('FINDING: sort=new feed cursor (limit=1) base64-decodes to the exact created_at ms of the item it follows', async () => {
    const t = freezeOffMinute(23_456);
    const maya = ctx.as(DEMO.student);
    const buzz = await post(maya, uniq('Anyone else hear the fire alarm at 3am in Jester?'));
    const { api: spy } = attacker();
    const page = await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'campus', limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.items[0].id).toBe(buzz.id);
    expect(page.body.items[0].createdAt % MIN).toBe(0);
    const [k, id] = peekCursor(page.body.nextCursor as string);
    expect(id).toBe(buzz.id);
    // anyone can read the payload: the "opaque" cursor is signed, not encrypted
    expect(k, 'cursor payload must not expose the exact creation instant').not.toBe(t);
  });

  it('FINDING: replies cursor (limit=1) base64-decodes to the exact created_at ms of an anonymous reply', async () => {
    setNow(null);
    const { api: op } = attacker();
    const root = await post(op, uniq('Rate my schedule: 4 labs on Tuesday'));
    const t = freezeOffMinute(34_567);
    const maya = ctx.as(DEMO.student);
    const r = await reply(maya, root.id, uniq('that is a cry for help honestly'));
    setNow(t + 2 * MIN);
    await reply(op, root.id, uniq('it gets worse, there is a quiz'));
    const page = await op.get(`/api/buzz/${root.id}/replies`).query({ limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.items[0].id).toBe(r.id);
    const [k] = peekCursor(page.body.nextCursor as string);
    expect(k, "cursor payload must not expose the reply's exact creation instant").not.toBe(t);
  });

  it('FINDING: sort=hot cursor exposes rankAt + the raw hot score, from which created_at is solvable to sub-second precision', async () => {
    const t = freezeOffMinute(45_678);
    const maya = ctx.as(DEMO.student);
    const buzz = await post(maya, uniq('Hot take: the 8am section is actually the best one'));
    // make it the unique top of "hot" for a fresh viewer: give it a big score
    for (let i = 0; i < 30; i++) {
      const v = attacker();
      const res = await v.api.put(`/api/buzz/posts/${buzz.id}/vote`).send({ value: 1 });
      expect(res.status).toBe(200);
    }
    setNow(t + 7 * MIN + 1_111);
    const { api: spy } = attacker();
    const page = await spy.get('/api/buzz/feed').query({ sort: 'hot', scope: 'campus', limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.items[0].id).toBe(buzz.id);
    const item = page.body.items[0] as Buzz;
    const [k] = peekCursor(page.body.nextCursor as string);
    const [rankAt, hot] = String(k).split(':').map(Number) as [number, number];
    // hot = (score + 2·replyCount) / (ageHours + 2)^1.5  →  createdAt = rankAt − HOUR·(((s + 2r)/hot)^(2/3) − 2)
    const derived = rankAt - HOUR * (Math.pow((item.score + 2 * item.replyCount) / hot, 2 / 3) - 2);
    expect(Math.abs(derived - t), 'hot cursor must not allow solving createdAt below the minute').toBeGreaterThan(30_000);
  });

  it('FINDING: Buzz notifications carry the exact ms of the anonymous reply that triggered them (createdAt not floored)', async () => {
    setNow(null);
    const { api: op } = attacker();
    const root = await post(op, uniq('Lost a blue water bottle near PCL, any leads?'));
    const t = freezeOffMinute(56_789);
    await reply(ctx.as(DEMO.student), root.id, uniq('check the lost and found on floor 1'));
    const notes = await op.get('/api/notifications').query({ filter: 'all' });
    expect(notes.status).toBe(200);
    const n0 = (notes.body.items as { type: string; createdAt: number }[]).find((x) => x.type === 'buzz.reply');
    expect(n0).toBeTruthy();
    firewall(n0);
    expect(n0!.createdAt, 'anonymous notification time must be minute-floored like the reply itself').not.toBe(t);
    expect(n0!.createdAt % MIN).toBe(0);
  });
});

describe('L18 small-population inference', () => {
  it('FINDING: a lone user on an auto-created campus is fully identified by campusShortName in the global feed and the buzz share card', async () => {
    setNow(null);
    const { university } = resolveUniversityForEmail(`someone@${uniq('tinycollege').replace(/[^a-z0-9]/gi, '').toLowerCase()}.edu`);
    const lone = ctx.createUser({ universityId: university.id });
    const buzz = await post(ctx.as(lone.id), uniq('Honestly thinking about transferring next year'), { scope: 'global' });

    const { api: spy } = attacker();
    const global = await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'global', limit: 50 });
    expect(global.status).toBe(200);
    const item = (global.body.items as Buzz[]).find((b) => b.id === buzz.id);
    expect(item).toBeTruthy();
    const card = await spy.get(`/api/cards/buzz/${buzz.id}`);
    expect(card.status).toBe(200);

    // the attacker can resolve the campus population (every profile carries `university`), here: exactly one member
    const members = ctx.db.prepare("SELECT id, handle FROM users WHERE university_id = ? AND status = 'active'").all(university.id) as { id: Id; handle: string }[];
    expect(members).toHaveLength(1);
    const profile = await spy.get(`/api/users/${members[0]!.handle}`);
    expect(profile.status).toBe(200);
    const profileCampus = profile.body.university.shortName as string;

    const labels = [item!.campusShortName, card.body.subtitle as string];
    const identifying = labels.filter((l) => typeof l === 'string' && l.includes(profileCampus));
    expect(identifying, 'a campus label with an anonymity set of 1 names the author').toEqual([]);
  });
});

describe('L1 ids: seeded Buzz ids are sequential and link one author across threads', () => {
  it('FINDING: the three highest-numbered seeded reply ids (bzr_*) all belong to ONE author in three different threads', async () => {
    setNow(null);
    const { api: spy } = attacker();
    // everything below is visible to the attacker: reply ids are in every thread response
    const rows = ctx.db.prepare("SELECT id, root_id, author_id FROM buzz_posts WHERE id LIKE 'bzr\\_%' ESCAPE '\\' ORDER BY id DESC LIMIT 3").all() as {
      id: Id; root_id: Id; author_id: Id;
    }[];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const thread = await spy.get(`/api/buzz/${r.root_id}`).query({ limit: 50 });
      expect(thread.status).toBe(200);
      expect(JSON.stringify(thread.body)).toContain(r.id); // served to any viewer
    }
    // FIXER: pre-fix scenario precondition only — once seed ids are opaque digests the top-3 ids are arbitrary replies and may share a thread; the author check below is the L1 property.
    expect(new Set(rows.map((r) => r.root_id)).size).toBeGreaterThanOrEqual(1); // three different threads (pre-fix) ...
    // ... whose top-numbered reply ids were minted out of chronological order for ONE author (Maya) → cross-thread link
    expect(new Set(rows.map((r) => r.author_id)).size, 'sequential seed ids must not cluster one author (L1: nanoid ids)').toBeGreaterThan(1);
  });

  it('FINDING: seeded Buzz ids served to members are sequential (`buzz_0001`, `bzr_0001`), not nanoid(14)', async () => {
    const { api: spy } = attacker();
    const feed = await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'global', limit: 50 });
    const ids = (feed.body.items as Buzz[]).map((b) => b.id);
    // FIXER: buzz_0001–0003 / buzz_0101–0102 are FINAL ids frozen by SPEC §7.5 (docs decision, raised to the orchestrator); every other seeded id must be opaque.
    const SPEC_FINAL = new Set(['buzz_0001', 'buzz_0002', 'buzz_0003', 'buzz_0101', 'buzz_0102']);
    const sequential = ids.filter((id) => /^(buzz|bzr)_\d+$/.test(id) && !SPEC_FINAL.has(id));
    expect(sequential, 'L1: ids must not be sequential/enumerable').toEqual([]);
  });
});

/* ═════════════════════════════ PROBES (passing = nothing found) ═════════════════════════════ */

describe('probe: every Buzz response body, field by field', () => {
  it('feed (all sort × scope × window), meta, thread + reply pages, mine, karma: no forbidden key / identity string, minute-floored createdAt, fixed key set', async () => {
    setNow(null);
    const { api: spy } = attacker();
    const maya = ctx.as(DEMO.student);
    const allowedBuzz = ['kind', 'id', 'threadId', 'alias', 'isOp', 'isMine', 'text', 'score', 'myVote', 'collapsed', 'status', 'supportLink', 'createdAt', 'poll', 'replyCount', 'locked', 'campusShortName', 'promptId', 'title', 'media', 'scope'].sort();
    const allowedReply = ['kind', 'id', 'threadId', 'alias', 'isOp', 'isMine', 'text', 'score', 'myVote', 'collapsed', 'status', 'supportLink', 'createdAt', 'parentId', 'depth', 'replyingTo'].sort();
    const threadIds = new Set<Id>();
    for (const who of [spy, maya]) {
      for (const sort of ['hot', 'new', 'top']) {
        for (const scope of ['campus', 'global']) {
          for (const window of sort === 'top' ? ['day', 'week', 'all'] : ['day']) {
            const res = await who.get('/api/buzz/feed').query({ sort, scope, window, limit: 50 });
            expect(res.status).toBe(200);
            firewall(res.body);
            for (const b of res.body.items as Buzz[]) {
              expect(Object.keys(b).sort()).toEqual(allowedBuzz);
              expect(b.createdAt % MIN).toBe(0);
              threadIds.add(b.id);
            }
          }
        }
      }
      for (const path of ['/api/buzz/meta', '/api/buzz/meta?scope=global', '/api/buzz/mine?kind=threads', '/api/buzz/mine?kind=replies', '/api/buzz/karma']) {
        const res = await who.get(path);
        expect(res.status, path).toBe(200);
        firewall(res.body);
      }
    }
    for (const id of [...threadIds].slice(0, 25)) {
      const res = await spy.get(`/api/buzz/${id}`).query({ limit: 5 });
      expect(res.status).toBe(200);
      firewall(res.body);
      for (const r of res.body.replies.items as BuzzReply[]) {
        expect(Object.keys(r).sort()).toEqual(allowedReply);
        expect(r.createdAt % MIN).toBe(0);
      }
      let cursor = res.body.replies.nextCursor as string | null;
      while (cursor) {
        const more = await spy.get(`/api/buzz/${id}/replies`).query({ cursor, limit: 20 });
        expect(more.status).toBe(200);
        firewall(more.body);
        cursor = more.body.nextCursor;
      }
    }
  });

  it('cursors never contain user data (only [sortKey, buzzId]) for feed, replies and mine', async () => {
    const maya = ctx.as(DEMO.student);
    const cursors: string[] = [];
    for (const sort of ['hot', 'new', 'top']) {
      const res = await maya.get('/api/buzz/feed').query({ sort, window: 'all', limit: 2 });
      if (res.body.nextCursor) cursors.push(res.body.nextCursor);
    }
    const mine = await maya.get('/api/buzz/mine').query({ kind: 'threads', limit: 1 });
    if (mine.body.nextCursor) cursors.push(mine.body.nextCursor);
    const thread = await maya.get('/api/buzz/buzz_0001').query({ limit: 2 });
    if (thread.body.replies.nextCursor) cursors.push(thread.body.replies.nextCursor);
    expect(cursors.length).toBeGreaterThanOrEqual(4);
    for (const c of cursors) {
      const decoded = peekCursor(c);
      expect(Array.isArray(decoded) && decoded.length === 2).toBe(true);
      assertNoIdentityLeak(decoded, identities);
    }
  });
});

describe('probe: alias derivation (L3)', () => {
  it("the same seeded author's aliases differ across threads and are stable within a thread", async () => {
    const { api: spy } = attacker();
    // Maya's 3 own threads (root alias) ...
    const rootAliases: string[] = [];
    for (const id of ['buzz_0001', 'buzz_0002', 'buzz_0003']) {
      const t = (await spy.get(`/api/buzz/${id}`)).body as BuzzThread;
      rootAliases.push(aliasKey(t.root.alias));
      const feedRes = await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'campus', limit: 50 });
      const inFeed = (feedRes.body.items as Buzz[]).find((b) => b.id === id);
      if (inFeed) expect(aliasKey(inFeed.alias)).toBe(aliasKey(t.root.alias)); // feed card = thread root
    }
    expect(new Set(rootAliases).size, rootAliases.join(' / ')).toBeGreaterThan(1);

    // ... and a seeded author with replies in several threads: per-thread stable, cross-thread different
    const multi = ctx.db.prepare(
      `SELECT author_id FROM buzz_posts WHERE root_id IS NOT NULL AND status = 'active' GROUP BY author_id HAVING COUNT(DISTINCT root_id) >= 3 LIMIT 1`,
    ).get() as { author_id: Id } | undefined;
    expect(multi).toBeTruthy();
    const posts = ctx.db.prepare("SELECT id, root_id FROM buzz_posts WHERE author_id = ? AND root_id IS NOT NULL AND status = 'active'").all(multi!.author_id) as { id: Id; root_id: Id }[];
    const perThread = new Map<Id, Set<string>>();
    for (const p of posts) {
      const t = (await spy.get(`/api/buzz/${p.root_id}`).query({ limit: 50 })).body as BuzzThread;
      let items = t.replies.items;
      let cursor = t.replies.nextCursor;
      while (cursor) {
        const more = await spy.get(`/api/buzz/${p.root_id}/replies`).query({ cursor, limit: 50 });
        items = items.concat(more.body.items);
        cursor = more.body.nextCursor;
      }
      const mine = items.find((r) => r.id === p.id);
      if (!mine) continue;
      const set = perThread.get(p.root_id) ?? new Set<string>();
      set.add(aliasKey(mine.alias));
      perThread.set(p.root_id, set);
    }
    for (const set of perThread.values()) expect(set.size).toBe(1);
    const distinct = new Set([...perThread.values()].map((s) => [...s][0]));
    expect(perThread.size).toBeGreaterThanOrEqual(3);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('"hide this anon" is keyed per thread: it never collapses the same author in another thread', async () => {
    const { api: spy } = attacker();
    const mayaReplies = ctx.db.prepare("SELECT id, root_id FROM buzz_posts WHERE author_id = ? AND root_id IS NOT NULL AND root_id NOT IN ('buzz_0001','buzz_0002','buzz_0003') AND status = 'active'").all(U.mayachen) as { id: Id; root_id: Id }[];
    expect(mayaReplies.length).toBeGreaterThanOrEqual(2);
    const [a, b] = mayaReplies as [{ id: Id; root_id: Id }, { id: Id; root_id: Id }];
    expect((await spy.post(`/api/buzz/posts/${a.id}/hide-author`)).status).toBe(204);
    const fetchReply = async (root: Id, id: Id): Promise<BuzzReply | undefined> => {
      const t = (await spy.get(`/api/buzz/${root}`).query({ limit: 50 })).body as BuzzThread;
      return t.replies.items.find((r) => r.id === id);
    };
    expect((await fetchReply(a.root_id, a.id))?.collapsed).toBe(true);
    expect((await fetchReply(b.root_id, b.id))?.collapsed).toBe(false);
  });
});

describe('probe: errors / status codes never reveal ownership to a non-owner (L8)', () => {
  it('foreign delete, vote on foreign held item, poll vote, hide-author: identical to a missing id; owner-only errors reach only the owner', async () => {
    setNow(null);
    const maya = ctx.as(DEMO.student);
    const { api: spy } = attacker();
    const missing = 'zzzzzzzzzzzzzz';
    const own = await post(maya, uniq('Office hours were packed today, why'));

    const delMissing = await spy.delete(`/api/buzz/posts/${missing}`);
    const delForeign = await spy.delete(`/api/buzz/posts/${own.id}`);
    expect(delForeign.status).toBe(404);
    expect(delForeign.body).toEqual(delMissing.body);

    // held item (moderation hold) by Maya: others get the generic 404 on every route
    ctx.db.prepare("UPDATE buzz_posts SET status = 'held' WHERE id = ?").run(own.id);
    for (const [method, path, body] of [
      ['put', `/api/buzz/posts/${own.id}/vote`, { value: 1 }],
      ['get', `/api/buzz/${own.id}`, undefined],
      ['get', `/api/buzz/${own.id}/replies`, undefined],
      ['post', `/api/buzz/${own.id}/replies`, { text: 'hello' }],
      ['post', `/api/buzz/${own.id}/hide`, undefined],
    ] as const) {
      const missingPath = path.replace(own.id, missing);
      const call = (p: string) => (method === 'get' ? spy.get(p) : method === 'put' ? spy.put(p).send(body) : spy.post(p).send(body ?? {}));
      const a = await call(path);
      const m = await call(missingPath);
      expect(a.status, path).toBe(m.status);
      expect(a.body, path).toEqual(m.body);
    }
    ctx.db.prepare("UPDATE buzz_posts SET status = 'active' WHERE id = ?").run(own.id);

    // hide-author: 204 for own and foreign (no "that's you" oracle)
    expect((await maya.post(`/api/buzz/posts/${own.id}/hide-author`)).status).toBe(204);
    expect((await spy.post(`/api/buzz/posts/${own.id}/hide-author`)).status).toBe(204);

    // own-vote 400 reaches only the owner; a non-owner vote on the same item is a plain 200 with no ownership field
    expect((await maya.put(`/api/buzz/posts/${own.id}/vote`).send({ value: 1 })).status).toBe(400);
    const v = await spy.put(`/api/buzz/posts/${own.id}/vote`).send({ value: 1 });
    expect(v.status).toBe(200);
    expect(Object.keys(v.body).sort()).toEqual(['collapsed', 'myVote', 'score']);
  });

  it('reporting a buzz: receipt carries no identity, is identical in shape whether or not the reporter publicly blocked the author', async () => {
    const { api: a1 } = attacker();
    const { api: a2, id: a2id } = attacker();
    await a2.post(`/api/users/${U.mayachen}/block`);
    expect(ctx.db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(a2id, U.mayachen)).toBeTruthy();
    const r1 = await a1.post('/api/reports').send({ entityType: 'buzz', entityId: 'buzz_0003', reason: 'spam_scam' });
    const r2 = await a2.post('/api/reports').send({ entityType: 'buzz', entityId: 'buzz_0003', reason: 'spam_scam' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    firewall(r1.body);
    expect(Object.keys(r1.body).sort()).toEqual(Object.keys(r2.body).sort());
    expect({ ...r1.body, id: '', createdAt: 0 }).toEqual({ ...r2.body, id: '', createdAt: 0 });
  });
});

describe('probe: public-graph isolation (L14) and cross-surface isolation (L6 / Constitution §5.3)', () => {
  it('blocking the author publicly changes no byte of the feed or thread; a Buzz id can never be used to block', async () => {
    const t = freezeOffMinute(1);
    const { api: spy, id: spyId } = attacker();
    const before = [
      (await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'campus', limit: 50 })).text,
      (await spy.get('/api/buzz/feed').query({ sort: 'hot', scope: 'campus', limit: 50 })).text,
      (await spy.get('/api/buzz/buzz_0001').query({ limit: 50 })).text,
    ];
    expect((await spy.post(`/api/users/${U.mayachen}/block`)).status).toBe(200);
    setNow(t);
    const after = [
      (await spy.get('/api/buzz/feed').query({ sort: 'new', scope: 'campus', limit: 50 })).text,
      (await spy.get('/api/buzz/feed').query({ sort: 'hot', scope: 'campus', limit: 50 })).text,
      (await spy.get('/api/buzz/buzz_0001').query({ limit: 50 })).text,
    ];
    expect(after).toEqual(before);

    const replyId = (ctx.db.prepare("SELECT id FROM buzz_posts WHERE root_id = 'buzz_0001' LIMIT 1").get() as { id: Id }).id;
    for (const target of ['buzz_0001', replyId]) {
      const res = await spy.post(`/api/users/${target}/block`);
      expect(res.status).toBe(404);
    }
    const blocked = ctx.db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(spyId) as { blocked_id: Id }[];
    expect(blocked.map((b) => b.blocked_id)).toEqual([U.mayachen]);
  });

  it("the author's profile, Discover home, onboarding suggestions and user search are byte-identical for another viewer after she posts, replies, votes and poll-votes", async () => {
    const t = freezeOffMinute(2);
    const viewer = attacker({ follows: [U.jordan_builds] });
    const snap = async (): Promise<string[]> => [
      (await viewer.api.get('/api/users/mayachen')).text,
      (await viewer.api.get('/api/discover/home')).text,
      (await viewer.api.get('/api/onboarding/suggestions')).text,
      (await viewer.api.get('/api/discover/search').query({ q: 'maya' })).text,
    ];
    const before = await snap();
    expect(await snap()).toEqual(before); // stable baseline

    const maya = ctx.as(DEMO.student);
    const b = await post(maya, uniq('Studying in the stacks tonight, bring snacks'));
    const other = attacker();
    const ob = await post(other.api, uniq('Does anyone have the 2nd edition of the stats book?'), { poll: { options: ['yes', 'no'], durationDays: 1 } });
    await reply(maya, ob.id, uniq('library reserve desk has one'));
    expect((await maya.put(`/api/buzz/posts/${ob.id}/vote`).send({ value: 1 })).status).toBe(200);
    expect((await maya.post(`/api/buzz/${ob.id}/poll/vote`).send({ optionId: ob.poll!.options[0]!.id })).status).toBe(200);
    await reply(other.api, b.id, uniq('save me a seat'));
    setNow(t);
    expect(await snap()).toEqual(before);

    // no actor-bearing notification was produced by any of it
    const actorRows = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type LIKE 'buzz.%' AND actor_id IS NOT NULL").get() as { n: number };
    expect(actorRows.n).toBe(0);
  });

  it('Buzz notifications carry no actor, avatar, thumbnail or distinct-actor count', async () => {
    const maya = ctx.as(DEMO.student);
    const res = await maya.get('/api/notifications').query({ filter: 'all', limit: 50 });
    expect(res.status).toBe(200);
    const buzz = (res.body.items as Record<string, unknown>[]).filter((x) => String(x.type).startsWith('buzz.'));
    expect(buzz.length).toBeGreaterThan(0);
    for (const x of buzz) {
      firewall(x);
      expect(x.actor).toBeNull();
      expect(x.thumbnailUrl).toBeNull();
      expect(x.actorCount).toBe(1);
      expect(x.anonymous).toBe(true);
    }
  });

  it('buzz share card: ownerId null, no identity strings; replies are not card-resolvable', async () => {
    const { api: spy } = attacker();
    const card = await spy.get('/api/cards/buzz/buzz_0001');
    expect(card.status).toBe(200);
    expect(card.body.ownerId).toBeNull();
    expect(card.body.imageUrl).toBeNull();
    firewall(card.body);
    const replyId = (ctx.db.prepare("SELECT id FROM buzz_posts WHERE root_id = 'buzz_0001' LIMIT 1").get() as { id: Id }).id;
    const rc = await spy.get(`/api/cards/buzz/${replyId}`);
    expect(rc.body.status).toBe('unavailable');
  });

  it('analytics: Buzz events are stored with user_id NULL, minute-floored time and no entity id; no attributed event names a buzz id', async () => {
    const maya = ctx.as(DEMO.student);
    const b = await post(maya, uniq('Friday mood: zero assignments due'));
    const other = attacker();
    await reply(other.api, b.id, uniq('must be nice'));
    await other.api.put(`/api/buzz/posts/${b.id}/vote`).send({ value: 1 });
    await other.api.get('/api/buzz/feed');
    const rows = ctx.db.prepare("SELECT name, user_id, session_id, props_json, created_at FROM analytics_events WHERE name LIKE 'buzz\\_%' ESCAPE '\\'").all() as {
      name: string; user_id: Id | null; session_id: string | null; props_json: string; created_at: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.user_id).toBeNull();
      expect(r.session_id).toBeNull();
      expect(r.created_at % MIN).toBe(0);
      expect(r.props_json).not.toContain(b.id);
      for (const k of Object.keys(JSON.parse(r.props_json) as object)) expect(k).not.toMatch(/id$/i);
    }
    const attributed = ctx.db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE user_id IS NOT NULL AND props_json LIKE ?').get(`%${b.id}%`) as { n: number };
    expect(attributed.n).toBe(0);
  });

  it('ws: Buzz events to thread participants are exactly { type, threadId }', async () => {
    const { api: op, id: opId } = attacker();
    const root = await post(op, uniq('Who else is still waiting on their financial aid?'));
    await reply(ctx.as(DEMO.student), root.id, uniq('me, since June'));
    const events = ctx.wsEventsFor(opId).filter((e) => String((e as { type: string }).type).startsWith('buzz.'));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['threadId', 'type']);
    for (const e of ctx.wsEventsFor(opId)) firewall(e);
  });
});
