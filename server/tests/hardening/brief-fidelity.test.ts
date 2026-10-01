/**
 * HARDENING — lens: brief fidelity (Constitution §0, sentence by sentence).
 *
 * Full mode (`createTestApp({ seed: 'all' })`: static routes/index.ts, every schema, every seed) exercised end-to-end as
 * the seeded demo student (Maya) wherever the requirement is server-observable. A FAILING test here is a confirmed
 * finding (left failing on purpose for the fixer); a passing one is a regression guard.
 *
 * Client-only requirements (router wiring, "Coming together" stubs, guidelines copy, bottom-nav order) are checked by
 * reading the client source files, since no dev server may run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUIDELINES_VERSION, HOME_TABS } from '@shared/core';
import { DEMO, ORG, U } from '../../src/db/seeds/ids';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, overrideConfig, type TestCtx } from '../../src/lib/testing';

type Agent = ReturnType<TestCtx['as']>;

let ctx: TestCtx;
let maya: Agent;
let tmpRoot: string;
let restoreCfg: () => void;

const CLIENT = path.resolve(__dirname, '../../../client/src');

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-brief-'));
  restoreCfg = overrideConfig({ uploadsDir: path.join(tmpRoot, 'uploads') });
  ctx = await createTestApp({ seed: 'all' });
  maya = ctx.as(DEMO.student);
}, 120_000);

afterAll(() => {
  restoreCfg?.();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const row = <T = any>(sql: string, ...args: unknown[]): T => ctx.db.prepare(sql).get(...args) as T;
const rows = <T = any>(sql: string, ...args: unknown[]): T[] => ctx.db.prepare(sql).all(...args) as T[];

/* ───────────────────────────── synthetic media ───────────────────────────── */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
function mp4(durationMs: number): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2mp41', 'latin1'));
  const mvhd = box('mvhd', Buffer.from([0, 0, 0, 0]), u32(0), u32(0), u32(1000), u32(durationMs), Buffer.alloc(80));
  const moov = box('moov', mvhd, box('trak', box('tkhd', Buffer.alloc(84))));
  return Buffer.concat([ftyp, box('free', Buffer.alloc(8)), box('mdat', Buffer.alloc(300)), moov]);
}
function vint(n: number): Buffer {
  if (n < 0x7f) return Buffer.from([0x80 | n]);
  if (n < 0x3fff) return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  if (n < 0x1fffff) return Buffer.from([0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff]);
  return Buffer.from([0x10 | (n >> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
function el(id: number[], payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id), vint(payload.length), payload]);
}
function uint(n: number, bytes: number): Buffer {
  const b = Buffer.alloc(bytes);
  for (let i = bytes - 1; i >= 0; i--) {
    b[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return b;
}
/**
 * WebM shaped like browser MediaRecorder output: Info carries a TimecodeScale but NO Duration element (Chrome/Firefox
 * never write one), and the real length is only visible from the Cluster timecodes. Clusters here span `spanMs`.
 */
function webmNoDuration(spanMs: number): Buffer {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    el([0x42, 0x86], Buffer.from([1])), el([0x42, 0xf7], Buffer.from([1])), el([0x42, 0xf2], Buffer.from([4])), el([0x42, 0xf3], Buffer.from([8])),
    el([0x42, 0x82], Buffer.from('webm', 'latin1')), el([0x42, 0x87], Buffer.from([4])), el([0x42, 0x85], Buffer.from([2])),
  ]));
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    el([0x2a, 0xd7, 0xb1], uint(1_000_000, 3)), el([0x4d, 0x80], Buffer.from('Chrome', 'latin1')), el([0x57, 0x41], Buffer.from('Chrome', 'latin1')),
  ]));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.alloc(20));
  const clusters: Buffer[] = [];
  for (let t = 0; t <= spanMs; t += 10_000) {
    const simpleBlock = el([0xa3], Buffer.concat([Buffer.from([0x81, 0x00, 0x00, 0x80]), Buffer.alloc(32)]));
    clusters.push(el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([el([0xe7], uint(t, 4)), simpleBlock])));
  }
  const segment = el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks, ...clusters]));
  return Buffer.concat([header, segment]);
}

function uploadVideo(agent: Agent, file: Buffer, filename: string, contentType: string, durationMs?: number) {
  let req = agent.post('/api/uploads').field('kind', 'video').field('width', '540').field('height', '960');
  if (durationMs !== undefined) req = req.field('durationMs', String(durationMs));
  return req.attach('file', file, { filename, contentType });
}

/* ───────────────────────────── helpers ───────────────────────────── */

