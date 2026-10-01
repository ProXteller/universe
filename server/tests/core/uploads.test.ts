/**
 * Uploads (SPEC §4.2.12, §4.3 #29, safety §7.6): sanitising (JPEG APP1/COM, PNG tEXt, WebP EXIF/XMP + VP8X flags),
 * magic bytes vs declared MIME, per-kind limits, avatar before onboarding, video disk storage, the MP4 / QuickTime /
 * WebM duration probe (incl. `moov` at the END and 64-bit box sizes), and the single 60 500 ms tolerance.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/core';
import { config } from '../../src/config';
import { probeVideoDurationMs, sanitiseImage, sniffMagic, VIDEO_MAX_MS } from '../../src/lib/uploads';
import { createTestApp, overrideConfig, type TestCtx } from '../../src/lib/testing';

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
function bigBox(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(16 + body.length));
  return Buffer.concat([u32(1), Buffer.from(type, 'latin1'), size, body]);
}
function mvhd(durationMs: number, version: 0 | 1 = 0, timescale = 1000): Buffer {
  const units = Math.round((durationMs / 1000) * timescale);
  if (version === 0) {
    return box('mvhd', Buffer.from([0, 0, 0, 0]), u32(0), u32(0), u32(timescale), u32(units), Buffer.alloc(80));
  }
  const dur = Buffer.alloc(8);
  dur.writeBigUInt64BE(BigInt(units));
  return box('mvhd', Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(timescale), dur, Buffer.alloc(80));
}
function mp4(o: { durationMs: number; brand?: string; moovFirst?: boolean; version?: 0 | 1; bigMdat?: boolean; timescale?: number }): Buffer {
  const ftyp = box('ftyp', Buffer.from(o.brand ?? 'isom', 'latin1'), u32(0x200), Buffer.from('isomiso2mp41', 'latin1'));
  const mdat = o.bigMdat ? bigBox('mdat', Buffer.alloc(300)) : box('mdat', Buffer.alloc(300));
  const moov = box('moov', mvhd(o.durationMs, o.version ?? 0, o.timescale ?? 1000), box('trak', box('tkhd', Buffer.alloc(84))));
  return Buffer.concat(o.moovFirst ? [ftyp, moov, mdat] : [ftyp, box('free', Buffer.alloc(8)), mdat, moov]);
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
function webm(o: { durationMs: number; timecodeScale?: number; floatSize?: 4 | 8; unknownSegment?: boolean; noDuration?: boolean }): Buffer {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    el([0x42, 0x86], Buffer.from([1])), el([0x42, 0xf7], Buffer.from([1])), el([0x42, 0xf2], Buffer.from([4])), el([0x42, 0xf3], Buffer.from([8])),
    el([0x42, 0x82], Buffer.from('webm', 'latin1')), el([0x42, 0x87], Buffer.from([2])), el([0x42, 0x85], Buffer.from([2])),
  ]));
  const scale = o.timecodeScale ?? 1_000_000;
  const scaleBuf = Buffer.from([(scale >> 16) & 0xff, (scale >> 8) & 0xff, scale & 0xff]);
  const durNs = o.durationMs * 1_000_000;
  const dur = Buffer.alloc(o.floatSize ?? 8);
  if ((o.floatSize ?? 8) === 8) dur.writeDoubleBE(durNs / scale);
  else dur.writeFloatBE(durNs / scale);
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    el([0x2a, 0xd7, 0xb1], scaleBuf), el([0x4d, 0x80], Buffer.from('test', 'latin1')),
    ...(o.noDuration ? [] : [el([0x44, 0x89], dur)]), el([0x57, 0x41], Buffer.from('test', 'latin1')),
  ]));
  const seekHead = el([0x11, 0x4d, 0x9b, 0x74], el([0xec], Buffer.alloc(6)));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.alloc(20));
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([el([0xe7], Buffer.from([0])), Buffer.alloc(64)]));
  const segBody = Buffer.concat([seekHead, info, tracks, cluster]);
  const segment = o.unknownSegment
    ? Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67]), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), segBody])
    : el([0x18, 0x53, 0x80, 0x67], segBody);
  return Buffer.concat([header, segment]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}
function jpeg(): Buffer {
  const app0 = jpegSegment(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
  const exif = jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPSLatitude=30.28', 'latin1')]));
  const icc = jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), Buffer.alloc(16, 7)]));
  const xmp = jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp>secret</xmp>', 'latin1'));
  const com = jpegSegment(0xfe, Buffer.from('shot on my phone at home', 'latin1'));
  const dqt = jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]));
  const sof = jpegSegment(0xc0, Buffer.from([8, 0, 2, 0, 3, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]));
  const sos = jpegSegment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]));
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, exif, icc, xmp, com, dqt, sof, sos, scan, Buffer.from([0xff, 0xd9])]);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), td, u32(crc32(td))]);
}
function png(): Buffer {
  const ihdr = Buffer.concat([u32(3), u32(2), Buffer.from([8, 2, 0, 0, 0])]);
  const raw = Buffer.concat([Buffer.from([0]), Buffer.alloc(9, 0x80), Buffer.from([0]), Buffer.alloc(9, 0x40)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('tEXt', Buffer.from('Comment\0taken at home', 'latin1')),
    pngChunk('eXIf', Buffer.alloc(12, 1)), pngChunk('tIME', Buffer.alloc(7)), pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x/>', 'latin1')), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function riffChunk(fourcc: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(fourcc, 'latin1'), len, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webp(): Buffer {
  const vp8x = Buffer.from([0x0c | 0x10, 0, 0, 0, 2, 0, 0, 1, 0, 0]); // EXIF + XMP + alpha flags, 3×2
  const vp8l = Buffer.concat([Buffer.from([0x2f]), Buffer.from([0x02, 0x40, 0x00, 0x10]), Buffer.alloc(6)]);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x), riffChunk('EXIF', Buffer.from('MM\0*gps here', 'latin1')), riffChunk('VP8L', vp8l),
    riffChunk('XMP ', Buffer.from('<xmp>secret</xmp>', 'latin1')),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + body.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, Buffer.from('WEBP', 'latin1'), body]);
}

/* ───────────────────────────── unit: sniff · sanitise · probe ───────────────────────────── */

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-uploads-'));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Leftovers under `uploadsDir/tmp` (the dir may not exist yet when only images were uploaded). */
function tmpFiles(): string[] {
  const dir = path.join(tmpRoot, 'uploads', 'tmp');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function writeTmp(name: string, buf: Buffer): string {
  const p = path.join(tmpRoot, name);
  fs.writeFileSync(p, buf);
  return p;
}

describe('magic bytes', () => {
  it('detects the six containers and rejects the rest', () => {
    expect(sniffMagic(jpeg())).toBe('image/jpeg');
    expect(sniffMagic(png())).toBe('image/png');
    expect(sniffMagic(webp())).toBe('image/webp');
    expect(sniffMagic(mp4({ durationMs: 1000 }))).toBe('video/mp4');
    expect(sniffMagic(mp4({ durationMs: 1000, brand: 'qt  ' }))).toBe('video/quicktime');
    expect(sniffMagic(webm({ durationMs: 1000 }))).toBe('video/webm');
    expect(sniffMagic(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffMagic(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMagic(Buffer.alloc(0))).toBeNull();
  });
});

describe('image sanitising (safety §7.6)', () => {
  it('JPEG: drops APP1 (Exif / XMP) + COM, keeps APP0 + ICC, reads the dimensions', () => {
    const src = jpeg();
    const out = sanitiseImage(src, 'image/jpeg');
    const text = out.buffer.toString('latin1');
    expect(text).not.toContain('GPSLatitude');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('shot on my phone');
    expect(text).toContain('JFIF');
    expect(text).toContain('ICC_PROFILE');
    expect(out.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.buffer.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(out.buffer.length).toBeLessThan(src.length);
    expect(out).toMatchObject({ width: 3, height: 2 });
    expect(sanitiseImage(out.buffer, 'image/jpeg').buffer.equals(out.buffer)).toBe(true); // idempotent
  });

  it('PNG: drops eXIf / tEXt / zTXt / iTXt / tIME, keeps IHDR / IDAT / IEND', () => {
    const out = sanitiseImage(png(), 'image/png');
    const text = out.buffer.toString('latin1');
    for (const gone of ['tEXt', 'eXIf', 'tIME', 'iTXt', 'taken at home', 'adobe']) expect(text).not.toContain(gone);
    for (const kept of ['IHDR', 'IDAT', 'IEND']) expect(text).toContain(kept);
    expect(out).toMatchObject({ width: 3, height: 2 });
  });

  it('WebP: drops EXIF + XMP chunks, clears the VP8X flags, fixes the RIFF size', () => {
    const out = sanitiseImage(webp(), 'image/webp');
    const text = out.buffer.toString('latin1');
    expect(text).not.toContain('EXIF');
    expect(text).not.toContain('XMP ');
    expect(text).not.toContain('secret');
    expect(text).toContain('VP8X');
    expect(text).toContain('VP8L');
    expect(out.buffer.readUInt32LE(4)).toBe(out.buffer.length - 8);
    const flags = out.buffer[20]!; // VP8X payload byte 0
    expect(flags & 0x0c).toBe(0);
    expect(flags & 0x10).toBe(0x10); // alpha flag kept
    expect(out).toMatchObject({ width: 3, height: 2 });
  });

  it('files that do not parse are 415', () => {
    for (const [buf, type] of [
      [Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), 'image/jpeg'],
      [Buffer.concat([jpeg().subarray(0, 40)]), 'image/jpeg'],
      [Buffer.from('\x89PNG\r\n\x1a\nxxxxxxxxxxxxxx', 'latin1'), 'image/png'],
      [png().subarray(0, 30), 'image/png'],
      [Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), 'image/webp'],
    ] as const) {
      let status = 0;
      try {
        sanitiseImage(buf, type);
      } catch (e) {
        status = (e as { status: number }).status;
      }
      expect(status, type).toBe(415);
    }
  });
});

describe('probeVideoDurationMs', () => {
  it('MP4: moov at the end, moov first, mvhd v1, 64-bit mdat, other timescales, QuickTime brand', () => {
    expect(probeVideoDurationMs(writeTmp('a.mp4', mp4({ durationMs: 8000 })), 'video/mp4')).toBe(8000);
    expect(probeVideoDurationMs(writeTmp('b.mp4', mp4({ durationMs: 8000, moovFirst: true })), 'video/mp4')).toBe(8000);
    expect(probeVideoDurationMs(writeTmp('c.mp4', mp4({ durationMs: 61234, version: 1 })), 'video/mp4')).toBe(61234);
    expect(probeVideoDurationMs(writeTmp('d.mp4', mp4({ durationMs: 60500, bigMdat: true })), 'video/mp4')).toBe(60500);
    expect(probeVideoDurationMs(writeTmp('e.mp4', mp4({ durationMs: 30000, timescale: 90000 })), 'video/mp4')).toBe(30000);
    expect(probeVideoDurationMs(writeTmp('f.mov', mp4({ durationMs: 12000, brand: 'qt  ' })), 'video/quicktime')).toBe(12000);
    // truncated / no moov / not a video → null
    expect(probeVideoDurationMs(writeTmp('g.mp4', mp4({ durationMs: 8000 }).subarray(0, 60)), 'video/mp4')).toBeNull();
    expect(probeVideoDurationMs(writeTmp('h.mp4', Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(10))])), 'video/mp4')).toBeNull();
    expect(probeVideoDurationMs(writeTmp('i.mp4', jpeg()), 'video/mp4')).toBeNull();
    expect(probeVideoDurationMs(path.join(tmpRoot, 'missing.mp4'), 'video/mp4')).toBeNull();
  });

  it('WebM: Duration × TimecodeScale, float32 and float64, known and unknown Segment sizes', () => {
    expect(probeVideoDurationMs(writeTmp('a.webm', webm({ durationMs: 8000 })), 'video/webm')).toBe(8000);
    expect(probeVideoDurationMs(writeTmp('b.webm', webm({ durationMs: 8000, unknownSegment: true })), 'video/webm')).toBe(8000);
    expect(probeVideoDurationMs(writeTmp('c.webm', webm({ durationMs: 45000, floatSize: 4 })), 'video/webm')).toBe(45000);
    expect(probeVideoDurationMs(writeTmp('d.webm', webm({ durationMs: 8000, timecodeScale: 500_000 })), 'video/webm')).toBe(8000);
    expect(probeVideoDurationMs(writeTmp('e.webm', webm({ durationMs: 8000, noDuration: true })), 'video/webm')).toBeNull();
    expect(probeVideoDurationMs(writeTmp('f.webm', mp4({ durationMs: 8000 })), 'video/webm')).toBeNull();
  });

  it('the seed reels (when present) probe to a finite duration ≤ 60 s', () => {
    const dir = path.join(config.seedMediaDir, 'reels');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.webm')).slice(0, 3)) {
      const ms = probeVideoDurationMs(path.join(dir, f), 'video/webm');
      expect(ms, f).not.toBeNull();
      expect(ms!).toBeGreaterThan(1000);
      expect(ms!).toBeLessThanOrEqual(LIMITS.reelMaxDurationMs);
    }
  });
});

