/**
 * Cookie sessions (Constitution §4: passwordless, `uv_session`, httpOnly, sameSite=lax).
 * The cookie carries a random token; only its SHA-256 is stored (`sessions.token_hash`).
 */
import crypto from 'node:crypto';
import type { Response } from 'express';
import type { EpochMs, Id } from '@shared/core';
import { SESSION_COOKIE } from '@shared/core';
import { config } from '../config';
import { newId, prep } from '../db/index';
import { DAY, MIN, now } from './clock';
import { getUserRow, type UserRow } from './users';

export interface SessionRow {
  id: Id;
  token_hash: string;
  user_id: Id;
  user_agent: string | null;
  created_at: EpochMs;
  last_seen_at: EpochMs;
  expires_at: EpochMs;
  revoked_at: EpochMs | null;
}

const ttlMs = (): number => config.sessionTtlDays * DAY;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a session row and returns the RAW token (only ever sent to the client as the cookie). */
export function createSession(userId: Id, userAgent?: string | null): { id: Id; token: string; expiresAt: EpochMs } {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId();
  const at = now();
  const expiresAt = at + ttlMs();
  prep(
    'INSERT INTO sessions (id, token_hash, user_id, user_agent, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, hashToken(token), userId, userAgent ? userAgent.slice(0, 300) : null, at, at, expiresAt);
  return { id, token, expiresAt };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
    maxAge: ttlMs(),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/' });
}

/**
 * Valid (unrevoked, unexpired) session + its user, or null. Also used by the ws upgrade (cookie auth).
 * Bumps `last_seen_at` at most every 5 minutes.
 */
export function resolveSession(token: string | undefined | null): { session: SessionRow; user: UserRow } | null {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const session = prep('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token)) as SessionRow | undefined;
  if (!session || session.revoked_at !== null) return null;
  const at = now();
  if (session.expires_at <= at) return null;
  const user = getUserRow(session.user_id);
  if (!user || user.status === 'deleted') return null;
  if (at - session.last_seen_at > 5 * MIN) prep('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(at, session.id);
  return { session, user };
}

export function revokeSession(sessionId: Id): void {
  prep('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now(), sessionId);
}

export function revokeAllSessions(userId: Id): void {
  prep('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), userId);
}

/** Signs every OTHER device out (after a password change); the current session stays. */
export function revokeOtherSessions(userId: Id, keepSessionId: Id | null | undefined): void {
  prep('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL').run(now(), userId, keepSessionId ?? '');
}
