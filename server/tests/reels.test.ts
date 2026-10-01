/**
 * `reels` slice (SPEC §5.2) in isolation mode: upload duration rule (MP4 / QuickTime with `moov` at the end / WebM,
 * 60.3 s accepted → stored 60 000, 61 s + 75 s → 422, `POST /reels` re-checks), QuickTime served as `video/mp4`, feed
 * scope rules, like idempotency + counters, block both ways, held / hidden visibility, view counted once,
 * `public_activity` created / removed, rail = follows only, comments (one level), moderation 422 + held + notice hygiene,
 * muted 403 on every create route, adapters + card resolver, and the seed invariants (§7.5).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/core';
import type { Reel, ReelComment } from '@shared/reels';
import { getContentAdapter, resolveCard } from '../src/lib/content';
import { DAY, HOUR, now } from '../src/lib/clock';
import { createTestApp, overrideConfig, type TestCtx } from '../src/lib/testing';

/* ───────────────────────────── synthetic media (same box math as tests/core/uploads.test.ts) ───────────────────────────── */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
function mvhd(durationMs: number, timescale = 1000): Buffer {
  const units = Math.round((durationMs / 1000) * timescale);
  return box('mvhd', Buffer.from([0, 0, 0, 0]), u32(0), u32(0), u32(timescale), u32(units), Buffer.alloc(80));
}
/** `moov` at the END (phone recordings), optional QuickTime brand. */
function mp4(o: { durationMs: number; brand?: string }): Buffer {
  const ftyp = box('ftyp', Buffer.from(o.brand ?? 'isom', 'latin1'), u32(0x200), Buffer.from('isomiso2mp41', 'latin1'));
  const mdat = box('mdat', Buffer.alloc(300));
  const moov = box('moov', mvhd(o.durationMs), box('trak', box('tkhd', Buffer.alloc(84))));
  return Buffer.concat([ftyp, box('free', Buffer.alloc(8)), mdat, moov]);
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
function webm(o: { durationMs: number }): Buffer {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    el([0x42, 0x86], Buffer.from([1])), el([0x42, 0xf7], Buffer.from([1])), el([0x42, 0xf2], Buffer.from([4])), el([0x42, 0xf3], Buffer.from([8])),
    el([0x42, 0x82], Buffer.from('webm', 'latin1')), el([0x42, 0x87], Buffer.from([2])), el([0x42, 0x85], Buffer.from([2])),
  ]));
  const scale = 1_000_000;
  const scaleBuf = Buffer.from([(scale >> 16) & 0xff, (scale >> 8) & 0xff, scale & 0xff]);
  const dur = Buffer.alloc(8);
  dur.writeDoubleBE((o.durationMs * 1_000_000) / scale);
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    el([0x2a, 0xd7, 0xb1], scaleBuf), el([0x4d, 0x80], Buffer.from('test', 'latin1')), el([0x44, 0x89], dur), el([0x57, 0x41], Buffer.from('test', 'latin1')),
  ]));
  const seekHead = el([0x11, 0x4d, 0x9b, 0x74], el([0xec], Buffer.alloc(6)));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.alloc(20));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([el([0xe7], Buffer.from([0])), Buffer.alloc(64)]));
  const segment = el([0x18, 0x53, 0x80, 0x67], Buffer.concat([seekHead, info, tracks, cluster]));
  return Buffer.concat([header, segment]);
}

/* ───────────────────────────── harness ───────────────────────────── */

type Agent = ReturnType<TestCtx['as']>;

let tmpRoot: string;
let restore: () => void;
let ctx: TestCtx;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-reels-'));
  restore = overrideConfig({ uploadsDir: path.join(tmpRoot, 'uploads') });
  ctx = await createTestApp({ slices: ['reels'], seed: 'all' });
});
afterEach(() => {
  restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function uploadVideo(agent: Agent, file: Buffer, filename: string, contentType: string, durationMs?: number) {
  let req = agent.post('/api/uploads').field('kind', 'video').field('width', '540').field('height', '960');
  if (durationMs !== undefined) req = req.field('durationMs', String(durationMs));
  return req.attach('file', file, { filename, contentType });
}

async function postReel(agent: Agent, o: { durationMs?: number; caption?: string; visibility?: 'campus' | 'global'; file?: Buffer; contentType?: string; filename?: string } = {}) {
  const up = await uploadVideo(agent, o.file ?? mp4({ durationMs: o.durationMs ?? 20_000 }), o.filename ?? 'clip.mp4', o.contentType ?? 'video/mp4');
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const res = await agent.post('/api/reels').send({ videoUploadId: up.body.id, caption: o.caption ?? 'a test reel', visibility: o.visibility ?? 'campus' });
  return { upload: up.body, res };
}

const row = <T = any>(sql: string, ...args: unknown[]): T => ctx.db.prepare(sql).get(...args) as T;
const count = (sql: string, ...args: unknown[]): number => (row<{ n: number }>(sql, ...args)).n;

const FORBIDDEN_NOTICE_KEYS = ['matches', 'ruleId', 'signals', 'engine', 'span', 'rulePacks'];
function assertNoticeHygiene(body: unknown): void {
  const text = JSON.stringify(body);
  for (const k of FORBIDDEN_NOTICE_KEYS) expect(text, `key ${k}`).not.toContain(`"${k}"`);
}

/* ───────────────────────────── seed ───────────────────────────── */

describe('seed (§5.2, §7.5)', () => {
  it('12 reels with real files + posters, counters equal rows, public_activity + reel_count, Maya: 2 reels, 1 read reel.like (13 actors) + 1 unread reel.comment', () => {
    expect(count('SELECT COUNT(*) AS n FROM reels')).toBe(12);
    const reels = ctx.db.prepare('SELECT * FROM reels ORDER BY id').all() as any[];
    for (const r of reels) {
      expect(r.video_url).toMatch(/^\/seed-media\/reels\/reel-\d\d\.webm$/);
      expect(r.poster_url).toMatch(/^\/seed-media\/generated\/reels\/reel-\d\d\.svg$/);
      expect(r.duration_ms).toBe(8000);
      expect(r.like_count).toBe(count('SELECT COUNT(*) AS n FROM reel_likes WHERE reel_id = ?', r.id));
      expect(r.view_count).toBe(count('SELECT COUNT(*) AS n FROM reel_views WHERE reel_id = ?', r.id));
      expect(r.comment_count).toBe(count("SELECT COUNT(*) AS n FROM reel_comments WHERE reel_id = ? AND status = 'active'", r.id));
      expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', r.id)).toBeTruthy();
      expect(r.view_count).toBeGreaterThanOrEqual(r.like_count);
    }
    for (const c of ctx.db.prepare('SELECT * FROM reel_comments WHERE parent_id IS NULL').all() as any[]) {
      expect(c.reply_count).toBe(count("SELECT COUNT(*) AS n FROM reel_comments WHERE parent_id = ? AND status = 'active'", c.id));
      expect(c.like_count).toBe(count('SELECT COUNT(*) AS n FROM reel_comment_likes WHERE comment_id = ?', c.id));
    }
    // the stated author mix: 10 hero-campus reels (7 global, 3 campus) + 2 global from other campuses
    expect(count("SELECT COUNT(*) AS n FROM reels WHERE university_id = 'uni_utexas'")).toBe(10);
    expect(count("SELECT COUNT(*) AS n FROM reels WHERE university_id = 'uni_utexas' AND visibility = 'global'")).toBe(7);
    expect(count("SELECT COUNT(*) AS n FROM reels WHERE university_id != 'uni_utexas' AND visibility = 'global'")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM reels WHERE author_id = 'u_mayachen'")).toBe(2);
    expect(row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count).toBe(2);
    expect(row('SELECT reel_count FROM users WHERE id = ?', 'u_noahg').reel_count).toBe(3);
    // every user's reel_count equals their active reels
    for (const u of ctx.db.prepare('SELECT id, reel_count FROM users').all() as any[]) {
      expect(u.reel_count, u.id).toBe(count("SELECT COUNT(*) AS n FROM reels WHERE author_id = ? AND status = 'active'", u.id));
    }
    // seed reel files exist (D5) and the posters were written
    for (let i = 1; i <= 12; i++) {
      const nn = String(i).padStart(2, '0');
      expect(fs.existsSync(path.join(process.cwd(), 'seed-media', 'reels', `reel-${nn}.webm`)), `reel-${nn}.webm`).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), 'seed-media', 'generated', 'reels', `reel-${nn}.svg`)), `reel-${nn}.svg`).toBe(true);
    }
    // Maya's notifications from this slice: exactly two
    const notifs = ctx.db.prepare("SELECT * FROM notifications WHERE user_id = 'u_mayachen' AND type LIKE 'reel.%' ORDER BY type").all() as any[];
    expect(notifs.map((n) => n.type)).toEqual(['reel.comment', 'reel.like']);
    const like = notifs.find((n) => n.type === 'reel.like')!;
    expect(like.read_at).not.toBeNull();
    expect(like.actor_count).toBe(13);
    expect(count('SELECT COUNT(*) AS n FROM notification_actors WHERE notification_id = ?', like.id)).toBe(13);
    expect(like.target_id).toBe('reel_0009');
    const comment = notifs.find((n) => n.type === 'reel.comment')!;
    expect(comment.read_at).toBeNull();
    expect(comment.href).toBe('/reel/reel_0010?comments=1');
  });

  it('is deterministic across runs (same likes on the same reels)', async () => {
    const before = ctx.db.prepare('SELECT reel_id, user_id FROM reel_likes ORDER BY reel_id, user_id').all();
    const again = await createTestApp({ slices: ['reels'], seed: 'all' });
    const after = again.db.prepare('SELECT reel_id, user_id FROM reel_likes ORDER BY reel_id, user_id').all();
    expect(after).toEqual(before);
  });
});

