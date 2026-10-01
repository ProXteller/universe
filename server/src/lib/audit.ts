/**
 * Append-only audit log writer (SPEC §4.2.14, safety §6.6).                LANE S-M3 owns this file.
 *
 * - `audit()` inserts one row and returns its id; it runs inside the caller's transaction when there is one.
 * - `audit_log` has BEFORE UPDATE / BEFORE DELETE triggers (`00-core.sql`) that abort: rows can only ever be inserted.
 * - Reading rows for staff goes through `serializeAuditRow` (lib/moderation/staff.ts) — the anon-origin rule lives there.
 * - `metadata` MUST NOT contain Buzz author identity except on `buzz_unmask` rows (safety §6.6); callers that act on an
 *   anon-origin queue item target the ENTITY, never the user (SPEC §4.2.14 rule 3).
 */
import type { EpochMs, Id } from '@shared/core';
import { newId, prep } from '../db/index';
import { now } from './clock';
import type { AuthedUser } from './users';

export interface AuditInput {
  actor: AuthedUser | 'system';
  action: string;
  targetType?: string;
  targetId?: Id;
  queueId?: Id;
  batchId?: Id;
  reasonCode?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Raw `audit_log` row. */
export interface AuditLogRow {
  id: Id;
  /** users.id or 'system'. */
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string | null;
  target_id: Id | null;
  queue_id: Id | null;
  batch_id: Id | null;
  reason_code: string | null;
  reason: string | null;
  metadata_json: string;
  created_at: EpochMs;
}

/** Inserts one audit row (runs inside the caller's transaction when there is one) and returns its id. */
export function audit(input: AuditInput): Id {
  const id = newId();
  const actorId = input.actor === 'system' ? 'system' : input.actor.id;
  const actorRole = input.actor === 'system' ? 'system' : input.actor.role;
  prep(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, target_type, target_id, queue_id, batch_id, reason_code, reason, metadata_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, actorId, actorRole, input.action, input.targetType ?? null, input.targetId ?? null, input.queueId ?? null,
    input.batchId ?? null, input.reasonCode ?? null, input.reason ?? null, JSON.stringify(input.metadata ?? {}), now(),
  );
  return id;
}

export function getAuditRow(id: Id): AuditLogRow | null {
  return (prep('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLogRow | undefined) ?? null;
}
