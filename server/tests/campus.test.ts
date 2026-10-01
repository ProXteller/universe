/**
 * campus slice tests (SPEC §5.9 + §5 common minimum), isolation mode.
 * Filters (today/week/free_food/category); RSVP counters + capacity + host notification; private address hidden until
 * going; cancel notifies + unmarks public activity; lazy reminder generated once; course dedupe 409 with the existing
 * course; join is idempotent, lands in a `course` conversation, never raises `message.group_added`; other-campus course
 * 404; street address allowed, "girls free" flagged; block excludes attendees / hosts / friends-going; auth 401;
 * validation 400; moderation block 422 + author-notice hygiene; muted 403 on every create / edit route; held visibility;
 * adapter + card resolvers; edit notifies RSVPs; hosted lists; milestones; seed invariants at lite.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_COVER_URL_PREFIX, COURSE_CHAT_WELCOME } from '@shared/campus';
import type { AuthedUser } from '../src/lib/users';
import { DAY, HOUR, MIN, now, setNow } from '../src/lib/clock';
import { getContentAdapter, resolveCard } from '../src/lib/content';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import { dayBounds } from '../src/services/campus/events';

let ctx: TestCtx;

const PRESET = `${EVENT_COVER_URL_PREFIX}social.svg`;
const uid = (u: AuthedUser | string): string => (typeof u === 'string' ? u : u.id);

let seq = 0;

/** Each generated description is unique: the engine's duplicate detector blocks identical text within 10 min. */
function eventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const at = now();
  seq += 1;
  return {
    title: 'Board game night',
    description: `Bring a game or borrow one of ours. Beginners welcome. Table ${seq}.`,
    category: 'social',
    startsAt: at + 2 * HOUR,
    endsAt: at + 4 * HOUR,
    locationName: 'Texas Union',
    coverUrl: PRESET,
    freeFood: false,
    ...overrides,
  };
}

async function createEvent(user: AuthedUser | string, overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await ctx.as(uid(user)).post('/api/campus/events').send(eventBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Record<string, any>;
}

async function rsvp(user: AuthedUser | string, id: string, state: 'going' | 'interested' | null) {
  return ctx.as(uid(user)).put(`/api/campus/events/${id}/rsvp`).send({ state });
}

async function listIds(user: AuthedUser | string, query = ''): Promise<string[]> {
  const res = await ctx.as(uid(user)).get(`/api/campus/events${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as { id: string }[]).map((e) => e.id);
}

function mute(userId: string): void {
  const at = now();
  ctx.db
    .prepare(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, category, starts_at, effective_at, ends_at, created_at)
       VALUES (?,?,'mute','all','harassment_bullying',?,?,?,?)`,
    )
    .run(`san_${userId}`, userId, at - HOUR, at - HOUR, at + DAY, at - HOUR);
}

function notificationsOf(userId: string, type?: string): { type: string; read_at: number | null; actor_id: string | null; data_json: string; actor_count: number }[] {
  return ctx.db
    .prepare(`SELECT type, read_at, actor_id, data_json, actor_count FROM notifications WHERE user_id = ?${type ? ' AND type = ?' : ''} ORDER BY created_at`)
    .all(...(type ? [userId, type] : [userId])) as { type: string; read_at: number | null; actor_id: string | null; data_json: string; actor_count: number }[];
}

function forbiddenNoticeKeys(body: unknown): string[] {
  const text = JSON.stringify(body);
  return ['matches', 'ruleId', 'signals', 'engine'].filter((k) => text.includes(`"${k}"`));
}

/** Pin the clock to 10:00 local today so "+2 h" is always "today" (the day filter uses local midnight bounds). */
function pinMorning(): void {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  setNow(d.getTime());
}

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['campus'] });
  pinMorning();
});

afterEach(() => setNow(null));

/* ───────────────────────────── auth + validation ───────────────────────────── */

describe('auth + validation', () => {
  it('401 without a session on every endpoint group', async () => {
    const anon = ctx.anon();
    expect((await anon.get('/api/campus/hub')).status).toBe(401);
    expect((await anon.get('/api/campus/events')).status).toBe(401);
    expect((await anon.post('/api/campus/events').send(eventBody())).status).toBe(401);
    expect((await anon.get('/api/campus/events/nope')).status).toBe(401);
    expect((await anon.put('/api/campus/events/nope/rsvp').send({ state: 'going' })).status).toBe(401);
    expect((await anon.get('/api/campus/courses')).status).toBe(401);
    expect((await anon.get('/api/campus/courses/mine')).status).toBe(401);
    expect((await anon.post('/api/campus/courses').send({ code: 'cs314', title: 'Data Structures' })).status).toBe(401);
    expect((await anon.post('/api/campus/courses/nope/join')).status).toBe(401);
    expect((await anon.get('/api/campus/users/u_mayachen/events')).status).toBe(401);
  });

  it('400 on bad category, inverted times, past events, oversize title, a foreign cover url, a bad course code; 404 for missing rows', async () => {
    const maya = ctx.as('mayachen');
    const at = now();
    const bad = async (body: Record<string, unknown>) => {
      const res = await maya.post('/api/campus/events').send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(forbiddenNoticeKeys(res.body)).toEqual([]);
    };
    await bad(eventBody({ category: 'party' }));
    await bad(eventBody({ startsAt: at + 4 * HOUR, endsAt: at + 2 * HOUR }));
    await bad(eventBody({ startsAt: at - 4 * HOUR, endsAt: at - 2 * HOUR }));
    await bad(eventBody({ title: 'x'.repeat(101) }));
    await bad(eventBody({ capacity: 0 }));
    await bad(eventBody({ title: 'ok' }));
    const foreignCover = await maya.post('/api/campus/events').send(eventBody({ coverUrl: 'https://example.com/x.png' }));
    expect(foreignCover.status).toBe(404);
    const badCode = await maya.post('/api/campus/courses').send({ code: 'not a code', title: 'Something' });
    expect(badCode.status).toBe(400);
    expect(badCode.body.error.code).toBe('validation_failed');
    expect((await maya.get('/api/campus/events/does-not-exist')).status).toBe(404);
    expect((await maya.get('/api/campus/courses/does-not-exist')).status).toBe(404);
    expect((await maya.get('/api/campus/events?filter=bogus')).status).toBe(400);
    expect((await maya.get('/api/campus/events?cursor=tampered.xx')).status).toBe(400);
  });
});