async function signUpVia(email: string, handle: string) {
  const agent = ctx.anon();
  const start = await agent.post('/api/auth/start').send({ email });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const verify = await agent.post('/api/auth/verify').send({ email, code: start.body.devCode });
  expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  expect(verify.body.status).toBe('needs_profile');
  const complete = await agent
    .post('/api/auth/complete')
    .send({ signupToken: verify.body.signupToken, displayName: 'Fresh Person', handle, accountType: 'student', isAdult: true });
  expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  return { agent, start: start.body, user: complete.body.user };
}

const ANSWERS = { sleep: 1, clean: 2, noise: 1, guests: 1, hosting: 1, smoking: 0, pets: 1, sharing: 1 };

/* ═════════════════════════════ §0 "Sign-up requires a university email address" ═════════════════════════════ */

describe('§0 / §6 university-email gate (end-to-end)', () => {
  it('personal and disposable providers are rejected with friendly copy; nothing is created', async () => {
    const before = row<{ n: number }>('SELECT COUNT(*) AS n FROM universities').n;
    for (const email of ['maya.personal@gmail.com', 'someone@outlook.com', 'x@icloud.com', 'burner@mailinator.com', 'x@example.org', 'x@stanford.edu.evil.com']) {
      const r = await ctx.anon().post('/api/auth/start').send({ email });
      expect(r.status, email).toBe(422);
      expect(['email_personal', 'email_disposable', 'email_not_academic'], email).toContain(r.body.error.code);
      expect(typeof r.body.error.message).toBe('string');
      expect(r.body.error.message.length).toBeGreaterThan(10);
      expect(r.body.devCode, email).toBeUndefined();
    }
    expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM universities').n).toBe(before);
  });

  it('a known academic subdomain (cs.utexas.edu) signs up onto the seeded campus', async () => {
    const { user } = await signUpVia('new.kid@cs.utexas.edu', 'newkid_cs');
    expect(user.university.id).toBe('uni_utexas');
  });

  it('an unknown academic domain auto-creates a campus; a second student joins the SAME campus; the user can use the app after guidelines', async () => {
    const before = row<{ n: number }>('SELECT COUNT(*) AS n FROM universities').n;
    const a = await signUpVia('first@brandnewcollege.edu', 'bnc_first');
    expect(a.start.university.isNew).toBe(true);
    const uni = row<{ id: string; is_auto_created: number; domain: string }>('SELECT id, is_auto_created, domain FROM universities WHERE id = ?', a.user.university.id);
    expect(uni).toMatchObject({ is_auto_created: 1, domain: 'brandnewcollege.edu' });
    expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM universities').n).toBe(before + 1);

    const b = await signUpVia('second@mail.brandnewcollege.edu', 'bnc_second');
    expect(b.user.university.id).toBe(a.user.university.id);
    expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM universities').n).toBe(before + 1);

    // community guidelines gate the app itself
    const gated = await a.agent.get('/api/orbit/feed');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('onboarding_required');
    expect((await a.agent.post('/api/me/guidelines').send({ kind: 'app', version: 'stale' })).status).toBe(400);
    expect((await a.agent.post('/api/me/guidelines').send({ kind: 'app', version: GUIDELINES_VERSION })).status).toBe(200);
    expect((await a.agent.post('/api/me/onboarding/complete')).status).toBe(200);
    expect((await a.agent.get('/api/orbit/feed')).status).toBe(200);
  });

  it('an international pattern (.ac.<cc>) and an allow-listed non-pattern domain are accepted', async () => {
    const ac = await ctx.anon().post('/api/auth/start').send({ email: 'x@student.newplace.ac.uk' });
    expect(ac.status, JSON.stringify(ac.body)).toBe(200);
    const allow = await ctx.anon().post('/api/auth/start').send({ email: 'x@mail.utoronto.ca' });
    expect(allow.status, JSON.stringify(allow.body)).toBe(200);
  });
});

/* ═════════════════════════════ §0.1 Home › Reels ≤ 60 s ═════════════════════════════ */

