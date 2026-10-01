/**
 * Uploads (SPEC §4.2.12, safety §7.6).                                  LANE S-M2a owns this file.
 *
 * - multer with a custom storage engine: images buffer in MEMORY (cap `LIMITS.imageMaxBytes`), videos stream to DISK
 *   under `uploadsDir/tmp` (cap `LIMITS.videoMaxBytes`) and are renamed on success / unlinked on failure.
 * - Magic bytes are verified against the declared MIME (allow-list image/jpeg, image/png, image/webp, video/mp4,
 *   video/quicktime, video/webm); mismatch → 415 `unsupported_media`. Original filenames are discarded and never logged;
 *   the stored name is `nanoid(21)` + an extension derived from the SNIFFED type.
 * - Images are rebuilt without metadata: JPEG drops APP1–APP15 + COM (keeps APP0 and the ICC profile in APP2); PNG drops
 *   eXIf / tEXt / zTXt / iTXt / tIME; WebP drops EXIF / XMP chunks and clears the VP8X flags. Unparseable files → 415.
 * - Videos: `probeVideoDurationMs` (file-based box walk; `moov` may sit at the end); one tolerance everywhere:
 *   maxMs = LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs. QuickTime is stored as `.mp4` / served as video/mp4.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { EpochMs, Id, MediaImage, UploadKind, UploadMime, UploadResult } from '@shared/core';
import { LIMITS } from '@shared/core';
import { config } from '../config';
import { prep } from '../db/index';
import { now } from './clock';
import { ApiError } from './http';
import { log } from './logger';
import { assertRateAvailable, enforceRateLimit } from './rateLimit';
import type { AuthedUser } from './users';

export interface UploadRow {
  id: Id;
  user_id: Id;
  kind: 'image' | 'video';
  purpose: string | null;
  mime: string;
  url: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: EpochMs;
}

export const VIDEO_MAX_MS = LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs;
export const REEL_TOO_LONG = 'Reels max out at 60 seconds.';

const IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIMES: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const EXT: Record<Exclude<UploadMime, 'video/quicktime'>, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm',
};

function tmpDir(): string {
  const dir = path.join(config.uploadsDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ───────────────────────────── multer storage ───────────────────────────── */

interface StoredFile {
  buffer?: Buffer;
  path?: string;
  size: number;
  mimetype: string;
}

/** Images → memory (hard cap), videos → disk temp file. Decided by the declared MIME; the sniff happens afterwards. */
const storage: multer.StorageEngine = {
  _handleFile(_req, file, cb) {
    const declared = (file.mimetype || '').toLowerCase();
    if (VIDEO_MIMES.has(declared)) {
      const tmp = path.join(tmpDir(), `${nanoid(21)}.part`);
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      let size = 0;
      file.stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
      });
      file.stream.on('error', (err) => {
        out.destroy();
        fs.rm(tmp, { force: true }, () => cb(err));
      });
      out.on('error', (err) => fs.rm(tmp, { force: true }, () => cb(err)));
      out.on('finish', () => cb(null, { path: tmp, size } as Partial<Express.Multer.File>));
      file.stream.pipe(out);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    file.stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.imageMaxBytes) {
        file.stream.destroy(Object.assign(new Error('image too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }));
        return;
      }
      chunks.push(chunk);
    });
    file.stream.on('error', (err) => cb(err));
    file.stream.on('end', () => cb(null, { buffer: Buffer.concat(chunks), size } as Partial<Express.Multer.File>));
  },
  _removeFile(_req, file, cb) {
    if (file.path) fs.rm(file.path, { force: true }, () => cb(null));
    else cb(null);
  },
};

const upload = multer({
  storage,
  limits: { fileSize: LIMITS.videoMaxBytes, files: 1, fields: 8, fieldSize: 256 },
  fileFilter(req, file, cb) {
    const declared = (file.mimetype || '').toLowerCase();
    if (!IMAGE_MIMES.has(declared) && !VIDEO_MIMES.has(declared)) {
      cb(new ApiError(415, 'unsupported_media', 'Use a JPEG, PNG, WebP image or an MP4, MOV or WebM video.'));
      return;
    }
    // Gates that must refuse BEFORE a byte is stored (a video streams up to 150 MB to disk): the per-user upload window
    // (checked here, recorded after the multipart parse) and the onboarding gate — fields sent before the file (the client
    // always sends `kind` first) are already on req.body; a video can never be an avatar.
    try {
      const user = req.user;
      if (user) {
        assertRateAvailable(user, 'upload');
        const kind = (req.body as Record<string, unknown> | undefined)?.kind;
        if (!user.onboardingCompleted && (VIDEO_MIMES.has(declared) || (kind !== undefined && kind !== 'avatar'))) {
          throw new ApiError(403, 'onboarding_required', 'Finish setting up your profile to continue.');
        }
      }
      cb(null, true);
    } catch (err) {
      cb(err as Error);
    }
  },
}).single('file');

