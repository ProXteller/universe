/**
 * HARDENING — lens: input handling and abuse.
 *
 * Every FAILING test in this file is a confirmed finding (left failing on purpose for the fixer); every passing test is a
 * probe that found nothing and stays as a regression guard. Sections:
 *   A. uploads (path traversal, polyglots, EXIF, MIME mismatch, SVG, oversize, video probe with hostile box sizes)
 *   B. auth (OTP brute force across IPs, resend flooding, signup-token reuse, session fixation, prod cookie flags, STAFF_EMAILS)
 *   C. per-user rate limits on write endpoints
 *   D. SQL construction (static scan + behavioural injection probes) and zod extra-key handling
 *   E. cursor tampering on every paginated endpoint
 *   F. moderation bypass with unicode tricks (real engine, every UGC surface)
 *   G. denial-of-wallet (limit=, analytics payloads)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModerationContext, ModerationSurface } from '@shared/core';
import { SESSION_COOKIE } from '@shared/core';
import { config, parseStaffEmails } from '../../src/config';
import { DAY, HOUR, now, setNow } from '../../src/lib/clock';
import { encodeCursor } from '../../src/lib/http';
import { setMailer } from '../../src/lib/mailer';
import { moderateText } from '../../src/lib/moderation/index';
import { applySanction } from '../../src/lib/moderation/staff';
import { probeVideoDurationMs, sanitiseImage } from '../../src/lib/uploads';
import { isValidEmail } from '../../src/lib/universities';
import { getAuthedUser } from '../../src/lib/users';
import { createTestApp, overrideConfig, type TestCtx } from '../../src/lib/testing';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../src');

function withRateLimits(): () => void {
  const prev = process.env.RATE_LIMITS;
  process.env.RATE_LIMITS = 'on';
  return () => {
    if (prev === undefined) delete process.env.RATE_LIMITS;
    else process.env.RATE_LIMITS = prev;
  };
}

function prefillRate(ctx: TestCtx, userId: string, action: string, n: number): void {
  const at = now();
  const ins = ctx.db.prepare('INSERT INTO rate_events (user_id, action, created_at) VALUES (?,?,?)');
  for (let i = 0; i < n; i++) ins.run(userId, action, at - 1000 - i);
}

/* ═════════════════════════════ synthetic media ═════════════════════════════ */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function jseg(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}
const J_APP0 = jseg(0xe0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
const J_DQT = jseg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]));
const J_SOF = jseg(0xc0, Buffer.from([8, 0, 2, 0, 3, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]));
const J_SOS = jseg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]));
function jpeg(extra: Buffer[] = []): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), J_APP0, ...extra, J_DQT, J_SOF, J_SOS, Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9])]);
}
const EXIF_GPS = jseg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPSLatitude=30.2849;GPSLongitude=-97.7341', 'latin1')]));

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
function png(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.concat([u32(3), u32(2), Buffer.from([8, 2, 0, 0, 0])]);
  const raw = Buffer.concat([Buffer.from([0]), Buffer.alloc(9, 0x80), Buffer.from([0]), Buffer.alloc(9, 0x40)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('eXIf', Buffer.from('MM\0*GPSLatitude=30.28', 'latin1')), ...extra,
    pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
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
const EBML_HEADER = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([el([0x42, 0x82], Buffer.from('webm', 'latin1'))]));
/** Segment of UNKNOWN size (live-recorder style) — its body runs to EOF. */
const SEGMENT_UNKNOWN = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
function webm(durationMs: number): Buffer {
  const dur = Buffer.alloc(8);
  dur.writeDoubleBE(durationMs);
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), el([0x44, 0x89], dur)]));
  return Buffer.concat([EBML_HEADER, el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, el([0x1f, 0x43, 0xb6, 0x75], Buffer.alloc(64))]))]);
}

/* ═════════════════════════════ A. uploads ═════════════════════════════ */

