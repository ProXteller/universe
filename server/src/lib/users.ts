/**
 * User rows → API shapes, public-activity bookkeeping (SPEC §4.2.5).
 * Every serializer here is PUBLIC-surface only. Nothing in this file may ever be used to build a Buzz payload.
 */
import type {
  AccountType, ClassKind, EpochMs, Id, MeUser, OrgCategory, PublicActivityKind, PublicUser, Role, University,
  UniversityRef, UserListItem, UserSettings, UserStatus, UserSummary, ViewerRelation,
} from '@shared/core';
import { DEFAULT_USER_SETTINGS, GUIDELINES_VERSION } from '@shared/core';
import { db, inClause, json, newId, prep } from '../db/index';
import { DAY, HOUR, now } from './clock';
import { activeSanctionFor, activeStrikePoints } from './sanctions';
import { currencyFor, getUniversityRow } from './universities';

/* ───────────────────────────── types ───────────────────────────── */

export interface UserRow {
  id: Id;
  email: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string;
  account_type: AccountType;
  role: Role;
  status: UserStatus;
  university_id: Id;
  bio: string;
  major: string | null;
  class_year: number | null;
  class_kind: ClassKind | null;
  pronouns: string | null;
  interests_json: string;
  org_category: string | null;
  is_verified: number;
  is_adult: number | null;
  is_adult_edited: number;
  campus_rank: number;
  invite_code: string;
  invited_by: Id | null;
  guidelines_version: string | null;
  guidelines_accepted_at: EpochMs | null;
  buzz_gate_version: string | null;
  buzz_gate_accepted_at: EpochMs | null;
  profile_completed_at: EpochMs | null;
  onboarding_completed_at: EpochMs | null;
  settings_json: string;
  handle_changed_at: EpochMs | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  reel_count: number;
  last_public_post_at: EpochMs | null;
  last_active_at: EpochMs | null;
  restricted_until: EpochMs | null;
  deleted_at: EpochMs | null;
  created_at: EpochMs;
  updated_at: EpochMs;
}

/** The signed-in user as seen by handlers (`req.user`). Re-exported from `middleware/auth.ts`. */
export interface AuthedUser {
  id: Id;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  role: Role;
  accountType: AccountType;
  status: UserStatus;
  universityId: Id;
  universityShortName: string;
  countryCode: string;
  isAdult: boolean | null;
  createdAt: EpochMs;
  accountAgeMs: number;
  /** Account age < 72 h, or `restricted_until` still in the future (72 h after a suspension ends). */
  isNewAccount: boolean;
  activeStrikePoints: number;
  /** Passes `requireOnboarded`: profile completed AND the current app guidelines accepted. */
  onboardingCompleted: boolean;
}

export const NEW_ACCOUNT_WINDOW_MS = 72 * HOUR;
/** "New account" CHIP on public surfaces (PublicUser / UserListItem): account age < 7 days. */
export const NEW_ACCOUNT_CHIP_MS = 7 * DAY;
export const HANDLE_CHANGE_COOLDOWN_MS = 14 * DAY;
export const FOUNDING_MEMBER_MAX_RANK = 100;

/* ───────────────────────────── lookups ───────────────────────────── */

