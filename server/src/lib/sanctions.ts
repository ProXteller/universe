/**
 * Sanctions read-side (SPEC §4.2.9, safety §4).                          LANE S-M3 owns this file.
 *
 * - `activeSanctionRows` / `activeSanctionFor` / `activeStrikePoints` are the ENFORCEMENT view: true totals, every
 *   origin (public and anon). Staff-facing filtering happens in `lib/moderation/staff.ts` (`staffStandingFor`).
 * - `sanctionNoticesFor` builds the user-facing `SanctionNotice` rows (the ONLY payload that quotes the user's own
 *   content back, incl. Buzz text) — returned solely by `GET /me/sanctions` to the affected user.
 * - `suggestSanction` is the safety §4.2 suggestion table; a human confirms.
 */
import type { ActiveSanction, AppealStatus, EpochMs, Id, ModerationCategory, SanctionKind, SanctionNotice, SanctionScope } from '@shared/core';
import { GUIDELINE_ANCHORS } from '@shared/core';
import { prep } from '../db/index';
import { DAY, HOUR, now } from './clock';

export interface UserSanctionRow {
  id: Id;
  user_id: Id;
  kind: SanctionKind | 'removal';
  scope: SanctionScope;
  category: ModerationCategory | null;
  entity_type: string | null;
  entity_id: Id | null;
  content_excerpt: string | null;
  content_label: string | null;
  action_id: Id | null;
  actor_id: Id | null;
  starts_at: EpochMs;
  effective_at: EpochMs;
  ends_at: EpochMs | null;
  acknowledged_at: EpochMs | null;
  lifted_at: EpochMs | null;
  lifted_by: Id | null;
  created_at: EpochMs;
}

/** Appeals are accepted for 14 days after the sanction was created (safety §4.5). */
export const APPEAL_WINDOW_MS = 14 * DAY;

/** Ladder durations (safety §4.1). */
export const MUTE_24H_MS = 24 * HOUR;
export const MUTE_72H_MS = 72 * HOUR;
export const MUTE_7D_MS = 7 * DAY;
export const SUSPENSION_7D_MS = 7 * DAY;
export const SUSPENSION_30D_MS = 30 * DAY;

const RANK: Record<string, number> = { ban: 3, suspension: 2, mute: 1 };

/** Rows that restrict the account right now: mute / suspension / ban, effective, not lifted, not ended. */
export function activeSanctionRows(userId: Id, at: EpochMs = now()): UserSanctionRow[] {
  const rows = prep(
    `SELECT * FROM user_sanctions
      WHERE user_id = ? AND kind IN ('mute','suspension','ban') AND lifted_at IS NULL
        AND effective_at <= ? AND (ends_at IS NULL OR ends_at > ?)
      ORDER BY created_at DESC`,
  ).all(userId, at, at) as UserSanctionRow[];
  return rows.sort((a, b) => (RANK[b.kind] ?? 0) - (RANK[a.kind] ?? 0));
}

export function getSanctionRow(id: Id): UserSanctionRow | null {
  return (prep('SELECT * FROM user_sanctions WHERE id = ?').get(id) as UserSanctionRow | undefined) ?? null;
}

function appealStatusOf(sanctionId: Id): AppealStatus {
  const appeal = prep('SELECT status FROM appeals WHERE sanction_id = ?').get(sanctionId) as { status: AppealStatus } | undefined;
  return appeal?.status ?? 'none';
}

/** Warnings carry no restriction and no appeal; everything else may be appealed once within 14 days while not lifted. */
export function appealableUntil(row: UserSanctionRow): EpochMs | null {
  if (row.kind === 'warning') return null;
  return row.created_at + APPEAL_WINDOW_MS;
}

export function canAppeal(row: UserSanctionRow, appealStatus: AppealStatus, at: EpochMs = now()): boolean {
  const deadline = appealableUntil(row);
  if (deadline === null) return false;
  if (appealStatus !== 'none') return false;
  if (row.lifted_at !== null) return false;
  return at <= deadline;
}

/** The strictest sanction currently in force, or null. */
export function activeSanctionFor(userId: Id): ActiveSanction | null {
  const row = activeSanctionRows(userId)[0];
  if (!row) return null;
  const appealStatus = appealStatusOf(row.id);
  return {
    id: row.id,
    kind: row.kind as ActiveSanction['kind'],
    scope: row.scope,
    category: row.category,
    until: row.ends_at,
    canAppeal: canAppeal(row, appealStatus),
    appealStatus,
  };
}

/** Row → the user-facing notice (with the excerpt). Only `GET /me/sanctions` may send this shape. */
export function toSanctionNotice(row: UserSanctionRow, appealStatus: AppealStatus = appealStatusOf(row.id)): SanctionNotice {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    category: row.category,
    guidelineAnchor: row.category ? GUIDELINE_ANCHORS[row.category] : null,
    contentExcerpt: row.content_excerpt,
    contentLabel: row.content_label,
    startsAt: row.effective_at,
    until: row.ends_at,
    acknowledgedAt: row.acknowledged_at,
    canAppeal: canAppeal(row, appealStatus),
    appealStatus,
    appealDeadline: appealableUntil(row),
    createdAt: row.created_at,
  };
}

/** Everything the affected user may see about their own account (GET /me/sanctions), newest first. */
export function sanctionNoticesFor(userId: Id): SanctionNotice[] {
  const rows = prep('SELECT * FROM user_sanctions WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId) as UserSanctionRow[];
  const appeals = new Map(
    (prep('SELECT sanction_id, status FROM appeals WHERE user_id = ?').all(userId) as { sanction_id: Id; status: AppealStatus }[]).map(
      (a) => [a.sanction_id, a.status] as const,
    ),
  );
  return rows.map((r) => toSanctionNotice(r, appeals.get(r.id) ?? 'none'));
}

/** Sum of non-revoked, non-expired strike points (TRUE total — enforcement never uses the staff-filtered view). */
export function activeStrikePoints(userId: Id): number {
  const at = now();
  const row = prep(
    `SELECT COALESCE(SUM(points), 0) AS points FROM strikes
      WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
  ).get(userId, at) as { points: number };
  return row.points;
}

/**
 * Suggestion table of safety §4.2 (the tool suggests; a human confirms):
 * 1–2 → warning (first ever) or removal only · 3–4 mute 24 h · 5–6 mute 72 h · 7–8 mute 7 d ·
 * 9–11 suspension 7 d · 12–14 suspension 30 d · ≥ 15 ban review.
 */
export function suggestSanction(
  points: number,
  hasPriorWarning: boolean,
): { kind: SanctionKind | 'removal'; durationMs: number | null } {
  const p = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  if (p <= 2) return { kind: hasPriorWarning ? 'removal' : 'warning', durationMs: null };
  if (p <= 4) return { kind: 'mute', durationMs: MUTE_24H_MS };
  if (p <= 6) return { kind: 'mute', durationMs: MUTE_72H_MS };
  if (p <= 8) return { kind: 'mute', durationMs: MUTE_7D_MS };
  if (p <= 11) return { kind: 'suspension', durationMs: SUSPENSION_7D_MS };
  if (p <= 14) return { kind: 'suspension', durationMs: SUSPENSION_30D_MS };
  return { kind: 'ban', durationMs: null };
}
