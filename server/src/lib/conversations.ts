/**
 * Conversations & messages — the ONLY writer of the conversation / message tables (SPEC §4.2.11).
 *                                                                      LANE S-M2b owns this file.
 *
 * Behavioural rules (SPEC §4.2.11, safety §7.2):
 *  - `openDm`: find/create by `dm_key`; new + peer does NOT follow viewer → peer state 'request' (rate limit
 *    `message_request`, `requireCanPost('message_request')`). 403 `cannot_message` for: block either way, peer not
 *    active, whoCanMessage violation, minor cross-campus rule, active cooldown, self. `context` is validated through
 *    `resolveCard` (must be 'available' and owned by the peer) and (re)pinned.
 *  - Request cap (DMs): the requester may send ONE text/image/card message until accepted → the 2nd throws 403
 *    `forbidden` `{ reason:'request_pending' }`. Offers are EXEMPT from the cap, but at most ONE pending offer may
 *    exist per conversation (409 `conflict`). A message sent by the member whose state is 'request' implicitly
 *    accepts the request first.
 *  - `addMember`: idempotent; revives 'left'. `message.group_added` fires ONLY when `addedBy` is set,
 *    `addedBy !== userId` and `silent` is not set. Publishes ws `conversation.updated` unless silent.
 *  - `conversation.updated` producers: updateConversation, acceptRequest, addMember (non-silent), removeMember,
 *    touchContext (+ openDm when it re-pins a context).
 *  - Course chats: `createCourseConversation` stores course_id / course_code / course_title / course_term and
 *    `serializeConversation` builds `CourseChatMeta` from those columns ONLY (never campus' tables); title = code.
 *  - Does NOT moderate message text: the calling ROUTE runs `moderateWrite` first (surface 'message' /
 *    'group_message'). Group titles get a defence-in-depth `moderateText` gate here (the route moderates too).
 *  - Moderation status (SPEC §3.1): a `held` / `hidden` / `removed` row exists only for its sender. Other members never
 *    get it from `listMessages`, the inbox preview or ws; a `held` send is not delivered at all (no last_message_*,
 *    unread, `message.new` or `message.request`) until the message adapter's `setStatus('active')` delivers it.
 *    `setStatus('hidden'|'removed')` pushes `message.deleted` to the members it now hides the row from.
 *
 * SEED-ONLY additions (SeedKit.convo, SPEC §4.6): `seedDm`, `seedGroup`; `createCourseConversation` accepts
 * `id` / `createdAt` / `silent`. Every kit.convo.* call is silent: no notifications, no ws, no rate limits.
 */
import type {
  ContextCardKind, ContextCardRef, ConversationKind, ConversationSummary, CourseChatMeta, EpochMs, Id, MediaImage, MemberState,
  Message, MessageKind, MessagePreview, MessageReaction, MessageReactionEmoji, OfferStatus, OpenDmResponse, Paginated,
  RecipientBanner, ShareCard, ShareCardRef, UserListItem, UserSummary,
} from '@shared/core';
import { MESSAGE_REACTIONS } from '@shared/core';
import { db, inClause, json, newId, prep, tx } from '../db/index';
import { DAY, now } from './clock';
import { registerContentAdapter, resolveCard, type ContentSnapshot } from './content';
import { isBlockedBetween, isFollowing } from './graph';
import { ApiError, decodeCursor, paginate } from './http';
import { log } from './logger';
import { moderateText, modCtx } from './moderation/index';
import { currentBadges, notify, removeNotificationsFor } from './notify';
import { assertCanPost, enforceRateLimit } from './rateLimit';
import { publishToConversation, publishToUser } from './realtime';
import { currencyFor, getUniversityRow } from './universities';
import { getUserRow, getUserRowsByIds, settingsOf, userListItemsByIds, userSummariesByIds, type AuthedUser, type UserRow } from './users';

/* ───────────────────────────── types ───────────────────────────── */

export interface ConversationRow {
  id: Id;
  kind: ConversationKind;
  title: string | null;
  avatar_url: string | null;
  university_id: Id | null;
  created_by: Id | null;
  dm_key: string | null;
  context_kind: ContextCardKind | null;
  context_id: Id | null;
  course_id: Id | null;
  course_code: string | null;
  course_title: string | null;
  course_term: string | null;
  name_locked: number;
  last_message_id: Id | null;
  last_message_at: EpochMs | null;
  created_at: EpochMs;
  updated_at: EpochMs;
}

export interface MemberRow {
  conversation_id: Id;
  user_id: Id;
  role: 'owner' | 'member';
  state: MemberState;
  muted: number;
  last_read_message_id: Id | null;
  last_read_at: EpochMs | null;
  unread_count: number;
  joined_at: EpochMs;
  left_at: EpochMs | null;
}

export interface MessageRow {
  id: Id;
  conversation_id: Id;
  sender_id: Id | null;
  kind: MessageKind;
  text: string;
  images_json: string;
  card_kind: string | null;
  card_id: Id | null;
  offer_listing_id: Id | null;
  offer_amount: number | null;
  offer_status: OfferStatus | null;
  reply_to_id: Id | null;
  client_id: string | null;
  banner: RecipientBanner | null;
  status: string;
  deleted_at: EpochMs | null;
  created_at: EpochMs;
}

export interface SendInput {
  conversationId: Id;
  /** null = system. */
  sender: AuthedUser | null;
  kind: MessageKind;
  text?: string;
  images?: MediaImage[];
  card?: ShareCardRef;
  offer?: { listingId: Id; amount: number };
  replyToId?: Id;
  clientId?: string;
  banner?: RecipientBanner | null;
  status?: 'active' | 'held';
  /** Seeds. */
  createdAt?: EpochMs;
  /** Seeds: no ws / notifications. */
  silent?: boolean;
}

export interface CourseConversationInput {
  universityId: Id;
  courseId: Id;
  /** Normalised, "CS 314". */
  code: string;
  /** Course name. */
  title: string;
  term: string;
  createdBy: Id | null;
  /** SEED-ONLY (kit.convo.course). */
  id?: Id;
  /** SEED-ONLY. */
  createdAt?: EpochMs;
  /** SEED-ONLY: no ws. */
  silent?: boolean;
}

export const CANNOT_MESSAGE = "You can't message this account.";
export const REQUEST_COOLDOWN_MS = 30 * DAY;
const PREVIEW_MAX = 120;
const NEW_ACCOUNT_CHIP_MS = 7 * DAY;
const VISIBLE_STATES: readonly MemberState[] = ['active', 'request'];
/**
 * Message statuses that exist only for their sender (SPEC §3.1, safety §2.1): `held` (pre-publication review),
 * `hidden` (auto-hidden, awaiting staff) and `removed` (staff verdict). For every other viewer such a row is gone:
 * dropped from `listMessages`, skipped by the inbox preview, never fanned out over ws, and — should a row still reach
 * `toMessage()` for that viewer — serialized as an empty `deleted: true` placeholder. `Message` (core.ts) has no
 * `status` field, so the sender's own view carries no chip; that is a reported core.ts gap, not a server concern.
 */
const CONCEALED_STATUSES: ReadonlySet<string> = new Set(['held', 'hidden', 'removed']);
/** SQL fragment (one `?` = viewer id): rows the viewer may see. */
const SQL_VISIBLE_TO_VIEWER = "(status NOT IN ('held','hidden','removed') OR sender_id = ?)";

/* ───────────────────────────── row access ───────────────────────────── */