/* ───────────────────────────── auth + validation ───────────────────────────── */

describe('auth + validation', () => {
  it('401 signed out; 400 on bad bodies, bad scope and a tampered cursor', async () => {
    expect((await ctx.anon().get('/api/reels/feed')).status).toBe(401);
    expect((await ctx.anon().post('/api/reels').send({})).status).toBe(401);
    const maya = ctx.as('mayachen');
    const bad = await maya.post('/api/reels').send({ caption: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    expect((await maya.post('/api/reels').send({ videoUploadId: 'u', caption: 'x'.repeat(LIMITS.reelCaption + 1) })).status).toBe(400);
    expect((await maya.post('/api/reels').send({ videoUploadId: 'u', visibility: 'friends' })).status).toBe(400);
    expect((await maya.get('/api/reels/feed?scope=everyone')).status).toBe(400);
    expect((await maya.get('/api/reels/feed?cursor=abc.def')).status).toBe(400);
    expect((await maya.post('/api/reels/reel_0001/comments').send({ text: '' })).status).toBe(400);
    expect((await maya.post('/api/reels/reel_0001/comments').send({ text: 'x'.repeat(LIMITS.commentText + 1) })).status).toBe(400);
    expect((await maya.get('/api/reels/nope')).status).toBe(404);
  });
});

/* ───────────────────────────── upload rule + POST / ───────────────────────────── */

describe('upload duration rule (one tolerance everywhere)', () => {
  it('MP4: 60.3 s accepted and stored as 60 000; 61 s and 75 s rejected 422 with the product copy', async () => {
    const maya = ctx.as('mayachen');
    const ok = await uploadVideo(maya, mp4({ durationMs: 60_300 }), 'a.mp4', 'video/mp4');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.durationMs).toBe(60_000);
    expect(ok.body.mime).toBe('video/mp4');
    for (const ms of [61_000, 75_000]) {
      const no = await uploadVideo(maya, mp4({ durationMs: ms }), 'long.mp4', 'video/mp4');
      expect(no.status, `${ms}`).toBe(422);
      expect(no.body.error.message).toBe('Reels max out at 60 seconds.');
    }
  });

  it('QuickTime (`ftyp qt  `, moov at the end): accepted, stored + served as video/mp4; 75 s rejected', async () => {
    const maya = ctx.as('mayachen');
    const ok = await uploadVideo(maya, mp4({ durationMs: 20_000, brand: 'qt  ' }), 'IMG_0001.MOV', 'video/quicktime');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mime).toBe('video/mp4');
    expect(ok.body.url).toMatch(/\.mp4$/);
    const served = await ctx.anon().get(ok.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^video\/mp4/);
    const post = await maya.post('/api/reels').send({ videoUploadId: ok.body.id, caption: 'from my phone', visibility: 'campus' });
    expect(post.status).toBe(201);
    expect(post.body.videoUrl).toBe(ok.body.url);
    expect((await uploadVideo(maya, mp4({ durationMs: 75_000, brand: 'qt  ' }), 'long.MOV', 'video/quicktime')).status).toBe(422);
  });

  it('WebM: 60.3 s accepted (stored 60 000), 61 s rejected', async () => {
    const maya = ctx.as('mayachen');
    const ok = await uploadVideo(maya, webm({ durationMs: 60_300 }), 'a.webm', 'video/webm');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.durationMs).toBe(60_000);
    expect((await uploadVideo(maya, webm({ durationMs: 61_000 }), 'b.webm', 'video/webm')).status).toBe(422);
  });

  it('POST /reels re-checks the stored duration (defence in depth) and only accepts the caller\'s own video upload', async () => {
    const maya = ctx.as('mayachen');
    const up = await uploadVideo(maya, mp4({ durationMs: 20_000 }), 'a.mp4', 'video/mp4');
    ctx.db.prepare('UPDATE uploads SET duration_ms = 61_000 WHERE id = ?').run(up.body.id);
    const no = await maya.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'x', visibility: 'global' });
    expect(no.status).toBe(422);
    expect(no.body.error.message).toBe('Reels max out at 60 seconds.');
    ctx.db.prepare('UPDATE uploads SET duration_ms = 60_000 WHERE id = ?').run(up.body.id);
    // someone else's upload → 404
    expect((await ctx.as('noahg').post('/api/reels').send({ videoUploadId: up.body.id, caption: 'x', visibility: 'global' })).status).toBe(404);
    // an image upload is not a video → 404
    expect((await maya.post('/api/reels').send({ videoUploadId: 'nope', caption: 'x', visibility: 'global' })).status).toBe(404);
    // the owner can still post it
    expect((await maya.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'x', visibility: 'global' })).status).toBe(201);
  });

  it('a POST that fails the upload checks (404 not yours / 422 too long) spends no reel_upload rate token', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    const theirs = await uploadVideo(maya, mp4({ durationMs: 20_000 }), 'a.mp4', 'video/mp4');
    const tokens = () => count("SELECT COUNT(*) AS n FROM rate_events WHERE user_id = 'u_noahg' AND action = 'reel_upload'");
    const prev = process.env.RATE_LIMITS;
    process.env.RATE_LIMITS = 'on';
    try {
      expect((await noah.post('/api/reels').send({ videoUploadId: theirs.body.id, caption: 'x', visibility: 'global' })).status).toBe(404);
      const own = await uploadVideo(noah, mp4({ durationMs: 20_000 }), 'b.mp4', 'video/mp4');
      expect(own.status).toBe(201);
      ctx.db.prepare('UPDATE uploads SET duration_ms = 75_000 WHERE id = ?').run(own.body.id);
      expect((await noah.post('/api/reels').send({ videoUploadId: own.body.id, caption: 'x', visibility: 'global' })).status).toBe(422);
      expect(tokens()).toBe(0);
      ctx.db.prepare('UPDATE uploads SET duration_ms = 20_000 WHERE id = ?').run(own.body.id);
      expect((await noah.post('/api/reels').send({ videoUploadId: own.body.id, caption: 'x', visibility: 'global' })).status).toBe(201);
      expect(tokens()).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMITS;
      else process.env.RATE_LIMITS = prev;
    }
  });
});

