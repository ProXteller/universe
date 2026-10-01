/**
 * Onboarding follow suggestions (SPEC §5.1). Core tables ONLY: `users`, `follows`, `blocks`, `universities`,
 * `public_activity` (through `publicActivityStats`). Never a slice table, never Buzz — the result is identical with
 * every slice table empty.
 *
 * Statements are prepared lazily through `prep()` (R4: no DB access at import time).
 */
import type { Id, UserListItem } from '@shared/core';
import {
  ONBOARDING_ACTIVE_WINDOW_DAYS, ONBOARDING_NEW_CAMPUS_THRESHOLD, ONBOARDING_SECTION_ROWS,
  type OnboardingSuggestionRow, type OnboardingSuggestionSection, type OnboardingSuggestions,
} from '@shared/auth';
import { db, prep } from '../../db/index';
import { DAY, now } from '../../lib/clock';
import { blockedIdsFor, followingIdsOf } from '../../lib/graph';
import type { AuthedUser } from '../../lib/users';
import { getUserRow, publicActivityStats, universityRef, userListItemsByIds, type UserRow } from '../../lib/users';

/* ───────────────────────────── helpers ───────────────────────────── */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Everyone the viewer must never be offered: self, already followed, blocked either way. */
function excludedIdsFor(viewer: AuthedUser): Set<Id> {
  const out = new Set<Id>([viewer.id]);
  for (const id of followingIdsOf(viewer.id)) out.add(id);
  for (const id of blockedIdsFor(viewer.id)) out.add(id);
  return out;
}

/** Active users at the campus other than the viewer (hidden campuses always count as "new"). */
function otherActiveUsersAtCampus(viewer: AuthedUser): number {
  const row = prep(
    `SELECT COUNT(*) AS n FROM users u JOIN universities un ON un.id = u.university_id
      WHERE u.university_id = ? AND u.status = 'active' AND u.id != ? AND un.is_hidden = 0`,
  ).get(viewer.universityId, viewer.id) as { n: number };
  return row.n;
}

interface Candidate {
  id: Id;
  follower_count: number;
  major: string | null;
  class_year: number | null;
  org_category: string | null;
  last_public_post_at: number | null;
}

/** `scope` = viewer's campus, or every non-hidden campus for the new-campus variant. */
function scopeSql(viewer: AuthedUser, newCampus: boolean): { sql: string; params: unknown[] } {
  return newCampus
    ? { sql: 'un.is_hidden = 0', params: [] }
    : { sql: 'u.university_id = ? AND un.is_hidden = 0', params: [viewer.universityId] };
}

function candidates(where: string, params: unknown[], order: string, limit: number): Candidate[] {
  return db
    .prepare(
      `SELECT u.id, u.follower_count, u.major, u.class_year, u.org_category, u.last_public_post_at
         FROM users u JOIN universities un ON un.id = u.university_id
        WHERE u.status = 'active' AND ${where}
        ORDER BY ${order}, u.id
        LIMIT ?`,
    )
    .all(...params, limit) as Candidate[];
}

/** Fetch generously, drop excluded / already-shown ids, keep the first `ONBOARDING_SECTION_ROWS`. */
function pickRows(list: Candidate[], skip: Set<Id>): Candidate[] {
  const out: Candidate[] = [];
  for (const c of list) {
    if (skip.has(c.id)) continue;
    out.push(c);
    skip.add(c.id);
    if (out.length >= ONBOARDING_SECTION_ROWS) break;
  }
  return out;
}

const FETCH = ONBOARDING_SECTION_ROWS * 6;

/* ───────────────────────────── sections ───────────────────────────── */

function popularOrgs(viewer: AuthedUser, newCampus: boolean, skip: Set<Id>): Candidate[] {
  const scope = scopeSql(viewer, newCampus);
  return pickRows(candidates(`u.account_type = 'org' AND ${scope.sql}`, scope.params, 'u.follower_count DESC', FETCH), skip);
}

function inMajor(viewer: AuthedUser, me: UserRow, newCampus: boolean, skip: Set<Id>): Candidate[] {
  if (!me.major) return [];
  const scope = scopeSql(viewer, newCampus);
  return pickRows(
    candidates(`u.account_type = 'student' AND u.major = ? COLLATE NOCASE AND ${scope.sql}`, [me.major, ...scope.params], 'u.follower_count DESC', FETCH),
    skip,
  );
}

function classYear(viewer: AuthedUser, me: UserRow, newCampus: boolean, skip: Set<Id>): Candidate[] {
  if (me.class_year === null) return [];
  const scope = scopeSql(viewer, newCampus);
  return pickRows(
    candidates(`u.account_type = 'student' AND u.class_year = ? AND ${scope.sql}`, [me.class_year, ...scope.params], 'u.follower_count DESC', FETCH),
    skip,
  );
}