export function getConversationRow(id: Id): ConversationRow | null {
  return (prep('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined) ?? null;
}

function mustConversation(id: Id): ConversationRow {
  const row = getConversationRow(id);
  if (!row) throw ApiError.notFound('That conversation is not available.');
  return row;
}

function memberRows(conversationId: Id): MemberRow[] {
  return prep('SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at, user_id').all(conversationId) as MemberRow[];
}

function memberRow(conversationId: Id, userId: Id): MemberRow | null {
  return (prep('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId) as MemberRow | undefined) ?? null;
}

function getMessageRow(id: Id): MessageRow | null {
  return (prep('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined) ?? null;
}

/** True when the row's moderation status hides it from this viewer (never from its own sender). */
function concealedFrom(row: MessageRow, viewerId: Id): boolean {
  return CONCEALED_STATUSES.has(row.status) && row.sender_id !== viewerId;
}

/**
 * The newest message this viewer may see (inbox preview). `conversations.last_message_id` (write order, viewer-agnostic)
 * wins whenever the viewer may see it; otherwise — it is concealed from them, or a strictly newer row exists that only
 * this viewer sees (their own held message) — the newest visible row by (created_at, id).
 */
function lastVisibleMessage(conv: ConversationRow, viewerId: Id): MessageRow | null {
  const last = conv.last_message_id ? getMessageRow(conv.last_message_id) : null;
  const newest =
    (prep(`SELECT * FROM messages WHERE conversation_id = ? AND ${SQL_VISIBLE_TO_VIEWER} ORDER BY created_at DESC, id DESC LIMIT 1`).get(
      conv.id, viewerId,
    ) as MessageRow | undefined) ?? null;
  if (last && !concealedFrom(last, viewerId) && (!newest || newest.created_at <= last.created_at)) return last;
  return newest;
}

function dmKeyOf(a: Id, b: Id): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function cannotMessage(): ApiError {
  return new ApiError(403, 'cannot_message', CANNOT_MESSAGE);
}

function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

function touchConversation(conversationId: Id, at: EpochMs): void {
  prep('UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?').run(at, conversationId);
}

function publishUpdated(conversationId: Id, opts?: { onlyStates?: MemberState[]; exceptUserId?: Id }): void {
  publishToConversation(conversationId, { type: 'conversation.updated', conversationId }, { onlyStates: opts?.onlyStates ?? [...VISIBLE_STATES], exceptUserId: opts?.exceptUserId });
}

function publishBadges(userId: Id): void {
  publishToUser(userId, { type: 'badges', badges: currentBadges(userId) });
}

/** The other DM member (any state), or null. */
function dmPeerRow(conversationId: Id, viewerId: Id): MemberRow | null {
  return (prep('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1').get(conversationId, viewerId) as MemberRow | undefined) ?? null;
}

function pendingRequestMember(conv: ConversationRow): MemberRow | null {
  if (conv.kind !== 'dm') return null;
  return (prep("SELECT * FROM conversation_members WHERE conversation_id = ? AND state = 'request' LIMIT 1").get(conv.id) as MemberRow | undefined) ?? null;
}

function cooldownActive(senderId: Id, recipientId: Id, at: EpochMs): boolean {
  const row = prep('SELECT until FROM message_request_cooldowns WHERE sender_id = ? AND recipient_id = ?').get(senderId, recipientId) as { until: EpochMs } | undefined;
  return !!row && row.until > at;
}

function validateContext(context: ContextCardRef, peerId: Id, viewerId: Id): ShareCard {
  const card = resolveCard(context, viewerId);
  if (card.status !== 'available' || card.ownerId !== peerId) {
    throw ApiError.badRequest("That item isn't available any more.");
  }
  return card;
}

/* ───────────────────────────── openDm / createGroup / course ───────────────────────────── */

/**
 * The per-recipient gate every NEW contact goes through — a DM, a group invite at create time, or an add to an existing
 * group (safety §7.2 / §7.7): active + unblocked, the recipient's "Who can message me" (campus / people I follow), the
 * minor cross-campus rule and the 30-day decline cooldown. Throws 403 `cannot_message`.
 */
export function assertCanReach(viewer: AuthedUser, peer: UserRow | null, at: EpochMs = now()): asserts peer is UserRow {
  if (!peer || peer.id === viewer.id || peer.status !== 'active') throw cannotMessage();
  if (isBlockedBetween(viewer.id, peer.id)) throw cannotMessage();
  const settings = settingsOf(peer);
  if (settings.whoCanMessage === 'campus' && peer.university_id !== viewer.universityId) throw cannotMessage();
  if (settings.whoCanMessage === 'following' && !isFollowing(peer.id, viewer.id)) throw cannotMessage();
  if (peer.is_adult === 0 && peer.university_id !== viewer.universityId) throw cannotMessage(); // safety §7.7
  if (cooldownActive(viewer.id, peer.id, at)) throw cannotMessage();
}

/** Finds/creates by dm_key; new + peer does NOT follow viewer → peer member state 'request'. Throws 403 `cannot_message`. */
export function openDm(viewer: AuthedUser, peerId: Id, context?: ContextCardRef): OpenDmResponse {
  if (peerId === viewer.id) throw cannotMessage();
  const peer = getUserRow(peerId);
  if (!peer || peer.status !== 'active') throw cannotMessage();
  if (isBlockedBetween(viewer.id, peerId)) throw cannotMessage();
  const at = now();
  const key = dmKeyOf(viewer.id, peerId);
  const existing = prep('SELECT * FROM conversations WHERE dm_key = ?').get(key) as ConversationRow | undefined;

  if (existing) {
    const mine = memberRow(existing.id, viewer.id);
    const theirs = memberRow(existing.id, peerId);
    let updated = false;
    tx(() => {
      if (!mine) {
        prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(existing.id, viewer.id, 'member', 'active', at);
      } else if (mine.state === 'left' || mine.state === 'declined') {
        prep("UPDATE conversation_members SET state = 'active', left_at = NULL, joined_at = ? WHERE conversation_id = ? AND user_id = ?").run(at, existing.id, viewer.id);
        updated = true;
      }
      if (theirs && (theirs.state === 'declined' || theirs.state === 'left')) {
        if (theirs.state === 'declined' && cooldownActive(viewer.id, peerId, at)) throw cannotMessage();
        const next: MemberState = isFollowing(peerId, viewer.id) ? 'active' : 'request';
        if (next === 'request') {
          assertCanPost(viewer, 'message_request');
          enforceRateLimit(viewer, 'message_request');
        }
        prep('UPDATE conversation_members SET state = ?, left_at = NULL, joined_at = ? WHERE conversation_id = ? AND user_id = ?').run(next, at, existing.id, peerId);
        updated = true;
      }
      if (context) {
        validateContext(context, peerId, viewer.id);
        if (existing.context_kind !== context.kind || existing.context_id !== context.id) {
          prep('UPDATE conversations SET context_kind = ?, context_id = ?, updated_at = ? WHERE id = ?').run(context.kind, context.id, at, existing.id);
          updated = true;
        }
      }
    });
    if (updated) publishUpdated(existing.id);
    return { conversationId: existing.id, created: false };
  }

  // new conversation: privacy + safety gates
  assertCanReach(viewer, peer, at);
  const peerState: MemberState = isFollowing(peerId, viewer.id) ? 'active' : 'request';
  if (peerState === 'request') {
    assertCanPost(viewer, 'message_request');
    enforceRateLimit(viewer, 'message_request');
  }
  if (context) validateContext(context, peerId, viewer.id);

  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO conversations (id, kind, title, university_id, created_by, dm_key, context_kind, context_id, name_locked, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, 'dm', null, viewer.universityId, viewer.id, key, context?.kind ?? null, context?.id ?? null, 0, at, at);
    prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, viewer.id, 'member', 'active', at);
    prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, peerId, 'member', peerState, at);
  });
  return { conversationId: id, created: true };
}

function gateGroupTitle(user: AuthedUser, title: string): void {
  const verdict = moderateText(title, { ...modCtx(user, 'group_name'), field: 'name' });
  if (verdict.action === 'block') {
    throw new ApiError(422, 'content_blocked', verdict.userMessage?.body ?? "That name isn't allowed.", {
      messageId: verdict.userMessage?.id ?? 'group_name', title: verdict.userMessage?.title ?? 'Pick another name', category: verdict.category,
      guidelineAnchor: verdict.userMessage?.guidelineAnchor ?? null, support: verdict.support,
    });
  }
}

/** Non-followers of the creator join as 'request'; > 10 members → everyone 'request'. Blocked pairs → 403 `cannot_message`. */
export function createGroup(creator: AuthedUser, input: { title?: string | null; memberIds: Id[] }): Id {
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== creator.id);
  const title = input.title?.trim() ? input.title.trim() : null;
  if (title) gateGroupTitle(creator, title);
  const rows = getUserRowsByIds(memberIds);
  const at = now();
  for (const id of memberIds) assertCanReach(creator, rows.get(id) ?? null, at);
  const id = newId();
  const everyoneRequests = memberIds.length + 1 > 10;
  tx(() => {
    prep(
      `INSERT INTO conversations (id, kind, title, university_id, created_by, name_locked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, 'group', title, creator.universityId, creator.id, 0, at, at);
    addMember(id, creator.id, { state: 'active', role: 'owner', joinedAt: at, silent: true });
    for (const memberId of memberIds) {
      const state: MemberState = !everyoneRequests && isFollowing(memberId, creator.id) ? 'active' : 'request';
      addMember(id, memberId, { state, role: 'member', joinedAt: at, silent: true });
    }
  });
  // notifications (actor = creator, SPEC §4.2.11) + one ws update after the rows exist (addMember was silent inside the tx)
  for (const memberId of memberIds) notifyGroupAdded(id, memberId, creator.id);
  publishUpdated(id);
  return id;
}

/** kind 'course', name_locked = 1; stores course_id / course_code / course_title / course_term; conversations.title = code. */
export function createCourseConversation(input: CourseConversationInput): Id {
  const at = input.createdAt ?? now();
  const id = input.id ?? newId();
  const existing = input.id ? getConversationRow(input.id) : null;
  if (existing) return existing.id; // seeds re-run idempotently
  prep(
    `INSERT INTO conversations (id, kind, title, university_id, created_by, course_id, course_code, course_title, course_term, name_locked, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, 'course', input.code, input.universityId, input.createdBy, input.courseId, input.code, input.title, input.term, 1, at, at);
  return id;
}

function conversationTitleFor(conv: ConversationRow, viewerId: Id): string {
  if (conv.kind === 'course') return conv.course_code ?? conv.title ?? 'Course chat';
  if (conv.kind === 'group') {
    if (conv.title) return conv.title;
    const others = memberRows(conv.id).filter((m) => VISIBLE_STATES.includes(m.state) && m.user_id !== viewerId);
    const shown = userSummariesByIds(others.slice(0, 3).map((m) => m.user_id));
    const names = others.slice(0, 3).map((m) => shown.get(m.user_id)).filter((u): u is UserSummary => !!u).map((u) => firstNameOf(u.displayName));
    if (names.length === 0) return 'Group chat';
    return others.length > 3 ? `${names.join(', ')} +${others.length - 3}` : names.join(', ');
  }
  const peer = dmPeerRow(conv.id, viewerId);
  const summary = peer ? userSummariesByIds([peer.user_id]).get(peer.user_id) : undefined;
  return summary?.displayName ?? 'Chat';
}

function notifyGroupAdded(conversationId: Id, userId: Id, addedBy: Id): void {
  const conv = getConversationRow(conversationId);
  if (!conv) return;
  notify({
    userId, type: 'message.group_added', actorId: addedBy, href: `/messages/${conversationId}`,
    target: { entityType: 'conversation', entityId: conversationId }, data: { title: conversationTitleFor(conv, userId) }, collapse: false,
  });
}

/** Idempotent; revives 'left'. `message.group_added` fires ONLY when addedBy is set, addedBy !== userId and !silent. */
export function addMember(
  conversationId: Id,
  userId: Id,
  opts: { state?: MemberState; role?: 'owner' | 'member'; joinedAt?: EpochMs; addedBy?: Id; silent?: boolean } = {},
): void {
  mustConversation(conversationId);
  const at = opts.joinedAt ?? now();
  const state = opts.state ?? 'active';
  const existing = memberRow(conversationId, userId);
  let changed = false;
  tx(() => {
    if (!existing) {
      prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(conversationId, userId, opts.role ?? 'member', state, at);
      changed = true;
    } else if (existing.state === 'left' || existing.state === 'declined') {
      prep(
        'UPDATE conversation_members SET state = ?, role = ?, joined_at = ?, left_at = NULL, unread_count = 0 WHERE conversation_id = ? AND user_id = ?',
      ).run(state, opts.role ?? existing.role, at, conversationId, userId);
      changed = true;
    }
    if (changed) touchConversation(conversationId, at);
  });
  if (!changed) return;
  if (opts.addedBy && opts.addedBy !== userId && !opts.silent) notifyGroupAdded(conversationId, userId, opts.addedBy);
  if (!opts.silent) publishUpdated(conversationId);
}

/**
 * Gate + landing state for adding `peer` to the existing group `conversationId` (POST /conversations/:id/members).
 * Runs {@link assertCanReach}; someone who DECLINED this group is not re-added inside the 30-day cooldown; someone who
 * LEFT it inside the cooldown lands as a request again (they choose to come back) and is not re-notified. Otherwise
 * non-followers of the adder (or everyone once the group is past auto-accept size) land as a request.
 */
export function groupAddPlan(
  conversationId: Id,
  adder: AuthedUser,
  peer: UserRow | null,
  overAutoAccept: boolean,
  at: EpochMs = now(),
): { state: MemberState; notify: boolean } {
  assertCanReach(adder, peer, at);
  const existing = memberRow(conversationId, peer.id);
  const recentExit = !!existing && (existing.state === 'left' || existing.state === 'declined') && (existing.left_at ?? at) + REQUEST_COOLDOWN_MS > at;
  if (recentExit && existing!.state === 'declined') throw cannotMessage();
  const state: MemberState = overAutoAccept || recentExit || !isFollowing(peer.id, adder.id) ? 'request' : 'active';
  return { state, notify: !recentExit };
}

/** state 'left'. */
export function removeMember(conversationId: Id, userId: Id): void {
  const existing = memberRow(conversationId, userId);
  if (!existing || existing.state === 'left') return;
  const at = now();
  tx(() => {
    prep("UPDATE conversation_members SET state = 'left', left_at = ?, unread_count = 0 WHERE conversation_id = ? AND user_id = ?").run(at, conversationId, userId);
    touchConversation(conversationId, at);
  });
  publishToUser(userId, { type: 'conversation.updated', conversationId });
  publishUpdated(conversationId, { exceptUserId: userId });
}

export function getMembership(conversationId: Id, userId: Id): { state: MemberState; role: string; muted: boolean } | null {
  const row = memberRow(conversationId, userId);
  return row ? { state: row.state, role: row.role, muted: row.muted === 1 } : null;
}

/** Else 404. Default states: 'active' | 'request' (declined / left members are not members any more). */
export function assertMember(conversationId: Id, userId: Id, states: MemberState[] = [...VISIBLE_STATES]): void {
  const row = memberRow(conversationId, userId);
  if (!row || !states.includes(row.state)) throw ApiError.notFound('That conversation is not available.');
}

/* ───────────────────────────── send ───────────────────────────── */

function assertSendInput(input: SendInput): void {
  switch (input.kind) {
    case 'text':
      if (!input.text || !input.text.trim()) throw ApiError.badRequest('Write something first.');
      return;
    case 'image':
      if (!input.images || input.images.length === 0) throw ApiError.badRequest('Pick a photo first.');
      return;
    case 'card':
      if (!input.card) throw ApiError.badRequest('Nothing to share.');
      return;
    case 'offer':
      if (!input.offer || !input.offer.listingId || !Number.isFinite(input.offer.amount) || input.offer.amount < 0) {
        throw ApiError.badRequest('An offer needs a listing and an amount.');
      }
      return;
    case 'system':
      return;
    default:
      throw ApiError.badRequest('Unknown message kind.');
  }
}

function pendingOfferExists(conversationId: Id): boolean {
  return prep("SELECT 1 FROM messages WHERE conversation_id = ? AND kind = 'offer' AND offer_status = 'pending' LIMIT 1").get(conversationId) !== undefined;
}

/**
 * Marks a message row as delivered inside the caller's transaction: `last_message_*` (never displacing a newer
 * message), `updated_at`, and +1 unread for every other active/request member when `bumpUnreadExcept` is not null.
 */
function markDelivered(conversationId: Id, messageId: Id, at: EpochMs, bumpUnreadExcept: Id | null): void {
  prep(
    `UPDATE conversations SET last_message_id = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_id END,
       last_message_at = MAX(COALESCE(last_message_at, 0), ?), updated_at = MAX(updated_at, ?) WHERE id = ?`,
  ).run(at, messageId, at, at, conversationId);
  if (bumpUnreadExcept !== null) {
    prep(
      `UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = ? AND user_id != ? AND state IN ('active','request')`,
    ).run(conversationId, bumpUnreadExcept);
  }
}

/**
 * First delivery of a row that was persisted `held` and has just been approved (`setStatus('active')`): the same
 * side effects `sendMessage` skipped — last_message_* / unread, `message.new` + `badges` per recipient, and the
 * `message.request` notice when this is the requester's first message of a still-pending DM request.
 */
function deliverApproved(row: MessageRow): void {
  const conv = getConversationRow(row.conversation_id);
  if (!conv) return;
  tx(() => markDelivered(conv.id, row.id, row.created_at, row.kind === 'system' ? null : (row.sender_id ?? '')));
  const pending = pendingRequestMember(conv);
  if (pending && row.sender_id && pending.user_id !== row.sender_id) {
    const first = prep('SELECT id FROM messages WHERE conversation_id = ? AND sender_id = ? ORDER BY created_at, id LIMIT 1').get(conv.id, row.sender_id) as { id: Id } | undefined;
    if (first?.id === row.id) {
      notify({
        userId: pending.user_id, type: 'message.request', actorId: row.sender_id, href: `/messages/${conv.id}`,
        target: { entityType: 'conversation', entityId: conv.id }, data: { hasContext: conv.context_kind !== null }, collapse: false,
      });
    }
  }
  for (const m of memberRows(conv.id)) {
    if (!VISIBLE_STATES.includes(m.state) || m.user_id === row.sender_id) continue;
    publishToUser(m.user_id, { type: 'message.new', conversationId: conv.id, message: serializeMessage(row, m.user_id) });
    if (row.kind !== 'system') publishBadges(m.user_id);
  }
}

/**
 * Enforces: membership, DM block → 403 cannot_message, one-message-until-accepted, unread counters, last_message_*,
 * ws 'message.new' per recipient (serialized per viewer), 'badges', notify('message.request') on the first message of
 * a request. Does NOT moderate (the route runs moderateWrite first).
 */
export function sendMessage(input: SendInput): Message {
  assertSendInput(input);
  const conv = mustConversation(input.conversationId);
  const sender = input.sender;
  const at = input.createdAt ?? now();
  const kind: MessageKind = sender ? input.kind : 'system';
  let requestNotifyTo: Id | null = null;

  if (sender) {
    const mine = memberRow(conv.id, sender.id);
    if (!mine || !VISIBLE_STATES.includes(mine.state)) throw ApiError.notFound('That conversation is not available.');
    if (conv.kind === 'dm') {
      const peer = dmPeerRow(conv.id, sender.id);
      if (!peer) throw cannotMessage();
      const peerUser = getUserRow(peer.user_id);
      if (!peerUser || peerUser.status === 'deleted' || peerUser.status === 'banned') throw cannotMessage();
      if (isBlockedBetween(sender.id, peer.user_id)) throw cannotMessage();
    }
    // the recipient replying to a pending request implicitly accepts it
    if (mine.state === 'request' && !input.silent) acceptRequest(conv.id, sender);
    else if (mine.state === 'request' && input.silent) {
      prep("UPDATE conversation_members SET state = 'active' WHERE conversation_id = ? AND user_id = ?").run(conv.id, sender.id);
    }
    // at most ONE pending offer per conversation (inside or outside a request)
    if (kind === 'offer' && pendingOfferExists(conv.id)) throw ApiError.conflict('You already have a pending offer.');
    const pending = pendingRequestMember(conv);
    if (pending && pending.user_id !== sender.id) {
      // sender is the requester of an unaccepted DM request: one text/image/card until accepted; offers are exempt
      if (kind === 'text' || kind === 'image' || kind === 'card') {
        const capped = prep(
          "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind IN ('text','image','card')",
        ).get(conv.id, sender.id) as { n: number };
        if (capped.n >= 1) {
          const peerUser = getUserRow(pending.user_id);
          throw new ApiError(403, 'forbidden', `Wait for ${peerUser ? firstNameOf(peerUser.display_name) : 'them'} to accept your request.`, { reason: 'request_pending' });
        }
      }
      const prior = prep('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ?').get(conv.id, sender.id) as { n: number };
      if (prior.n === 0) requestNotifyTo = pending.user_id; // first message of the request → message.request
    }
  }

  // A 'held' row (pre-publication review, SPEC §3.1) is persisted for its sender only: it is not delivered — no
  // last_message_*, unread counters, ws or request notice — until staff approve it (adapter setStatus → deliverApproved).
  const held = input.status === 'held';
  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, text, images_json, card_kind, card_id, offer_listing_id, offer_amount, offer_status,
         reply_to_id, client_id, banner, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, conv.id, sender?.id ?? null, kind, (input.text ?? '').trim(), JSON.stringify(input.images ?? []),
      kind === 'card' ? input.card!.kind : null, kind === 'card' ? input.card!.id : null,
      kind === 'offer' ? input.offer!.listingId : null, kind === 'offer' ? Math.round(input.offer!.amount) : null, kind === 'offer' ? 'pending' : null,
      input.replyToId ?? null, input.clientId ?? null, input.banner ?? null, input.status ?? 'active', at,
    );
    if (!held) markDelivered(conv.id, id, at, kind === 'system' ? null : (sender?.id ?? ''));
    if (sender) {
      prep('UPDATE conversation_members SET last_read_message_id = ?, last_read_at = ?, unread_count = 0 WHERE conversation_id = ? AND user_id = ?').run(id, at, conv.id, sender.id);
    }
  });

  const row = getMessageRow(id)!;
  if (!input.silent && !held) {
    if (requestNotifyTo && sender) {
      notify({
        userId: requestNotifyTo, type: 'message.request', actorId: sender.id, href: `/messages/${conv.id}`,
        target: { entityType: 'conversation', entityId: conv.id }, data: { hasContext: conv.context_kind !== null }, collapse: false,
      });
    }
    for (const m of memberRows(conv.id)) {
      if (!VISIBLE_STATES.includes(m.state) || m.user_id === sender?.id) continue;
      publishToUser(m.user_id, { type: 'message.new', conversationId: conv.id, message: serializeMessage(row, m.user_id) });
      if (kind !== 'system') publishBadges(m.user_id);
    }
  }
  return serializeMessage(row, sender?.id ?? '');
}

export function sendSystemMessage(conversationId: Id, text: string, createdAt?: EpochMs): Message {
  return sendMessage({ conversationId, sender: null, kind: 'system', text, createdAt });
}

/* ───────────────────────────── requests ───────────────────────────── */

/** state → 'active'; notify('message.request_accepted'); ws 'conversation.updated' to both. */
export function acceptRequest(conversationId: Id, user: AuthedUser): void {
  const conv = mustConversation(conversationId);
  const mine = memberRow(conversationId, user.id);
  if (!mine) throw ApiError.notFound('That conversation is not available.');
  if (mine.state !== 'request') return;
  const at = now();
  tx(() => {
    prep("UPDATE conversation_members SET state = 'active', joined_at = ? WHERE conversation_id = ? AND user_id = ?").run(at, conversationId, user.id);
    touchConversation(conversationId, at);
  });
  if (conv.kind === 'dm') {
    const peer = dmPeerRow(conversationId, user.id);
    if (peer) {
      notify({
        userId: peer.user_id, type: 'message.request_accepted', actorId: user.id, href: `/messages/${conversationId}`,
        target: { entityType: 'conversation', entityId: conversationId }, collapse: false,
      });
    }
  }
  publishUpdated(conversationId);
  publishBadges(user.id);
}

/** state → 'declined'; DM: 30-day cooldown row. The requester is never told. */
export function declineRequest(conversationId: Id, user: AuthedUser): void {
  const conv = mustConversation(conversationId);
  const mine = memberRow(conversationId, user.id);
  if (!mine || mine.state !== 'request') throw ApiError.notFound('That conversation is not available.');
  const at = now();
  tx(() => {
    prep("UPDATE conversation_members SET state = 'declined', left_at = ?, unread_count = 0 WHERE conversation_id = ? AND user_id = ?").run(at, conversationId, user.id);
    if (conv.kind === 'dm') {
      const peer = dmPeerRow(conversationId, user.id);
      if (peer) {
        prep('INSERT OR REPLACE INTO message_request_cooldowns (sender_id, recipient_id, until) VALUES (?,?,?)').run(peer.user_id, user.id, at + REQUEST_COOLDOWN_MS);
      }
    }
  });
  publishToUser(user.id, { type: 'conversation.updated', conversationId });
  publishBadges(user.id);
}

/* ───────────────────────────── read / reactions / delete ───────────────────────────── */

/** ws 'read' only when the conversation is accepted + no block. Reading a request never marks it read (§5.6). */
export function markRead(conversationId: Id, userId: Id, messageId: Id): void {
  const conv = mustConversation(conversationId);
  const mine = memberRow(conversationId, userId);
  if (!mine || mine.state !== 'active') return;
  const msg = getMessageRow(messageId);
  if (!msg || msg.conversation_id !== conversationId) throw ApiError.notFound('That message is not available.');
  const at = now();
  const previous = mine.last_read_message_id ? getMessageRow(mine.last_read_message_id) : null;
  const movesForward = !previous || previous.created_at < msg.created_at || (previous.created_at === msg.created_at && previous.id <= msg.id);
  if (!movesForward) return;
  const unread = prep(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND kind != 'system' AND (sender_id IS NULL OR sender_id != ?)
       AND (created_at > ? OR (created_at = ? AND id > ?))`,
  ).get(conversationId, userId, msg.created_at, msg.created_at, msg.id) as { n: number };
  prep('UPDATE conversation_members SET last_read_message_id = ?, last_read_at = ?, unread_count = ? WHERE conversation_id = ? AND user_id = ?').run(
    messageId, at, unread.n, conversationId, userId,
  );
  if (pendingRequestMember(conv)) return; // unaccepted request: no receipts
  const e = { type: 'read', conversationId, userId, lastReadMessageId: messageId, readAt: at } as const;
  for (const m of memberRows(conversationId)) {
    if (m.user_id === userId || m.state !== 'active') continue;
    if (isBlockedBetween(userId, m.user_id)) continue;
    publishToUser(m.user_id, e);
  }
  publishBadges(userId);
}

/** Publishes ws 'message.updated'. */
export function setReaction(messageId: Id, userId: Id, emoji: MessageReactionEmoji | null): Message {
  const msg = getMessageRow(messageId);
  if (!msg || msg.status === 'deleted' || concealedFrom(msg, userId)) throw ApiError.notFound('That message is not available.');
  assertMember(msg.conversation_id, userId, ['active']);
  if (emoji !== null && !(MESSAGE_REACTIONS as readonly string[]).includes(emoji)) throw ApiError.badRequest('Unknown reaction.');
  if (emoji === null) prep('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(messageId, userId);
  else prep('INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)').run(messageId, userId, emoji, now());
  publishMessageUpdated(msg);
  return serializeMessage(msg, userId);
}

function publishMessageUpdated(msg: MessageRow): void {
  for (const m of memberRows(msg.conversation_id)) {
    if (!VISIBLE_STATES.includes(m.state) || concealedFrom(msg, m.user_id)) continue;
    publishToUser(m.user_id, { type: 'message.updated', conversationId: msg.conversation_id, message: serializeMessage(msg, m.user_id) });
  }
}

/** Own only; status 'deleted', text ''; publishes ws 'message.deleted'. */
export function deleteMessage(messageId: Id, user: AuthedUser): Message {
  const msg = getMessageRow(messageId);
  if (!msg || msg.sender_id !== user.id) throw ApiError.notFound('That message is not available.');
  if (msg.status !== 'deleted') {
    const at = now();
    tx(() => {
      prep("UPDATE messages SET status = 'deleted', text = '', images_json = '[]', deleted_at = ? WHERE id = ?").run(at, messageId);
      touchConversation(msg.conversation_id, at);
    });
    removeNotificationsFor({ entityType: 'message', entityId: messageId });
    publishToConversation(msg.conversation_id, { type: 'message.deleted', conversationId: msg.conversation_id, messageId }, { onlyStates: [...VISIBLE_STATES] });
  }
  return serializeMessage(getMessageRow(messageId)!, user.id);
}

/* ───────────────────────────── offers ───────────────────────────── */

/**
 * accept/decline: only the listing owner (resolveCard(listing).ownerId); withdraw: only the sender. Posts a system
 * line, notify('market.offer_accepted'|'market.offer_declined') to the buyer, publishes ws 'message.updated'.
 * 'accept' while the owner's member state is 'request' implicitly accepts the request; 'decline' leaves it untouched.
 */
export function setOfferStatus(messageId: Id, actor: AuthedUser, action: 'accept' | 'decline' | 'withdraw'): Message {
  const msg = getMessageRow(messageId);
  if (!msg || msg.kind !== 'offer' || !msg.offer_listing_id) throw ApiError.notFound('That offer is not available.');
  assertMember(msg.conversation_id, actor.id);
  if (msg.offer_status !== 'pending') throw ApiError.conflict('This offer is no longer pending.');
  const card = resolveCard({ kind: 'listing', id: msg.offer_listing_id }, actor.id);
  if (action === 'withdraw') {
    if (msg.sender_id !== actor.id) throw ApiError.forbidden('Only the person who made the offer can withdraw it.');
  } else if (!card.ownerId || card.ownerId !== actor.id) {
    throw ApiError.forbidden('Only the seller can respond to this offer.');
  }
  const next: OfferStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'withdrawn';
  const at = now();
  tx(() => {
    prep('UPDATE messages SET offer_status = ? WHERE id = ?').run(next, messageId);
    touchConversation(msg.conversation_id, at);
  });
  if (action === 'accept') acceptRequest(msg.conversation_id, actor);
  const first = firstNameOf(actor.displayName);
  const line = action === 'accept' ? `${first} accepted the offer` : action === 'decline' ? `${first} declined the offer` : `${first} withdrew the offer`;
  sendSystemMessage(msg.conversation_id, line);
  if (action !== 'withdraw' && msg.sender_id) {
    notify({
      userId: msg.sender_id, type: action === 'accept' ? 'market.offer_accepted' : 'market.offer_declined', actorId: actor.id,
      href: `/messages/${msg.conversation_id}`, target: { entityType: 'conversation', entityId: msg.conversation_id },
      data: { amount: msg.offer_amount ?? 0, title: card.title, listingId: msg.offer_listing_id }, collapse: false,
    });
  }
  const updated = getMessageRow(messageId)!;
  publishMessageUpdated(updated);
  return serializeMessage(updated, actor.id);
}

/* ───────────────────────────── update / touch ───────────────────────────── */

/** title: groups only, !name_locked, caller moderates; publishes 'conversation.updated'. */
export function updateConversation(conversationId: Id, user: AuthedUser, patch: { title?: string; muted?: boolean }): void {
  const conv = mustConversation(conversationId);
  assertMember(conversationId, user.id, ['active']);
  const at = now();
  let titleChanged = false;
  if (patch.title !== undefined) {
    if (conv.kind !== 'group') throw ApiError.badRequest('Only group chats can be renamed.');
    if (conv.name_locked === 1) throw ApiError.badRequest("This chat's name is locked.");
    const title = patch.title.trim();
    if (!title) throw ApiError.badRequest('Give the group a name.');
    gateGroupTitle(user, title);
    prep('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, at, conversationId);
    titleChanged = true;
  }
  if (patch.muted !== undefined) {
    prep('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(patch.muted ? 1 : 0, conversationId, user.id);
  }
  if (titleChanged) publishUpdated(conversationId);
  else if (patch.muted !== undefined) {
    publishToUser(user.id, { type: 'conversation.updated', conversationId });
    publishBadges(user.id);
  }
}

/**
 * Publishes ws { type:'conversation.updated', conversationId } to the ACTIVE + REQUEST members of every conversation
 * whose context is (kind, id). Callers: market, roommates. **Never throws.**
 */
export function touchContext(kind: ContextCardKind, id: Id): void {
  try {
    const rows = prep('SELECT id FROM conversations WHERE context_kind = ? AND context_id = ?').all(kind, id) as { id: Id }[];
    for (const r of rows) publishUpdated(r.id);
  } catch (err) {
    log.error('touchContext failed', err);
  }
}

/* ───────────────────────────── lists ───────────────────────────── */

const CONTEXT_SORT_BUMP = 10_000_000_000_000; // > any epoch-ms; requests carrying a context sort first

/**
 * chats: state 'active' AND (last_message_at NOT NULL OR created_by = me); DMs blocked by me are hidden.
 * requests: state 'request' AND last_message_at NOT NULL; requests with a context card sort first.
 */
export function listConversations(userId: Id, tab: 'chats' | 'requests', page: { cursor?: string; limit: number }): Paginated<ConversationSummary> {
  const cur = decodeCursor(page.cursor);
  const limit = Math.max(1, Math.min(50, page.limit));
  const notBlockedByMe = `NOT (c.kind = 'dm' AND EXISTS (
      SELECT 1 FROM conversation_members o JOIN blocks b ON b.blocker_id = ? AND b.blocked_id = o.user_id
       WHERE o.conversation_id = c.id AND o.user_id != ?))`;
  const sortExpr = tab === 'requests' ? `(c.last_message_at + CASE WHEN c.context_kind IS NOT NULL THEN ${CONTEXT_SORT_BUMP} ELSE 0 END)` : 'COALESCE(c.last_message_at, c.created_at)';
  const params: unknown[] = [userId, userId, userId];
  let where: string;
  if (tab === 'chats') {
    where = `m.state = 'active' AND (c.last_message_at IS NOT NULL OR c.created_by = ?)`;
    params.push(userId);
  } else {
    where = `m.state = 'request' AND c.last_message_at IS NOT NULL`;
  }
  let keyset = '1 = 1';
  if (cur) {
    keyset = `(${sortExpr} < ? OR (${sortExpr} = ? AND c.id < ?))`;
    params.push(cur.k, cur.k, cur.id);
  }
  params.push(limit + 1);
  const rows = db
    .prepare(
      `SELECT c.id AS id, ${sortExpr} AS k FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
        WHERE ${notBlockedByMe} AND ${where} AND ${keyset} ORDER BY k DESC, c.id DESC LIMIT ?`,
    )
    .all(...params) as { id: Id; k: number }[];
  return paginate(rows, limit, (r) => ({ k: r.k, id: r.id }), (r) => serializeConversation(r.id, userId));
}

function conversationCurrency(conv: ConversationRow, viewerId: Id): string {
  const uniId = conv.university_id ?? getUserRow(viewerId)?.university_id ?? null;
  return currencyFor(uniId ? getUniversityRow(uniId)?.country_code : null);
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

function previewOf(msg: MessageRow, conv: ConversationRow, viewerId: Id, senders: Map<Id, UserSummary>): MessagePreview {
  const sender = msg.sender_id ? (senders.get(msg.sender_id) ?? null) : null;
  let text: string;
  if (msg.status === 'deleted') text = 'Message deleted';
  else if (msg.kind === 'image') text = msg.text ? msg.text : 'Photo';
  else if (msg.kind === 'offer') text = `Offer: ${formatMoney(msg.offer_amount ?? 0, conversationCurrency(conv, viewerId))}`;
  else if (msg.kind === 'card') text = msg.text ? msg.text : `Shared a ${msg.card_kind === 'roommate' ? 'roommate post' : (msg.card_kind ?? 'link')}`;
  else text = msg.text;
  if (text.length > PREVIEW_MAX) text = `${text.slice(0, PREVIEW_MAX - 1)}…`;
  return { id: msg.id, kind: msg.kind, text, senderId: msg.sender_id, senderName: sender ? firstNameOf(sender.displayName) : null, createdAt: msg.created_at };
}

export function serializeConversation(conversationId: Id, viewerId: Id): ConversationSummary {
  const conv = mustConversation(conversationId);
  const mine = memberRow(conversationId, viewerId);
  if (!mine || !VISIBLE_STATES.includes(mine.state)) throw ApiError.notFound('That conversation is not available.');
  const members = memberRows(conversationId).filter((m) => VISIBLE_STATES.includes(m.state));
  const others = members.filter((m) => m.user_id !== viewerId);
  const summaries = userSummariesByIds(others.map((m) => m.user_id));
  const peerMember = conv.kind === 'dm' ? (others[0] ?? null) : null;
  const peer = peerMember ? (summaries.get(peerMember.user_id) ?? null) : null;
  const peerRow: UserRow | null = peerMember ? getUserRow(peerMember.user_id) : null;
  // never the viewer: a chat they are alone in has an empty preview (the share sheet opened from Buzz must not render
  // the viewer's own face / name, SPEC §3.2)
  const memberPreview = others.slice(0, 4).map((m) => summaries.get(m.user_id)).filter((u): u is UserSummary => !!u);

  let context: ShareCard | null = null;
  let contextLabel: string | null = null;
  if (conv.context_kind && conv.context_id) {
    context = resolveCard({ kind: conv.context_kind, id: conv.context_id }, viewerId);
    if (context.ownerId === viewerId) contextLabel = conv.context_kind === 'listing' ? 'About your listing' : 'About your roommate post';
  }
  const course: CourseChatMeta | null =
    conv.kind === 'course' && conv.course_id
      ? { courseId: conv.course_id, code: conv.course_code ?? conv.title ?? '', title: conv.course_title ?? '', term: conv.course_term ?? '' }
      : null;
  // the preview is the newest row THIS viewer may see (a held/hidden/removed row exists only for its sender)
  const last = lastVisibleMessage(conv, viewerId);
  const lastSenders = last?.sender_id ? userSummariesByIds([last.sender_id]) : new Map<Id, UserSummary>();

  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.kind === 'dm' ? (peer?.displayName ?? 'Chat') : conversationTitleFor(conv, viewerId),
    avatarUrl: conv.kind === 'dm' ? (peer?.avatarUrl ?? null) : conv.avatar_url,
    peer,
    memberPreview,
    memberCount: members.length,
    state: mine.state,
    requestPending: mine.state === 'active' && peerMember?.state === 'request',
    context: context as ConversationSummary['context'],
    contextLabel,
    course,
    lastMessage: last ? previewOf(last, conv, viewerId, lastSenders) : null,
    unreadCount: mine.unread_count,
    muted: mine.muted === 1,
    nameLocked: conv.name_locked === 1,
    peerIsNewAccount: !!peerRow && now() - peerRow.created_at < NEW_ACCOUNT_CHIP_MS,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
  };
}

/* ───────────────────────────── messages ───────────────────────────── */

interface SerializeCtx {
  conv: ConversationRow;
  viewerId: Id;
  /** Viewer is the recipient of an unaccepted request → images withheld. */
  withheld: boolean;
  senders: Map<Id, UserSummary>;
  reactions: Map<Id, { emoji: string; user_id: Id }[]>;
  blocked: Set<Id>;
  currencyBySender: Map<Id, string>;
}

function buildCtx(rows: MessageRow[], conv: ConversationRow, viewerId: Id): SerializeCtx {
  const mine = viewerId ? memberRow(conv.id, viewerId) : null;
  const senderIds = [...new Set(rows.map((r) => r.sender_id).filter((s): s is Id => !!s))];
  const senders = userSummariesByIds(senderIds);
  const reactions = new Map<Id, { emoji: string; user_id: Id }[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 400) {
    const inc = inClause(ids.slice(i, i + 400));
    const hits = db.prepare(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN ${inc.sql} ORDER BY created_at`).all(...inc.params) as {
      message_id: Id; emoji: string; user_id: Id;
    }[];
    for (const h of hits) reactions.set(h.message_id, [...(reactions.get(h.message_id) ?? []), { emoji: h.emoji, user_id: h.user_id }]);
  }
  const blocked = new Set<Id>();
  if (viewerId && (conv.kind === 'group' || conv.kind === 'course')) {
    for (const s of senderIds) if (s !== viewerId && isBlockedBetween(viewerId, s)) blocked.add(s);
  }
  const currencyBySender = new Map<Id, string>();
  for (const s of senderIds) {
    const u = senders.get(s);
    currencyBySender.set(s, currencyFor(u ? getUniversityRow(u.universityId)?.country_code : null));
  }
  return { conv, viewerId, withheld: mine?.state === 'request', senders, reactions, blocked, currencyBySender };
}

