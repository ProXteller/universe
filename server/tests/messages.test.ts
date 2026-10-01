/**
 * `messages` slice (SPEC §5.6) — isolation mode: `createTestApp({ slices: ['messages'] })`.
 * Request rules, blocks, group collapse, offers (stub `listing` resolver), addMember semantics, ws capture, PRIVATE
 * moderation, report window, groups / members / leave, reactions / delete, images / cards, seeds.
 */
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ConversationSummary, Message, Paginated, WsServerEvent } from '@shared/core';
import { SESSION_COOKIE, WS_PATH } from '@shared/core';
import type { ConversationDetail } from '@shared/messages';
import { DAY, HOUR, MIN, now, setNow } from '../src/lib/clock';
import { registerCardResolver } from '../src/lib/content';
import { addMember, sendMessage } from '../src/lib/conversations';
import { attachRealtime } from '../src/lib/realtime';
import { createSession } from '../src/lib/sessions';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import type { AuthedUser } from '../src/lib/users';

const BASE = '/api/conversations';
const CANNOT = "You can't message this account.";

let ctx: TestCtx;
let unregisterListing: (() => void) | null = null;

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['messages'] });
});
afterEach(() => {
  unregisterListing?.();
  unregisterListing = null;
  setNow(null);
});

/* ───────────────────────────── helpers ───────────────────────────── */

/** A listing owned by `ownerId` (stub resolver; removed in afterEach through the returned unregister()). */
function stubListing(ownerId: string, status: 'available' | 'sold' = 'available'): void {
  unregisterListing?.();
  unregisterListing = registerCardResolver('listing', (id) => ({
    title: `Listing ${id}`, subtitle: null, imageUrl: null, href: `/market/${id}`, status, price: 40, badge: null, ownerId, meetupSpot: 'PCL lobby',
  }));
}

function strangers(): { a: AuthedUser; b: AuthedUser } {
  return { a: ctx.createUser({ displayName: 'Ava Stone' }), b: ctx.createUser({ displayName: 'Ben Ortiz' }) };
}

/** `b` follows `a` → a's DM lands straight in b's Chats. */
function friends(): { a: AuthedUser; b: AuthedUser } {
  const a = ctx.createUser({ displayName: 'Ava Stone' });
  const b = ctx.createUser({ displayName: 'Ben Ortiz', follows: [a.id] });
  return { a, b };
}

async function openDm(a: AuthedUser, b: AuthedUser, context?: { kind: 'listing' | 'roommate'; id: string }): Promise<string> {
  const res = await ctx.as(a.id).post('/api/dm').send({ userId: b.id, context });
  expect(res.status).toBe(200);
  return res.body.conversationId as string;
}

async function send(user: AuthedUser, conversationId: string, body: Record<string, unknown>) {
  return ctx.as(user.id).post(`${BASE}/${conversationId}/messages`).send(body);
}

async function text(user: AuthedUser, conversationId: string, t: string): Promise<Message> {
  const res = await send(user, conversationId, { kind: 'text', text: t });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Message;
}

async function inbox(user: AuthedUser, tab: 'chats' | 'requests'): Promise<ConversationSummary[]> {
  const res = await ctx.as(user.id).get(BASE).query({ tab });
  expect(res.status).toBe(200);
  return (res.body as Paginated<ConversationSummary>).items;
}

async function detail(user: AuthedUser, id: string) {
  return ctx.as(user.id).get(`${BASE}/${id}`);
}

async function messagesOf(user: AuthedUser, id: string): Promise<Message[]> {
  const res = await ctx.as(user.id).get(`${BASE}/${id}/messages`);
  expect(res.status).toBe(200);
  return (res.body as Paginated<Message>).items;
}

const evs = (userId: string, type?: WsServerEvent['type']): WsServerEvent[] => ctx.wsEventsFor(userId).filter((e) => !type || e.type === type);

const notifs = (userId: string): { type: string; actor_id: string | null; read_at: number | null }[] =>
  ctx.db.prepare('SELECT type, actor_id, read_at FROM notifications WHERE user_id = ? ORDER BY created_at, rowid').all(userId) as never;

