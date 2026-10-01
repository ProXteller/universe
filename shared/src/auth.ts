/**
 * `auth` slice types (SPEC §5.1). Private to the auth client + server pair; imported as `@shared/auth`.
 * Types + constants only, zero npm imports. `MAJORS` lives in `@shared/core` (discover edits the same field).
 */
import type { Id, UserListItem } from './core';

/**
 * Words a display name may not contain (case-insensitive, whole word): staff / brand impersonation.
 * Checked inline on the profile step ("Names can't include "{word}"."); the server's moderation engine is the real gate.
 */
export const RESERVED_DISPLAY_WORDS: readonly string[] = [
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'official', 'verified', 'universe', 'universe team',
  'trust & safety', 'safety team', 'campus police', 'police', 'dean', 'registrar', 'system',
];

export type OnboardingStep = 'email' | 'code' | 'profile' | 'guidelines' | 'follow';

export interface OnboardingSuggestionRow {
  user: UserListItem;
  /** Honest reason line, e.g. "Org · 184 followers", "Computer Science · 6 reels this month". */
  reason: string;
  tag: 'invited_you' | null;
}

export type OnboardingSectionId = 'popular_orgs' | 'in_major' | 'class_year' | 'active';

export interface OnboardingSuggestionSection {
  id: OnboardingSectionId;
  title: string;
  rows: OnboardingSuggestionRow[];
}

export interface OnboardingSuggestions {
  /** < 5 other active users at the campus → sections come from other campuses. */
  isNewCampus: boolean;
  inviter: OnboardingSuggestionRow | null;
  sections: OnboardingSuggestionSection[];
}

/** `POST /api/onboarding/follow-many` — "Follow top 5" (≤ 10 ids). */
export interface FollowManyRequest {
  userIds: Id[];
}
export interface FollowManyResponse {
  followed: Id[];
}

/** Rows per section and the "new campus" threshold (server-side constants, shared so the client can size skeletons). */
export const ONBOARDING_SECTION_ROWS = 8;
export const ONBOARDING_FOLLOW_MANY_MAX = 10;
export const ONBOARDING_NEW_CAMPUS_THRESHOLD = 5;
/** "Active on campus" looks back this many days of `public_activity`. */
export const ONBOARDING_ACTIVE_WINDOW_DAYS = 14;