function toMessage(row: MessageRow, ctx: SerializeCtx): Message {
  // A row concealed from this viewer by moderation (held/hidden/removed, viewer ≠ sender) is the same empty
  // placeholder as an author-deleted row: text '', no images/card/offer/banner, `deleted: true` (SPEC §3.1).
  const concealed = concealedFrom(row, ctx.viewerId);
  const deleted = row.status === 'deleted' || concealed;
  const isSender = !!ctx.viewerId && row.sender_id === ctx.viewerId;
  const withheld = ctx.withheld && !isSender && !deleted;
  const images = deleted || withheld ? [] : json<MediaImage[]>(row.images_json, []);
  const raw = ctx.reactions.get(row.id) ?? [];
  const byEmoji = new Map<string, MessageReaction>();
  for (const r of raw) {
    const cur = byEmoji.get(r.emoji) ?? { emoji: r.emoji as MessageReactionEmoji, count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === ctx.viewerId) cur.mine = true;
    byEmoji.set(r.emoji, cur);
  }
  const card = !deleted && row.card_kind && row.card_id ? resolveCard({ kind: row.card_kind as ShareCardRef['kind'], id: row.card_id }, ctx.viewerId) : null;
  const offer =
    !concealed && row.kind === 'offer' && row.offer_listing_id
      ? {
          listingId: row.offer_listing_id, amount: row.offer_amount ?? 0,
          currency: (row.sender_id && ctx.currencyBySender.get(row.sender_id)) || conversationCurrency(ctx.conv, ctx.viewerId), status: row.offer_status ?? 'pending',
        }
      : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender_id ? (ctx.senders.get(row.sender_id) ?? null) : null,
    kind: row.kind,
    text: deleted ? '' : row.text,
    images,
    imagesWithheld: withheld && json<MediaImage[]>(row.images_json, []).length > 0,
    card,
    offer,
    reactions: [...byEmoji.values()],
    replyToId: row.reply_to_id,
    clientId: isSender ? row.client_id : null,
    banner: !isSender && !deleted ? row.banner : null,
    collapsedByBlock: !!row.sender_id && ctx.blocked.has(row.sender_id),
    deleted,
    createdAt: row.created_at,
  };
}