function runMulter(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    upload(req, {} as never, (err?: unknown) => {
      if (!err) return resolve();
      // busboy's own parse errors ("Malformed part header", "Unexpected end of form" …) are client errors, not 500s.
      if (err instanceof ApiError || (err instanceof Error && err.name === 'MulterError')) return reject(err);
      reject(new ApiError(400, 'bad_request', 'Invalid upload.'));
    });
  });
}

/* ───────────────────────────── magic bytes ───────────────────────────── */

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/webm';

/** Detects the container from its first bytes; null when unknown. */
export function sniffMagic(head: Buffer): SniffedType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    const brand = head.toString('latin1', 8, 12);
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML: the DocType string sits inside the header (first ~64 bytes)
    const probe = head.toString('latin1', 0, Math.min(head.length, 128));
    return probe.includes('webm') ? 'video/webm' : null;
  }
  return null;
}

/* ───────────────────────────── image sanitising ───────────────────────────── */

export interface SanitisedImage {
  buffer: Buffer;
  width: number | null;
  height: number | null;
}

class ParseError extends Error {}

/** JPEG: walk the segments; keep SOI, APP0, APP2 (ICC), tables, frames, scans; drop APP1–APP15 (other) + COM. */
function sanitiseJpeg(buf: Buffer): SanitisedImage {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new ParseError('not a jpeg');
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  let width: number | null = null;
  let height: number | null = null;
  for (;;) {
    if (pos + 2 > buf.length) throw new ParseError('truncated jpeg');
    if (buf[pos] !== 0xff) throw new ParseError('bad jpeg marker');
    let marker = buf[pos + 1]!;
    while (marker === 0xff) {
      pos += 1;
      if (pos + 2 > buf.length) throw new ParseError('truncated jpeg');
      marker = buf[pos + 1]!;
    }
    if (marker === 0xd9) {
      // The FIRST EOI ends the image: anything appended after it (MPF / gain-map / motion-photo secondary images with
      // their own Exif, polyglot HTML / ZIP tails) is discarded.
      parts.push(buf.subarray(pos, pos + 2));
      break;
    }
    if (pos + 4 > buf.length) throw new ParseError('truncated jpeg');
    if (marker === 0xda) {
      // SOS header, then entropy-coded data up to the next real marker (FF xx with xx ∉ {00, D0–D7, FF}); the marker
      // loop then resumes, so APPn / COM segments between progressive scans are dropped like any other.
      const len = buf.readUInt16BE(pos + 2);
      if (len < 2 || pos + 2 + len > buf.length) throw new ParseError('bad jpeg segment');
      let p = pos + 2 + len;
      for (;;) {
        p = buf.indexOf(0xff, p);
        if (p < 0 || p + 1 >= buf.length) throw new ParseError('jpeg without EOI');
        const next = buf[p + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) p += 2;
        else if (next === 0xff) p += 1;
        else break;
      }
      parts.push(buf.subarray(pos, p));
      pos = p;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) throw new ParseError('bad jpeg segment');
    const segment = buf.subarray(pos, pos + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isIcc = marker === 0xe2 && segment.toString('latin1', 4, 15) === 'ICC_PROFILE';
    const drop = marker === 0xfe || (isApp && marker !== 0xe0 && !isIcc);
    if (!drop) parts.push(segment);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (len >= 7) {
        height = buf.readUInt16BE(pos + 5);
        width = buf.readUInt16BE(pos + 7);
      }
    }
    pos += 2 + len;
  }
  return { buffer: Buffer.concat(parts), width, height };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP: ReadonlySet<string> = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: walk the chunks; drop eXIf / tEXt / zTXt / iTXt / tIME. IHDR must come first and IEND last. */
function sanitisePng(buf: Buffer): SanitisedImage {
  if (buf.length < 8 + 12 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new ParseError('not a png');
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let pos = 8;
  let width: number | null = null;
  let height: number | null = null;
  let first = true;
  let ended = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (end > buf.length) throw new ParseError('bad png chunk');
    if (first) {
      if (type !== 'IHDR' || len !== 13) throw new ParseError('png without IHDR');
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      first = false;
    }
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new ParseError('png without IEND');
  return { buffer: Buffer.concat(parts), width, height };
}

/** WebP: RIFF chunk walk; drop EXIF / XMP , clear the VP8X EXIF (0x08) + XMP (0x04) flags, fix the RIFF size. */
function sanitiseWebp(buf: Buffer): SanitisedImage {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new ParseError('not a webp');
  const chunks: Buffer[] = [];
  let pos = 12;
  let width: number | null = null;
  let height: number | null = null;
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  while (pos + 8 <= riffEnd) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const padded = len + (len % 2);
    const end = pos + 8 + padded;
    if (pos + 8 + len > buf.length) throw new ParseError('bad webp chunk');
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      pos = end;
      continue;
    }
    let chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
    if (fourcc === 'VP8X' && len >= 10) {
      chunk[8] = chunk[8]! & ~0x0c; // clear EXIF + XMP flags
      width = 1 + (chunk[12]! | (chunk[13]! << 8) | (chunk[14]! << 16));
      height = 1 + (chunk[15]! | (chunk[16]! << 8) | (chunk[17]! << 16));
    } else if (fourcc === 'VP8 ' && len >= 10 && width === null) {
      width = chunk.readUInt16LE(14) & 0x3fff;
      height = chunk.readUInt16LE(16) & 0x3fff;
    } else if (fourcc === 'VP8L' && len >= 5 && width === null) {
      const bits = chunk.readUInt32LE(9);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (chunk.length < 8 + padded) chunk = Buffer.concat([chunk, Buffer.alloc(8 + padded - chunk.length)]);
    chunks.push(chunk);
    pos = end;
  }
  if (chunks.length === 0) throw new ParseError('empty webp');
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([header, body]), width, height };
}

