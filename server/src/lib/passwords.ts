/**
 * Optional password sign-in (DECISIONS D9). Email codes stay the way every account is created and the way back in
 * when a password is forgotten; a password is an opt-in shortcut, and two-factor makes a password alone not enough.
 *
 * Hashing: scrypt (node:crypto, no native add-on) with a 16-byte random salt; stored as
 * `scrypt$N$r$p$salt$hash` (base64url) so the cost can be raised later without breaking old hashes.
 * Lockout: OTP-style, per ACCOUNT (rotating IPs does not help): PASSWORD_MAX_FAILS wrong passwords in a row lock
 * password sign-in for PASSWORD_LOCK_MS. Email-code sign-in is never locked by this.
 */
import crypto from 'node:crypto';
import type { EpochMs, Id, SecuritySettings } from '@shared/core';
import { PASSWORD_MAX, PASSWORD_MIN } from '@shared/core';
import { config } from '../config';
import { newId, prep } from '../db/index';
import { MIN, now } from './clock';
import { ApiError } from './http';

export const PASSWORD_MAX_FAILS = 5;
export const PASSWORD_LOCK_MS = 15 * MIN;
export const LOGIN_CHALLENGE_TTL_MS = 10 * MIN;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

interface PasswordRow {
  user_id: Id;
  password_hash: string;
  two_factor: number;
  failed_attempts: number;
  locked_until: EpochMs | null;
  set_at: EpochMs;
  updated_at: EpochMs;
}

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const expected = Buffer.from(parts[5]!, 'base64url');
  const key = await scrypt(password, Buffer.from(parts[4]!, 'base64url'), N, r, p, expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Lazily built hash of a random string: unknown accounts still pay one scrypt, so timing doesn't reveal them. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPasswordHash(password, await dummyHash);
}

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
  '11111111', '00000000', 'iloveyou', 'abc12345', 'abcd1234', 'letmein1', 'welcome1', 'universe', 'universe1', 'football',
  'baseball', 'sunshine', 'princess', 'starwars', 'trustno1', 'whatever', 'passw0rd', '1q2w3e4r', 'asdfghjk', 'zaq12wsx',
]);

/** 422 `password_weak` with the reason, or nothing. Length is also checked by the route's zod schema. */
export function assertPasswordAcceptable(password: string, email: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(422, 'password_weak', `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
  }
  const lower = password.toLowerCase();
  const local = (email.split('@')[0] ?? '').toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password) || lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local))) {
    throw new ApiError(422, 'password_weak', 'That password is too easy to guess. Try a longer phrase, and leave out your email.');
  }
}

export function getPasswordRow(userId: Id): PasswordRow | null {
  return (prep('SELECT * FROM user_passwords WHERE user_id = ?').get(userId) as PasswordRow | undefined) ?? null;
}

export function securityOf(userId: Id): SecuritySettings {
  const row = getPasswordRow(userId);
  return { hasPassword: row !== null, twoFactor: row?.two_factor === 1, passwordSetAt: row?.set_at ?? null };
}

export async function setPassword(userId: Id, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const at = now();
  prep(
    `INSERT INTO user_passwords (user_id, password_hash, two_factor, failed_attempts, locked_until, set_at, updated_at)
     VALUES (?,?,0,0,NULL,?,?)
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, failed_attempts = 0, locked_until = NULL,
       set_at = excluded.set_at, updated_at = excluded.updated_at`,
  ).run(userId, hash, at, at);
}

export function removePassword(userId: Id): void {
  prep('DELETE FROM user_passwords WHERE user_id = ?').run(userId);
  prep('DELETE FROM login_challenges WHERE user_id = ?').run(userId);
}

export function setTwoFactor(userId: Id, enabled: boolean): void {
  prep('UPDATE user_passwords SET two_factor = ?, updated_at = ? WHERE user_id = ?').run(enabled ? 1 : 0, now(), userId);
}

function lockedError(until: EpochMs): ApiError {
  const minutes = Math.max(1, Math.ceil((until - now()) / MIN));
  return new ApiError(
    423,
    'password_locked',
    `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or sign in with an email code.`,
    { retryAfterSec: Math.max(1, Math.ceil((until - now()) / 1000)) },
  );
}

/**
 * Checks a password for an account that has one, with the lockout applied.
 * Throws 423 `password_locked` while locked (also on the attempt that triggers the lock); returns false on a
 * plain mismatch (the caller answers the generic 401) and true on a match (the failure counter resets).
 */
export async function checkPassword(row: PasswordRow, password: string): Promise<boolean> {
  if (row.locked_until !== null && row.locked_until > now()) throw lockedError(row.locked_until);
  const ok = await verifyPasswordHash(password, row.password_hash);
  if (ok) {
    if (row.failed_attempts > 0 || row.locked_until !== null) {
      prep('UPDATE user_passwords SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').run(row.user_id);
    }
    return true;
  }
  const fails = (row.locked_until !== null && row.locked_until <= now() ? 0 : row.failed_attempts) + 1;
  if (fails >= PASSWORD_MAX_FAILS) {
    const until = now() + PASSWORD_LOCK_MS;
    prep('UPDATE user_passwords SET failed_attempts = 0, locked_until = ? WHERE user_id = ?').run(until, row.user_id);
    throw lockedError(until);
  }
  prep('UPDATE user_passwords SET failed_attempts = ?, locked_until = NULL WHERE user_id = ?').run(fails, row.user_id);
  return false;
}

/* ───────────────────────────── two-factor challenges ───────────────────────────── */

function challengeHash(token: string): string {
  return crypto.createHmac('sha256', config.cursorSecret).update(`login-challenge:${token}`).digest('hex');
}

export function issueLoginChallenge(userId: Id): { token: string; expiresAt: EpochMs } {
  const token = crypto.randomBytes(32).toString('base64url');
  const at = now();
  const expiresAt = at + LOGIN_CHALLENGE_TTL_MS;
  prep('DELETE FROM login_challenges WHERE user_id = ? OR expires_at < ?').run(userId, at - LOGIN_CHALLENGE_TTL_MS);
  prep('INSERT INTO login_challenges (id, token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?,?)').run(
    newId(), challengeHash(token), userId, expiresAt, at,
  );
  return { token, expiresAt };
}

/** 401 `challenge_invalid` for unknown / expired / used challenges. Does NOT consume. */
export function readLoginChallenge(token: string): { id: Id; userId: Id } {
  const row = prep('SELECT id, user_id, expires_at, consumed_at FROM login_challenges WHERE token_hash = ?').get(challengeHash(token)) as
    | { id: Id; user_id: Id; expires_at: EpochMs; consumed_at: EpochMs | null }
    | undefined;
  if (!row || row.consumed_at !== null || row.expires_at <= now()) {
    throw new ApiError(401, 'challenge_invalid', 'That sign-in timed out. Enter your password again.');
  }
  return { id: row.id, userId: row.user_id };
}

export function consumeLoginChallenge(id: Id): void {
  prep('UPDATE login_challenges SET consumed_at = ? WHERE id = ?').run(now(), id);
}
