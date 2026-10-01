/**
 * Audit log reads (SPEC §5.11, safety §6.6). Moderators see their own rows; admins see all. Every row — the CSV
 * too — goes through foundation's `serializeAuditRow` (anon-origin rule 4).
 */
import type { Paginated } from '@shared/core';
import type { AuditQuery, AuditRow } from '@shared/admin';
import { prep } from '../../db/index';
import type { AuditLogRow } from '../../lib/audit';
import { decodeCursor, keysetWhere, paginate } from '../../lib/http';
import { serializeAuditRow } from '../../lib/moderation/staff';
import type { AuthedUser } from '../../lib/users';
import { requireAdmin } from './common';

const CSV_MAX = 5000;

function whereFor(staff: AuthedUser, q: AuditQuery): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (staff.role !== 'admin') {
    where.push('actor_id = ?');
    params.push(staff.id);
  } else if (q.actor) {
    where.push('actor_id = ?');
    params.push(q.actor);
  }
  if (q.action) {
    where.push('action = ?');
    params.push(q.action);
  }
  if (q.targetType) {
    where.push('target_type = ?');
    params.push(q.targetType);
  }
  if (typeof q.from === 'number') {
    where.push('created_at >= ?');
    params.push(q.from);
  }
  if (typeof q.to === 'number') {
    where.push('created_at <= ?');
    params.push(q.to);
  }
  return { sql: where.length ? where.join(' AND ') : '1 = 1', params };
}

export function listAudit(staff: AuthedUser, q: AuditQuery & { limit: number }): Paginated<AuditRow> {
  const cur = decodeCursor(q.cursor);
  const w = whereFor(staff, q);
  const ks = keysetWhere('created_at', 'id', cur, 'desc');
  const rows = prep(`SELECT * FROM audit_log WHERE ${w.sql} AND ${ks.sql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...w.params, ...ks.params, q.limit + 1) as AuditLogRow[];
  return paginate(rows, q.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => serializeAuditRow(r, staff));
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Admin only. Same filters, newest first, capped at 5,000 rows. */
export function exportAuditCsv(staff: AuthedUser, q: AuditQuery): string {
  requireAdmin(staff);
  const w = whereFor(staff, q);
  const rows = prep(`SELECT * FROM audit_log WHERE ${w.sql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...w.params, CSV_MAX) as AuditLogRow[];
  const header = ['id', 'createdAt', 'actorId', 'actorName', 'actorRole', 'action', 'targetType', 'targetId', 'queueId', 'batchId', 'reasonCode', 'reason', 'metadata'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const row = serializeAuditRow(r, staff);
    lines.push(
      [
        row.id, new Date(row.createdAt).toISOString(), row.actor?.id ?? 'system', row.actor?.displayName ?? 'System', row.actor?.role ?? 'system', row.action,
        row.targetType, row.targetId, row.queueId, row.batchId, row.reasonCode, row.reason, row.metadata,
      ].map(csvCell).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