function mute(user: AuthedUser, scope: 'all' | 'requests' = 'all'): void {
  const at = now();
  ctx.db
    .prepare(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, category, starts_at, effective_at, ends_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(`san_${user.id}`, user.id, 'mute', scope, 'harassment_bullying', at - MIN, at - MIN, at + DAY, at - MIN);
}

const FORBIDDEN_NOTICE_KEYS = ['matches', 'ruleId', 'signals', 'engine'];
function assertNoticeHygiene(body: unknown): void {
  const json = JSON.stringify(body);
  for (const key of FORBIDDEN_NOTICE_KEYS) expect(json, `body leaks "${key}"`).not.toContain(`"${key}"`);
}

/* ───────────────────────────── auth / validation ───────────────────────────── */

describe('auth + validation', () => {
  it('401 without a session, 400 on invalid bodies and unknown tabs', async () => {
    expect((await ctx.anon().get(BASE)).status).toBe(401);
    const { a, b } = friends();
    const id = await openDm(a, b);
    expect((await send(a, id, {})).status).toBe(400);
    expect((await send(a, id, { kind: 'text', text: '' })).status).toBe(400);
    expect((await send(a, id, { kind: 'text', text: 'x'.repeat(2001) })).status).toBe(400);
    expect((await send(a, id, { kind: 'image' })).status).toBe(400);
    expect((await ctx.as(a.id).get(BASE).query({ tab: 'spam' })).status).toBe(400);
    expect((await ctx.as(a.id).post(`${BASE}/groups`).send({ memberIds: [b.id] })).status).toBe(400);
    expect((await ctx.as(a.id).patch(`${BASE}/${id}`).send({})).status).toBe(400);
    expect((await ctx.as(a.id).put(`${BASE}/${id}/messages/nope/reaction`).send({ emoji: '🍕' })).status).toBe(400);
  });

  it('offers cannot be created through the messages route (market owns them)', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    const res = await send(a, id, { kind: 'offer', offer: { listingId: 'lst_1', amount: 20 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });
});

/* ───────────────────────────── inbox + detail ───────────────────────────── */

describe('inbox + detail', () => {
  it('lists chats newest first with previews, unread counts and the sender echo of clientId', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    const sent = await send(a, id, { kind: 'text', text: 'hey ben', clientId: 'tmp-1' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ kind: 'text', text: 'hey ben', clientId: 'tmp-1', sender: { id: a.id }, moderation: { status: 'active' } });
    assertNoticeHygiene(sent.body);

    const chats = await inbox(b, 'chats');
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id, kind: 'dm', title: 'Ava Stone', state: 'active', unreadCount: 1, requestPending: false, lastMessage: { text: 'hey ben', senderName: 'Ava' } });
    expect(await inbox(b, 'requests')).toEqual([]);

    // the recipient never sees the sender's clientId
    const theirs = await messagesOf(b, id);
    expect(theirs[0]).toMatchObject({ text: 'hey ben', clientId: null, banner: null });

    const d = await detail(b, id);
    expect(d.status).toBe(200);
    const body = d.body as ConversationDetail;
    expect(body).toMatchObject({ id, canSend: true, cannotSendReason: null, requestBanner: null, mutualCount: 0 });
    expect(body.members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(body.members.every((m) => m.role === 'member')).toBe(true);
  });

  it('404s the detail for non-members, declined and left members', async () => {
    const { a, b } = strangers();
    const c = ctx.createUser();
    const id = await openDm(a, b);
    await text(a, id, 'hi');
    expect((await detail(c, id)).status).toBe(404);
    expect((await ctx.as(c.id).get(`${BASE}/${id}/messages`)).status).toBe(404);
    expect((await ctx.as(b.id).post(`${BASE}/${id}/decline`)).status).toBe(204);
    expect((await detail(b, id)).status).toBe(404);
    expect((await ctx.as(a.id).delete(`${BASE}/${id}/members/me`)).status).toBe(204);
    expect((await detail(a, id)).status).toBe(404);
    expect((await detail(a, 'nope')).status).toBe(404);
  });

  it('paginates messages newest first with an opaque cursor', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    for (let i = 0; i < 5; i++) await text(a, id, `m${i}`);
    const first = await ctx.as(b.id).get(`${BASE}/${id}/messages`).query({ limit: 2 });
    expect(first.body.items.map((m: Message) => m.text)).toEqual(['m4', 'm3']);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await ctx.as(b.id).get(`${BASE}/${id}/messages`).query({ limit: 2, cursor: first.body.nextCursor });
    expect(second.body.items.map((m: Message) => m.text)).toEqual(['m2', 'm1']);
    expect((await ctx.as(b.id).get(`${BASE}/${id}/messages`).query({ cursor: 'tampered.xx' })).status).toBe(400);
  });
});

/* ───────────────────────────── request rules (safety §7.2) ───────────────────────────── */

