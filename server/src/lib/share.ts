/**
 * Share-to-chat (SPEC §4.3 #37–#38).                                    LANE S-M2b owns this file.
 *
 * `listShareTargets`: the ≤ 12 most recent ACTIVE chats of the viewer (same rows as the Chats tab), `nextCursor: null`.
 * `shareCard`: resolves the card once (404 when it is gone), moderates the optional caption (surface 'message' — the
 * only foundation-owned UGC write, so foundation runs `moderateWrite` itself), rate `message_send`, then sends
 * `kind:'card'` through `sendMessage` into up to 10 conversations the viewer is an active member of; a conversation
 * that refuses (not a member, request cap, block) lands in `failedConversationIds`. Tracks `share_click`.
 */
import type { ContentEntityType, ConversationSummary, Paginated, ShareRequest, ShareResponse } from '@shared/core';
import { ANON_ENTITY_TYPES } from '@shared/core';
import { trackEvent } from './analytics';
import { getContentAdapter, resolveCard } from './content';
import { assertMember, listConversations, sendMessage } from './conversations';
import { ApiError } from './http';
import { blockedTarget, commitModeration, modCtx, moderateWrite } from './moderation/index';
import { enforceRateLimit } from './rateLimit';
import type { AuthedUser } from './users';

export const SHARE_TARGETS_MAX = 12;
export const SHARE_CONVERSATIONS_MAX = 10;

/** ≤ 12 most recent ACTIVE chats of the viewer, `nextCursor: null`. */
export function listShareTargets(user: AuthedUser): Paginated<ConversationSummary> {
  // over-fetch: a chat where the viewer's own request is still pending cannot take a card (request cap)
  const page = listConversations(user.id, 'chats', { limit: 50 });
  return { items: page.items.filter((c) => !c.requestPending).slice(0, SHARE_TARGETS_MAX), nextCursor: null };
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * True when a caption on an anonymous (Buzz) card merely reproduces the post's own text. Such a caption would copy the
 * anonymous text into a named chat message, where it outlives a moderator removal and reads as the sharer's words.
 */
function captionCopiesAnonContent(kind: string, id: string, caption: string): boolean {
  if (!(ANON_ENTITY_TYPES as readonly string[]).includes(kind)) return false;
  const snap = getContentAdapter(kind as ContentEntityType)?.load(id);
  if (!snap) return false;
  const body = squash(snap.fields.map((f) => f.text).join(' '));
  const cap = squash(caption).replace(/(?:…|\.\.\.)$/, '').trim();
  return cap.length > 0 && (body.includes(cap) || cap.includes(body));
}

/** Sends `kind:'card'` via `sendMessage` into up to 10 conversations; tracks `share_click`. */
export function shareCard(user: AuthedUser, request: ShareRequest): ShareResponse {
  const card = resolveCard(request.card, user.id);
  if (card.status === 'unavailable') throw ApiError.notFound("That's no longer available.");
  let text = request.text?.trim() ? request.text.trim() : undefined;
  if (text && captionCopiesAnonContent(request.card.kind, request.card.id, text)) text = undefined;
  const conversationIds = [...new Set(request.conversationIds)].slice(0, SHARE_CONVERSATIONS_MAX);
  if (conversationIds.length === 0) return { sent: 0, failedConversationIds: [] };

  let banner: ReturnType<typeof moderateWrite>['recipientBanner'] = null;
  let status: 'active' | 'held' = 'active';
  if (text) {
    const mod = moderateWrite([{ text }], modCtx(user, 'message'), blockedTarget(user, 'message'));
    banner = mod.recipientBanner;
    status = mod.persistStatus ?? 'active';
    commitModeration(mod, { ...blockedTarget(user, 'message'), entityId: null });
  }
  enforceRateLimit(user, 'message_send');

  let sent = 0;
  const failedConversationIds: string[] = [];
  for (const conversationId of conversationIds) {
    try {
      assertMember(conversationId, user.id, ['active']);
      sendMessage({ conversationId, sender: user, kind: 'card', card: { kind: request.card.kind, id: request.card.id }, text, banner, status });
      sent += 1;
    } catch {
      failedConversationIds.push(conversationId);
    }
  }
  trackEvent('share_click', { userId: user.id, universityId: user.universityId }, { kind: request.card.kind, target: 'chat', sent });
  return { sent, failedConversationIds };
}
