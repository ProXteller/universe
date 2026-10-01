/**
 * lib/conversations.ts (SPEC §4.2.11, safety §7.2) + routes #36–#38: request rules, offer cap-exemption + 409,
 * implicit accept, addedBy semantics, `conversation.updated` producers, course meta, serializers, seeds, adapters, share.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WsServerEvent } from '@shared/core';
import { DAY, HOUR, now, setNow } from '../../src/lib/clock';
import { getContentAdapter, registerCardResolver } from '../../src/lib/content';
import {
  acceptRequest, addMember, createCourseConversation, createGroup, declineRequest, deleteMessage, getMembership, listConversations,
  listMembers, listMessages, markRead, openDm, removeMember, seedDm, seedGroup, sendMessage, sendSystemMessage, serializeConversation,
  serializeMessage, setOfferStatus, setReaction, touchContext, updateConversation,
} from '../../src/lib/conversations';
import { badgesFor } from '../../src/lib/notify';
import { createTestApp, type TestCtx } from '../../src/lib/testing';
import type { AuthedUser } from '../../src/lib/users';

let ctx: TestCtx;
let unregisterListing: (() => void) | null = null;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});
afterEach(() => {
  unregisterListing?.();
  unregisterListing = null;
  setNow(null);
});

const evs = (userId: string, type?: WsServerEvent['type']): WsServerEvent[] => ctx.wsEventsFor(userId).filter((e) => !type || e.type === type);
const notifs = (userId: string): { type: string; actor_id: string | null; data_json: string }[] =>
  ctx.db.prepare('SELECT type, actor_id, data_json FROM notifications WHERE user_id = ? ORDER BY created_at, rowid').all(userId) as never;
const state = (conversationId: string, userId: string): string | undefined => getMembership(conversationId, userId)?.state;

/** A listing owned by `ownerId` for the stub resolver (removed in afterEach through the returned unregister()). */
function stubListing(ownerId: string, status: 'available' | 'sold' = 'available'): void {
  unregisterListing?.();
  unregisterListing = registerCardResolver('listing', (id) => ({
    title: `Listing ${id}`, subtitle: null, imageUrl: null, href: `/market/${id}`, status, price: 40, badge: null, ownerId, meetupSpot: 'PCL lobby',
  }));
}

function strangers(): { a: AuthedUser; b: AuthedUser } {
  return { a: ctx.createUser({ displayName: 'Ava Stone' }), b: ctx.createUser({ displayName: 'Ben Ortiz' }) };
}

describe('openDm (#36)', () => {
  it('creates once by dm_key; the peer lands in Requests unless they follow the viewer', () => {
    const { a, b } = strangers();
    const first = openDm(a, b.id);
    expect(first.created).toBe(true);
    expect(openDm(a, b.id)).toEqual({ conversationId: first.conversationId, created: false });
    expect(state(first.conversationId, a.id)).toBe('active');
    expect(state(first.conversationId, b.id)).toBe('request');
    const friend = ctx.createUser({ follows: [a.id] });
    const dm = openDm(a, friend.id);
    expect(state(dm.conversationId, friend.id)).toBe('active');
    // the creator sees an empty new DM in Chats; the peer sees nothing until a message arrives
    expect(listConversations(a.id, 'chats', { limit: 10 }).items.map((c) => c.id)).toContain(dm.conversationId);
    expect(listConversations(friend.id, 'chats', { limit: 10 }).items.map((c) => c.id)).not.toContain(dm.conversationId);
    expect(listConversations(b.id, 'requests', { limit: 10 }).items).toEqual([]);
  });

  it('refuses self, blocks, non-active peers, privacy settings, minors across campuses and cooldowns with one copy', () => {
    const { a, b } = strangers();
    const copy = "You can't message this account.";
    const expectCannot = (fn: () => unknown): void => {
      try {
        fn();
        throw new Error('expected cannot_message');
      } catch (e) {
        expect(e).toMatchObject({ status: 403, code: 'cannot_message', message: copy });
      }
    };
    expectCannot(() => openDm(a, a.id));
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(b.id, a.id, now());
    expectCannot(() => openDm(a, b.id));
    ctx.db.prepare('DELETE FROM blocks').run();
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(b.id);
    expectCannot(() => openDm(a, b.id));
    ctx.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(b.id);

    ctx.db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify({ whoCanMessage: 'following' }), b.id);
    expectCannot(() => openDm(a, b.id));
    const far = ctx.createUser({ universityId: 'uni_umich' });
    ctx.db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify({ whoCanMessage: 'campus' }), b.id);
    expectCannot(() => openDm(far, b.id));
    ctx.db.prepare("UPDATE users SET settings_json = '{}' WHERE id = ?").run(b.id);
    expect(openDm(far, b.id).created).toBe(true);

    const minor = ctx.createUser({ isAdult: false });
    expectCannot(() => openDm(far, minor.id));
    expect(openDm(a, minor.id).created).toBe(true);

    // decline → 30-day cooldown → same copy; expired → a fresh request
    const dm = openDm(a, b.id);
    sendMessage({ conversationId: dm.conversationId, sender: a, kind: 'text', text: 'hi' });
    declineRequest(dm.conversationId, b);
    expect(state(dm.conversationId, b.id)).toBe('declined');
    expectCannot(() => openDm(a, b.id));
    setNow(now() + 31 * DAY);
    expect(openDm(a, b.id)).toEqual({ conversationId: dm.conversationId, created: false });
    expect(state(dm.conversationId, b.id)).toBe('request');
  });

  it('validates and (re)pins the context card, labels it for the owner and publishes conversation.updated on re-pin', () => {
    const { a, b } = strangers();
    stubListing(b.id);
    expect(() => openDm(a, b.id, { kind: 'listing', id: 'lst_other' })).not.toThrow();
    const dm = openDm(a, b.id, { kind: 'listing', id: 'lst_1' });
    const mine = serializeConversation(dm.conversationId, a.id);
    expect(mine.context).toMatchObject({ kind: 'listing', id: 'lst_1', status: 'available', currency: 'USD', meetupSpot: 'PCL lobby' });
    expect(mine.contextLabel).toBeNull();
    expect(serializeConversation(dm.conversationId, b.id).contextLabel).toBe('About your listing');
    expect(evs(b.id, 'conversation.updated').length).toBeGreaterThan(0);
    stubListing(a.id); // not owned by the peer any more
    expect(() => openDm(a, b.id, { kind: 'listing', id: 'lst_1' })).toThrow(/available/);
    stubListing(b.id, 'sold');
    expect(() => openDm(a, b.id, { kind: 'listing', id: 'lst_1' })).toThrow(/available/);
  });

  it('POST /dm answers OpenDmResponse and 403 cannot_message', async () => {
    const { a, b } = strangers();
    const res = await ctx.as(a.id).post('/api/dm').send({ userId: b.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversationId: expect.any(String), created: true });
    const self = await ctx.as(a.id).post('/api/dm').send({ userId: a.id });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('cannot_message');
    expect((await ctx.as(a.id).post('/api/dm').send({})).status).toBe(400);
  });
});