describe('POST / · GET /:id · DELETE /:id', () => {
  it('creates an active reel that leads the campus feed and the own grid, marks public_activity + reel_count, tracks reel_upload', async () => {
    const maya = ctx.as('mayachen');
    const before = row('SELECT reel_count, last_public_post_at FROM users WHERE id = ?', 'u_mayachen');
    const { res, upload } = await postReel(maya, { caption: 'Posting from a phone', visibility: 'campus' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const reel = res.body as Reel & { moderation: unknown };
    expect(reel).toMatchObject({
      caption: 'Posting from a phone', visibility: 'campus', status: 'active', videoUrl: upload.url, durationMs: 20_000, width: 540, height: 960,
      likeCount: 0, commentCount: 0, viewCount: 0, viewer: { liked: false, isSelf: true, isFollowingAuthor: false },
    });
    expect(reel.author.handle).toBe('mayachen');
    expect(reel.moderation).toEqual({ status: 'active', userMessage: null, support: null });
    assertNoticeHygiene(res.body);

    const feed = await maya.get('/api/reels/feed?scope=campus');
    expect(feed.status).toBe(200);
    expect(feed.body.items[0].id).toBe(reel.id);
    const grid = await maya.get('/api/reels/user/u_mayachen');
    expect(grid.body.items[0].id).toBe(reel.id);
    const other = await ctx.as('noahg').get('/api/reels/user/u_mayachen');
    expect(other.body.items[0].id).toBe(reel.id);
    expect(other.body.items[0].viewer).toEqual({ liked: false, isSelf: false, isFollowingAuthor: true });

    expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', reel.id)).toBeTruthy();
    const after = row('SELECT reel_count, last_public_post_at FROM users WHERE id = ?', 'u_mayachen');
    expect(after.reel_count).toBe(before.reel_count + 1);
    expect(after.last_public_post_at).toBeGreaterThanOrEqual(before.last_public_post_at ?? 0);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'reel_upload' AND user_id = 'u_mayachen'")).toBe(1);

    const detail = await ctx.as('tbrooks').get(`/api/reels/${reel.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(reel.id);
    // the share card resolves for others
    const card = resolveCard({ kind: 'reel', id: reel.id }, 'u_tbrooks');
    expect(card).toMatchObject({ kind: 'reel', status: 'available', title: 'Posting from a phone', ownerId: 'u_mayachen', href: `/reel/${reel.id}` });
    expect(card.subtitle).toBe('@mayachen · UT Austin');
    const cardsApi = await ctx.as('tbrooks').get(`/api/cards/reel/${reel.id}`);
    expect(cardsApi.body.status).toBe('available');
  });

  it('global reels are visible to other campuses; campus reels are not', async () => {
    const maya = ctx.as('mayachen');
    const { res: campus } = await postReel(maya, { visibility: 'campus' });
    const { res: global } = await postReel(maya, { visibility: 'global' });
    const kai = ctx.as('kaiyama'); // Stanford
    expect((await kai.get(`/api/reels/${global.body.id}`)).status).toBe(200);
    const feed = await kai.get('/api/reels/feed?scope=global&limit=50');
    const ids = feed.body.items.map((r: Reel) => r.id);
    expect(ids).toContain(global.body.id);
    expect(ids).not.toContain(campus.body.id);
    const kaiFollowsMaya = row('SELECT 1 AS ok FROM follows WHERE follower_id = ? AND followee_id = ?', 'u_kaiyama', 'u_mayachen') !== undefined;
    expect(feed.body.items.find((r: Reel) => r.id === global.body.id).viewer.isFollowingAuthor).toBe(kaiFollowsMaya);
  });

  it('DELETE: own only (404 for others), status deleted, public_activity + reel_count + notifications gone, hidden from lists', async () => {
    const maya = ctx.as('mayachen');
    const { res } = await postReel(maya);
    const id = res.body.id as string;
    await ctx.as('noahg').put(`/api/reels/${id}/like`);
    expect(count('SELECT COUNT(*) AS n FROM notifications WHERE target_type = ? AND target_id = ?', 'reel', id)).toBe(1);
    const before = row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count;
    expect((await ctx.as('noahg').delete(`/api/reels/${id}`)).status).toBe(404);
    expect((await maya.delete(`/api/reels/${id}`)).status).toBe(204);
    expect(row('SELECT status FROM reels WHERE id = ?', id).status).toBe('deleted');
    expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', id)).toBeUndefined();
    expect(row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count).toBe(before - 1);
    expect(count('SELECT COUNT(*) AS n FROM notifications WHERE target_type = ? AND target_id = ?', 'reel', id)).toBe(0);
    expect((await maya.get(`/api/reels/${id}`)).status).toBe(404);
    expect((await maya.delete(`/api/reels/${id}`)).status).toBe(404);
    const grid = await maya.get('/api/reels/user/u_mayachen?limit=50');
    expect(grid.body.items.map((r: Reel) => r.id)).not.toContain(id);
    expect(resolveCard({ kind: 'reel', id }, 'u_noahg').status).toBe('unavailable');
  });
});

/* ───────────────────────────── feed scope rules ───────────────────────────── */

describe('GET /feed scope rules', () => {
  it('campus = viewer\'s university (any visibility); global = visibility global from any campus; newest first; paged', async () => {
    const maya = ctx.as('mayachen');
    const campus = await maya.get('/api/reels/feed?scope=campus&limit=50');
    expect(campus.status).toBe(200);
    expect(campus.body.items.length).toBe(10);
    for (const r of campus.body.items as Reel[]) expect(r.author.universityId).toBe('uni_utexas');
    expect((campus.body.items as Reel[]).some((r) => r.visibility === 'campus')).toBe(true);
    const global = await maya.get('/api/reels/feed?scope=global&limit=50');
    expect(global.body.items.length).toBe(9);
    for (const r of global.body.items as Reel[]) expect(r.visibility).toBe('global');
    expect((global.body.items as Reel[]).some((r) => r.author.universityId === 'uni_stanford')).toBe(true);
    // newest first
    const ts = (campus.body.items as Reel[]).map((r) => r.createdAt);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    // pagination walks the whole set without duplicates
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await maya.get(`/api/reels/feed?scope=campus&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page.status).toBe(200);
      for (const r of page.body.items as Reel[]) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.size).toBe(10);
    // a viewer at another campus gets only their own campus's reels in campus scope
    const kai = await ctx.as('kaiyama').get('/api/reels/feed?scope=campus&limit=50');
    expect(kai.body.items.length).toBe(1);
    expect(kai.body.items[0].author.handle).toBe('kaiyama');
    // default scope is campus
    expect((await maya.get('/api/reels/feed')).body.items.length).toBe(10);
  });

  it('"Not interested" removes the reel from that viewer\'s feeds only', async () => {
    const maya = ctx.as('mayachen');
    expect((await maya.post('/api/reels/reel_0001/not-interested')).status).toBe(204);
    expect((await maya.post('/api/reels/reel_0001/not-interested')).status).toBe(204);
    const ids = (await maya.get('/api/reels/feed?scope=campus&limit=50')).body.items.map((r: Reel) => r.id);
    expect(ids).not.toContain('reel_0001');
    const others = (await ctx.as('tbrooks').get('/api/reels/feed?scope=campus&limit=50')).body.items.map((r: Reel) => r.id);
    expect(others).toContain('reel_0001');
    expect((await maya.post('/api/reels/nope/not-interested')).status).toBe(404);
  });
});

/* ───────────────────────────── likes / views / likers ───────────────────────────── */

describe('likes, views, likers', () => {
  it('like is idempotent, the counter equals the rows, notifies the author once (collapsed), unlike reverses', async () => {
    const noah = ctx.as('noahg');
    const start = row('SELECT like_count FROM reels WHERE id = ?', 'reel_0009').like_count;
    const already = row('SELECT 1 AS ok FROM reel_likes WHERE reel_id = ? AND user_id = ?', 'reel_0009', 'u_noahg') ? 1 : 0;
    const a = await noah.put('/api/reels/reel_0009/like');
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ liked: true, likeCount: start + (already ? 0 : 1) });
    const b = await noah.put('/api/reels/reel_0009/like');
    expect(b.body).toEqual(a.body);
    expect(row('SELECT like_count FROM reels WHERE id = ?', 'reel_0009').like_count).toBe(count('SELECT COUNT(*) AS n FROM reel_likes WHERE reel_id = ?', 'reel_0009'));
    const feed = await noah.get('/api/reels/feed?scope=campus&limit=50');
    expect((feed.body.items as Reel[]).find((r) => r.id === 'reel_0009')!.viewer.liked).toBe(true);
    const c = await noah.delete('/api/reels/reel_0009/like');
    expect(c.body).toEqual({ liked: false, likeCount: start + (already ? -1 : 0) });
    expect((await noah.delete('/api/reels/reel_0009/like')).body.liked).toBe(false);
    // notification: a fresh reel by tbrooks, liked by two people → one collapsed unread row for tbrooks; self-like never notifies
    const ty = ctx.as('tbrooks');
    const { res } = await postReel(ty);
    await ty.put(`/api/reels/${res.body.id}/like`);
    await noah.put(`/api/reels/${res.body.id}/like`);
    await ctx.as('mayachen').put(`/api/reels/${res.body.id}/like`);
    const notifs = ctx.db.prepare("SELECT * FROM notifications WHERE user_id = 'u_tbrooks' AND type = 'reel.like' AND target_id = ?").all(res.body.id) as any[];
    expect(notifs.length).toBe(1);
    expect(notifs[0].actor_count).toBe(2);
    expect(notifs[0].href).toBe(`/reel/${res.body.id}`);
    // one event per FIRST like: the seed may already hold noah's like on reel_0009
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'reel_like' AND user_id = 'u_noahg'")).toBe(already ? 1 : 2);
  });

  it('a view is counted once per viewer; completed flips once; reel_view / reel_complete events', async () => {
    const maya = ctx.as('mayachen');
    const seeded = row<{ completed: number } | undefined>('SELECT completed FROM reel_views WHERE reel_id = ? AND user_id = ?', 'reel_0001', 'u_mayachen');
    const already = seeded ? 1 : 0;
    const alreadyCompleted = seeded?.completed === 1 ? 1 : 0;
    const start = row('SELECT view_count FROM reels WHERE id = ?', 'reel_0001').view_count;
    expect((await maya.post('/api/reels/reel_0001/view').send({})).status).toBe(204);
    expect((await maya.post('/api/reels/reel_0001/view').send({})).status).toBe(204);
    expect((await maya.post('/api/reels/reel_0001/view').send({ completed: true })).status).toBe(204);
    expect((await maya.post('/api/reels/reel_0001/view').send({ completed: true })).status).toBe(204);
    expect(row('SELECT view_count FROM reels WHERE id = ?', 'reel_0001').view_count).toBe(start + (already ? 0 : 1));
    expect(row('SELECT view_count FROM reels WHERE id = ?', 'reel_0001').view_count).toBe(count('SELECT COUNT(*) AS n FROM reel_views WHERE reel_id = ?', 'reel_0001'));
    expect(row('SELECT completed FROM reel_views WHERE reel_id = ? AND user_id = ?', 'reel_0001', 'u_mayachen').completed).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'reel_view' AND user_id = 'u_mayachen'")).toBe(already ? 0 : 1);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'reel_complete' AND user_id = 'u_mayachen'")).toBe(alreadyCompleted ? 0 : 1);
    expect((await maya.post('/api/reels/reel_0001/view').send({ completed: 'yes' })).status).toBe(400);
  });

  it('GET /:id/likers is a public user list (blocked and non-active removed), newest first, paged', async () => {
    const maya = ctx.as('mayachen');
    const res = await maya.get('/api/reels/reel_0009/likers?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(5);
    expect(res.body.nextCursor).not.toBeNull();
    for (const u of res.body.items) {
      expect(u).toHaveProperty('handle');
      expect(u).toHaveProperty('viewer');
      expect(u.viewer.isSelf).toBe(false);
    }
    const second = await maya.get(`/api/reels/reel_0009/likers?limit=5&cursor=${encodeURIComponent(res.body.nextCursor)}`);
    expect(second.status).toBe(200);
    const firstIds = res.body.items.map((u: any) => u.id);
    for (const u of second.body.items) expect(firstIds).not.toContain(u.id);
    // block one liker → gone from the list
    const victim = res.body.items[0].id as string;
    await maya.post(`/api/users/${victim}/block`);
    const again = await maya.get('/api/reels/reel_0009/likers?limit=50');
    expect(again.body.items.map((u: any) => u.id)).not.toContain(victim);
  });

  it('GET /:id/likers filters blocked / non-active likers before the page cut: a page is full whenever a cursor remains', async () => {
    const maya = ctx.as('mayachen');
    const newest = (await maya.get('/api/reels/reel_0009/likers?limit=5')).body.items.map((u: any) => u.id) as string[];
    expect(newest.length).toBe(5);
    for (const id of newest) expect((await maya.post(`/api/users/${id}/block`)).status).toBeLessThan(300);
    const remaining = count(
      `SELECT COUNT(*) AS n FROM reel_likes l JOIN users u ON u.id = l.user_id AND u.status = 'active'
        WHERE l.reel_id = 'reel_0009'
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = 'u_mayachen' AND b.blocked_id = l.user_id) OR (b.blocker_id = l.user_id AND b.blocked_id = 'u_mayachen'))`,
    );
    expect(remaining).toBeGreaterThan(0);
    const page = await maya.get('/api/reels/reel_0009/likers?limit=5');
    expect(page.status).toBe(200);
    expect(page.body.items.length).toBe(Math.min(5, remaining));
    for (const u of page.body.items) expect(newest).not.toContain(u.id);
    if (remaining > 5) expect(page.body.nextCursor).not.toBeNull();
    else expect(page.body.nextCursor).toBeNull();
  });
});