function activeStudents(viewer: AuthedUser, newCampus: boolean, since: number, skip: Set<Id>): Candidate[] {
  const scope = scopeSql(viewer, newCampus);
  return pickRows(
    candidates(`u.account_type = 'student' AND u.last_public_post_at >= ? AND ${scope.sql}`, [since, ...scope.params], 'u.last_public_post_at DESC', FETCH),
    skip,
  );
}

/* ───────────────────────────── reasons ───────────────────────────── */

function orgReason(c: Candidate): string {
  return `Org · ${plural(c.follower_count, 'follower')}`;
}

function majorReason(c: Candidate): string {
  return c.class_year ? `Same major · Class of ${c.class_year}` : 'Same major';
}

function yearReason(c: Candidate): string {
  return c.major ? `Class of ${c.class_year} · ${c.major}` : `Class of ${c.class_year}`;
}

function activeReason(c: Candidate, stats: Map<Id, { reels: number; posts: number; events: number }>): string {
  const s = stats.get(c.id);
  const parts: string[] = [];
  if (s?.reels) parts.push(plural(s.reels, 'reel'));
  if (s?.posts) parts.push(plural(s.posts, 'post'));
  if (s?.events) parts.push(plural(s.events, 'event'));
  const activity = parts.length ? `${parts.join(' · ')} this month` : 'Active this month';
  return c.major ? `${c.major} · ${activity}` : activity;
}

/* ───────────────────────────── assembly ───────────────────────────── */

function toRows(
  list: Candidate[],
  items: Map<Id, UserListItem>,
  reason: (c: Candidate) => string,
): OnboardingSuggestionRow[] {
  const out: OnboardingSuggestionRow[] = [];
  for (const c of list) {
    const user = items.get(c.id);
    if (!user) continue; // userListItemsByIds already dropped blocked / non-active rows
    out.push({ user, reason: reason(c), tag: null });
  }
  return out;
}

export function buildSuggestions(viewer: AuthedUser): OnboardingSuggestions {
  const me = getUserRow(viewer.id);
  if (!me) return { isNewCampus: false, inviter: null, sections: [] };

  const isNewCampus = otherActiveUsersAtCampus(viewer) < ONBOARDING_NEW_CAMPUS_THRESHOLD;
  const excluded = excludedIdsFor(viewer);
  const blocked = blockedIdsFor(viewer.id);
  const uni = universityRef(viewer.universityId);

  // Inviter: pinned first whenever they are still a visible account (even when already followed, so a refresh of the
  // follow step keeps the row — the FollowButton then simply reads "Following").
  let inviterRow: OnboardingSuggestionRow | null = null;
  const inviterId = me.invited_by;
  if (inviterId && inviterId !== viewer.id && !blocked.has(inviterId)) {
    const [item] = userListItemsByIds([inviterId], viewer.id);
    if (item) {
      inviterRow = { user: item, reason: `Invited you · ${item.universityShortName}`, tag: 'invited_you' };
      excluded.add(inviterId);
    }
  }

  // Sections (each deduped against the previous ones through the shared `skip` set).
  const skip = new Set<Id>(excluded);
  const orgs = popularOrgs(viewer, isNewCampus, skip);
  const isStudent = me.account_type === 'student';
  const major = isStudent ? inMajor(viewer, me, isNewCampus, skip) : [];
  const year = isStudent && major.length === 0 ? classYear(viewer, me, isNewCampus, skip) : [];
  const since = now() - ONBOARDING_ACTIVE_WINDOW_DAYS * DAY;
  const active = activeStudents(viewer, isNewCampus, since, skip);

  const allIds = [...orgs, ...major, ...year, ...active].map((c) => c.id);
  const items = new Map<Id, UserListItem>();
  for (const item of userListItemsByIds(allIds, viewer.id)) items.set(item.id, item);
  const stats = publicActivityStats(active.map((c) => c.id), since);

  const sections: OnboardingSuggestionSection[] = [];
  const orgRows = toRows(orgs, items, orgReason);
  if (orgRows.length) sections.push({ id: 'popular_orgs', title: isNewCampus ? 'Popular orgs on other campuses' : `Popular at ${uni.name}`, rows: orgRows });
  const majorRows = toRows(major, items, majorReason);
  if (majorRows.length) sections.push({ id: 'in_major', title: `In ${me.major}`, rows: majorRows });
  const yearRows = toRows(year, items, yearReason);
  if (yearRows.length) sections.push({ id: 'class_year', title: `Class of ${me.class_year}`, rows: yearRows });
  const activeRows = toRows(active, items, (c) => activeReason(c, stats));
  if (activeRows.length) sections.push({ id: 'active', title: isNewCampus ? 'Active on other campuses' : 'Active on campus', rows: activeRows });

  return { isNewCampus, inviter: inviterRow, sections };
}
