/**
 * Suggestion dismissals (SPEC §5.5 `POST /discover/dismiss`). One row per (viewer, target, section); idempotent.
 */
import type { Id } from '@shared/core';
import type { SuggestionSection } from '@shared/discover';
import { prep } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { now } from '../../lib/clock';
import { ApiError } from '../../lib/http';
import { getUserRow, type AuthedUser } from '../../lib/users';

export function dismissSuggestion(viewer: AuthedUser, targetId: Id, section: SuggestionSection): void {
  if (targetId === viewer.id) throw ApiError.badRequest("You can't dismiss yourself.");
  const target = getUserRow(targetId);
  if (!target || target.status === 'deleted') throw ApiError.notFound("This account isn't available");
  const res = prep('INSERT OR IGNORE INTO discover_dismissals (user_id, target_id, section, created_at) VALUES (?,?,?,?)').run(
    viewer.id, target.id, section, now(),
  );
  if (res.changes > 0) {
    trackEvent('suggestion_dismiss', { userId: viewer.id, universityId: viewer.universityId }, { section, targetType: target.account_type });
  }
}

export function dismissedIdsFor(viewerId: Id, section: SuggestionSection): Set<Id> {
  const rows = prep('SELECT target_id AS id FROM discover_dismissals WHERE user_id = ? AND section = ?').all(viewerId, section) as { id: Id }[];
  return new Set(rows.map((r) => r.id));
}