/* ───────────────────────────── blocks + status visibility ───────────────────────────── */

describe('block filter + status visibility', () => {
  it('a block hides reels and comments both ways (feed, detail, grid, following, comments); the author still sees their own', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    // Noah comments on Maya's reel, Maya comments on Noah's
    const c1 = await noah.post('/api/reels/reel_0009/comments').send({ text: 'love this' });
    expect(c1.status).toBe(201);
    const c2 = await maya.post('/api/reels/reel_0001/comments').send({ text: 'so cool' });
    expect(c2.status).toBe(201);
    expect((await maya.get('/api/reels/reel_0009/comments')).body.items.map((c: ReelComment) => c.id)).toContain(c1.body.id);

    expect((await maya.post('/api/users/u_noahg/block')).status).toBe(200);

    // Maya no longer sees Noah's reels anywhere
    for (const url of ['/api/reels/feed?scope=campus&limit=50', '/api/reels/feed?scope=global&limit=50', '/api/reels/following?limit=50']) {
      const res = await maya.get(url);
      expect(res.status).toBe(200);
      for (const r of res.body.items as Reel[]) expect(r.author.id, url).not.toBe('u_noahg');
    }
    expect((await maya.get('/api/reels/reel_0001')).status).toBe(404);
    expect((await maya.get('/api/reels/user/u_noahg')).body.items).toEqual([]);
    expect((await maya.put('/api/reels/reel_0001/like')).status).toBe(404);
    expect((await maya.post('/api/reels/reel_0001/comments').send({ text: 'hi' })).status).toBe(404);
    // Noah's comment on Maya's reel is hidden from Maya
    expect((await maya.get('/api/reels/reel_0009/comments')).body.items.map((c: ReelComment) => c.id)).not.toContain(c1.body.id);

    // and the other way round
    for (const url of ['/api/reels/feed?scope=campus&limit=50', '/api/reels/feed?scope=global&limit=50', '/api/reels/following?limit=50']) {
      const res = await noah.get(url);
      for (const r of res.body.items as Reel[]) expect(r.author.id, url).not.toBe('u_mayachen');
    }
    expect((await noah.get('/api/reels/reel_0009')).status).toBe(404);
    expect((await noah.get('/api/reels/user/u_mayachen')).body.items).toEqual([]);
    expect((await noah.get('/api/reels/reel_0001/comments')).body.items.map((c: ReelComment) => c.id)).not.toContain(c2.body.id);
    // the card degrades too
    expect(resolveCard({ kind: 'reel', id: 'reel_0001' }, 'u_mayachen').status).toBe('unavailable');
    // authors still see their own
    expect((await noah.get('/api/reels/reel_0001')).status).toBe(200);
    expect((await maya.get('/api/reels/reel_0009')).status).toBe(200);
  });

  it('held / hidden / removed reels + comments are invisible to others but visible to the author with their status', async () => {
    const maya = ctx.as('mayachen');
    const ty = ctx.as('tbrooks');
    for (const status of ['held', 'hidden', 'removed'] as const) {
      ctx.db.prepare('UPDATE reels SET status = ? WHERE id = ?').run(status, 'reel_0009');
      const mine = await maya.get('/api/reels/reel_0009');
      expect(mine.status).toBe(200);
      expect(mine.body.status).toBe(status);
      expect((await maya.get('/api/reels/user/u_mayachen?limit=50')).body.items.map((r: Reel) => r.id)).toContain('reel_0009');
      expect((await maya.get('/api/reels/feed?scope=campus&limit=50')).body.items.map((r: Reel) => r.id)).toContain('reel_0009');
      expect((await ty.get('/api/reels/reel_0009')).status).toBe(404);
      expect((await ty.get('/api/reels/user/u_mayachen?limit=50')).body.items.map((r: Reel) => r.id)).not.toContain('reel_0009');
      expect((await ty.get('/api/reels/feed?scope=campus&limit=50')).body.items.map((r: Reel) => r.id)).not.toContain('reel_0009');
      expect((await ty.get('/api/reels/following?limit=50')).body.items.map((r: Reel) => r.id)).not.toContain('reel_0009');
      expect((await ty.put('/api/reels/reel_0009/like')).status).toBe(404);
      expect(resolveCard({ kind: 'reel', id: 'reel_0009' }, 'u_tbrooks').status).toBe('unavailable');
    }
    ctx.db.prepare("UPDATE reels SET status = 'active' WHERE id = ?").run('reel_0009');
    // comments
    const c = await ty.post('/api/reels/reel_0009/comments').send({ text: 'nice one' });
    expect(c.status).toBe(201);
    ctx.db.prepare("UPDATE reel_comments SET status = 'held' WHERE id = ?").run(c.body.id);
    const mine = await ty.get('/api/reels/reel_0009/comments');
    const own = (mine.body.items as ReelComment[]).find((x) => x.id === c.body.id);
    expect(own?.status).toBe('held');
    expect((await maya.get('/api/reels/reel_0009/comments')).body.items.map((x: ReelComment) => x.id)).not.toContain(c.body.id);
  });

  it('content adapters: load snapshots, setStatus keeps public_activity / reel_count / comment_count in sync and drops notifications on removal', async () => {
    const reel = getContentAdapter('reel')!;
    const comment = getContentAdapter('reel_comment')!;
    expect(reel).toBeTruthy();
    expect(comment).toBeTruthy();
    const snap = reel.load('reel_0009')!;
    expect(snap).toMatchObject({ entityType: 'reel', entityId: 'reel_0009', authorId: 'u_mayachen', universityId: 'uni_utexas', status: 'active', surface: 'reel_caption', anon: false, label: 'reel', href: '/reel/reel_0009' });
    expect(snap.media[0]).toEqual({ url: '/seed-media/reels/reel-09.webm', kind: 'video' });
    expect(snap.fields[0].text.length).toBeGreaterThan(0);
    expect(reel.load('nope')).toBeNull();

    const before = row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count;
    reel.setStatus('reel_0009', 'hidden');
    expect(row('SELECT status FROM reels WHERE id = ?', 'reel_0009').status).toBe('hidden');
    expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', 'reel_0009')).toBeUndefined();
    expect(row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count).toBe(before - 1);
    reel.setStatus('reel_0009', 'active', { immune: true });
    expect(row('SELECT status, auto_hide_immune FROM reels WHERE id = ?', 'reel_0009')).toEqual({ status: 'active', auto_hide_immune: 1 });
    expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', 'reel_0009')).toBeTruthy();
    expect(row('SELECT reel_count FROM users WHERE id = ?', 'u_mayachen').reel_count).toBe(before);
    // removal drops the like notification
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'reel' AND target_id = 'reel_0009'")).toBe(1);
    reel.setStatus('reel_0009', 'removed');
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'reel' AND target_id = 'reel_0009'")).toBe(0);
    reel.setStatus('reel_0009', 'active');

    // comment adapter
    const c = await ctx.as('tbrooks').post('/api/reels/reel_0009/comments').send({ text: 'hello there' });
    const cs = comment.load(c.body.id)!;
    expect(cs).toMatchObject({ entityType: 'reel_comment', authorId: 'u_tbrooks', universityId: 'uni_utexas', surface: 'comment', label: 'comment', parent: { entityType: 'reel', entityId: 'reel_0009' } });
    const cc = row('SELECT comment_count FROM reels WHERE id = ?', 'reel_0009').comment_count;
    comment.setStatus(c.body.id, 'hidden');
    expect(row('SELECT comment_count FROM reels WHERE id = ?', 'reel_0009').comment_count).toBe(cc - 1);
    comment.setStatus(c.body.id, 'active');
    expect(row('SELECT comment_count FROM reels WHERE id = ?', 'reel_0009').comment_count).toBe(cc);
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'reel_comment' AND target_id = ?", c.body.id)).toBe(1);
    comment.setStatus(c.body.id, 'removed');
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'reel_comment' AND target_id = ?", c.body.id)).toBe(0);
  });
});