export function getUserRow(id: Id): UserRow | null {
  return (prep('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
}

export function getUserByHandle(handle: string): UserRow | null {
  return (prep('SELECT * FROM users WHERE handle = ? COLLATE NOCASE').get(handle) as UserRow | undefined) ?? null;
}

/**
 * The live account (never a deleted tombstone) registered under `email`. `DELETE /me` rewrites the tombstone's email
 * to `tombstoneEmail(id)` so the address can sign up again; the status filter is defence in depth for older rows.
 */
export function getUserByEmail(email: string): UserRow | null {
  return (prep("SELECT * FROM users WHERE email = ? COLLATE NOCASE AND status != 'deleted'").get(email) as UserRow | undefined) ?? null;
}

/** The placeholder `users.email` of a deleted account (`users.email` is UNIQUE; `.invalid` is reserved, RFC 2606). */
export function tombstoneEmail(userId: Id): string {
  return `deleted+${userId}@deleted.invalid`;
}

export function getUserRowsByIds(ids: readonly Id[]): Map<Id, UserRow> {
  const out = new Map<Id, UserRow>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const inc = inClause(chunk);
    const rows = db.prepare(`SELECT * FROM users WHERE id IN ${inc.sql}`).all(...inc.params) as UserRow[];
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

/* ───────────────────────────── universities ───────────────────────────── */

export function universityRef(id: Id): UniversityRef {
  const row = getUniversityRow(id);
  return row ? { id: row.id, name: row.name, shortName: row.short_name } : { id, name: 'Unknown campus', shortName: 'Campus' };
}

/** `memberCount` is a real COUNT of active users (product rule 5: numbers are real). */
export function getUniversity(id: Id): University {
  const row = getUniversityRow(id);
  const members = prep("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(id) as { n: number };
  if (!row) {
    return { ...universityRef(id), domain: '', countryCode: 'US', currency: currencyFor('US'), city: null, memberCount: members.n };
  }
  return {
    id: row.id, name: row.name, shortName: row.short_name, domain: row.domain, countryCode: row.country_code,
    currency: currencyFor(row.country_code), city: row.city, memberCount: members.n,
  };
}

/* ───────────────────────────── serializers ───────────────────────────── */

export function avatarUrlFor(row: Pick<UserRow, 'avatar_url' | 'avatar_seed' | 'account_type'>): string {
  return row.avatar_url ?? `/api/avatars/${encodeURIComponent(row.avatar_seed)}.svg?t=${row.account_type}`;
}

export function toUserSummary(row: UserRow): UserSummary {
  const uni = universityRef(row.university_id);
  if (row.status === 'deleted') {
    return {
      id: row.id, handle: 'deleted', displayName: 'Deleted account',
      avatarUrl: avatarUrlFor({ avatar_url: null, avatar_seed: 'deleted', account_type: 'student' }),
      accountType: row.account_type, isVerified: false, universityId: row.university_id, universityShortName: uni.shortName,
    };
  }
  return {
    id: row.id, handle: row.handle, displayName: row.display_name, avatarUrl: avatarUrlFor(row),
    accountType: row.account_type, isVerified: row.account_type === 'org' && row.is_verified === 1,
    universityId: row.university_id, universityShortName: uni.shortName,
  };
}

/** Missing ids are simply absent from the map. Deleted users come back as tombstones. */
export function userSummariesByIds(ids: Id[]): Map<Id, UserSummary> {
  const out = new Map<Id, UserSummary>();
  for (const [id, row] of getUserRowsByIds(ids)) out.set(id, toUserSummary(row));
  return out;
}

const isFollowingStmt = (): ReturnType<typeof prep> => prep('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?');
const isBlockedStmt = (): ReturnType<typeof prep> => prep('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?');

function follows(a: Id, b: Id): boolean {
  return isFollowingStmt().get(a, b) !== undefined;
}

function listItemBase(row: UserRow): Omit<UserListItem, 'viewer'> {
  return {
    ...toUserSummary(row),
    bio: row.status === 'deleted' ? '' : row.bio,
    major: row.status === 'deleted' ? null : row.major,
    classYear: row.status === 'deleted' ? null : row.class_year,
    isNewAccount: now() - row.created_at < NEW_ACCOUNT_CHIP_MS,
  };
}

export function toUserListItem(row: UserRow, viewerId: Id | null): UserListItem {
  const isSelf = viewerId === row.id;
  return {
    ...listItemBase(row),
    viewer: {
      isSelf,
      isFollowing: !!viewerId && !isSelf && follows(viewerId, row.id),
      isFollowedBy: !!viewerId && !isSelf && follows(row.id, viewerId),
    },
  };
}

/** Order preserved; blocked (either direction) and non-active users removed. */
export function userListItemsByIds(ids: Id[], viewerId: Id | null): UserListItem[] {
  if (ids.length === 0) return [];
  const rows = getUserRowsByIds(ids);
  const following = new Set<Id>();
  const followedBy = new Set<Id>();
  const blocked = new Set<Id>();
  if (viewerId) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 400) {
      const inc = inClause(unique.slice(i, i + 400));
      for (const r of db.prepare(`SELECT followee_id AS id FROM follows WHERE follower_id = ? AND followee_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[]) following.add(r.id);
      for (const r of db.prepare(`SELECT follower_id AS id FROM follows WHERE followee_id = ? AND follower_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[]) followedBy.add(r.id);
      for (const r of db.prepare(`SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? AND blocked_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[]) blocked.add(r.id);
      for (const r of db.prepare(`SELECT blocker_id AS id FROM blocks WHERE blocked_id = ? AND blocker_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[]) blocked.add(r.id);
    }
  }
  const out: UserListItem[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row || row.status !== 'active' || blocked.has(id)) continue;
    const isSelf = viewerId === id;
    out.push({
      ...listItemBase(row),
      viewer: { isSelf, isFollowing: !isSelf && following.has(id), isFollowedBy: !isSelf && followedBy.has(id) },
    });
  }
  return out;
}

function mutuals(viewerId: Id, userId: Id, limit: number): { count: number; sample: Id[] } {
  const base = `FROM follows mine
      JOIN follows theirs ON theirs.follower_id = mine.followee_id AND theirs.followee_id = ?
      JOIN users u ON u.id = mine.followee_id AND u.status = 'active'
     WHERE mine.follower_id = ? AND mine.followee_id != ?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = mine.followee_id)
                                                 OR (b.blocker_id = mine.followee_id AND b.blocked_id = ?))`;
  const args = [userId, viewerId, userId, viewerId, viewerId];
  const count = (prep(`SELECT COUNT(*) AS n ${base}`).get(...args) as { n: number }).n;
  const sample = count === 0 ? [] : (prep(`SELECT mine.followee_id AS id ${base} ORDER BY u.follower_count DESC, u.id LIMIT ?`).all(...args, limit) as { id: Id }[]).map((r) => r.id);
  return { count, sample };
}

/** Accounts the viewer follows who follow `userId` (blocked + non-active excluded). Re-exported by lib/graph.ts. */
export function mutualsBetween(viewerId: Id, userId: Id, limit = 3): { count: number; sample: Id[] } {
  if (viewerId === userId) return { count: 0, sample: [] };
  return mutuals(viewerId, userId, limit);
}

function viewerRelation(row: UserRow, viewerId: Id | null): ViewerRelation {
  if (!viewerId || viewerId === row.id) {
    return { isSelf: viewerId === row.id, isFollowing: false, isFollowedBy: false, isBlockedByMe: false, mutualCount: 0, mutualSample: [] };
  }
  const isBlockedByMe = isBlockedStmt().get(viewerId, row.id) !== undefined;
  if (isBlockedByMe) {
    return { isSelf: false, isFollowing: false, isFollowedBy: false, isBlockedByMe: true, mutualCount: 0, mutualSample: [] };
  }
  const m = mutualsBetween(viewerId, row.id, 3);
  const summaries = userSummariesByIds(m.sample);
  return {
    isSelf: false,
    isFollowing: follows(viewerId, row.id),
    isFollowedBy: follows(row.id, viewerId),
    isBlockedByMe: false,
    mutualCount: m.count,
    mutualSample: m.sample.map((id) => summaries.get(id)).filter((s): s is UserSummary => !!s),
  };
}

/** When the viewer has blocked the target: a shell with `viewer.isBlockedByMe` and zeroed counts / bio (#22). */
export function toPublicUser(row: UserRow, viewerId: Id | null): PublicUser {
  const viewer = viewerRelation(row, viewerId);
  const shell = viewer.isBlockedByMe || row.status === 'deleted';
  return {
    ...toUserSummary(row),
    bio: shell ? '' : row.bio,
    major: shell ? null : row.major,
    classYear: shell ? null : row.class_year,
    classKind: shell ? null : row.class_kind,
    pronouns: shell ? null : row.pronouns,
    interests: shell ? [] : json<string[]>(row.interests_json, []),
    orgCategory: shell ? null : (row.org_category as OrgCategory | null),
    university: universityRef(row.university_id),
    followerCount: shell ? 0 : row.follower_count,
    followingCount: shell ? 0 : row.following_count,
    postCount: shell ? 0 : row.post_count,
    reelCount: shell ? 0 : row.reel_count,
    isFoundingMember: !shell && row.campus_rank > 0 && row.campus_rank <= FOUNDING_MEMBER_MAX_RANK,
    isNewAccount: now() - row.created_at < NEW_ACCOUNT_CHIP_MS,
    createdAt: row.created_at,
    viewer,
  };
}

/** Stored settings merged over the defaults; `notifications.safety` is always true. */
export function settingsOf(row: Pick<UserRow, 'settings_json'>): UserSettings {
  const stored = json<Partial<UserSettings>>(row.settings_json, {});
  const d = DEFAULT_USER_SETTINGS;
  return {
    notifications: { ...d.notifications, ...(stored.notifications ?? {}), safety: true },
    quietHours: { ...d.quietHours, ...(stored.quietHours ?? {}) },
    whoCanMessage: stored.whoCanMessage ?? d.whoCanMessage,
    showPresence: stored.showPresence ?? d.showPresence,
    autoplayVideos: stored.autoplayVideos ?? d.autoplayVideos,
    reduceMotion: stored.reduceMotion ?? d.reduceMotion,
  };
}

export function toMeUser(row: UserRow): MeUser {
  const inviter = row.invited_by ? getUserRow(row.invited_by) : null;
  const uni = getUniversityRow(row.university_id);
  const handleFreeAt = row.handle_changed_at ? row.handle_changed_at + HANDLE_CHANGE_COOLDOWN_MS : null;
  return {
    ...toPublicUser(row, row.id),
    email: row.email,
    role: row.role,
    status: row.status,
    isAdult: row.is_adult === null ? null : row.is_adult === 1,
    inviteCode: row.invite_code,
    invitedBy: inviter && inviter.status === 'active' ? toUserSummary(inviter) : null,
    onboarding: {
      profileCompleted: row.profile_completed_at !== null,
      guidelinesAccepted: row.guidelines_version === GUIDELINES_VERSION,
      completed: row.onboarding_completed_at !== null,
    },
    guidelinesAcceptedVersion: row.guidelines_version,
    buzzGateAcceptedVersion: row.buzz_gate_version,
    settings: settingsOf(row),
    activeSanction: activeSanctionFor(row.id),
    handleChangeAvailableAt: handleFreeAt !== null && handleFreeAt > now() ? handleFreeAt : null,
    currency: currencyFor(uni?.country_code),
  };
}

export function toAuthedUser(row: UserRow): AuthedUser {
  const uni = getUniversityRow(row.university_id);
  const at = now();
  const accountAgeMs = Math.max(0, at - row.created_at);
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: avatarUrlFor(row),
    role: row.role,
    accountType: row.account_type,
    status: row.status,
    universityId: row.university_id,
    universityShortName: uni?.short_name ?? 'Campus',
    countryCode: uni?.country_code ?? 'US',
    isAdult: row.is_adult === null ? null : row.is_adult === 1,
    createdAt: row.created_at,
    accountAgeMs,
    isNewAccount: accountAgeMs < NEW_ACCOUNT_WINDOW_MS || (row.restricted_until !== null && row.restricted_until > at),
    activeStrikePoints: activeStrikePoints(row.id),
    onboardingCompleted: row.profile_completed_at !== null && row.guidelines_version === GUIDELINES_VERSION,
  };
}

export function getAuthedUser(idOrHandle: string): AuthedUser | null {
  const row = getUserRow(idOrHandle) ?? getUserByHandle(idOrHandle);
  return row ? toAuthedUser(row) : null;
}

/* ───────────────────────────── public activity ───────────────────────────── */

const COUNTER: Record<PublicActivityKind, 'post_count' | 'reel_count' | null> = { post: 'post_count', reel: 'reel_count', event: null };

/**
 * Upserts `public_activity`, sets `users.last_public_post_at = MAX(old, at)`, increments post_count / reel_count.
 * Call ONLY when the row is `active`. Callers: reels (reel), orbit (post), campus (event). **Buzz MUST NEVER call it.**
 */
export function markPublicActivity(userId: Id, kind: PublicActivityKind, entityId: Id, at: EpochMs = now()): void {
  const user = getUserRow(userId);
  if (!user) return;
  const res = prep(
    'INSERT OR IGNORE INTO public_activity (id, user_id, university_id, kind, entity_id, created_at) VALUES (?,?,?,?,?,?)',
  ).run(newId(), userId, user.university_id, kind, entityId, at);
  if (res.changes === 0) return; // already marked: counters stay equal to the rows
  const counter = COUNTER[kind];
  db.prepare(
    `UPDATE users SET last_public_post_at = MAX(COALESCE(last_public_post_at, 0), ?)${counter ? `, ${counter} = ${counter} + 1` : ''} WHERE id = ?`,
  ).run(at, userId);
}

/** Delete / removal / hide: removes the row, decrements the counter, recomputes `last_public_post_at`. */
export function unmarkPublicActivity(kind: PublicActivityKind, entityId: Id): void {
  const row = prep('SELECT id, user_id FROM public_activity WHERE kind = ? AND entity_id = ?').get(kind, entityId) as
    | { id: Id; user_id: Id }
    | undefined;
  if (!row) return;
  prep('DELETE FROM public_activity WHERE id = ?').run(row.id);
  const counter = COUNTER[kind];
  db.prepare(
    `UPDATE users SET last_public_post_at = (SELECT MAX(created_at) FROM public_activity WHERE user_id = ?)${counter ? `, ${counter} = MAX(${counter} - 1, 0)` : ''} WHERE id = ?`,
  ).run(row.user_id, row.user_id);
}

/** Per-user counts of public activity since `sinceMs` (Discover / auth reason lines). Users with none are absent. */
export function publicActivityStats(userIds: Id[], sinceMs: EpochMs): Map<Id, { reels: number; posts: number; events: number }> {
  const out = new Map<Id, { reels: number; posts: number; events: number }>();
  const unique = [...new Set(userIds)];
  for (let i = 0; i < unique.length; i += 400) {
    const inc = inClause(unique.slice(i, i + 400));
    const rows = db
      .prepare(`SELECT user_id, kind, COUNT(*) AS n FROM public_activity WHERE created_at >= ? AND user_id IN ${inc.sql} GROUP BY user_id, kind`)
      .all(sinceMs, ...inc.params) as { user_id: Id; kind: PublicActivityKind; n: number }[];
    for (const r of rows) {
      const cur = out.get(r.user_id) ?? { reels: 0, posts: 0, events: 0 };
      if (r.kind === 'reel') cur.reels = r.n;
      else if (r.kind === 'post') cur.posts = r.n;
      else cur.events = r.n;
      out.set(r.user_id, cur);
    }
  }
  return out;
}