describe('message requests', () => {
  it('a non-follower lands in Requests, may send one message, images are withheld, no read receipt before accept', async () => {
    const { a, b } = strangers();
    const id = await openDm(a, b);
    const first = await text(a, id, 'hi ben, quick question about the lab');
    expect(first.imagesWithheld).toBe(false);

    expect(await inbox(b, 'chats')).toEqual([]);
    const requests = await inbox(b, 'requests');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id, state: 'request', unreadCount: 1, contextLabel: null });
    expect((await ctx.as(a.id).get('/api/me/badges')).body.requests).toBe(0);
    expect((await ctx.as(b.id).get('/api/me/badges')).body.requests).toBe(1);
    expect(notifs(b.id)).toEqual([{ type: 'message.request', actor_id: a.id, read_at: null }]);

    // sender: "Request sent — waiting for Ben"
    const mine = (await detail(a, id)).body as ConversationDetail;
    expect(mine).toMatchObject({ requestPending: true, canSend: false, cannotSendReason: 'request_pending' });

    // one message until accepted (the cap counts text / image / card)
    const second = await send(a, id, { kind: 'text', text: 'and another thing' });
    expect(second.status).toBe(403);
    expect(second.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'request_pending' } });
    expect(second.body.error.message).toBe('Wait for Ben to accept your request.');

    // reading a request does not mark it read; POST /read is a no-op and never emits `read`
    expect((await ctx.as(b.id).post(`${BASE}/${id}/read`).send({ messageId: first.id })).status).toBe(204);
    expect((await inbox(b, 'requests'))[0]!.unreadCount).toBe(1);
    expect(evs(a.id, 'read')).toEqual([]);

    // accept → active for both, `conversation.updated` to both, receipts flow
    expect((await ctx.as(b.id).post(`${BASE}/${id}/accept`)).status).toBe(204);
    expect((await detail(b, id)).body.state).toBe('active');
    expect((await detail(a, id)).body).toMatchObject({ requestPending: false, canSend: true });
    expect(evs(a.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(evs(b.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(notifs(a.id).map((n) => n.type)).toContain('message.request_accepted');
    expect((await ctx.as(b.id).post(`${BASE}/${id}/read`).send({ messageId: first.id })).status).toBe(204);
    expect(evs(a.id, 'read')).toHaveLength(1);
    expect(evs(a.id, 'read')[0]).toMatchObject({ conversationId: id, userId: b.id, lastReadMessageId: first.id });
    expect((await ctx.as(b.id).get('/api/me/badges')).body).toMatchObject({ messages: 0, requests: 0 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'request_accept'").get()).toEqual({ n: 1 });
  });

  it('a photo sent as the one request message is withheld until the recipient accepts', async () => {
    const { a, b } = strangers();
    const id = await openDm(a, b);
    const sent = await send(a, id, { kind: 'image', images: [{ url: '/seed-media/reels/reel-01.webm', width: 540, height: 960 }] });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ kind: 'image', imagesWithheld: false, images: [{ url: '/seed-media/reels/reel-01.webm' }] });
    const forB = await messagesOf(b, id);
    expect(forB[0]).toMatchObject({ id: sent.body.id, kind: 'image', images: [], imagesWithheld: true });
    expect((await inbox(b, 'requests'))[0]!.lastMessage?.text).toBe('Photo');
    expect(evs(b.id, 'message.new').some((e) => e.type === 'message.new' && e.message.imagesWithheld === true)).toBe(true);
    expect((await ctx.as(b.id).post(`${BASE}/${id}/accept`)).status).toBe(204);
    expect((await messagesOf(b, id))[0]).toMatchObject({ imagesWithheld: false, images: [{ url: '/seed-media/reels/reel-01.webm' }] });
  });

  it('a recipient reply implicitly accepts; the requester may send again afterwards', async () => {
    const { a, b } = strangers();
    const id = await openDm(a, b);
    await text(a, id, 'hi');
    await text(b, id, 'hey!');
    expect((await detail(b, id)).body.state).toBe('active');
    expect((await text(a, id, 'second message')).text).toBe('second message');
  });

  it('delete (decline) is silent for the sender and starts a 30-day cooldown → 403 cannot_message', async () => {
    const { a, b } = strangers();
    const id = await openDm(a, b);
    await text(a, id, 'hi');
    expect((await ctx.as(b.id).post(`${BASE}/${id}/decline`)).status).toBe(204);
    expect(await inbox(b, 'requests')).toEqual([]);
    expect(notifs(a.id)).toEqual([]);
    const again = await ctx.as(a.id).post('/api/dm').send({ userId: b.id });
    expect(again.status).toBe(403);
    expect(again.body.error).toMatchObject({ code: 'cannot_message', message: CANNOT });
    // the sender still sees "Request sent" on their side (peer kept on the row, nothing goes through)
    expect((await detail(a, id)).body).toMatchObject({ requestPending: true, canSend: false, cannotSendReason: 'request_pending', peer: { id: b.id }, title: 'Ben Ortiz' });
    expect((await inbox(a, 'chats')).find((c) => c.id === id)).toMatchObject({ requestPending: true, title: 'Ben Ortiz' });
    const shout = await send(a, id, { kind: 'text', text: 'hello??' });
    expect(shout.status).toBe(403);
    expect(shout.body.error.details).toEqual({ reason: 'request_pending' });
    // a second decline is a 404 (no longer a request)
    expect((await ctx.as(b.id).post(`${BASE}/${id}/decline`)).status).toBe(404);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'request_decline'").get()).toEqual({ n: 1 });
  });

  it('a muted account cannot continue a request but can still reply in accepted chats', async () => {
    const { a, b } = strangers();
    const friend = ctx.createUser({ follows: [a.id] });
    const accepted = await openDm(a, friend);
    const pending = await openDm(a, b);
    mute(a, 'all');
    const blocked = await send(a, pending, { kind: 'text', text: 'hello?' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('muted');
    expect((await send(a, accepted, { kind: 'text', text: 'still here' })).status).toBe(201);
    expect((await ctx.as(a.id).post(`${BASE}/groups`).send({ memberIds: [b.id, friend.id] })).body.error.code).toBe('muted');
  });
});

/* ───────────────────────────── blocks + privacy ───────────────────────────── */

describe('blocks + privacy', () => {
  it('block either way → 403 cannot_message with the same copy as the privacy setting', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    await text(a, id, 'hi');
    expect((await ctx.as(b.id).post(`/api/users/${a.id}/block`)).status).toBe(200);
    const res = await send(a, id, { kind: 'text', text: 'still there?' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'cannot_message', message: CANNOT });
    expect((await detail(a, id)).body).toMatchObject({ canSend: false, cannotSendReason: 'blocked' });
    // the blocker's inbox hides the DM
    expect((await inbox(b, 'chats')).map((c) => c.id)).not.toContain(id);

    const c = ctx.createUser();
    const d = ctx.createUser();
    expect((await ctx.as(d.id).patch('/api/me/settings').send({ whoCanMessage: 'following' })).status).toBe(200);
    const privacy = await ctx.as(c.id).post('/api/dm').send({ userId: d.id });
    expect(privacy.status).toBe(403);
    expect(privacy.body.error).toMatchObject({ code: 'cannot_message', message: CANNOT });
  });

  it('group chats: messages from a blocked member carry collapsedByBlock, typing/read never cross a block', async () => {
    const a = ctx.createUser({ displayName: 'Ava Stone' });
    const b = ctx.createUser({ follows: [a.id] });
    const c = ctx.createUser({ follows: [a.id] });
    const created = await ctx.as(a.id).post(`${BASE}/groups`).send({ title: 'Lab group', memberIds: [b.id, c.id] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'group', title: 'Lab group', memberCount: 3, moderation: { status: 'active' } });
    const id = created.body.id as string;
    const m = await text(a, id, 'welcome everyone');
    expect((await ctx.as(c.id).post(`/api/users/${a.id}/block`)).status).toBe(200);
    const forC = await messagesOf(c, id);
    expect(forC.find((x) => x.id === m.id)).toMatchObject({ collapsedByBlock: true, text: 'welcome everyone' });
    const forB = await messagesOf(b, id);
    expect(forB.find((x) => x.id === m.id)).toMatchObject({ collapsedByBlock: false });
    // c reads → a gets no receipt (block), b does
    expect((await ctx.as(c.id).post(`${BASE}/${id}/read`).send({ messageId: m.id })).status).toBe(204);
    expect(evs(a.id, 'read')).toEqual([]);
    expect(evs(b.id, 'read')).toHaveLength(1);
  });
});

/* ───────────────────────────── offers (stub listing resolver) ───────────────────────────── */

describe('offers', () => {
  it('accept / decline only by the listing owner; withdraw only by the sender', async () => {
    const buyer = ctx.createUser({ displayName: 'Ava Stone' });
    const seller = ctx.createUser({ displayName: 'Ben Ortiz', follows: [buyer.id] });
    const other = ctx.createUser({ follows: [buyer.id] });
    stubListing(seller.id);
    const id = await openDm(buyer, seller, { kind: 'listing', id: 'lst_1' });
    const offer = sendMessage({ conversationId: id, sender: buyer, kind: 'offer', offer: { listingId: 'lst_1', amount: 35 } });
    expect(offer.offer).toEqual({ listingId: 'lst_1', amount: 35, currency: 'USD', status: 'pending' });

    const byBuyer = await ctx.as(buyer.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'accept' });
    expect(byBuyer.status).toBe(403);
    const byOther = await ctx.as(other.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'accept' });
    expect(byOther.status).toBe(404);
    const withdrawBySeller = await ctx.as(seller.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'withdraw' });
    expect(withdrawBySeller.status).toBe(403);

    const accepted = await ctx.as(seller.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.offer.status).toBe('accepted');
    expect(notifs(buyer.id).map((n) => n.type)).toContain('market.offer_accepted');
    const system = (await messagesOf(buyer, id)).find((m) => m.kind === 'system');
    expect(system?.text).toContain('accepted the offer');
    expect((await ctx.as(seller.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'decline' })).status).toBe(409);
  });

  it('strangers: text then offer in a pending request → offer delivered, 2nd text 403, 2nd offer 409, owner accept flips the chat to Chats for both', async () => {
    const { a: buyer, b: seller } = strangers();
    stubListing(seller.id);
    const id = await openDm(buyer, seller, { kind: 'listing', id: 'lst_2' });
    await text(buyer, id, 'is this still available?');
    const offer = sendMessage({ conversationId: id, sender: buyer, kind: 'offer', offer: { listingId: 'lst_2', amount: 30 } });
    expect((await messagesOf(seller, id)).map((m) => m.kind).sort()).toEqual(['offer', 'text']);
    expect(evs(seller.id, 'message.new')).toHaveLength(2);

    const second = await send(buyer, id, { kind: 'text', text: 'lmk' });
    expect(second.status).toBe(403);
    expect(second.body.error.details).toEqual({ reason: 'request_pending' });
    expect(() => sendMessage({ conversationId: id, sender: buyer, kind: 'offer', offer: { listingId: 'lst_2', amount: 32 } })).toThrow(/pending offer/);

    // the request sits first in Requests with the context label
    const requests = await inbox(seller, 'requests');
    expect(requests[0]).toMatchObject({ id, state: 'request', contextLabel: 'About your listing', context: { kind: 'listing', id: 'lst_2', status: 'available' } });
    const sellerDetail = (await detail(seller, id)).body as ConversationDetail;
    expect(sellerDetail).toMatchObject({ canSend: true, state: 'request' });

    const accepted = await ctx.as(seller.id).post(`${BASE}/${id}/messages/${offer.id}/offer`).send({ action: 'accept' });
    expect(accepted.status).toBe(200);
    expect((await detail(seller, id)).body.state).toBe('active');
    expect((await detail(buyer, id)).body).toMatchObject({ requestPending: false, canSend: true, cannotSendReason: null });
    expect((await inbox(seller, 'chats')).map((c) => c.id)).toContain(id);
    expect((await inbox(seller, 'requests')).map((c) => c.id)).not.toContain(id);
    expect(evs(buyer.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(evs(seller.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect(evs(buyer.id, 'message.updated').some((e) => e.type === 'message.updated' && e.message.id === offer.id && e.message.offer?.status === 'accepted')).toBe(true);
    expect(evs(seller.id, 'message.updated').some((e) => e.type === 'message.updated' && e.message.id === offer.id)).toBe(true);
    // the context card re-resolves live: once the stub says sold, the summary says sold
    stubListing(seller.id, 'sold');
    expect((await detail(buyer, id)).body.context.status).toBe('sold');
  });
});

/* ───────────────────────────── groups + members ───────────────────────────── */

describe('groups + members', () => {
  it('create: followers join active, non-followers as request; addMember with addedBy notifies, self-join does not', async () => {
    const a = ctx.createUser({ displayName: 'Ava Stone' });
    const b = ctx.createUser({ follows: [a.id] });
    const c = ctx.createUser();
    const d = ctx.createUser({ follows: [b.id] });
    const e = ctx.createUser();
    const created = await ctx.as(a.id).post(`${BASE}/groups`).send({ title: 'Study crew', memberIds: [b.id, c.id] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(notifs(b.id)).toEqual([{ type: 'message.group_added', actor_id: a.id, read_at: null }]);
    expect(notifs(c.id)).toEqual([{ type: 'message.group_added', actor_id: a.id, read_at: null }]);
    expect(notifs(a.id)).toEqual([]);
    await text(a, id, 'hello');
    expect((await inbox(b, 'chats')).map((x) => x.id)).toContain(id);
    expect((await inbox(c, 'requests')).map((x) => x.id)).toContain(id);

    // a member adds someone who follows them → active + notified; a stranger to the inviter → request
    const added = await ctx.as(b.id).post(`${BASE}/${id}/members`).send({ userIds: [d.id, e.id] });
    expect(added.status).toBe(200);
    expect((added.body as ConversationDetail).members.map((m) => m.id).sort()).toEqual([a.id, b.id, c.id, d.id, e.id].sort());
    expect(notifs(d.id)).toEqual([{ type: 'message.group_added', actor_id: b.id, read_at: null }]);
    expect(notifs(e.id)).toEqual([{ type: 'message.group_added', actor_id: b.id, read_at: null }]);
    expect(ctx.db.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, d.id)).toEqual({ state: 'active' });
    expect(ctx.db.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, e.id)).toEqual({ state: 'request' });

    // course-style self join (campus path): no addedBy → no notification
    const f = ctx.createUser();
    addMember(id, f.id, { state: 'active' });
    expect(notifs(f.id)).toEqual([]);
    // re-adding an existing member is idempotent and silent
    expect((await ctx.as(b.id).post(`${BASE}/${id}/members`).send({ userIds: [d.id] })).status).toBe(200);
    expect(notifs(d.id)).toHaveLength(1);
  });

  it('create rejects < 2 members, accounts younger than 24 h, blocked pairs and blocked titles', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const c = ctx.createUser({ follows: [a.id] });
    expect((await ctx.as(a.id).post(`${BASE}/groups`).send({ memberIds: [b.id] })).status).toBe(400);
    const fresh = ctx.createUser({ createdAt: now() - 2 * HOUR });
    const young = await ctx.as(fresh.id).post(`${BASE}/groups`).send({ memberIds: [b.id, c.id] });
    expect(young.status).toBe(403);
    expect(young.body.error.details).toMatchObject({ reason: 'account_too_new' });
    expect((await ctx.as(c.id).post(`/api/users/${a.id}/block`)).status).toBe(200);
    const blocked = await ctx.as(a.id).post(`${BASE}/groups`).send({ memberIds: [b.id, c.id] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('cannot_message');
    const d = ctx.createUser({ follows: [a.id] });
    const badTitle = await ctx.as(a.id).post(`${BASE}/groups`).send({ title: 'Shitposters Anonymous', memberIds: [b.id, d.id] });
    expect(badTitle.status).toBe(422);
    expect(badTitle.body.error.code).toBe('content_blocked');
    assertNoticeHygiene(badTitle.body);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'group'").get()).toEqual({ n: 0 });
  });

  it('rename (groups only, moderated), mute, leave; course chats keep their name', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const c = ctx.createUser({ follows: [a.id] });
    const id = (await ctx.as(a.id).post(`${BASE}/groups`).send({ memberIds: [b.id, c.id] })).body.id as string;
    const renamed = await ctx.as(b.id).patch(`${BASE}/${id}`).send({ title: 'CS 314 study group' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ title: 'CS 314 study group', moderation: { status: 'active' } });
    expect(evs(a.id, 'conversation.updated').length).toBeGreaterThan(0);
    expect((await ctx.as(b.id).patch(`${BASE}/${id}`).send({ title: 'Shitposters Anonymous' })).status).toBe(422);

    // a muted member gets 403 on the moderated rename; muting the chat for themselves is not a post and still works
    mute(b, 'all');
    const mutedRename = await ctx.as(b.id).patch(`${BASE}/${id}`).send({ title: 'Renamed while muted' });
    expect(mutedRename.status).toBe(403);
    expect(mutedRename.body.error.code).toBe('muted');
    expect((await ctx.as(b.id).patch(`${BASE}/${id}`).send({ muted: true })).body.muted).toBe(true);
    expect((await ctx.as(b.id).patch(`${BASE}/${id}`).send({ muted: false })).body.muted).toBe(false);

    const muted = await ctx.as(c.id).patch(`${BASE}/${id}`).send({ muted: true });
    expect(muted.body.muted).toBe(true);
    await text(a, id, 'ping');
    expect((await ctx.as(c.id).get('/api/me/badges')).body.messages).toBe(0);
    expect((await ctx.as(b.id).get('/api/me/badges')).body.messages).toBe(1);

    expect((await ctx.as(c.id).delete(`${BASE}/${id}/members/me`)).status).toBe(204);
    expect((await detail(c, id)).status).toBe(404);
    expect((await detail(a, id)).body.memberCount).toBe(2);

    // a DM cannot be renamed; a course chat is name-locked
    const dm = await openDm(a, b);
    expect((await ctx.as(a.id).patch(`${BASE}/${dm}`).send({ title: 'x' })).status).toBe(400);
    expect((await ctx.as(a.id).post(`${BASE}/${dm}/members`).send({ userIds: [c.id] })).status).toBe(400);
  });
});

/* ───────────────────────────── reactions / delete / images / cards ───────────────────────────── */

describe('message actions', () => {
  it('reactions toggle and publish message.updated; delete-for-everyone is own-only', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    const m = await text(a, id, 'reaction target');
    const heart = await ctx.as(b.id).put(`${BASE}/${id}/messages/${m.id}/reaction`).send({ emoji: '❤️' });
    expect(heart.status).toBe(200);
    expect(heart.body.reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);
    expect(evs(a.id, 'message.updated').some((e) => e.type === 'message.updated' && e.message.reactions[0]?.mine === false)).toBe(true);
    const cleared = await ctx.as(b.id).put(`${BASE}/${id}/messages/${m.id}/reaction`).send({ emoji: null });
    expect(cleared.body.reactions).toEqual([]);

    expect((await ctx.as(b.id).delete(`${BASE}/${id}/messages/${m.id}`)).status).toBe(404);
    const del = await ctx.as(a.id).delete(`${BASE}/${id}/messages/${m.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, text: '' });
    expect(evs(b.id, 'message.deleted')).toEqual([{ type: 'message.deleted', conversationId: id, messageId: m.id }]);
    expect((await messagesOf(b, id))[0]).toMatchObject({ id: m.id, deleted: true, text: '' });
    // a message from another conversation is a 404 under this id
    const other = await openDm(a, ctx.createUser({ follows: [a.id] }));
    expect((await ctx.as(a.id).put(`${BASE}/${other}/messages/${m.id}/reaction`).send({ emoji: '🔥' })).status).toBe(404);
  });

  it('images must be own uploads or seed media; new accounts cannot send photos to non-followers', async () => {
    const { a, b } = friends();
    const id = await openDm(a, b);
    const bad = await send(a, id, { kind: 'image', images: [{ url: 'https://evil.example/x.jpg', width: 1, height: 1 }] });
    expect(bad.status).toBe(404);
    const ok = await send(a, id, { kind: 'image', text: 'look', images: [{ url: '/seed-media/reels/reel-01.webm', width: 540, height: 960 }] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: 'image', text: 'look', images: [{ url: '/seed-media/reels/reel-01.webm' }] });
    expect((await inbox(b, 'chats'))[0]!.lastMessage?.text).toBe('look');

    const fresh = ctx.createUser({ createdAt: now() - 3 * HOUR });
    const stranger = ctx.createUser();
    const req = await openDm(fresh, stranger);
    const refused = await send(fresh, req, { kind: 'image', images: [{ url: '/seed-media/reels/reel-01.webm', width: 540, height: 960 }] });
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'account_too_new' });
    const follower = ctx.createUser({ follows: [fresh.id] });
    const fine = await send(fresh, await openDm(fresh, follower), { kind: 'image', images: [{ url: '/seed-media/reels/reel-01.webm', width: 540, height: 960 }] });
    expect(fine.status).toBe(201);
  });

  it('card messages resolve live and refuse unavailable cards; replyToId must be in the conversation', async () => {
    const { a, b } = friends();
    const seller = ctx.createUser();
    stubListing(seller.id);
    const id = await openDm(a, b);
    const card = await send(a, id, { kind: 'card', card: { kind: 'listing', id: 'lst_9' } });
    expect(card.status).toBe(201);
    expect(card.body.card).toMatchObject({ kind: 'listing', id: 'lst_9', title: 'Listing lst_9', status: 'available' });
    expect((await inbox(b, 'chats'))[0]!.lastMessage?.text).toBe('Shared a listing');
    const gone = await send(a, id, { kind: 'card', card: { kind: 'listing', id: 'lst_missing' } });
    stubListing(seller.id, 'sold');
    expect(gone.status).toBe(201); // stub resolves every id; a sold card is still shareable
    unregisterListing?.();
    unregisterListing = null;
    expect((await send(a, id, { kind: 'card', card: { kind: 'listing', id: 'lst_9' } })).status).toBe(400);

    const reply = await send(b, id, { kind: 'text', text: 'nice', replyToId: card.body.id });
    expect(reply.status).toBe(201);
    expect(reply.body.replyToId).toBe(card.body.id);
    expect((await send(b, id, { kind: 'text', text: 'nope', replyToId: 'msg_elsewhere' })).status).toBe(404);
  });
});

/* ───────────────────────────── PRIVATE moderation + report window ───────────────────────────── */

describe('PRIVATE moderation', () => {
  it('PII is allowed in accepted chats, a phone number in a first request adds B-OFFPLATFORM for the recipient only', async () => {
    const { a, b } = friends();
    const dm = await openDm(a, b);
    const pii = await send(a, dm, { kind: 'text', text: 'call me 512-555-0199' });
    expect(pii.status).toBe(201);
    expect(pii.body.banner).toBeNull();
    expect((await messagesOf(b, dm))[0]!.banner).toBeNull();

    const { a: c, b: d } = strangers();
    const req = await openDm(c, d);
    const first = await send(c, req, { kind: 'text', text: 'call me 512-555-0199' });
    expect(first.status).toBe(201);
    expect(first.body.banner).toBeNull(); // the sender never sees their own banner
    assertNoticeHygiene(first.body);
    expect((await messagesOf(d, req))[0]!.banner).toBe('B-OFFPLATFORM');
    expect((await detail(d, req)).body.requestBanner).toBe('B-OFFPLATFORM');
    expect((await detail(c, req)).body.requestBanner).toBeNull();
  });

  it('a scam pattern is delivered with B-SCAM (no queue item); a threat is blocked with 422', async () => {
    const { a, b } = friends();
    const dm = await openDm(a, b);
    const scam = await send(a, dm, { kind: 'text', text: 'send me the code they texted you' });
    expect(scam.status).toBe(201);
    expect(scam.body.moderation).toEqual({ status: 'active', userMessage: null, support: null });
    expect((await messagesOf(b, dm))[0]).toMatchObject({ text: 'send me the code they texted you', banner: 'B-SCAM' });
    expect(evs(b.id, 'message.new').some((e) => e.type === 'message.new' && e.message.banner === 'B-SCAM')).toBe(true);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_id = ?").get(scam.body.id)).toEqual({ n: 0 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM moderation_events WHERE entity_id = ?").get(scam.body.id)).toEqual({ n: 1 });

    const threat = await send(a, dm, { kind: 'text', text: 'I am going to kill you' });
    expect(threat.status).toBe(422);
    expect(threat.body.error).toMatchObject({ code: 'content_blocked', details: { messageId: 'M-THREAT', category: 'threat_violence' } });
    assertNoticeHygiene(threat.body);
    expect((await messagesOf(b, dm)).map((m) => m.text)).toEqual(['send me the code they texted you']);
    // the blocked write escalates a queue item with the blocked text (no row exists)
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_type = 'message' AND entity_id IS NULL AND author_id = ?").get(a.id)).toEqual({ n: 1 });
  });

  it('a held row exists only for its sender until approved', async () => {
    const { a, b } = friends();
    const dm = await openDm(a, b);
    const held = sendMessage({ conversationId: dm, sender: a, kind: 'text', text: 'pending review', status: 'held' });
    expect((await messagesOf(a, dm)).map((m) => m.id)).toContain(held.id);
    expect((await messagesOf(b, dm)).map((m) => m.id)).not.toContain(held.id);
    expect((await inbox(b, 'chats'))).toEqual([]);
  });

  it('report window: reported message + ≤ 10 preceding, only with includeContext', async () => {
    const { a, b } = friends();
    const dm = await openDm(a, b);
    const base = now();
    let last: Message | null = null;
    for (let i = 0; i < 14; i++) {
      setNow(base + i * 1000); // distinct timestamps → a deterministic window
      last = await text(a, dm, `line ${i}`);
    }
    const plain = await ctx.as(b.id).post('/api/reports').send({ entityType: 'message', entityId: last!.id, reason: 'harassment' });
    expect(plain.status).toBe(200);
    expect(ctx.db.prepare('SELECT context_json FROM reports WHERE id = ?').get(plain.body.id)).toEqual({ context_json: null });

    const c = ctx.createUser({ follows: [a.id] });
    const dm2 = await openDm(a, c);
    let last2: Message | null = null;
    for (let i = 0; i < 14; i++) {
      setNow(base + 20_000 + i * 1000);
      last2 = await text(a, dm2, `line ${i}`);
    }
    const withCtx = await ctx.as(c.id).post('/api/reports').send({ entityType: 'message', entityId: last2!.id, reason: 'harassment', includeContext: true });
    expect(withCtx.status).toBe(200);
    const row = ctx.db.prepare('SELECT context_json FROM reports WHERE id = ?').get(withCtx.body.id) as { context_json: string };
    const window = JSON.parse(row.context_json).messages as { id: string; text: string }[];
    expect(window).toHaveLength(11);
    expect(window[window.length - 1]!.id).toBe(last2!.id);
    expect(window[0]!.text).toBe('line 3');
  });
});

/* ───────────────────────────── realtime: typing never leaks into a request ───────────────────────────── */

describe('realtime typing', () => {
  it('typing.set reaches accepted partners only, never the recipient of a pending request', async () => {
    const server = http.createServer(ctx.app);
    attachRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const sockets: WebSocket[] = [];
    const connect = (userId: string): Promise<{ ws: WebSocket; events: WsServerEvent[] }> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, { headers: { Cookie: `${SESSION_COOKIE}=${createSession(userId, 'vitest-ws').token}` } });
        sockets.push(ws);
        const events: WsServerEvent[] = [];
        ws.on('message', (data) => events.push(JSON.parse(data.toString()) as WsServerEvent));
        ws.on('open', () => resolve({ ws, events }));
        ws.on('error', reject);
      });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const { a, b } = friends();
      const { a: c, b: d } = strangers();
      const accepted = await openDm(a, b);
      const pending = await openDm(c, d);
      await text(c, pending, 'hi');
      const ca = await connect(a.id);
      const cb = await connect(b.id);
      const cc = await connect(c.id);
      const cd = await connect(d.id);
      ca.ws.send(JSON.stringify({ type: 'typing.set', conversationId: accepted, isTyping: true }));
      cc.ws.send(JSON.stringify({ type: 'typing.set', conversationId: pending, isTyping: true }));
      await wait(150);
      expect(cb.events.filter((e) => e.type === 'typing')).toEqual([{ type: 'typing', conversationId: accepted, userId: a.id, displayName: 'Ava Stone', isTyping: true }]);
      expect(cd.events.filter((e) => e.type === 'typing')).toEqual([]);
      expect(cc.events.filter((e) => e.type === 'typing')).toEqual([]);
    } finally {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

/* ───────────────────────────── seeds ───────────────────────────── */

describe('seed', () => {
  it("Maya's demo state: 6 DMs + 2 groups in Chats, 2 requests (owenpark's with a banner), one unread message.request", async () => {
    ctx = await createTestApp({ slices: ['messages'], seed: 'all' });
    const maya = ctx.as('mayachen');
    const chats = (await maya.get(BASE).query({ tab: 'chats', limit: 50 })).body as Paginated<ConversationSummary>;
    const dms = chats.items.filter((c) => c.kind === 'dm');
    const groups = chats.items.filter((c) => c.kind === 'group');
    expect(dms.map((c) => c.peer?.handle).sort()).toEqual(['arjunp', 'hannahkim', 'jordan_builds', 'noahg', 'priya_n', 'sofiaram']);
    expect(groups.map((c) => c.title).sort()).toEqual(['Apartment hunt', 'CS 429 project team']);
    expect(dms.filter((c) => c.unreadCount > 0)).toHaveLength(2);
    for (const c of dms) {
      const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(c.id) as { n: number }).n;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(25);
    }
    const requests = (await maya.get(BASE).query({ tab: 'requests' })).body as Paginated<ConversationSummary>;
    expect(requests.items.map((c) => c.peer?.handle).sort()).toEqual(['graceade', 'owenpark']);
    const owen = requests.items.find((c) => c.peer?.handle === 'owenpark')!;
    expect(((await maya.get(`${BASE}/${owen.id}`)).body as ConversationDetail).requestBanner).toBe('B-OFFPLATFORM');
    const grace = requests.items.find((c) => c.peer?.handle === 'graceade')!;
    expect(((await maya.get(`${BASE}/${grace.id}`)).body as ConversationDetail)).toMatchObject({ requestBanner: null, peerIsNewAccount: true });

    const badges = (await maya.get('/api/me/badges')).body;
    expect(badges.requests).toBe(2);
    expect(badges.messages).toBe(dms.reduce((n, c) => n + c.unreadCount, 0));
    const mine = notifs('u_mayachen').filter((n) => n.type === 'message.request');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ actor_id: 'u_graceade', read_at: null });
    // unread counters equal the rows: every member's unread_count matches unread rows after their last read
    const drift = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM conversation_members cm
          WHERE cm.state = 'active' AND cm.unread_count != (
            SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cm.conversation_id AND m.kind != 'system'
              AND (m.sender_id IS NULL OR m.sender_id != cm.user_id)
              AND (cm.last_read_at IS NULL OR m.created_at > (SELECT created_at FROM messages WHERE id = cm.last_read_message_id)))`,
      )
      .get() as { n: number };
    expect(drift.n).toBe(0);
    // other personas have conversations too, and the seed is deterministic
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n).toBeGreaterThanOrEqual(21);
    const DIGEST = "SELECT GROUP_CONCAT(text, '|') AS t FROM (SELECT text FROM messages ORDER BY created_at, text)";
    const digest = ctx.db.prepare(DIGEST).get() as { t: string };
    ctx = await createTestApp({ slices: ['messages'], seed: 'all' });
    expect((ctx.db.prepare(DIGEST).get() as { t: string }).t).toBe(digest.t);
  });
});