describe('A. uploads', () => {
  let ctx: TestCtx;
  let tmpRoot: string;
  let restore: () => void;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-hard-up-'));
    restore = overrideConfig({ uploadsDir: path.join(tmpRoot, 'uploads') }); // before createApp binds express.static
    ctx = await createTestApp({ slices: [] });
  });
  afterAll(() => {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const upload = (file: Buffer, filename: string, contentType: string, kind = 'image', fields: Record<string, string> = {}) => {
    let req = ctx.as('u_mayachen').post('/api/uploads').field('kind', kind);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, { filename, contentType });
  };
  const served = async (url: string): Promise<Buffer> => {
    const res = await ctx.anon().get(url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    return res.body as Buffer;
  };

  it('[probe] path-traversal filenames are discarded: stored name is random + sniffed extension, nothing escapes uploadsDir', async () => {
    for (const name of ['../../../../evil.html', '..\\..\\evil.png', '/etc/passwd', 'a.png;.html', '%2e%2e%2fevil.png', 'CON', '.htaccess']) {
      const res = await upload(png(), name, 'image/png');
      expect(res.status, name).toBe(201);
      expect(res.body.url).toMatch(/^\/uploads\/[\w-]{21}\.png$/);
      expect(fs.existsSync(path.join(config.uploadsDir, res.body.url.slice('/uploads/'.length)))).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpRoot, 'evil.html'))).toBe(false);
    expect(fs.readdirSync(config.uploadsDir).every((f) => f === 'tmp' || /^[\w-]{21}\.(png|jpg|webp|mp4|webm)$/.test(f))).toBe(true);
  });

  it('[FINDING] a malformed multipart body (NUL byte in the part filename) is a 500 internal + error log instead of a 400', async () => {
    const res = await upload(png(), 'a.png\u0000.html', 'image/png');
    // busboy's "Malformed part header" is not a MulterError, so errorMiddleware treats it as an unknown 500
    expect(res.status).toBe(400);
  });

  it('[probe] SVG / HTML uploads are rejected whatever MIME is declared', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(svg, 'a.svg', 'image/svg+xml')).status).toBe(415);
    expect((await upload(svg, 'a.png', 'image/png')).status).toBe(415);
    expect((await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'a.jpg', 'image/jpeg')).status).toBe(415);
    expect((await upload(Buffer.from('<?xml version="1.0"?><svg/>'), 'a.webp', 'image/webp')).status).toBe(415);
  });

  it('[probe] MIME / extension mismatch is rejected (sniffed type must equal declared type)', async () => {
    expect((await upload(png(), 'a.jpg', 'image/jpeg')).status).toBe(415);
    expect((await upload(jpeg(), 'a.png', 'image/png')).status).toBe(415);
    expect((await upload(webm(1000), 'a.png', 'image/png')).status).toBe(415);
    expect((await upload(png(), 'a.mp4', 'video/mp4', 'video')).status).toBe(415);
    expect((await upload(png(), 'a.png', 'image/png', 'video')).status).toBe(415);
  });

  it('[probe] EXIF / eXIf GPS is stripped from what is actually served (JPEG APP1, PNG eXIf)', async () => {
    const j = await upload(jpeg([EXIF_GPS]), 'a.jpg', 'image/jpeg');
    const p = await upload(png(), 'a.png', 'image/png');
    expect(j.status).toBe(201);
    expect(p.status).toBe(201);
    for (const url of [j.body.url, p.body.url]) {
      const body = await served(url);
      expect(body.toString('latin1')).not.toContain('GPSLatitude');
    }
    const head = await ctx.anon().get(j.body.url);
    expect(head.headers['x-content-type-options']).toBe('nosniff');
    expect(head.headers['content-type']).toBe('image/jpeg');
  });

  it('[FINDING] JPEG sanitiser keeps everything up to the LAST FF D9: an appended EXIF image (MPF / gain map / motion photo) and HTML polyglot payloads survive', async () => {
    // A phone JPEG with a secondary image appended after EOI (MPF preview / Ultra HDR gain map) that carries its own Exif GPS,
    // followed by a polyglot tail. The primary image is clean.
    const secondary = Buffer.concat([Buffer.from([0xff, 0xd8]), EXIF_GPS, J_DQT, J_SOF, J_SOS, Buffer.from([0x55]), Buffer.from([0xff, 0xd9])]);
    const polyglot = Buffer.from('<html><script>alert(document.cookie)</script></html>', 'latin1');
    const src = Buffer.concat([jpeg(), secondary, polyglot, Buffer.from([0xff, 0xd9])]);

    const unit = sanitiseImage(src, 'image/jpeg').buffer.toString('latin1');
    const res = await upload(src, 'phone.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    const body = (await served(res.body.url)).toString('latin1');
    expect({ unitGps: unit.includes('GPSLatitude'), servedGps: body.includes('GPSLatitude'), servedHtml: body.includes('<script>') }).toEqual({
      unitGps: false, servedGps: false, servedHtml: false,
    });
  });

  it('[FINDING] MP4 probe walks an unbounded number of boxes synchronously (200k 8-byte boxes → 200k readSync calls on the event loop)', () => {
    const file = path.join(tmpRoot, 'boxes.mp4');
    const free = Buffer.concat([u32(8), Buffer.from('free', 'latin1')]);
    const ftyp = Buffer.concat([u32(16), Buffer.from('ftypisom', 'latin1'), u32(0)]);
    fs.writeFileSync(file, Buffer.concat([ftyp, Buffer.concat(new Array(200_000).fill(free))]));
    const spy = vi.spyOn(fs, 'readSync');
    const t = Date.now();
    probeVideoDurationMs(file, 'video/mp4');
    const elapsed = Date.now() - t;
    // 150 MB (the video cap) of 8-byte boxes = 19.6 M synchronous reads ≈ 15 s of a frozen server per upload.
    expect({ reads: spy.mock.calls.length, elapsedUnder: elapsed < 1000 }).toEqual({ reads: expect.any(Number), elapsedUnder: true });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(10_000);
  });

  it('[FINDING] WebM probe walks an unbounded number of elements synchronously (100k 2-byte elements in an unknown-size Segment)', () => {
    const file = path.join(tmpRoot, 'elements.webm');
    const tiny = Buffer.alloc(200_000);
    for (let i = 0; i < tiny.length; i += 2) {
      tiny[i] = 0xec; // Void element id
      tiny[i + 1] = 0x80; // size 0
    }
    fs.writeFileSync(file, Buffer.concat([EBML_HEADER, SEGMENT_UNKNOWN, tiny]));
    const spy = vi.spyOn(fs, 'readSync');
    probeVideoDurationMs(file, 'video/webm');
    // measured: 8 MB of these blocks the event loop for ~9 s; 150 MB ≈ 3 minutes per upload.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(10_000);
  });

  it('[FINDING] WebM probe allocates whatever size an element header declares (50-byte file → 1 GiB Buffer.alloc)', () => {
    const file = path.join(tmpRoot, 'alloc.webm');
    const info = Buffer.from([0x15, 0x49, 0xa9, 0x66, 0xff]); // Info, unknown size
    const tcs = Buffer.concat([Buffer.from([0x2a, 0xd7, 0xb1, 0x01, 0, 0, 0, 0x40, 0, 0, 0]), Buffer.alloc(16)]); // TimecodeScale, size = 1 GiB
    fs.writeFileSync(file, Buffer.concat([EBML_HEADER, SEGMENT_UNKNOWN, info, tcs]));
    const orig = Buffer.alloc.bind(Buffer);
    let largest = 0;
    vi.spyOn(Buffer, 'alloc').mockImplementation(((size: number, ...rest: unknown[]) => {
      largest = Math.max(largest, size);
      if (size > 64 * 1024 * 1024) throw new RangeError(`test refused a ${size}-byte allocation`);
      return (orig as (...a: unknown[]) => Buffer)(size, ...rest);
    }) as typeof Buffer.alloc);
    probeVideoDurationMs(file, 'video/webm');
    expect(largest).toBeLessThanOrEqual(1024 * 1024);
  });

  it('[FINDING] upload rate limit (and the onboarding gate) run only AFTER multer has streamed the whole video to disk', async () => {
    const restoreRl = withRateLimits();
    try {
      prefillRate(ctx, 'u_mayachen', 'upload', 60); // the 60/h window is full
      const spy = vi.spyOn(fs, 'createWriteStream');
      const big = Buffer.concat([webm(1000), Buffer.alloc(3 * 1024 * 1024)]);
      const res = await upload(big, 'clip.webm', 'video/webm', 'video', { durationMs: '1000' });
      expect(res.status).toBe(429);
      // a rate-limited account can still make the server write up to LIMITS.videoMaxBytes (150 MB) per request
      expect(spy).not.toHaveBeenCalled();
    } finally {
      restoreRl();
      ctx.db.prepare("DELETE FROM rate_events WHERE action = 'upload'").run();
    }
  });

  it('[probe] oversized bodies: image > 8 MB → 413, JSON > 1 MB → 413, nothing left in uploads/tmp', async () => {
    const huge = Buffer.concat([png(), Buffer.alloc(8 * 1024 * 1024 + 10)]);
    expect((await upload(huge, 'a.png', 'image/png')).status).toBe(413);
    const res = await ctx.as('u_mayachen').patch('/api/me').set('Content-Type', 'application/json').send(JSON.stringify({ bio: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    const tmp = path.join(config.uploadsDir, 'tmp');
    expect(fs.existsSync(tmp) ? fs.readdirSync(tmp) : []).toEqual([]);
  });

  it('[probe] generated avatar SVG never reflects the seed as markup', async () => {
    for (const seed of ['"><script>alert(1)</script>', ']]><script>x</script>', "a' onload='x"]) {
      const res = await ctx.anon().get(`/api/avatars/${encodeURIComponent(seed)}.svg`).buffer(true);
      expect(res.status).toBe(200);
      const text = String(res.text ?? res.body);
      expect(text).not.toContain('<script');
      expect(text).not.toContain('onload=');
    }
  });
});

/* ═════════════════════════════ B. auth ═════════════════════════════ */

describe('B. auth', () => {
  let ctx: TestCtx;
  let restoreRl: () => void;
  const sent: { to: string; code: string }[] = [];

  beforeAll(async () => {
    restoreRl = withRateLimits(); // installs the per-IP express-rate-limit layer too (createApp reads it)
    ctx = await createTestApp({ slices: [] });
  });
  afterAll(() => restoreRl());
  beforeEach(() => {
    sent.length = 0;
    setMailer({
      async send(to, subject) {
        sent.push({ to, code: subject.slice(0, 6) });
      },
    });
  });
  afterEach(() => {
    setMailer(null);
    setNow(null);
  });

  const lastCode = (to: string): string => [...sent].reverse().find((s) => s.to === to)!.code;
  const wrong = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  it('[FINDING] OTP brute force across IPs: guesses per address are bounded only by the 30 s resend cooldown (5 guesses / 31 s, forever)', async () => {
    const email = 'maya.chen@utexas.edu';
    const base = now();
    let evaluated = 0;
    let issued = 0;
    for (let round = 0; round < 12; round++) {
      setNow(base + round * 31_000);
      const ip = `203.0.113.${round + 1}`; // a fresh IP per round (botnet / rotating proxies)
      const start = await ctx.anon().post('/api/auth/start').set('X-Forwarded-For', ip).send({ email });
      if (start.status !== 200) continue;
      issued += 1;
      const guess = wrong(lastCode(email));
      for (let i = 0; i < 5; i++) {
        const v = await ctx.anon().post('/api/auth/verify').set('X-Forwarded-For', ip).send({ email, code: guess });
        if (v.body?.error?.code === 'otp_invalid' || (v.body?.error?.code === 'otp_locked' && i === 4)) evaluated += 1;
      }
    }
    // Measured: 12 codes issued and 60 guesses evaluated in 6 simulated minutes → ~14 400 guesses/day on one address,
    // i.e. a 6-digit code falls in ~70 days of background guessing, with no signal to the victim beyond inbox spam.
    expect({ issued, evaluated }).toEqual({ issued: expect.any(Number), evaluated: expect.any(Number) });
    expect(evaluated).toBeLessThanOrEqual(20);
  });

  it('[FINDING] resend flooding: one address can be sent a code every 31 s from rotating IPs (≈116 emails / hour, 2 800 / day)', async () => {
    const email = 'victim.inbox@utexas.edu';
    const base = now();
    for (let i = 0; i < 116; i++) {
      setNow(base + i * 31_000);
      await ctx.anon().post('/api/auth/start').set('X-Forwarded-For', `198.51.100.${(i % 250) + 1}`).send({ email });
    }
    const toVictim = sent.filter((s) => s.to === email).length;
    expect(toVictim).toBeLessThanOrEqual(10);
  });

  it('[probe] the per-IP auth limiter (10/min) is enforced for a single IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await ctx.anon().get('/api/auth/domain?email=x@utexas.edu').set('X-Forwarded-For', '192.0.2.77')).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('[probe] signup tokens are single-use, unguessable and bound to the verified address', async () => {
    const email = 'first.timer@utexas.edu';
    const ip = '192.0.2.10';
    expect((await ctx.anon().post('/api/auth/start').set('X-Forwarded-For', ip).send({ email })).status).toBe(200);
    const v = await ctx.anon().post('/api/auth/verify').set('X-Forwarded-For', ip).send({ email, code: lastCode(email) });
    expect(v.body.status).toBe('needs_profile');
    const token = v.body.signupToken as string;
    const body = { signupToken: token, displayName: 'First Timer', handle: 'first_timer_x', accountType: 'student', isAdult: true };
    const ok = await ctx.anon().post('/api/auth/complete').set('X-Forwarded-For', '192.0.2.11').send(body);
    expect(ok.status).toBe(200);
    const replay = await ctx.anon().post('/api/auth/complete').set('X-Forwarded-For', '192.0.2.12').send({ ...body, handle: 'second_acct_x' });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('signup_token_invalid');
    const forged = await ctx.anon().post('/api/auth/complete').set('X-Forwarded-For', '192.0.2.13').send({ ...body, signupToken: 'A'.repeat(43), handle: 'forged_acct_x' });
    expect(forged.status).toBe(401);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").get(email)).toEqual({ n: 1 });
  });

  it('[probe] session fixation: a pre-set attacker cookie is never adopted; sign-in mints a fresh random token', async () => {
    const fixed = 'attacker-chosen-session-token-0123456789abcdef';
    const agent = ctx.anon();
    agent.set('Cookie', `${SESSION_COOKIE}=${fixed}`);
    const email = 'maya.chen@utexas.edu';
    setNow(now() + 10 * 60_000); // past any cooldown from earlier tests
    await agent.post('/api/auth/start').set('X-Forwarded-For', '192.0.2.20').send({ email });
    const v = await agent.post('/api/auth/verify').set('X-Forwarded-For', '192.0.2.20').send({ email, code: lastCode(email) });
    expect(v.body.status).toBe('signed_in');
    const cookie = String(v.headers['set-cookie']?.[0] ?? '');
    const token = /uv_session=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).not.toBe(fixed);
    const withFixed = await ctx.anon().get('/api/me').set('Cookie', `${SESSION_COOKIE}=${fixed}`);
    expect(withFixed.status).toBe(401);
  });

  it('[probe] production cookie flags: HttpOnly + Secure + SameSite=Lax + Path=/, and no devCode', async () => {
    const restore = overrideConfig({ env: 'production' });
    try {
      setNow(now() + 20 * 60_000);
      const email = 'jordan.okafor@utexas.edu';
      const start = await ctx.anon().post('/api/auth/start').set('X-Forwarded-For', '192.0.2.30').send({ email });
      expect(start.status).toBe(200);
      expect(start.body.devCode).toBeUndefined();
      const v = await ctx.anon().post('/api/auth/verify').set('X-Forwarded-For', '192.0.2.30').send({ email, code: lastCode(email) });
      expect(v.status).toBe(200);
      const cookie = String(v.headers['set-cookie']?.[0] ?? '');
      expect(cookie).toMatch(/uv_session=/);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
    } finally {
      restore();
    }
  });

  it('[probe] STAFF_EMAILS parser: well-formed pairs parse (trimmed, lower-cased); malformed entries fail boot', () => {
    expect([...parseStaffEmails(' Dana@Company.com:Admin , sam@company.com:moderator,,')]).toEqual([
      ['dana@company.com', 'admin'], ['sam@company.com', 'moderator'],
    ]);
    expect(parseStaffEmails(undefined).size).toBe(0);
    for (const bad of ['dana@company.com', 'dana@company.com:root', 'dana:admin', 'dana@company.com:admin:x', '"dana@company.com:admin"', 'da na@company.com:admin', 'dana@company.com: admin']) {
      expect(() => parseStaffEmails(bad), bad).toThrow(/STAFF_EMAILS/);
    }
  });

  it('[FINDING] STAFF_EMAILS accepts entries the email gate can never match, and silently resolves conflicting duplicate roles', () => {
    // Each of these boots fine, but no sign-in can ever carry that address (the gate rejects it), so Buzz is silently
    // unmonitored — or the operator's intended role is silently overridden by a later duplicate.
    const problems: string[] = [];
    for (const entry of ['dana@bücher.de:admin', 'dana@company.com.:admin', 'da"na@company.com:admin', 'dana@company..com:admin']) {
      try {
        const [[email]] = [...parseStaffEmails(entry)];
        if (!isValidEmail(email!)) problems.push(`${entry} accepted but unmatchable`);
      } catch {
        /* rejected at boot: good */
      }
    }
    try {
      const m = parseStaffEmails('sam@company.com:admin,sam@company.com:moderator');
      problems.push(`conflicting duplicate accepted as ${m.get('sam@company.com')}`);
    } catch {
      /* rejected at boot: good */
    }
    expect(problems).toEqual([]);
  });
});

