/**
 * Discover home (SPEC §5.5 `GET /discover/home`): three suggestion sections, each with a reason derived from
 * real rows. Inputs come ONLY from core tables — users, follows, blocks, universities, public_activity — plus the
 * slice's own dismissals. Never Buzz (SPEC §3.2 #5).
 *
 *  - People you may know: same campus ∧ (same major ∨ same class year ∨ ≥ 1 mutual), ranked by mutuals. A "mutual"
 *    is defined ONCE — the SQL below mirrors foundation `mutualsBetween` (active, unblocked either way) — so the
 *    gate, the ranking and the displayed reason never disagree.
 *  - Active creators: `users.last_public_post_at` within 14 days (written only by markPublicActivity), campus first.
 *  - Popular orgs: campus orgs by follower_count.
 * Every section excludes followed, blocked (both ways), dismissed, self, non-active and hidden-campus accounts;
 * minors are never suggested cross-campus (and a minor viewer only sees their own campus).
 */
import type { Id, UserListItem } from '@shared/core';
import type { DiscoverHome, Suggestion, SuggestionSection } from '@shared/discover';
import { ACTIVE_CREATOR_WINDOW_DAYS, DISCOVER_HOME_LIMITS } from '@shared/discover';
import { db } from '../../db/index';
import { DAY, now } from '../../lib/clock';
import { mutualsBetween } from '../../lib/graph';
import { publicActivityStats, universityRef, userListItemsByIds, type AuthedUser } from '../../lib/users';
import { campusMemberCount, plural, suggestionExclusionsSql, visibleUsersSql } from './common';

const EARLY_CAMPUS_MEMBERS = 25;
/** Over-fetch so that rows dropped by `userListItemsByIds` (race with a block) still leave a full section. */
const OVERFETCH = 8;

/* ───────────────────────────── reasons ───────────────────────────── */

const MINOR_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'with']);

/** "Computer Science" → "CS", "Electrical & Computer Engineering" → "ECE", "Nursing" → "Nursing". */
export function majorShort(major: string): string {
  const cleaned = major.replace(/\([^)]*\)/g, ' ').trim();
  const words = cleaned.split(/[\s&,/]+/).filter((w) => /^[A-Za-z]/.test(w) && !MINOR_WORDS.has(w.toLowerCase()));
  if (words.length >= 2 && cleaned.length > 12) return words.slice(0, 4).map((w) => w[0]!.toUpperCase()).join('');
  return cleaned || major;
}

interface PymkRow {
  id: Id;
  major: string | null;
  class_year: number | null;
  mutuals: number;
}

function pymkReason(row: PymkRow, viewer: { major: string | null; classYear: number | null }, mutualCount: number): string {
  const parts: string[] = [];
  if (row.major && viewer.major && row.major.toLowerCase() === viewer.major.toLowerCase()) parts.push(majorShort(row.major));
  else if (row.class_year !== null && viewer.classYear !== null && row.class_year === viewer.classYear) parts.push(`Class of ${row.class_year}`);
  if (mutualCount > 0) parts.push(plural(mutualCount, 'mutual'));
  if (parts.length === 0) parts.push('On your campus');
  return parts.join(' · ');
}

function creatorReason(recent: { reels: number; posts: number; events: number }, older: { reels: number; posts: number; events: number }): string {
  const weekTotal = recent.reels + recent.posts + recent.events;
  const s = weekTotal > 0 ? recent : older;
  const suffix = weekTotal > 0 ? 'this week' : 'in the last 2 weeks';
  const kinds: [number, string][] = [
    [s.reels, 'reel'],
    [s.posts, 'post'],
    [s.events, 'event'],
  ];
  kinds.sort((a, b) => b[0] - a[0]);
  const top = kinds[0]!;
  if (top[0] <= 0) return 'Posting publicly';
  return `${plural(top[0], top[1])} ${suffix}`;
}

/* ───────────────────────────── viewer profile bits ───────────────────────────── */

interface ViewerBits {
  major: string | null;
  classYear: number | null;
  isMinor: boolean;
}

function viewerBits(viewer: AuthedUser): ViewerBits {
  const row = db.prepare('SELECT major, class_year, is_adult FROM users WHERE id = ?').get(viewer.id) as
    | { major: string | null; class_year: number | null; is_adult: number | null }
    | undefined;
  return { major: row?.major ?? null, classYear: row?.class_year ?? null, isMinor: row?.is_adult === 0 };
}

/* ───────────────────────────── sections ───────────────────────────── */

function withUsers(ids: Id[], viewerId: Id, limit: number): Map<Id, UserListItem> {
  const items = userListItemsByIds(ids, viewerId);
  const out = new Map<Id, UserListItem>();
  for (const it of items) {
    if (out.size >= limit) break;
    out.set(it.id, it);
  }
  return out;
}

