/**
 * `orbit` slice types (SPEC §5.4, DECISIONS D8) — public posts, the feed (follows + self + campus highlights), comments, polls.
 * Types and constants only; zero npm imports. Every identity here is the REAL public profile (never Buzz).
 */
import type { ContentStatus, EpochMs, Id, MediaImage, Paginated, UserSummary } from './core';

export interface PostPollOption {
  id: Id;
  text: string;
  votes: number;
  /** 0–100, rounded; 0 when nobody voted. */
  pct: number;
}

export interface PostPoll {
  options: PostPollOption[];
  totalVotes: number;
  myChoice: Id | null;
}

/**
 * Why a post from someone the viewer does NOT follow is in their Orbit (DECISIONS D8). Only ever from the viewer's own
 * campus: `popular` = more engagement than a typical campus post this week; `official` = a recent post by a verified
 * campus org.
 */
export type OrbitHighlight = 'popular' | 'official';

export interface Post {
  id: Id;
  author: UserSummary;
  text: string;
  images: MediaImage[];
  poll: PostPoll | null;
  likeCount: number;
  commentCount: number;
  viewer: { liked: boolean; isSelf: boolean };
  status: ContentStatus;
  createdAt: EpochMs;
  /** Feed only: present when the post is in the feed as a campus highlight (author not followed). */
  highlight?: OrbitHighlight;
}

/** Text or images or poll required. */
export interface CreatePostRequest {
  text: string;
  images?: MediaImage[];
  poll?: { options: string[] };
}

export interface PostComment {
  id: Id;
  postId: Id;
  parentId: Id | null;
  author: UserSummary;
  text: string;
  replyCount: number;
  /** One level: every visible reply of a top-level comment, oldest first. Always `[]` on a reply. */
  replies: PostComment[];
  viewer: { isSelf: boolean };
  status: ContentStatus;
  createdAt: EpochMs;
}

export interface CreatePostCommentRequest {
  text: string;
  parentId?: Id;
}

export interface OrbitFeedResponse extends Paginated<Post> {
  /** The viewer's previous `POST /feed/seen` (null on the very first visit) — drives "New since your last visit". */
  lastVisitAt: EpochMs | null;
  followingCount: number;
}

export interface NewPostCount {
  count: number;
}

export interface PollVoteRequest {
  optionId: Id;
}

export interface LikeState {
  liked: boolean;
  likeCount: number;
}
