/**
 * Auth middleware (SPEC §4.2.5). `routes/index.ts` applies `requireAuth` + `requireOnboarded` to every slice router
 * (the auth slice's router gets only `requireAuth`) — slices never add either middleware themselves.
 */
import type { Request, RequestHandler } from 'express';
import type { Role, SuspendedDetails } from '@shared/core';
import { GUIDELINES_VERSION, SESSION_COOKIE } from '@shared/core';
import { prep } from '../db/index';
import { HOUR, MIN, now } from '../lib/clock';
import { ApiError } from '../lib/http';
import { activeSanctionRows } from '../lib/sanctions';
import { resolveSession } from '../lib/sessions';
import { getUserRow, toAuthedUser, type AuthedUser, type UserRow } from '../lib/users';

export type { AuthedUser } from '../lib/users';

const ACTIVE_BUCKET_MS = 5 * MIN;
const POST_SUSPENSION_RESTRICTION_MS = 72 * HOUR;

/** Endpoints a suspended / banned session may still reach. */
const RESTRICTED_ALLOW: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/me\/?$/ },
  { method: 'GET', path: /^\/api\/me\/sanctions\/?$/ },
  { method: 'POST', path: /^\/api\/me\/sanctions\/[^/]+\/ack\/?$/ },
  { method: 'POST', path: /^\/api\/appeals\/?$/ },
  { method: 'POST', path: /^\/api\/auth\/logout\/?$/ },
];

function requestPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0] ?? '';
}

function tokenOf(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const v = cookies?.[SESSION_COOKIE];
  return typeof v === 'string' ? v : undefined;
}

/**
 * A suspension that has run out flips the account back to `active` lazily, and marks it "treated as new" for 72 h
 * (`restricted_until`, safety §3.4). Bans never expire here.
 */
function refreshSuspension(row: UserRow): UserRow {
  if (row.status !== 'suspended') return row;
  const stillSuspended = activeSanctionRows(row.id).some((s) => s.kind === 'suspension' || s.kind === 'ban');
  if (stillSuspended) return row;
  const last = prep(
    "SELECT MAX(COALESCE(lifted_at, ends_at)) AS ended FROM user_sanctions WHERE user_id = ? AND kind = 'suspension'",
  ).get(row.id) as { ended: number | null };
  const ended = last.ended ?? now();
  prep("UPDATE users SET status = 'active', restricted_until = ?, updated_at = ? WHERE id = ? AND status = 'suspended'").run(
    ended + POST_SUSPENSION_RESTRICTION_MS, now(), row.id,
  );
  return getUserRow(row.id) ?? row;
}

function bumpLastActive(row: UserRow): void {
  const bucket = Math.floor(now() / ACTIVE_BUCKET_MS) * ACTIVE_BUCKET_MS;
  if (row.last_active_at !== null && row.last_active_at >= bucket) return;
  prep('UPDATE users SET last_active_at = ? WHERE id = ?').run(bucket, row.id);
}

function authenticate(req: Request): { user: AuthedUser; row: UserRow; sessionId: string } | null {
  const resolved = resolveSession(tokenOf(req));
  if (!resolved) return null;
  const row = refreshSuspension(resolved.user);
  return { user: toAuthedUser(row), row, sessionId: resolved.session.id };
}

/** 401 `unauthenticated`; suspended / banned → 403 (`suspended` / `banned` + details) except the allow-list above. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  try {
    const auth = authenticate(req);
    if (!auth) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
    const { user, row } = auth;
    if (user.status === 'suspended' || user.status === 'banned') {
      const path = requestPath(req);
      const allowed = RESTRICTED_ALLOW.some((a) => a.method === req.method && a.path.test(path));
      if (!allowed) {
        const sanction = activeSanctionRows(user.id).find((s) => s.kind === 'suspension' || s.kind === 'ban');
        const details: SuspendedDetails = { until: sanction?.ends_at ?? null, category: sanction?.category ?? null };
        throw new ApiError(
          403,
          user.status,
          user.status === 'banned' ? 'Your account has been permanently banned.' : 'Your account is suspended.',
          details,
        );
      }
    }
    bumpLastActive(row);
    req.user = user;
    req.sessionId = auth.sessionId;
    next();
  } catch (err) {
    next(err);
  }
};

/** Only `/api/invites/:code`, `/api/auth/*`, `POST /api/analytics/track`. Never fails; sets `req.user` when signed in. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  try {
    const auth = authenticate(req);
    if (auth) {
      req.user = auth.user;
      req.sessionId = auth.sessionId;
    }
  } catch {
    /* an unreadable session is simply "signed out" here */
  }
  next();
};

/** 403 `onboarding_required` until `profile_completed_at` and the current app guidelines are set. After `requireAuth`. */
export const requireOnboarded: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
  if (!req.user.onboardingCompleted) {
    return next(new ApiError(403, 'onboarding_required', 'Finish setting up your profile to continue.'));
  }
  next();
};

/** Non-staff → **404 `not_found`** (never 403): the admin surface does not admit it exists. After `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(ApiError.notFound());
    next();
  };
}

/** 403 `buzz_gate_required` unless `users.buzz_gate_version === GUIDELINES_VERSION` (buzz applies it router-wide). */
export const requireBuzzGate: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
  const row = prep('SELECT buzz_gate_version AS v FROM users WHERE id = ?').get(req.user.id) as { v: string | null } | undefined;
  if (!row || row.v !== GUIDELINES_VERSION) {
    return next(new ApiError(403, 'buzz_gate_required', 'Read and accept the Buzz guidelines first.'));
  }
  next();
};

/** Convenience for handlers behind `requireAuth`: the non-optional user (throws 401 otherwise). */
export function authed(req: Request): AuthedUser {
  if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return req.user;
}
