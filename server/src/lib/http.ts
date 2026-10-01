/**
 * HTTP helpers (SPEC §4.2.3): ApiError, asyncHandler, validate/typed, cursors, pagination, error middleware.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';
import type { ApiErrorBody, ApiErrorCode, Cursor, Id, Paginated } from '@shared/core';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@shared/core';
import { config } from '../config';
import { log } from './logger';

/* ───────────────────────────── ApiError ───────────────────────────── */

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static notFound(msg = 'Not found'): ApiError {
    return new ApiError(404, 'not_found', msg);
  }
  static forbidden(msg = "You can't do that."): ApiError {
    return new ApiError(403, 'forbidden', msg);
  }
  static badRequest(msg: string, details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', msg, details);
  }
  static conflict(msg: string): ApiError {
    return new ApiError(409, 'conflict', msg);
  }
}

/* ───────────────────────────── handlers & validation ───────────────────────────── */

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Parses and REPLACES `req.body/query/params` with the parsed values.
 * Failure → 400 `validation_failed`, `details = zodError.flatten()`.
 */
export function validate<T extends { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }>(
  schemas: T,
): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as Request['query'];
        // Express 4: plain assignment works; defineProperty keeps this working if `query` is ever a getter.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true, enumerable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const message = first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'Invalid request';
        next(new ApiError(400, 'validation_failed', message, err.flatten()));
        return;
      }
      next(err);
    }
  };
}

/** Typed view of a request that went through `validate()`. */
export function typed<B = unknown, Q = unknown, P = unknown>(req: Request): { body: B; query: Q; params: P } {
  return { body: req.body as B, query: req.query as unknown as Q, params: req.params as unknown as P };
}

export const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

/* ───────────────────────────── cursors ───────────────────────────── */

export interface CursorValue {
  k: number | string;
  id: Id;
}

function cursorTag(payload: string): string {
  return crypto.createHmac('sha256', config.cursorSecret).update(payload).digest('base64url').slice(0, 22);
}

/* ───────────────────────────── sealed values ───────────────────────────── */

const sealKeyCache = new Map<string, { enc: Buffer; iv: Buffer }>();

function sealKeys(label: string): { enc: Buffer; iv: Buffer } {
  const cacheKey = `${config.cursorSecret}\u0000${label}`;
  let keys = sealKeyCache.get(cacheKey);
  if (!keys) {
    const okm = Buffer.from(crypto.hkdfSync('sha256', config.cursorSecret, Buffer.alloc(0), `universe:seal:${label}`, 64));
    keys = { enc: okm.subarray(0, 32), iv: okm.subarray(32) };
    sealKeyCache.set(cacheKey, keys);
  }
  return keys;
}

/**
 * Deterministic authenticated encryption (AES-256-GCM, SIV-style IV = HMAC(plaintext)) under a key derived from
 * CURSOR_SECRET with a per-purpose `label`. The token reveals nothing but equality of plaintexts under that label.
 * Used for cursor sort keys that must stay server-side (Buzz true order, SPEC §3.2 #3) and for staff handles that
 * must not be joinable with raw ids (anon-origin sanctions, SPEC §4.2.14).
 */
export function sealValue(label: string, plaintext: string): string {
  const { enc, iv: ivKey } = sealKeys(label);
  const iv = crypto.createHmac('sha256', ivKey).update(plaintext).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', enc, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url');
}

