/**
 * Unmask with reason (SPEC §5.11, safety §6.5, Constitution §5.5). Admin only. Requires a queue item for the entity.
 * The `buzz_unmask` audit row (reason code, reason, queue id) is inserted BEFORE the identity is read, in one
 * transaction. The identity itself is returned ONLY in this response (5-minute on-screen re-mask): a second,
 * entity-targeted `buzz_unmask_subject` row records *which* account was resolved as a keyed tag (`unmaskSubjectTag`)
 * — enough for the data export and a later review to verify a candidate, never a readable Buzz→account link in the
 * audit tab (safety §6.6 / P3 least identity). Every other admin gets `admin.unmask_alert`.
 *
 * BLOCKED TEXT (polish P6): a blocked Buzz write never becomes an entity (`entity_id NULL`, `blocked_text` kept, the
 * author in the queue row's server-internal `author_id`). A blocked credible threat or self-harm risk is exactly where
 * the safety team needs identity, so such an item is unmaskable through the SAME endpoint and gate — the path `:id` is
 * then the queue item's own id (there is no entity id). Every other blocked category (spam, harassment, …) stays masked.
 */
import type { Id, ModerationCategory } from '@shared/core';
import { UNMASK_REASON_MIN, UNMASK_VISIBLE_MS, type UnmaskRequest, type UnmaskResponse } from '@shared/admin';
import { prep, tx } from '../../db/index';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { ApiError } from '../../lib/http';
import { log } from '../../lib/logger';
import { isAnonEntity, resolveAuthorId, visibleQueueRow, type ModQueueRow } from '../../lib/moderation/staff';
import { notify } from '../../lib/notify';
import { enforceRateLimit } from '../../lib/rateLimit';
import { getUserRow, type AuthedUser } from '../../lib/users';
import { requireAdmin, unmaskSubjectTag } from './common';

/** Blocked-text categories an admin may unmask: threats / violence and self-harm risk (plus the `wellbeing` label). */
const BLOCKED_UNMASK_CATEGORIES: readonly ModerationCategory[] = ['threat_violence', 'self_harm'];

/**
 * An anon-origin queue item whose text was BLOCKED (never became an entity) that an admin may unmask: category
 * threats / violence or self-harm risk, with an author on the row. Appeals are reviewed blind and never qualify.
 */
export function isUnmaskableBlockedItem(row: ModQueueRow): boolean {
  if (!isAnonEntity(row.entity_type) || row.entity_id !== null || !row.blocked_text || !row.author_id || row.source === 'appeal') return false;
  return (row.category !== null && BLOCKED_UNMASK_CATEGORIES.includes(row.category)) || row.label === 'wellbeing';
}

/** `StaffQueueItemDetail.canUnmask`: admins only, anon items only — an entity, or blocked text that qualifies above. */
export function canUnmaskQueueRow(row: ModQueueRow, staff: AuthedUser): boolean {
  return staff.role === 'admin' && isAnonEntity(row.entity_type) && (row.entity_id !== null || isUnmaskableBlockedItem(row));
}

/** The queue item the unmask is anchored on: the entity's latest item, else (blocked text) the queue item `id` itself. */
function unmaskQueueItem(staff: AuthedUser, entityType: 'buzz' | 'buzz_reply', id: Id): { queue: ModQueueRow; entityId: Id | null } {
  const byEntity = prep('SELECT * FROM mod_queue WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(entityType, id) as ModQueueRow | undefined;
  if (byEntity) return { queue: byEntity, entityId: id };
  const blocked = visibleQueueRow(id, staff);
  if (!blocked || blocked.entity_type !== entityType || blocked.entity_id !== null) throw ApiError.notFound('No queue item exists for this content.');
  if (!isUnmaskableBlockedItem(blocked)) {
    throw ApiError.forbidden('Blocked text can be unmasked only for a threat of violence or a self-harm risk.');
  }
  return { queue: blocked, entityId: null };
}

export function unmaskBuzzAuthor(staff: AuthedUser, entityType: 'buzz' | 'buzz_reply', id: Id, body: UnmaskRequest): UnmaskResponse {
  requireAdmin(staff);
  const reason = body.reason.trim();
  if (reason.length < UNMASK_REASON_MIN) throw new ApiError(400, 'validation_failed', `Write at least ${UNMASK_REASON_MIN} characters explaining why.`);
  if (body.confirmText !== 'UNMASK') throw new ApiError(400, 'validation_failed', 'Type UNMASK to confirm.');
  const { queue, entityId } = unmaskQueueItem(staff, entityType, id);
  enforceRateLimit(staff, 'unmask');
  const at = now();
  const caseRef = body.caseRef?.trim() || null;

  return tx(() => {
    const unmaskId = audit({
      actor: staff, action: 'buzz_unmask', targetType: entityType, targetId: entityId ?? undefined, queueId: queue.id, reasonCode: body.reasonCode, reason,
      metadata: { caseRef },
    });
    // blocked text: the author lives only on the queue row (foundation stores it on every blocked write)
    const authorId = (entityId ? resolveAuthorId(entityType, entityId) : null) ?? queue.author_id;
    const user = authorId ? getUserRow(authorId) : null;
    if (!user) throw ApiError.notFound('The author of this content is no longer available.');
    // no id / handle in the log: the row proves which account was resolved only to someone who already holds the id
    audit({
      actor: staff, action: 'buzz_unmask_subject', targetType: entityType, targetId: entityId ?? undefined, queueId: queue.id, reasonCode: body.reasonCode,
      metadata: { unmaskId, subjectTag: unmaskSubjectTag(user.id) },
    });
    const admins = prep("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id != ?").all(staff.id) as { id: Id }[];
    for (const a of admins) {
      try {
        notify({
          userId: a.id, type: 'admin.unmask_alert', actorId: null, href: '/admin/audit', target: null, collapse: false,
          data: { reasonCode: body.reasonCode, auditId: unmaskId },
        });
      } catch (err) {
        log.error('unmask alert failed', err);
      }
    }
    return {
      user: { id: user.id, handle: user.handle, displayName: user.display_name, email: user.email, universityId: user.university_id },
      unmaskId,
      expiresAt: at + UNMASK_VISIBLE_MS,
    };
  });
}
