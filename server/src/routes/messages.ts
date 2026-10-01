/**
 * `messages` slice router — mounted at `/api/conversations` (SPEC §5.6). Foundation adds `requireAuth + requireOnboarded`.
 * No tables of its own: every write goes through `lib/conversations.ts`; this file validates, moderates, rate-limits and
 * serializes. Import-time work: none (R4).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { ConversationSummary, Message, Paginated, SendMessageRequest, WithModeration } from '@shared/core';
import { LIMITS, MESSAGE_REACTIONS } from '@shared/core';
import type {
  AddMembersRequest, ConversationDetail, CreateGroupRequest, InboxTab, MarkReadRequest, OfferActionRequest, SetReactionRequest,
  UpdateConversationRequest,
} from '@shared/messages';
import { GROUP_AUTO_ACCEPT_MAX, GROUP_MEMBERS_MAX, GROUP_MEMBERS_MIN } from '@shared/messages';
import { trackEvent } from '../lib/analytics';
import { DAY } from '../lib/clock';
import { resolveCard } from '../lib/content';
import {
  acceptRequest, addMember, assertMember, createGroup, declineRequest, deleteMessage, groupAddPlan, listConversations, listMessages, markRead,
  removeMember, sendMessage, serializeConversation, setOfferStatus, setReaction, updateConversation,
} from '../lib/conversations';
import { isFollowing } from '../lib/graph';
import { ApiError, asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite, NO_NOTICE, toAuthorNotice } from '../lib/moderation/index';
import { assertAccountAge, assertCanPost, enforceRateLimit, requireCanPost } from '../lib/rateLimit';
import { assertOwnImages } from '../lib/uploads';
import { getUserRow } from '../lib/users';
import { buildDetail, conversationOr404, isPendingRequester, memberStatesOf, messageInConversation, withDmPeer } from '../services/messages/detail';

const router = Router();

/* ───────────────────────────── schemas ───────────────────────────── */

const idSchema = z.string().min(1).max(64);
const cardKinds = ['listing', 'roommate', 'reel', 'post', 'event', 'buzz', 'profile', 'course'] as const;

const inboxQuery = pageQuery.extend({ tab: z.enum(['chats', 'requests']).default('chats') });

const mediaImage = z.object({
  url: z.string().min(1).max(512),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  alt: z.string().max(200).optional(),
});

const sendSchema = z.object({
  kind: z.enum(['text', 'image', 'card', 'offer']),
  text: z.string().max(LIMITS.messageText).optional(),
  images: z.array(mediaImage).max(LIMITS.messageImages).optional(),
  card: z.object({ kind: z.enum(cardKinds), id: idSchema }).optional(),
  offer: z.object({ listingId: idSchema, amount: z.number() }).optional(),
  replyToId: idSchema.optional(),
  clientId: z.string().min(1).max(64).optional(),
});

const groupSchema = z.object({
  title: z.string().trim().max(LIMITS.groupTitle).optional(),
  memberIds: z.array(idSchema).min(GROUP_MEMBERS_MIN).max(GROUP_MEMBERS_MAX),
});

const patchSchema = z
  .object({ title: z.string().trim().min(1).max(LIMITS.groupTitle).optional(), muted: z.boolean().optional() })
  .refine((b) => b.title !== undefined || b.muted !== undefined, { message: 'Nothing to update.' });

const membersSchema = z.object({ userIds: z.array(idSchema).min(1).max(GROUP_MEMBERS_MAX) });
const readSchema = z.object({ messageId: idSchema });
const reactionSchema = z.object({ emoji: z.enum(MESSAGE_REACTIONS).nullable() });
const offerSchema = z.object({ action: z.enum(['accept', 'decline', 'withdraw']) });
const idParams = z.object({ id: idSchema });
const messageParams = z.object({ id: idSchema, messageId: idSchema });

/* ───────────────────────────── inbox ───────────────────────────── */

router.get(
  '/',
  validate({ query: inboxQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, { tab: InboxTab; cursor?: string; limit: number }>(req);
    const page = listConversations(req.user!.id, query.tab, { cursor: query.cursor, limit: query.limit });
    const out: Paginated<ConversationSummary> = { ...page, items: page.items.map((c) => withDmPeer(c, req.user!.id)) };
    res.json(out);
  }),
);

/* ───────────────────────────── groups (before /:id) ───────────────────────────── */