describe('§0.1 Reels — ≤ 60-second vertical videos, posted from the public profile', () => {
  it('a 20 s MP4 posts as Maya (real public author) and a 61 s MP4 is rejected', async () => {
    const ok = await uploadVideo(maya, mp4(20_000), 'clip.mp4', 'video/mp4');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const post = await maya.post('/api/reels').send({ videoUploadId: ok.body.id, caption: 'brief fidelity reel', visibility: 'campus' });
    expect(post.status, JSON.stringify(post.body)).toBe(201);
    expect(post.body.author.handle).toBe('mayachen');
    const feed = await maya.get('/api/reels/feed?scope=campus');
    expect(feed.body.items[0].id).toBe(post.body.id);

    const long = await uploadVideo(maya, mp4(61_000), 'long.mp4', 'video/mp4');
    expect(long.status).toBe(422);
    expect(long.body.error.message).toBe('Reels max out at 60 seconds.');
  });

  it('a 61 s MP4 cannot be smuggled in by lying about durationMs', async () => {
    const r = await uploadVideo(maya, mp4(61_000), 'long.mp4', 'video/mp4', 10_000);
    expect(r.status).toBe(422);
  });

  it('FINDING: a 2-minute MediaRecorder-style WebM (no Duration element) is accepted when the client claims 20 s', async () => {
    // The probe only reads Info/Duration; when it is absent the server trusts the multipart `durationMs` field
    // (uploads.ts `const duration = probed ?? client`). Every browser-recorded WebM lacks Duration, so the ≤ 60 s rule
    // is client-enforced only for them.
    const file = webmNoDuration(120_000);
    const up = await uploadVideo(maya, file, 'recording.webm', 'video/webm', 20_000);
    if (up.status === 201) {
      const reel = await maya.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'two minutes long', visibility: 'campus' });
      // demonstrate the full bypass for the report before failing
      expect.soft(reel.status).toBe(201);
    }
    expect(up.status, `server accepted a 120 s WebM: ${JSON.stringify(up.body)}`).toBe(422);
  });
});

/* ═════════════════════════════ §0.1 Home › Buzz ═════════════════════════════ */

describe('§0.1 Buzz — post + thread, fully anonymous, guidelines-gated', () => {
  let threadId = '';
  const TOKEN = 'zorblaxquiet';

  it('Buzz requires accepting the Buzz guidelines before the first read', async () => {
    const fresh = ctx.createUser({ buzzGate: false });
    const agent = ctx.as(fresh.id);
    const gated = await agent.get('/api/buzz/feed?sort=new&scope=campus');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('buzz_gate_required');
    expect((await agent.post('/api/buzz').send({ text: 'hello' })).status).toBe(403);
    expect((await agent.post('/api/me/guidelines').send({ kind: 'buzz', version: GUIDELINES_VERSION })).status).toBe(200);
    expect((await agent.get('/api/buzz/feed?sort=new&scope=campus')).status).toBe(200);
  });

  it('Maya posts a buzz, another student replies; nothing in any response identifies either author', async () => {
    const post = await maya.post('/api/buzz').send({ text: `Library 4th floor is so ${TOKEN} tonight, perfect for studying` });
    expect(post.status, JSON.stringify(post.body)).toBe(201);
    threadId = post.body.threadId ?? post.body.id;
    expect(post.body.isMine).toBe(true);
    expect(post.body.alias?.label).toMatch(/^Anon /);

    const replier = ctx.createUser({ displayName: 'Quentin Replywright', handle: 'quentin_rw' });
    const reply = await ctx.as(replier.id).post(`/api/buzz/${threadId}/replies`).send({ text: 'Agreed, the silent section is the best' });
    expect(reply.status, JSON.stringify(reply.body)).toBe(201);

    const idents = ctx.seededIdentityStrings();
    const asOther = ctx.as(U.noahg);
    for (const [agent, url] of [
      [asOther, `/api/buzz/${threadId}`],
      [asOther, '/api/buzz/feed?sort=new&scope=campus'],
      [asOther, '/api/buzz/feed?sort=hot&scope=global'],
      [maya, `/api/buzz/${threadId}/replies`],
      [maya, '/api/buzz/mine?kind=threads'],
      [maya, '/api/notifications?filter=all'],
    ] as const) {
      const r = await agent.get(url);
      expect(r.status, url).toBe(200);
      if (url.startsWith('/api/buzz')) {
        assertNoForbiddenKeys(r.body);
        assertNoIdentityLeak(r.body, idents);
      }
    }
    const thread = await asOther.get(`/api/buzz/${threadId}`);
    expect(thread.body.root.text).toContain(TOKEN);
    expect(thread.body.root.isMine).toBe(false);
    expect(thread.body.replies.items.length).toBeGreaterThanOrEqual(1);
    // the buzz reply notification to Maya carries no actor
    const notes = rows<{ actor_id: string | null }>(`SELECT actor_id FROM notifications WHERE user_id = ? AND type LIKE 'buzz.%'`, U.mayachen);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.actor_id).toBeNull();
  });

  it('Buzz never surfaces in Orbit, Discover, profiles or suggestions', async () => {
    const other = ctx.as(U.noahg);
    for (const url of ['/api/orbit/feed', `/api/discover/search?q=${TOKEN}`, '/api/discover/home', '/api/users/mayachen', `/api/orbit/users/${U.mayachen}/posts`, `/api/reels/user/${U.mayachen}`, '/api/onboarding/suggestions']) {
      const r = await other.get(url);
      expect(r.status, url).toBe(200);
      const text = JSON.stringify(r.body);
      expect(text, url).not.toContain(TOKEN);
      expect(text, url).not.toContain(threadId);
    }
    expect((await other.get(`/api/discover/search?q=${TOKEN}`)).body.items).toEqual([]);
  });
});