export function serializeMessage(row: MessageRow, viewerId: Id): Message {
  const conv = mustConversation(row.conversation_id);
  return toMessage(row, buildCtx([row], conv, viewerId));
}

/** Newest first. Rows held / hidden / removed by moderation are returned only to their sender (SPEC §3.1). */
export function listMessages(conversationId: Id, viewerId: Id, page: { cursor?: string; limit: number }): Paginated<Message> {
  const conv = mustConversation(conversationId);
  assertMember(conversationId, viewerId);
  const cur = decodeCursor(page.cursor);
  const limit = Math.max(1, Math.min(50, page.limit));
  const params: unknown[] = [conversationId, viewerId];
  let keyset = '1 = 1';
  if (cur) {
    keyset = '(created_at < ? OR (created_at = ? AND id < ?))';
    params.push(cur.k, cur.k, cur.id);
  }
  params.push(limit + 1);
  const rows = db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? AND ${SQL_VISIBLE_TO_VIEWER} AND ${keyset} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params) as MessageRow[];
  const ctx = buildCtx(rows.slice(0, limit), conv, viewerId);
  return paginate(rows, limit, (r) => ({ k: r.created_at, id: r.id }), (r) => toMessage(r, ctx));
}

export function listMembers(conversationId: Id, viewerId: Id): (UserListItem & { role: 'owner' | 'member'; lastReadMessageId: Id | null })[] {
  mustConversation(conversationId);
  assertMember(conversationId, viewerId);
  const members = memberRows(conversationId).filter((m) => VISIBLE_STATES.includes(m.state));
  const byId = new Map(members.map((m) => [m.user_id, m]));
  return userListItemsByIds(members.map((m) => m.user_id), viewerId).map((u) => {
    const m = byId.get(u.id)!;
    return { ...u, role: m.role, lastReadMessageId: m.last_read_message_id };
  });
}