/** Inverse of `sealValue`; null for anything that was not sealed under `label` with the current secret. */
export function unsealValue(label: string, token: string): string | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 12 + 16 || raw.toString('base64url') !== token) return null;
    const { enc } = sealKeys(label);
    const decipher = crypto.createDecipheriv('aes-256-gcm', enc, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Marks a sealed sort key inside a cursor payload. */
const SEALED_KEY_PREFIX = '~s.';

/**
 * `seal: true` encrypts the sort key inside the (signed) payload, so a client that base64-decodes the cursor sees
 * only `["~s.<ciphertext>", id]` — required wherever the key is a value the API deliberately coarsens (Buzz times).
 * `decodeCursor` restores the original key transparently.
 */
export function encodeCursor(v: CursorValue, opts: { seal?: boolean } = {}): Cursor {
  const k = opts.seal ? `${SEALED_KEY_PREFIX}${sealValue('cursor-key', JSON.stringify(v.k))}` : v.k;
  const payload = Buffer.from(JSON.stringify([k, v.id]), 'utf8').toString('base64url');
  return `${payload}.${cursorTag(payload)}`;
}

/** `undefined` / `''` → null. Bad tag or shape → ApiError(400,'invalid_cursor'). */
export function decodeCursor(c?: string | null): CursorValue | null {
  if (c == null || c === '') return null;
  const bad = (): ApiError => new ApiError(400, 'invalid_cursor', 'Invalid cursor');
  const dot = c.lastIndexOf('.');
  if (dot <= 0) throw bad();
  const payload = c.slice(0, dot);
  const tag = c.slice(dot + 1);
  const expected = cursorTag(payload);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad();
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) throw bad();
    let [k, id] = parsed as [unknown, unknown];
    if (typeof k === 'string' && k.startsWith(SEALED_KEY_PREFIX)) {
      const opened = unsealValue('cursor-key', k.slice(SEALED_KEY_PREFIX.length));
      if (opened === null) throw bad();
      k = JSON.parse(opened) as unknown;
    }
    if ((typeof k !== 'number' && typeof k !== 'string') || typeof id !== 'string') throw bad();
    return { k, id };
  } catch {
    throw bad();
  }
}

/** Caller fetches `limit + 1` rows; the extra row only signals "there is more". */
export function paginate<Row, T>(
  rows: Row[],
  limit: number,
  key: (r: Row) => CursorValue,
  map: (r: Row) => T,
): Paginated<T> {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(key(last)) : null,
  };
}

/**
 * Keyset WHERE fragment for `ORDER BY col DIR, idCol DIR`.
 * `cur = null` → `1 = 1`. `col` / `idCol` are trusted SQL identifiers (never user input).
 */
export function keysetWhere(
  col: string,
  idCol: string,
  cur: CursorValue | null,
  dir: 'desc' | 'asc',
): { sql: string; params: (string | number)[] } {
  if (!cur) return { sql: '1 = 1', params: [] };
  const op = dir === 'desc' ? '<' : '>';
  return { sql: `(${col} ${op} ? OR (${col} = ? AND ${idCol} ${op} ?))`, params: [cur.k, cur.k, cur.id] };
}

/* ───────────────────────────── responses ───────────────────────────── */

export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.vary('Cookie');
}

function body(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFoundMiddleware: RequestHandler = (_req, res) => {
  res.status(404).json(body('not_found', 'Not found'));
};

interface HttpishError {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
  name?: string;
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(body('validation_failed', 'Invalid request', err.flatten()));
    return;
  }
  const e = (err ?? {}) as HttpishError;
  // body-parser
  if (e.type === 'entity.too.large') {
    res.status(413).json(body('payload_too_large', 'That request is too large.'));
    return;
  }
  if (e.type === 'entity.parse.failed' || e.type === 'encoding.unsupported' || e.type === 'charset.unsupported') {
    res.status(400).json(body('bad_request', 'Malformed request body.'));
    return;
  }
  // multer
  if (e.name === 'MulterError') {
    if (e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(body('payload_too_large', 'That file is too large.'));
      return;
    }
    res.status(400).json(body('bad_request', 'Invalid upload.'));
    return;
  }
  // Unknown: 500 `internal`. Body carries nothing; the log carries name + message (never rows/bodies).
  log.error('unhandled error', err);
  res.status(500).json(body('internal', 'Something went wrong on our side. Try again.'));
}
