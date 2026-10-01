/**
 * Buzz upgrade (Oct 2026): Campus and Global as separate feeds, keyword search, optional titles, photos and one video.
 * Every response still goes through the firewall (no forbidden key, no seeded identity string), media never carries
 * location / device metadata, and a file attached to a buzz can never be reused on a public surface.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Buzz, BuzzThread } from '@shared/buzz';
import { LIMITS } from '@shared/core';
import { getContentAdapter } from '../src/lib/content';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, overrideConfig, type TestCtx } from '../src/lib/testing';

type Agent = ReturnType<TestCtx['as']>;

let ctx: TestCtx;
let identities: string[];
let tmpRoot: string;
let restore: () => void;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-buzz-media-'));
  restore = overrideConfig({ uploadsDir: path.join(tmpRoot, 'uploads') });
  ctx = await createTestApp({ slices: ['buzz', 'orbit'] });
  identities = ctx.seededIdentityStrings();
});
afterEach(() => {
  restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function firewall(body: unknown): void {
  assertNoForbiddenKeys(body);
  assertNoIdentityLeak(body, identities);
}

function user(universityId = 'uni_utexas'): Agent {
  return ctx.as(ctx.createUser({ universityId }).id);
}

const uniq = (() => {
  let n = 0;
  return (s: string): string => `${s} ${++n}${Math.random().toString(36).slice(2, 6)}`;
})();

async function post(api: Agent, body: Record<string, unknown>): Promise<Buzz> {
  const res = await api.post('/api/buzz').send(body);
  if (res.status !== 201) throw new Error(`POST /buzz → ${res.status} ${JSON.stringify(res.body)}`);
  firewall(res.body);
  return res.body as Buzz;
}

async function feed(api: Agent, query: Record<string, string>): Promise<Buzz[]> {
  const res = await api.get('/api/buzz/feed').query({ sort: 'new', limit: 50, ...query });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  firewall(res.body);
  return res.body.items as Buzz[];
}

/* ───────────── synthetic media ───────────── */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}
const GPS = '+30.2849-097.7341/';
const DEVICE = 'iPhone 15 Pro';
/** A phone-style recording: moov at the end with mvhd (creation time set), a track, udta ©xyz (GPS) and meta (device). */
function phoneMp4(durationMs = 12_000): Buffer {
  const created = u32(0xe1c0ffee);
  const mvhd = box('mvhd', Buffer.from([0, 0, 0, 0]), created, created, u32(1000), u32(durationMs), Buffer.alloc(80));
  const tkhd = box('tkhd', Buffer.from([0, 0, 0, 0]), created, created, Buffer.alloc(72));
  const mdhd = box('mdhd', Buffer.from([0, 0, 0, 0]), created, created, u32(1000), u32(durationMs), Buffer.alloc(4));
  const udta = box('udta', box('©xyz', Buffer.from(GPS, 'latin1')));
  const meta = box('meta', Buffer.alloc(4), box('ilst', Buffer.from(`com.apple.quicktime.model=${DEVICE}`, 'latin1')));
  const trak = box('trak', tkhd, box('mdia', mdhd), box('udta', Buffer.from(GPS, 'latin1')));
  const moov = box('moov', mvhd, trak, udta, meta);
  const ftyp = box('ftyp', Buffer.from('qt  ', 'latin1'), u32(0), Buffer.from('qt  ', 'latin1'));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(400, 7)), moov]);
}

