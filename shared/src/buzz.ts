/**
 * `buzz` slice — request / response types (SPEC §5.3). Types + constants only, zero imports beyond `@shared/core`.
 *
 * FIREWALL (SPEC §3.2 #1): no field in this file may be named like a forbidden key
 * (`authorId, author_id, userId, user_id, handle, name, displayName, avatar, avatarUrl, email, universityEmail, profile`).
 * Every payload is produced by ONE serializer (`server/src/services/buzz/serialize.ts`), field by field.
 */
import type { ContentStatus, EpochMs, Id, Paginated } from './core';

export interface BuzzAlias {
  emoji: string;
  /** "Anon Comet" (+ " 2" on an in-thread collision). */
  label: string;
  /** Hex string from the server-side ALIAS_COLORS list. */
  color: string;
}

export type BuzzSort = 'hot' | 'new' | 'top';
export type BuzzTopWindow = 'day' | 'week' | 'all';
export const BUZZ_SORTS: readonly BuzzSort[] = ['hot', 'new', 'top'];
export const BUZZ_TOP_WINDOWS: readonly BuzzTopWindow[] = ['day', 'week', 'all'];
export const BUZZ_POLL_DURATIONS = [1, 3, 7] as const;
export type BuzzPollDuration = (typeof BUZZ_POLL_DURATIONS)[number];

export interface BuzzPollOption {
  id: Id;
  text: string;
  /** null until `resultsVisible`. */
  votes: number | null;
  /** 0–100, null until `resultsVisible`. */
  pct: number | null;
}

export interface BuzzPoll {
  options: BuzzPollOption[];
  totalVotes: number | null;
  closesAt: EpochMs;
  closed: boolean;
  myChoice: Id | null;
  /** Results are hidden until the viewer has voted or the poll has closed (safety L17). */
  resultsVisible: boolean;
}

export type BuzzItemStatus = Extract<ContentStatus, 'active' | 'held' | 'hidden' | 'removed' | 'deleted'>;

interface BuzzBase {
  id: Id;
  /** Root buzz id (a root's own id). */
  threadId: Id;
  alias: BuzzAlias;
  isOp: boolean;
  isMine: boolean;
  /** '' when the item is a placeholder (hidden / removed / deleted for other viewers). */
  text: string;
  score: number;
  myVote: -1 | 0 | 1;
  /** Community collapse (score ≤ −5 with ≥ 8 eligible votes) or "Hide this anon in this thread". */
  collapsed: boolean;
  status: BuzzItemStatus;
  /** The text triggered the support resources (self-harm) — the card offers a "Get support" link. */
  supportLink: boolean;
  /** Floored to the minute (safety L2). */
  createdAt: EpochMs;
}

export interface Buzz extends BuzzBase {
  kind: 'buzz';
  poll: BuzzPoll | null;
  replyCount: number;
  locked: boolean;
  /** Only in global scope; null on campus. */
  campusShortName: string | null;
  promptId: Id | null;
}

export interface BuzzReply extends BuzzBase {
  kind: 'reply';
  /** The depth-1 ancestor for flattened replies (so the client nests them under it). */
  parentId: Id;
  depth: 1 | 2;
  /** Set when the reply was deeper than 2 and got flattened: the alias it was replying to. */
  replyingTo: BuzzAlias | null;
}

export interface BuzzThread {
  root: Buzz;
  /** First page (oldest first). Further pages: GET /:threadId/replies. */
  replies: Paginated<BuzzReply>;
  smallCampusNote: boolean;
}

export interface BuzzFeedMeta {
  prompt: { id: Id; text: string } | null;
  smallCampusNote: boolean;
}

export interface CreateBuzzRequest {
  text: string;
  poll?: { options: string[]; durationDays: BuzzPollDuration };
  promptId?: Id;
}

export interface CreateBuzzReplyRequest {
  text: string;
  /** A reply in the same thread; omitted = reply to the root. */
  parentId?: Id;
}

export interface BuzzVoteRequest {
  value: -1 | 0 | 1;
}

export interface BuzzVoteState {
  score: number;
  myVote: -1 | 0 | 1;
  collapsed: boolean;
}

export interface BuzzPollVoteRequest {
  optionId: Id;
}

export type MyBuzzKind = 'threads' | 'replies';

export interface MyBuzzItem {
  item: Buzz | BuzzReply;
  /** The root text of the thread (own threads: the buzz itself), ≤ 120 chars. */
  threadSnippet: string;
}

export interface BuzzKarma {
  karma: number;
}

/** Community collapse / auto-hide thresholds (safety §3.2). */
export const BUZZ_COLLAPSE = { score: -5, votes: 8 } as const;
export const BUZZ_AUTO_HIDE = { score: -10, votes: 12 } as const;
export const BUZZ_MILESTONES: readonly number[] = [10, 25, 50, 100, 250];
