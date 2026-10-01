/**
 * `messages` slice — read helpers on top of `lib/conversations.ts` (SPEC §5.6).
 * Raw `SELECT`s only (the slice never writes conversation tables with SQL); every write goes through the lib.
 */
import type { ConversationSummary, Id, MemberState, RecipientBanner } from '@shared/core';
import type { CannotSendReason, ConversationDetail } from '@shared/messages';
import { prep } from '../../db/index';
import { assertMember, getConversationRow, listMembers, serializeConversation, type ConversationRow } from '../../lib/conversations';
import { isBlockedBetween, mutualsBetween } from '../../lib/graph';
import { ApiError } from '../../lib/http';
import { getUserRow, userSummariesByIds } from '../../lib/users';

interface MemberStateRow {
  user_id: Id;
  state: MemberState;
}

/** Lazily prepared statements (R4: no import-time DB access). */
const sql = {
  memberStates: () => prep('SELECT user_id, state FROM conversation_members WHERE conversation_id = ?'),
  sentCapped: () =>
    prep("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind IN ('text','image','card')"),
  latestBanner: () =>
    prep(
      `SELECT banner FROM messages WHERE conversation_id = ? AND sender_id = ? AND banner IS NOT NULL AND status != 'deleted'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    ),
  messageInConversation: () => prep('SELECT id, sender_id, kind, status FROM messages WHERE id = ? AND conversation_id = ?'),
};

export function memberStatesOf(conversationId: Id): MemberStateRow[] {
  return sql.memberStates().all(conversationId) as MemberStateRow[];
}

/** The DM peer's membership row (any state) or null for groups. */
export function dmPeerOf(conv: ConversationRow, viewerId: Id): MemberStateRow | null {
  if (conv.kind !== 'dm') return null;
  return memberStatesOf(conv.id).find((m) => m.user_id !== viewerId) ?? null;
}

/** True when the viewer is the requester of a still-unaccepted DM request. */
export function isPendingRequester(conv: ConversationRow, viewerId: Id): boolean {
  const peer = dmPeerOf(conv, viewerId);
  return !!peer && peer.state === 'request';
}

/** Number of text / image / card messages the viewer already sent (the request cap counts these only). */
export function cappedMessageCount(conversationId: Id, userId: Id): number {
  return (sql.sentCapped().get(conversationId, userId) as { n: number }).n;
}

export function conversationOr404(id: Id): ConversationRow {
  const conv = getConversationRow(id);
  if (!conv) throw ApiError.notFound('That conversation is not available.');
  return conv;
}

/** A message row that belongs to `conversationId` (else 404). */
export function messageInConversation(conversationId: Id, messageId: Id): { id: Id; sender_id: Id | null; kind: string; status: string } {
  const row = sql.messageInConversation().get(messageId, conversationId) as { id: Id; sender_id: Id | null; kind: string; status: string } | undefined;
  if (!row) throw ApiError.notFound('That message is not available.');
  return row;
}

/**
 * Whether the viewer can type into this conversation right now, and why not.
 * `left` never reaches here (assertMember 404s), but the union keeps the client honest.
 * A DM whose peer DELETED the request (state 'declined') stays "Request sent" for the requester forever
 * (safety §7.2: "The sender only ever sees Request sent"), so it reads as `request_pending`.
 */
export function sendability(conv: ConversationRow, viewerId: Id): { canSend: boolean; reason: CannotSendReason | null } {
  const members = memberStatesOf(conv.id);
  const mine = members.find((m) => m.user_id === viewerId);
  if (!mine || mine.state === 'left' || mine.state === 'declined') return { canSend: false, reason: 'left' };
  if (conv.kind === 'dm') {
    const peer = members.find((m) => m.user_id !== viewerId) ?? null;
    if (!peer) return { canSend: false, reason: 'blocked' };
    const peerUser = getUserRow(peer.user_id);
    if (!peerUser || peerUser.status === 'deleted' || peerUser.status === 'banned' || isBlockedBetween(viewerId, peer.user_id)) {
      return { canSend: false, reason: 'blocked' };
    }
    if (peer.state === 'left') return { canSend: false, reason: 'blocked' };
    if (peer.state === 'declined') return { canSend: false, reason: 'request_pending' };
    if (peer.state === 'request' && cappedMessageCount(conv.id, viewerId) >= 1) return { canSend: false, reason: 'request_pending' };
  }
  return { canSend: true, reason: null };
}

/**
 * Foundation's `serializeConversation` drops declined / left members, so the requester of a deleted request would see
 * a peer-less "Chat". Restore the peer (any state) so the row keeps its name and stays "Request sent".
 */
export function withDmPeer(summary: ConversationSummary, viewerId: Id): ConversationSummary {
  if (summary.kind !== 'dm' || summary.peer) return summary;
  const conv = getConversationRow(summary.id);
  if (!conv) return summary;
  const peer = dmPeerOf(conv, viewerId);
  if (!peer) return summary;
  const user = userSummariesByIds([peer.user_id]).get(peer.user_id);
  if (!user) return summary;
  return {
    ...summary,
    peer: user,
    title: user.displayName,
    avatarUrl: user.avatarUrl,
    memberPreview: summary.memberPreview.length ? summary.memberPreview : [user],
    requestPending: peer.state === 'declined' ? true : summary.requestPending,
  };
}

export function buildDetail(conversationId: Id, viewerId: Id): ConversationDetail {
  assertMember(conversationId, viewerId);
  const conv = conversationOr404(conversationId);
  const summary = withDmPeer(serializeConversation(conversationId, viewerId), viewerId);
  const members = listMembers(conversationId, viewerId);
  const { canSend, reason } = sendability(conv, viewerId);

  let requestBanner: RecipientBanner | null = null;
  let mutualCount = 0;
  if (conv.kind === 'dm' && summary.peer) {
    if (summary.state === 'request') {
      const row = sql.latestBanner().get(conv.id, summary.peer.id) as { banner: RecipientBanner } | undefined;
      requestBanner = row?.banner ?? null;
    }
    mutualCount = mutualsBetween(viewerId, summary.peer.id).count;
  }

  return { ...summary, members, canSend, cannotSendReason: reason, requestBanner, mutualCount };
}