/* ───────────────────────────── events ───────────────────────────── */

describe('events', () => {
  it('create → 201 WithModeration, public_activity + analytics rows, and the event shows in the list, detail and hub', async () => {
    const ev = await createEvent('mayachen', { freeFood: true, address: '2308 Whitis Ave, Austin, TX' });
    expect(ev.moderation).toEqual({ status: 'active', userMessage: null, support: null });
    expect(ev.status).toBe('active');
    expect(ev.host.handle).toBe('mayachen');
    expect(ev.viewer).toEqual({ isHost: true, isFollowingHost: false });
    expect(ev.address).toBe('2308 Whitis Ave, Austin, TX');
    expect(ev.goingCount).toBe(0);
    expect(ev.myRsvp).toBeNull();
    expect(forbiddenNoticeKeys(ev)).toEqual([]);

    const activity = ctx.db.prepare("SELECT * FROM public_activity WHERE kind = 'event' AND entity_id = ?").get(ev.id);
    expect(activity).toBeTruthy();
    const tracked = ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'event_create' AND user_id = 'u_mayachen'").get() as { n: number };
    expect(tracked.n).toBe(1);

    expect(await listIds('mayachen')).toContain(ev.id);
    const detail = await ctx.as('hannahkim').get(`/api/campus/events/${ev.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.viewer.isHost).toBe(false);
    expect(detail.body.host.id).toBe('u_mayachen');

    const hub = await ctx.as('hannahkim').get('/api/campus/hub');
    expect(hub.status, JSON.stringify(hub.body)).toBe(200);
    expect(hub.body.university.id).toBe('uni_utexas');
    expect(hub.body.launch.count).toBeGreaterThan(0);
    expect(hub.body.today.events).toBe(1);
    expect(hub.body.today.freeFood).toBe(1);
    expect(hub.body.today.newListings).toBeNull();
    expect(hub.body.todayEvents.map((e: { id: string }) => e.id)).toEqual([ev.id]);
    expect(hub.body.myCourses).toEqual([]);
  });

  it('filters: today / week / free_food / category — campus-only, upcoming, starts_at ASC', async () => {
    const at = now();
    const today = await createEvent('mayachen', { title: 'Today thing', startsAt: at + HOUR, endsAt: at + 2 * HOUR, category: 'academic' });
    const inWeek = await createEvent('hannahkim', { title: 'Later this week', startsAt: at + 3 * DAY, endsAt: at + 3 * DAY + HOUR, category: 'sports', freeFood: true });
    const later = await createEvent('diegoh', { title: 'Next month', startsAt: at + 20 * DAY, endsAt: at + 20 * DAY + HOUR, category: 'arts' });
    const other = await createEvent('ninakow', { title: 'UMich thing', startsAt: at + HOUR, endsAt: at + 2 * HOUR });

    const all = await listIds('mayachen');
    expect(all).toEqual([today.id, inWeek.id, later.id]);
    expect(all).not.toContain(other.id);
    expect(await listIds('mayachen', '?filter=today')).toEqual([today.id]);
    expect(await listIds('mayachen', '?filter=week')).toEqual([today.id, inWeek.id]);
    expect(await listIds('mayachen', '?filter=free_food')).toEqual([inWeek.id]);
    expect(await listIds('mayachen', '?filter=sports')).toEqual([inWeek.id]);
    expect(await listIds('mayachen', '?filter=arts')).toEqual([later.id]);
    expect(await listIds('mayachen', '?hostId=u_hannahkim')).toEqual([inWeek.id]);
    expect(await listIds('ninakow')).toEqual([other.id]);

    // pagination
    const page1 = await ctx.as('mayachen').get('/api/campus/events?limit=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.as('mayachen').get(`/api/campus/events?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items.map((e: { id: string }) => e.id)).toEqual([later.id]);
    expect(page2.body.nextCursor).toBeNull();

    // an ended event leaves the list
    ctx.db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?').run(at - 3 * HOUR, at - HOUR, today.id);
    expect(await listIds('mayachen')).toEqual([inWeek.id, later.id]);
  });

  it('RSVP keeps counters equal to rows, respects capacity, notifies the host once (collapsed), and tracks', async () => {
    const ev = await createEvent('hannahkim', { capacity: 2 });
    const a = ctx.createUser({ handle: 'rsvp_a' });
    const b = ctx.createUser({ handle: 'rsvp_b' });
    const c = ctx.createUser({ handle: 'rsvp_c' });

    let res = await rsvp(a, ev.id, 'interested');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.myRsvp).toBe('interested');
    expect(res.body.goingCount).toBe(0);
    res = await rsvp(a, ev.id, 'going');
    expect(res.body.myRsvp).toBe('going');
    expect(res.body.goingCount).toBe(1);
    res = await rsvp(a, ev.id, 'going'); // idempotent
    expect(res.body.goingCount).toBe(1);
    expect((await rsvp(b, ev.id, 'going')).body.goingCount).toBe(2);

    const full = await rsvp(c, ev.id, 'going');
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('conflict');
    expect((await rsvp(c, ev.id, 'interested')).status).toBe(200);

    const detail = await ctx.as(c.id).get(`/api/campus/events/${ev.id}`);
    expect(detail.body.isFull).toBe(true);
    expect(detail.body.goingCount).toBe(2);
    expect(detail.body.interestedCount).toBe(1);
    const rows = ctx.db.prepare('SELECT state, COUNT(*) AS n FROM event_rsvps WHERE event_id = ? GROUP BY state').all(ev.id) as { state: string; n: number }[];
    expect(Object.fromEntries(rows.map((r) => [r.state, r.n]))).toEqual({ going: 2, interested: 1 });

    // un-RSVP frees a seat
    expect((await rsvp(a, ev.id, null)).body.goingCount).toBe(1);
    expect((await rsvp(c, ev.id, 'going')).status).toBe(200);
    expect((await ctx.as(c.id).get(`/api/campus/events/${ev.id}`)).body.myRsvp).toBe('going');

    // host notification: one collapsed event.rsvp row for the going RSVPs (interested never notifies)
    const notes = notificationsOf('u_hannahkim', 'event.rsvp');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.actor_count).toBe(3);
    expect(JSON.parse(notes[0]!.data_json)).toMatchObject({ title: 'Board game night', state: 'going' });

    const tracked = ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'event_rsvp'").get() as { n: number };
    expect(tracked.n).toBeGreaterThanOrEqual(5);

    // attendees: going list, follows first
    const viewer = ctx.createUser({ handle: 'rsvp_viewer', follows: [c.id] });
    const going = await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}/attendees?state=going`);
    expect(going.status).toBe(200);
    expect(going.body.items.map((u: { id: string }) => u.id)).toEqual([c.id, b.id]);
    expect(going.body.items[0].viewer.isFollowing).toBe(true);
    const interested = await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}/attendees?state=interested`);
    expect(interested.body.items).toEqual([]);
  });

  it('a private address is hidden until the viewer is going (or is the host)', async () => {
    const ev = await createEvent('hannahkim', { address: '1234 W 24th St, Austin, TX', addressPrivate: true });
    expect(ev.address).toBe('1234 W 24th St, Austin, TX');
    expect(ev.addressPrivate).toBe(true);
    const viewer = ctx.createUser({ handle: 'addr_viewer' });
    expect((await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}`)).body.address).toBeNull();
    await rsvp(viewer, ev.id, 'interested');
    expect((await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}`)).body.address).toBeNull();
    await rsvp(viewer, ev.id, 'going');
    expect((await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}`)).body.address).toBe('1234 W 24th St, Austin, TX');
    // a public address is always visible
    const pub = await createEvent('hannahkim', { title: 'Public venue', address: '2100 Speedway, Austin, TX', addressPrivate: false });
    expect((await ctx.as(viewer.id).get(`/api/campus/events/${pub.id}`)).body.address).toBe('2100 Speedway, Austin, TX');
  });

  it('cancel notifies every RSVP, unmarks public activity, leaves the list, and blocks further RSVPs', async () => {
    const ev = await createEvent('hannahkim');
    const a = ctx.createUser({ handle: 'cancel_a' });
    const b = ctx.createUser({ handle: 'cancel_b' });
    await rsvp(a, ev.id, 'going');
    await rsvp(b, ev.id, 'interested');

    const stranger = await ctx.as(a.id).post(`/api/campus/events/${ev.id}/cancel`);
    expect(stranger.status).toBe(403);

    const res = await ctx.as('hannahkim').post(`/api/campus/events/${ev.id}/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cancelled).toBe(true);
    expect(notificationsOf(a.id, 'event.cancelled')).toHaveLength(1);
    expect(notificationsOf(b.id, 'event.cancelled')).toHaveLength(1);
    expect(ctx.db.prepare("SELECT 1 FROM public_activity WHERE kind = 'event' AND entity_id = ?").get(ev.id)).toBeUndefined();
    expect(await listIds(a)).not.toContain(ev.id);
    expect((await ctx.as(a.id).get(`/api/campus/events/${ev.id}`)).body.cancelled).toBe(true);
    const again = await rsvp(b, ev.id, 'going');
    expect(again.status).toBe(409);
    // idempotent, no second notification
    await ctx.as('hannahkim').post(`/api/campus/events/${ev.id}/cancel`);
    expect(notificationsOf(a.id, 'event.cancelled')).toHaveLength(1);
    // editing a cancelled event is refused
    expect((await ctx.as('hannahkim').patch(`/api/campus/events/${ev.id}`).send({ title: 'Renamed' })).status).toBe(409);
  });

  it('the lazy reminder hook creates exactly one event.reminder per going RSVP within the hour', async () => {
    const at = now();
    const soon = await createEvent('hannahkim', { title: 'Soon', startsAt: at + 30 * MIN, endsAt: at + 90 * MIN });
    const later = await createEvent('hannahkim', { title: 'Later', startsAt: at + 5 * HOUR, endsAt: at + 6 * HOUR });
    const u = ctx.createUser({ handle: 'remind_me' });
    const onlyInterested = ctx.createUser({ handle: 'remind_not' });
    await rsvp(u, soon.id, 'going');
    await rsvp(u, later.id, 'going');
    await rsvp(onlyInterested, soon.id, 'interested');

    expect(notificationsOf(u.id, 'event.reminder')).toHaveLength(0);
    const badges1 = await ctx.as(u.id).get('/api/me/badges');
    expect(badges1.status).toBe(200);
    const badges2 = await ctx.as(u.id).get('/api/me/badges');
    expect(badges2.body.notifications).toBe(badges1.body.notifications);
    const notes = notificationsOf(u.id, 'event.reminder');
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0]!.data_json)).toMatchObject({ title: 'Soon', startsAt: at + 30 * MIN });
    expect(notes[0]!.actor_id).toBeNull();
    expect(notes[0]!.read_at).toBeNull();
    const row = ctx.db.prepare('SELECT reminded_at FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(soon.id, u.id) as { reminded_at: number | null };
    expect(row.reminded_at).not.toBeNull();
    expect(notificationsOf(onlyInterested.id, 'event.reminder')).toHaveLength(0);

    // moving the clock makes the later one due — still one per event
    setNow(at + 4 * HOUR + 10 * MIN);
    await ctx.as(u.id).get('/api/me/badges');
    await ctx.as(u.id).get('/api/me/badges');
    expect(notificationsOf(u.id, 'event.reminder')).toHaveLength(2);
    setNow(null);
  });

  it('a street address is allowed in an event, and a "girls free" description is flagged (visible + queued)', async () => {
    const ok = await createEvent('hannahkim', { title: 'Open mic at the venue', address: '2100 Guadalupe St, Austin, TX', description: 'Doors at 7 at 2100 Guadalupe St. Sign up on the night.' });
    expect(ok.status).toBe('active');
    expect(ok.moderation.status).toBe('active');

    const flagged = await createEvent('diegoh', { title: 'Rooftop social', description: 'Girls free before 10, guys pay at the door.' });
    expect(flagged.status).toBe('active');
    const events = ctx.db.prepare("SELECT action, visibility FROM moderation_events WHERE entity_type = 'event' AND entity_id = ?").all(flagged.id) as { action: string; visibility: string }[];
    expect(events.some((e) => e.action === 'flag' && e.visibility === 'visible')).toBe(true);
    const queue = ctx.db.prepare("SELECT status, source FROM mod_queue WHERE entity_type = 'event' AND entity_id = ?").get(flagged.id) as { status: string; source: string } | undefined;
    expect(queue?.status).toBe('open');
    expect(queue?.source).toBe('rule_flag');
    expect(forbiddenNoticeKeys(flagged)).toEqual([]);
    // still listed for everyone (flag visible)
    expect(await listIds('mayachen')).toContain(flagged.id);
  });

  it('the venue and address are moderated like the title: a blocked venue is refused (create + edit), a flagged one is queued, both reach the adapter snapshot', async () => {
    const before = (ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const blocked = await ctx.as('mayachen').post('/api/campus/events').send(eventBody({ locationName: 'selling adderall, dm me for study pills' }));
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(422);
    expect(blocked.body.error.code).toBe('content_blocked');
    expect(forbiddenNoticeKeys(blocked.body)).toEqual([]);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(before);

    const flagged = await createEvent('diegoh', { locationName: 'The Loft, girls free before 10' });
    expect(flagged.status).toBe('active');
    const queue = ctx.db.prepare("SELECT status, source FROM mod_queue WHERE entity_type = 'event' AND entity_id = ?").get(flagged.id) as { status: string; source: string } | undefined;
    expect(queue?.status).toBe('open');
    expect(queue?.source).toBe('rule_flag');

    const ok = await createEvent('hannahkim', { address: '2100 Guadalupe St, Austin, TX' });
    const snap = getContentAdapter('event')!.load(ok.id)!;
    expect(snap.fields).toEqual(expect.arrayContaining([{ field: 'name', text: 'Texas Union' }, { field: 'address', text: '2100 Guadalupe St, Austin, TX' }]));

    const moved = await ctx.as('hannahkim').patch(`/api/campus/events/${ok.id}`).send({ locationName: 'selling adderall, dm me for study pills' });
    expect(moved.status).toBe(422);
    expect(moved.body.error.code).toBe('content_blocked');
    expect((await ctx.as('hannahkim').get(`/api/campus/events/${ok.id}`)).body.locationName).toBe('Texas Union');
  });

  it('hub Today counts cover every event today, not only the 20 cards', async () => {
    const at = now();
    const ins = ctx.db.prepare(
      `INSERT INTO events (id, host_id, university_id, title, description, category, starts_at, ends_at, location_name, address, address_private,
         cover_url, free_food, capacity, status, created_at, updated_at)
       VALUES (?, 'u_hannahkim', 'uni_utexas', ?, '', 'social', ?, ?, 'Texas Union', NULL, 0, ?, ?, NULL, 'active', ?, ?)`,
    );
    for (let i = 0; i < 23; i++) ins.run(`ev_today_${i}`, `Today ${i}`, at + (i + 1) * MIN, at + (i + 1) * MIN + HOUR, PRESET, i % 2 === 0 ? 1 : 0, at, at);
    const hub = await ctx.as('mayachen').get('/api/campus/hub');
    expect(hub.status, JSON.stringify(hub.body)).toBe(200);
    expect(hub.body.today.events).toBe(23);
    expect(hub.body.today.freeFood).toBe(12);
    expect(hub.body.todayEvents).toHaveLength(20);
    expect(await listIds('mayachen', '?filter=today&limit=50')).toHaveLength(23);
  });

  it('the host hears about each attendee once: interested → going pings, un-RSVP + re-RSVP an hour later does not', async () => {
    const ev = await createEvent('hannahkim', { startsAt: now() + 3 * HOUR, endsAt: now() + 6 * HOUR });
    const a = ctx.createUser({ handle: 'again_a' });
    const b = ctx.createUser({ handle: 'again_b' });
    expect((await rsvp(a, ev.id, 'interested')).status).toBe(200);
    expect(notificationsOf('u_hannahkim', 'event.rsvp')).toHaveLength(0);
    expect((await rsvp(a, ev.id, 'going')).status).toBe(200);
    expect(notificationsOf('u_hannahkim', 'event.rsvp')).toHaveLength(1);
    expect((await rsvp(a, ev.id, null)).status).toBe(200);
    setNow(now() + 90 * MIN); // past the 60-minute collapse window
    expect((await rsvp(a, ev.id, 'going')).status).toBe(200);
    let notes = notificationsOf('u_hannahkim', 'event.rsvp');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.actor_count).toBe(1);
    expect((await rsvp(b, ev.id, 'going')).status).toBe(200); // a genuinely new attendee still pings
    notes = notificationsOf('u_hannahkim', 'event.rsvp');
    expect(notes).toHaveLength(2);
    expect(notes[1]!.actor_id).toBe(b.id);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM event_rsvp_pings WHERE event_id = ?').get(ev.id) as { n: number }).n).toBe(2);
  });

  it('blocks exclude hosts, attendees and friends-going in both directions', async () => {
    const host = ctx.createUser({ handle: 'blk_host' });
    const viewer = ctx.createUser({ handle: 'blk_viewer' });
    const friend = ctx.createUser({ handle: 'blk_friend' });
    const ev = await createEvent(host);
    const other = await createEvent('hannahkim', { title: 'Other event' });
    await rsvp(friend, other.id, 'going');
    await rsvp(host, other.id, 'going');
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, friend.id, now());
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, host.id, now());

    const before = await ctx.as(viewer.id).get(`/api/campus/events/${other.id}`);
    expect(before.body.friendsGoing.map((u: { id: string }) => u.id).sort()).toEqual([friend.id, host.id].sort());

    // viewer blocks the host: the host's event disappears; the host vanishes from attendee lists and friends-going
    expect((await ctx.as(viewer.id).post(`/api/users/${host.id}/block`)).status).toBe(200);
    expect(await listIds(viewer)).not.toContain(ev.id);
    expect((await ctx.as(viewer.id).get(`/api/campus/events/${ev.id}`)).status).toBe(404);
    const attendees = await ctx.as(viewer.id).get(`/api/campus/events/${other.id}/attendees?state=going`);
    expect(attendees.body.items.map((u: { id: string }) => u.id)).toEqual([friend.id]);
    const after = await ctx.as(viewer.id).get(`/api/campus/events/${other.id}`);
    expect(after.body.friendsGoing.map((u: { id: string }) => u.id)).toEqual([friend.id]);
    expect((await ctx.as(viewer.id).get(`/api/campus/users/${host.id}/events`)).status).toBe(200);

    // the other direction: the host blocking the viewer hides the host's event from the viewer too
    const viewer2 = ctx.createUser({ handle: 'blk_viewer2' });
    expect(await listIds(viewer2)).toContain(ev.id);
    expect((await ctx.as(host.id).post(`/api/users/${viewer2.id}/block`)).status).toBe(200);
    expect(await listIds(viewer2)).not.toContain(ev.id);
    expect((await ctx.as(viewer2.id).get(`/api/campus/events/${ev.id}`)).status).toBe(404);
    expect((await ctx.as(viewer2.id).get(`/api/campus/users/${host.id}/events`)).status).toBe(404);
  });

  it('a blocked write returns 422 content_blocked with a clean author notice; nothing is stored', async () => {
    const before = (ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const res = await ctx.as('mayachen').post('/api/campus/events').send(eventBody({ description: 'Anyone selling adderall before the exam? dm me for study pills' }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('content_blocked');
    expect(res.body.error.details).toMatchObject({ messageId: expect.any(String), title: expect.any(String) });
    expect(forbiddenNoticeKeys(res.body)).toEqual([]);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(before);
  });

  it('muted users get 403 muted on every create / edit route; reads and RSVPs still work', async () => {
    const ev = await createEvent('hannahkim');
    const u = ctx.createUser({ handle: 'muted_u' });
    const own = await createEvent(u);
    mute(u.id);
    const create = await ctx.as(u.id).post('/api/campus/events').send(eventBody());
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('muted');
    const edit = await ctx.as(u.id).patch(`/api/campus/events/${own.id}`).send({ title: 'Renamed while muted' });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe('muted');
    const course = await ctx.as(u.id).post('/api/campus/courses').send({ code: 'cs314', title: 'Data Structures' });
    expect(course.status).toBe(403);
    expect(course.body.error.code).toBe('muted');
    expect((await ctx.as(u.id).get('/api/campus/events')).status).toBe(200);
    expect((await rsvp(u, ev.id, 'going')).status).toBe(200);
  });

  it('a held event is visible to its host (with status) and invisible to everyone else; the adapter restores it', async () => {
    const ev = await createEvent('hannahkim');
    ctx.db.prepare("UPDATE events SET status = 'held' WHERE id = ?").run(ev.id);
    ctx.db.prepare("DELETE FROM public_activity WHERE kind = 'event' AND entity_id = ?").run(ev.id);
    expect(await listIds('hannahkim')).toContain(ev.id);
    expect((await ctx.as('hannahkim').get(`/api/campus/events/${ev.id}`)).body.status).toBe('held');
    expect(await listIds('mayachen')).not.toContain(ev.id);
    expect((await ctx.as('mayachen').get(`/api/campus/events/${ev.id}`)).status).toBe(404);
    const hub = await ctx.as('mayachen').get('/api/campus/hub');
    expect(hub.body.todayEvents.map((e: { id: string }) => e.id)).not.toContain(ev.id);

    const adapter = getContentAdapter('event')!;
    expect(adapter).toBeTruthy();
    const snap = adapter.load(ev.id)!;
    expect(snap).toMatchObject({ entityType: 'event', authorId: 'u_hannahkim', universityId: 'uni_utexas', status: 'held', surface: 'event', anon: false, label: 'event', href: `/campus/events/${ev.id}` });
    expect(snap.fields.map((f) => f.field)).toEqual(['title', 'body', 'name']); // venue is UGC too; no address on this fixture

    adapter.setStatus(ev.id, 'active');
    expect(await listIds('mayachen')).toContain(ev.id);
    expect(ctx.db.prepare("SELECT 1 FROM public_activity WHERE kind = 'event' AND entity_id = ?").get(ev.id)).toBeTruthy();
    adapter.setStatus(ev.id, 'hidden');
    expect(await listIds('mayachen')).not.toContain(ev.id);
    expect(ctx.db.prepare("SELECT 1 FROM public_activity WHERE kind = 'event' AND entity_id = ?").get(ev.id)).toBeUndefined();
    adapter.setStatus(ev.id, 'removed');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'event' AND target_id = ?").get(ev.id)).toEqual({ n: 0 });
    expect((await ctx.as('hannahkim').get(`/api/campus/events/${ev.id}`)).body.status).toBe('removed');
  });

  it('card resolvers: event (available / cancelled / ended / blocked) and course (campus-only)', async () => {
    const ev = await createEvent('hannahkim', { freeFood: true });
    const card = resolveCard({ kind: 'event', id: ev.id }, 'u_mayachen');
    expect(card).toMatchObject({ kind: 'event', id: ev.id, title: 'Board game night', status: 'available', badge: 'Free food', ownerId: 'u_hannahkim', href: `/campus/events/${ev.id}`, imageUrl: PRESET, currency: 'USD' });
    expect((await ctx.as('mayachen').get(`/api/cards/event/${ev.id}`)).body.status).toBe('available');

    ctx.db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?').run(now() - 2 * HOUR, now() - HOUR, ev.id);
    expect(resolveCard({ kind: 'event', id: ev.id }, 'u_mayachen').status).toBe('ended');
    await ctx.as('hannahkim').post(`/api/campus/events/${ev.id}/cancel`);
    expect(resolveCard({ kind: 'event', id: ev.id }, 'u_mayachen').status).toBe('cancelled');

    const blocker = ctx.createUser({ handle: 'card_blocker' });
    await ctx.as(blocker.id).post('/api/users/u_hannahkim/block');
    expect(resolveCard({ kind: 'event', id: ev.id }, blocker.id).status).toBe('unavailable');
    expect(resolveCard({ kind: 'event', id: 'nope' }, 'u_mayachen').status).toBe('unavailable');

    const created = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'cs 314', title: 'Data Structures' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const course = resolveCard({ kind: 'course', id: created.body.id }, 'u_hannahkim');
    expect(course).toMatchObject({ kind: 'course', title: 'CS 314', href: `/c/${created.body.id}`, status: 'available', ownerId: null, badge: '1 classmate' });
    expect(course.subtitle).toContain('Data Structures');
    expect(resolveCard({ kind: 'course', id: created.body.id }, 'u_ninakow').status).toBe('unavailable');
  });

  it('edit: the host changes time / place → RSVPs get event.updated; text is re-moderated; non-hosts get 403', async () => {
    const ev = await createEvent('hannahkim');
    const a = ctx.createUser({ handle: 'edit_a' });
    await rsvp(a, ev.id, 'interested');
    expect((await ctx.as(a.id).patch(`/api/campus/events/${ev.id}`).send({ title: 'Hijacked' })).status).toBe(403);

    const rename = await ctx.as('hannahkim').patch(`/api/campus/events/${ev.id}`).send({ title: 'Board game night (renamed)' });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);
    expect(rename.body.title).toBe('Board game night (renamed)');
    expect(rename.body.moderation.status).toBe('active');
    expect(notificationsOf(a.id, 'event.updated')).toHaveLength(0);

    const move = await ctx.as('hannahkim').patch(`/api/campus/events/${ev.id}`).send({ locationName: 'Gregory Gym' });
    expect(move.status).toBe(200);
    expect(move.body.locationName).toBe('Gregory Gym');
    const notes = notificationsOf(a.id, 'event.updated');
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0]!.data_json)).toMatchObject({ title: 'Board game night (renamed)' });
    expect(notes[0]!.actor_id).toBe('u_hannahkim');

    const blocked = await ctx.as('hannahkim').patch(`/api/campus/events/${ev.id}`).send({ description: 'selling adderall, dm me for study pills' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('content_blocked');
    expect((await ctx.as('hannahkim').get(`/api/campus/events/${ev.id}`)).body.description).toBe(ev.description);
    // capacity over 50 needs a week-old account
    const fresh = ctx.createUser({ handle: 'fresh_host', createdAt: now() - DAY });
    const big = await ctx.as(fresh.id).post('/api/campus/events').send(eventBody({ capacity: 80 }));
    expect(big.status).toBe(403);
    expect((await ctx.as(fresh.id).post('/api/campus/events').send(eventBody({ capacity: 50 }))).status).toBe(201);
  });

  it('hosted lists (OrgEventsList): upcoming first, then past; cancelled rows keep their badge', async () => {
    const at = now();
    const soon = await createEvent('events_board', { title: 'Soon', startsAt: at + DAY, endsAt: at + DAY + HOUR });
    const later = await createEvent('events_board', { title: 'Later', startsAt: at + 5 * DAY, endsAt: at + 5 * DAY + HOUR });
    const past = await createEvent('events_board', { title: 'Past', startsAt: at + 2 * DAY, endsAt: at + 2 * DAY + HOUR });
    ctx.db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?').run(at - 3 * DAY, at - 3 * DAY + HOUR, past.id);
    const older = await createEvent('events_board', { title: 'Older', startsAt: at + 3 * DAY, endsAt: at + 3 * DAY + HOUR });
    ctx.db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?').run(at - 9 * DAY, at - 9 * DAY + HOUR, older.id);
    await ctx.as('events_board').post(`/api/campus/events/${later.id}/cancel`);

    const res = await ctx.as('mayachen').get('/api/campus/users/o_events_board/events?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([soon.id, later.id, past.id]);
    expect(res.body.items[1].cancelled).toBe(true);
    const page2 = await ctx.as('mayachen').get(`/api/campus/users/o_events_board/events?limit=3&cursor=${encodeURIComponent(res.body.nextCursor)}`);
    expect(page2.body.items.map((e: { id: string }) => e.id)).toEqual([older.id]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await ctx.as('mayachen').get('/api/campus/users/nobody/events')).status).toBe(404);
  });
});