export function peopleYouMayKnow(viewer: AuthedUser, bits: ViewerBits): Suggestion[] {
  const section: SuggestionSection = 'people_you_may_know';
  const limit = DISCOVER_HOME_LIMITS.peopleYouMayKnow;
  const vis = visibleUsersSql(viewer.id, 'u');
  const ex = suggestionExclusionsSql(viewer.id, 'u', section);
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT u.id, u.major, u.class_year, u.follower_count,
                (SELECT COUNT(*) FROM follows _mine
                   JOIN follows _theirs ON _theirs.follower_id = _mine.followee_id AND _theirs.followee_id = u.id
                   JOIN users _mu ON _mu.id = _mine.followee_id AND _mu.status = 'active'
                  WHERE _mine.follower_id = ? AND _mine.followee_id != u.id
                    AND NOT EXISTS (SELECT 1 FROM blocks _mb WHERE (_mb.blocker_id = ? AND _mb.blocked_id = _mine.followee_id)
                                                              OR (_mb.blocker_id = _mine.followee_id AND _mb.blocked_id = ?))) AS mutuals
           FROM users u
          WHERE u.university_id = ? AND u.account_type = 'student' AND ${vis.sql} AND ${ex.sql}
       ) c
       WHERE (? IS NOT NULL AND lower(c.major) = lower(?)) OR (? IS NOT NULL AND c.class_year = ?) OR c.mutuals >= 1
       ORDER BY c.mutuals DESC, c.follower_count DESC, c.id
       LIMIT ?`,
    )
    .all(viewer.id, viewer.id, viewer.id, viewer.universityId, ...vis.params, ...ex.params, bits.major, bits.major, bits.classYear, bits.classYear, limit + OVERFETCH) as PymkRow[];
  const users = withUsers(rows.map((r) => r.id), viewer.id, limit);
  const out: Suggestion[] = [];
  for (const r of rows) {
    const user = users.get(r.id);
    if (!user) continue;
    // Same helper the profile's mutual line uses; its definition equals the SQL `mutuals` above, so the count
    // shown here is the one the row was ranked and admitted by.
    const m = mutualsBetween(viewer.id, r.id, 1);
    out.push({ user, reason: pymkReason(r, bits, m.count), section });
  }
  return out;
}

export function activeCreators(viewer: AuthedUser, bits: ViewerBits): Suggestion[] {
  const section: SuggestionSection = 'active_creators';
  const limit = DISCOVER_HOME_LIMITS.activeCreators;
  const at = now();
  const since14 = at - ACTIVE_CREATOR_WINDOW_DAYS * DAY;
  const since7 = at - 7 * DAY;
  const vis = visibleUsersSql(viewer.id, 'u');
  const ex = suggestionExclusionsSql(viewer.id, 'u', section);
  const campusOnly = bits.isMinor ? 'AND u.university_id = ?' : 'AND (u.university_id = ? OR u.is_adult = 1)';
  const rows = db
    .prepare(
      `SELECT u.id, u.university_id
         FROM users u
        WHERE u.last_public_post_at IS NOT NULL AND u.last_public_post_at >= ? AND ${vis.sql} AND ${ex.sql} ${campusOnly}
        ORDER BY (u.university_id = ?) DESC, u.last_public_post_at DESC, u.id
        LIMIT ?`,
    )
    .all(since14, ...vis.params, ...ex.params, viewer.universityId, viewer.universityId, (limit + OVERFETCH) * 3) as { id: Id; university_id: Id }[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const stats14 = publicActivityStats(ids, since14);
  const stats7 = publicActivityStats(ids, since7);
  const total = (s: { reels: number; posts: number; events: number } | undefined): number => (s ? s.reels + s.posts + s.events : 0);
  const ranked = rows
    .map((r) => ({ ...r, n: total(stats14.get(r.id)) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => {
      const ca = a.university_id === viewer.universityId ? 0 : 1;
      const cb = b.university_id === viewer.universityId ? 0 : 1;
      return ca - cb || b.n - a.n || (a.id < b.id ? -1 : 1);
    });
  const users = withUsers(ranked.map((r) => r.id), viewer.id, limit);
  const zero = { reels: 0, posts: 0, events: 0 };
  const out: Suggestion[] = [];
  for (const r of ranked) {
    const user = users.get(r.id);
    if (!user) continue;
    out.push({ user, reason: creatorReason(stats7.get(r.id) ?? zero, stats14.get(r.id) ?? zero), section });
  }
  return out;
}

export function popularOrgs(viewer: AuthedUser): Suggestion[] {
  const section: SuggestionSection = 'popular_orgs';
  const limit = DISCOVER_HOME_LIMITS.popularOrgs;
  const vis = visibleUsersSql(viewer.id, 'u');
  const ex = suggestionExclusionsSql(viewer.id, 'u', section);
  const rows = db
    .prepare(
      `SELECT u.id, u.follower_count, u.university_id
         FROM users u
        WHERE u.university_id = ? AND u.account_type = 'org' AND ${vis.sql} AND ${ex.sql}
        ORDER BY u.follower_count DESC, u.id
        LIMIT ?`,
    )
    .all(viewer.universityId, ...vis.params, ...ex.params, limit + OVERFETCH) as { id: Id; follower_count: number; university_id: Id }[];
  const users = withUsers(rows.map((r) => r.id), viewer.id, limit);
  const campus = universityRef(viewer.universityId).shortName;
  const out: Suggestion[] = [];
  for (const r of rows) {
    const user = users.get(r.id);
    if (!user) continue;
    out.push({ user, reason: `${plural(r.follower_count, 'follower')} at ${campus}`, section });
  }
  return out;
}

export function discoverHome(viewer: AuthedUser): DiscoverHome {
  const bits = viewerBits(viewer);
  return {
    peopleYouMayKnow: peopleYouMayKnow(viewer, bits),
    activeCreators: activeCreators(viewer, bits),
    popularOrgs: popularOrgs(viewer),
    isEarlyCampus: campusMemberCount(viewer.universityId) < EARLY_CAMPUS_MEMBERS,
  };
}