function jseg(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}
function jpegWithGps(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jseg(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
    jseg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(`GPS=${GPS};Model=${DEVICE}`, 'latin1')])),
    jseg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    jseg(0xc0, Buffer.from([8, 0, 2, 0, 3, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])),
    jseg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function uploadImage(api: Agent): Promise<{ id: string; url: string }> {
  const res = await api.post('/api/uploads').field('kind', 'image').field('width', '3').field('height', '2').attach('file', jpegWithGps(), { filename: 'IMG_0001.jpg', contentType: 'image/jpeg' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; url: string };
}

async function uploadVideo(api: Agent): Promise<{ id: string; url: string }> {
  const res = await api
    .post('/api/uploads')
    .field('kind', 'video').field('width', '1080').field('height', '1920').field('durationMs', '12000')
    .attach('file', phoneMp4(), { filename: 'IMG_0002.MOV', contentType: 'video/quicktime' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; url: string };
}

function onDisk(url: string): Buffer {
  return fs.readFileSync(path.join(tmpRoot, 'uploads', path.basename(url)));
}

/* ───────────── campus vs global ───────────── */

describe('campus and global are separate feeds', () => {
  it('a campus buzz shows only in its campus feed; a global buzz shows only in the global feed (for every campus)', async () => {
    const author = user();
    const sameCampus = user();
    const otherCampus = user('uni_umich');
    const campus = await post(author, { text: uniq('campus only') });
    const global = await post(author, { text: uniq('global only'), scope: 'global' });
    expect(campus.scope).toBe('campus');
    expect(global.scope).toBe('global');

    for (const sort of ['hot', 'new', 'top']) {
      const q = { sort, window: 'all' };
      const mineCampus = (await feed(sameCampus, { ...q, scope: 'campus' })).map((b) => b.id);
      const mineGlobal = (await feed(sameCampus, { ...q, scope: 'global' })).map((b) => b.id);
      const otherCampusFeed = (await feed(otherCampus, { ...q, scope: 'campus' })).map((b) => b.id);
      const otherGlobal = (await feed(otherCampus, { ...q, scope: 'global' })).map((b) => b.id);
      expect(mineCampus, sort).toContain(campus.id);
      expect(mineCampus, sort).not.toContain(global.id);
      expect(mineGlobal, sort).toContain(global.id);
      expect(mineGlobal, sort).not.toContain(campus.id);
      expect(otherCampusFeed, sort).not.toContain(campus.id);
      expect(otherCampusFeed, sort).not.toContain(global.id);
      expect(otherGlobal, sort).toContain(global.id);
      expect(otherGlobal, sort).not.toContain(campus.id);
    }
    // every served item carries the feed it belongs to
    for (const scope of ['campus', 'global'] as const) for (const b of await feed(sameCampus, { scope })) expect(b.scope).toBe(scope);
  });

  it('rejects an unknown scope', async () => {
    expect((await user().post('/api/buzz').send({ text: 'x', scope: 'everywhere' })).status).toBe(400);
  });
});

/* ───────────── search ───────────── */

describe('search', () => {
  it('matches every word against the title and the body, case-insensitively, within the chosen feed only', async () => {
    const author = user();
    const viewer = user();
    const tag = uniq('zq').replace(/\s+/g, '');
    const a = await post(author, { title: `Dining hall ${tag}`, text: 'The tacos are back on Tuesdays.' });
    const b = await post(author, { text: `Is the ${tag} dining plan worth it? Food is fine.` });
    const c = await post(author, { text: `${tag} parking is a nightmare` });
    const g = await post(author, { text: `${tag} dining abroad`, scope: 'global' });

    const ids = async (q: string, scope = 'campus'): Promise<string[]> => (await feed(viewer, { q, scope })).map((x) => x.id);
    expect(await ids(`${tag} dining`)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(await ids(`${tag} dining`)).not.toContain(c.id);
    expect(await ids(`${tag} DINING`)).not.toContain(g.id); // global buzz stays out of campus search
    expect(await ids(`${tag} tacos`)).toEqual([a.id]); // body of a titled buzz
    expect(await ids(`${tag} parking`)).toEqual([c.id]);
    expect(await ids(`${tag} dining`, 'global')).toEqual([g.id]);
    expect(await ids(`${tag} pizza`)).toEqual([]);
  });

  it('treats LIKE wildcards literally and returns nothing for a query with nothing searchable in it', async () => {
    const author = user();
    await post(author, { text: uniq('100% sure about this') });
    for (const q of ['%', '%%', '_', '_%_', 'a', '  ']) {
      const items = await feed(author, { q, scope: 'campus' });
      if (q.trim() === '') expect(items.length).toBeGreaterThan(0); // blank = the normal feed
      else expect(items, q).toEqual([]);
    }
    expect((await author.get('/api/buzz/feed').query({ q: 'x'.repeat(LIMITS.buzzSearch + 1) })).status).toBe(400);
  });

  it('never surfaces another viewer\'s held / hidden buzz through its words', async () => {
    const author = user();
    const viewer = user();
    const tag = uniq('qv').replace(/\s+/g, '');
    const hidden = await post(author, { text: `${tag} secret words` });
    ctx.db.prepare("UPDATE buzz_posts SET status = 'hidden' WHERE id = ?").run(hidden.id);
    expect((await feed(viewer, { q: `${tag} secret` })).map((b) => b.id)).not.toContain(hidden.id);
  });
});

/* ───────────── titles ───────────── */

describe('titles', () => {
  it('a buzz may be a title alone; neither title nor text → 400; the title is capped and moderated as a title field', async () => {
    const api = user();
    const t = await post(api, { title: uniq('Just a headline') });
    expect(t.title).toMatch(/^Just a headline/);
    expect(t.text).toBe('');
    expect((await api.post('/api/buzz').send({ title: '   ', text: '  ' })).status).toBe(400);
    expect((await api.post('/api/buzz').send({})).status).toBe(400);
    expect((await api.post('/api/buzz').send({ title: 'x'.repeat(LIMITS.buzzTitle + 1), text: 'ok' })).status).toBe(400);
    const snap = getContentAdapter('buzz')!.load(t.id)!;
    expect(snap.fields.find((f) => f.field === 'title')?.text).toBe(t.title);
  });

  it('a placeholder (hidden for other viewers) carries no title and no media', async () => {
    const author = user();
    const viewer = user();
    const img = await uploadImage(author);
    const b = await post(author, { title: uniq('Title to hide'), text: 'body', images: [img.url] });
    ctx.db.prepare("UPDATE buzz_posts SET status = 'hidden' WHERE id = ?").run(b.id);
    const other = (await viewer.get(`/api/buzz/${b.id}`)).body as BuzzThread;
    firewall(other);
    expect(other.root).toMatchObject({ status: 'hidden', text: '', title: '', media: [] });
    const own = (await author.get(`/api/buzz/${b.id}`)).body as BuzzThread;
    expect(own.root.title).toBe(b.title);
    expect(own.root.media).toHaveLength(1);
  });
});

/* ───────────── media ───────────── */

describe('media', () => {
  it('photos: stored without EXIF / GPS, served field by field, claimed for Buzz and never reusable on a public surface', async () => {
    const author = user();
    const img = await uploadImage(author);
    expect(onDisk(img.url).toString('latin1')).not.toContain(GPS);
    const b = await post(author, { text: uniq('look at this'), images: [img.url] });
    expect(b.media).toEqual([{ type: 'image', url: img.url, width: expect.anything(), height: expect.anything(), durationMs: null }]);
    expect(Object.keys(b.media[0]!).sort()).toEqual(['durationMs', 'height', 'type', 'url', 'width']);
    expect((ctx.db.prepare('SELECT purpose FROM uploads WHERE id = ?').get(img.id) as { purpose: string }).purpose).toBe('buzz');

    // the same file can't be attached to a public Orbit post (that would sign the buzz)
    const orbit = await author.post('/api/orbit/posts').send({ text: 'public', images: [{ url: img.url, width: 3, height: 2 }] });
    expect(orbit.status).toBe(404);
    // nor to another buzz by someone else
    expect((await user().post('/api/buzz').send({ text: 'stolen', images: [img.url] })).status).toBe(404);
  });

  it('limits: up to 4 photos, or one video, never both', async () => {
    const author = user();
    const imgs = [];
    for (let i = 0; i < 5; i++) imgs.push((await uploadImage(author)).url);
    expect((await author.post('/api/buzz').send({ text: 'five', images: imgs })).status).toBe(400);
    const four = await post(author, { text: uniq('four'), images: imgs.slice(0, 4) });
    expect(four.media).toHaveLength(4);
    const video = await uploadVideo(author);
    expect((await author.post('/api/buzz').send({ text: 'both', images: [imgs[4]], video: video.url })).status).toBe(400);
  });

  it('video: location, device and recording time are scrubbed in place; the file still has its structure and duration', async () => {
    const author = user();
    const up = await uploadVideo(author);
    const before = onDisk(up.url);
    expect(before.toString('latin1')).toContain(GPS);
    const b = await post(author, { text: uniq('watch this'), video: up.url, scope: 'global' });
    expect(b.media).toEqual([{ type: 'video', url: up.url, width: 1080, height: 1920, durationMs: 12_000 }]);
    const after = onDisk(up.url);
    expect(after.length).toBe(before.length); // no size / offset changed
    const s = after.toString('latin1');
    expect(s).toContain('moov');
    expect(s).toContain('mvhd');
    expect(s).not.toMatch(/udta|meta/);
    // creation / modification times zeroed in mvhd, tkhd, mdhd
    for (const t of ['mvhd', 'tkhd', 'mdhd']) {
      const at = after.indexOf(Buffer.from(t, 'latin1'));
      expect(after.readUInt32BE(at + 8), t).toBe(0);
      expect(after.readUInt32BE(at + 12), t).toBe(0);
    }
    // the bytes themselves are gone, not just hidden behind a renamed box
    expect(s).not.toContain(GPS);
    expect(s).not.toContain(DEVICE);
    const viewer = user('uni_umich');
    const seen = (await feed(viewer, { scope: 'global' })).find((x) => x.id === b.id);
    expect(seen?.media[0]?.type).toBe('video');
  });

  it('someone else\'s upload, an unknown url and an image passed as a video are all 404', async () => {
    const author = user();
    const other = user();
    const theirs = await uploadImage(other);
    const mine = await uploadImage(author);
    expect((await author.post('/api/buzz').send({ text: 'x', images: [theirs.url] })).status).toBe(404);
    expect((await author.post('/api/buzz').send({ text: 'x', images: ['/uploads/nope.jpg'] })).status).toBe(404);
    expect((await author.post('/api/buzz').send({ text: 'x', video: mine.url })).status).toBe(404);
  });
});
