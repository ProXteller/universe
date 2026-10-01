/**
 * `messages` slice contract (SPEC §5.6). Types + constants only; private to the messages client + server pair.
 * Everything cross-slice (ConversationSummary, Message, SendMessageRequest, …) lives in `@shared/core`.
 */
import type { ConversationSummary, Id, MessageReactionEmoji, RecipientBanner, UserListItem } from './core';

export interface ConversationMember extends UserListItem {
  role: 'owner' | 'member';
  lastReadMessageId: Id | null;
}

export type CannotSendReason = 'request_pending' | 'blocked' | 'left';

/** `GET /api/conversations/:id` — the summary plus everything the thread screen needs. */
export interface ConversationDetail extends ConversationSummary {
  members: ConversationMember[];
  canSend: boolean;
  cannotSendReason: CannotSendReason | null;
  /** Banner of the request the viewer is looking at (the requester's flagged first message), else null. */
  requestBanner: RecipientBanner | null;
  /** DM requests: accounts the viewer follows who follow the requester. */
  mutualCount: number;
}

export interface CreateGroupRequest {
  title?: string;
  /** 2..49 other members (the creator joins as owner). */
  memberIds: Id[];
}

export interface UpdateConversationRequest {
  title?: string;
  muted?: boolean;
}

export interface OfferActionRequest {
  action: 'accept' | 'decline' | 'withdraw';
}

export interface AddMembersRequest {
  userIds: Id[];
}

export interface MarkReadRequest {
  messageId: Id;
}

export interface SetReactionRequest {
  emoji: MessageReactionEmoji | null;
}

export type InboxTab = 'chats' | 'requests';

/** Context-aware quick replies (product §2.6). Placeholders: `{price10}` = price − 10 %, `{meetupSpot}`. */
export const QUICK_REPLIES: { listing: string[]; roommate: string[] } = {
  listing: ['Is this still available?', 'Would you take {price10}?', 'Can we meet at {meetupSpot}?'],
  roommate: ["When's your move-in date?", 'Which neighborhoods are you looking at?'],
};

/** Group chats: SPEC §5.6 `memberIds` bounds (creator excluded). */
export const GROUP_MEMBERS_MIN = 2;
export const GROUP_MEMBERS_MAX = 49;
/** Above this many members every new invite lands as a request (safety §7.2). */
export const GROUP_AUTO_ACCEPT_MAX = 10;

/** product §2.6 one-time safety tip on the first listing chat. */
export const LISTING_SAFETY_TIP = "Meet in a public spot on campus. Never pay before you've seen the item.";
