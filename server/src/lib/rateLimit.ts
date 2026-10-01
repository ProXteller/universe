/**
 * Per-user sliding-window rate limits + posting gates (SPEC §4.2.9, safety §3.3 / §3.4 / §4.1).
 * The IP-level `express-rate-limit` in app.ts stays on as the coarse outer layer.
 */
import type { RequestHandler } from 'express';
import type { EpochMs, MutedDetails, RateLimitedDetails } from '@shared/core';
import { config } from '../config';
import { prep } from '../db/index';
import { DAY, HOUR, MIN, now } from './clock';
import { ApiError } from './http';
import { activeSanctionRows } from './sanctions';
import type { AuthedUser } from './users';

export type RateAction =
  | 'buzz_post' | 'buzz_reply' | 'buzz_vote' | 'orbit_post' | 'comment' | 'reel_upload' | 'message_send'
  | 'message_request' | 'group_create' | 'listing_create' | 'roommate_edit' | 'event_create' | 'course_create'
  | 'follow' | 'report' | 'block' | 'search' | 'profile_edit' | 'upload' | 'unmask'
  // hardening additions: edits / adds / offers must not bypass the create limits
  | 'group_add' | 'group_rename' | 'listing_edit' | 'offer';

interface Window {
  ms: number;
  max: number;
  /** New-account column (account age < 72 h or `restricted_until` in the future). Defaults to `max`. */
  maxNew?: number;
}

/** safety §3.3 (+ `course_create` like group chats, `upload` 60/h from SPEC §4.3 #29). */
const LIMITS_TABLE: Record<RateAction, Window[]> = {
  buzz_post: [{ ms: HOUR, max: 6, maxNew: 2 }, { ms: DAY, max: 20, maxNew: 5 }],
  buzz_reply: [{ ms: HOUR, max: 30, maxNew: 10 }, { ms: DAY, max: 150, maxNew: 30 }],
  buzz_vote: [{ ms: HOUR, max: 120, maxNew: 60 }],
  orbit_post: [{ ms: HOUR, max: 10, maxNew: 3 }, { ms: DAY, max: 30, maxNew: 10 }],
  comment: [{ ms: HOUR, max: 40, maxNew: 15 }],
  reel_upload: [{ ms: HOUR, max: 5, maxNew: 2 }, { ms: DAY, max: 15, maxNew: 2 }],
  message_send: [{ ms: MIN, max: 60, maxNew: 30 }, { ms: HOUR, max: 600, maxNew: 200 }],
  message_request: [{ ms: DAY, max: 15, maxNew: 5 }],
  group_create: [{ ms: DAY, max: 5, maxNew: 1 }],
  listing_create: [{ ms: DAY, max: 10, maxNew: 2 }],
  roommate_edit: [{ ms: DAY, max: 10 }],
  event_create: [{ ms: DAY, max: 5, maxNew: 1 }],
  course_create: [{ ms: DAY, max: 5, maxNew: 1 }],
  follow: [{ ms: HOUR, max: 100, maxNew: 30 }, { ms: DAY, max: 400, maxNew: 100 }],
  report: [{ ms: DAY, max: 20, maxNew: 10 }],
  block: [{ ms: DAY, max: 50 }],
  search: [{ ms: MIN, max: 60, maxNew: 30 }],
  profile_edit: [{ ms: DAY, max: 5 }],
  upload: [{ ms: HOUR, max: 60 }],
  unmask: [{ ms: DAY, max: 10 }],
  group_add: [{ ms: HOUR, max: 20, maxNew: 5 }, { ms: DAY, max: 60, maxNew: 15 }],
  group_rename: [{ ms: HOUR, max: 10, maxNew: 5 }],
  listing_edit: [{ ms: DAY, max: 30, maxNew: 10 }],
  offer: [{ ms: DAY, max: 20, maxNew: 10 }],
};

/** Org accounts use the established column ×2 for posts/events only. */
const ORG_DOUBLE: ReadonlySet<RateAction> = new Set<RateAction>(['orbit_post', 'event_create']);

const ACTIVE_CAPS = { listing: { established: 30, fresh: 5 } } as const;

function enabled(): boolean {
  return config.env !== 'test' || process.env.RATE_LIMITS === 'on';
}

function waitCopy(retryAfterSec: number): string {
  if (retryAfterSec < 90) return "You're going fast. Try again in a minute.";
  const minutes = Math.ceil(retryAfterSec / 60);
  if (minutes < 120) return `You're going fast. Try again in ${minutes} minutes.`;
  return `You're going fast. Try again in ${Math.ceil(minutes / 60)} hours.`;
}