/** Rebuilds the image without metadata (safety §7.6); throws ApiError 415 when the file does not parse. */
export function sanitiseImage(buf: Buffer, type: 'image/jpeg' | 'image/png' | 'image/webp'): SanitisedImage {
  try {
    if (type === 'image/jpeg') return sanitiseJpeg(buf);
    if (type === 'image/png') return sanitisePng(buf);
    return sanitiseWebp(buf);
  } catch (err) {
    if (err instanceof ParseError || err instanceof RangeError) throw new ApiError(415, 'unsupported_media', "That image couldn't be read. Try a different file.");
    throw err;
  }
}

/* ───────────────────────────── video duration probe ───────────────────────────── */

const HEADER = Buffer.alloc(16);

/** Header reads only: `length` is clamped to 64 bytes so a declared size can never drive an allocation. */
function readAt(fd: number, position: number, length: number): Buffer {
  length = Math.max(0, Math.min(length, 64));
  const buf = length <= HEADER.length ? HEADER : Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return n === length ? buf.subarray(0, length) : buf.subarray(0, n);
}

/**
 * Box budget for one MP4 walk (every box costs one synchronous read on the event loop). Real files have a handful of
 * top-level boxes (ftyp / moov / mdat / free; a moov-at-end fragmented recording a few hundred moof+mdat pairs); a
 * file needing more is refused outright — never handed to the client-supplied duration.
 */
const MP4_MAX_BOXES = 4096;
class Mp4TooDense extends Error {}