describe('request rules: one message until accepted, offers exempt, implicit accept', () => {
  it('text → offer delivered (cap exempt) → 2nd text 403 request_pending → 2nd offer 409 → owner accepts the offer → active for both', () => {
    const { a, b } = strangers();
    stubListing(b.id);
    const { conversationId } = openDm(a, b.id, { kind: 'listing', id: 'lst_1' });
    const m1 = sendMessage({ conversationId, sender: a, kind: 'text', text: 'Is this still available?', clientId: 'tmp-1' });
    expect(m1).toMatchObject({ kind: 'text', clientId: 'tmp-1', sender: { id: a.id }, imagesWithheld: false });
    // first message of a request → message.request to the recipient with hasContext; ws message.new + badges
    expect(notifs(b.id)).toEqual([{ type: 'message.request', actor_id: a.id, data_json: JSON.stringify({ hasContext: true }) }]);
    expect(evs(b.id, 'message.new').length).toBe(1);
    expect(evs(b.id, 'badges').at(-1)).toMatchObject({ badges: { requests: 1, messages: 0 } });
    expect(badgesFor(b.id)).toMatchObject({ requests: 1, messages: 0, notifications: 1 });
    expect(badgesFor(a.id).messages).toBe(0);

    const offer = sendMessage({ conversationId, sender: a, kind: 'offer', offer: { listingId: 'lst_1', amount: 35 } });
    expect(offer.offer).toEqual({ listingId: 'lst_1', amount: 35, currency: 'USD', status: 'pending' });
    expect(notifs(b.id).length).toBe(1); // no second message.request

    let err: unknown;
    try {
      sendMessage({ conversationId, sender: a, kind: 'text', text: 'hello?' });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 403, code: 'forbidden', details: { reason: 'request_pending' }, message: 'Wait for Ben to accept your request.' });
    try {
      sendMessage({ conversationId, sender: a, kind: 'offer', offer: { listingId: 'lst_1', amount: 38 } });
      throw new Error('expected 409');
    } catch (e) {
      expect(e).toMatchObject({ status: 409, code: 'conflict', message: 'You already have a pending offer.' });
    }

    // requester sees requestPending; recipient sees state 'request' with the context first in Requests
    expect(serializeConversation(conversationId, a.id)).toMatchObject({ state: 'active', requestPending: true, peer: { id: b.id }, title: 'Ben Ortiz' });
    const requests = listConversations(b.id, 'requests', { limit: 10 });
    expect(requests.items.map((c) => c.id)).toEqual([conversationId]);
    expect(requests.items[0]).toMatchObject({ state: 'request', requestPending: false, contextLabel: 'About your listing', unreadCount: 2 });
    expect(requests.items[0]!.lastMessage).toMatchObject({ kind: 'offer', text: 'Offer: $35', senderId: a.id, senderName: 'Ava' });
    expect(listConversations(b.id, 'chats', { limit: 10 }).items).toEqual([]);

    // only the owner may accept; the buyer may only withdraw
    expect(() => setOfferStatus(offer.id, a, 'accept')).toThrow(/seller/);
    expect(() => setOfferStatus(offer.id, b, 'withdraw')).toThrow(/withdraw/);
    const accepted = setOfferStatus(offer.id, b, 'accept');
    expect(accepted.offer?.status).toBe('accepted');
    expect(state(conversationId, b.id)).toBe('active');
    expect(state(conversationId, a.id)).toBe('active');
    expect(evs(a.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(evs(b.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(evs(a.id, 'message.updated').some((e) => e.type === 'message.updated' && e.message.id === offer.id && e.message.offer?.status === 'accepted')).toBe(true);
    expect(notifs(a.id).map((n) => n.type)).toEqual(['message.request_accepted', 'market.offer_accepted']);
    expect(JSON.parse(notifs(a.id)[1]!.data_json)).toMatchObject({ amount: 35, title: 'Listing lst_1' });
    const thread = listMessages(conversationId, a.id, { limit: 10 });
    expect(thread.items[0]).toMatchObject({ kind: 'system', sender: null, text: 'Ben accepted the offer' });
    expect(() => setOfferStatus(offer.id, b, 'decline')).toThrow(/no longer pending/);
    expect(listConversations(b.id, 'chats', { limit: 10 }).items.map((c) => c.id)).toEqual([conversationId]);
    expect(badgesFor(b.id).requests).toBe(0);
    // after acceptance the cap is gone
    expect(sendMessage({ conversationId, sender: a, kind: 'text', text: 'great, when?' }).text).toBe('great, when?');
  });

  it('decline leaves the request state untouched; withdraw frees the slot; a recipient reply implicitly accepts', () => {
    const { a, b } = strangers();
    stubListing(b.id);
    const { conversationId } = openDm(a, b.id);
    const offer = sendMessage({ conversationId, sender: a, kind: 'offer', offer: { listingId: 'lst_1', amount: 20 } });
    setOfferStatus(offer.id, b, 'decline');
    expect(state(conversationId, b.id)).toBe('request');
    expect(notifs(a.id).map((n) => n.type)).toEqual(['market.offer_declined']);
    const again = sendMessage({ conversationId, sender: a, kind: 'offer', offer: { listingId: 'lst_1', amount: 22 } });
    setOfferStatus(again.id, a, 'withdraw');
    expect(sendMessage({ conversationId, sender: a, kind: 'offer', offer: { listingId: 'lst_1', amount: 25 } }).offer?.status).toBe('pending');

    const reply = sendMessage({ conversationId, sender: b, kind: 'text', text: 'Sure, 25 works' });
    expect(reply.sender?.id).toBe(b.id);
    expect(state(conversationId, b.id)).toBe('active');
    expect(notifs(a.id).map((n) => n.type)).toContain('message.request_accepted');
    expect(serializeConversation(conversationId, a.id).requestPending).toBe(false);
  });

  it('withholds images and read receipts while the request is pending; delivers them after accept', () => {
    const { a, b } = strangers();
    const { conversationId } = openDm(a, b.id);
    const img = sendMessage({ conversationId, sender: a, kind: 'image', images: [{ url: '/seed-media/x.jpg', width: 10, height: 10 }], banner: 'B-SCAM' });
    expect(img.images.length).toBe(1);
    expect(img.imagesWithheld).toBe(false);
    expect(img.banner).toBeNull(); // banners are for the recipient only
    const asB = listMessages(conversationId, b.id, { limit: 10 }).items[0]!;
    expect(asB).toMatchObject({ imagesWithheld: true, images: [], banner: 'B-SCAM', clientId: null });
    markRead(conversationId, b.id, img.id);
    expect(evs(a.id, 'read')).toEqual([]);
    expect(getMembership(conversationId, b.id)).toMatchObject({ state: 'request' });
    acceptRequest(conversationId, b);
    expect(listMessages(conversationId, b.id, { limit: 10 }).items[0]!.images.length).toBe(1);
    markRead(conversationId, b.id, img.id);
    expect(evs(a.id, 'read')).toEqual([{ type: 'read', conversationId, userId: b.id, lastReadMessageId: img.id, readAt: expect.any(Number) }]);
    expect(serializeConversation(conversationId, b.id).unreadCount).toBe(0);
    // block → 403 cannot_message with the privacy copy
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(b.id, a.id, now());
    expect(() => sendMessage({ conversationId, sender: a, kind: 'text', text: 'x' })).toThrow("You can't message this account.");
    // the blocker's inbox hides the DM; the blocked side still sees it
    expect(listConversations(b.id, 'chats', { limit: 10 }).items.map((c) => c.id)).not.toContain(conversationId);
    expect(listConversations(a.id, 'chats', { limit: 10 }).items.map((c) => c.id)).toContain(conversationId);
  });
});

describe('groups: createGroup + addMember addedBy / silent semantics', () => {
  it('followers join active, strangers as request, > 10 → everyone request; group_added only with addedBy and never on self-join', () => {
    const owner = ctx.createUser({ displayName: 'Dana Ruiz' });
    const follower = ctx.createUser({ follows: [owner.id] });
    const stranger = ctx.createUser();
    const id = createGroup(owner, { title: 'Apartment hunt', memberIds: [follower.id, stranger.id, owner.id] });
    expect(getMembership(id, owner.id)).toMatchObject({ state: 'active', role: 'owner' });
    expect(state(id, follower.id)).toBe('active');
    expect(state(id, stranger.id)).toBe('request');
    expect(notifs(follower.id)).toEqual([{ type: 'message.group_added', actor_id: owner.id, data_json: JSON.stringify({ title: 'Apartment hunt' }) }]);
    expect(notifs(stranger.id).map((n) => n.type)).toEqual(['message.group_added']);
    expect(notifs(owner.id)).toEqual([]);
    expect(evs(follower.id, 'conversation.updated').length).toBe(1);
    expect(serializeConversation(id, owner.id)).toMatchObject({ kind: 'group', title: 'Apartment hunt', memberCount: 3, nameLocked: false, peer: null });

    // addMember with addedBy notifies; self-join (no addedBy) and silent do not; idempotent
    const late = ctx.createUser();
    addMember(id, late.id, { addedBy: follower.id });
    expect(notifs(late.id).map((n) => n.type)).toEqual(['message.group_added']);
    expect(evs(late.id, 'conversation.updated').length).toBe(1);
    addMember(id, late.id, { addedBy: follower.id }); // no-op
    expect(notifs(late.id).length).toBe(1);
    expect(evs(late.id, 'conversation.updated').length).toBe(1);
    const selfJoin = ctx.createUser();
    addMember(id, selfJoin.id);
    expect(notifs(selfJoin.id)).toEqual([]);
    expect(evs(selfJoin.id, 'conversation.updated').length).toBe(1);
    const quiet = ctx.createUser();
    addMember(id, quiet.id, { addedBy: owner.id, silent: true });
    expect(notifs(quiet.id)).toEqual([]);
    expect(evs(quiet.id)).toEqual([]);
    const addedBySelf = ctx.createUser();
    addMember(id, addedBySelf.id, { addedBy: addedBySelf.id });
    expect(notifs(addedBySelf.id)).toEqual([]);

    // leave + revive
    removeMember(id, late.id);
    expect(state(id, late.id)).toBe('left');
    expect(() => serializeConversation(id, late.id)).toThrow();
    addMember(id, late.id, { addedBy: owner.id });
    expect(state(id, late.id)).toBe('active');
    expect(notifs(late.id).length).toBe(2);

    const many = Array.from({ length: 11 }, () => ctx.createUser({ follows: [owner.id] }).id);
    const big = createGroup(owner, { memberIds: many });
    for (const m of many) expect(state(big, m)).toBe('request');
    expect(serializeConversation(big, owner.id).title).toMatch(/\+8$/); // 3 first names + "+8"

    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(stranger.id, owner.id, now());
    expect(() => createGroup(owner, { memberIds: [stranger.id] })).toThrow("You can't message this account.");
    // blocked senders collapse for the viewer in group chats
    const msg = sendMessage({ conversationId: id, sender: owner, kind: 'text', text: 'hello all' });
    expect(listMessages(id, stranger.id, { limit: 5 }).items.find((m) => m.id === msg.id)?.collapsedByBlock).toBe(true);
    expect(listMessages(id, follower.id, { limit: 5 }).items.find((m) => m.id === msg.id)?.collapsedByBlock).toBe(false);
  });

  it('updateConversation renames groups only (not locked), mutes per member, and publishes conversation.updated', () => {
    const owner = ctx.createUser();
    const member = ctx.createUser({ follows: [owner.id] });
    const id = createGroup(owner, { title: 'Old', memberIds: [member.id] });
    updateConversation(id, owner, { title: 'New name' });
    expect(serializeConversation(id, member.id).title).toBe('New name');
    expect(evs(member.id, 'conversation.updated').length).toBe(2);
    updateConversation(id, member, { muted: true });
    expect(serializeConversation(id, member.id).muted).toBe(true);
    expect(getMembership(id, member.id)?.muted).toBe(true);
    sendMessage({ conversationId: id, sender: owner, kind: 'text', text: 'ping' });
    expect(badgesFor(member.id).messages).toBe(0); // muted chats do not count
    expect(serializeConversation(id, member.id).unreadCount).toBe(1);
    const { a, b } = strangers();
    const dm = openDm(a, b.id).conversationId;
    expect(() => updateConversation(dm, a, { title: 'nope' })).toThrow(/group/);
    expect(() => updateConversation(id, ctx.createUser(), { title: 'x' })).toThrow();
  });
});

describe('course conversations: meta from the conversations columns only', () => {
  it('createCourseConversation + addMember serialises CourseChatMeta, title = code, locked name', () => {
    const teacher = ctx.createUser();
    const id = createCourseConversation({ universityId: 'uni_utexas', courseId: 'crs_1', code: 'CS 314', title: 'Data Structures', term: 'Fall 2026', createdBy: teacher.id });
    addMember(id, teacher.id, { role: 'owner' });
    const student = ctx.createUser();
    addMember(id, student.id); // self-join: no notification
    expect(notifs(student.id)).toEqual([]);
    sendSystemMessage(id, 'Maya joined');
    const summary = serializeConversation(id, student.id);
    expect(summary).toMatchObject({
      kind: 'course', title: 'CS 314', nameLocked: true, course: { courseId: 'crs_1', code: 'CS 314', title: 'Data Structures', term: 'Fall 2026' },
      memberCount: 2, lastMessage: { kind: 'system', text: 'Maya joined', senderId: null, senderName: null },
    });
    expect(summary.unreadCount).toBe(0); // system lines never count as unread
    expect(() => updateConversation(id, teacher, { title: 'Renamed' })).toThrow(/renamed|locked/);
    const row = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ kind: 'course', title: 'CS 314', course_id: 'crs_1', course_code: 'CS 314', course_title: 'Data Structures', course_term: 'Fall 2026', name_locked: 1 });
    // seed-only id + createdAt + idempotent re-run
    const at = now() - 5 * DAY;
    expect(createCourseConversation({ id: 'conv_cs429', universityId: 'uni_utexas', courseId: 'crs_2', code: 'CS 429', title: 'Comp Org', term: 'Fall 2026', createdBy: null, createdAt: at, silent: true })).toBe('conv_cs429');
    expect(createCourseConversation({ id: 'conv_cs429', universityId: 'uni_utexas', courseId: 'crs_2', code: 'CS 429', title: 'Comp Org', term: 'Fall 2026', createdBy: null, createdAt: at, silent: true })).toBe('conv_cs429');
    expect((ctx.db.prepare('SELECT created_at FROM conversations WHERE id = ?').get('conv_cs429') as { created_at: number }).created_at).toBe(at);
  });
});

describe('conversation.updated producers', () => {
  it('touchContext reaches ACTIVE + REQUEST members of every conversation pinned to (kind, id) and never throws', () => {
    const seller = ctx.createUser();
    const buyer1 = ctx.createUser();
    const buyer2 = ctx.createUser({ follows: [seller.id], followedBy: [seller.id] });
    stubListing(seller.id);
    const c1 = openDm(buyer1, seller.id, { kind: 'listing', id: 'lst_9' }).conversationId; // seller in 'request'
    const c2 = openDm(buyer2, seller.id, { kind: 'listing', id: 'lst_9' }).conversationId;
    const other = openDm(buyer2, seller.id).conversationId; // same DM re-pinned: still lst_9
    expect(other).toBe(c2);
    const before = { seller: evs(seller.id, 'conversation.updated').length, b1: evs(buyer1.id, 'conversation.updated').length, b2: evs(buyer2.id, 'conversation.updated').length };
    touchContext('listing', 'lst_9');
    expect(evs(seller.id, 'conversation.updated').length).toBe(before.seller + 2);
    expect(evs(buyer1.id, 'conversation.updated').length).toBe(before.b1 + 1);
    expect(evs(buyer2.id, 'conversation.updated').length).toBe(before.b2 + 1);
    expect(evs(seller.id, 'conversation.updated').map((e) => (e as { conversationId: string }).conversationId)).toEqual(expect.arrayContaining([c1, c2]));
    expect(() => touchContext('roommate', 'nothing')).not.toThrow();
    expect(() => touchContext('listing', "'; DROP TABLE conversations; --")).not.toThrow();
  });

  it('acceptRequest publishes to both and notifies the requester; declineRequest tells the requester nothing', () => {
    const { a, b } = strangers();
    const { conversationId } = openDm(a, b.id);
    sendMessage({ conversationId, sender: a, kind: 'text', text: 'hey' });
    const aBefore = evs(a.id, 'conversation.updated').length;
    acceptRequest(conversationId, b);
    expect(evs(a.id, 'conversation.updated').length).toBe(aBefore + 1);
    expect(evs(b.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(notifs(a.id).map((n) => n.type)).toEqual(['message.request_accepted']);
    acceptRequest(conversationId, b); // idempotent
    expect(notifs(a.id).length).toBe(1);

    const { a: c, b: d } = strangers();
    const req = openDm(c, d.id).conversationId;
    sendMessage({ conversationId: req, sender: c, kind: 'text', text: 'yo' });
    const cBefore = ctx.wsEventsFor(c.id).length;
    declineRequest(req, d);
    expect(ctx.wsEventsFor(c.id).length).toBe(cBefore);
    expect(notifs(c.id)).toEqual([]);
    expect(ctx.db.prepare('SELECT * FROM message_request_cooldowns WHERE sender_id = ? AND recipient_id = ?').get(c.id, d.id)).toBeTruthy();
    expect(listConversations(d.id, 'requests', { limit: 10 }).items).toEqual([]);
    expect(() => listMessages(req, d.id, { limit: 5 })).toThrow();
  });
});

describe('messages: list, reactions, delete, previews, members', () => {
  it('lists newest first with keyset cursors; reactions aggregate with mine; delete is own-only and broadcast', () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const { conversationId } = openDm(a, b.id);
    const t0 = 1_800_000_000_000;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      setNow(t0 + i * 1000);
      ids.push(sendMessage({ conversationId, sender: i % 2 ? b : a, kind: 'text', text: `m${i}` }).id);
    }
    setNow(null);
    const page1 = listMessages(conversationId, a.id, { limit: 2 });
    expect(page1.items.map((m) => m.text)).toEqual(['m4', 'm3']);
    const page2 = listMessages(conversationId, a.id, { cursor: page1.nextCursor!, limit: 2 });
    expect(page2.items.map((m) => m.text)).toEqual(['m2', 'm1']);
    const page3 = listMessages(conversationId, a.id, { cursor: page2.nextCursor!, limit: 2 });
    expect(page3.items.map((m) => m.text)).toEqual(['m0']);
    expect(page3.nextCursor).toBeNull();
    expect(() => listMessages(conversationId, a.id, { cursor: 'tampered.cursor', limit: 2 })).toThrow(/cursor/i);
    expect(() => listMessages(conversationId, ctx.createUser().id, { limit: 2 })).toThrow();

    const reacted = setReaction(ids[4]!, b.id, '❤️');
    expect(reacted.reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);
    setReaction(ids[4]!, a.id, '❤️');
    expect(listMessages(conversationId, a.id, { limit: 1 }).items[0]!.reactions).toEqual([{ emoji: '❤️', count: 2, mine: true }]);
    expect(evs(a.id, 'message.updated').length).toBeGreaterThanOrEqual(2);
    setReaction(ids[4]!, a.id, null);
    expect(listMessages(conversationId, b.id, { limit: 1 }).items[0]!.reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);
    expect(() => setReaction(ids[4]!, a.id, '🍕' as never)).toThrow();

    expect(() => deleteMessage(ids[4]!, b)).toThrow(); // m4 was sent by a: own only
    const gone = deleteMessage(ids[4]!, a);
    expect(gone).toMatchObject({ deleted: true, text: '', reactions: expect.any(Array) });
    expect(evs(b.id, 'message.deleted')).toEqual([{ type: 'message.deleted', conversationId, messageId: ids[4] }]);
    expect(serializeConversation(conversationId, b.id).lastMessage).toMatchObject({ id: ids[4], text: 'Message deleted' });

    const members = listMembers(conversationId, a.id);
    expect(members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(members.find((m) => m.id === a.id)).toMatchObject({ role: 'member', lastReadMessageId: ids[4], viewer: { isSelf: true } });
    expect(badgesFor(b.id).messages).toBe(1); // m4 from a, unread for b
    markRead(conversationId, b.id, ids[4]!);
    expect(badgesFor(b.id).messages).toBe(0);
  });

  it('serialises previews (Photo / Offer: $n / Shared a listing) and card messages resolve live', () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    stubListing(a.id);
    const { conversationId } = openDm(a, b.id);
    sendMessage({ conversationId, sender: a, kind: 'image', images: [{ url: '/seed-media/p.jpg', width: 1, height: 1 }] });
    expect(serializeConversation(conversationId, b.id).lastMessage?.text).toBe('Photo');
    const card = sendMessage({ conversationId, sender: a, kind: 'card', card: { kind: 'listing', id: 'lst_5' } });
    expect(card.card).toMatchObject({ kind: 'listing', id: 'lst_5', title: 'Listing lst_5', status: 'available' });
    expect(serializeConversation(conversationId, b.id).lastMessage?.text).toBe('Shared a listing');
    sendMessage({ conversationId, sender: b, kind: 'offer', offer: { listingId: 'lst_5', amount: 1234 } });
    expect(serializeConversation(conversationId, a.id).lastMessage?.text).toBe('Offer: $1,234');
    stubListing(a.id, 'sold');
    expect(listMessages(conversationId, b.id, { limit: 5 }).items.find((m) => m.id === card.id)?.card?.status).toBe('sold');
  });

  it('kit.convo seeds are silent: seedDm / seedGroup / silent send never notify or publish', () => {
    const { a, b } = strangers();
    const dm = seedDm(a.id, b.id, { peerState: 'request', context: { kind: 'listing', id: 'lst_seed' } });
    expect(seedDm(b.id, a.id)).toBe(dm);
    sendMessage({ conversationId: dm, sender: a, kind: 'text', text: 'seeded', createdAt: now() - DAY, silent: true });
    const g = seedGroup('CS 429 project team', a.id, [b.id, a.id], now() - 2 * DAY);
    sendMessage({ conversationId: g, sender: b, kind: 'text', text: 'seeded group', createdAt: now() - HOUR, silent: true });
    expect(ctx.wsEventsFor(a.id)).toEqual([]);
    expect(ctx.wsEventsFor(b.id)).toEqual([]);
    expect(notifs(a.id)).toEqual([]);
    expect(notifs(b.id)).toEqual([]);
    expect(listConversations(b.id, 'requests', { limit: 10 }).items.map((c) => c.id)).toEqual([dm]);
    expect(serializeConversation(g, a.id)).toMatchObject({ kind: 'group', title: 'CS 429 project team', memberCount: 2, unreadCount: 1 });
    expect(badgesFor(b.id)).toMatchObject({ requests: 1 });
  });

  it('registers the message + conversation content adapters (report window ≤ 11 messages)', () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const { conversationId } = openDm(a, b.id);
    const ids: string[] = [];
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 15; i++) {
      setNow(t0 + i * 1000);
      ids.push(sendMessage({ conversationId, sender: a, kind: 'text', text: `t${i}` }).id);
    }
    setNow(null);
    const adapter = getContentAdapter('message')!;
    expect(adapter.load(ids[14]!)).toMatchObject({ entityType: 'message', entityId: ids[14], authorId: a.id, surface: 'message', status: 'active', anon: false, fields: [{ field: 'body', text: 't14' }], href: `/messages/${conversationId}` });
    const window = (adapter.staffContext!(ids[12]!) as { messages: { id: string }[] }).messages;
    expect(window.length).toBe(11);
    expect(window.at(-1)!.id).toBe(ids[12]);
    expect((adapter.staffContext!(ids[2]!) as { messages: unknown[] }).messages.length).toBe(3);
    adapter.setStatus(ids[14]!, 'removed');
    expect(adapter.load(ids[14]!)?.status).toBe('removed');
    expect(adapter.load('nope')).toBeNull();
    const conv = getContentAdapter('conversation')!;
    expect(conv.load(conversationId)).toMatchObject({ entityType: 'conversation', entityId: conversationId, label: 'conversation', parent: null });
  });

  it('held / hidden / removed rows exist only for their sender (SPEC §3.1): list, preview, ws and reactions', () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const { conversationId } = openDm(a, b.id);
    const t0 = 1_800_000_000_000;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      setNow(t0 + i * 1000);
      ids.push(sendMessage({ conversationId, sender: a, kind: 'text', text: `secret ${i}` }).id);
    }
    setNow(null);
    const adapter = getContentAdapter('message')!;
    const textsFor = (viewer: string): string[] => listMessages(conversationId, viewer, { limit: 10 }).items.map((m) => m.text);

    // staff removal: gone for the recipient, intact for the sender
    adapter.setStatus(ids[1]!, 'removed');
    expect(textsFor(b.id)).toEqual(['secret 2', 'secret 0']);
    expect(textsFor(a.id)).toEqual(['secret 2', 'secret 1', 'secret 0']);
    const row = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(ids[1]!) as never;
    expect(serializeMessage(row, b.id)).toMatchObject({ deleted: true, text: '', images: [], card: null, offer: null, banner: null });
    expect(serializeMessage(row, a.id)).toMatchObject({ deleted: false, text: 'secret 1' });
    expect(evs(b.id, 'message.deleted')).toEqual([{ type: 'message.deleted', conversationId, messageId: ids[1] }]);
    expect(evs(b.id, 'message.updated').map((e) => (e as { message: { text: string } }).message.text)).not.toContain('secret 1');
    expect(evs(a.id, 'message.updated').at(-1)).toMatchObject({ message: { id: ids[1], text: 'secret 1' } });
    expect(() => setReaction(ids[1]!, b.id, '❤️')).toThrow(/not available/);
    expect(setReaction(ids[1]!, a.id, '❤️').reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);
    expect(evs(b.id, 'message.updated').map((e) => (e as { message: { id: string } }).message.id)).not.toContain(ids[1]);

    // the inbox preview is the newest row THIS viewer may see
    adapter.setStatus(ids[2]!, 'hidden');
    expect(serializeConversation(conversationId, b.id).lastMessage).toMatchObject({ id: ids[0], text: 'secret 0' });
    expect(serializeConversation(conversationId, a.id).lastMessage).toMatchObject({ id: ids[2], text: 'secret 2' });
    expect(textsFor(b.id)).toEqual(['secret 0']);

    // restore after hide: the recipient gets it back as message.new
    adapter.setStatus(ids[2]!, 'active');
    expect(textsFor(b.id)).toEqual(['secret 2', 'secret 0']);
    expect(evs(b.id, 'message.new').at(-1)).toMatchObject({ message: { id: ids[2], text: 'secret 2' } });

    // a 'held' send is not delivered until approved: no ws, unread, request notice, preview or last_message_*
    ctx.db.prepare('DELETE FROM notifications').run();
    const stranger = ctx.createUser({ displayName: 'Sam Held' });
    const dm = openDm(a, stranger.id).conversationId;
    const before = ctx.wsEventsFor(stranger.id).length;
    const held = sendMessage({ conversationId: dm, sender: a, kind: 'text', text: 'held text', status: 'held' });
    expect(held).toMatchObject({ text: 'held text', deleted: false });
    expect(ctx.wsEventsFor(stranger.id).length).toBe(before);
    expect(notifs(stranger.id)).toEqual([]);
    expect(getMembership(dm, stranger.id)).toMatchObject({ state: 'request' });
    expect(badgesFor(stranger.id).requests).toBe(0);
    expect(listConversations(stranger.id, 'requests', { limit: 10 }).items).toEqual([]);
    expect(listMessages(dm, stranger.id, { limit: 10 }).items).toEqual([]);
    expect(ctx.db.prepare('SELECT last_message_id FROM conversations WHERE id = ?').get(dm)).toEqual({ last_message_id: null });
    expect(serializeConversation(dm, a.id).lastMessage).toMatchObject({ id: held.id, text: 'held text' });
    // the held row still counts toward the one-message request cap
    expect(() => sendMessage({ conversationId: dm, sender: a, kind: 'text', text: 'second' })).toThrow(/accept your request/);

    // approval = first delivery
    adapter.setStatus(held.id, 'active');
    expect(listMessages(dm, stranger.id, { limit: 10 }).items.map((m) => m.text)).toEqual(['held text']);
    expect(evs(stranger.id, 'message.new').at(-1)).toMatchObject({ conversationId: dm, message: { id: held.id, text: 'held text' } });
    expect(notifs(stranger.id).map((n) => n.type)).toEqual(['message.request']);
    expect(listConversations(stranger.id, 'requests', { limit: 10 }).items.map((c) => c.id)).toEqual([dm]);
    expect(serializeConversation(dm, stranger.id)).toMatchObject({ unreadCount: 1, lastMessage: { id: held.id, text: 'held text' } });
    expect(ctx.db.prepare('SELECT last_message_id FROM conversations WHERE id = ?').get(dm)).toEqual({ last_message_id: held.id });
  });
});

