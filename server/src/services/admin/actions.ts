/**
 * Staff actions on queue items + bulk (SPEC §5.11, safety §6.4 / §4). Every action runs in ONE transaction with
 * `recordAction` (moderation_actions + audit) first, then the content / sanction side effects through foundation's
 * staff helpers. Buzz items are actioned blind: the author is resolved server-side and never serialized.
 */
import type { Id, ModerationCategory, ModerationSeverity, SanctionKind } from '@shared/core';
import type { BulkActionRequest, BulkActionResponse, StaffAction, StaffActionRequest } from '@shared/admin';
import { STAFF_ACTIONS } from '@shared/admin';
import { newId, prep, tx } from '../../db/index';
import { now } from '../../lib/clock';
import { getContentAdapter } from '../../lib/content';
import { ApiError } from '../../lib/http';
import { log } from '../../lib/logger';
import {
  addStrike, applyContentStatus, applySanction, closeReportsFor, liftSanction, recordAction, resolveAuthorId, revokeStrikesFor, visibleQueueRow,
  CLAIM_LEASE_MS, type ModQueueRow,
} from '../../lib/moderation/staff';
import { MUTE_24H_MS, MUTE_72H_MS, MUTE_7D_MS, SUSPENSION_30D_MS, SUSPENSION_7D_MS } from '../../lib/sanctions';
import type { AuthedUser } from '../../lib/users';
import { isZeroTolerance } from './common';

const NOTE_MIN = 10;
const BAN_NOTE_MIN = 30;
const SANCTIONING: ReadonlySet<StaffAction> = new Set<StaffAction>([
  'remove_and_warn', 'remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d', 'warn_only', 'suspend_7d', 'suspend_30d', 'ban',
]);
const REMOVING: ReadonlySet<StaffAction> = new Set<StaffAction>(['remove', 'remove_and_warn', 'remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d']);
const MUTE_MS: Partial<Record<StaffAction, number>> = { remove_and_mute_24h: MUTE_24H_MS, remove_and_mute_72h: MUTE_72H_MS, remove_and_mute_7d: MUTE_7D_MS };

export interface ApplyOptions {
  batchId?: Id;
}

function close(row: ModQueueRow, resolution: 'approved' | 'removed' | 'dismissed' | 'sanctioned' | 'escalated_external'): void {
  prep("UPDATE mod_queue SET status = 'closed', closed_at = ?, resolution = ?, claimed_by = NULL, claimed_at = NULL WHERE id = ?").run(now(), resolution, row.id);
}

function validate(staff: AuthedUser, row: ModQueueRow, body: StaffActionRequest): { note: string | null } {
  const def = STAFF_ACTIONS.find((d) => d.id === body.action);
  if (!def) throw new ApiError(400, 'validation_failed', 'Unknown action.');
  if (def.role === 'admin' && staff.role !== 'admin') throw ApiError.forbidden('Admins only.');
  const note = (body.note ?? '').trim();
  if (def.needsNote && note.length < NOTE_MIN) throw new ApiError(400, 'validation_failed', `Add a note (at least ${NOTE_MIN} characters).`);
  if (body.action === 'ban') {
    if (body.confirmText !== 'BAN') throw new ApiError(400, 'validation_failed', 'Type BAN to confirm.');
    if (note.length < BAN_NOTE_MIN) throw new ApiError(400, 'validation_failed', `A ban needs a note of at least ${BAN_NOTE_MIN} characters.`);
  }
  if (body.action === 'escalate_external' && !(body.reference ?? '').trim()) throw new ApiError(400, 'validation_failed', 'Add the outside reference number.');
  if (SANCTIONING.has(body.action) && (body.category === 'self_harm' || row.label === 'wellbeing')) {
    throw new ApiError(400, 'validation_failed', 'Wellbeing items never sanction. Approve, dismiss or escalate instead.');
  }
  if (row.status === 'closed' && body.action !== 'restore' && body.action !== 'lift_sanction') throw ApiError.conflict('This item is closed.');
  const at = now();
  if (row.status !== 'closed' && row.claimed_by !== null && row.claimed_by !== staff.id && row.claimed_at !== null && row.claimed_at + CLAIM_LEASE_MS > at) {
    throw ApiError.conflict('Being reviewed by another staff member.');
  }
  return { note: note || null };
}