function limitFor(user: AuthedUser, action: RateAction, w: Window): number {
  if (user.isNewAccount) return w.maxNew ?? w.max;
  return user.accountType === 'org' && ORG_DOUBLE.has(action) ? w.max * 2 : w.max;
}

/**
 * Throws 429 `rate_limited` + `RateLimitedDetails` when a window is full; otherwise records a `rate_events` row.
 * Disabled when `config.env === 'test'` unless `process.env.RATE_LIMITS === 'on'`.
 */
export function enforceRateLimit(user: AuthedUser, action: RateAction): void {
  if (!enabled()) return;
  const at = assertRateAvailable(user, action);
  prep('INSERT INTO rate_events (user_id, action, created_at) VALUES (?,?,?)').run(user.id, action, at);
  // Opportunistic cleanup: nothing older than the longest window (1 day) is ever read.
  if (at % 50 === 0) prep('DELETE FROM rate_events WHERE created_at < ?').run(at - 2 * DAY);
}

/**
 * The check half of {@link enforceRateLimit} without recording an event — for gates that must refuse BEFORE doing
 * expensive work (e.g. uploads, before multer streams a file to disk). Returns the clock reading used.
 */
export function assertRateAvailable(user: AuthedUser, action: RateAction): EpochMs {
  const at = now();
  if (!enabled()) return at;
  for (const w of LIMITS_TABLE[action]) {
    const max = limitFor(user, action, w);
    const since = at - w.ms;
    const row = prep(
      'SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM rate_events WHERE user_id = ? AND action = ? AND created_at > ?',
    ).get(user.id, action, since) as { n: number; oldest: number | null };
    if (row.n >= max) {
      const retryAfterSec = Math.max(1, Math.ceil(((row.oldest ?? at) + w.ms - at) / 1000));
      const details: RateLimitedDetails = { retryAfterSec };
      throw new ApiError(429, 'rate_limited', waitCopy(retryAfterSec), details);
    }
  }
  return at;
}

/** Active-row caps that are not time windows: 30 active listings (5 for new accounts). */
export function enforceActiveCap(user: AuthedUser, kind: 'listing', currentActive: number): void {
  if (!enabled()) return;
  const cap = user.isNewAccount ? ACTIVE_CAPS[kind].fresh : ACTIVE_CAPS[kind].established;
  if (currentActive >= cap) {
    const details: RateLimitedDetails = { retryAfterSec: 0 };
    throw new ApiError(429, 'rate_limited', `You can have up to ${cap} active ${kind}s. Close one to post another.`, details);
  }
}

/**
 * Gate for EVERY create/edit route of buzzes, replies, posts, comments, reels, listings, roommate profile, events,
 * polls, group chats, course create and profile text. Not for votes / likes / saves / RSVP / reports / blocks /
 * replies in accepted DMs.
 *  - active mute whose scope matches → 403 `muted` + `MutedDetails`
 *  - unacknowledged warning → 403 `forbidden` with `details.warningId`
 */
export function assertCanPost(user: AuthedUser, scope: 'public' | 'buzz' | 'message_request' = 'public'): void {
  const mute = activeSanctionRows(user.id).find(
    (s) =>
      s.kind === 'mute' &&
      (s.scope === 'all' || (s.scope === 'buzz_only' && scope === 'buzz') || (s.scope === 'requests' && scope === 'message_request')),
  );
  if (mute) {
    const details: MutedDetails = { until: mute.ends_at ?? now(), scope: mute.scope };
    throw new ApiError(403, 'muted', "You're muted right now, so you can't post. You can still read, vote and reply in your existing chats.", details);
  }
  const warning = prep(
    `SELECT id FROM user_sanctions WHERE user_id = ? AND kind = 'warning' AND acknowledged_at IS NULL AND lifted_at IS NULL
      AND effective_at <= ? ORDER BY created_at LIMIT 1`,
  ).get(user.id, now()) as { id: string } | undefined;
  if (warning) {
    throw new ApiError(403, 'forbidden', 'Please read and acknowledge the notice from the safety team before posting.', { warningId: warning.id });
  }
}

export function requireCanPost(scope: 'public' | 'buzz' | 'message_request' = 'public'): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
      assertCanPost(req.user, scope);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Slice-level new-account rules (polls / groups / DM images to non-followers < 24 h; event capacity > 50 < 7 d). */
export function assertAccountAge(user: AuthedUser, minMs: number, message: string): void {
  if (user.accountAgeMs < minMs) throw new ApiError(403, 'forbidden', message, { reason: 'account_too_new', availableAt: user.createdAt + minMs });
}
