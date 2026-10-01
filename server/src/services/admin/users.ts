/**
 * Staff user lookup, standing, role grants, org verification and direct (public-origin) sanctions (SPEC §5.11,
 * safety §6.1). FIREWALL: every payload here names a user, so standing comes from foundation's `staffStandingFor`
 * (moderators never see anon-origin rows or counters) and nothing here ever joins Buzz content to a user.
 */
import type { ContentEntityType, Id, Paginated, Role, SanctionKind } from '@shared/core';
import type { StaffSanctionRequest, StaffUserDetail } from '@shared/admin';
import { prep, tx } from '../../db/index';
import { audit } from '../../lib/audit';
import { DAY, now } from '../../lib/clock';
import { ApiError, decodeCursor, encodeCursor } from '../../lib/http';
import { applySanction, liftSanction, openStaffSanctionId, recordAction, sanctionOrigin, staffStandingFor } from '../../lib/moderation/staff';
import { getSanctionRow, MUTE_7D_MS } from '../../lib/sanctions';
import { getUserRow, toPublicUser, type AuthedUser, type UserRow } from '../../lib/users';
import { requireAdmin } from './common';

const NOTE_MIN = 10;
const MOD_MAX_MUTE_MS = MUTE_7D_MS;
const DEFAULT_DURATION: Partial<Record<SanctionKind, number>> = { mute: 24 * 60 * 60_000, suspension: 7 * DAY };

function liveUser(id: Id): UserRow {
  const row = getUserRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound("This account isn't available");
  return row;
}

export function staffUserDetail(staff: AuthedUser, id: Id): StaffUserDetail {
  return toDetail(staff, liveUser(id));
}

function toDetail(staff: AuthedUser, row: UserRow): StaffUserDetail {
  const standing = staffStandingFor(row.id, staff.role);
  return {
    user: toPublicUser(row, staff.id),
    email: staff.role === 'admin' ? row.email : null,
    role: row.role,
    // moderators: public-origin view of the status (an anon-origin suspension must not flip it, SPEC §3.2 #9)
    status: standing.status ?? row.status,
    strikePoints: standing.strikePoints,
    sanctions: standing.sanctions,
    openQueueItems: standing.openQueueItems,
  };
}

/** Handle / name (admins: + email) prefix and substring search; offset cursor (HMAC-tagged, opaque). */
export function searchStaffUsers(staff: AuthedUser, q: string, cursor: string | undefined, limit: number): Paginated<StaffUserDetail> {
  const cur = decodeCursor(cursor);
  const offset = cur ? Math.max(0, Number(cur.k) || 0) : 0;
  const needle = q.trim().replace(/^@/, '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
  if (!needle) return { items: [], nextCursor: null };
  const like = `%${needle}%`;
  const prefix = `${needle}%`;
  const emailClause = staff.role === 'admin' ? " OR email LIKE ? ESCAPE '\\'" : '';
  const params: (string | number)[] = [like, like];
  if (staff.role === 'admin') params.push(like);
  params.push(prefix, prefix, limit + 1, offset);
  const rows = prep(
    `SELECT * FROM users WHERE status != 'deleted' AND (handle LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'${emailClause})
      ORDER BY CASE WHEN handle LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, follower_count DESC, handle ASC LIMIT ? OFFSET ?`,
  ).all(...params) as UserRow[];
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => toDetail(staff, r)),
    nextCursor: rows.length > limit ? encodeCursor({ k: offset + limit, id: 'offset' }) : null,
  };
}