/** Applies one action. Throws ApiError on any rule violation; the caller answers with the refreshed detail. */
export function applyQueueAction(id: Id, staff: AuthedUser, body: StaffActionRequest, opts: ApplyOptions = {}): void {
  const row = visibleQueueRow(id, staff);
  if (!row) throw ApiError.notFound();
  const { note } = validate(staff, row, body);
  const category: ModerationCategory = body.category;
  const entity = row.entity_id ? { entityType: row.entity_type, entityId: row.entity_id } : null;
  const authorId = row.author_id ?? (entity ? resolveAuthorId(entity.entityType, entity.entityId) : null);
  const severity: ModerationSeverity = row.severity === 'none' ? 'low' : row.severity;

  tx(() => {
    const actionId = recordAction({
      queueId: row.id, entityType: row.entity_type, entityId: row.entity_id, targetUserId: authorId, actor: staff, action: body.action, category, note,
      batchId: opts.batchId ?? null, metadata: body.reference ? { reference: body.reference.trim() } : {},
    });

    const removeContent = (): void => {
      if (entity) {
        applyContentStatus(entity.entityType, entity.entityId, 'removed', { category });
        if (authorId) addStrike({ userId: authorId, entityType: entity.entityType, entityId: entity.entityId, category, severity, actionId });
        closeReportsFor(entity.entityType, entity.entityId, 'actioned');
      }
    };
    const sanction = (kind: SanctionKind, durationMs?: number): Id => {
      if (!authorId) throw new ApiError(400, 'validation_failed', 'No account is attached to this item.');
      return applySanction({ userId: authorId, kind, durationMs, scope: 'all', category, entity: entity ?? undefined, actor: staff, actionId });
    };
    const closeReports = (outcome: 'actioned' | 'dismissed', badFaith = false): void => {
      if (entity) closeReportsFor(entity.entityType, entity.entityId, outcome, { badFaith });
    };

    switch (body.action) {
      case 'approve':
        if (entity) applyContentStatus(entity.entityType, entity.entityId, 'active', { immune: true, category });
        closeReports('dismissed');
        close(row, 'approved');
        break;
      case 'dismiss_reports':
        closeReports('dismissed', body.badFaith === true);
        close(row, 'dismissed');
        break;
      case 'remove':
        removeContent();
        close(row, 'removed');
        break;
      case 'remove_and_warn':
        removeContent();
        sanction('warning');
        close(row, 'sanctioned');
        break;
      case 'remove_and_mute_24h':
      case 'remove_and_mute_72h':
      case 'remove_and_mute_7d':
        removeContent();
        sanction('mute', MUTE_MS[body.action]);
        close(row, 'sanctioned');
        break;
      case 'warn_only':
        sanction('warning');
        closeReports('actioned');
        close(row, 'sanctioned');
        break;
      case 'lock_thread': {
        const adapter = entity ? getContentAdapter(entity.entityType) : null;
        if (!entity || !adapter?.setLocked) throw new ApiError(400, 'validation_failed', 'Only Buzz threads can be locked.');
        adapter.setLocked(entity.entityId, true);
        break;
      }
      case 'escalate':
        prep("UPDATE mod_queue SET status = 'escalated', claimed_by = NULL, claimed_at = NULL WHERE id = ?").run(row.id);
        if (category === 'sexual_minors') {
          // child-safety handling (safety §6.5): legal hold + immediate suspension pending admin review
          prep('UPDATE mod_queue SET legal_hold = 1 WHERE id = ?').run(row.id);
          if (authorId) applySanction({ userId: authorId, kind: 'suspension', durationMs: SUSPENSION_7D_MS, scope: 'all', category, entity: entity ?? undefined, actor: staff, actionId, delayed: false });
        }
        break;
      case 'escalate_external':
        prep('UPDATE mod_queue SET legal_hold = 1, reference = ? WHERE id = ?').run((body.reference ?? '').trim(), row.id);
        closeReports('actioned');
        close(row, 'escalated_external');
        break;
      case 'suspend_7d':
        sanction('suspension', SUSPENSION_7D_MS);
        closeReports('actioned');
        close(row, 'sanctioned');
        break;
      case 'suspend_30d':
        sanction('suspension', SUSPENSION_30D_MS);
        closeReports('actioned');
        close(row, 'sanctioned');
        break;
      case 'ban':
        sanction('ban');
        closeReports('actioned');
        close(row, 'sanctioned');
        break;
      case 'lift_sanction': {
        const target = prep(
          `SELECT s.id FROM user_sanctions s JOIN moderation_actions ma ON ma.id = s.action_id
            WHERE ma.queue_id = ? AND s.lifted_at IS NULL AND s.kind IN ('warning','mute','suspension','ban')
            ORDER BY s.created_at DESC LIMIT 1`,
        ).get(row.id) as { id: Id } | undefined;
        if (!target) throw ApiError.notFound('No active sanction is tied to this item.');
        liftSanction(target.id, staff);
        break;
      }
      case 'restore':
        if (entity) {
          applyContentStatus(entity.entityType, entity.entityId, 'active', { category });
          revokeStrikesFor(entity.entityType, entity.entityId);
        }
        if (row.status !== 'closed') close(row, 'approved');
        else prep("UPDATE mod_queue SET resolution = 'approved' WHERE id = ?").run(row.id);
        break;
    }

    // zero tolerance (safety §4.3): a confirmed violation in these categories suspends immediately, pending admin review
    if ((REMOVING.has(body.action) || body.action === 'warn_only') && authorId && isZeroTolerance(category, row.severity)) {
      applySanction({ userId: authorId, kind: 'suspension', durationMs: SUSPENSION_7D_MS, scope: 'all', category, entity: entity ?? undefined, actor: staff, actionId, delayed: false });
      prep("UPDATE mod_queue SET resolution = 'sanctioned' WHERE id = ?").run(row.id);
    }
  });
}

/* ───────────────────────────── bulk ───────────────────────────── */

const BULK_MAX = 50;

/** Not for P0, Wellbeing, Escalated or Appeals items; every item gets its own audit row sharing `batchId` (safety §6.4). */
export function applyBulk(staff: AuthedUser, body: BulkActionRequest): BulkActionResponse {
  if (body.ids.length === 0 || body.ids.length > BULK_MAX) throw new ApiError(400, 'validation_failed', `Select between 1 and ${BULK_MAX} items.`);
  const batchId = newId();
  const results: BulkActionResponse['results'] = [];
  for (const id of [...new Set(body.ids)]) {
    const row = visibleQueueRow(id, staff);
    if (!row) {
      results.push({ id, ok: false, error: 'not_found' });
      continue;
    }
    if (row.priority === 'p0' || row.label === 'wellbeing' || row.status === 'escalated' || row.source === 'appeal') {
      results.push({ id, ok: false, error: 'not_bulk_eligible' });
      continue;
    }
    try {
      applyQueueAction(id, staff, { action: body.action, category: body.category, note: body.note }, { batchId });
      results.push({ id, ok: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.code : 'failed';
      if (!(err instanceof ApiError)) log.error('bulk action failed', err);
      results.push({ id, ok: false, error: message });
    }
  }
  return { results, batchId };
}