/* ═════════════════════════════ C. rate limits on writes ═════════════════════════════ */

describe('C. per-user rate limits on write endpoints', () => {
  let ctx: TestCtx;
  let restoreRl: () => void;

  beforeAll(async () => {
    ctx = await createTestApp({ seed: 'all' });
  }, 120_000);
  beforeEach(() => {
    restoreRl = withRateLimits();
  });
  afterEach(() => {
    restoreRl();
    ctx.db.prepare('DELETE FROM rate_events').run();
  });

  it('[probe] posts, comments, messages, listings, reports, follows, votes, buzzes and replies all 429 once their window is full', async () => {
    const maya = ctx.as('u_mayachen');
    const post = (await maya.get('/api/orbit/feed')).body.items[0].id as string;
    const reel = (await maya.get('/api/reels/feed')).body.items[0].id as string;
    const thread = (await maya.get('/api/buzz/feed?sort=new&scope=campus')).body.items[0].id as string;
    const conv = (await maya.get('/api/conversations')).body.items[0].id as string;
    const cases: { action: string; n: number; call: () => Promise<{ status: number; body: { error?: { code: string } } }> }[] = [
      { action: 'orbit_post', n: 10, call: () => maya.post('/api/orbit/posts').send({ text: 'study group at PCL tonight?' }) },
      { action: 'comment', n: 40, call: () => maya.post(`/api/orbit/posts/${post}/comments`).send({ text: 'love this' }) },
      { action: 'comment', n: 40, call: () => maya.post(`/api/reels/${reel}/comments`).send({ text: 'love this' }) },
      { action: 'message_send', n: 60, call: () => maya.post(`/api/conversations/${conv}/messages`).send({ kind: 'text', text: 'hey!' }) },
      { action: 'listing_create', n: 10, call: () => maya.post('/api/market/listings').send({ type: 'sell', category: 'textbooks', title: 'Calc II textbook', price: 20 }) },
      { action: 'report', n: 20, call: () => maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: post, reason: 'threat' }) },
      { action: 'follow', n: 100, call: () => maya.post('/api/users/u_dana_w/follow') },
      { action: 'buzz_vote', n: 120, call: () => maya.put(`/api/buzz/posts/${thread}/vote`).send({ value: 1 }) },
      { action: 'buzz_post', n: 6, call: () => maya.post('/api/buzz').send({ text: 'who else is up studying' }) },
      { action: 'buzz_reply', n: 30, call: () => maya.post(`/api/buzz/${thread}/replies`).send({ text: 'same here' }) },
    ];
    const out: Record<string, number> = {};
    for (const c of cases) {
      ctx.db.prepare('DELETE FROM rate_events').run();
      prefillRate(ctx, 'u_mayachen', c.action, c.n);
      const res = await c.call();
      out[`${c.action}#${cases.indexOf(c)}`] = res.status;
    }
    expect(Object.values(out).every((s) => s === 429), JSON.stringify(out)).toBe(true);
  });

  it('[FINDING] POST /conversations/:id/members has no rate limit and re-adds people who LEFT or DECLINED — an endless add/notify loop', async () => {
    const owner = ctx.createUser({ handle: 'loop_owner' });
    const b = ctx.createUser({ handle: 'loop_b', follows: [owner.id] });
    const c = ctx.createUser({ handle: 'loop_c', follows: [owner.id] });
    const victim = ctx.createUser({ handle: 'loop_victim' }); // does NOT follow the owner → lands as a request each time
    const g = await ctx.as(owner.id).post('/api/conversations/groups').send({ title: 'study buddies', memberIds: [b.id, c.id] });
    expect(g.status).toBe(201);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      statuses.push((await ctx.as(owner.id).post(`/api/conversations/${g.body.id}/members`).send({ userIds: [victim.id] })).status);
      await ctx.as(victim.id).post(`/api/conversations/${g.body.id}/decline`);
    }
    const notes = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'message.group_added'").get(victim.id) as { n: number };
    // measured: 30 × 200 and 30 uncollapsed `message.group_added` notifications; the same loop also bypasses the
    // message_request quota (15/day) because every add is a fresh request to a stranger.
    expect({ throttled: statuses.includes(429) || statuses.includes(403), notifications: notes.n <= 5 }).toEqual({ throttled: true, notifications: true });
  });

  it('[FINDING] a MUTED account can still add people to group chats (no requireCanPost on POST /conversations/:id/members)', async () => {
    const owner = ctx.createUser({ handle: 'muted_owner' });
    const b = ctx.createUser({ handle: 'muted_b', follows: [owner.id] });
    const c = ctx.createUser({ handle: 'muted_c', follows: [owner.id] });
    const stranger = ctx.createUser({ handle: 'muted_target' });
    const g = await ctx.as(owner.id).post('/api/conversations/groups').send({ memberIds: [b.id, c.id] });
    expect(g.status).toBe(201);
    applySanction({ userId: owner.id, kind: 'mute', durationMs: 24 * HOUR, category: 'harassment_bullying', actor: getAuthedUser('u_dana_w')!, delayed: false });
    // sanity: the mute is live (creating a group is refused)
    expect((await ctx.as(owner.id).post('/api/conversations/groups').send({ memberIds: [b.id, c.id] })).status).toBe(403);
    const add = await ctx.as(owner.id).post(`/api/conversations/${g.body.id}/members`).send({ userIds: [stranger.id] });
    expect(add.status).toBe(403);
  });

  it('[FINDING] market offers: offer → withdraw → offer loops without limit, each one a new uncollapsed notification to the seller', async () => {
    const seller = ctx.createUser({ handle: 'offer_seller' });
    const buyer = ctx.createUser({ handle: 'offer_buyer' });
    const listing = await ctx.as(seller.id).post('/api/market/listings').send({ type: 'sell', category: 'furniture', title: 'IKEA desk', price: 40 });
    expect(listing.status).toBe(201);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const o = await ctx.as(buyer.id).post(`/api/market/listings/${listing.body.id}/offers`).send({ amount: 10 + i });
      statuses.push(o.status);
      if (o.status !== 201) break;
      await ctx.as(buyer.id).post(`/api/conversations/${o.body.conversationId}/messages/${o.body.messageId}/offer`).send({ action: 'withdraw' });
    }
    const notes = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'market.offer'").get(seller.id) as { n: number };
    expect({ throttled: statuses.includes(429), notificationsBounded: notes.n <= 10 }).toEqual({ throttled: true, notificationsBounded: true });
  });

  it('[FINDING] edits bypass the create limits: PATCH listing / PATCH group title are unlimited (each re-moderated + broadcast)', async () => {
    const seller = ctx.createUser({ handle: 'edit_seller' });
    const b = ctx.createUser({ handle: 'edit_b', follows: [seller.id] });
    const c = ctx.createUser({ handle: 'edit_c', follows: [seller.id] });
    const listing = await ctx.as(seller.id).post('/api/market/listings').send({ type: 'sell', category: 'furniture', title: 'Lamp', price: 5 });
    const g = await ctx.as(seller.id).post('/api/conversations/groups').send({ title: 'g0', memberIds: [b.id, c.id] });
    const listingStatuses: number[] = [];
    const renameStatuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      listingStatuses.push((await ctx.as(seller.id).patch(`/api/market/listings/${listing.body.id}`).send({ title: `Lamp v${i} great condition` })).status);
      renameStatuses.push((await ctx.as(seller.id).patch(`/api/conversations/${g.body.id}`).send({ title: `group name ${i}` })).status);
    }
    expect({ listingThrottled: listingStatuses.includes(429), renameThrottled: renameStatuses.includes(429) }).toEqual({ listingThrottled: true, renameThrottled: true });
  });
});