describe('§0.1 Buzz — "monitored by the developers under community guidelines"', () => {
  it('a threatening buzz is stopped by the moderation engine (blocked or held + queued)', async () => {
    const before = row<{ n: number }>(`SELECT COUNT(*) AS n FROM mod_queue`).n;
    const r = await maya.post('/api/buzz').send({ text: 'I am going to bring a gun to the econ lecture tomorrow and shoot everyone' });
    if (r.status === 201) {
      expect(r.body.status).not.toBe('active');
      expect(row<{ n: number }>(`SELECT COUNT(*) AS n FROM mod_queue`).n).toBeGreaterThan(before);
    } else {
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('content_blocked');
    }
  });

  it('a reported buzz reaches the moderator queue with no author identity', async () => {
    const post = await maya.post('/api/buzz').send({ text: 'the dining hall pasta was honestly a crime against carbs' });
    expect(post.status).toBe(201);
    const rep = await ctx.as(U.noahg).post('/api/reports').send({ entityType: 'buzz', entityId: post.body.id, reason: 'harassment' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const mod = ctx.as(DEMO.moderator);
    const qid = row<{ id: string } | undefined>(`SELECT id FROM mod_queue WHERE entity_id = ?`, post.body.id)?.id;
    expect(qid, 'a queue row exists for the reported buzz').toBeTruthy();
    const q = await mod.get('/api/admin/queue?limit=50');
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const mayaRow = row<{ id: string; handle: string; display_name: string; email: string }>('SELECT id, handle, display_name, email FROM users WHERE id = ?', U.mayachen);
    assertNoIdentityLeak((q.body.items as any[]).filter((i) => JSON.stringify(i).includes(post.body.id)), [mayaRow.id, mayaRow.handle, mayaRow.display_name, mayaRow.email]);
    const detail = await mod.get(`/api/admin/queue/${qid}`);
    expect(detail.status).toBe(200);
    assertNoIdentityLeak(detail.body, [mayaRow.id, mayaRow.handle, mayaRow.display_name, mayaRow.email]);
  });
});

/* ═════════════════════════════ §0.1 Home › Orbit ═════════════════════════════ */

describe('§0.1 Orbit — people/orgs you follow, plus what is popular on your own campus (DECISIONS D8)', () => {
  /** Every item of Maya's feed, walked page by page. */
  async function walkFeed(): Promise<{ id: string; highlight?: string; author: { id: string; universityId: string } }[]> {
    const out: { id: string; highlight?: string; author: { id: string; universityId: string } }[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const r = await maya.get(`/api/orbit/feed?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(r.status).toBe(200);
      out.push(...r.body.items);
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  it('an ordinary non-followed post is absent; followed person / org posts are present; every other author is a labelled same-campus highlight', async () => {
    const stranger = ctx.createUser({ displayName: 'Stranger Danger', handle: 'not_followed_1' });
    expect(row('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?', U.mayachen, stranger.id)).toBeUndefined();
    const sp = await ctx.as(stranger.id).post('/api/orbit/posts').send({ text: 'an ordinary stranger post should not reach Maya' });
    expect(sp.status, JSON.stringify(sp.body)).toBe(201);

    const followedPerson = row<{ id: string }>(
      `SELECT u.id FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND u.account_type = 'student' AND u.status = 'active' ORDER BY u.id LIMIT 1`,
      U.mayachen,
    );
    const followedOrg = row<{ id: string }>(
      `SELECT u.id FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND u.account_type = 'org' AND u.status = 'active' ORDER BY u.id LIMIT 1`,
      U.mayachen,
    );
    expect(followedPerson?.id).toBeTruthy();
    expect(followedOrg?.id).toBeTruthy();
    const fp = await ctx.as(followedPerson.id).post('/api/orbit/posts').send({ text: 'followed person post for orbit' });
    const fo = await ctx.as(followedOrg.id).post('/api/orbit/posts').send({ text: 'followed org post for orbit' });
    expect(fp.status).toBe(201);
    expect(fo.status).toBe(201);

    const items = await walkFeed();
    const ids = items.map((p) => p.id);
    expect(ids).not.toContain(sp.body.id);
    expect(ids).toContain(fp.body.id);
    expect(ids).toContain(fo.body.id);
    const followees = new Set(rows<{ id: string }>('SELECT followee_id AS id FROM follows WHERE follower_id = ?', U.mayachen).map((r) => r.id));
    const mayaUni = row<{ u: string }>('SELECT university_id AS u FROM users WHERE id = ?', U.mayachen).u;
    for (const p of items) {
      if (p.author.id === U.mayachen || followees.has(p.author.id)) {
        expect(p.highlight, `followed post ${p.id} carries no label`).toBeUndefined();
      } else {
        expect(p.highlight, `author ${p.author.id} is not followed, so the post must be a labelled highlight`).toMatch(/^(popular|official)$/);
        expect(p.author.universityId, `highlight ${p.id} must come from Maya's own campus`).toBe(mayaUni);
      }
    }
  });

  it('a popular post from Maya\'s campus reaches her (labelled); an equally popular one from another campus never does', async () => {
    const near = ctx.createUser({ handle: 'near_popular_poster' });
    const far = ctx.createUser({ handle: 'far_popular_poster', universityId: 'uni_umich' });
    const np = await ctx.as(near.id).post('/api/orbit/posts').send({ text: 'the whole campus is talking about this' });
    const fp = await ctx.as(far.id).post('/api/orbit/posts').send({ text: 'the whole of Ann Arbor is talking about this' });
    expect(np.status).toBe(201);
    expect(fp.status).toBe(201);
    // real likes from real accounts on each campus, well above the seeded campus median
    for (let i = 0; i < 25; i++) {
      expect((await ctx.as(ctx.createUser().id).put(`/api/orbit/posts/${np.body.id}/like`)).status).toBe(200);
      expect((await ctx.as(ctx.createUser({ universityId: 'uni_umich' }).id).put(`/api/orbit/posts/${fp.body.id}/like`)).status).toBe(200);
    }
    const items = await walkFeed();
    expect(items.find((p) => p.id === np.body.id)?.highlight).toBe('popular');
    expect(items.map((p) => p.id)).not.toContain(fp.body.id);
  });

  it('the "New posts" counter only counts followed authors', async () => {
    const since = Date.now() - 1000;
    const seen = await maya.post('/api/orbit/feed/seen');
    expect(seen.status).toBe(204);
    const base = (await maya.get(`/api/orbit/feed/new-count?since=${since}`)).body.count as number;
    const stranger = ctx.createUser({ handle: 'not_followed_2' });
    for (let i = 0; i < 3; i++) expect((await ctx.as(stranger.id).post('/api/orbit/posts').send({ text: `stranger spam ${i}` })).status).toBe(201);
    const after = await maya.get(`/api/orbit/feed/new-count?since=${since}`);
    expect(after.status).toBe(200);
    expect(after.body.count).toBe(base);
  });

  it('the Orbit reels rail (GET /reels/following) excludes non-followed authors', async () => {
    const stranger = ctx.createUser({ handle: 'not_followed_reeler' });
    const agent = ctx.as(stranger.id);
    const up = await uploadVideo(agent, mp4(15_000), 'a.mp4', 'video/mp4');
    expect(up.status).toBe(201);
    const reel = await agent.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'stranger reel', visibility: 'global' });
    expect(reel.status).toBe(201);
    const rail = await maya.get('/api/reels/following?limit=50');
    expect(rail.status).toBe(200);
    expect(rail.body.items.map((r: { id: string }) => r.id)).not.toContain(reel.body.id);
  });
});