/* ───────────────────────────── POST /uploads (#29) ───────────────────────────── */

describe('POST /uploads', () => {
  let ctx: TestCtx;
  let restore: () => void;
  beforeEach(async () => {
    restore = overrideConfig({ uploadsDir: path.join(tmpRoot, 'uploads') }); // before createApp binds the static handler
    ctx = await createTestApp({ slices: [] });
  });
  afterEach(() => restore());

  const post = (agent: ReturnType<TestCtx['as']>, file: Buffer, filename: string, contentType: string, fields: Record<string, string>) => {
    let req = agent.post('/api/uploads');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, { filename, contentType });
  };

  it('stores a sanitised image under a nanoid name, never the original filename; serves it with nosniff + inline', async () => {
    const maya = ctx.as('mayachen');
    const res = await post(maya, jpeg(), 'IMG_4021 GPS.jpg', 'image/jpeg', { kind: 'image' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 3, height: 2, durationMs: null });
    expect(res.body.url).toMatch(/^\/uploads\/[A-Za-z0-9_-]{21}\.jpg$/);
    expect(res.body.url).not.toContain('IMG_4021');
    const stored = fs.readFileSync(path.join(tmpRoot, 'uploads', path.basename(res.body.url)));
    expect(stored.toString('latin1')).not.toContain('GPSLatitude');
    expect(res.body.size).toBe(stored.length);
    const row = ctx.db.prepare('SELECT * FROM uploads WHERE id = ?').get(res.body.id) as any;
    expect(row).toMatchObject({ user_id: 'u_mayachen', kind: 'image', purpose: null, mime: 'image/jpeg', url: res.body.url });
    const served = await ctx.anon().get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-disposition']).toBe('inline');
    expect(tmpFiles()).toEqual([]);
    // png + webp too
    expect((await post(maya, png(), 'a.png', 'image/png', { kind: 'image' })).body.mime).toBe('image/png');
    expect((await post(maya, webp(), 'a.webp', 'image/webp', { kind: 'image' })).body.mime).toBe('image/webp');
  });

  it('verifies magic bytes against the declared type (415), rejects unknown kinds (400), needs a file', async () => {
    const maya = ctx.as('mayachen');
    const lie = await post(maya, png(), 'a.jpg', 'image/jpeg', { kind: 'image' });
    expect(lie.status).toBe(415);
    expect(lie.body.error.code).toBe('unsupported_media');
    expect((await post(maya, Buffer.from('GIF89a....'), 'a.gif', 'image/gif', { kind: 'image' })).status).toBe(415);
    expect((await post(maya, Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml', { kind: 'image' })).status).toBe(415);
    expect((await post(maya, mp4({ durationMs: 1000 }), 'a.mp4', 'video/mp4', { kind: 'image' })).status).toBe(415);
    expect((await post(maya, jpeg(), 'a.jpg', 'image/jpeg', { kind: 'video' })).status).toBe(415);
    expect((await post(maya, mp4({ durationMs: 1000 }), 'a.webm', 'video/webm', { kind: 'video' })).status).toBe(415);
    expect((await post(maya, jpeg(), 'a.jpg', 'image/jpeg', { kind: 'gif' })).status).toBe(400);
    expect((await maya.post('/api/uploads').field('kind', 'image')).status).toBe(400);
    expect((await ctx.anon().post('/api/uploads').field('kind', 'image').attach('file', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' })).status).toBe(401);
    expect(tmpFiles()).toEqual([]);
  });

  it('avatar uploads work with a session only; other kinds need onboarding (403 onboarding_required)', async () => {
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL, guidelines_accepted_at = NULL WHERE id = ?').run(fresh.id);
    const agent = ctx.as(fresh.id);
    const avatar = await post(agent, jpeg(), 'me.jpg', 'image/jpeg', { kind: 'avatar' });
    expect(avatar.status, JSON.stringify(avatar.body)).toBe(201);
    expect((ctx.db.prepare('SELECT purpose FROM uploads WHERE id = ?').get(avatar.body.id) as any).purpose).toBe('avatar');
    const image = await post(agent, jpeg(), 'me.jpg', 'image/jpeg', { kind: 'image' });
    expect(image.status).toBe(403);
    expect(image.body.error.code).toBe('onboarding_required');
    // PATCH /me accepts the avatar url (assertOwnUpload)
    const me = await agent.patch('/api/me').send({ avatarUrl: avatar.body.url });
    expect(me.status).toBe(200);
    expect(me.body.avatarUrl).toBe(avatar.body.url);
    // someone else's upload is 404
    const other = await ctx.as('mayachen').patch('/api/me').send({ avatarUrl: avatar.body.url });
    expect(other.status).toBe(404);
  });

  it('videos: disk storage, probe wins over the client value, 60 500 ms accepted, 60 501 ms refused, QuickTime → mp4', async () => {
    const maya = ctx.as('mayachen');
    const ok = await post(maya, mp4({ durationMs: 8000 }), 'clip.mp4', 'video/mp4', { kind: 'video', durationMs: '999999', width: '540', height: '960' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ kind: 'video', mime: 'video/mp4', durationMs: 8000, width: 540, height: 960 });
    expect(ok.body.url).toMatch(/^\/uploads\/[A-Za-z0-9_-]{21}\.mp4$/);
    expect(fs.existsSync(path.join(tmpRoot, 'uploads', path.basename(ok.body.url)))).toBe(true);
    expect(tmpFiles()).toEqual([]);

    const edge = await post(maya, mp4({ durationMs: VIDEO_MAX_MS }), 'edge.mp4', 'video/mp4', { kind: 'video' });
    expect(edge.status).toBe(201);
    expect(edge.body.durationMs).toBe(LIMITS.reelMaxDurationMs); // stored min(duration, 60 000)
    expect((ctx.db.prepare('SELECT duration_ms FROM uploads WHERE id = ?').get(edge.body.id) as any).duration_ms).toBe(60_000);

    const long = await post(maya, mp4({ durationMs: VIDEO_MAX_MS + 1 }), 'long.mp4', 'video/mp4', { kind: 'video' });
    expect(long.status).toBe(422);
    expect(long.body.error).toMatchObject({ code: 'validation_failed', message: 'Reels max out at 60 seconds.' });
    expect(tmpFiles()).toEqual([]); // temp file unlinked on failure

    const mov = await post(maya, mp4({ durationMs: 12000, brand: 'qt  ' }), 'IMG_1.MOV', 'video/quicktime', { kind: 'video' });
    expect(mov.status).toBe(201);
    expect(mov.body).toMatchObject({ mime: 'video/mp4', durationMs: 12000 });
    expect(mov.body.url).toMatch(/\.mp4$/);
    const movDeclaredMp4 = await post(maya, mp4({ durationMs: 5000, brand: 'qt  ' }), 'x.mp4', 'video/mp4', { kind: 'video' });
    expect(movDeclaredMp4.status).toBe(201);

    const wm = await post(maya, webm({ durationMs: 7500 }), 'clip.webm', 'video/webm', { kind: 'video' });
    expect(wm.status).toBe(201);
    expect(wm.body).toMatchObject({ mime: 'video/webm', durationMs: 7500 });
    expect(wm.body.url).toMatch(/\.webm$/);

    // no probe + no client duration → 400; client duration used when the probe fails
    const noDur = webm({ durationMs: 1000, noDuration: true });
    expect((await post(maya, noDur, 'nd.webm', 'video/webm', { kind: 'video' })).status).toBe(400);
    const clientDur = await post(maya, noDur, 'nd.webm', 'video/webm', { kind: 'video', durationMs: '30000' });
    expect(clientDur.status).toBe(201);
    expect(clientDur.body.durationMs).toBe(30000);
    expect((await post(maya, noDur, 'nd.webm', 'video/webm', { kind: 'video', durationMs: String(VIDEO_MAX_MS + 1) })).status).toBe(422);
  });

  it('a video that is not a reel-sized clip and an oversized image are refused with the right codes', async () => {
    const maya = ctx.as('mayachen');
    const big = Buffer.concat([jpeg(), Buffer.alloc(LIMITS.imageMaxBytes)]);
    const res = await post(maya, big, 'big.jpg', 'image/jpeg', { kind: 'image' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });
});