describe('share (#37–#38)', () => {
  it('lists ≤ 12 recent active chats, sends a card into each target, reports failures, tracks share_click', async () => {
    const me = ctx.createUser();
    const friends = Array.from({ length: 14 }, () => ctx.createUser({ follows: [me.id], followedBy: [me.id] }));
    const convIds = friends.map((f, i) => {
      const id = openDm(me, f.id).conversationId;
      sendMessage({ conversationId: id, sender: me, kind: 'text', text: `hi ${i}`, silent: true });
      return id;
    });
    const stranger = ctx.createUser();
    const pending = openDm(me, stranger.id).conversationId;
    sendMessage({ conversationId: pending, sender: me, kind: 'text', text: 'request', silent: true });
    stubListing(friends[0]!.id);
    const agent = ctx.as(me.id);
    const targets = await agent.get('/api/share/targets');
    expect(targets.status).toBe(200);
    expect(targets.body.items.length).toBe(12);
    expect(targets.body.nextCursor).toBeNull();
    expect(targets.body.items.map((c: { id: string }) => c.id)).not.toContain(pending);

    const notMine = openDm(friends[0]!, friends[1]!.id).conversationId;
    const res = await agent.post('/api/share').send({ card: { kind: 'listing', id: 'lst_s' }, conversationIds: [convIds[0], convIds[1], notMine, pending], text: 'look at this' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 2, failedConversationIds: [notMine, pending] });
    const delivered = listMessages(convIds[0]!, friends[0]!.id, { limit: 1 }).items[0]!;
    expect(delivered).toMatchObject({ kind: 'card', text: 'look at this', card: { kind: 'listing', id: 'lst_s' }, sender: { id: me.id } });
    expect(evs(friends[1]!.id, 'message.new').length).toBe(1);
    const tracked = ctx.db.prepare("SELECT props_json, user_id FROM analytics_events WHERE name = 'share_click'").all() as { props_json: string; user_id: string }[];
    expect(tracked.length).toBe(1);
    expect(tracked[0]).toMatchObject({ user_id: me.id });
    expect(JSON.parse(tracked[0]!.props_json)).toMatchObject({ kind: 'listing', sent: 2 });

    unregisterListing?.();
    unregisterListing = null;
    const gone = await agent.post('/api/share').send({ card: { kind: 'listing', id: 'lst_s' }, conversationIds: [convIds[0]] });
    expect(gone.status).toBe(404);
    expect((await agent.post('/api/share').send({ card: { kind: 'listing', id: 'x' }, conversationIds: [] })).status).toBe(400);
  });
});