/* ═════════════════════════════ §0.2 Discover ═════════════════════════════ */

describe('§0.2 Discover — search people/orgs; suggestions from public profiles only', () => {
  it('search finds a person by name and an org by name, with only public-profile fields', async () => {
    const people = await maya.get('/api/discover/search?q=sofia&type=people');
    expect(people.status).toBe(200);
    expect(people.body.items.some((h: any) => h.user.id === U.sofiaram)).toBe(true);
    const orgs = await maya.get('/api/discover/search?q=solar&type=orgs');
    expect(orgs.status).toBe(200);
    expect(orgs.body.items.some((h: any) => h.user.id === ORG.solarcar), JSON.stringify(orgs.body)).toBe(true);
    for (const h of orgs.body.items) expect(h.user.accountType).toBe('org');
    const text = JSON.stringify([people.body, orgs.body]);
    for (const k of ['alias', 'threadId', 'buzz', 'isOp', 'karma']) expect(text).not.toContain(`"${k}"`);
  });

  it('home returns the three suggestion sections with reasons', async () => {
    const r = await maya.get('/api/discover/home');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.peopleYouMayKnow)).toBe(true);
    expect(Array.isArray(r.body.activeCreators)).toBe(true);
    expect(Array.isArray(r.body.popularOrgs)).toBe(true);
    expect(r.body.peopleYouMayKnow.length + r.body.activeCreators.length + r.body.popularOrgs.length).toBeGreaterThan(0);
    for (const s of [...r.body.peopleYouMayKnow, ...r.body.activeCreators, ...r.body.popularOrgs]) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('a student who posts publicly is suggested as an active creator (public profile, real reason)', async () => {
    const creator = ctx.createUser({ handle: 'public_creator_x', displayName: 'Paula Creator' });
    const c = ctx.as(creator.id);
    for (let i = 0; i < 12; i++) expect((await c.post('/api/orbit/posts').send({ text: `public post number ${i} about campus life` })).status).toBe(201);
    const r = await maya.get('/api/discover/home');
    const hit = (r.body.activeCreators as any[]).find((s) => s.user.id === creator.id);
    expect(hit, JSON.stringify(r.body.activeCreators.map((s: any) => [s.user.handle, s.reason]))).toBeTruthy();
    expect(hit.user.handle).toBe('public_creator_x');
  });

  it('a user whose only activity is Buzz never becomes an "active creator"', async () => {
    const anonOnly = ctx.createUser({ handle: 'buzz_only_person', displayName: 'Buzzonly Person' });
    const a = ctx.as(anonOnly.id);
    for (let i = 0; i < 3; i++) expect((await a.post('/api/buzz').send({ text: `anonymous musing number ${i} about the dining hall` })).status).toBe(201);
    const r = await maya.get('/api/discover/home');
    expect(JSON.stringify(r.body)).not.toContain(anonOnly.id);
    expect(row<{ t: number | null }>('SELECT last_public_post_at AS t FROM users WHERE id = ?', anonOnly.id).t).toBeNull();
  });
});