/* ───────────────────────────── moderation ───────────────────────────── */

describe('moderation (§3.1)', () => {
  it('a blocked caption → 422 content_blocked, nothing inserted; a blocked comment likewise; author notices carry no engine internals', async () => {
    const maya = ctx.as('mayachen');
    const up = await uploadVideo(maya, mp4({ durationMs: 10_000 }), 'a.mp4', 'video/mp4');
    const before = count('SELECT COUNT(*) AS n FROM reels');
    const blocked = await maya.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'I am going to kill you', visibility: 'campus' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('content_blocked');
    expect(blocked.body.error.details).toMatchObject({ category: 'threat_violence' });
    assertNoticeHygiene(blocked.body);
    expect(count('SELECT COUNT(*) AS n FROM reels')).toBe(before);
    const bc = await maya.post('/api/reels/reel_0001/comments').send({ text: 'kys loser' });
    expect(bc.status).toBe(422);
    expect(bc.body.error.code).toBe('content_blocked');
    assertNoticeHygiene(bc.body);
    // flagged-but-visible content is active and queued, the author sees a clean notice
    const flagged = await maya.post('/api/reels/reel_0001/comments').send({ text: 'hope you die' });
    expect(flagged.status).toBe(201);
    expect(flagged.body.status).toBe('active');
    expect(flagged.body.moderation.status).toBe('active');
    assertNoticeHygiene(flagged.body);
    expect(row("SELECT 1 AS ok FROM mod_queue WHERE entity_type = 'reel_comment' AND entity_id = ?", flagged.body.id)).toBeTruthy();
  });

  it('a held write (author with ≥ 5 active strike points) is stored as held, invisible to others, visible to the author with the notice', async () => {
    const user = ctx.createUser({ handle: 'strikey' });
    ctx.db.prepare(
      `INSERT INTO strikes (id, user_id, entity_type, entity_id, category, severity, points, action_id, expires_at, created_at) VALUES ('st1', ?, 'reel', 'x', 'harassment_bullying', 'high', 5, 'a1', ?, ?)`,
    ).run(user.id, now() + 30 * DAY, now() - HOUR);
    const agent = ctx.as(user.id);
    const up = await uploadVideo(agent, mp4({ durationMs: 10_000 }), 'a.mp4', 'video/mp4');
    const res = await agent.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'hope you die', visibility: 'campus' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('held');
    expect(res.body.moderation.status).toBe('held');
    expect(res.body.moderation.userMessage).not.toBeNull();
    assertNoticeHygiene(res.body);
    const id = res.body.id as string;
    // held rows never mark public activity
    expect(row('SELECT 1 AS ok FROM public_activity WHERE kind = ? AND entity_id = ?', 'reel', id)).toBeUndefined();
    expect(row('SELECT reel_count FROM users WHERE id = ?', user.id).reel_count).toBe(0);
    expect((await agent.get(`/api/reels/${id}`)).body.status).toBe('held');
    expect((await agent.get(`/api/reels/user/${user.id}`)).body.items[0].status).toBe('held');
    expect((await ctx.as('mayachen').get(`/api/reels/${id}`)).status).toBe(404);
    expect((await ctx.as('mayachen').get(`/api/reels/user/${user.id}`)).body.items).toEqual([]);
    // approval via the adapter makes it public and counted
    getContentAdapter('reel')!.setStatus(id, 'active');
    expect((await ctx.as('mayachen').get(`/api/reels/${id}`)).status).toBe(200);
    expect(row('SELECT reel_count FROM users WHERE id = ?', user.id).reel_count).toBe(1);
    // held comment
    const hc = await agent.post('/api/reels/reel_0001/comments').send({ text: 'hope you die' });
    expect(hc.status).toBe(201);
    expect(hc.body.status).toBe('held');
    const cc = row('SELECT comment_count FROM reels WHERE id = ?', 'reel_0001').comment_count;
    expect(cc).toBe(count("SELECT COUNT(*) AS n FROM reel_comments WHERE reel_id = 'reel_0001' AND status = 'active'"));
    expect((await ctx.as('mayachen').get('/api/reels/reel_0001/comments?limit=50')).body.items.map((c: ReelComment) => c.id)).not.toContain(hc.body.id);
  });

  it('a muted user gets 403 muted on every create route (reel + comment) but can still like / view', async () => {
    const user = ctx.createUser({ handle: 'mutey' });
    ctx.db.prepare(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, starts_at, effective_at, ends_at, created_at) VALUES ('s_mute', ?, 'mute', 'all', ?, ?, ?, ?)`,
    ).run(user.id, now() - HOUR, now() - HOUR, now() + DAY, now() - HOUR);
    const agent = ctx.as(user.id);
    const up = await uploadVideo(agent, mp4({ durationMs: 10_000 }), 'a.mp4', 'video/mp4');
    expect(up.status).toBe(201);
    const post = await agent.post('/api/reels').send({ videoUploadId: up.body.id, caption: 'hi', visibility: 'campus' });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('muted');
    const comment = await agent.post('/api/reels/reel_0001/comments').send({ text: 'hi' });
    expect(comment.status).toBe(403);
    expect(comment.body.error.code).toBe('muted');
    expect((await agent.put('/api/reels/reel_0001/like')).status).toBe(200);
    expect((await agent.post('/api/reels/reel_0001/view').send({})).status).toBe(204);
  });
});

/* ───────────────────────────── comments ───────────────────────────── */

describe('comments', () => {
  it('create → notify the reel author; reply (one level) → notify the parent author; list newest-first with 2 previewed replies; replies oldest-first', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    const ty = ctx.as('tbrooks');
    const { res } = await postReel(maya, { caption: 'comment on me' });
    const id = res.body.id as string;
    const c1 = await noah.post(`/api/reels/${id}/comments`).send({ text: 'first!' });
    expect(c1.status).toBe(201);
    expect(c1.body).toMatchObject({ reelId: id, parentId: null, text: 'first!', likeCount: 0, replyCount: 0, replies: [], viewer: { liked: false, isSelf: true }, status: 'active' });
    expect(c1.body.author.handle).toBe('noahg');
    assertNoticeHygiene(c1.body);
    const n1 = ctx.db.prepare("SELECT * FROM notifications WHERE user_id = 'u_mayachen' AND type = 'reel.comment' AND target_id = ?").all(c1.body.id) as any[];
    expect(n1.length).toBe(1);
    expect(n1[0].href).toBe(`/reel/${id}?comments=1`);
    expect(JSON.parse(n1[0].data_json)).toEqual({ snippet: 'first!', commentId: c1.body.id });

    // replies: three of them, from tbrooks / maya / tbrooks
    const r1 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'r1', parentId: c1.body.id });
    const r2 = await maya.post(`/api/reels/${id}/comments`).send({ text: 'r2', parentId: c1.body.id });
    const r3 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'r3', parentId: c1.body.id });
    for (const r of [r1, r2, r3]) expect(r.status).toBe(201);
    // parent author (noah) gets reel.comment_reply; reel author (maya) gets reel.comment for others' replies, never for her own
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_noahg' AND type = 'reel.comment_reply'")).toBe(3);
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_mayachen' AND type = 'reel.comment' AND target_id IN (?,?,?)", r1.body.id, r2.body.id, r3.body.id)).toBe(2);
    // no second level
    expect((await ty.post(`/api/reels/${id}/comments`).send({ text: 'deep', parentId: r1.body.id })).status).toBe(400);
    // parent must be on the same reel
    expect((await ty.post('/api/reels/reel_0001/comments').send({ text: 'x', parentId: c1.body.id })).status).toBe(400);
    expect((await ty.post(`/api/reels/${id}/comments`).send({ text: 'x', parentId: 'nope' })).status).toBe(404);

    const c2 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'second' });
    expect(row('SELECT comment_count FROM reels WHERE id = ?', id).comment_count).toBe(5);
    expect(row('SELECT reply_count FROM reel_comments WHERE id = ?', c1.body.id).reply_count).toBe(3);

    const list = await maya.get(`/api/reels/${id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: ReelComment) => c.id)).toEqual([c2.body.id, c1.body.id]);
    const top = list.body.items[1] as ReelComment;
    expect(top.replyCount).toBe(3);
    expect(top.replies.map((r) => r.text)).toEqual(['r1', 'r2']);
    expect(top.replies[1]!.viewer.isSelf).toBe(true);
    const replies = await maya.get(`/api/reels/comments/${c1.body.id}/replies`);
    expect(replies.body.items.map((r: ReelComment) => r.text)).toEqual(['r1', 'r2', 'r3']);
    expect(replies.body.items.every((r: ReelComment) => r.replies.length === 0)).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'reel_comment'")).toBe(5);
  });

  it('delete: own comment, or any comment on your own reel (404 otherwise); replies go with a deleted parent; counters + notifications follow', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    const ty = ctx.as('tbrooks');
    const { res } = await postReel(maya);
    const id = res.body.id as string;
    const c1 = await noah.post(`/api/reels/${id}/comments`).send({ text: 'parent' });
    const r1 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'child', parentId: c1.body.id });
    const c2 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'other' });
    expect(row('SELECT comment_count FROM reels WHERE id = ?', id).comment_count).toBe(3);
    // tbrooks cannot delete noah's comment
    expect((await ty.delete(`/api/reels/comments/${c1.body.id}`)).status).toBe(404);
    // tbrooks deletes their own reply
    expect((await ty.delete(`/api/reels/comments/${r1.body.id}`)).status).toBe(204);
    expect(row('SELECT reply_count FROM reel_comments WHERE id = ?', c1.body.id).reply_count).toBe(0);
    expect(row('SELECT comment_count FROM reels WHERE id = ?', id).comment_count).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'reel_comment' AND target_id = ?", r1.body.id)).toBe(0);
    // reel author deletes noah's comment (with a fresh reply under it)
    const r2 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'child 2', parentId: c1.body.id });
    expect((await maya.delete(`/api/reels/comments/${c1.body.id}`)).status).toBe(204);
    expect(row('SELECT status FROM reel_comments WHERE id = ?', r2.body.id).status).toBe('deleted');
    expect(row('SELECT comment_count FROM reels WHERE id = ?', id).comment_count).toBe(1);
    expect((await maya.get(`/api/reels/${id}/comments`)).body.items.map((c: ReelComment) => c.id)).toEqual([c2.body.id]);
    expect((await maya.delete(`/api/reels/comments/${c1.body.id}`)).status).toBe(404);
    expect((await maya.delete('/api/reels/comments/nope')).status).toBe(404);
  });

  it('hiding a top-level comment takes its active replies out of comment_count (unreachable), restoring brings them back; no double subtraction on delete', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    const ty = ctx.as('tbrooks');
    const adapter = getContentAdapter('reel_comment')!;
    const { res } = await postReel(maya);
    const id = res.body.id as string;
    const cc = () => row('SELECT comment_count FROM reels WHERE id = ?', id).comment_count as number;
    const rc = () => row('SELECT reply_count FROM reel_comments WHERE id = ?', parent.body.id).reply_count as number;
    const parent = await noah.post(`/api/reels/${id}/comments`).send({ text: 'parent' });
    const r1 = await ty.post(`/api/reels/${id}/comments`).send({ text: 'r1', parentId: parent.body.id });
    await maya.post(`/api/reels/${id}/comments`).send({ text: 'r2', parentId: parent.body.id });
    const other = await ty.post(`/api/reels/${id}/comments`).send({ text: 'other' });
    expect(cc()).toBe(4);

    adapter.setStatus(parent.body.id, 'hidden');
    expect(cc()).toBe(1);
    // what the public can reach agrees with the title count
    expect((await ty.get(`/api/reels/${id}/comments`)).body.items.map((c: ReelComment) => c.id)).toEqual([other.body.id]);
    expect((await ty.get(`/api/reels/${id}`)).body.commentCount).toBe(1);
    // a reply changing under a hidden parent moves reply_count only
    adapter.setStatus(r1.body.id, 'hidden');
    expect(cc()).toBe(1);
    expect(rc()).toBe(1);
    // the parent's author can still reply to their own hidden comment; it is not counted until the parent is back
    expect((await noah.post(`/api/reels/${id}/comments`).send({ text: 'r3', parentId: parent.body.id })).status).toBe(201);
    expect(cc()).toBe(1);
    expect(rc()).toBe(2);

    adapter.setStatus(parent.body.id, 'active');
    expect(cc()).toBe(4); // parent + r2 + r3 + other
    adapter.setStatus(r1.body.id, 'active');
    expect(cc()).toBe(5);
    expect(rc()).toBe(3);

    // deleting a hidden parent (with active replies) subtracts nothing a second time
    adapter.setStatus(parent.body.id, 'hidden');
    expect(cc()).toBe(1);
    expect((await maya.delete(`/api/reels/comments/${parent.body.id}`)).status).toBe(204);
    expect(cc()).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM reel_comments WHERE parent_id = ? AND status != 'deleted'", parent.body.id)).toBe(0);
  });

  it('comment likes are idempotent and counted', async () => {
    const maya = ctx.as('mayachen');
    const noah = ctx.as('noahg');
    const c = await noah.post('/api/reels/reel_0009/comments').send({ text: 'like me' });
    const a = await maya.put(`/api/reels/comments/${c.body.id}/like`);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ liked: true, likeCount: 1 });
    expect((await maya.put(`/api/reels/comments/${c.body.id}/like`)).body).toEqual({ liked: true, likeCount: 1 });
    const list = await maya.get('/api/reels/reel_0009/comments');
    expect((list.body.items as ReelComment[]).find((x) => x.id === c.body.id)!.viewer.liked).toBe(true);
    expect((await maya.delete(`/api/reels/comments/${c.body.id}/like`)).body).toEqual({ liked: false, likeCount: 0 });
    expect((await maya.put('/api/reels/comments/nope/like')).status).toBe(404);
  });
});

