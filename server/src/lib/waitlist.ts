/**
 * Waitlist (SPEC §4.2.15) — the ONLY writer of `waitlist` (routes #34–#35 and `kit.waitlist`).
 *                                                                      LANE S-M2b owns this file.
 *
 * Counts are REAL rows (product rule: numbers are real). `campusCount` = active rows at the viewer's university;
 * `totalCount` = active rows everywhere except hidden universities (`uni_team`, SPEC §4.1).
 */
import type { EpochMs, Id, WaitlistFeature, WaitlistState } from '@shared/core';
import { newId, prep } from '../db/index';
import { now } from './clock';
import { ApiError } from './http';

export const WAITLIST_FEATURES: readonly WaitlistFeature[] = ['apartments'];

interface WaitlistRow {
  id: Id;
  feature: string;
  user_id: Id;
  university_id: Id;
  source: string | null;
  created_at: EpochMs;
  left_at: EpochMs | null;
}

function universityOf(userId: Id): Id {
  const row = prep('SELECT university_id FROM users WHERE id = ?').get(userId) as { university_id: Id } | undefined;
  if (!row) throw ApiError.notFound("This account isn't available");
  return row.university_id;
}

function rowFor(userId: Id, feature: WaitlistFeature): WaitlistRow | null {
  return (prep('SELECT * FROM waitlist WHERE feature = ? AND user_id = ?').get(feature, userId) as WaitlistRow | undefined) ?? null;
}

/** Idempotent; a re-join after leaving clears `left_at` (and restarts `joinedAt`). */
export function joinWaitlist(userId: Id, feature: WaitlistFeature, opts: { source?: string; at?: EpochMs } = {}): void {
  const at = opts.at ?? now();
  const existing = rowFor(userId, feature);
  if (!existing) {
    prep(
      'INSERT INTO waitlist (id, feature, user_id, university_id, source, created_at, left_at) VALUES (?,?,?,?,?,?,NULL)',
    ).run(newId(), feature, userId, universityOf(userId), opts.source ?? null, at);
    return;
  }
  if (existing.left_at === null) return; // already on the list: nothing changes
  prep('UPDATE waitlist SET left_at = NULL, created_at = ?, source = COALESCE(?, source) WHERE id = ?').run(at, opts.source ?? null, existing.id);
}

/** Sets `left_at` (idempotent; a user who never joined is a no-op). */
export function leaveWaitlist(userId: Id, feature: WaitlistFeature, at?: EpochMs): void {
  prep('UPDATE waitlist SET left_at = ? WHERE feature = ? AND user_id = ? AND left_at IS NULL').run(at ?? now(), feature, userId);
}

export function waitlistStateFor(userId: Id, feature: WaitlistFeature): WaitlistState {
  const row = rowFor(userId, feature);
  const joined = row !== null && row.left_at === null;
  const universityId = universityOf(userId);
  const campus = prep('SELECT COUNT(*) AS n FROM waitlist WHERE feature = ? AND left_at IS NULL AND university_id = ?').get(feature, universityId) as { n: number };
  const total = prep(
    `SELECT COUNT(*) AS n FROM waitlist w WHERE w.feature = ? AND w.left_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM universities u WHERE u.id = w.university_id AND u.is_hidden = 1)`,
  ).get(feature) as { n: number };
  return { feature, joined, joinedAt: joined ? row.created_at : null, campusCount: campus.n, totalCount: total.n };
}