/* ═════════════════════════════ §0.3 Messages ═════════════════════════════ */

describe('§0.3 Messages — people can message each other', () => {
  it('Maya DMs a friend she follows; the message is delivered (list + realtime)', async () => {
    const friend = U.sofiaram;
    const open = await maya.post('/api/dm').send({ userId: friend });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    const cid = open.body.conversationId;
    const sent = await maya.post(`/api/conversations/${cid}/messages`).send({ kind: 'text', text: 'brief fidelity hello', clientId: 'c1' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const theirs = await ctx.as(friend).get(`/api/conversations/${cid}/messages`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.items.some((m: any) => m.text === 'brief fidelity hello')).toBe(true);
    expect(ctx.wsEventsFor(friend).some((e: any) => e.type === 'message.new')).toBe(true);
  });

  it('a stranger\'s first message lands in Requests and is readable by the recipient', async () => {
    const stranger = ctx.createUser({ handle: 'dm_stranger' });
    const s = ctx.as(stranger.id);
    const open = await s.post('/api/dm').send({ userId: U.mayachen });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    const cid = open.body.conversationId;
    expect((await s.post(`/api/conversations/${cid}/messages`).send({ kind: 'text', text: 'hi from a stranger' })).status).toBe(201);
    const reqs = await maya.get('/api/conversations?tab=requests');
    expect(reqs.body.items.map((c: any) => c.id)).toContain(cid);
    const msgs = await maya.get(`/api/conversations/${cid}/messages`);
    expect(msgs.body.items.some((m: any) => m.text === 'hi from a stranger')).toBe(true);
    expect((await maya.post(`/api/conversations/${cid}/accept`)).status).toBe(204);
    expect((await maya.post(`/api/conversations/${cid}/messages`).send({ kind: 'text', text: 'hey back' })).status).toBe(201);
  });
});

/* ═════════════════════════════ §0.4 Roommates ═════════════════════════════ */

describe('§0.4 Roommates — post a listing OR set filters and match without posting', () => {
  it('path A: post that you are looking → visible to Maya in browse with a match %', async () => {
    const poster = ctx.createUser({ handle: 'rm_poster', displayName: 'Rory Poster' });
    const put = await ctx.as(poster.id).put('/api/roommates/me').send({
      answers: ANSWERS, dealbreakSmoking: false, dealbreakPets: false, publish: true,
      mode: 'need', budget: 900, moveIn: '2027-01', leaseMonths: 12, neighborhoods: ['West Campus'], livingWith: 'anyone',
      about: 'CS junior, quiet, tidy, looking for a 2BR near campus',
    });
    expect([200, 201], JSON.stringify(put.body)).toContain(put.status);
    expect(put.body.published).toBe(true);
    const browse = await maya.get('/api/roommates?sort=newest&limit=50');
    expect(browse.status).toBe(200);
    const card = browse.body.items.find((c: any) => c.id === put.body.id);
    expect(card, 'published post visible in browse').toBeTruthy();
    expect(card.compat?.pct).toBeTypeOf('number');
  });

  it('path B: "just browse & match" with filters — ranked matches, never listed itself', async () => {
    const matcher = ctx.createUser({ handle: 'rm_matcher', displayName: 'Mona Matcher' });
    const m = ctx.as(matcher.id);
    const put = await m.put('/api/roommates/me').send({ answers: ANSWERS, dealbreakSmoking: true, dealbreakPets: false, publish: false });
    expect([200, 201], JSON.stringify(put.body)).toContain(put.status);
    expect(put.body.published).toBe(false);

    const all = await m.get('/api/roommates?sort=best&limit=50');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(0);
    const pcts = all.body.items.map((c: any) => c.compat?.pct);
    for (const p of pcts) expect(p).toBeTypeOf('number');
    expect([...pcts].sort((a: number, b: number) => b - a)).toEqual(pcts);

    const filtered = await m.get('/api/roommates?mode=have&budgetMax=1200&sort=best&limit=50');
    expect(filtered.status).toBe(200);
    for (const c of filtered.body.items) {
      expect(c.mode).toBe('have');
      expect(c.budget).toBeLessThanOrEqual(1200);
    }

    // never visible to others
    const mayaBrowse = await maya.get('/api/roommates?sort=newest&limit=50');
    expect(mayaBrowse.body.items.map((c: any) => c.id)).not.toContain(put.body.id);
    expect((await maya.get(`/api/roommates/${put.body.id}`)).status).toBe(404);

    // can still message a post (context card)
    const target = filtered.body.items[0] ?? all.body.items[0];
    const dm = await m.post('/api/dm').send({ userId: target.user.id, context: { kind: 'roommate', id: target.id } });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
  });
});

/* ═════════════════════════════ §0.5 Marketplace ═════════════════════════════ */

describe('§0.5 Marketplace — buy / sell / trade', () => {
  it('sell → buyer messages seller + offers → seller accepts → mark sold', async () => {
    const list = await maya.post('/api/market/listings').send({
      type: 'sell', category: 'electronics', title: 'Brief fidelity headphones', description: 'Barely used over-ear headphones', price: 60, condition: 'like_new', photos: [],
    });
    expect(list.status, JSON.stringify(list.body)).toBe(201);
    const id = list.body.id;
    expect(list.body.seller.handle).toBe('mayachen');

    const buyer = ctx.createUser({ handle: 'mk_buyer', displayName: 'Bea Buyer' });
    const b = ctx.as(buyer.id);
    const browse = await b.get('/api/market/listings?q=headphones');
    expect(browse.body.items.map((l: any) => l.id)).toContain(id);

    const dm = await b.post('/api/dm').send({ userId: U.mayachen, context: { kind: 'listing', id } });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    const cid = dm.body.conversationId;
    expect((await b.post(`/api/conversations/${cid}/messages`).send({ kind: 'text', text: 'Is this still available?' })).status).toBe(201);
    const offer = await b.post(`/api/market/listings/${id}/offers`).send({ amount: 50 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    expect(offer.body.conversationId).toBe(cid);

    const accept = await maya.post(`/api/conversations/${cid}/messages/${offer.body.messageId}/offer`).send({ action: 'accept' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const sold = await maya.post(`/api/market/listings/${id}/sold`).send({ state: 'sold' });
    expect(sold.status, JSON.stringify(sold.body)).toBe(200);
    expect(sold.body.state).toBe('sold');
    const mine = await maya.get('/api/market/mine?state=closed');
    expect(mine.body.items.map((l: any) => l.id)).toContain(id);
  });

  it('trade listings require tradeFor and are filterable by type', async () => {
    expect((await maya.post('/api/market/listings').send({ type: 'trade', category: 'textbooks', title: 'Calc textbook', photos: [] })).status).toBe(400);
    const t = await maya.post('/api/market/listings').send({ type: 'trade', category: 'bikes_scooters', title: 'Fixie bike', tradeFor: 'an electric scooter', photos: [] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.tradeFor).toBe('an electric scooter');
    const other = await ctx.as(U.noahg).get('/api/market/listings?type=trade&limit=50');
    expect(other.body.items.map((l: any) => l.id)).toContain(t.body.id);
  });
});

/* ═════════════════════════════ §0.6 Apartments ═════════════════════════════ */

describe('§0.6 Apartments — coming soon + Get notified + engagement tracking', () => {
  it('waitlist state, leave, re-join (idempotent, real counts)', async () => {
    const s0 = await maya.get('/api/waitlist/apartments');
    expect(s0.status).toBe(200);
    expect(s0.body.joined).toBe(true); // seeded
    const left = await maya.delete('/api/waitlist/apartments');
    expect(left.status).toBe(200);
    expect(left.body.joined).toBe(false);
    expect(left.body.campusCount).toBe(s0.body.campusCount - 1);
    const j1 = await maya.post('/api/waitlist/apartments').send({ source: 'nav' });
    const j2 = await maya.post('/api/waitlist/apartments').send({ source: 'nav' });
    expect(j1.body.joined).toBe(true);
    expect(j2.body.campusCount).toBe(s0.body.campusCount);
  });

  it('page_view / cta_click are recorded with user + university and show in the admin funnel', async () => {
    const admin = row<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
    const before = (await ctx.as(admin.id).get('/api/admin/analytics/apartments')).body;
    const t = await maya.post('/api/analytics/track').send({
      events: [{ name: 'apartments.page_view', props: { source: 'nav' } }, { name: 'apartments.cta_click', props: { source: 'poster' } }],
    });
    expect(t.status).toBe(204);
    const ev = rows<{ name: string; user_id: string; university_id: string }>(
      `SELECT name, user_id, university_id FROM analytics_events WHERE user_id = ? AND name LIKE 'apartments.%' ORDER BY created_at DESC LIMIT 5`,
      U.mayachen,
    );
    expect(ev.map((e) => e.name)).toEqual(expect.arrayContaining(['apartments.page_view', 'apartments.cta_click']));
    for (const e of ev) expect(e.university_id).toBe('uni_utexas');
    const after = await ctx.as(admin.id).get('/api/admin/analytics/apartments');
    expect(after.status).toBe(200);
    expect(after.body.totals.views).toBe(before.totals.views + 1);
    expect(after.body.totals.ctaClicks).toBe(before.totals.ctaClicks + 1);
  });

  it('the micro-survey answers and returns a campus split', async () => {
    const s = await maya.get('/api/apartments/survey');
    expect(s.status).toBe(200);
    const split = await maya.put('/api/apartments/survey/when').send({ answer: ['next_semester'] });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect(split.body.question).toBe('when');
    expect(split.body.total).toBeGreaterThan(0);
    expect(split.body.options.find((o: any) => o.id === 'next_semester').count).toBeGreaterThan(0);
    expect((await maya.get('/api/apartments/survey')).body.answers.when).toEqual(['next_semester']);
  });
});

/* ═════════════════════════════ client wiring (static) ═════════════════════════════ */

describe('client wiring — every §0 page is routed, in the nav in order, and none is the "Coming together" stub', () => {
  const read = (p: string): string => fs.readFileSync(path.join(CLIENT, p), 'utf8');
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

  it('bottom nav order is Home · Discover · Messages · Roommates · Market · Apartments', () => {
    const src = read('app/BottomNav.tsx');
    const keys = [...src.matchAll(/key: '(\w+)', label:/g)].map((m) => m[1]);
    expect(keys).toEqual(['home', 'discover', 'messages', 'roommates', 'market', 'apartments']);
  });

  it('router wires every brief page to its slice export', () => {
    const src = read('app/router.tsx');
    for (const p of ['/home/:tab', '/discover/*', '/messages/*', '/roommates/*', '/market/*', '/apartments', '/buzz/*', '/reel/*', '/post/*', '/guidelines']) {
      expect(src, p).toContain(`path="${p}"`);
    }
  });

  it('no feature file still renders the "Coming together" stub', () => {
    const hits = walk(path.join(CLIENT, 'features')).filter((f) => /\.(tsx?|jsx?)$/.test(f) && /Coming together/i.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('Home has exactly the three tabs Reels · Buzz · Orbit, and all three panes are lazy-loaded from their slices', () => {
    expect([...HOME_TABS]).toEqual(['reels', 'buzz', 'orbit']);
    const src = read('app/home/HomePage.tsx');
    for (const e of ['m.ReelsPane', 'm.BuzzPane', 'm.OrbitPane', 'snap-x']) expect(src).toContain(e);
  });

  it('Apartments renders "Coming soon" + a "Get notified" CTA wired to the waitlist, and tracks page_view + cta_click', () => {
    const src = read('features/apartments/apartments/ApartmentsPage.tsx');
    expect(src).toMatch(/Coming\s*<span[^>]*>soon<\/span>|Coming soon/);
    expect(src).toContain('Get notified');
    expect(src).toContain('useWaitlistToggle');
    expect(src).toContain("track('apartments.page_view'");
    expect(src).toContain("track('apartments.cta_click'");
  });

  it('no server module still throws the 501 notImplemented stub', () => {
    const SERVER = path.resolve(__dirname, '../../src');
    const hits = walk(SERVER).filter((f) => f.endsWith('.ts') && !f.endsWith(path.join('lib', 'stub.ts')) && /notImplemented\(/.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('community guidelines cover harassment/bullying, threats and drugs, plus the Buzz-anonymity section', () => {
    const src = read('features/admin/guidelines.tsx');
    for (const w of [/harass/i, /bully/i, /threat/i, /drug/i, /buzz-anonymity/, /enforcement/]) expect(src).toMatch(w);
  });
});
