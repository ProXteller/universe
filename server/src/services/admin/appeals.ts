/**
 * Staff appeals (SPEC §5.11, safety §4.5). Reviewed BLIND: no user field, ever. Anon-origin rows carry the appealed
 * content (so it can be judged) but `sanction.id` becomes the appeal id and timestamps are day-floored, so the row
 * cannot be joined with /admin/users. `reviewer ≠ actor` is enforced server-side; suspensions / bans are admin only.
 */
import type { AppealStatus, ContentEntityType, Id, Paginated } from '@shared/core';
import type { AppealDecisionRequest, StaffAppeal } from '@shared/admin';
import { prep, tx } from '../../db/index';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { getContentAdapter } from '../../lib/content';
import { ApiError, decodeCursor, keysetWhere, paginate } from '../../lib/http';
import { log } from '../../lib/logger';
import { applyContentStatus, liftSanction, revokeStrikesFor } from '../../lib/moderation/staff';
import { notify } from '../../lib/notify';
import type { UserSanctionRow } from '../../lib/sanctions';
import type { AuthedUser } from '../../lib/users';
import { floorDay, originOf, toStaffSanctionRow, type OriginRow } from './common';

const NOTE_MIN = 10;

interface AppealJoinRow {
  a_id: Id;
  a_user_id: Id;
  a_sanction_id: Id;
  a_text: string;
  a_status: AppealStatus;
  a_reviewer_id: Id | null;
  a_created_at: number;
  a_decided_at: number | null;
  queue_entity_type: string | null;
  action_actor_id: string | null;
  appeal_queue_id: Id | null;
}

const SELECT = `
  SELECT a.id AS a_id, a.user_id AS a_user_id, a.sanction_id AS a_sanction_id, a.text AS a_text, a.status AS a_status, a.reviewer_id AS a_reviewer_id,
         a.created_at AS a_created_at, a.decided_at AS a_decided_at,
         mq.entity_type AS queue_entity_type, ma.actor_id AS action_actor_id, q2.id AS appeal_queue_id,
         s.*
    FROM appeals a
    JOIN user_sanctions s ON s.id = a.sanction_id
    LEFT JOIN moderation_actions ma ON ma.id = s.action_id
    LEFT JOIN mod_queue mq ON mq.id = ma.queue_id
    LEFT JOIN mod_queue q2 ON q2.appeal_id = a.id`;

type JoinedRow = AppealJoinRow & UserSanctionRow;

function canReview(staff: AuthedUser, r: JoinedRow): boolean {
  if (r.a_status !== 'open') return false;
  if (r.a_user_id === staff.id) return false;
  if (r.action_actor_id === staff.id || r.actor_id === staff.id) return false;
  if ((r.kind === 'suspension' || r.kind === 'ban') && staff.role !== 'admin') return false;
  return true;
}

function toStaffAppeal(staff: AuthedUser, r: JoinedRow): StaffAppeal {
  const sanctionRow: OriginRow = { ...r, queue_entity_type: r.queue_entity_type };
  const anon = originOf(sanctionRow) === 'anon';
  const sanction = toStaffSanctionRow(sanctionRow, r.a_status, anon ? { idOverride: r.a_id } : {});
  return {
    id: r.a_id,
    sanction,
    contentExcerpt: r.content_excerpt,
    contentLabel: r.content_label,
    text: r.a_text,
    status: r.a_status,
    createdAt: anon ? (floorDay(r.a_created_at) ?? r.a_created_at) : r.a_created_at,
    queueId: r.appeal_queue_id,
    canReview: canReview(staff, r),
  };
}

function loadAppeal(id: Id): JoinedRow | null {
  return (prep(`${SELECT} WHERE a.id = ?`).get(id) as JoinedRow | undefined) ?? null;
}

