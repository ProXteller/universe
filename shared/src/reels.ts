/**
 * `reels` slice contract (SPEC §5.2). Types only — private to the reels client + server pair.
 * Everything cross-slice lives in `@shared/core`.
 */
import type { ContentStatus, EpochMs, FeedScope, Id, UserSummary } from './core';

export interface ReelViewer {
  liked: boolean;
  isSelf: boolean;
  isFollowingAuthor: boolean;
}

export interface Reel {
  id: Id;
  author: UserSummary;
  caption: string;
  videoUrl: string;
  posterUrl: string | null;
  durationMs: number;
  width: number | null;
  height: number | null;
  visibility: FeedScope;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  viewer: ReelViewer;
  /** Authors see their own `held` / `hidden` / `removed` rows; everyone else only sees `active`. */
  status: ContentStatus;
  createdAt: EpochMs;
}

export interface CreateReelRequest {
  /** `UploadResult.id` (or url) of a `kind:'video'` upload owned by the caller. */
  videoUploadId: Id;
  /** `UploadResult.id` (or url) of a `kind:'image'` upload (first frame) owned by the caller. */
  posterUploadId?: Id | null;
  caption: string;
  visibility: FeedScope;
}

export interface ReelCommentViewer {
  liked: boolean;
  isSelf: boolean;
}

export interface ReelComment {
  id: Id;
  reelId: Id;
  parentId: Id | null;
  author: UserSummary;
  text: string;
  likeCount: number;
  replyCount: number;
  /** First 2 replies, oldest first; only ever filled on top-level comments. */
  replies: ReelComment[];
  viewer: ReelCommentViewer;
  status: ContentStatus;
  createdAt: EpochMs;
}

export interface CreateReelCommentRequest {
  text: string;
  /** A top-level comment on the same reel (one level of replies). */
  parentId?: Id;
}

export interface LikeState {
  liked: boolean;
  likeCount: number;
}

export interface ReelViewRequest {
  completed?: boolean;
}

export type ReelFeedScope = FeedScope;