router.post(
  '/groups',
  validate({ body: groupSchema }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { body } = typed<CreateGroupRequest>(req);
    assertAccountAge(user, DAY, 'You can start group chats after your first day on UniVerse.');
    enforceRateLimit(user, 'group_create');
    const title = body.title?.trim() || null;
    const mod = title
      ? moderateWrite([{ text: title, field: 'name' }], modCtx(user, 'group_name'), blockedTarget(user, 'conversation'))
      : null;
    const id = createGroup(user, { title, memberIds: body.memberIds });
    if (mod) commitModeration(mod, { ...blockedTarget(user, 'conversation'), entityId: id });
    const out: WithModeration<ConversationSummary> = { ...serializeConversation(id, user.id), moderation: mod ? toAuthorNotice(mod) : NO_NOTICE };
    res.status(201).json(out);
  }),
);

/* ───────────────────────────── detail / update / leave ───────────────────────────── */

router.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: ConversationDetail = buildDetail(params.id, req.user!.id);
    res.json(out);
  }),
);

router.patch(
  '/:id',
  validate({ params: idParams, body: patchSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params, body } = typed<UpdateConversationRequest, unknown, { id: string }>(req);
    assertMember(params.id, user.id, ['active']);
    let mod = null;
    if (body.title !== undefined) {
      const conv = conversationOr404(params.id);
      if (conv.kind !== 'group') throw ApiError.badRequest('Only group chats can be renamed.');
      if (conv.name_locked === 1) throw ApiError.badRequest("This chat's name is locked.");
      assertCanPost(user, 'public');
      enforceRateLimit(user, 'group_rename');
      mod = moderateWrite([{ text: body.title, field: 'name' }], modCtx(user, 'group_name'), blockedTarget(user, 'conversation'));
    }
    updateConversation(params.id, user, { title: body.title, muted: body.muted });
    if (mod) commitModeration(mod, { ...blockedTarget(user, 'conversation'), entityId: params.id });
    const out: WithModeration<ConversationSummary> = { ...serializeConversation(params.id, user.id), moderation: mod ? toAuthorNotice(mod) : NO_NOTICE };
    res.json(out);
  }),
);

router.post(
  '/:id/members',
  validate({ params: idParams, body: membersSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params, body } = typed<AddMembersRequest, unknown, { id: string }>(req);
    assertMember(params.id, user.id, ['active']);
    const conv = conversationOr404(params.id);
    if (conv.kind !== 'group') throw ApiError.badRequest('Only group chats can have members added.');
    const current = memberStatesOf(conv.id).filter((m) => m.state === 'active' || m.state === 'request');
    const currentIds = new Set(current.map((m) => m.user_id));
    const newIds = [...new Set(body.userIds)].filter((id) => id !== user.id && !currentIds.has(id));
    if (current.length + newIds.length > GROUP_MEMBERS_MAX + 1) throw ApiError.badRequest(`Group chats hold up to ${GROUP_MEMBERS_MAX + 1} people.`);
    if (newIds.length > 0) {
      // Adding people is starting contact, so it carries POST /groups' gates (safety §4.1 mute, §3.4 new accounts).
      assertCanPost(user, 'public');
      assertAccountAge(user, DAY, 'You can add people to group chats after your first day on UniVerse.');
    }
    // Validate every invitee before anyone is added (safety §7.2 / §7.7: same per-recipient gate as a DM).
    let size = current.length;
    const plans = newIds.map((id) => {
      // safety §7.2: non-followers of the inviter and anyone joining a > 10 member group land as a request
      const plan = groupAddPlan(conv.id, user, getUserRow(id), size + 1 > GROUP_AUTO_ACCEPT_MAX);
      size += 1;
      return { id, ...plan };
    });
    if (plans.some((p) => p.state === 'request')) assertCanPost(user, 'message_request');
    if (plans.length > 0) enforceRateLimit(user, 'group_add');
    for (const p of plans) {
      addMember(conv.id, p.id, { state: p.state, role: 'member', addedBy: p.notify ? user.id : undefined });
    }
    const out: ConversationDetail = buildDetail(conv.id, user.id);
    res.json(out);
  }),
);

router.delete(
  '/:id/members/me',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    assertMember(params.id, req.user!.id);
    removeMember(params.id, req.user!.id);
    res.status(204).end();
  }),
);

/* ───────────────────────────── requests ───────────────────────────── */

router.post(
  '/:id/accept',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params } = typed<unknown, unknown, { id: string }>(req);
    assertMember(params.id, user.id);
    acceptRequest(params.id, user);
    trackEvent('request_accept', { userId: user.id, universityId: user.universityId });
    res.status(204).end();
  }),
);

router.post(
  '/:id/decline',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params } = typed<unknown, unknown, { id: string }>(req);
    declineRequest(params.id, user);
    trackEvent('request_decline', { userId: user.id, universityId: user.universityId });
    res.status(204).end();
  }),
);

