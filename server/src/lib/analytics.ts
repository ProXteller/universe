/**
 * Server-side analytics (SPEC §4.2.13).                                 LANE S-M2b owns this file.
 *
 * `trackEvent` NEVER throws (a failed event row must never break the request that produced it).
 * For `ANON_ANALYTICS_EVENTS` (Buzz): `user_id = NULL`, `anon_hash = HMAC(dailySalt, userId)`, time floored to the
 * minute, props keys matching `/id$/i` dropped, no session id. Hidden universities (`uni_team`) are stored with
 * `university_id = NULL` so they never show up in analytics-by-campus (SPEC §4.1).
 *
 * `ANALYTICS_EVENT_NAMES` is the runtime allow-list of `AnalyticsEventName` (core.ts only exports the type); the
 * `Record<AnalyticsEventName, true>` shape makes it a compile error to forget a name.
 */
import crypto from 'node:crypto';
import type { AnalyticsEventName, AnalyticsProps, EpochMs, Id } from '@shared/core';
import { ANON_ANALYTICS_EVENTS, ANON_ENTITY_TYPES, PRE_AUTH_ANALYTICS_EVENTS } from '@shared/core';
import { config } from '../config';
import { newId, prep } from '../db/index';
import { DAY, MIN, now } from './clock';
import { log } from './logger';
import { getUniversityRow } from './universities';

export interface TrackContext {
  userId: Id | null;
  universityId: Id | null;
  sessionId?: string | null;
}

const EVENT_NAME_TABLE: Record<AnalyticsEventName, true> = {
  app_open: true, screen_view: true, home_tab_view: true, share_click: true, invite_link_copied: true, invite_link_opened: true,
  signup_started: true, signup_code_sent: true, signup_verified: true, signup_completed: true, onboarding_step: true,
  onboarding_completed: true, login: true,
  follow: true, unfollow: true, block: true, report_submitted: true,
  reel_view: true, reel_complete: true, reel_like: true, reel_comment: true, reel_upload: true,
  post_create: true, post_like: true, post_comment: true,
  buzz_feed_view: true, buzz_post: true, buzz_reply: true, buzz_vote: true, buzz_poll_vote: true, buzz_gate_accepted: true,
  search: true, profile_view: true, suggestion_dismiss: true,
  message_send: true, conversation_open: true, request_accept: true, request_decline: true,
  roommate_profile_publish: true, roommate_view: true, roommate_save: true, roommate_message: true,
  listing_create: true, listing_view: true, listing_save: true, listing_message: true, listing_offer: true, listing_sold: true,
  event_view: true, event_rsvp: true, event_create: true, course_join: true, course_create: true,
  'apartments.page_view': true, 'apartments.dwell': true, 'apartments.cta_click': true, 'apartments.cta_undo': true,
  'apartments.survey_start': true, 'apartments.survey_answer': true, 'apartments.survey_complete': true,
  'apartments.share_click': true, 'apartments.roommates_crosslink_click': true,
};

/** Every `AnalyticsEventName` at runtime (POST /analytics/track drops anything else silently). */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = Object.keys(EVENT_NAME_TABLE) as AnalyticsEventName[];

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(EVENT_NAME_TABLE, name);
}

export function isAnonAnalyticsEvent(name: AnalyticsEventName): boolean {
  return ANON_ANALYTICS_EVENTS.includes(name);
}

export function isPreAuthAnalyticsEvent(name: AnalyticsEventName): boolean {
  return PRE_AUTH_ANALYTICS_EVENTS.includes(name);
}

const MAX_PROPS = 40;
const MAX_STRING = 200;

/** Prop keys are short identifiers; anything else (e.g. 20 KB keys from a signed-out caller) is dropped. */
const PROP_KEY_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Hard cap on one row's serialized props (denial-of-wallet: signed-out callers can post events). */
const MAX_PROPS_BYTES = 4096;

