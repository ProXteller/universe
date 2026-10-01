/**
 * `buzz` slice tests (SPEC §5.3, safety §8.2 #1–#4, Constitution §5.6). Isolation mode: `createTestApp({ slices: ['buzz'] })`.
 */
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@shared/core';
import { GUIDELINES_VERSION } from '@shared/core';
import type { Buzz, BuzzReply, BuzzThread, BuzzVoteState, MyBuzzItem } from '@shared/buzz';
import { config } from '../src/config';
import { DAY, HOUR, MIN, now, setNow } from '../src/lib/clock';
import { getContentAdapter, resolveCard } from '../src/lib/content';
import { applySanction } from '../src/lib/moderation/staff';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../src/lib/testing';
import type { AuthedUser } from '../src/lib/users';
import { ALIAS_COLORS, ALIAS_NOUNS, aliasBook, aliasFor, aliasKey } from '../src/services/buzz/alias';

let ctx: TestCtx;
let identities: string[];

/** Reader with no ownership over anything created by the test at hand (assertions of "what others see"). */
function reader(o: Parameters<TestCtx['createUser']>[0] = {}): { user: AuthedUser; api: ReturnType<TestCtx['as']> } {
  const user = ctx.createUser(o);
  return { user, api: ctx.as(user.id) };
}

function firewall(body: unknown): void {
  assertNoForbiddenKeys(body);
  assertNoIdentityLeak(body, identities);
}

async function post(api: ReturnType<TestCtx['as']>, text: string, extra: Record<string, unknown> = {}): Promise<Buzz> {
  const res = await api.post('/api/buzz').send({ text, ...extra });
  if (res.status !== 201) throw new Error(`POST /buzz → ${res.status} ${JSON.stringify(res.body)}`);
  firewall(res.body);
  return res.body as Buzz;
}

async function reply(api: ReturnType<TestCtx['as']>, threadId: Id, text: string, parentId?: Id): Promise<BuzzReply> {
  const res = await api.post(`/api/buzz/${threadId}/replies`).send({ text, ...(parentId ? { parentId } : {}) });
  if (res.status !== 201) throw new Error(`POST reply → ${res.status} ${JSON.stringify(res.body)}`);
  firewall(res.body);
  return res.body as BuzzReply;
}

async function vote(api: ReturnType<TestCtx['as']>, postId: Id, value: -1 | 0 | 1): Promise<BuzzVoteState> {
  const res = await api.put(`/api/buzz/posts/${postId}/vote`).send({ value });
  if (res.status !== 200) throw new Error(`vote → ${res.status} ${JSON.stringify(res.body)}`);
  firewall(res.body);
  return res.body as BuzzVoteState;
}

/** n distinct eligible voters (30-day-old accounts) all voting `value`. */
async function voters(postId: Id, n: number, value: -1 | 1): Promise<void> {
  for (let i = 0; i < n; i++) await vote(reader().api, postId, value);
}

const uniq = (() => {
  let n = 0;
  return (s: string): string => `${s} (${++n}-${Math.random().toString(36).slice(2, 6)})`;
})();

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['buzz'] });
  identities = ctx.seededIdentityStrings();
});

afterEach(() => {
  setNow(null);
  delete process.env.RATE_LIMITS;
});

/* ───────────────────────────── gate ───────────────────────────── */

describe('gate', () => {
  it('403 buzz_gate_required on every route before acceptance; POST /me/guidelines {kind:buzz} opens it', async () => {
    const { api } = reader({ buzzGate: false });
    for (const [method, path] of [['get', '/api/buzz/feed'], ['get', '/api/buzz/meta'], ['get', '/api/buzz/mine'], ['get', '/api/buzz/karma'], ['get', '/api/buzz/buzz_0001'], ['post', '/api/buzz']] as const) {
      const res = method === 'get' ? await api.get(path) : await api.post(path).send({ text: 'hi' });
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('buzz_gate_required');
    }
    const accept = await api.post('/api/me/guidelines').send({ kind: 'buzz', version: GUIDELINES_VERSION });
    expect(accept.status).toBe(200);
    expect(accept.body.buzzGateAcceptedVersion).toBe(GUIDELINES_VERSION);
    const feed = await api.get('/api/buzz/feed');
    expect(feed.status).toBe(200);
    expect(feed.headers['cache-control']).toBe('no-store');
    expect(feed.headers.vary).toMatch(/cookie/i);
  });

  it('401 for anonymous callers', async () => {
    expect((await ctx.anon().get('/api/buzz/feed')).status).toBe(401);
    expect((await ctx.anon().post('/api/buzz').send({ text: 'x' })).status).toBe(401);
  });
});

/* ───────────────────────────── firewall (safety §8.2 #1–#4) ───────────────────────────── */