/** ISO BMFF / QuickTime: walk the top-level boxes for `moov`, then `moov/mvhd`. Reads headers only. */
function probeMp4(fd: number, fileSize: number): number | null {
  let boxes = 0;
  const walk = (start: number, end: number, depth: number): number | null => {
    let pos = start;
    while (pos + 8 <= end) {
      boxes += 1;
      if (boxes > MP4_MAX_BOXES) throw new Mp4TooDense('too many boxes');
      const h = readAt(fd, pos, 16);
      if (h.length < 8) return null;
      let size = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      let headerLen = 8;
      if (size === 1) {
        if (h.length < 16) return null;
        const big = h.readBigUInt64BE(8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(big);
        headerLen = 16;
      } else if (size === 0) size = end - pos;
      if (size < headerLen) return null;
      if (type === 'moov' && depth === 0) {
        const inner = walk(pos + headerLen, Math.min(end, pos + size), 1);
        if (inner !== null) return inner;
      } else if (type === 'mvhd' && depth === 1) {
        const version = readAt(fd, pos + headerLen, 1)[0] ?? 0;
        if (version === 1) {
          const b = readAt(fd, pos + headerLen + 4 + 16, 12);
          if (b.length < 12) return null;
          const timescale = b.readUInt32BE(0);
          const duration = Number(b.readBigUInt64BE(4));
          return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
        }
        const b = readAt(fd, pos + headerLen + 4 + 8, 8);
        if (b.length < 8) return null;
        const timescale = b.readUInt32BE(0);
        const duration = b.readUInt32BE(4);
        return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
      }
      pos += size;
    }
    return null;
  };
  return walk(0, fileSize, 0);
}

/** Boxes that only carry metadata (QuickTime keys/ilst — GPS, device make/model, software — `©xyz`, XMP `uuid`). */
const MP4_METADATA_BOXES = new Set(['udta', 'meta', 'uuid']);
/** Containers walked to reach per-track metadata and timestamps. */
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia']);
/** Header boxes whose creation / modification times are zeroed (they record the instant the video was shot). */
const MP4_TIMED_BOXES = new Set(['mvhd', 'tkhd', 'mdhd']);

/**
 * Anonymous surfaces (Buzz): scrubs an MP4 / QuickTime file IN PLACE, without changing a single size or offset —
 * metadata boxes (`udta`, `meta`, `uuid`) at the top level and inside moov / trak / mdia are renamed to `free` (every
 * player skips a `free` box) and their payload is overwritten with zeros, and the creation / modification times in mvhd / tkhd / mdhd are zeroed. Phone recordings
 * keep the location, the device model and the recording time in exactly those places. Idempotent. Returns false when
 * the box structure could not be walked (the caller refuses the file rather than publishing it unscrubbed).
 */
export function scrubMp4Metadata(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r+');
    const fileSize = fs.fstatSync(fd).size;
    let boxes = 0;
    const FREE = Buffer.from('free', 'latin1');
    const ZEROS = Buffer.alloc(64 * 1024);
    const walk = (start: number, end: number, depth: number): boolean => {
      let pos = start;
      while (pos + 8 <= end) {
        boxes += 1;
        if (boxes > MP4_MAX_BOXES) return false;
        const h = readAt(fd!, pos, 16);
        if (h.length < 8) return false;
        let size = h.readUInt32BE(0);
        const type = h.toString('latin1', 4, 8);
        let headerLen = 8;
        if (size === 1) {
          if (h.length < 16) return false;
          const big = h.readBigUInt64BE(8);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false;
          size = Number(big);
          headerLen = 16;
        } else if (size === 0) size = end - pos;
        if (size < headerLen || pos + size > end) return false;
        if (MP4_METADATA_BOXES.has(type)) {
          // rename AND blank the payload: a renamed box would still hold the bytes for anyone with a hex editor
          fs.writeSync(fd!, FREE, 0, 4, pos + 4);
          for (let at = pos + headerLen, left = size - headerLen; left > 0; ) {
            const n = Math.min(left, ZEROS.length);
            fs.writeSync(fd!, ZEROS, 0, n, at);
            at += n;
            left -= n;
          }
        } else if (MP4_CONTAINERS.has(type) && depth < 3) {
          if (!walk(pos + headerLen, pos + size, depth + 1)) return false;
        } else if (MP4_TIMED_BOXES.has(type)) {
          const version = readAt(fd!, pos + headerLen, 1)[0] ?? 0;
          const n = version === 1 ? 16 : 8;
          if (headerLen + 4 + n <= size) fs.writeSync(fd!, Buffer.alloc(n), 0, n, pos + headerLen + 4);
        }
        pos += size;
      }
      return true;
    };
    return walk(0, fileSize, 0);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// The leading EBML header (0x1A45DFA3) is skipped as an ordinary sized element.
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
/** Master elements the walk descends into (sized or unsized); every other element is skipped by its size. */
const WEBM_MASTERS = new Set([SEGMENT, INFO, CLUSTER, BLOCK_GROUP]);

/** One fixed read window for the WebM walk: refilled only when a header falls outside it (≈ 2 reads per window). */
const WEBM_WINDOW = 256 * 1024;
/**
 * Element budget for one WebM walk. A 60 s 60 fps + Opus recording is ≈ 7 000 blocks; a file needing more than this
 * is not a reel and is refused outright (never handed to the client-supplied duration).
 */
const WEBM_MAX_ELEMENTS = 250_000;

class WebmReader {
  private readonly buf = Buffer.alloc(WEBM_WINDOW);
  private start = 0;
  private len = 0;
  constructor(
    private readonly fd: number,
    readonly size: number,
  ) {}

  /** Up to `n` (≤ 16) bytes at `pos`; shorter at EOF. */
  bytes(pos: number, n: number): Buffer {
    if (pos < this.start || pos + n > this.start + this.len) {
      this.start = pos;
      this.len = pos < this.size ? fs.readSync(this.fd, this.buf, 0, WEBM_WINDOW, pos) : 0;
    }
    const off = pos - this.start;
    return this.buf.subarray(off, Math.min(off + n, this.len));
  }

  /** EBML variable-size integer at `pos`: { value, length }. `value = -1` → unknown size (all ones). */
  vint(pos: number, keepMarker: boolean): { value: number; length: number } | null {
    const first = this.bytes(pos, 1)[0];
    if (first === undefined) return null;
    let length = 1;
    let mask = 0x80;
    while (length <= 8 && !(first & mask)) {
      length += 1;
      mask >>= 1;
    }
    if (length > 8) return null;
    const bytes = this.bytes(pos, length);
    if (bytes.length < length) return null;
    let value = keepMarker ? bytes[0]! : bytes[0]! & (mask - 1);
    let allOnes = (bytes[0]! & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i += 1) {
      value = value * 256 + bytes[i]!;
      if (bytes[i] !== 0xff) allOnes = false;
    }
    return { value: !keepMarker && allOnes ? -1 : value, length };
  }

  /** Big-endian unsigned integer payload of `len` (≤ 8) bytes; null when truncated. */
  uint(pos: number, len: number): number | null {
    const b = this.bytes(pos, len);
    if (b.length < len) return null;
    let v = 0;
    for (const x of b) v = v * 256 + x;
    return v;
  }
}

type WebmProbe = { durationMs: number | null; refuse: boolean };

/**
 * Matroska / WebM, one linear pass over element headers (payloads are skipped by size; only Segment, Info, Cluster and
 * BlockGroup are descended into, so unsized masters — live/MediaRecorder output — work too):
 * - `Info/Duration × TimecodeScale` when present;
 * - the largest block timestamp (`Cluster/Timecode + (Simple)Block relative timecode`, × TimecodeScale) otherwise —
 *   browser MediaRecorder never writes Duration — and also when it is LARGER than a (lying) Duration.
 * `refuse` = the file is too dense to walk within the element budget: the caller must not fall back to a client value.
 */
function probeWebm(fd: number, fileSize: number): WebmProbe {
  const r = new WebmReader(fd, fileSize);
  let scale = 1_000_000;
  let duration: number | null = null;
  let clusterTc = 0;
  let maxTs: number | null = null; // TimecodeScale units
  let pos = 0;
  let elements = 0;
  while (pos < fileSize) {
    elements += 1;
    if (elements > WEBM_MAX_ELEMENTS) return { durationMs: null, refuse: true };
    const id = r.vint(pos, true);
    if (!id) break;
    const size = r.vint(pos + id.length, false);
    if (!size) break;
    const dataStart = pos + id.length + size.length;
    if (WEBM_MASTERS.has(id.value)) {
      if (id.value === CLUSTER) clusterTc = 0;
      pos = dataStart;
      continue;
    }
    if (size.value < 0) break; // only masters may be unsized
    if (id.value === TIMECODE_SCALE && size.value <= 8) {
      const v = r.uint(dataStart, size.value);
      if (v) scale = v;
    } else if (id.value === DURATION && (size.value === 4 || size.value === 8)) {
      const b = r.bytes(dataStart, size.value);
      if (b.length === size.value) {
        const d = size.value === 8 ? b.readDoubleBE(0) : b.readFloatBE(0);
        if (Number.isFinite(d) && d >= 0) duration = d;
      }
    } else if (id.value === CLUSTER_TIMECODE && size.value <= 8) {
      clusterTc = r.uint(dataStart, size.value) ?? 0;
    } else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = r.vint(dataStart, false);
      const rel = track ? r.bytes(dataStart + track.length, 2) : null;
      if (rel && rel.length === 2) maxTs = Math.max(maxTs ?? 0, clusterTc + rel.readInt16BE(0));
    }
    pos = dataStart + size.value;
  }
  const toMs = (units: number): number => Math.round((units * scale) / 1_000_000);
  const fromInfo = duration !== null ? toMs(duration) : null;
  const fromBlocks = maxTs !== null ? toMs(maxTs) : null;
  if (fromInfo === null) return { durationMs: fromBlocks, refuse: false };
  return { durationMs: fromBlocks === null ? fromInfo : Math.max(fromInfo, fromBlocks), refuse: false };
}

export type VideoProbe = {
  /** Duration read from the file; null when it cannot be determined. */
  durationMs: number | null;
  /** false → the file is readable enough that a client-supplied `durationMs` must NOT stand in for the probe. */
  clientFallback: boolean;
};

/**
 * FILE-based box walk (reads headers with fs.readSync, never the whole file; phone recordings put `moov` at the
 * END): MP4 and QuickTime `moov/mvhd` (same parser); WebM `Duration`, or the Cluster/Block timestamps when Duration is
 * absent (browser MediaRecorder output) or smaller than them.
 */
export function probeVideo(filePath: string, mime: UploadMime): VideoProbe {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    let ms: number | null = null;
    if (mime === 'video/webm') {
      const w = probeWebm(fd, size);
      if (w.refuse) return { durationMs: null, clientFallback: false };
      ms = w.durationMs;
    } else if (mime === 'video/mp4' || mime === 'video/quicktime') ms = probeMp4(fd, size);
    return { durationMs: ms !== null && Number.isFinite(ms) && ms >= 0 ? ms : null, clientFallback: true };
  } catch (err) {
    // a box structure too dense to walk is hostile: refuse rather than trust a client-supplied duration
    return { durationMs: null, clientFallback: !(err instanceof Mp4TooDense) };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Duration only (SPEC §4.2.12 export). null when it cannot be determined. */
export function probeVideoDurationMs(filePath: string, mime: UploadMime): number | null {
  return probeVideo(filePath, mime).durationMs;
}

/* ───────────────────────────── handleUpload ───────────────────────────── */

function fieldNumber(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function cleanup(file: StoredFile | undefined): void {
  if (!file?.path) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    /* best effort */
  }
}

/** Used by the route `POST /api/uploads` (multipart: file, kind, durationMs?, width?, height?). */
export async function handleUpload(req: Request): Promise<UploadResult> {
  const user = req.user;
  if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  await runMulter(req);
  const file = req.file as unknown as StoredFile | undefined;
  try {
    if (!file) throw new ApiError(400, 'validation_failed', 'Attach a file.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind as UploadKind;
    if (kind !== 'image' && kind !== 'video' && kind !== 'avatar') throw new ApiError(400, 'validation_failed', 'kind must be image, video or avatar.');
    if (kind !== 'avatar' && !user.onboardingCompleted) throw new ApiError(403, 'onboarding_required', 'Finish setting up your profile to continue.');
    enforceRateLimit(user, 'upload');

    const head = file.buffer ? file.buffer.subarray(0, 128) : readHead(file.path!, 128);
    const sniffed = sniffMagic(head);
    const declared = (file.mimetype || '').toLowerCase();
    const unsupported = (): ApiError => new ApiError(415, 'unsupported_media', "That file type isn't supported here.");
    if (!sniffed) throw unsupported();
    const declaredIsImage = IMAGE_MIMES.has(declared);
    const sniffedIsImage = IMAGE_MIMES.has(sniffed);
    if (declaredIsImage !== sniffedIsImage) throw unsupported();
    if (sniffedIsImage && declared !== sniffed) throw unsupported();
    if (!sniffedIsImage && declared === 'video/webm' && sniffed !== 'video/webm') throw unsupported();
    if (!sniffedIsImage && declared !== 'video/webm' && sniffed === 'video/webm') throw unsupported();
    if (kind === 'video' ? sniffedIsImage : !sniffedIsImage) throw unsupported();

    const at = now();
    const id = nanoid(14);
    if (sniffedIsImage) {
      const buf = file.buffer ?? fs.readFileSync(file.path!);
      if (buf.length > LIMITS.imageMaxBytes) throw new ApiError(413, 'payload_too_large', 'Images can be up to 8 MB.');
      const type = sniffed as 'image/jpeg' | 'image/png' | 'image/webp';
      const clean = sanitiseImage(buf, type);
      const name = `${nanoid(21)}.${EXT[type]}`;
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(config.uploadsDir, name), clean.buffer, { mode: 0o644 });
      const width = clean.width ?? fieldNumber(body.width);
      const height = clean.height ?? fieldNumber(body.height);
      const url = `/uploads/${name}`;
      prep(
        'INSERT INTO uploads (id, user_id, kind, purpose, mime, url, size, width, height, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).run(id, user.id, 'image', kind === 'avatar' ? 'avatar' : null, type, url, clean.buffer.length, width, height, null, at);
      return { id, url, kind: 'image', mime: type, size: clean.buffer.length, width, height, durationMs: null };
    }

    // video
    const tmp = file.path!;
    if (file.size > LIMITS.videoMaxBytes) throw new ApiError(413, 'payload_too_large', 'That file is too large.');
    // The client value only stands in when the file carries no readable length at all (never for a WebM whose clusters
    // could be read, or one too dense to walk) — otherwise a crafted request could claim 20 s for a 2-minute recording.
    const probe = probeVideo(tmp, sniffed);
    const client = fieldNumber(body.durationMs);
    const duration = probe.durationMs ?? (probe.clientFallback ? client : null);
    if (duration === null) throw new ApiError(400, 'validation_failed', "We couldn't read the video length. Try a different file.");
    if (duration > VIDEO_MAX_MS) throw new ApiError(422, 'validation_failed', REEL_TOO_LONG, { durationMs: duration, maxMs: VIDEO_MAX_MS });
    const stored: 'video/mp4' | 'video/webm' = sniffed === 'video/webm' ? 'video/webm' : 'video/mp4';
    const name = `${nanoid(21)}.${EXT[stored]}`;
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.renameSync(tmp, path.join(config.uploadsDir, name));
    file.path = undefined;
    const width = fieldNumber(body.width);
    const height = fieldNumber(body.height);
    const durationMs = Math.min(duration, LIMITS.reelMaxDurationMs);
    const url = `/uploads/${name}`;
    prep(
      'INSERT INTO uploads (id, user_id, kind, purpose, mime, url, size, width, height, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, user.id, 'video', null, stored, url, file.size, width, height, durationMs, at);
    return { id, url, kind: 'video', mime: stored, size: file.size, width, height, durationMs };
  } catch (err) {
    cleanup(file);
    if (err instanceof ApiError) throw err;
    log.error('upload failed', err);
    throw new ApiError(500, 'internal', 'Something went wrong on our side. Try again.');
  }
}

function readHead(filePath: string, n: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/* ───────────────────────────── lookups ───────────────────────────── */

export function getUpload(id: Id): UploadRow | null {
  return (prep('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined) ?? null;
}

/** The caller's own upload by id or by `/uploads/...` url, of the given kind — 404 otherwise. */
export function assertOwnUpload(
  user: AuthedUser,
  uploadIdOrUrl: string,
  kind: 'image' | 'video',
  opts: { allowBuzz?: boolean } = {},
): UploadRow {
  const row = (prep('SELECT * FROM uploads WHERE id = ? OR url = ?').get(uploadIdOrUrl, uploadIdOrUrl) as UploadRow | undefined) ?? null;
  if (!row || row.user_id !== user.id || row.kind !== kind) throw ApiError.notFound('Upload not found');
  // A file attached to an anonymous buzz can never reappear on a public surface (that would link the buzz to its author).
  if (row.purpose === 'buzz' && !opts.allowBuzz) throw ApiError.notFound('Upload not found');
  return row;
}

/**
 * Every `url` must be an `/uploads/` row owned by the user, or a `/seed-media/` url. Returns the normalised list
 * (dimensions from the upload row). More than `max` images → 400.
 */
export function assertOwnImages(user: AuthedUser, images: MediaImage[], max: number): MediaImage[] {
  if (images.length > max) throw new ApiError(400, 'validation_failed', `You can attach up to ${max} photos.`);
  return images.map((img) => {
    const alt = typeof img.alt === 'string' && img.alt.trim() ? { alt: img.alt.trim().slice(0, 200) } : {};
    if (/^\/seed-media\/[\w./-]+$/.test(img.url) && !img.url.includes('..')) {
      return { url: img.url, width: img.width ?? null, height: img.height ?? null, ...alt };
    }
    const row = assertOwnUpload(user, img.url, 'image');
    return { url: row.url, width: row.width, height: row.height, ...alt };
  });
}