export function listAppeals(staff: AuthedUser, status: AppealStatus | 'all', cursor: string | undefined, limit: number): Paginated<StaffAppeal> {
  const cur = decodeCursor(cursor);
  const dir = status === 'open' ? 'asc' : 'desc';
  const ks = keysetWhere('a.created_at', 'a.id', cur, dir);
  const where = [ks.sql, 'a.user_id != ?'];
  const params: (string | number)[] = [...ks.params, staff.id];
  if (status !== 'all') {
    where.push('a.status = ?');
    params.push(status);
  }
  const rows = prep(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at ${dir.toUpperCase()}, a.id ${dir.toUpperCase()} LIMIT ?`).all(...params, limit + 1) as JoinedRow[];
  return paginate(rows, limit, (r) => ({ k: r.a_created_at, id: r.a_id }), (r) => toStaffAppeal(staff, r));
}

export function getStaffAppeal(staff: AuthedUser, id: Id): StaffAppeal {
  const r = loadAppeal(id);
  if (!r || r.a_user_id === staff.id) throw ApiError.notFound();
  return toStaffAppeal(staff, r);
}

export function decideAppeal(staff: AuthedUser, id: Id, body: AppealDecisionRequest): StaffAppeal {
  const r = loadAppeal(id);
  if (!r || r.a_user_id === staff.id) throw ApiError.notFound();
  if (r.a_status !== 'open') throw ApiError.conflict('This appeal was already decided.');
  if (!canReview(staff, r)) {
    throw ApiError.forbidden((r.kind === 'suspension' || r.kind === 'ban') && staff.role !== 'admin' ? 'Appeals against suspensions and bans are admin only.' : 'A different staff member must review this appeal.');
  }
  const note = body.note.trim();
  if (note.length < NOTE_MIN) throw new ApiError(400, 'validation_failed', `Add a note (at least ${NOTE_MIN} characters).`);
  const at = now();
  if (body.outcome === 'reduced') {
    if (typeof body.reducedUntil !== 'number' || body.reducedUntil <= at) throw new ApiError(400, 'validation_failed', 'Pick a new end time in the future.');
    if (r.ends_at !== null && body.reducedUntil >= r.ends_at) throw new ApiError(400, 'validation_failed', 'A reduced sanction must end earlier than it does now.');
  }

  tx(() => {
    prep('UPDATE appeals SET status = ?, reviewer_id = ?, outcome_note = ?, decided_at = ? WHERE id = ?').run(body.outcome, staff.id, note, at, id);
    if (body.outcome === 'reversed') {
      liftSanction(r.id, staff);
      if (r.entity_type && r.entity_id && r.entity_type !== 'profile') {
        const entityType = r.entity_type as ContentEntityType;
        try {
          if (getContentAdapter(entityType)?.load(r.entity_id)) applyContentStatus(entityType, r.entity_id, 'active', { category: r.category, sanctionId: r.id });
          revokeStrikesFor(entityType, r.entity_id);
        } catch (err) {
          log.error('appeal reversal: content restore failed', err);
        }
      }
    } else if (body.outcome === 'reduced') {
      prep('UPDATE user_sanctions SET ends_at = ? WHERE id = ?').run(body.reducedUntil, r.id);
      audit({ actor: staff, action: 'sanction_reduce', targetType: 'appeal', targetId: id, queueId: r.appeal_queue_id ?? undefined, metadata: { sanctionId: r.id, until: body.reducedUntil } });
    }
    prep("UPDATE mod_queue SET status = 'closed', closed_at = ?, resolution = ?, claimed_by = NULL, claimed_at = NULL WHERE appeal_id = ? AND status != 'closed'").run(
      at, body.outcome === 'upheld' ? 'dismissed' : 'approved', id,
    );
    audit({ actor: staff, action: 'appeal_decide', targetType: 'appeal', targetId: id, queueId: r.appeal_queue_id ?? undefined, reason: note, metadata: { outcome: body.outcome } });
    try {
      notify({
        userId: r.a_user_id, type: 'mod.appeal_result', actorId: null, href: '/settings/account-status', target: { entityType: 'sanction', entityId: r.id }, collapse: false,
        data: { outcome: body.outcome, sanctionId: r.id },
      });
    } catch (err) {
      log.error('appeal result notice failed', err);
    }
  });
  return getStaffAppeal(staff, id);
}