export function setUserRole(staff: AuthedUser, id: Id, role: Role): StaffUserDetail {
  requireAdmin(staff);
  const row = liveUser(id);
  if (row.id === staff.id) throw new ApiError(400, 'validation_failed', "You can't change your own role.");
  if (row.role !== role) {
    tx(() => {
      prep('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now(), id);
      audit({ actor: staff, action: role === 'user' ? 'role_revoke' : 'role_grant', targetType: 'user', targetId: id, metadata: { from: row.role, to: role } });
    });
  }
  return staffUserDetail(staff, id);
}

export function setUserVerified(staff: AuthedUser, id: Id, verified: boolean): StaffUserDetail {
  requireAdmin(staff);
  const row = liveUser(id);
  if (row.account_type !== 'org') throw new ApiError(400, 'validation_failed', 'Only org accounts can be verified.');
  if ((row.is_verified === 1) !== verified) {
    tx(() => {
      prep('UPDATE users SET is_verified = ?, updated_at = ? WHERE id = ?').run(verified ? 1 : 0, now(), id);
      audit({ actor: staff, action: verified ? 'org_verify' : 'org_unverify', targetType: 'user', targetId: id });
    });
  }
  return staffUserDetail(staff, id);
}

/** Direct, public-origin sanction on the `profile` entity (moderators: warning / mute ≤ 7 d; admins: any). */
export function applyDirectSanction(staff: AuthedUser, id: Id, body: StaffSanctionRequest): StaffUserDetail {
  const row = liveUser(id);
  const note = body.note.trim();
  if (note.length < NOTE_MIN) throw new ApiError(400, 'validation_failed', `Add a note (at least ${NOTE_MIN} characters).`);
  if (row.id === staff.id) throw new ApiError(400, 'validation_failed', "You can't sanction yourself.");
  if (staff.role !== 'admin') {
    if (body.kind !== 'warning' && body.kind !== 'mute') throw ApiError.forbidden('Suspensions and bans are admin only.');
    if (body.kind === 'mute' && (body.durationMs ?? 0) > MOD_MAX_MUTE_MS) throw ApiError.forbidden('Moderators can mute for up to 7 days.');
    if (row.role !== 'user') throw ApiError.forbidden('Only admins can sanction staff.');
  }
  const durationMs = body.durationMs ?? DEFAULT_DURATION[body.kind];
  tx(() => {
    const actionId = recordAction({
      entityType: 'profile', entityId: id, targetUserId: id, actor: staff, action: `sanction_${body.kind}`, category: body.category, note,
    });
    applySanction({
      userId: id, kind: body.kind, durationMs, scope: body.scope ?? 'all', category: body.category, entity: { entityType: 'profile', entityId: id },
      actor: staff, actionId, delayed: false,
    });
  });
  return staffUserDetail(staff, id);
}

/** What a lift by a RAW anon-origin sanction id answers: no user, no standing (only unmask may name the author). */
export interface BlindLiftResult {
  lifted: true;
  origin: 'anon';
}

/**
 * Admin only. Lifts any sanction (the anon-origin audit row targets the entity, never the user). `handle` is either a
 * raw sanction id or the sealed handle `/admin/users` shows for anon-origin rows. A RAW anon-origin id (which only the
 * entity-targeted audit rows carry) answers blind — returning the account here would be an unmask without reason,
 * typed UNMASK, `buzz_unmask` row or admin alert (Constitution §5.5).
 */
export function liftUserSanction(staff: AuthedUser, handle: Id, note: string): StaffUserDetail | BlindLiftResult {
  requireAdmin(staff);
  const unsealed = openStaffSanctionId(handle);
  const sanctionId = unsealed ?? handle;
  const row = getSanctionRow(sanctionId);
  if (!row) throw ApiError.notFound();
  const blind = unsealed === null && sanctionOrigin(sanctionId) === 'anon';
  const trimmed = note.trim();
  if (trimmed.length < NOTE_MIN) throw new ApiError(400, 'validation_failed', `Add a note (at least ${NOTE_MIN} characters).`);
  tx(() => {
    liftSanction(sanctionId, staff);
    recordAction({
      entityType: (row.entity_type as ContentEntityType | null) ?? 'profile',
      entityId: row.entity_id ?? row.user_id,
      targetUserId: row.user_id,
      actor: staff,
      action: 'lift_sanction',
      category: row.category,
      note: trimmed,
      sanctionId,
    });
  });
  if (blind) return { lifted: true, origin: 'anon' };
  return staffUserDetail(staff, row.user_id);
}