/* ───────────────────────────── following rail ───────────────────────────── */

describe('GET /following (rail)', () => {
  it('returns only reels from accounts the viewer follows, from the last 7 days, newest first', async () => {
    const maya = ctx.as('mayachen');
    const res = await maya.get('/api/reels/following?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const follows = new Set((ctx.db.prepare("SELECT followee_id AS id FROM follows WHERE follower_id = 'u_mayachen'").all() as { id: string }[]).map((r) => r.id));
    const weekAgo = now() - 7 * DAY;
    for (const r of res.body.items as Reel[]) {
      expect(follows.has(r.author.id), r.author.handle).toBe(true);
      expect(r.author.id).not.toBe('u_mayachen');
      expect(r.createdAt).toBeGreaterThan(weekAgo);
      expect(r.viewer.isFollowingAuthor).toBe(true);
    }
    const ts = (res.body.items as Reel[]).map((r) => r.createdAt);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    // someone who follows nobody gets an empty rail; a fresh follow puts the reel in
    const loner = ctx.createUser();
    const agent = ctx.as(loner.id);
    expect((await agent.get('/api/reels/following')).body).toEqual({ items: [], nextCursor: null });
    await agent.post('/api/users/u_mayachen/follow');
    const after = await agent.get('/api/reels/following?limit=50');
    expect((after.body.items as Reel[]).every((r) => r.author.id === 'u_mayachen')).toBe(true);
    expect(after.body.items.length).toBe(2);
    // an old reel drops out of the window
    ctx.db.prepare('UPDATE reels SET created_at = ? WHERE id = ?').run(now() - 8 * DAY, 'reel_0009');
    expect((await agent.get('/api/reels/following?limit=50')).body.items.map((r: Reel) => r.id)).toEqual(['reel_0010']);
  });
});
