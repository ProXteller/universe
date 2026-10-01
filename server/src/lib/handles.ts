/**
 * Handle rules (SPEC §4.2.15): `validateHandle`, `suggestHandles`, `RESERVED_HANDLES`.
 * Format = HANDLE_REGEX (3–20 letters, numbers, underscores). Uniqueness is case-insensitive.
 */
import { HANDLE_REGEX, LIMITS } from '@shared/core';
import { prep } from '../db/index';

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // product / brand / staff impersonation
  'universe', 'universeapp', 'universe_team', 'universe_safety', 'universe_support', 'universe_official', 'team',
  'admin', 'admins', 'administrator', 'moderator', 'moderators', 'mod', 'mods', 'staff', 'support', 'help',
  'helpdesk', 'safety', 'security', 'trust', 'trustandsafety', 'official', 'verified', 'system', 'root', 'sysadmin',
  'owner', 'founder', 'ceo', 'press', 'legal', 'abuse', 'report', 'reports', 'police', 'campuspolice', 'dean',
  'registrar', 'financialaid', 'bursar', 'housing',
  // routes & reserved words
  'api', 'www', 'app', 'web', 'mail', 'email', 'about', 'settings', 'me', 'you', 'user', 'users', 'u', 'i', 'c',
  'home', 'reels', 'reel', 'buzz', 'orbit', 'discover', 'search', 'explore', 'messages', 'message', 'inbox', 'dm',
  'roommates', 'roommate', 'market', 'marketplace', 'apartments', 'campus', 'events', 'event', 'courses', 'course',
  'notifications', 'login', 'logout', 'signin', 'signup', 'signout', 'register', 'welcome', 'onboarding', 'auth',
  'guidelines', 'terms', 'privacy', 'dev', 'test', 'demo', 'static', 'uploads', 'assets', 'new', 'edit',
  'post', 'posts', 'profile', 'invite', 'invites', 'share', 'waitlist', 'analytics', 'ws', 'health',
  // identity sentinels
  'deleted', 'null', 'undefined', 'none', 'nobody', 'anonymous', 'anon', 'everyone', 'all', 'here', 'channel',
  'unknown', 'guest', 'bot',
]);

const RESERVED_PREFIXES = ['universe', 'uv_official', 'admin_', 'mod_', 'staff_', 'anon_'];

export function validateHandle(h: string): 'ok' | 'invalid' | 'reserved' {
  if (typeof h !== 'string' || !HANDLE_REGEX.test(h)) return 'invalid';
  const lower = h.toLowerCase();
  if (RESERVED_HANDLES.has(lower) || RESERVED_PREFIXES.some((p) => lower.startsWith(p))) return 'reserved';
  return 'ok';
}

export function isHandleTaken(handle: string, exceptUserId?: string): boolean {
  const row = prep('SELECT id FROM users WHERE handle = ? COLLATE NOCASE').get(handle) as { id: string } | undefined;
  return !!row && row.id !== exceptUserId;
}

/** `first.last+tag` / "First Last" → a valid-looking base (lowercase, [a-z0-9_], ≤ 17 chars so suffixes fit). */
export function handleBaseFrom(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  let base = ascii.slice(0, LIMITS.handleMax - 3).replace(/_+$/g, '');
  if (base.length < LIMITS.handleMin) base = `${base}${'student'.slice(0, LIMITS.handleMin + 2 - base.length)}`;
  return base;
}

/** Up to `n` AVAILABLE, valid handles derived from `base` (deterministic order). */
export function suggestHandles(base: string, n = 3): string[] {
  const root = handleBaseFrom(base);
  const compact = root.replace(/_/g, '');
  const candidates = [
    root, compact, `${root}_`, `${root}1`, `${root}2`, `${root}7`, `${root}_x`, `its${compact}`.slice(0, LIMITS.handleMax),
    `${root}22`, `${root}26`, `${root}99`, `the${compact}`.slice(0, LIMITS.handleMax), `${root}_01`,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (out.length >= n) break;
    if (seen.has(c) || c.length > LIMITS.handleMax) continue;
    seen.add(c);
    if (validateHandle(c) === 'ok' && !isHandleTaken(c)) out.push(c);
  }
  for (let i = 3; out.length < n && i < 200; i++) {
    const c = `${root}${i}`;
    if (!seen.has(c) && c.length <= LIMITS.handleMax && validateHandle(c) === 'ok' && !isHandleTaken(c)) out.push(c);
  }
  return out;
}