/** Market "chats" stat. */
export function conversationCountForContext(kind: ContextCardKind, id: Id): number {
  return (prep('SELECT COUNT(*) AS n FROM conversations WHERE context_kind = ? AND context_id = ?').get(kind, id) as { n: number }).n;
}

/* ───────────────────────────── SEED-ONLY (SeedKit.convo) ───────────────────────────── */

/**
 * Silent DM create-or-get by dm_key: no notifications, no ws, no rate limits, no context validation.
 * `a` is the opener ('active'); `b` gets `peerState` (default 'active').
 */
export function seedDm(a: Id, b: Id, o: { context?: ContextCardRef; peerState?: MemberState; createdAt?: EpochMs } = {}): Id {
  const key = dmKeyOf(a, b);
  const at = o.createdAt ?? now();
  const existing = prep('SELECT * FROM conversations WHERE dm_key = ?').get(key) as ConversationRow | undefined;
  if (existing) {
    if (o.context && (existing.context_kind !== o.context.kind || existing.context_id !== o.context.id)) {
      prep('UPDATE conversations SET context_kind = ?, context_id = ? WHERE id = ?').run(o.context.kind, o.context.id, existing.id);
    }
    return existing.id;
  }
  const opener = getUserRow(a);
  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO conversations (id, kind, university_id, created_by, dm_key, context_kind, context_id, name_locked, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, 'dm', opener?.university_id ?? null, a, key, o.context?.kind ?? null, o.context?.id ?? null, 0, at, at);
    prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, a, 'member', 'active', at);
    prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, b, 'member', o.peerState ?? 'active', at);
  });
  return id;
}

