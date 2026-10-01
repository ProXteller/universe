/**
 * Up / down votes (SPEC §5.3, safety §3.2 score-based rules).
 *  - eligible voter = account age ≥ 24 h, no active mute / suspension, trust ≠ low, not the author
 *  - collapse: eligible score ≤ −5 with ≥ 8 eligible votes (stays active, `collapsed: true`, leaves hot / top)
 *  - auto-hide: eligible score ≤ −10 with ≥ 12 eligible votes → status hidden + queue item (community_score, P2)
 *  - milestones 10 / 25 / 50 / 100 / 250 upvotes → `buzz.milestone` (once per post + milestone)
 * All inside one transaction with the vote (anti-abuse: thresholds are evaluated with the write).
 */
import type { Id } from '@shared/core';
import { BUZZ_MILESTONES, type BuzzVoteState } from '@shared/buzz';
import { prep, tx } from '../../db/index';
import { DAY, HOUR, now } from '../../lib/clock';
import { ApiError } from '../../lib/http';
import { log } from '../../lib/logger';
import { enqueueSystemFlag } from '../../lib/moderation/index';
import { notifyAnonymous } from '../../lib/notify';
import { reporterTrustFor } from '../../lib/reports';
import { activeSanctionRows } from '../../lib/sanctions';
import type { AuthedUser } from '../../lib/users';
import { getPost, isCollapsed, recountVotes, setPostStatus, shouldAutoHide, type BuzzRow } from './store';

const ELIGIBLE_MIN_AGE_MS = 24 * HOUR;

export function isEligibleVoter(user: AuthedUser, post: Pick<BuzzRow, 'author_id'>): boolean {
  if (post.author_id === user.id) return false;
  if (user.accountAgeMs < ELIGIBLE_MIN_AGE_MS) return false;
  if (activeSanctionRows(user.id).some((s) => s.kind === 'mute' || s.kind === 'suspension' || s.kind === 'ban')) return false;
  if (reporterTrustFor(user.id) === 'low') return false;
  return true;
}

export function threadHref(threadId: Id): string {
  return `/buzz/${threadId}`;
}

/**
 * `value` 0 removes the vote (tap again to undo). Own item → 400 (only the owner can trigger it, so nothing leaks).
 * Returns the new state; runs the community thresholds and milestones in the same transaction.
 */
export function castVote(user: AuthedUser, post: BuzzRow, value: -1 | 0 | 1): BuzzVoteState {
  if (post.author_id === user.id) throw ApiError.badRequest("You can't vote on your own buzz.");
  if (post.status !== 'active') throw ApiError.notFound("That buzz isn't available.");
  const at = now();
  const eligible = isEligibleVoter(user, post) ? 1 : 0;
  const before = { upvotes: post.upvotes, hidden: false };

  const state = tx((): BuzzVoteState => {
    if (value === 0) prep('DELETE FROM buzz_votes WHERE post_id = ? AND user_id = ?').run(post.id, user.id);
    else {
      prep(
        `INSERT INTO buzz_votes (post_id, user_id, value, eligible, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, eligible = excluded.eligible, created_at = excluded.created_at`,
      ).run(post.id, user.id, value, eligible, at);
    }
    const counts = recountVotes(post.id);
    const fresh = { ...post, ...counts };

    if (shouldAutoHide(fresh) && post.auto_hide_immune === 0) {
      setPostStatus(post.id, 'hidden');
      before.hidden = true;
    }
    if (counts.upvotes > before.upvotes) {
      for (const m of BUZZ_MILESTONES) {
        if (counts.upvotes < m) continue;
        const inserted = prep('INSERT OR IGNORE INTO buzz_milestones (post_id, milestone, day) VALUES (?,?,?)').run(post.id, m, Math.floor(at / DAY));
        if (inserted.changes > 0) {
          try {
            notifyAnonymous({
              userId: post.author_id, type: 'buzz.milestone', threadId: post.root_id ?? post.id, href: threadHref(post.root_id ?? post.id),
              data: { upvotes: m },
            });
          } catch (err) {
            log.error('buzz milestone notice failed', err);
          }
        }
      }
    }
    return { score: counts.score, myVote: value, collapsed: isCollapsed(fresh) };
  });

  if (before.hidden) {
    const root = post.root_id ?? post.id;
    if (post.root_id !== null) {
      // a hidden reply no longer counts toward the root's active reply count
      prep("UPDATE buzz_posts SET reply_count = (SELECT COUNT(*) FROM buzz_posts r WHERE r.root_id = ? AND r.status = 'active') WHERE id = ?").run(root, root);
    }
    enqueueSystemFlag({
      entityType: post.root_id === null ? 'buzz' : 'buzz_reply', entityId: post.id, authorId: post.author_id, universityId: post.university_id,
      surface: post.root_id === null ? 'buzz' : 'buzz_reply', source: 'community_score', priority: 'p2',
    });
  }
  return state;
}

export function currentVoteState(viewerId: Id, postId: Id): BuzzVoteState | null {
  const post = getPost(postId);
  if (!post) return null;
  const mine = prep('SELECT value FROM buzz_votes WHERE post_id = ? AND user_id = ?').get(postId, viewerId) as { value: -1 | 1 } | undefined;
  return { score: post.score, myVote: mine?.value ?? 0, collapsed: isCollapsed(post) };
}