/* ═════════════════════════════ D. SQL + zod ═════════════════════════════ */

describe('D. SQL construction and zod handling', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ seed: 'all' });
  }, 120_000);

  function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? tsFiles(p) : d.name.endsWith('.ts') ? [p] : [];
    });
  }

  it('[probe] static: every ${…} inside a prepared SQL template is a reviewed fragment (no user value is ever spliced)', () => {
    // Reviewed by hand (2026-09-23): each allowed expression is either a helper-built `{ sql, params }` fragment, a
    // `.join()` of literal clauses, or a value chosen from a closed set in code (sort enums, delta ops, ternaries).
    const allowed = [
      /^[\w.]+\.sql$/, /^\w+\.join\('(, | AND )'\)$/, /^dir\.toUpperCase\(\)$/, /^quote\(o\.name\)$/,
      /^(where|base|from|order|col|otherCol|op|rop|SELECT|SQL_VISIBLE_TO_VIEWER|SQL_BROWSABLE|keyset|sql|MS_PER_HOUR)$/,
      /^query\.kind === 'threads' \? '' : 'NOT '$/,
      // literal-only locals (each checked by hand: built from string literals / constant enums, never from input)
      // ANON_SQL_LIST (lib/moderation/staff.ts, added by the firewall fix): ANON_ENTITY_TYPES.map(() => '?').join(',') — placeholders only
      /^(sortExpr|notBlockedByMe|anonList|ANON_LIST|ANON_SQL_LIST|emailClause|hostSql|campusOnly|stateSql|DAY)$/,
      /^ACTIVATION_EVENTS\.map\(\(\) => '\?'\)\.join\(','\)$/, /^sqlAuthorVisible\('[\w.]+'\)$/,
    ];
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:\bprep|\.prepare|\.exec)\(\s*`((?:[^`\\]|\\.)*)`/gs)) {
        for (const e of m[1]!.matchAll(/\$\{([^}]*)\}/g)) {
          const expr = e[1]!.trim();
          if (!allowed.some((re) => re.test(expr))) offenders.push(`${path.relative(SRC, file)}: \${${expr}}`);
        }
      }
      // string concatenation into SQL
      for (const m of text.matchAll(/(?:\bprep|\.prepare|\.exec)\(\s*['"][^'"]*['"]\s*\+/g)) offenders.push(`${path.relative(SRC, file)}: concat ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('[probe] injection / wildcard payloads in every free-text search are inert (no 500, no widened result set)', async () => {
    const maya = ctx.as('u_mayachen');
    // (plain '_' is not in this list: real handles contain underscores, so it legitimately matches)
    const payloads = ["' OR 1=1 --", '%', '%%', '\\%', '%_%_%_%_%_%_%_%_%_%_%_%_%_%_%_%_%_%_%_%', "x') UNION SELECT email FROM users --", '"; DROP TABLE users; --'];
    for (const q of payloads) {
      for (const url of ['/api/users/search', '/api/discover/search', '/api/market/listings', '/api/campus/courses', '/api/users/u_mayachen/followers']) {
        const res = await maya.get(url).query({ q });
        expect(res.status, `${url} q=${q}`).toBeLessThan(500);
        if (res.status === 200) expect(res.body.items.length, `${url} q=${q}`).toBe(0);
      }
    }
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'users'").get()).toEqual({ n: 1 });
  });

  it('[probe] extra keys never reach the DB: PATCH /me role/status/email/universityId and create bodies with authorId/status are stripped', async () => {
    const u = ctx.createUser({ handle: 'extra_keys' });
    const agent = ctx.as(u.id);
    await agent.patch('/api/me').send({ bio: 'hello', role: 'admin', status: 'active', email: 'dana@company.com', universityId: 'uni_stanford', follower_count: 99999, id: 'u_dana_w' });
    const row = ctx.db.prepare('SELECT role, email, university_id, follower_count FROM users WHERE id = ?').get(u.id) as Record<string, unknown>;
    expect(row).toMatchObject({ role: 'user', university_id: 'uni_utexas', follower_count: 0 });
    expect(row.email).toBe(u.email);
    const p = await agent.post('/api/orbit/posts').send({ text: 'hi all', authorId: 'u_dana_w', author_id: 'u_dana_w', status: 'active', likeCount: 500, universityId: 'uni_stanford' });
    expect(p.status).toBe(201);
    const post = ctx.db.prepare('SELECT author_id, university_id, like_count FROM orbit_posts WHERE id = ?').get(p.body.id ?? p.body.post?.id) as Record<string, unknown>;
    expect(post).toMatchObject({ author_id: u.id, like_count: 0 });
  });
});