/**
 * Primitive values only, ≤ 40 keys matching PROP_KEY_RE, strings ≤ 200 chars, ≤ 4 KB serialized; anonymous events drop
 * every key ending in "id".
 */
export function sanitizeProps(props: AnalyticsProps | undefined, anonymous: boolean): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props || typeof props !== 'object') return out;
  let n = 0;
  let bytes = 2; // "{}"
  for (const [key, raw] of Object.entries(props)) {
    if (n >= MAX_PROPS) break;
    if (!PROP_KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) continue;
    // anonymous rows keep no join key: no *id, and no exact client / event timestamp (clientTs would pair the row
    // with the user-linked event of the same batch, SPEC §3.2 #8)
    if (anonymous && (/id$/i.test(key) || /(?:^ts|Ts|At|Time|timestamp)$/.test(key))) continue;
    let value: string | number | boolean | null;
    if (raw === null || typeof raw === 'boolean') value = raw;
    else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) continue;
      value = raw;
    } else if (typeof raw === 'string') value = raw.length > MAX_STRING ? raw.slice(0, MAX_STRING) : raw;
    else continue;
    const cost = JSON.stringify(key).length + JSON.stringify(value).length + 2; // "k":v,
    if (bytes + cost > MAX_PROPS_BYTES) continue;
    out[key] = value;
    bytes += cost;
    n += 1;
  }
  return out;
}

/**
 * A generic event about a Buzz entity (e.g. `share_click {kind:'buzz'}` from the Buzz share sheet) takes the anonymous
 * path too: a user-linked row naming a Buzz thread would be an unaudited user ↔ Buzz trail (SPEC §3.2 #8).
 */
function isBuzzScoped(props: AnalyticsProps | undefined): boolean {
  const kind = props?.kind ?? props?.entityType;
  return typeof kind === 'string' && (ANON_ENTITY_TYPES as readonly string[]).includes(kind);
}

/** Daily salt derived from the cursor secret (never persisted; rotates at UTC midnight). */
function dailySalt(at: EpochMs): string {
  const day = Math.floor(at / DAY);
  return crypto.createHmac('sha256', config.cursorSecret).update(`analytics-daily-salt:${day}`).digest('hex');
}

export function anonHashFor(userId: Id, at: EpochMs = now()): string {
  return crypto.createHmac('sha256', dailySalt(at)).update(userId).digest('base64url').slice(0, 32);
}

function visibleUniversityId(universityId: Id | null): Id | null {
  if (!universityId) return null;
  const row = getUniversityRow(universityId);
  if (!row) return universityId;
  return row.is_hidden ? null : universityId;
}

/**
 * Stores one `analytics_events` row. Never throws. Slices call it on server-side conversions
 * (create / like / RSVP / …); the client `track()` covers views and taps through POST /analytics/track.
 */
export function trackEvent(name: AnalyticsEventName, ctx: TrackContext, props?: AnalyticsProps, at?: EpochMs): void {
  try {
    if (!isAnalyticsEventName(name)) return;
    const when = typeof at === 'number' && Number.isFinite(at) ? at : now();
    const anonymous = isAnonAnalyticsEvent(name) || isBuzzScoped(props);
    const createdAt = anonymous ? Math.floor(when / MIN) * MIN : when;
    const userId = anonymous ? null : (ctx.userId ?? null);
    const anonHash = anonymous && ctx.userId ? anonHashFor(ctx.userId, when) : null;
    const sessionId = anonymous ? null : (ctx.sessionId ?? null);
    prep(
      `INSERT INTO analytics_events (id, name, user_id, anon_hash, university_id, session_id, props_json, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(newId(), name, userId, anonHash, visibleUniversityId(ctx.universityId ?? null), sessionId, JSON.stringify(sanitizeProps(props, anonymous)), createdAt);
  } catch (err) {
    log.error(`trackEvent(${name}) failed`, err);
  }
}
