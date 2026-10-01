/**
 * HARDENING — authorization / IDOR sweep across every slice (full mode, all seeds at lite scale).
 *
 * Actors: students A, B, C (hero campus), X (other campus), an org, a minor, staff. Each block tries to make one
 * principal act on another principal's resource (edit / delete / mark-sold / cancel / RSVP-as / accept-offer /
 * read-DM / add-member …), to cross a campus boundary where SPEC says campus-only, to reach /api/admin as a
 * non-staff user, to write while suspended / muted, and to mutate while signed out.
 *
 * A FAILING test here is a confirmed finding (left failing on purpose for the fixer). A passing test is a
 * regression guard for a probe that found nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthedUser } from '../../src/lib/users';
import { HOUR, DAY } from '../../src/lib/clock';
import { applySanction } from '../../src/lib/moderation/staff';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

const HERO = 'uni_utexas';
const OTHER = 'uni_stanford';
const PHOTO = { url: '/seed-media/generated/market/test-tile.svg', width: 960, height: 960 };
const COVER = '/seed-media/generated/event-covers/social.svg';

let ctx: TestCtx;
let A: AuthedUser;
let B: AuthedUser;
let C: AuthedUser;
let X: AuthedUser; // other campus
let ORG: AuthedUser;
let ADMIN: AuthedUser;
let MOD: AuthedUser;

let seq = 0;
const uniq = (s: string): string => `${s} ${++seq} ${Math.random().toString(36).slice(2, 8)}`;

function listingBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'sell', category: 'electronics', title: uniq('Desk lamp'), description: uniq('Warm light, works great, pickup after class'),
    price: 25, condition: 'good', meetupSpot: 'Library lobby', photos: [PHOTO], ...over,
  };
}

function roommateBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    answers: { sleep: 3, clean: 0, noise: 3, guests: 3, hosting: 3, smoking: 3, pets: 0, sharing: 3 },
    dealbreakSmoking: true, dealbreakPets: true, publish: false, mode: 'need', budget: 777, moveIn: '2027-08',
    neighborhoods: ['West Campus'], livingWith: 'anyone', about: uniq('Night owl who studies late'), ...over,
  };
}

function eventBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  const start = Date.now() + 3 * DAY;
  return {
    title: uniq('Board game night'), description: uniq('Bring a friend, snacks provided'), category: 'social', startsAt: start,
    endsAt: start + 2 * HOUR, locationName: 'Student Union 2.302', coverUrl: COVER, freeFood: false, capacity: null, ...over,
  };
}

async function createListing(u: AuthedUser, over: Record<string, unknown> = {}): Promise<string> {
  const res = await ctx.as(u.id).post('/api/market/listings').send(listingBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function createEvent(u: AuthedUser): Promise<string> {
  const res = await ctx.as(u.id).post('/api/campus/events').send(eventBody());
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function createPost(u: AuthedUser): Promise<string> {
  const res = await ctx.as(u.id).post('/api/orbit/posts').send({ text: uniq('Orbit post about the solar car build') });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function openDmWith(from: AuthedUser, to: AuthedUser, text = uniq('hey, quick question about class')): Promise<{ conversationId: string; messageId: string }> {
  const dm = await ctx.as(from.id).post('/api/dm').send({ userId: to.id });
  expect(dm.status, JSON.stringify(dm.body)).toBe(200);
  const msg = await ctx.as(from.id).post(`/api/conversations/${dm.body.conversationId}/messages`).send({ kind: 'text', text });
  expect(msg.status, JSON.stringify(msg.body)).toBe(201);
  return { conversationId: dm.body.conversationId as string, messageId: msg.body.id as string };
}

beforeAll(async () => {
  ctx = await createTestApp({ seed: 'all' });
  A = ctx.createUser({ universityId: HERO });
  B = ctx.createUser({ universityId: HERO });
  C = ctx.createUser({ universityId: HERO });
  X = ctx.createUser({ universityId: OTHER });
  ORG = ctx.createUser({ universityId: HERO, accountType: 'org' });
  ADMIN = ctx.createUser({ universityId: HERO, role: 'admin' });
  MOD = ctx.createUser({ universityId: HERO, role: 'moderator' });
}, 60_000);

/* ═════════════════════════════ 1. signed-out requests ═════════════════════════════ */

