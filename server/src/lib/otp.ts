/**
 * One-time sign-in codes (Constitution §6): 6 digits, stored hashed, 10-minute expiry, max 5 attempts,
 * 30 s resend cooldown. Also issues the short-lived signup token that bridges /auth/verify → /auth/complete.
 */
import crypto from 'node:crypto';
import type { EpochMs, Id, OtpInvalidDetails, RateLimitedDetails } from '@shared/core';
import { config } from '../config';
import { newId, prep, tx } from '../db/index';
import { MIN, now } from './clock';
import { ApiError } from './http';

export const OTP_TTL_MS = 10 * MIN;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30_000;
export const SIGNUP_TOKEN_TTL_MS = 30 * MIN;
/**
 * Escalating resend cooldown per address: after the n-th code within an hour the next one waits
 * OTP_RESEND_LADDER_MS[n-1] (30 s, 30 s, 1 min, 2 min, 5 min, then 15 min); once OTP_FAILED_BUDGET wrong guesses were
 * made on the address within the hour (three locked codes) the wait is at least OTP_FAILED_COOLDOWN_MS; and at most
 * OTP_MAX_PER_DAY codes go to one address per rolling day. Counted per ADDRESS, so rotating IPs does not help.
 */
export const OTP_RESEND_LADDER_MS = [OTP_RESEND_COOLDOWN_MS, OTP_RESEND_COOLDOWN_MS, MIN, 2 * MIN, 5 * MIN, 15 * MIN] as const;
export const OTP_MAX_PER_DAY = 10;
export const OTP_FAILED_BUDGET = 3 * OTP_MAX_ATTEMPTS;
export const OTP_FAILED_COOLDOWN_MS = 5 * MIN;
const OTP_HOUR_MS = 60 * MIN;
const OTP_DAY_MS = 24 * 60 * MIN;

/** Wait required after the `sentInLastHour`-th code (≥ 1). */
function resendGapAfter(sentInLastHour: number): number {
  return OTP_RESEND_LADDER_MS[Math.min(Math.max(sentInLastHour, 1), OTP_RESEND_LADDER_MS.length) - 1]!;
}

interface OtpRow {
  id: Id;
  email: string;
  code_hash: string;
  attempts: number;
  invite_code: string | null;
  last_sent_at: EpochMs;
  expires_at: EpochMs;
  consumed_at: EpochMs | null;
  created_at: EpochMs;
}

function hmac(purpose: string, value: string): string {
  return crypto.createHmac('sha256', config.cursorSecret).update(`${purpose}:${value}`).digest('hex');
}

