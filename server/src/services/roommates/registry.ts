/**
 * Registry entries the `roommates` router installs at import time (R4 — pure registrations, no DB access until called):
 *  - ContentAdapter `roommate_listing` (reports, auto-hide, admin queue, removal)
 *  - CardResolver `roommate` (share / DM context cards)
 *  - Notification hook (`roommate.still_looking` after 30 d; auto-pause after 60 d)
 *  - User lifecycle hook (banned / deleted → status 'removed')
 */
import type { ContentStatus, EpochMs, Id } from '@shared/core';
import { ROOMMATE_MODE_LABEL } from '@shared/roommates';
import { prep, tx } from '../../db/index';
import { now } from '../../lib/clock';
import { registerCardResolver, registerContentAdapter, registerUserLifecycleHook, type CardResolver, type ContentAdapter } from '../../lib/content';
import { touchContext } from '../../lib/conversations';
import { notify, registerNotificationHook, removeNotificationsFor } from '../../lib/notify';
import { getUserRow } from '../../lib/users';
import { computeCompatibility, formatMoveIn } from './compat';
import {
  AUTO_PAUSE_AFTER_MS, STILL_LOOKING_AFTER_MS, firstNameOf, getProfileRow, getProfileRowForUser, isPublished, lastConfirmedAt,
  partyOf, photosOf, textFieldsOfRow, type ProfileRow,
} from './profiles';

export const ROOMMATE_HREF = (id: Id): string => `/roommates/${encodeURIComponent(id)}`;
export const MY_ROOMMATE_HREF = '/roommates/me';

/* ───────────────────────────── status changes (shared by routes + adapter) ───────────────────────────── */

export function setProfileStatus(row: ProfileRow, status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>, opts?: { immune?: boolean }): void {
  tx(() => {
    prep('UPDATE roommate_profiles SET status = ?, auto_hide_immune = CASE WHEN ? THEN 1 ELSE auto_hide_immune END, updated_at = ? WHERE id = ?').run(
      status, opts?.immune ? 1 : 0, now(), row.id,
    );
    if (status === 'removed') removeNotificationsFor({ entityType: 'roommate_listing', entityId: row.id });
  });
  touchContext('roommate', row.id);
}

/* ───────────────────────────── content adapter ───────────────────────────── */

const adapter: ContentAdapter = {
  entityType: 'roommate_listing',
  /** An unpublished row is never reportable / never a queue subject → null (SPEC §5.7 visibility rule). */
  load(id) {
    const row = getProfileRow(id);
    if (!row || !isPublished(row)) return null;
    // Same fields PUT /me moderates (neighborhoods as title, about, photo alts) so the queue shows what was flagged.
    const fields: { field: string; text: string }[] = textFieldsOfRow(row);
    return {
      entityType: 'roommate_listing',
      entityId: row.id,
      authorId: row.user_id,
      universityId: row.university_id,
      status: row.status,
      surface: 'roommate_listing',
      anon: false,
      autoHideImmune: row.auto_hide_immune === 1,
      createdAt: row.published_at ?? row.created_at,
      label: 'roommate post',
      fields,
      media: photosOf(row).map((p) => ({ url: p.url, kind: 'image' as const })),
      href: ROOMMATE_HREF(row.id),
      parent: null,
    };
  },
  setStatus(id, status, opts) {
    const row = getProfileRow(id);
    if (!row) return;
    if (row.status === status && !opts?.immune) return;
    setProfileStatus(row, status, opts);
  },
};

/* ───────────────────────────── card resolver ───────────────────────────── */

const resolver: CardResolver = (id, viewerId) => {
  const row = getProfileRow(id);
  if (!row || !isPublished(row) || row.status !== 'active') return null;
  const author = getUserRow(row.user_id);
  if (!author || author.status !== 'active') return null;
  // Roommates is campus-only (SPEC §5.7): an off-campus viewer gets "No longer available".
  if (viewerId !== row.user_id && getUserRow(viewerId)?.university_id !== row.university_id) return null;
  const mode = row.mode ?? 'need';
  let badge: string | null = null;
  if (viewerId !== row.user_id) {
    const mine = getProfileRowForUser(viewerId);
    if (mine) badge = `${computeCompatibility(partyOf(mine), partyOf(row)).pct}% match`;
  }
  const moveIn = formatMoveIn(row.move_in);
  return {
    title: `${firstNameOf(author.display_name)} · ${ROOMMATE_MODE_LABEL[mode]}`,
    subtitle: moveIn ? `Move-in ${moveIn}` : null,
    imageUrl: photosOf(row)[0]?.url ?? null,
    href: ROOMMATE_HREF(row.id),
    status: row.paused === 1 ? 'paused' : 'available',
    price: row.budget,
    badge,
    ownerId: row.user_id,
    meetupSpot: null,
  };
};

/* ───────────────────────────── notification hook ───────────────────────────── */

/**
 * Published, active, un-paused profiles only. `MAX(published_at, confirmed_at)` older than 60 d → auto-pause;
 * older than 30 d → ONE `roommate.still_looking` per confirmation cycle (guarded by the existing row, a core-table SELECT).
 */
export function runStillLookingHook(userId: Id, at: EpochMs = now()): void {
  const row = getProfileRowForUser(userId);
  if (!row || !isPublished(row) || row.status !== 'active' || row.paused === 1) return;
  const last = lastConfirmedAt(row);
  if (last === null) return;
  if (at - last > AUTO_PAUSE_AFTER_MS) {
    prep('UPDATE roommate_profiles SET paused = 1, updated_at = ? WHERE id = ?').run(at, row.id);
    touchContext('roommate', row.id);
    return;
  }
  if (at - last <= STILL_LOOKING_AFTER_MS) return;
  const already = prep(
    `SELECT 1 FROM notifications WHERE user_id = ? AND type = 'roommate.still_looking' AND target_type = 'roommate_listing' AND target_id = ? AND created_at >= ?`,
  ).get(userId, row.id, last);
  if (already) return;
  notify({
    userId,
    type: 'roommate.still_looking',
    actorId: null,
    href: MY_ROOMMATE_HREF,
    target: { entityType: 'roommate_listing', entityId: row.id },
    collapse: true,
  });
}

/* ───────────────────────────── lifecycle hook ───────────────────────────── */

function removeForUser(userId: Id): void {
  const row = getProfileRowForUser(userId);
  if (!row || row.status === 'removed') return;
  setProfileStatus(row, 'removed');
}

/** Installed once by the router module (import time). Idempotent registries: last write wins. */
export function registerRoommateRegistries(): void {
  registerContentAdapter(adapter);
  registerCardResolver('roommate', resolver);
  registerNotificationHook('roommates', (userId) => runStillLookingHook(userId));
  registerUserLifecycleHook('roommates', { onBanned: removeForUser, onDeleted: removeForUser });
}