describe('signed-out: every mutating endpoint answers 401', () => {
  const ID = 'zzzzzzzzzzzzzz';
  const routes: [string, string][] = [
    // core
    ['patch', '/api/me'], ['post', '/api/me/guidelines'], ['post', '/api/me/onboarding/complete'], ['patch', '/api/me/settings'],
    ['delete', '/api/me'], ['post', `/api/me/sanctions/${ID}/ack`], ['post', '/api/appeals'],
    ['post', `/api/users/${ID}/follow`], ['delete', `/api/users/${ID}/follow`], ['post', `/api/users/${ID}/block`], ['delete', `/api/users/${ID}/block`],
    ['post', '/api/uploads'], ['post', '/api/reports'], ['post', '/api/notifications/read'],
    ['post', '/api/waitlist/apartments'], ['delete', '/api/waitlist/apartments'], ['post', '/api/dm'], ['post', '/api/share'],
    // auth slice
    ['post', '/api/onboarding/follow-many'],
    // reels
    ['post', '/api/reels'], ['delete', `/api/reels/${ID}`], ['put', `/api/reels/${ID}/like`], ['delete', `/api/reels/${ID}/like`],
    ['post', `/api/reels/${ID}/view`], ['post', `/api/reels/${ID}/not-interested`], ['post', `/api/reels/${ID}/comments`],
    ['delete', `/api/reels/comments/${ID}`], ['put', `/api/reels/comments/${ID}/like`], ['delete', `/api/reels/comments/${ID}/like`],
    // buzz
    ['post', '/api/buzz'], ['put', `/api/buzz/posts/${ID}/vote`], ['delete', `/api/buzz/posts/${ID}`], ['post', `/api/buzz/posts/${ID}/hide-author`],
    ['post', `/api/buzz/${ID}/replies`], ['post', `/api/buzz/${ID}/poll/vote`], ['post', `/api/buzz/${ID}/hide`], ['delete', `/api/buzz/${ID}/hide`],
    // orbit
    ['post', '/api/orbit/feed/seen'], ['post', '/api/orbit/posts'], ['delete', `/api/orbit/posts/${ID}`], ['put', `/api/orbit/posts/${ID}/like`],
    ['delete', `/api/orbit/posts/${ID}/like`], ['post', `/api/orbit/posts/${ID}/poll/vote`], ['post', `/api/orbit/posts/${ID}/comments`],
    ['delete', `/api/orbit/comments/${ID}`],
    // discover
    ['post', '/api/discover/dismiss'],
    // messages
    ['post', '/api/conversations/groups'], ['patch', `/api/conversations/${ID}`], ['post', `/api/conversations/${ID}/members`],
    ['delete', `/api/conversations/${ID}/members/me`], ['post', `/api/conversations/${ID}/accept`], ['post', `/api/conversations/${ID}/decline`],
    ['post', `/api/conversations/${ID}/read`], ['post', `/api/conversations/${ID}/messages`], ['delete', `/api/conversations/${ID}/messages/${ID}`],
    ['put', `/api/conversations/${ID}/messages/${ID}/reaction`], ['post', `/api/conversations/${ID}/messages/${ID}/offer`],
    // roommates
    ['put', '/api/roommates/me'], ['post', '/api/roommates/me/pause'], ['post', '/api/roommates/me/resume'], ['post', '/api/roommates/me/confirm'],
    ['post', '/api/roommates/me/unpublish'], ['delete', '/api/roommates/me'], ['put', `/api/roommates/${ID}/save`], ['delete', `/api/roommates/${ID}/save`],
    // market
    ['post', '/api/market/listings'], ['patch', `/api/market/listings/${ID}`], ['delete', `/api/market/listings/${ID}`],
    ['post', `/api/market/listings/${ID}/sold`], ['post', `/api/market/listings/${ID}/relist`], ['put', `/api/market/listings/${ID}/save`],
    ['delete', `/api/market/listings/${ID}/save`], ['post', `/api/market/listings/${ID}/offers`],
    // campus
    ['post', '/api/campus/events'], ['patch', `/api/campus/events/${ID}`], ['post', `/api/campus/events/${ID}/cancel`],
    ['put', `/api/campus/events/${ID}/rsvp`], ['post', '/api/campus/courses'], ['post', `/api/campus/courses/${ID}/join`],
    ['post', `/api/campus/courses/${ID}/leave`],
    // apartments
    ['put', '/api/apartments/survey/budget'],
    // admin
    ['post', `/api/admin/queue/${ID}/claim`], ['post', `/api/admin/queue/${ID}/actions`], ['post', '/api/admin/queue/bulk'],
    ['post', `/api/admin/users/${ID}/sanctions`], ['post', `/api/admin/users/${ID}/role`], ['post', `/api/admin/buzz/buzz/${ID}/unmask`],
    ['patch', `/api/admin/rule-packs/${ID}`], ['post', `/api/admin/appeals/${ID}/decide`],
  ];

  it.each(routes)('%s %s → 401 unauthenticated', async (method, path) => {
    const agent = ctx.anon() as unknown as Record<string, (p: string) => { send(b: unknown): Promise<{ status: number; body: { error?: { code: string } } }> }>;
    const res = await agent[method]!(path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('unauthenticated');
  });
});

/* ═════════════════════════════ 2. admin surface ═════════════════════════════ */

describe('admin surface is invisible to non-staff (404) and admin-only routes to moderators', () => {
  const ID = 'zzzzzzzzzzzzzz';
  const adminRoutes: [string, string][] = [
    ['get', '/api/admin/queue'], ['get', '/api/admin/queue/counts'], ['get', `/api/admin/queue/${ID}`], ['post', `/api/admin/queue/${ID}/claim`],
    ['post', `/api/admin/queue/${ID}/release`], ['post', `/api/admin/queue/${ID}/actions`], ['post', '/api/admin/queue/bulk'],
    ['post', `/api/admin/buzz/buzz/${ID}/unmask`], ['get', '/api/admin/audit'], ['get', '/api/admin/audit/export.csv'],
    ['get', '/api/admin/users'], ['get', `/api/admin/users/${ID}`], ['post', `/api/admin/users/${ID}/role`], ['post', `/api/admin/users/${ID}/verify`],
    ['post', `/api/admin/users/${ID}/sanctions`], ['post', `/api/admin/sanctions/${ID}/lift`], ['get', '/api/admin/appeals'],
    ['get', `/api/admin/appeals/${ID}`], ['post', `/api/admin/appeals/${ID}/decide`], ['get', '/api/admin/analytics/overview'],
    ['get', '/api/admin/analytics/apartments'], ['get', '/api/admin/analytics/moderation'], ['get', '/api/admin/rule-packs'],
    ['patch', `/api/admin/rule-packs/${ID}`], ['get', '/api/admin/limitations'], ['get', '/api/admin/does-not-exist'],
  ];

  it.each(adminRoutes)('student: %s %s → 404 not_found', async (method, path) => {
    const agent = ctx.as(A.id) as unknown as Record<string, (p: string) => { send(b: unknown): Promise<{ status: number; body: { error?: { code: string } } }> }>;
    const res = await agent[method]!(path).send({});
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('not_found');
  });

  it.each(adminRoutes)('org: %s %s → 404 not_found', async (method, path) => {
    const agent = ctx.as(ORG.id) as unknown as Record<string, (p: string) => { send(b: unknown): Promise<{ status: number; body: { error?: { code: string } } }> }>;
    const res = await agent[method]!(path).send({});
    expect(res.status).toBe(404);
  });

  it('moderator: admin-only routes (role, verify, lift, rule packs, audit CSV, unmask) → 404', async () => {
    const m = ctx.as(MOD.id);
    expect((await m.post(`/api/admin/users/${A.id}/role`).send({ role: 'admin' })).status).toBe(404);
    expect((await m.post(`/api/admin/users/${A.id}/verify`).send({ verified: true })).status).toBe(404);
    expect((await m.post('/api/admin/sanctions/zzzz/lift').send({ note: 'x' })).status).toBe(404);
    expect((await m.get('/api/admin/rule-packs')).status).toBe(404);
    expect((await m.get('/api/admin/audit/export.csv')).status).toBe(404);
    expect((await m.post('/api/admin/buzz/buzz/zzzz/unmask').send({ reasonCode: 'x', reason: 'r'.repeat(40), confirm: 'UNMASK' })).status).toBe(404);
    expect((ctx.db.prepare('SELECT role FROM users WHERE id = ?').get(A.id) as { role: string }).role).toBe('user');
  });

  it('moderator cannot suspend / ban (admin only)', async () => {
    const target = ctx.createUser({ universityId: HERO });
    const res = await ctx.as(MOD.id).post(`/api/admin/users/${target.id}/sanctions`).send({ kind: 'suspension', category: 'spam_scam', note: 'n'.repeat(40) });
    expect(res.status).toBe(403);
    expect((ctx.db.prepare('SELECT status FROM users WHERE id = ?').get(target.id) as { status: string }).status).toBe('active');
  });
});

/* ═════════════════════════════ 3. market IDOR ═════════════════════════════ */

describe('market: B cannot edit / delete / mark-sold / relist / accept-offer on A’s listing', () => {
  it('PATCH, DELETE, sold, relist by a non-owner → 404 and the row is unchanged', async () => {
    const id = await createListing(A);
    const before = ctx.db.prepare('SELECT title, price, state, status FROM market_listings WHERE id = ?').get(id);
    const b = ctx.as(B.id);
    expect((await b.patch(`/api/market/listings/${id}`).send({ title: 'pwned', price: 1 })).status).toBe(404);
    expect((await b.post(`/api/market/listings/${id}/sold`).send({ state: 'sold' })).status).toBe(404);
    expect((await b.post(`/api/market/listings/${id}/relist`)).status).toBe(404);
    expect((await b.delete(`/api/market/listings/${id}`)).status).toBe(404);
    expect(ctx.db.prepare('SELECT title, price, state, status FROM market_listings WHERE id = ?').get(id)).toEqual(before);
    // relist of someone else's SOLD listing
    expect((await ctx.as(A.id).post(`/api/market/listings/${id}/sold`).send({ state: 'sold' })).status).toBe(200);
    expect((await b.post(`/api/market/listings/${id}/relist`)).status).toBe(404);
    expect((ctx.db.prepare('SELECT state FROM market_listings WHERE id = ?').get(id) as { state: string }).state).toBe('sold');
  });

  it('offers: only the seller can accept/decline, only the buyer can withdraw, outsiders get 404', async () => {
    const id = await createListing(A);
    const offer = await ctx.as(B.id).post(`/api/market/listings/${id}/offers`).send({ amount: 20 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const { conversationId, messageId } = offer.body as { conversationId: string; messageId: string };
    const path = `/api/conversations/${conversationId}/messages/${messageId}/offer`;
    // outsider C: not a member
    expect((await ctx.as(C.id).post(path).send({ action: 'accept' })).status).toBe(404);
    // buyer cannot accept their own offer
    expect((await ctx.as(B.id).post(path).send({ action: 'accept' })).status).toBe(403);
    // seller cannot withdraw the buyer's offer
    expect((await ctx.as(A.id).post(path).send({ action: 'withdraw' })).status).toBe(403);
    expect((ctx.db.prepare('SELECT offer_status FROM messages WHERE id = ?').get(messageId) as { offer_status: string }).offer_status).toBe('pending');
  });

  it('campus-only: a user on another campus cannot open, save or offer on the listing', async () => {
    const id = await createListing(A);
    const x = ctx.as(X.id);
    expect((await x.get(`/api/market/listings/${id}`)).status).toBe(404);
    expect((await x.put(`/api/market/listings/${id}/save`)).status).toBe(404);
    expect((await x.post(`/api/market/listings/${id}/offers`).send({ amount: 10 })).status).toBe(404);
    const browse = await x.get('/api/market/listings?limit=50');
    expect((browse.body.items as { id: string }[]).some((l) => l.id === id)).toBe(false);
  });

  it('share card of a staff-removed listing does not disclose its title / photo / price to other users', async () => {
    const title = uniq('Removed contraband listing');
    const id = await createListing(A, { title });
    ctx.db.prepare("UPDATE market_listings SET status = 'removed' WHERE id = ?").run(id);
    const res = await ctx.as(B.id).get(`/api/cards/listing/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.title).toBe('No longer available');
    expect(res.body.imageUrl).toBeNull();
    expect(res.body.price).toBeNull();
    expect(res.body.meetupSpot).toBeNull();
  });

  it('share card of a HELD (pre-publication review) listing does not disclose its text to other users', async () => {
    const title = uniq('Held listing text');
    const id = await createListing(A, { title });
    ctx.db.prepare("UPDATE market_listings SET status = 'held' WHERE id = ?").run(id);
    const res = await ctx.as(B.id).get(`/api/cards/listing/${id}`);
    expect(res.body.title).not.toBe(title);
    expect(JSON.stringify(res.body)).not.toContain(title);
  });

  it('share card of a listing does not cross campuses (market is campus-only)', async () => {
    const title = uniq('Campus only bike');
    const id = await createListing(A, { title });
    const res = await ctx.as(X.id).get(`/api/cards/listing/${id}`);
    expect(res.body.status).toBe('unavailable');
    expect(JSON.stringify(res.body)).not.toContain(title);
  });
});

/* ═════════════════════════════ 4. orbit / reels / buzz IDOR ═════════════════════════════ */

describe('orbit: B cannot delete A’s post or A’s comment on A’s post', () => {
  it('DELETE post / comment by a non-owner → 404 and both stay active', async () => {
    const postId = await createPost(A);
    const comment = await ctx.as(A.id).post(`/api/orbit/posts/${postId}/comments`).send({ text: uniq('first comment on my own post') });
    expect(comment.status, JSON.stringify(comment.body)).toBe(201);
    expect((await ctx.as(B.id).delete(`/api/orbit/comments/${comment.body.id}`)).status).toBe(404);
    expect((await ctx.as(B.id).delete(`/api/orbit/posts/${postId}`)).status).toBe(404);
    expect((ctx.db.prepare('SELECT status FROM orbit_posts WHERE id = ?').get(postId) as { status: string }).status).toBe('active');
    expect((ctx.db.prepare('SELECT status FROM orbit_comments WHERE id = ?').get(comment.body.id) as { status: string }).status).toBe('active');
  });

  it('B cannot like / comment on A’s post once blocked by A (either direction)', async () => {
    const a2 = ctx.createUser({ universityId: HERO });
    const b2 = ctx.createUser({ universityId: HERO });
    const postId = await createPost(a2);
    expect((await ctx.as(a2.id).post(`/api/users/${b2.id}/block`)).status).toBe(200);
    expect((await ctx.as(b2.id).put(`/api/orbit/posts/${postId}/like`)).status).toBe(404);
    expect((await ctx.as(b2.id).post(`/api/orbit/posts/${postId}/comments`).send({ text: uniq('sneaky comment') })).status).toBe(404);
  });
});

describe('reels: B cannot delete A’s reel or comment; campus-visibility reels stay on campus', () => {
  it('DELETE reel / reel comment by a non-owner → 404', async () => {
    const reel = ctx.db.prepare("SELECT id, author_id FROM reels WHERE status = 'active' LIMIT 1").get() as { id: string; author_id: string };
    expect(reel).toBeTruthy();
    expect((await ctx.as(B.id).delete(`/api/reels/${reel.id}`)).status).toBe(404);
    expect((ctx.db.prepare('SELECT status FROM reels WHERE id = ?').get(reel.id) as { status: string }).status).toBe('active');
    const c = await ctx.as(A.id).post(`/api/reels/${reel.id}/comments`).send({ text: uniq('nice reel honestly') });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await ctx.as(B.id).delete(`/api/reels/comments/${c.body.id}`)).status).toBe(404);
    expect((ctx.db.prepare('SELECT status FROM reel_comments WHERE id = ?').get(c.body.id) as { status: string }).status).toBe('active');
  });

  it('a visibility:"campus" reel cannot be opened, liked or commented on from another campus', async () => {
    const reel = ctx.db
      .prepare("SELECT id FROM reels WHERE visibility = 'campus' AND university_id = ? AND status = 'active' LIMIT 1")
      .get(HERO) as { id: string } | undefined;
    expect(reel, 'seed has campus-only reels on the hero campus').toBeTruthy();
    const x = ctx.as(X.id);
    expect((await x.get(`/api/reels/${reel!.id}`)).status).toBe(404);
    expect((await x.put(`/api/reels/${reel!.id}/like`)).status).toBe(404);
    expect((await x.post(`/api/reels/${reel!.id}/comments`).send({ text: uniq('hello from another campus') })).status).toBe(404);
  });
});

describe('buzz: B cannot delete A’s buzz; non-owner errors are the generic 404', () => {
  it('DELETE /buzz/posts/:id by a non-owner → 404 and the buzz survives', async () => {
    const created = await ctx.as(A.id).post('/api/buzz').send({ text: uniq('does anyone else think the library wifi is cursed') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const del = await ctx.as(B.id).delete(`/api/buzz/posts/${id}`);
    expect(del.status).toBe(404);
    const missing = await ctx.as(B.id).delete('/api/buzz/posts/zzzzzzzzzzzzzz');
    expect(del.body).toEqual(missing.body);
    expect((ctx.db.prepare('SELECT status FROM buzz_posts WHERE id = ?').get(id) as { status: string }).status).toBe('active');
  });
});

/* ═════════════════════════════ 5. campus (events / courses) ═════════════════════════════ */

describe('campus events: host-only edits; campus-only RSVPs', () => {
  it('PATCH / cancel by a non-host → refused and the event is unchanged', async () => {
    const id = await createEvent(A);
    const b = ctx.as(B.id);
    const patch = await b.patch(`/api/campus/events/${id}`).send({ title: 'Hijacked event title' });
    expect([403, 404]).toContain(patch.status);
    const cancel = await b.post(`/api/campus/events/${id}/cancel`);
    expect([403, 404]).toContain(cancel.status);
    const row = ctx.db.prepare('SELECT title, cancelled_at FROM events WHERE id = ?').get(id) as { title: string; cancelled_at: number | null };
    expect(row.title).not.toBe('Hijacked event title');
    expect(row.cancelled_at).toBeNull();
  });

  it('RSVP cannot be placed on behalf of someone else (body userId is ignored)', async () => {
    const id = await createEvent(A);
    const res = await ctx.as(B.id).put(`/api/campus/events/${id}/rsvp`).send({ state: 'going', userId: C.id });
    expect(res.status).toBe(200);
    expect(ctx.db.prepare('SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(id, C.id)).toBeUndefined();
    expect(ctx.db.prepare('SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(id, B.id)).toBeTruthy();
  });

  it('a user on another campus cannot open, RSVP to, or list attendees of a campus event', async () => {
    const id = await createEvent(A);
    const x = ctx.as(X.id);
    expect((await x.get(`/api/campus/events/${id}`)).status).toBe(404);
    expect((await x.put(`/api/campus/events/${id}/rsvp`).send({ state: 'going' })).status).toBe(404);
    expect((await x.get(`/api/campus/events/${id}/attendees`)).status).toBe(404);
    expect(ctx.db.prepare('SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(id, X.id)).toBeUndefined();
  });

  it('a user on another campus cannot RSVP "going" to unlock a private-residence address', async () => {
    const host = ctx.createUser({ universityId: HERO });
    const address = '2401 Rio Grande St Apt 4B';
    const res = await ctx.as(host.id).post('/api/campus/events').send(eventBody({ address, addressPrivate: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    await ctx.as(X.id).put(`/api/campus/events/${id}/rsvp`).send({ state: 'going' });
    const detail = await ctx.as(X.id).get(`/api/campus/events/${id}`);
    expect(JSON.stringify(detail.body)).not.toContain(address);
  });

  it('course chats: a user on another campus cannot open or join a course', async () => {
    const course = ctx.db.prepare('SELECT id FROM courses WHERE university_id = ? LIMIT 1').get(HERO) as { id: string };
    expect(course).toBeTruthy();
    expect((await ctx.as(X.id).get(`/api/campus/courses/${course.id}`)).status).toBe(404);
    expect((await ctx.as(X.id).post(`/api/campus/courses/${course.id}/join`)).status).toBe(404);
  });

  it('org can host events; student and org both reach campus routes (no role confusion)', async () => {
    const res = await ctx.as(ORG.id).post('/api/campus/events').send(eventBody());
    expect(res.status).toBe(201);
    expect(res.body.viewer.isHost).toBe(true);
    expect((await ctx.as(A.id).patch(`/api/campus/events/${res.body.id}`).send({ title: 'Student edits org event' })).status).not.toBe(200);
  });
});

/* ═════════════════════════════ 6. roommates ═════════════════════════════ */

describe('roommates: "browse & match only" answers stay private; campus-only', () => {
  it('B cannot read A’s unpublished profile (detail / browse / card / report)', async () => {
    const a = ctx.createUser({ universityId: HERO });
    const b = ctx.createUser({ universityId: HERO });
    const put = await ctx.as(a.id).put('/api/roommates/me').send(roommateBody({ publish: false }));
    expect(put.status, JSON.stringify(put.body)).toBe(201);
    const pid = put.body.id as string;
    // B has a published profile of its own so that compat would be computed if A leaked
    expect((await ctx.as(b.id).put('/api/roommates/me').send(roommateBody({ publish: true }))).status).toBe(201);

    const bb = ctx.as(b.id);
    expect((await bb.get(`/api/roommates/${pid}`)).status).toBe(404);
    const list = await bb.get('/api/roommates?limit=50&sort=newest');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(pid);
    const card = await bb.get(`/api/cards/roommate/${pid}`);
    expect(card.body.status).toBe('unavailable');
    expect(card.body.price).toBeNull();
    expect((await bb.put(`/api/roommates/${pid}/save`)).status).toBe(404);
    const report = await bb.post('/api/reports').send({ entityType: 'roommate_listing', entityId: pid, reason: 'spam_scam' });
    expect(report.status).toBe(404);
    // opening a DM with the unpublished profile as context fails too
    expect((await bb.post('/api/dm').send({ userId: a.id, context: { kind: 'roommate', id: pid } })).status).toBe(400);
  });

  it('a published profile is not visible from another campus (detail / save)', async () => {
    const a = ctx.createUser({ universityId: HERO });
    const put = await ctx.as(a.id).put('/api/roommates/me').send(roommateBody({ publish: true }));
    expect(put.status).toBe(201);
    const pid = put.body.id as string;
    expect((await ctx.as(X.id).get(`/api/roommates/${pid}`)).status).toBe(404);
    expect((await ctx.as(X.id).put(`/api/roommates/${pid}/save`)).status).toBe(404);
  });

  it('roommate share card does not cross campuses (roommates is campus-only)', async () => {
    const a = ctx.createUser({ universityId: HERO });
    const put = await ctx.as(a.id).put('/api/roommates/me').send(roommateBody({ publish: true, budget: 1234 }));
    expect(put.status).toBe(201);
    const card = await ctx.as(X.id).get(`/api/cards/roommate/${put.body.id}`);
    expect(card.body.status).toBe('unavailable');
    expect(card.body.price).toBeNull();
  });
});

/* ═════════════════════════════ 7. messages ═════════════════════════════ */

describe('messages: DMs and requests are private to their members', () => {
  it('outsider C cannot read / send / react / mark-read / accept / decline / rename / add members in A↔B DM', async () => {
    const b2 = ctx.createUser({ universityId: HERO, follows: [A.id] });
    const { conversationId, messageId } = await openDmWith(A, b2);
    const c = ctx.as(C.id);
    const base = `/api/conversations/${conversationId}`;
    expect((await c.get(base)).status).toBe(404);
    expect((await c.get(`${base}/messages`)).status).toBe(404);
    expect((await c.post(`${base}/messages`).send({ kind: 'text', text: 'let me in' })).status).toBe(404);
    expect((await c.put(`${base}/messages/${messageId}/reaction`).send({ emoji: null })).status).toBe(404);
    expect((await c.post(`${base}/read`).send({ messageId })).status).toBe(404);
    expect((await c.post(`${base}/accept`)).status).toBe(404);
    expect((await c.post(`${base}/decline`)).status).toBe(404);
    expect((await c.patch(base).send({ muted: true })).status).toBe(404);
    expect((await c.post(`${base}/members`).send({ userIds: [C.id] })).status).toBe(404);
    expect((await c.delete(`${base}/messages/${messageId}`)).status).toBe(404);
    expect(ctx.db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, C.id)).toBeUndefined();
  });

  it('a member cannot delete someone else’s message', async () => {
    const b2 = ctx.createUser({ universityId: HERO, follows: [A.id] });
    const { conversationId, messageId } = await openDmWith(A, b2);
    expect((await ctx.as(b2.id).delete(`/api/conversations/${conversationId}/messages/${messageId}`)).status).toBe(404);
    expect((ctx.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId) as { status: string }).status).toBe('active');
  });

  it('A cannot see B’s message requests (inbox tab or by id)', async () => {
    const stranger = ctx.createUser({ universityId: HERO });
    const target = ctx.createUser({ universityId: HERO });
    const { conversationId } = await openDmWith(stranger, target, uniq('hi, saw your listing earlier'));
    const reqs = await ctx.as(target.id).get('/api/conversations?tab=requests');
    expect((reqs.body.items as { id: string }[]).some((c) => c.id === conversationId)).toBe(true);
    const aReqs = await ctx.as(A.id).get('/api/conversations?tab=requests');
    expect((aReqs.body.items as { id: string }[]).some((c) => c.id === conversationId)).toBe(false);
    expect((await ctx.as(A.id).get(`/api/conversations/${conversationId}`)).status).toBe(404);
    expect((await ctx.as(A.id).get(`/api/conversations/${conversationId}/messages`)).status).toBe(404);
    // the requester cannot "accept on behalf of" the recipient
    await ctx.as(stranger.id).post(`/api/conversations/${conversationId}/accept`);
    expect((ctx.db.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, target.id) as { state: string }).state).toBe('request');
  });

  it('a member who left a group cannot read it or add themselves back through /members', async () => {
    const owner = ctx.createUser({ universityId: HERO });
    const m1 = ctx.createUser({ universityId: HERO, follows: [owner.id] });
    const m2 = ctx.createUser({ universityId: HERO, follows: [owner.id] });
    const g = await ctx.as(owner.id).post('/api/conversations/groups').send({ title: uniq('Study group'), memberIds: [m1.id, m2.id] });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect((await ctx.as(m1.id).delete(`/api/conversations/${g.body.id}/members/me`)).status).toBe(204);
    expect((await ctx.as(m1.id).get(`/api/conversations/${g.body.id}/messages`)).status).toBe(404);
    expect((await ctx.as(m1.id).post(`/api/conversations/${g.body.id}/members`).send({ userIds: [m1.id] })).status).toBe(404);
    // there is no endpoint to remove somebody else
    const kick = await ctx.as(m2.id).delete(`/api/conversations/${g.body.id}/members/${owner.id}`);
    expect(kick.status).toBe(404);
    expect((ctx.db.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(g.body.id, owner.id) as { state: string }).state).toBe('active');
  });

  it('group create honours the invitee’s "Who can message me: people I follow" setting (safety §7.2)', async () => {
    const creator = ctx.createUser({ universityId: HERO });
    const friend = ctx.createUser({ universityId: HERO, follows: [creator.id] });
    const privateUser = ctx.createUser({ universityId: HERO });
    expect((await ctx.as(privateUser.id).patch('/api/me/settings').send({ whoCanMessage: 'following' })).status).toBe(200);
    // a DM is refused …
    expect((await ctx.as(creator.id).post('/api/dm').send({ userId: privateUser.id })).status).toBe(403);
    // … so a group invite must be refused too
    const g = await ctx.as(creator.id).post('/api/conversations/groups').send({ title: uniq('Hello'), memberIds: [friend.id, privateUser.id] });
    expect(g.status).toBe(403);
    expect(g.body.error?.code).toBe('cannot_message');
  });

  it('adding a member to an existing group honours "Who can message me: my campus"', async () => {
    const creator = ctx.createUser({ universityId: OTHER });
    const f1 = ctx.createUser({ universityId: OTHER, follows: [creator.id] });
    const f2 = ctx.createUser({ universityId: OTHER, follows: [creator.id] });
    const campusOnly = ctx.createUser({ universityId: HERO });
    expect((await ctx.as(campusOnly.id).patch('/api/me/settings').send({ whoCanMessage: 'campus' })).status).toBe(200);
    expect((await ctx.as(creator.id).post('/api/dm').send({ userId: campusOnly.id })).status).toBe(403);
    const g = await ctx.as(creator.id).post('/api/conversations/groups').send({ title: uniq('Hi'), memberIds: [f1.id, f2.id] });
    expect(g.status).toBe(201);
    const add = await ctx.as(creator.id).post(`/api/conversations/${g.body.id}/members`).send({ userIds: [campusOnly.id] });
    expect(add.status).toBe(403);
    expect(ctx.db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(g.body.id, campusOnly.id)).toBeUndefined();
  });

  it('a minor can only be reached from their own campus — group invites included (safety §7.7)', async () => {
    const minor = ctx.createUser({ universityId: HERO, isAdult: false });
    const outsider = ctx.createUser({ universityId: OTHER });
    const pal = ctx.createUser({ universityId: OTHER, follows: [outsider.id] });
    expect((await ctx.as(outsider.id).post('/api/dm').send({ userId: minor.id })).status).toBe(403);
    const g = await ctx.as(outsider.id).post('/api/conversations/groups').send({ title: uniq('Chat'), memberIds: [pal.id, minor.id] });
    expect(g.status).toBe(403);
    expect(ctx.db.prepare("SELECT 1 FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id WHERE m.user_id = ? AND c.kind = 'group'").get(minor.id)).toBeUndefined();
  });

  it('muted users cannot create new message requests by adding non-followers to a group (safety §4.1)', async () => {
    const owner = ctx.createUser({ universityId: HERO });
    const f1 = ctx.createUser({ universityId: HERO, follows: [owner.id] });
    const f2 = ctx.createUser({ universityId: HERO, follows: [owner.id] });
    const stranger = ctx.createUser({ universityId: HERO });
    const g = await ctx.as(owner.id).post('/api/conversations/groups').send({ title: uniq('Crew'), memberIds: [f1.id, f2.id] });
    expect(g.status).toBe(201);
    applySanction({ userId: owner.id, kind: 'mute', durationMs: 24 * HOUR, category: 'harassment_bullying', actor: ADMIN, delayed: false });
    // group create is refused while muted …
    const create = await ctx.as(owner.id).post('/api/conversations/groups').send({ memberIds: [f1.id, stranger.id] });
    expect(create.status).toBe(403);
    // … so is pulling a stranger into an existing group as a request
    const add = await ctx.as(owner.id).post(`/api/conversations/${g.body.id}/members`).send({ userIds: [stranger.id] });
    expect(add.status).toBe(403);
    expect(add.body.error?.code).toBe('muted');
  });
});

/* ═════════════════════════════ 8. suspended / muted writers ═════════════════════════════ */

describe('suspended users cannot write anywhere', () => {
  it('every create route → 403 suspended', async () => {
    const s = ctx.createUser({ universityId: HERO });
    const friend = ctx.createUser({ universityId: HERO, follows: [s.id] });
    const { conversationId } = await openDmWith(s, friend);
    applySanction({ userId: s.id, kind: 'suspension', durationMs: 7 * DAY, category: 'harassment_bullying', actor: ADMIN });
    const as = ctx.as(s.id);
    const attempts = [
      await as.post('/api/orbit/posts').send({ text: uniq('still here') }),
      await as.post('/api/buzz').send({ text: uniq('anon while suspended') }),
      await as.post('/api/market/listings').send(listingBody()),
      await as.put('/api/roommates/me').send(roommateBody()),
      await as.post('/api/campus/events').send(eventBody()),
      await as.post(`/api/conversations/${conversationId}/messages`).send({ kind: 'text', text: uniq('hello') }),
      await as.post('/api/dm').send({ userId: C.id }),
      await as.patch('/api/me').send({ bio: 'new bio' }),
      await as.post(`/api/users/${C.id}/follow`),
    ];
    for (const r of attempts) {
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe('suspended');
    }
  });

  it('muted users cannot post public content but can still read', async () => {
    const m = ctx.createUser({ universityId: HERO });
    applySanction({ userId: m.id, kind: 'mute', durationMs: 24 * HOUR, category: 'harassment_bullying', actor: ADMIN, delayed: false });
    const as = ctx.as(m.id);
    expect((await as.post('/api/orbit/posts').send({ text: uniq('muted post') })).status).toBe(403);
    expect((await as.post('/api/buzz').send({ text: uniq('muted buzz') })).status).toBe(403);
    expect((await as.post('/api/campus/events').send(eventBody())).status).toBe(403);
    expect((await as.get('/api/orbit/feed')).status).toBe(200);
  });
});

/* ═════════════════════════════ 9. core resources ═════════════════════════════ */

describe('core: notifications / settings / follows are per-user', () => {
  it('A cannot mark B’s notifications read by id', async () => {
    const b2 = ctx.createUser({ universityId: HERO });
    const follower = ctx.createUser({ universityId: HERO });
    expect((await ctx.as(follower.id).post(`/api/users/${b2.id}/follow`)).status).toBe(200);
    const n = ctx.db.prepare('SELECT id FROM notifications WHERE user_id = ? AND read_at IS NULL LIMIT 1').get(b2.id) as { id: string } | undefined;
    expect(n, 'follow produced a notification').toBeTruthy();
    await ctx.as(A.id).post('/api/notifications/read').send({ ids: [n!.id] });
    expect((ctx.db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(n!.id) as { read_at: number | null }).read_at).toBeNull();
  });

  it('a blocked user cannot follow the blocker or open a DM with them', async () => {
    const blocker = ctx.createUser({ universityId: HERO });
    const blocked = ctx.createUser({ universityId: HERO });
    expect((await ctx.as(blocker.id).post(`/api/users/${blocked.id}/block`)).status).toBe(200);
    expect((await ctx.as(blocked.id).post(`/api/users/${blocker.id}/follow`)).status).toBe(404);
    expect((await ctx.as(blocked.id).post('/api/dm').send({ userId: blocker.id })).status).toBe(403);
  });

  it('uploads owned by B cannot be attached by A (listing photos, post images, event cover)', async () => {
    ctx.db.prepare(
      `INSERT INTO uploads (id, user_id, kind, purpose, url, mime, size, width, height, duration_ms, created_at)
       VALUES ('up_hard_b1', ?, 'image', NULL, '/uploads/hard-b1.png', 'image/png', 10, 10, 10, NULL, ?)`,
    ).run(B.id, Date.now());
    const photo = { url: '/uploads/hard-b1.png', width: 10, height: 10 };
    expect((await ctx.as(A.id).post('/api/market/listings').send(listingBody({ photos: [photo] }))).status).toBe(404);
    expect((await ctx.as(A.id).post('/api/orbit/posts').send({ text: uniq('look at this'), images: [photo] })).status).toBe(404);
    expect((await ctx.as(A.id).post('/api/campus/events').send(eventBody({ coverUrl: photo.url }))).status).toBe(404);
  });
});
