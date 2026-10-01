/**
 * Shared helpers of the admin services (SPEC §5.11). Firewall notes live with each helper; the anon-origin rule
 * (§4.2.14) is enforced by foundation's staff.ts and mirrored here for the payloads admin builds itself.
 */
import crypto from 'node:crypto';
import type { AppealStatus, Id, ModerationCategory, ModerationSeverity } from '@shared/core';
import type { StaffSanctionRow } from '@shared/admin';
import { config } from '../../config';
import { prep } from '../../db/index';
import { DAY } from '../../lib/clock';
import { ApiError } from '../../lib/http';
import { isAnonEntity } from '../../lib/moderation/staff';
import { toSanctionNotice, type UserSanctionRow } from '../../lib/sanctions';
import type { AuthedUser } from '../../lib/users';

export function requireAdmin(staff: AuthedUser, message = 'Admins only.'): void {
  if (staff.role !== 'admin') throw ApiError.forbidden(message);
}

export function floorDay(t: number | null): number | null {
  return t === null ? null : Math.floor(t / DAY) * DAY;
}

/** True when the table exists (slice tables may be absent on a DB another slice's isolation test rebuilt). */
export function tableExists(name: string): boolean {
  try {
    return prep("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  } catch {
    return false;
  }
}

export interface OriginRow extends UserSanctionRow {
  queue_entity_type?: string | null;
}

export function originOf(row: Pick<OriginRow, 'entity_type' | 'queue_entity_type'>): 'public' | 'anon' {
  return isAnonEntity(row.entity_type) || isAnonEntity(row.queue_entity_type) ? 'anon' : 'public';
}

/** `SanctionNotice` minus the excerpt / label (rule 1), day-floored for anon origin (rule 2). */
export function toStaffSanctionRow(row: OriginRow, appealStatus: AppealStatus, opts: { idOverride?: Id } = {}): StaffSanctionRow {
  const origin = originOf(row);
  const notice = toSanctionNotice(row, appealStatus);
  const { contentExcerpt: _excerpt, contentLabel: _label, ...rest } = notice;
  const out: StaffSanctionRow = { ...rest, origin };
  if (opts.idOverride) out.id = opts.idOverride;
  if (origin === 'anon') {
    out.startsAt = floorDay(out.startsAt) ?? out.startsAt;
    out.until = floorDay(out.until);
    out.acknowledgedAt = floorDay(out.acknowledgedAt);
    out.appealDeadline = floorDay(out.appealDeadline);
    out.createdAt = floorDay(out.createdAt) ?? out.createdAt;
  }
  return out;
}

/** Zero-tolerance ladder skips (safety §4.3): the system applies a 7-day suspension the moment a moderator confirms. */
export function isZeroTolerance(category: ModerationCategory, severity: ModerationSeverity): boolean {
  if (category === 'sexual_minors') return true;
  if (severity !== 'critical') return false;
  return category === 'threat_violence' || category === 'sexual_explicit' || category === 'pii_doxxing';
}

/** Light scrub of staff notes on anon-origin items: `@handle` tokens and `u_…` ids never reach a payload (§5.11). */
export function scrubIdentity(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/@[A-Za-z0-9_]{3,20}/g, '@…').replace(/\b(?:u|bg|o|t)_[A-Za-z0-9_]{2,}\b/g, '[account]');
}

/**
 * Keyed, non-reversible tag of an unmasked account for the `buzz_unmask_subject` audit row: the record proves *which*
 * account an unmask resolved to (data export, later review by recomputing the tag) without a readable Buzz→account
 * link in the audit tab — identity itself is returned only by the unmask endpoint (safety §6.5 / §6.6, P3).
 */
export function unmaskSubjectTag(userId: Id): string {
  return crypto.createHmac('sha256', config.cursorSecret).update(`unmask-subject:${userId}`).digest('base64url').slice(0, 32);
}

/** UTC day key for analytics buckets. */
export function dayKey(ms: number): string {
  return new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