/* ═════════════════════════════ E. cursor tampering ═════════════════════════════ */

describe('E. cursor tampering', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ seed: 'all' });
  }, 120_000);
  afterEach(() => setNow(null));

  async function endpoints(): Promise<{ user: string; urls: string[] }[]> {
    const maya = ctx.as('u_mayachen');
    const first = async (url: string): Promise<string> => (await maya.get(url)).body.items[0].id as string;
    const thread = await first('/api/buzz/feed?sort=new&scope=global');
    const post = await first('/api/orbit/feed');
    const reel = await first('/api/reels/feed');
    const ev = await first('/api/campus/events');
    const conv = await first('/api/conversations');
    return [
      {
        user: 'u_mayachen',
        urls: [
          '/api/buzz/feed?sort=new', '/api/buzz/feed?sort=hot', '/api/buzz/feed?sort=top', '/api/buzz/mine?kind=threads', `/api/buzz/${thread}/replies`,
          '/api/orbit/feed', '/api/orbit/users/u_mayachen/posts', `/api/orbit/posts/${post}/likers`, `/api/orbit/posts/${post}/comments`,
          '/api/reels/feed', '/api/reels/following', '/api/reels/user/u_mayachen', `/api/reels/${reel}/likers`, `/api/reels/${reel}/comments`,
          '/api/campus/events', `/api/campus/events/${ev}/attendees`, '/api/campus/users/u_mayachen/events', '/api/campus/courses',
          '/api/discover/search?q=a', '/api/market/listings', '/api/market/listings?sort=price_asc', '/api/market/saved', '/api/market/mine',
          '/api/conversations', `/api/conversations/${conv}/messages`, '/api/roommates', '/api/roommates/saved',
          '/api/me/blocks', '/api/notifications', '/api/users/search?q=a', '/api/users/u_mayachen/followers', '/api/users/u_mayachen/following',
        ],
      },
      { user: 'u_dana_w', urls: ['/api/admin/queue', '/api/admin/appeals', '/api/admin/audit', '/api/admin/users'] },
    ];
  }
  const withCursor = (u: string, c: string): string => `${u}${u.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(c)}`;

  it('[probe] garbage and re-tagged cursors → 400 invalid_cursor on every paginated endpoint', async () => {
    const good = encodeCursor({ k: 1, id: 'x' });
    const flipped = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    const payloadSwap = `${Buffer.from(JSON.stringify([0, 'zzz'])).toString('base64url')}.${good.split('.')[1]}`;
    const bad: string[] = [];
    for (const { user, urls } of await endpoints()) {
      const agent = ctx.as(user);
      for (const u of urls) {
        for (const c of ['not-a-cursor', flipped, payloadSwap, '.', 'a'.repeat(5000)]) {
          const res = await agent.get(withCursor(u, c));
          if (res.status !== 400 || res.body?.error?.code !== 'invalid_cursor') bad.push(`${u} ${c.slice(0, 12)} → ${res.status}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('[probe] a genuine cursor replayed on EVERY other endpoint (cross-endpoint / cross-type replay) never 500s', async () => {
    const all = await endpoints();
    // harvest every real cursor the API hands out (limit=1 so each list has a next page)
    const harvested: string[] = [];
    for (const { user, urls } of all) {
      for (const u of urls) {
        const res = await ctx.as(user).get(`${u}${u.includes('?') ? '&' : '?'}limit=1`);
        if (typeof res.body?.nextCursor === 'string') harvested.push(res.body.nextCursor);
      }
    }
    expect(harvested.length).toBeGreaterThan(10);
    const crashes: string[] = [];
    for (const { user, urls } of all) {
      for (const u of urls) {
        for (const c of harvested) {
          try {
            const res = await ctx.as(user).get(withCursor(u, c));
            if (res.status >= 500) crashes.push(`${u} ← ${Buffer.from(c.split('.')[0]!, 'base64url').toString()}`);
          } catch (err) {
            crashes.push(`${u} ← ${Buffer.from(c.split('.')[0]!, 'base64url').toString()} THREW ${(err as Error).message}`);
          }
        }
      }
    }
    expect(crashes).toEqual([]);
  });

  it('[FINDING] Buzz cursors are base64 JSON, not opaque: nextCursor discloses the exact millisecond createdAt the API floors to the minute', async () => {
    const author = ctx.createUser({ handle: 'cursor_author' });
    const base = Math.floor(now() / 60_000) * 60_000 + 60_000;
    const exact = base + 42_317; // not minute-aligned
    setNow(exact);
    const a = await ctx.as(author.id).post('/api/buzz').send({ text: 'anyone know if the gym is open late' });
    expect(a.status).toBe(201);
    setNow(exact + 5_000);
    const b = await ctx.as(author.id).post('/api/buzz').send({ text: 'lost my umbrella near the tower' });
    expect(b.status).toBe(201);
    setNow(exact + 10_000);
    const feed = await ctx.as('u_mayachen').get('/api/buzz/feed?sort=new&scope=campus&limit=1');
    expect(feed.status).toBe(200);
    expect(feed.body.items[0].createdAt % 60_000).toBe(0); // the serializer floors (SPEC §3.2 #3)
    const decoded = Buffer.from(String(feed.body.nextCursor).split('.')[0]!, 'base64url').toString('utf8');
    // decoded === `[${exact + 5000},"<id>"]` — the precise post time is one base64 decode away
    expect(decoded).not.toContain(String(exact + 5_000));
  });
});

/* ═════════════════════════════ F. moderation bypass ═════════════════════════════ */

describe('F. moderation bypass (real engine)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ seed: 'all' }); // full mode → admin rule packs registered too
  }, 120_000);

  const SMALL_CAPS: Record<string, string> = {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ',
    q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', y: 'ʏ', z: 'ᴢ',
  };
  const per = (s: string, sep: string): string => s.split(' ').map((w) => [...w].join(sep)).join(' ');
  const handled: Record<string, (s: string) => string> = {
    'zero-width space': (s) => per(s, '​'),
    'word joiner': (s) => per(s, '⁠'),
    'soft hyphen': (s) => per(s, '­'),
    'cyrillic homoglyphs': (s) => s.replace(/o/g, 'о').replace(/a/g, 'а').replace(/e/g, 'е'),
    fullwidth: (s) => [...s].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0xff41 + c.charCodeAt(0) - 97) : c)).join(''),
    'math bold': (s) => [...s].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97) : c)).join(''),
    'combining strike': (s) => [...s].map((c) => `${c}̶`).join(''),
    'hangul filler': (s) => per(s, 'ㅤ'),
  };
  const evasions: Record<string, (s: string) => string> = {
    'latin small capitals (ᴋɪʟʟ)': (s) => [...s].map((c) => SMALL_CAPS[c] ?? c).join(''),
    'braille blank U+2800 between letters': (s) => per(s, '⠀'),
    'interlinear annotation U+FFF9 between letters': (s) => per(s, '￹'),
    'tag characters U+E0041 between letters': (s) => per(s, String.fromCodePoint(0xe0041)),
    'shorthand format control U+1BCA0 between letters': (s) => per(s, String.fromCodePoint(0x1bca0)),
    'latin iota ɩ for i': (s) => s.replace(/i/g, 'ɩ'),
    'regional indicator letters': (s) => [...s].map((c) => (/[a-z]/.test(c) ? `${String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97)}​` : c)).join(''),
  };
  const SURFACES: ModerationSurface[] = [
    'buzz', 'buzz_reply', 'buzz_poll', 'orbit_post', 'comment', 'reel_caption', 'event', 'profile', 'group_name', 'market_listing',
    'roommate_listing', 'message', 'group_message',
  ];
  const PHRASES = ['i am going to kill you', 'kys loser'];
  const ctxFor = (surface: ModerationSurface): ModerationContext => ({
    surface, userId: 'u_probe', role: 'user', accountType: 'student', accountAgeMs: 30 * DAY, activeStrikePoints: 0,
    universityId: 'uni_utexas', countryCode: 'US',
  });

  /** Surfaces/phrases the engine blocks in plain text — the baseline an evasion must also be held to. */
  function blockedPlain(): [ModerationSurface, string][] {
    const out: [ModerationSurface, string][] = [];
    for (const s of SURFACES) for (const p of PHRASES) if (moderateText(p, ctxFor(s)).action === 'block') out.push([s, p]);
    return out;
  }

  it('[probe] sanity: the plain phrases are blocked on every public, anon and private UGC surface', () => {
    expect(blockedPlain().length).toBe(SURFACES.length * PHRASES.length);
  });

  for (const [name, f] of Object.entries(handled)) {
    it(`[probe] ${name} does not slip past moderateText on any surface`, () => {
      const slipped = blockedPlain().filter(([s, p]) => moderateText(f(p), ctxFor(s)).action !== 'block').map(([s, p]) => `${s}: ${p}`);
      expect(slipped).toEqual([]);
    });
  }

  for (const [name, f] of Object.entries(evasions)) {
    it(`[FINDING] ${name} slips a blocked threat/kys past moderateText`, () => {
      const slipped = blockedPlain()
        .map(([s, p]) => ({ s, p, r: moderateText(f(p), ctxFor(s)).action }))
        .filter((x) => x.r !== 'block')
        .map((x) => `${x.s}: "${x.p}" → ${x.r}`);
      expect(slipped).toEqual([]);
    });
  }

  it('[FINDING] end-to-end: a small-caps death threat is published ACTIVE on Orbit and Buzz and a reel comment', async () => {
    const threat = [...'i am going to kill you'].map((c) => SMALL_CAPS[c] ?? c).join('');
    // one author per surface so the duplicate-text detector (M-DUP) cannot be what blocks the later writes
    const as = (h: string) => ctx.as(ctx.createUser({ handle: h }).id);
    const reel = (await ctx.as('u_mayachen').get('/api/reels/feed')).body.items[0].id as string;
    const plain = await as('evader_ctrl').post('/api/orbit/posts').send({ text: 'i am going to kill you' });
    expect(plain.status).toBe(422); // control: the plain threat is blocked end-to-end
    const results = {
      orbit: (await as('evader_o').post('/api/orbit/posts').send({ text: threat })).status,
      buzz: (await as('evader_b').post('/api/buzz').send({ text: threat })).status,
      reelComment: (await as('evader_r').post(`/api/reels/${reel}/comments`).send({ text: threat })).status,
    };
    expect(results).toEqual({ orbit: 422, buzz: 422, reelComment: 422 });
  });
});

/* ═════════════════════════════ G. denial-of-wallet ═════════════════════════════ */

describe('G. denial-of-wallet', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ slices: ['orbit', 'market'] });
  });

  it('[probe] limit= is capped at 50 everywhere pageQuery is used (limit=100000 → 400, limit=-1 → 400)', async () => {
    const maya = ctx.as('u_mayachen');
    for (const url of ['/api/notifications', '/api/users/search?q=a', '/api/orbit/feed', '/api/market/listings', '/api/me/blocks']) {
      expect((await maya.get(withLimit(url, '100000'))).status, url).toBe(400);
      expect((await maya.get(withLimit(url, '-1'))).status, url).toBe(400);
      expect((await maya.get(withLimit(url, '1e9'))).status, url).toBe(400);
    }
  });

  it('[probe] bulk arrays are capped (notifications/read ids ≤ 200, share ≤ 10 conversations, analytics ≤ 50 events)', async () => {
    const maya = ctx.as('u_mayachen');
    expect((await maya.post('/api/notifications/read').send({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) })).status).toBe(400);
    expect((await maya.post('/api/share').send({ conversationIds: Array.from({ length: 11 }, (_, i) => `c${i}`), card: { kind: 'profile', id: 'u_mayachen' } })).status).toBe(400);
    expect((await ctx.anon().post('/api/analytics/track').send({ events: Array.from({ length: 51 }, () => ({ name: 'app_open' })) })).status).toBe(400);
  });

  it('[FINDING] signed-out POST /analytics/track stores ~1 MB of prop KEYS per request (keys are unbounded; only values are capped)', async () => {
    const props: Record<string, string> = {};
    for (let i = 0; i < 40; i++) props[`${String(i).padStart(2, '0')}${'k'.repeat(20_000)}`] = 'v';
    const res = await ctx.anon().post('/api/analytics/track').send({ events: [{ name: 'app_open', props }] });
    expect(res.status).toBe(204);
    const row = ctx.db.prepare("SELECT LENGTH(props_json) AS n FROM analytics_events WHERE name = 'app_open' AND user_id IS NULL ORDER BY created_at DESC LIMIT 1").get() as { n: number };
    // measured ≈ 800 KB per row; with the 300 req/min IP limiter that is ~240 MB/min of DB growth per IP, unauthenticated.
    expect(row.n).toBeLessThanOrEqual(8 * 1024);
  });
});

function withLimit(url: string, limit: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}limit=${limit}`;
}