function codeHash(email: string, code: string): string {
  return hmac('otp', `${email.toLowerCase()}:${code}`);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function latestOpen(email: string): OtpRow | undefined {
  return prep('SELECT * FROM otp_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1').get(email) as
    | OtpRow
    | undefined;
}

/**
 * Issues a fresh code (older open codes for the address are retired).
 * 429 `otp_cooldown` + `{ retryAfterSec }` inside the 30 s resend window.
 */
export function issueOtp(email: string, inviteCode?: string | null): { code: string; expiresAt: EpochMs; resendAvailableAt: EpochMs } {
  const at = now();
  const refuse = (until: EpochMs): never => {
    const retryAfterSec = Math.max(1, Math.ceil((until - at) / 1000));
    const details: RateLimitedDetails = { retryAfterSec };
    throw new ApiError(429, 'otp_cooldown', 'Too many tries. Give it a minute, then try again.', details);
  };
  // Per-ADDRESS budget (the per-IP limiter is defeated by rotating IPs): codes sent in the last hour / day, from the
  // otp_codes history (rows live 24 h). Each code is worth ≤ 5 guesses, so this bounds guessing and mail-bombing alike.
  const day = prep(
    'SELECT COUNT(*) AS n, MIN(last_sent_at) AS oldest FROM otp_codes WHERE email = ? AND last_sent_at > ? AND last_sent_at <= ?',
  ).get(email, at - OTP_DAY_MS, at) as { n: number; oldest: EpochMs | null };
  if (day.n >= OTP_MAX_PER_DAY) refuse((day.oldest ?? at) + OTP_DAY_MS);
  const hour = prep(
    `SELECT COUNT(*) AS n, MAX(last_sent_at) AS latest, COALESCE(SUM(attempts), 0) AS failed
       FROM otp_codes WHERE email = ? AND last_sent_at > ? AND last_sent_at <= ?`,
  ).get(email, at - OTP_HOUR_MS, at) as { n: number; latest: EpochMs | null; failed: number };
  if (hour.n > 0 && hour.latest !== null) {
    const gap = Math.max(resendGapAfter(hour.n), hour.failed >= OTP_FAILED_BUDGET ? OTP_FAILED_COOLDOWN_MS : 0);
    if (at - hour.latest < gap) refuse(hour.latest + gap);
  }
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = at + OTP_TTL_MS;
  tx(() => {
    prep('UPDATE otp_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').run(at, email);
    prep(
      'INSERT INTO otp_codes (id, email, code_hash, attempts, invite_code, last_sent_at, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(newId(), email, codeHash(email, code), 0, inviteCode ?? null, at, expiresAt, at);
    prep('DELETE FROM otp_codes WHERE created_at < ?').run(at - 24 * 60 * MIN);
  });
  return { code, expiresAt, resendAvailableAt: at + resendGapAfter(hour.n + 1) };
}

/**
 * Consumes the code. 400 `otp_invalid` (+ attemptsLeft) · 410 `otp_expired` · 423 `otp_locked`.
 * Returns the invite code that was attached at /auth/start (if any).
 */
export function consumeOtp(email: string, code: string): { inviteCode: string | null } {
  const row = latestOpen(email);
  const at = now();
  if (!row) throw new ApiError(410, 'otp_expired', 'That code expired. Tap Resend for a fresh one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(423, 'otp_locked', 'Too many wrong codes. Request a new one to keep going.');
  if (row.expires_at <= at) throw new ApiError(410, 'otp_expired', 'That code expired. Tap Resend for a fresh one.');
  if (!safeEqual(row.code_hash, codeHash(email, code))) {
    const attempts = row.attempts + 1;
    prep('UPDATE otp_codes SET attempts = ? WHERE id = ?').run(attempts, row.id);
    if (attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(423, 'otp_locked', 'Too many wrong codes. Request a new one to keep going.');
    const details: OtpInvalidDetails = { attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
    throw new ApiError(400, 'otp_invalid', `That code doesn't match. ${details.attemptsLeft} ${details.attemptsLeft === 1 ? 'try' : 'tries'} left.`, details);
  }
  prep('UPDATE otp_codes SET consumed_at = ? WHERE id = ?').run(at, row.id);
  return { inviteCode: row.invite_code };
}

/* ───────────────────────────── signup tokens ───────────────────────────── */

export interface SignupTokenRow {
  id: Id;
  token_hash: string;
  email: string;
  university_id: Id;
  invite_code: string | null;
  expires_at: EpochMs;
  consumed_at: EpochMs | null;
  created_at: EpochMs;
}

export function issueSignupToken(email: string, universityId: Id, inviteCode: string | null): { token: string; expiresAt: EpochMs } {
  const token = crypto.randomBytes(32).toString('base64url');
  const at = now();
  const expiresAt = at + SIGNUP_TOKEN_TTL_MS;
  prep(
    'INSERT INTO signup_tokens (id, token_hash, email, university_id, invite_code, expires_at, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(newId(), hmac('signup', token), email, universityId, inviteCode, expiresAt, at);
  return { token, expiresAt };
}

/** 401 `signup_token_invalid` for unknown / expired / used tokens. Does NOT consume — call `consumeSignupToken`. */
export function readSignupToken(token: string): SignupTokenRow {
  const row = prep('SELECT * FROM signup_tokens WHERE token_hash = ?').get(hmac('signup', token)) as SignupTokenRow | undefined;
  if (!row || row.consumed_at !== null || row.expires_at <= now()) {
    throw new ApiError(401, 'signup_token_invalid', 'That sign-up link expired. Enter your email again to get a new code.');
  }
  return row;
}

export function consumeSignupToken(id: Id): void {
  prep('UPDATE signup_tokens SET consumed_at = ? WHERE id = ?').run(now(), id);
}
