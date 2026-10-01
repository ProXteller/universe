/**
 * "Follow top 5" (SPEC §5.1 `POST /onboarding/follow-many`): loops foundation `followUser`, which applies the block
 * check (generic 404 → skipped), the `follow` rate limit, counters, `follow.new` and `trackEvent('follow')`.
 *
 * Per-user failures (blocked / missing / self) are skipped silently — the client only needs to know who got followed.
 * A 429 from the rate limiter stops the loop: it is re-thrown when nothing was followed in this call (so the client
 * shows the "going fast" toast), otherwise the partial list is returned (those follows are real rows).
 */
import type { Id } from '@shared/core';
import { trackEvent } from '../../lib/analytics';
import { followUser } from '../../lib/graph';
import { ApiError } from '../../lib/http';
import type { AuthedUser } from '../../lib/users';

export function followMany(viewer: AuthedUser, userIds: Id[]): Id[] {
  const followed: Id[] = [];
  const unique = [...new Set(userIds)].filter((id) => id !== viewer.id);
  for (const id of unique) {
    try {
      const r = followUser(viewer, id);
      if (r.isFollowing) followed.push(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        if (followed.length === 0) throw err;
        break;
      }
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) continue;
      throw err;
    }
  }
  trackEvent('onboarding_step', { userId: viewer.id, universityId: viewer.universityId }, { step: 'follow', followed: followed.length });
  return followed;
}