describe('firewall', () => {
  it('no forbidden key and no seeded identity string in ANY endpoint response (all sort × scope, thread, replies, mine, karma, votes, polls, notifications, ws)', async () => {
    const author = ctx.as('mayachen');
    const { api: other, user: otherUser } = reader();
    const root = await post(author, uniq('Registration site crashed again, tradition'), { poll: { options: ['Yes', 'No', 'Maybe'], durationDays: 3 } });
    const r1 = await reply(other, root.id, uniq('same, every semester'));
    const r2 = await reply(author, root.id, uniq('thanks for the solidarity'), r1.id);
    const r3 = await reply(other, root.id, uniq('deep reply'), r2.id);
    expect(r3.depth).toBe(2);
    await vote(other, root.id, 1);
    await vote(author, r1.id, 1);
    const pollVote = await other.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: root.poll!.options[0]!.id });
    expect(pollVote.status).toBe(200);
    firewall(pollVote.body);

    for (const sort of ['hot', 'new', 'top']) {
      for (const scope of ['campus', 'global']) {
        for (const window of sort === 'top' ? ['day', 'week', 'all'] : ['day']) {
          const res = await other.get('/api/buzz/feed').query({ sort, scope, window, limit: 50 });
          expect(res.status, `${sort}/${scope}/${window}`).toBe(200);
          firewall(res.body);
          // campus and global are separate feeds: a campus buzz is in campus only
          expect(res.body.items.some((b: Buzz) => b.id === root.id), `${sort}/${scope}`).toBe(scope === 'campus');
          expect(res.body.items.every((b: Buzz) => b.createdAt % MIN === 0)).toBe(true);
        }
      }
    }
    for (const path of ['/api/buzz/meta', `/api/buzz/${root.id}`, `/api/buzz/${root.id}/replies`, '/api/buzz/mine?kind=threads', '/api/buzz/mine?kind=replies', '/api/buzz/karma']) {
      for (const who of [author, other]) {
        const res = await who.get(path);
        expect(res.status, path).toBe(200);
        firewall(res.body);
      }
    }
    const thread = (await other.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(thread.root.createdAt % MIN).toBe(0);
    for (const r of thread.replies.items) expect(r.createdAt % MIN).toBe(0);

    // notifications of Buzz kinds: no actor, no identity
    const notes = await author.get('/api/notifications').query({ filter: 'replies' });
    expect(notes.status).toBe(200);
    firewall(notes.body);
    const buzzNotes = notes.body.items.filter((n: { type: string }) => n.type.startsWith('buzz.'));
    expect(buzzNotes.length).toBeGreaterThan(0);
    for (const n of buzzNotes) {
      expect(n.anonymous).toBe(true);
      expect(n.actor).toBeNull();
      expect(n.thumbnailUrl).toBeNull();
    }
    const rows = ctx.db.prepare("SELECT actor_id FROM notifications WHERE type LIKE 'buzz.%'").all() as { actor_id: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_id === null)).toBe(true);

    // ws payloads: ids only
    const ws = [...ctx.wsEventsFor('u_mayachen'), ...ctx.wsEventsFor(otherUser.id)].filter((e) => e.type === 'buzz.thread_updated');
    expect(ws.length).toBeGreaterThan(0);
    for (const e of ws) {
      expect(Object.keys(e).sort()).toEqual(['threadId', 'type']);
      firewall(e);
    }
    // every ws event (incl. notification pushes) is clean of identity
    for (const e of ctx.wsEventsFor('u_mayachen')) firewall(e);
  });

  it('alias: stable within a thread, unlinkable across threads, absent from the DB, collision suffix deterministic', async () => {
    const author = ctx.as('mayachen');
    const other = reader().api;
    const t1 = await post(author, uniq('thread one'));
    const t2 = await post(author, uniq('thread two'));
    const a1 = await reply(other, t1.id, uniq('r1'));
    const a2 = await reply(other, t1.id, uniq('r2'));
    const b1 = await reply(other, t2.id, uniq('r3'));
    expect(a1.alias).toEqual(a2.alias);
    expect(a1.isOp).toBe(false);
    const view = (await other.get(`/api/buzz/${t1.id}`)).body as BuzzThread;
    expect(view.replies.items.map((r) => r.alias)).toEqual([a1.alias, a1.alias]);
    expect(view.replies.items.every((r) => r.isMine)).toBe(true);
    expect(view.root.isMine).toBe(false);
    expect(view.root.isOp).toBe(true);
    // different thread → different digest (the 4-byte alias key may coincide by chance in 1/768; the digest never)
    const digest = (threadId: string, userId: string): string =>
      crypto.createHmac('sha256', config.buzzAliasSecret).update(`${threadId}:${userId}`, 'utf8').digest('hex');
    expect(digest(t1.id, 'u_mayachen')).not.toBe(digest(t2.id, 'u_mayachen'));
    const k1 = aliasKey(t1.id, 'u_mayachen');
    expect(t1.alias).toEqual({ emoji: ALIAS_NOUNS[k1.nounIndex]!.emoji, label: `Anon ${ALIAS_NOUNS[k1.nounIndex]!.noun}`, color: ALIAS_COLORS[k1.colorIndex] });
    expect(b1.threadId).toBe(t2.id);
    // the alias is never stored
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    for (const table of tables) {
      const cols = (ctx.db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[]).filter((c) => /TEXT|CHAR|CLOB|^$/i.test(c.type));
      for (const col of cols) {
        const hit = ctx.db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${col.name}" LIKE ?`).get(`%${t1.alias.label}%`) as { n: number };
        expect(hit.n, `${table}.${col.name}`).toBe(0);
      }
    }
    expect(ALIAS_NOUNS).toHaveLength(64);
    expect(ALIAS_COLORS).toHaveLength(12);
    expect(ALIAS_NOUNS[0]).toEqual({ emoji: '☄️', noun: 'Comet' });

    // collision suffix: find two ids that share (noun, colour) in one thread → 2nd by first-post time gets " 2"
    const base = aliasKey('thread_x', 'user_a');
    let twin: string | null = null;
    for (let i = 0; i < 20_000 && !twin; i++) {
      const cand = `cand_${i}`;
      const k = aliasKey('thread_x', cand);
      if (k.nounIndex === base.nounIndex && k.colorIndex === base.colorIndex) twin = cand;
    }
    expect(twin).not.toBeNull();
    const book = aliasBook('thread_x', [{ userId: twin!, firstAt: 200, firstId: 'p2' }, { userId: 'user_a', firstAt: 100, firstId: 'p1' }]);
    expect(book.get('user_a')!.label).toBe(aliasFor('thread_x', 'user_a').label);
    expect(book.get(twin!)!.label).toBe(`${aliasFor('thread_x', 'user_a').label} 2`);
    const again = aliasBook('thread_x', [{ userId: 'user_a', firstAt: 100, firstId: 'p1' }, { userId: twin!, firstAt: 200, firstId: 'p2' }]);
    expect(again.get('user_a')).toEqual(book.get('user_a'));
    expect(again.get(twin!)).toEqual(book.get(twin!));
    // ties on created_at break by post id
    const tie = aliasBook('thread_x', [{ userId: twin!, firstAt: 100, firstId: 'p0' }, { userId: 'user_a', firstAt: 100, firstId: 'p1' }]);
    expect(tie.get(twin!)!.label).toBe(aliasFor('thread_x', 'user_a').label);
    expect(tie.get('user_a')!.label).toBe(`${aliasFor('thread_x', 'user_a').label} 2`);
  });

  it('block oracle: blocking a seeded user changes no byte of any feed / thread response for the blocker', async () => {
    const author = ctx.as('bencarter');
    const viewerUser = ctx.createUser();
    const viewer = ctx.as(viewerUser.id);
    const root = await post(author, uniq('block oracle thread'), { scope: 'global' });
    await reply(author, root.id, uniq('author reply'));
    const snap = async (): Promise<string[]> => {
      const out: string[] = [];
      for (const sort of ['hot', 'new', 'top']) out.push(JSON.stringify((await viewer.get('/api/buzz/feed').query({ sort, scope: 'global', window: 'all', limit: 50 })).body));
      out.push(JSON.stringify((await viewer.get(`/api/buzz/${root.id}`)).body));
      out.push(JSON.stringify((await viewer.get(`/api/buzz/${root.id}/replies`)).body));
      return out;
    };
    const before = await snap();
    const block = await viewer.post('/api/users/u_bencarter/block');
    expect(block.status).toBe(200);
    expect(await snap()).toEqual(before);
    // …and a suspended / banned author's buzz stays visible too (no sqlAuthorVisible on Buzz)
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u_bencarter'").run();
    expect(await snap()).toEqual(before);
  });

  it('404 parity: deleting a foreign item is byte-identical to a missing id; hide-author never names the author', async () => {
    const author = ctx.as('mayachen');
    const stranger = reader().api;
    const root = await post(author, uniq('parity'));
    const foreign = await stranger.delete(`/api/buzz/posts/${root.id}`);
    const missing = await stranger.delete('/api/buzz/posts/does_not_exist_0');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(ctx.db.prepare('SELECT status FROM buzz_posts WHERE id = ?').get(root.id)).toEqual({ status: 'active' });
    const hide = await stranger.post(`/api/buzz/posts/${root.id}/hide-author`);
    expect(hide.status).toBe(204);
    expect(hide.body).toEqual({});
  });

  it('public-signal isolation: posting, replying and voting leaves public_activity, post_count, reel_count, last_public_post_at and actor notifications untouched', async () => {
    const x = ctx.createUser();
    const api = ctx.as(x.id);
    const before = {
      activity: (ctx.db.prepare('SELECT COUNT(*) AS n FROM public_activity').get() as { n: number }).n,
      user: ctx.db.prepare('SELECT post_count, reel_count, last_public_post_at FROM users WHERE id = ?').get(x.id),
      actorNotes: (ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE actor_id IS NOT NULL').get() as { n: number }).n,
    };
    const root = await post(api, uniq('isolation'));
    const other = await post(ctx.as('mayachen'), uniq('maya root'));
    await reply(api, other.id, uniq('x replies'));
    await vote(api, other.id, 1);
    await api.post(`/api/buzz/${other.id}/hide`);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM public_activity').get() as { n: number }).n).toBe(before.activity);
    expect(ctx.db.prepare('SELECT post_count, reel_count, last_public_post_at FROM users WHERE id = ?').get(x.id)).toEqual(before.user);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE actor_id IS NOT NULL').get() as { n: number }).n).toBe(before.actorNotes);
    expect(root.isMine).toBe(true);
    // analytics rows for Buzz carry no user id
    const ev = ctx.db.prepare("SELECT user_id, props_json FROM analytics_events WHERE name IN ('buzz_post','buzz_reply','buzz_vote')").all() as { user_id: string | null; props_json: string }[];
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e.user_id === null && !/Id"/.test(e.props_json))).toBe(true);
  });

  it('author-notice hygiene: no matches / ruleId / signals / engine in any body', async () => {
    const api = ctx.as('mayachen');
    const res = await api.post('/api/buzz').send({ text: 'anyone got the answer key for the midterm' });
    expect(res.status).toBe(201);
    expect(res.body.moderation.status).toBe('held');
    expect(JSON.stringify(res.body)).not.toMatch(/"(matches|ruleId|signals|engine)"/);
    const blocked = await api.post('/api/buzz').send({ text: 'kys loser' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).not.toMatch(/"(matches|ruleId|signals|engine)"/);
  });
});