/* ───────────────────────────── courses ───────────────────────────── */

describe('courses', () => {
  it('create normalises the code, opens a locked course conversation with the welcome line, and dedupes with 409 + the existing course', async () => {
    const res = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'cs314', title: 'Data Structures' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ code: 'CS 314', title: 'Data Structures', memberCount: 1, joined: true, unread: 0 });
    expect(res.body.conversationId).toBeTruthy();
    expect(res.body.term).toMatch(/^(Spring|Summer|Fall) \d{4}$/);
    const conv = ctx.db.prepare('SELECT kind, title, course_code, course_title, course_term, name_locked, created_by FROM conversations WHERE id = ?').get(res.body.conversationId) as Record<string, unknown>;
    expect(conv).toMatchObject({ kind: 'course', title: 'CS 314', course_code: 'CS 314', course_title: 'Data Structures', name_locked: 1, created_by: 'u_mayachen' });
    const member = ctx.db.prepare('SELECT role, state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(res.body.conversationId, 'u_mayachen');
    expect(member).toEqual({ role: 'owner', state: 'active' });
    const first = ctx.db.prepare('SELECT kind, text FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1').get(res.body.conversationId);
    expect(first).toEqual({ kind: 'system', text: COURSE_CHAT_WELCOME });
    expect(notificationsOf('u_mayachen', 'message.group_added')).toHaveLength(0);
    const tracked = ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'course_create'").get() as { n: number };
    expect(tracked.n).toBe(1);

    const dup = await ctx.as('hannahkim').post('/api/campus/courses').send({ code: 'CS  314', title: 'Data Structures again' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('conflict');
    expect(dup.body.error.message).toContain('CS 314 already has a chat with 1 classmate');
    expect(dup.body.error.details.course).toMatchObject({ id: res.body.id, code: 'CS 314', joined: false, conversationId: null, memberCount: 1 });
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(1);

    // search by code prefix and by title; mine
    const byCode = await ctx.as('hannahkim').get('/api/campus/courses?q=cs3');
    expect(byCode.body.items.map((c: { id: string }) => c.id)).toEqual([res.body.id]);
    const byTitle = await ctx.as('hannahkim').get('/api/campus/courses?q=structures');
    expect(byTitle.body.items.map((c: { id: string }) => c.id)).toEqual([res.body.id]);
    expect((await ctx.as('hannahkim').get('/api/campus/courses?q=zzz')).body.items).toEqual([]);
    expect((await ctx.as('ninakow').get('/api/campus/courses?q=cs')).body.items).toEqual([]);
    const mine = await ctx.as('mayachen').get('/api/campus/courses/mine');
    expect(mine.body).toEqual({ items: [expect.objectContaining({ id: res.body.id, joined: true })], nextCursor: null });
    expect((await ctx.as('hannahkim').get('/api/campus/courses/mine')).body.items).toEqual([]);
  });

  it('join is idempotent, lands in the course conversation, posts "{first} joined" once, never notifies; leave works', async () => {
    const created = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'M 408D', title: 'Multivariable Calculus' });
    const courseId = created.body.id as string;
    const join1 = await ctx.as('hannahkim').post(`/api/campus/courses/${courseId}/join`);
    expect(join1.status, JSON.stringify(join1.body)).toBe(200);
    expect(join1.body).toEqual({ conversationId: created.body.conversationId });
    const join2 = await ctx.as('hannahkim').post(`/api/campus/courses/${courseId}/join`);
    expect(join2.body).toEqual(join1.body);
    const member = ctx.db.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(join1.body.conversationId, 'u_hannahkim') as { state: string };
    expect(member.state).toBe('active');
    const joinedLines = ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND kind = 'system' AND text = 'Hannah joined'").get(join1.body.conversationId) as { n: number };
    expect(joinedLines.n).toBe(1);
    expect(notificationsOf('u_hannahkim', 'message.group_added')).toHaveLength(0);
    expect(notificationsOf('u_mayachen', 'message.group_added')).toHaveLength(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'course_join'").get() as { n: number }).n).toBe(1);

    const detail = await ctx.as('hannahkim').get(`/api/campus/courses/${courseId}`);
    expect(detail.body).toMatchObject({ code: 'M 408D', memberCount: 2, joined: true, conversationId: join1.body.conversationId });
    expect((await ctx.as('hannahkim').get('/api/campus/hub')).body.myCourses.map((c: { id: string }) => c.id)).toEqual([courseId]);

    // unread dot: a message from Maya bumps Hannah's unread on the course row
    ctx.db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, text, created_at) VALUES ('m_x', ?, 'u_mayachen', 'text', 'hi all', ?)`,
    ).run(join1.body.conversationId, now());
    ctx.db.prepare('UPDATE conversation_members SET unread_count = 3 WHERE conversation_id = ? AND user_id = ?').run(join1.body.conversationId, 'u_hannahkim');
    expect((await ctx.as('hannahkim').get(`/api/campus/courses/${courseId}`)).body.unread).toBe(3);

    expect((await ctx.as('hannahkim').post(`/api/campus/courses/${courseId}/leave`)).status).toBe(204);
    expect((await ctx.as('hannahkim').get(`/api/campus/courses/${courseId}`)).body).toMatchObject({ joined: false, conversationId: null, memberCount: 1 });
    expect((await ctx.as('hannahkim').post(`/api/campus/courses/${courseId}/leave`)).status).toBe(204);
    // rejoin revives the membership
    expect((await ctx.as('hannahkim').post(`/api/campus/courses/${courseId}/join`)).status).toBe(200);
    expect((await ctx.as('hannahkim').get(`/api/campus/courses/${courseId}`)).body.joined).toBe(true);
  });

  it('search treats %, _ and the escape character literally in every branch', async () => {
    const res = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'cs314', title: 'Data Structures' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    for (const q of ['%', '_', '%%', 'c_', '\\', 'cs_14']) {
      const r = await ctx.as('hannahkim').get(`/api/campus/courses?q=${encodeURIComponent(q)}`);
      expect(r.status, q).toBe(200);
      expect(r.body.items, q).toEqual([]);
    }
    expect((await ctx.as('hannahkim').get('/api/campus/courses?q=cs3')).body.items).toHaveLength(1);
    expect((await ctx.as('hannahkim').get('/api/campus/courses?q=CS%20314')).body.items).toHaveLength(1);
  });

  it("another campus' course is a 404 on read, join and leave", async () => {
    const created = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'GOV 310L', title: 'American Government' });
    expect((await ctx.as('ninakow').get(`/api/campus/courses/${created.body.id}`)).status).toBe(404);
    expect((await ctx.as('ninakow').post(`/api/campus/courses/${created.body.id}/join`)).status).toBe(404);
    expect((await ctx.as('ninakow').post(`/api/campus/courses/${created.body.id}/leave`)).status).toBe(404);
    expect((await ctx.as('ninakow').get(`/api/cards/course/${created.body.id}`)).body.status).toBe('unavailable');
  });

  it('a blocked course title is refused with 422 and no chat is created', async () => {
    const res = await ctx.as('mayachen').post('/api/campus/courses').send({ code: 'CS 101', title: 'kys losers' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('content_blocked');
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'course'").get() as { n: number }).n).toBe(0);
  });
});

/* ───────────────────────────── hub + milestones ───────────────────────────── */

describe('hub milestones', () => {
  it('crossing a launch goal inserts campus_milestones once and notifies the campus once (actor null)', async () => {
    const campus = 'uni_utoronto';
    const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(campus) as { n: number }).n;
    const users: AuthedUser[] = [];
    for (let i = before; i < 25; i++) users.push(ctx.createUser({ handle: `tor_${i}`, universityId: campus }));
    const viewer = users[0] ?? ctx.createUser({ handle: 'tor_x', universityId: campus });
    const hub = await ctx.as(viewer.id).get('/api/campus/hub');
    expect(hub.status).toBe(200);
    expect(hub.body.launch).toEqual({ count: 25, goal: 100 });
    const rows = ctx.db.prepare('SELECT goal FROM campus_milestones WHERE university_id = ? ORDER BY goal').all(campus) as { goal: number }[];
    expect(rows.map((r) => r.goal)).toEqual([25]);
    const notes = notificationsOf(viewer.id, 'campus.milestone');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.actor_id).toBeNull();
    expect(JSON.parse(notes[0]!.data_json)).toMatchObject({ goal: 25, universityName: 'University of Toronto' });
    await ctx.as(viewer.id).get('/api/campus/hub');
    expect(notificationsOf(viewer.id, 'campus.milestone')).toHaveLength(1);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'campus.milestone' AND user_id IN (SELECT id FROM users WHERE university_id = ?)").get(campus) as { n: number }).n).toBe(25);
  });
});

/* ───────────────────────────── seed ───────────────────────────── */

describe('seed (lite)', () => {
  it('matches §5.9 / §7.5: events in the next 14 days, Maya 3 RSVPs + one seeded reminder, 4 course chats, counters equal rows, milestones consistent', async () => {
    ctx = await createTestApp({ slices: ['campus'], seed: 'all' });
    const at = now();
    const events = ctx.db.prepare('SELECT * FROM events').all() as { id: string; starts_at: number; free_food: number; host_id: string; university_id: string; going_count: number; interested_count: number }[];
    expect(events.length).toBeGreaterThanOrEqual(8);
    for (const e of events) {
      expect(e.starts_at).toBeGreaterThan(at);
      expect(e.starts_at).toBeLessThan(at + 14 * DAY);
      const counts = ctx.db.prepare("SELECT SUM(state = 'going') AS g, SUM(state = 'interested') AS i FROM event_rsvps WHERE event_id = ?").get(e.id) as { g: number; i: number };
      expect(e.going_count).toBe(counts.g ?? 0);
      expect(e.interested_count).toBe(counts.i ?? 0);
      expect(ctx.db.prepare("SELECT 1 FROM public_activity WHERE kind = 'event' AND entity_id = ?").get(e.id)).toBeTruthy();
    }
    expect(events.filter((e) => e.university_id === 'uni_utexas').length).toBeGreaterThanOrEqual(6);
    expect(events.filter((e) => e.free_food === 1).length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.host_id.startsWith('o_')).length).toBeGreaterThanOrEqual(5);

    const mayaRsvps = ctx.db.prepare('SELECT event_id, state, reminded_at FROM event_rsvps WHERE user_id = ? ORDER BY event_id').all('u_mayachen') as { event_id: string; state: string; reminded_at: number | null }[];
    expect(mayaRsvps).toHaveLength(3);
    const reminded = mayaRsvps.filter((r) => r.reminded_at !== null);
    expect(reminded).toHaveLength(1);
    const soon = ctx.db.prepare('SELECT starts_at FROM events WHERE id = ?').get(reminded[0]!.event_id) as { starts_at: number };
    expect(soon.starts_at - at).toBeGreaterThan(40 * MIN);
    expect(soon.starts_at - at).toBeLessThan(60 * MIN);
    const reminders = notificationsOf('u_mayachen', 'event.reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.read_at).toBeNull();
    // the lazy hook adds nothing on top of the seeded row, twice
    const b1 = await ctx.as('mayachen').get('/api/me/badges');
    const b2 = await ctx.as('mayachen').get('/api/me/badges');
    expect(b1.body.notifications).toBe(b2.body.notifications);
    expect(notificationsOf('u_mayachen', 'event.reminder')).toHaveLength(1);
    expect(notificationsOf('u_mayachen').filter((n) => n.type.startsWith('event.') || n.type === 'campus.milestone')).toHaveLength(1);

    const mine = await ctx.as('mayachen').get('/api/campus/courses/mine');
    expect(mine.body.items.map((c: { code: string }) => c.code).sort()).toEqual(['CS 429', 'GOV 310L', 'M 408D', 'SDS 320E']);
    expect(mine.body.items.some((c: { unread: number }) => c.unread > 0)).toBe(true);
    expect(mine.body.items.some((c: { unread: number }) => c.unread === 0)).toBe(true);
    const courses = ctx.db.prepare('SELECT * FROM courses').all() as { id: string; conversation_id: string; code: string }[];
    expect(courses.length).toBeGreaterThanOrEqual(8);
    for (const c of courses) {
      const conv = ctx.db.prepare('SELECT kind, course_code, last_message_at FROM conversations WHERE id = ?').get(c.conversation_id) as { kind: string; course_code: string; last_message_at: number };
      expect(conv.kind).toBe('course');
      expect(conv.course_code).toBe(c.code);
      expect(at - conv.last_message_at).toBeLessThan(48 * HOUR);
      const members = (ctx.db.prepare("SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND state = 'active'").get(c.conversation_id) as { n: number }).n;
      expect(members).toBeGreaterThanOrEqual(8);
      const msgs = (ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(c.conversation_id) as { n: number }).n;
      expect(msgs).toBeGreaterThanOrEqual(15);
    }
    // milestones already consistent → a hub fetch fires nothing
    const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'campus.milestone'").get() as { n: number }).n;
    expect(before).toBe(0);
    const hub = await ctx.as('mayachen').get('/api/campus/hub');
    expect(hub.status).toBe(200);
    const todayExpected = events.filter((e) => e.university_id === 'uni_utexas' && e.starts_at < dayBounds(now()).end).length;
    expect(hub.body.today.events).toBe(todayExpected);
    expect(hub.body.myCourses).toHaveLength(4);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'campus.milestone'").get() as { n: number }).n).toBe(0);
    const goals = (ctx.db.prepare('SELECT goal FROM campus_milestones WHERE university_id = ? ORDER BY goal').all('uni_utexas') as { goal: number }[]).map((g) => g.goal);
    expect(goals).toContain(25);
    expect(hub.body.launch.count).toBeGreaterThanOrEqual(25);
    // determinism: a second seed run produces the same rows (timestamps are relative to seed time, so compare the rest)
    const shape = () => ({
      events: ctx.db.prepare('SELECT id, host_id, title, going_count, interested_count, capacity FROM events ORDER BY id').all(),
      rsvps: ctx.db.prepare('SELECT event_id, user_id, state FROM event_rsvps ORDER BY event_id, user_id').all(),
      members: ctx.db.prepare("SELECT conversation_id, user_id FROM conversation_members WHERE conversation_id LIKE 'cconv_%' ORDER BY conversation_id, user_id").all(),
    });
    const first = shape();
    ctx = await createTestApp({ slices: ['campus'], seed: 'all' });
    expect(shape()).toEqual(first);
  });
});