/** Silent group create: owner + members all 'active'. */
export function seedGroup(title: string, ownerId: Id, memberIds: Id[], createdAt?: EpochMs): Id {
  const at = createdAt ?? now();
  const owner = getUserRow(ownerId);
  const id = newId();
  tx(() => {
    prep(`INSERT INTO conversations (id, kind, title, university_id, created_by, name_locked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, 'group', title, owner?.university_id ?? null, ownerId, 0, at, at,
    );
    prep('INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, ownerId, 'owner', 'active', at);
    for (const m of new Set(memberIds)) {
      if (m === ownerId) continue;
      prep('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES (?,?,?,?,?)').run(id, m, 'member', 'active', at);
    }
  });
  return id;
}

/* ───────────────────────────── content adapters (foundation) ───────────────────────────── */

const STAFF_WINDOW = 10;

function messageSnapshot(row: MessageRow): ContentSnapshot | null {
  const conv = getConversationRow(row.conversation_id);
  if (!conv) return null;
  const sender = row.sender_id ? getUserRow(row.sender_id) : null;
  const status = (['active', 'held', 'hidden', 'removed', 'deleted'] as const).includes(row.status as never) ? (row.status as ContentSnapshot['status']) : 'active';
  return {
    entityType: 'message',
    entityId: row.id,
    authorId: row.sender_id ?? '',
    universityId: sender?.university_id ?? conv.university_id ?? '',
    status,
    surface: conv.kind === 'dm' ? 'message' : 'group_message',
    anon: false,
    autoHideImmune: false,
    createdAt: row.created_at,
    label: 'message',
    fields: row.text ? [{ field: 'body', text: row.text }] : [],
    media: json<MediaImage[]>(row.images_json, []).map((i) => ({ url: i.url, kind: 'image' as const })),
    href: `/messages/${conv.id}`,
    parent: { entityType: 'conversation', entityId: conv.id },
  };
}

/** Staff-only report window: the reported message + ≤ 10 preceding ones (public senders; never anonymous content). */
export function reportWindowFor(messageId: Id): { id: Id; senderId: Id | null; kind: MessageKind; text: string; images: MediaImage[]; status: string; createdAt: EpochMs }[] {
  const msg = getMessageRow(messageId);
  if (!msg) return [];
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(msg.conversation_id, msg.created_at, msg.created_at, msg.id, STAFF_WINDOW + 1) as MessageRow[];
  return rows.reverse().map((r) => ({
    id: r.id, senderId: r.sender_id, kind: r.kind, text: r.status === 'deleted' ? '' : r.text, images: json<MediaImage[]>(r.images_json, []), status: r.status, createdAt: r.created_at,
  }));
}

registerContentAdapter({
  entityType: 'message',
  load(id) {
    const row = getMessageRow(id);
    return row ? messageSnapshot(row) : null;
  },
  setStatus(id, status) {
    const before = getMessageRow(id);
    if (!before || before.status === 'deleted' || before.status === status) return;
    prep('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
    if (status === 'removed') removeNotificationsFor({ entityType: 'message', entityId: id });
    const after = getMessageRow(id)!;
    // a held row approved for the first time is delivered now (last_message_*, unread, message.new, request notice)
    if (before.status === 'held' && status === 'active') {
      deliverApproved(after);
      return;
    }
    // everyone else: the row vanishes for viewers it is now concealed from, reappears for viewers it was concealed
    // from (restore after hide/removal), and is a plain update for the sender
    for (const m of memberRows(after.conversation_id)) {
      if (!VISIBLE_STATES.includes(m.state)) continue;
      const wasConcealed = concealedFrom(before, m.user_id);
      if (concealedFrom(after, m.user_id)) {
        if (!wasConcealed) publishToUser(m.user_id, { type: 'message.deleted', conversationId: after.conversation_id, messageId: id });
      } else if (wasConcealed) {
        publishToUser(m.user_id, { type: 'message.new', conversationId: after.conversation_id, message: serializeMessage(after, m.user_id) });
      } else {
        publishToUser(m.user_id, { type: 'message.updated', conversationId: after.conversation_id, message: serializeMessage(after, m.user_id) });
      }
    }
  },
  staffContext(id) {
    return { messages: reportWindowFor(id) };
  },
});

registerContentAdapter({
  entityType: 'conversation',
  load(id) {
    const conv = getConversationRow(id);
    if (!conv) return null;
    const last = conv.last_message_id ? getMessageRow(conv.last_message_id) : null;
    return {
      entityType: 'conversation',
      entityId: conv.id,
      authorId: conv.created_by ?? '',
      universityId: conv.university_id ?? '',
      status: 'active',
      surface: conv.kind === 'dm' ? 'message' : 'group_message',
      anon: false,
      autoHideImmune: true,
      createdAt: conv.created_at,
      label: conv.kind === 'dm' ? 'conversation' : conv.kind === 'course' ? 'course chat' : 'group chat',
      fields: [...(conv.title ? [{ field: 'title', text: conv.title }] : []), ...(last && last.text ? [{ field: 'body', text: last.text }] : [])],
      media: [],
      href: `/messages/${conv.id}`,
      parent: null,
    };
  },
  setStatus(id, status) {
    // A conversation has no status column; a "removed" verdict clears the (group) title only.
    if (status === 'removed') prep("UPDATE conversations SET title = NULL WHERE id = ? AND kind = 'group'").run(id);
  },
  staffContext(id) {
    const conv = getConversationRow(id);
    return conv?.last_message_id ? { messages: reportWindowFor(conv.last_message_id) } : { messages: [] };
  },
});