/* ───────────────────────────── writes ───────────────────────────── */

describe('create / moderation', () => {
  it('validation 400: empty text, over-long text, poll with one option, bad prompt id, bad cursor', async () => {
    const api = ctx.as('mayachen');
    expect((await api.post('/api/buzz').send({ text: '   ' })).status).toBe(400);
    expect((await api.post('/api/buzz').send({ text: 'x'.repeat(501) })).status).toBe(400);
    expect((await api.post('/api/buzz').send({ text: 'poll?', poll: { options: ['one'], durationDays: 1 } })).status).toBe(400);
    expect((await api.post('/api/buzz').send({ text: 'poll?', poll: { options: ['a', 'b'], durationDays: 2 } })).status).toBe(400);
    expect((await api.post('/api/buzz').send({ text: 'prompt', promptId: 'nope' })).status).toBe(400);
    const cursor = await api.get('/api/buzz/feed').query({ cursor: 'abc.def' });
    expect(cursor.status).toBe(400);
    expect(cursor.body.error.code).toBe('invalid_cursor');
    expect((await api.put('/api/buzz/posts/x/vote').send({ value: 2 })).status).toBe(400);
  });

  it('moderation: block → 422 content_blocked and nothing persisted; held → author sees it (chip), others do not', async () => {
    const api = ctx.as('mayachen');
    const before = (ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_posts').get() as { n: number }).n;
    const blocked = await api.post('/api/buzz').send({ text: 'kys loser' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('content_blocked');
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_posts').get() as { n: number }).n).toBe(before);

    const held = await api.post('/api/buzz').send({ text: 'anyone got the answer key for the midterm' });
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('held');
    expect(held.body.moderation).toMatchObject({ status: 'held', userMessage: { id: 'M-HELD' } });
    const mine = await api.get('/api/buzz/feed').query({ sort: 'new' });
    expect(mine.body.items.find((b: Buzz) => b.id === held.body.id)).toMatchObject({ status: 'held', text: 'anyone got the answer key for the midterm' });
    const other = reader().api;
    expect((await other.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === held.body.id)).toBe(false);
    const q = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(held.body.id) as { source: string } | undefined;
    expect(q?.source).toBe('rule_flag');
  });

  it('held root: thread / replies / hide / reply / poll vote are the generic 404 for other viewers (byte-identical to a missing id); the author still reads it', async () => {
    const api = ctx.as('mayachen');
    const other = reader().api;
    const held = await api.post('/api/buzz').send({ text: 'anyone got the answer key for the midterm', poll: { options: ['yes', 'no'], durationDays: 1 } });
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('held');
    const id = held.body.id as Id;
    const missing = 'nope_missing_idx';
    for (const path of ['', '/replies']) {
      const a = await other.get(`/api/buzz/${id}${path}`);
      const b = await other.get(`/api/buzz/${missing}${path}`);
      expect(a.status, path).toBe(404);
      expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    }
    for (const [path, body] of [['/hide', {}], ['/replies', { text: 'hi' }], ['/poll/vote', { optionId: held.body.poll.options[0].id }]] as const) {
      const a = await other.post(`/api/buzz/${id}${path}`).send(body);
      const b = await other.post(`/api/buzz/${missing}${path}`).send(body);
      expect(a.status, path).toBe(404);
      expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    }
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_hidden_threads WHERE thread_id = ?').get(id)).toEqual({ n: 0 });
    const mine = await api.get(`/api/buzz/${id}`);
    expect(mine.status).toBe(200);
    firewall(mine.body);
    expect(mine.body.root).toMatchObject({ id, status: 'held', isMine: true, text: 'anyone got the answer key for the midterm' });
    expect((await api.get(`/api/buzz/${id}/replies`)).status).toBe(200);
  });

  it('held poll option: the persisted status and the author notice agree (moderation.status = held, M-HELD copy)', async () => {
    const api = ctx.as('mayachen');
    const res = await api.post('/api/buzz').send({ text: uniq('which one is actually worth it'), poll: { options: ['the frat test bank', 'office hours'], durationDays: 1 } });
    expect(res.status).toBe(201);
    firewall(res.body);
    expect(res.body.status).toBe('held');
    expect(res.body.moderation).toMatchObject({ status: 'held', userMessage: { id: 'M-HELD' } });
    expect((ctx.db.prepare('SELECT status FROM buzz_posts WHERE id = ?').get(res.body.id) as { status: string }).status).toBe('held');
    expect((await reader().api.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === res.body.id)).toBe(false);
  });

  it('self-harm text → allowed + support resources + P0 wellbeing queue row + supportLink on the item', async () => {
    const api = ctx.as('mayachen');
    const res = await api.post('/api/buzz').send({ text: 'i want to die' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.supportLink).toBe(true);
    expect(res.body.moderation.support).not.toBeNull();
    expect(res.body.moderation.support.kind).toBe('self_harm');
    const q = ctx.db.prepare("SELECT priority, label, category FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(res.body.id);
    expect(q).toEqual({ priority: 'p0', label: 'wellbeing', category: 'self_harm' });
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM strikes').get() as { n: number }).n).toBe(0);
  });

  it('muted user → 403 muted on create and reply; reads and votes still 200', async () => {
    const { user } = reader();
    const admin = ctx.as('dana_w');
    void admin;
    applySanction({ userId: user.id, kind: 'mute', durationMs: 24 * HOUR, scope: 'buzz_only', category: 'harassment_bullying', actor: 'system', delayed: false });
    const api = ctx.as(user.id);
    const root = await post(ctx.as('mayachen'), uniq('for the muted'));
    expect((await api.post('/api/buzz').send({ text: 'hello' })).body.error.code).toBe('muted');
    expect((await api.post(`/api/buzz/${root.id}/replies`).send({ text: 'hello' })).body.error.code).toBe('muted');
    expect((await api.get('/api/buzz/feed')).status).toBe(200);
    expect((await api.get(`/api/buzz/${root.id}`)).status).toBe(200);
    expect((await api.put(`/api/buzz/posts/${root.id}/vote`).send({ value: 1 })).status).toBe(200);
  });

  it('polls: < 24 h accounts cannot create; results hidden until vote or close; one vote, no change; closed → 409', async () => {
    const fresh = reader({ createdAt: now() - 2 * HOUR }).api;
    const denied = await fresh.post('/api/buzz').send({ text: 'poll?', poll: { options: ['a', 'b'], durationDays: 1 } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.reason).toBe('account_too_new');

    const author = ctx.as('mayachen');
    const root = await post(author, uniq('Best study spot?'), { poll: { options: ['PCL', 'Union', 'Bed'], durationDays: 1 } });
    expect(root.poll).toMatchObject({ closed: false, myChoice: null, resultsVisible: true, totalVotes: 0 }); // the owner sees results
    const viewer = reader().api;
    const seen = (await viewer.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(seen.root.poll).toMatchObject({ resultsVisible: false, totalVotes: null, myChoice: null });
    expect(seen.root.poll!.options.every((o) => o.votes === null && o.pct === null)).toBe(true);
    expect((await author.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: root.poll!.options[0]!.id })).status).toBe(400);

    const opt = root.poll!.options[1]!.id;
    const voted = await viewer.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: opt });
    expect(voted.status).toBe(200);
    firewall(voted.body);
    expect(voted.body).toMatchObject({ resultsVisible: true, totalVotes: 1, myChoice: opt });
    expect(voted.body.options[1]).toMatchObject({ votes: 1, pct: 100 });
    expect((await viewer.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: opt })).status).toBe(200);
    expect((await viewer.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: root.poll!.options[0]!.id })).status).toBe(409);
    expect((await viewer.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: 'nope' })).status).toBe(400);
    expect((ctx.db.prepare('SELECT vote_count FROM buzz_poll_options WHERE id = ?').get(opt) as { vote_count: number }).vote_count).toBe(1);

    setNow(now() + 2 * DAY);
    const late = reader().api;
    expect((await late.post(`/api/buzz/${root.id}/poll/vote`).send({ optionId: opt })).status).toBe(409);
    const closed = (await late.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(closed.root.poll).toMatchObject({ closed: true, resultsVisible: true, totalVotes: 1 });
    // lazy hook: the author's badges run the poll_closed generator exactly once
    expect((await author.get('/api/me/badges')).status).toBe(200);
    expect((await author.get('/api/me/badges')).status).toBe(200);
    const notes = ctx.db.prepare("SELECT data_json, actor_id FROM notifications WHERE user_id = 'u_mayachen' AND type = 'buzz.poll_closed'").all() as { data_json: string; actor_id: null }[];
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0]!.data_json)).toEqual({ votes: 1 });
    expect(notes[0]!.actor_id).toBeNull();
  });

  it('prompt: /meta returns the Daily Campus Prompt; posting with promptId stores it; small-campus note on tiny campuses', async () => {
    ctx.db.prepare("INSERT INTO buzz_prompts (id, idx, text) VALUES ('bzp_t1', 0, 'What is the most underrated spot on campus?')").run();
    const api = ctx.as('mayachen');
    const meta = await api.get('/api/buzz/meta');
    expect(meta.status).toBe(200);
    expect(meta.body).toEqual({ prompt: { id: 'bzp_t1', text: 'What is the most underrated spot on campus?' }, smallCampusNote: false });
    const answered = await post(api, uniq('the turtle pond'), { promptId: 'bzp_t1' });
    expect(answered.promptId).toBe('bzp_t1');
    const tiny = reader({ universityId: 'uni_ethz' }).api;
    expect((await tiny.get('/api/buzz/meta')).body.smallCampusNote).toBe(true);
    expect((await tiny.get('/api/buzz/meta').query({ scope: 'global' })).body.smallCampusNote).toBe(false);
    // cold start: an empty campus feed is simply empty (the client switches to Global)
    const feed = await tiny.get('/api/buzz/feed');
    expect(feed.body).toEqual({ items: [], nextCursor: null });
  });

  it('rate limit with RATE_LIMITS=on: the 7th buzz in an hour is 429 rate_limited', async () => {
    process.env.RATE_LIMITS = 'on';
    const api = ctx.as('mayachen');
    for (let i = 0; i < 6; i++) expect((await api.post('/api/buzz').send({ text: uniq(`rate ${i}`) })).status).toBe(201);
    const seventh = await api.post('/api/buzz').send({ text: uniq('rate 7') });
    expect(seventh.status).toBe(429);
    expect(seventh.body.error.code).toBe('rate_limited');
    expect(seventh.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── votes / collapse / auto-hide / milestones ───────────────────────────── */

describe('votes', () => {
  it('self-vote 400; optimistic undo; collapse at ≤ −5 with ≥ 8 eligible; auto-hide at ≤ −10 with ≥ 12 → hidden + community_score P2', async () => {
    const author = ctx.as('mayachen');
    const root = await post(author, uniq('votes'));
    expect((await author.put(`/api/buzz/posts/${root.id}/vote`).send({ value: 1 })).status).toBe(400);
    const v = reader().api;
    expect(await vote(v, root.id, 1)).toEqual({ score: 1, myVote: 1, collapsed: false });
    expect(await vote(v, root.id, -1)).toEqual({ score: -1, myVote: -1, collapsed: false });
    expect(await vote(v, root.id, 0)).toEqual({ score: 0, myVote: 0, collapsed: false });
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_votes WHERE post_id = ?').get(root.id) as { n: number }).n).toBe(0);

    // new accounts' votes count in the score but not toward the thresholds
    for (let i = 0; i < 8; i++) await vote(reader({ createdAt: now() - HOUR }).api, root.id, -1);
    let feedNew = (await v.get('/api/buzz/feed').query({ sort: 'new' })).body.items.find((b: Buzz) => b.id === root.id) as Buzz;
    expect(feedNew).toMatchObject({ score: -8, collapsed: false });

    await voters(root.id, 8, -1);
    const state = await v.get(`/api/buzz/${root.id}`);
    expect(state.body.root).toMatchObject({ score: -16, collapsed: true, status: 'active' });
    // collapsed → out of hot / top, still in new
    expect((await v.get('/api/buzz/feed').query({ sort: 'hot' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(false);
    expect((await v.get('/api/buzz/feed').query({ sort: 'top', window: 'all' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(false);
    feedNew = (await v.get('/api/buzz/feed').query({ sort: 'new' })).body.items.find((b: Buzz) => b.id === root.id) as Buzz;
    expect(feedNew.collapsed).toBe(true);

    await voters(root.id, 4, -1);
    expect(ctx.db.prepare('SELECT status, eligible_votes, eligible_score FROM buzz_posts WHERE id = ?').get(root.id)).toEqual({ status: 'hidden', eligible_votes: 12, eligible_score: -12 });
    const q = ctx.db.prepare("SELECT source, priority FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(root.id);
    expect(q).toEqual({ source: 'community_score', priority: 'p2' });
    // hidden: gone from every list for others, placeholder in the thread, author sees text + status
    expect((await v.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(false);
    expect((await v.get(`/api/buzz/${root.id}`)).body.root).toMatchObject({ status: 'hidden', text: '' });
    const own = (await author.get('/api/buzz/feed').query({ sort: 'new' })).body.items.find((b: Buzz) => b.id === root.id) as Buzz;
    expect(own).toMatchObject({ status: 'hidden', text: root.text, isMine: true });
    expect((await v.put(`/api/buzz/posts/${root.id}/vote`).send({ value: 1 })).status).toBe(404);
  });

  it('milestones 10 / 25 → one buzz.milestone per milestone, no actor; the notification row respects the once-per-day rule', async () => {
    const author = ctx.as('mayachen');
    const root = await post(author, uniq('milestones'));
    await voters(root.id, 10, 1);
    let rows = ctx.db.prepare("SELECT data_json, actor_id, anonymous FROM notifications WHERE user_id = 'u_mayachen' AND type = 'buzz.milestone'").all() as { data_json: string; actor_id: null; anonymous: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: null, anonymous: 1 });
    expect(JSON.parse(rows[0]!.data_json)).toEqual({ upvotes: 10 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_milestones WHERE post_id = ?').get(root.id)).toEqual({ n: 1 });
    await voters(root.id, 15, 1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_milestones WHERE post_id = ?').get(root.id)).toEqual({ n: 2 });
    rows = ctx.db.prepare("SELECT data_json, actor_id, anonymous FROM notifications WHERE user_id = 'u_mayachen' AND type = 'buzz.milestone'").all() as typeof rows;
    expect(rows).toHaveLength(1); // same thread, same day → the row is updated, not duplicated
    expect(JSON.parse(rows[0]!.data_json)).toEqual({ upvotes: 25 });
    const list = await author.get('/api/notifications').query({ filter: 'replies' });
    const mine = list.body.items.filter((n: { type: string }) => n.type.startsWith('buzz.'));
    expect(mine.length).toBeGreaterThan(0);
    firewall(mine);
  });
});

/* ───────────────────────────── threads ───────────────────────────── */

describe('threads', () => {
  it('replies oldest first, two visual levels, depth > 2 flattened with replyingTo, OP badge, "You" items, reply notifications to parent + root author only', async () => {
    const op = ctx.as('mayachen');
    const a = reader();
    const b = reader();
    const root = await post(op, uniq('thread'));
    const r1 = await reply(a.api, root.id, uniq('a1'));
    const r2 = await reply(op, root.id, uniq('op answers'), r1.id);
    const r3 = await reply(b.api, root.id, uniq('b digs deeper'), r2.id);
    const r4 = await reply(a.api, root.id, uniq('a again'), r3.id);
    expect(r1).toMatchObject({ depth: 1, parentId: root.id, replyingTo: null, isOp: false });
    expect(r2).toMatchObject({ depth: 2, parentId: r1.id, replyingTo: null, isOp: true, isMine: true });
    expect(r3).toMatchObject({ depth: 2, parentId: r1.id });
    expect(r3.replyingTo).toEqual(r2.alias);
    expect(r4).toMatchObject({ depth: 2, parentId: r1.id });
    expect(r4.replyingTo).toEqual(r3.alias);
    expect(r4.alias).toEqual(r1.alias);

    const t = (await b.api.get(`/api/buzz/${root.id}`).query({ limit: 2 })).body as BuzzThread;
    expect(t.root.replyCount).toBe(4);
    expect(t.replies.items.map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(t.replies.nextCursor).not.toBeNull();
    const page2 = await b.api.get(`/api/buzz/${root.id}/replies`).query({ cursor: t.replies.nextCursor, limit: 2 });
    expect(page2.body.items.map((r: BuzzReply) => r.id)).toEqual([r3.id, r4.id]);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[0].isMine).toBe(true);

    // notifications: r1 → OP; r2 (OP replies to a) → a only (never self); r3 (b → op's reply) → OP; r4 (a → b) → b + OP
    const count = (userId: string): number => (ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'buzz.reply'").get(userId) as { n: number }).n;
    expect(count('u_mayachen')).toBe(1); // r1 + r3 + r4 collapse into one unread row for the same thread
    expect(count(a.user.id)).toBe(1);
    expect(count(b.user.id)).toBe(1);
    const mayaRow = ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = 'u_mayachen' AND type = 'buzz.reply'").get() as { data_json: string };
    expect(JSON.parse(mayaRow.data_json).snippet).toBe(root.text.slice(0, 80));

    // ws: participants only
    expect(ctx.wsEventsFor(a.user.id).filter((e) => e.type === 'buzz.thread_updated').length).toBeGreaterThan(0);
    expect(ctx.wsEventsFor(reader().user.id).filter((e) => e.type === 'buzz.thread_updated')).toHaveLength(0);
  });

  it('hide thread / unhide; hide this anon in this thread collapses their replies (and only in that thread)', async () => {
    const op = ctx.as('mayachen');
    const troll = reader().api;
    const viewer = reader().api;
    const t1 = await post(op, uniq('hide me'));
    const t2 = await post(op, uniq('other thread'));
    const x1 = await reply(troll, t1.id, uniq('noise 1'));
    await reply(troll, t2.id, uniq('noise in t2'));
    expect((await viewer.post(`/api/buzz/${t1.id}/hide`)).status).toBe(204);
    expect((await viewer.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === t1.id)).toBe(false);
    expect((await viewer.get(`/api/buzz/${t1.id}`)).status).toBe(200); // still reachable by link
    expect((await viewer.delete(`/api/buzz/${t1.id}/hide`)).status).toBe(204);
    expect((await viewer.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === t1.id)).toBe(true);

    expect((await viewer.post(`/api/buzz/posts/${x1.id}/hide-author`)).status).toBe(204);
    const v1 = (await viewer.get(`/api/buzz/${t1.id}`)).body as BuzzThread;
    expect(v1.replies.items.find((r) => r.id === x1.id)!.collapsed).toBe(true);
    const v2 = (await viewer.get(`/api/buzz/${t2.id}`)).body as BuzzThread;
    expect(v2.replies.items[0]!.collapsed).toBe(false); // keyed on thread + author: never cross-thread
    const other = (await reader().api.get(`/api/buzz/${t1.id}`)).body as BuzzThread;
    expect(other.replies.items.find((r) => r.id === x1.id)!.collapsed).toBe(false);
    const row = ctx.db.prepare('SELECT COUNT(*) AS n FROM buzz_hidden_authors').get();
    expect(row).toEqual({ n: 1 });
  });

  it('delete own: reply → placeholder only while it has children, reply_count drops; root → 404 for everyone; locked → 403', async () => {
    const op = ctx.as('mayachen');
    const a = reader().api;
    const root = await post(op, uniq('delete me'));
    const r1 = await reply(a, root.id, uniq('r1'));
    const r2 = await reply(op, root.id, uniq('r2'), r1.id);
    const r3 = await reply(a, root.id, uniq('r3'));
    expect((await a.delete(`/api/buzz/posts/${r1.id}`)).status).toBe(204);
    let t = (await a.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(t.root.replyCount).toBe(2);
    expect(t.replies.items.find((r) => r.id === r1.id)).toMatchObject({ status: 'deleted', text: '' });
    expect(t.replies.items.find((r) => r.id === r2.id)).toMatchObject({ parentId: r1.id, depth: 2 });
    expect((await a.delete(`/api/buzz/posts/${r3.id}`)).status).toBe(204);
    t = (await a.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(t.replies.items.some((r) => r.id === r3.id)).toBe(false);
    expect(t.root.replyCount).toBe(1);

    getContentAdapter('buzz')!.setLocked!(root.id, true);
    const locked = await a.post(`/api/buzz/${root.id}/replies`).send({ text: 'late' });
    expect(locked.status).toBe(403);
    expect(locked.body.error.details.reason).toBe('locked');
    expect((await a.get(`/api/buzz/${root.id}`)).body.root.locked).toBe(true);

    expect((await op.delete(`/api/buzz/posts/${root.id}`)).status).toBe(204);
    expect((await a.get(`/api/buzz/${root.id}`)).status).toBe(404);
    expect((await op.get(`/api/buzz/${root.id}`)).status).toBe(404);
    expect((await a.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(false);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_id = ?").get(root.id) as { n: number }).n).toBe(0);
  });

  it('my buzzes: threads and replies with snippets, only to the author; karma = sum of own scores', async () => {
    const me = ctx.as('mayachen');
    const other = reader().api;
    const t = await post(me, uniq('my thread'));
    const theirs = await post(other, uniq('their thread'));
    const r = await reply(me, theirs.id, uniq('my reply'));
    await vote(other, t.id, 1);
    await vote(other, r.id, 1);
    const threads = await me.get('/api/buzz/mine').query({ kind: 'threads' });
    expect(threads.status).toBe(200);
    firewall(threads.body);
    expect(threads.body.items.map((m: MyBuzzItem) => m.item.id)).toContain(t.id);
    expect(threads.body.items.every((m: MyBuzzItem) => m.item.isMine && m.item.kind === 'buzz')).toBe(true);
    const replies = await me.get('/api/buzz/mine').query({ kind: 'replies' });
    firewall(replies.body);
    expect(replies.body.items).toHaveLength(1);
    expect(replies.body.items[0]).toMatchObject({ item: { id: r.id, kind: 'reply', isMine: true }, threadSnippet: theirs.text });
    expect((await me.get('/api/buzz/karma')).body).toEqual({ karma: 2 });
    expect((await other.get('/api/buzz/mine').query({ kind: 'replies' })).body.items).toHaveLength(0);
  });

  it('my replies across several threads: one item per reply (same thread grouped), each with its own shape, alias and thread snippet', async () => {
    const me = ctx.as('mayachen');
    const other = reader().api;
    const t1 = await post(other, uniq('thread one'));
    const t2 = await post(other, uniq('thread two'));
    const a = await reply(me, t1.id, uniq('a on one'));
    const b = await reply(me, t1.id, uniq('b on one under a'), a.id);
    const c = await reply(me, t1.id, uniq('c on one under b'), b.id);
    const d = await reply(me, t2.id, uniq('d on two'));
    const res = await me.get('/api/buzz/mine').query({ kind: 'replies' });
    expect(res.status).toBe(200);
    firewall(res.body);
    const items = res.body.items as MyBuzzItem[];
    // newest first; same-millisecond rows tie-break on id, so compare the set
    expect([...items.map((m) => m.item.id)].sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    const byId = new Map(items.map((m) => [m.item.id, m]));
    expect(byId.get(a.id)).toMatchObject({ item: { kind: 'reply', depth: 1, parentId: t1.id, isMine: true }, threadSnippet: t1.text });
    expect(byId.get(b.id)).toMatchObject({ item: { depth: 2, parentId: a.id, replyingTo: null }, threadSnippet: t1.text });
    expect(byId.get(c.id)!.item).toMatchObject({ depth: 2, parentId: a.id }); // flattened under the depth-1 ancestor
    expect((byId.get(c.id)!.item as BuzzReply).replyingTo).toEqual(b.alias);
    expect(byId.get(d.id)).toMatchObject({ item: { depth: 1, parentId: t2.id }, threadSnippet: t2.text });
    expect(byId.get(a.id)!.item.alias).toEqual(b.alias); // same thread → same alias
    expect(byId.get(d.id)!.item.alias).not.toEqual(a.alias); // other thread → unlinkable
  });
});

/* ───────────────────────────── registry: adapters / cards ───────────────────────────── */

describe('registry', () => {
  it('content adapters load / setStatus / staffContext (blind) / card resolver', async () => {
    const op = ctx.as('mayachen');
    const other = reader().api;
    const root = await post(op, uniq('adapter root'), { poll: { options: ['x', 'y'], durationDays: 1 } });
    const r1 = await reply(other, root.id, uniq('adapter reply'));
    const buzz = getContentAdapter('buzz')!;
    const buzzReply = getContentAdapter('buzz_reply')!;
    expect(buzz.load(root.id)).toMatchObject({ entityType: 'buzz', anon: true, status: 'active', label: 'buzz', href: `/buzz/${root.id}`, parent: null, media: [] });
    expect(buzz.load(root.id)!.fields.map((f) => f.field)).toEqual(['body', 'option', 'option']);
    expect(buzz.load(r1.id)).toBeNull();
    expect(buzzReply.load(r1.id)).toMatchObject({ entityType: 'buzz_reply', label: 'reply', parent: { entityType: 'buzz', entityId: root.id } });

    const staff = buzzReply.staffContext!(r1.id) as { item: BuzzReply; root: Buzz; parents: unknown[]; siblings: unknown[] };
    firewall(staff);
    expect(staff.item.isMine).toBe(false);
    expect(staff.root.isMine).toBe(false);
    expect(staff.root.poll!.resultsVisible).toBe(false);
    firewall(buzz.staffContext!(root.id));

    const card = resolveCard({ kind: 'buzz', id: root.id }, 'u_bencarter');
    firewall(card);
    expect(card).toMatchObject({ kind: 'buzz', status: 'available', ownerId: null, imageUrl: null, subtitle: 'Buzz · UT Austin', href: `/buzz/${root.id}`, price: null });
    expect(card.title).toBe(root.text);
    const viaHttp = await other.get(`/api/cards/buzz/${root.id}`);
    expect(viaHttp.status).toBe(200);
    firewall(viaHttp.body);

    buzzReply.setStatus(r1.id, 'removed');
    expect((await other.get(`/api/buzz/${root.id}`)).body.root.replyCount).toBe(0);
    expect((await op.get(`/api/buzz/${root.id}`)).body.replies.items[0]).toMatchObject({ id: r1.id, status: 'removed', text: '' });
    buzz.setStatus(root.id, 'hidden');
    expect(resolveCard({ kind: 'buzz', id: root.id }, 'u_bencarter').status).toBe('unavailable');
    buzz.setStatus(root.id, 'active', { immune: true });
    expect(ctx.db.prepare('SELECT status, auto_hide_immune FROM buzz_posts WHERE id = ?').get(root.id)).toEqual({ status: 'active', auto_hide_immune: 1 });
    // an immune item is never auto-hidden by score
    await voters(root.id, 12, -1);
    expect((ctx.db.prepare('SELECT status FROM buzz_posts WHERE id = ?').get(root.id) as { status: string }).status).toBe('active');
  });

  it('staffContext (blind) keeps the text of held / hidden / removed rows and the tree around a held target; still no isMine / votes / identity', async () => {
    const op = ctx.as('mayachen');
    const { api: other } = reader();
    const root = await post(op, uniq('context root'));
    const r1 = await reply(other, root.id, uniq('sibling one'));
    const heldRes = await other.post(`/api/buzz/${root.id}/replies`).send({ text: 'anyone got the answer key for the midterm' });
    expect(heldRes.status).toBe(201);
    expect(heldRes.body.status).toBe('held');
    const r3 = await reply(op, root.id, uniq('sibling three'));
    const buzz = getContentAdapter('buzz')!;
    const buzzReply = getContentAdapter('buzz_reply')!;
    type Ctx = { item: BuzzReply; root: Buzz; parents: BuzzReply[]; siblings: BuzzReply[] };

    const held = buzzReply.staffContext!(heldRes.body.id) as Ctx;
    firewall(held);
    expect(held.item).toMatchObject({ id: heldRes.body.id, status: 'held', text: 'anyone got the answer key for the midterm', isMine: false, myVote: 0 });
    expect(held.siblings.map((s) => s.id)).toEqual([r1.id, r3.id]);
    expect(held.root).toMatchObject({ id: root.id, text: root.text, isMine: false, myVote: 0 });

    buzzReply.setStatus(r1.id, 'removed');
    buzz.setStatus(root.id, 'hidden');
    const removed = buzzReply.staffContext!(r1.id) as Ctx;
    firewall(removed);
    expect(removed.item).toMatchObject({ status: 'removed', text: r1.text });
    expect(removed.root).toMatchObject({ status: 'hidden', text: root.text });
    const hiddenRoot = buzz.staffContext!(root.id) as Ctx;
    firewall(hiddenRoot);
    expect(hiddenRoot.item).toMatchObject({ status: 'hidden', text: root.text, isMine: false });
    // the member-facing exits are untouched: the OP sees a placeholder for the removed reply, others never see the held one
    const opView = (await op.get(`/api/buzz/${root.id}`)).body as BuzzThread;
    expect(opView.replies.items.find((r) => r.id === r1.id)).toMatchObject({ status: 'removed', text: '' });
    expect(opView.replies.items.some((r) => r.id === heldRes.body.id)).toBe(false);
  });

  it('report → the foundation reports endpoint sees Buzz through the adapter; 3 eligible reporters auto-hide; the item leaves the reporter\'s feed', async () => {
    const op = ctx.as('mayachen');
    const root = await post(op, uniq('reportable'));
    const first = reader().api;
    const res = await first.post('/api/reports').send({ entityType: 'buzz', entityId: root.id, reason: 'harassment' });
    expect(res.status).toBe(200);
    firewall(res.body);
    expect((await first.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(false);
    expect((await reader().api.get('/api/buzz/feed').query({ sort: 'new' })).body.items.some((b: Buzz) => b.id === root.id)).toBe(true);
    for (let i = 0; i < 2; i++) expect((await reader().api.post('/api/reports').send({ entityType: 'buzz', entityId: root.id, reason: 'harassment' })).status).toBe(200);
    expect((ctx.db.prepare('SELECT status FROM buzz_posts WHERE id = ?').get(root.id) as { status: string }).status).toBe('hidden');
  });
});

/* ───────────────────────────── seed invariants (§7.5) ───────────────────────────── */

describe('seed', () => {
  it('lite seed: counts, Maya\'s demo state, fixtures, counters = rows, closed polls notified, and the firewall over seeded data', async () => {
    ctx = await createTestApp({ slices: ['buzz'], seed: 'all' });
    identities = ctx.seededIdentityStrings();
    const q = <T>(sql: string, ...p: unknown[]): T => ctx.db.prepare(sql).get(...p) as T;
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_prompts').n).toBe(60);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_posts WHERE root_id IS NULL').n).toBe(30);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_posts WHERE root_id IS NOT NULL').n).toBeGreaterThanOrEqual(100);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_votes').n).toBeGreaterThanOrEqual(300);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_polls').n).toBe(4);
    expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM buzz_posts WHERE status = 'hidden' AND eligible_score <= -10 AND eligible_votes >= 12").n).toBe(2);
    expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM buzz_posts WHERE status = 'active' AND eligible_score <= -5 AND eligible_votes >= 8").n).toBe(1);
    expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM buzz_posts WHERE author_id = 'u_mayachen' AND root_id IS NULL").n).toBe(3);
    expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM buzz_posts WHERE root_id = 'buzz_0001' AND status = 'active'").n).toBe(14);
    expect(q<{ reply_count: number }>("SELECT reply_count FROM buzz_posts WHERE id = 'buzz_0001'").reply_count).toBe(14);
    expect(q<{ k: number }>("SELECT SUM(score) AS k FROM buzz_posts WHERE author_id = 'u_mayachen'").k).toBeGreaterThan(0);
    expect(q<{ closes_at: number; closed_notified: number }>("SELECT closes_at, closed_notified FROM buzz_polls WHERE post_id = 'buzz_0002'")).toMatchObject({ closed_notified: 0 });
    expect(q<{ closes_at: number }>("SELECT closes_at FROM buzz_polls WHERE post_id = 'buzz_0002'").closes_at).toBeGreaterThan(now() + 2 * DAY);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM buzz_polls WHERE closes_at <= ? AND closed_notified = 0', now()).n).toBe(0);
    expect(q<{ status: string; author_id: string }>("SELECT status, author_id FROM buzz_posts WHERE id = 'buzz_0101'")).toMatchObject({ status: 'hidden' });
    expect(q<{ status: string }>("SELECT status FROM buzz_posts WHERE id = 'buzz_0102'").status).toBe('active');
    expect(q<{ author_id: string }>("SELECT author_id FROM buzz_posts WHERE id = 'buzz_0101'").author_id).toMatch(/^bg_/);
    expect(q<{ author_id: string }>("SELECT author_id FROM buzz_posts WHERE id = 'buzz_0102'").author_id).toMatch(/^bg_/);
    // counters = rows
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM buzz_posts p WHERE p.upvotes != (SELECT COUNT(*) FROM buzz_votes v WHERE v.post_id = p.id AND v.value = 1)
      OR p.downvotes != (SELECT COUNT(*) FROM buzz_votes v WHERE v.post_id = p.id AND v.value = -1) OR p.score != p.upvotes - p.downvotes`).n).toBe(0);
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM buzz_posts p WHERE p.root_id IS NULL AND p.reply_count != (SELECT COUNT(*) FROM buzz_posts r WHERE r.root_id = p.id AND r.status = 'active')`).n).toBe(0);
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM buzz_poll_options o WHERE o.vote_count != (SELECT COUNT(*) FROM buzz_poll_votes v WHERE v.option_id = o.id)`).n).toBe(0);
    expect(q<{ n: number }>('SELECT COUNT(*) AS n FROM public_activity').n).toBe(0);
    // Maya's two Buzz notifications (reply unread, milestone read), both anonymous
    const notes = ctx.db.prepare("SELECT type, read_at, actor_id, anonymous FROM notifications WHERE user_id = 'u_mayachen' AND type LIKE 'buzz.%' ORDER BY type").all() as { type: string; read_at: number | null; actor_id: null; anonymous: number }[];
    expect(notes.map((n) => [n.type, n.read_at === null, n.actor_id, n.anonymous])).toEqual([['buzz.milestone', false, null, 1], ['buzz.reply', true, null, 1]]);
    // a second badges read adds nothing (the poll hook is idle)
    const maya = ctx.as('mayachen');
    const b1 = (await maya.get('/api/me/badges')).body;
    const b2 = (await maya.get('/api/me/badges')).body;
    expect(b1).toEqual(b2);
    // firewall over seeded data, every sort × scope, plus Maya's thread and mine
    for (const sort of ['hot', 'new', 'top']) for (const scope of ['campus', 'global']) {
      const res = await maya.get('/api/buzz/feed').query({ sort, scope, window: 'all', limit: 50 });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      firewall(res.body);
      // global: the campus is named only when its population is ≥ 50 active users (safety L18 — hardening fix)
      if (scope === 'global') {
        for (const b of res.body.items as Buzz[]) {
          const uni = (ctx.db.prepare('SELECT university_id FROM buzz_posts WHERE id = ?').get(b.id) as { university_id: string }).university_id;
          const members = (ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(uni) as { n: number }).n;
          expect(b.campusShortName === null ? members < 50 : typeof b.campusShortName === 'string' && members >= 50).toBe(true);
        }
      }
      else expect(res.body.items.every((b: Buzz) => b.campusShortName === null)).toBe(true);
    }
    const thread = await maya.get('/api/buzz/buzz_0001');
    expect(thread.status).toBe(200);
    firewall(thread.body);
    expect(thread.body.root).toMatchObject({ isMine: true, isOp: true, replyCount: 14 });
    expect(thread.body.replies.items.length).toBe(14);
    expect(thread.body.replies.items.some((r: BuzzReply) => r.depth === 2)).toBe(true);
    firewall((await maya.get('/api/buzz/mine?kind=threads')).body);
    firewall((await maya.get('/api/buzz/mine?kind=replies')).body);
    expect((await maya.get('/api/buzz/mine?kind=replies')).body.items.length).toBeGreaterThan(0);
    // the two auto-hidden seeds are absent from every feed; the collapsed one is out of hot / top
    const hiddenIds = (ctx.db.prepare("SELECT id FROM buzz_posts WHERE status = 'hidden'").all() as { id: string }[]).map((r) => r.id);
    const collapsedId = q<{ id: string }>("SELECT id FROM buzz_posts WHERE status = 'active' AND eligible_score <= -5 AND eligible_votes >= 8").id;
    const stranger = reader().api;
    // `stranger` may sit on another campus: Maya (UT) sees the hero campus feed, the stranger sees Global
    for (const who of [stranger, maya]) for (const scope of ['campus', 'global']) for (const sort of ['hot', 'new', 'top']) {
      const ids = (await who.get('/api/buzz/feed').query({ sort, scope, window: 'all', limit: 50 })).body.items.map((b: Buzz) => b.id);
      expect(ids.some((id: string) => hiddenIds.includes(id))).toBe(false);
      if (sort !== 'new') expect(ids).not.toContain(collapsedId);
    }
    // pagination walks Maya's campus feed and the global feed without repeats — and no buzz is in both
    const seen = new Set<string>();
    for (const scope of ['campus', 'global']) {
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const res = await maya.get('/api/buzz/feed').query({ sort: 'hot', scope, limit: 7, ...(cursor ? { cursor } : {}) });
        for (const b of res.body.items as Buzz[]) {
          expect(seen.has(b.id), `${b.id} served twice (${scope})`).toBe(false);
          expect(b.scope).toBe(scope);
          seen.add(b.id);
        }
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(25);
    expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM buzz_posts WHERE root_id IS NULL AND scope = 'global'").n).toBeGreaterThan(0);
  });
});