router.post(
  '/:id/read',
  validate({ params: idParams, body: readSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<MarkReadRequest, unknown, { id: string }>(req);
    assertMember(params.id, req.user!.id);
    messageInConversation(params.id, body.messageId);
    markRead(params.id, req.user!.id, body.messageId);
    res.status(204).end();
  }),
);

/* ───────────────────────────── messages ───────────────────────────── */

router.get(
  '/:id/messages',
  validate({ params: idParams, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number }, { id: string }>(req);
    const out: Paginated<Message> = listMessages(params.id, req.user!.id, { cursor: query.cursor, limit: query.limit });
    res.json(out);
  }),
);

router.post(
  '/:id/messages',
  validate({ params: idParams, body: sendSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params, body } = typed<SendMessageRequest, unknown, { id: string }>(req);
    if (body.kind === 'offer') throw ApiError.badRequest('Offers are made from the listing.');
    assertMember(params.id, user.id);
    const conv = conversationOr404(params.id);
    const peer = conv.kind === 'dm' ? (memberStatesOf(conv.id).find((m) => m.user_id !== user.id) ?? null) : null;
    // The peer deleted the request: the requester only ever sees "Request sent" (safety §7.2), so nothing goes through.
    if (peer?.state === 'declined') {
      const peerUser = getUserRow(peer.user_id);
      throw new ApiError(403, 'forbidden', `Wait for ${peerUser ? peerUser.display_name.split(' ')[0] : 'them'} to accept your request.`, { reason: 'request_pending' });
    }
    const isMessageRequest = isPendingRequester(conv, user.id);
    // Mutes: a muted account can still reply in its existing chats, but cannot open or continue a request (safety §4.1).
    if (isMessageRequest) assertCanPost(user, 'message_request');
    enforceRateLimit(user, 'message_send');

    if (body.kind === 'text' && !body.text?.trim()) throw ApiError.badRequest('Write something first.');
    let images = body.images ?? [];
    if (body.kind === 'image') {
      if (images.length === 0) throw ApiError.badRequest('Pick a photo first.');
      images = assertOwnImages(user, images, LIMITS.messageImages);
      if (conv.kind === 'dm') {
        if (peer && !isFollowing(peer.user_id, user.id)) {
          assertAccountAge(user, DAY, 'New accounts can send photos to people who follow them after their first day.');
        }
      }
    } else {
      images = [];
    }
    if (body.kind === 'card') {
      if (!body.card) throw ApiError.badRequest('Nothing to share.');
      const card = resolveCard(body.card, user.id);
      if (card.status === 'unavailable') throw ApiError.badRequest("That item isn't available any more.");
    }
    if (body.replyToId) messageInConversation(conv.id, body.replyToId);

    const surface = conv.kind === 'dm' ? 'message' : 'group_message';
    const mod = moderateWrite(
      [{ text: body.text }],
      { ...modCtx(user, surface, { isMessageRequest }), conversationId: conv.id },
      blockedTarget(user, 'message'),
    );
    const message = sendMessage({
      conversationId: conv.id,
      sender: user,
      kind: body.kind,
      text: body.text,
      images,
      card: body.kind === 'card' ? body.card : undefined,
      replyToId: body.replyToId,
      clientId: body.clientId,
      banner: mod.recipientBanner,
      status: mod.persistStatus,
    });
    commitModeration(mod, { ...blockedTarget(user, 'message'), entityId: message.id });
    trackEvent('message_send', { userId: user.id, universityId: user.universityId }, { kind: body.kind, conversationKind: conv.kind, request: isMessageRequest });
    const out: WithModeration<Message> = { ...message, moderation: toAuthorNotice(mod) };
    res.status(201).json(out);
  }),
);

router.delete(
  '/:id/messages/:messageId',
  validate({ params: messageParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string; messageId: string }>(req);
    assertMember(params.id, req.user!.id);
    messageInConversation(params.id, params.messageId);
    const out: Message = deleteMessage(params.messageId, req.user!);
    res.json(out);
  }),
);

router.put(
  '/:id/messages/:messageId/reaction',
  validate({ params: messageParams, body: reactionSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<SetReactionRequest, unknown, { id: string; messageId: string }>(req);
    assertMember(params.id, req.user!.id);
    messageInConversation(params.id, params.messageId);
    const out: Message = setReaction(params.messageId, req.user!.id, body.emoji);
    res.json(out);
  }),
);

router.post(
  '/:id/messages/:messageId/offer',
  validate({ params: messageParams, body: offerSchema }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<OfferActionRequest, unknown, { id: string; messageId: string }>(req);
    assertMember(params.id, req.user!.id);
    messageInConversation(params.id, params.messageId);
    const out: Message = setOfferStatus(params.messageId, req.user!, body.action);
    res.json(out);
  }),
);

export default router;
