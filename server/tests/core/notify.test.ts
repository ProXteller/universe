/**
 * lib/notify.ts (SPEC §4.2.7, §4.4.4, routes #31–#32): collapse, no-op rules, seed-only `actorIds`, the anonymous
 * variant (no actor, CHECK constraint, forbidden data keys), milestone once-per-day, ws payloads, quiet-hours hook.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOUR, MIN, now, setNow } from '../../src/lib/clock';
import {
  badgesFor, notify, notifyAnonymous, notifySeeded, removeNotificationsFor, serializeNotification, setQuietHoursCheck, type NotificationRow,
} from '../../src/lib/notify';
import { assertNoForbiddenKeys, createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});
afterEach(() => {
  setQuietHoursCheck(null);
  setNow(null);
});

const rowsFor = (userId: string): NotificationRow[] =>
  ctx.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId) as NotificationRow[];
const actorsOf = (id: string): string[] =>
  (ctx.db.prepare('SELECT actor_id FROM notification_actors WHERE notification_id = ? ORDER BY actor_id').all(id) as { actor_id: string }[]).map((r) => r.actor_id);

const like = (userId: string, actorId: string, reelId = 'reel_x', extra: Partial<Parameters<typeof notify>[0]> = {}): void =>
  notify({ userId, type: 'reel.like', actorId, href: `/reel/${reelId}`, target: { entityType: 'reel', entityId: reelId }, data: { caption: 'hi' }, ...extra });

describe('notify: collapse', () => {
  it('merges same (user, type, target) unread rows within 60 min: distinct actor count, last actor, fresh created_at', () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    const b = ctx.createUser();
    const t0 = 1_800_000_000_000;
    setNow(t0);
    like(me.id, a.id);
    setNow(t0 + 10 * MIN);
    like(me.id, b.id);
    setNow(t0 + 20 * MIN);
    like(me.id, a.id); // same actor again: still 2 distinct
    let rows = rowsFor(me.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ type: 'reel.like', category: 'likes', actor_id: a.id, actor_count: 2, created_at: t0 + 20 * MIN, anonymous: 0 });
    expect(actorsOf(rows[0]!.id).sort()).toEqual([a.id, b.id].sort());

    // a different target never merges
    like(me.id, b.id, 'reel_y');
    expect(rowsFor(me.id).length).toBe(2);

    // outside the window → a new row; a READ row never collapses either
    setNow(t0 + 20 * MIN + HOUR + 1);
    like(me.id, b.id);
    rows = rowsFor(me.id).filter((r) => r.target_id === 'reel_x');
    expect(rows.length).toBe(2);
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ?').run(now(), me.id);
    like(me.id, a.id);
    expect(rowsFor(me.id).filter((r) => r.target_id === 'reel_x').length).toBe(3);
  });

  it('follow.new never collapses; collapse:false is honoured; rows without a target never collapse', () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    const b = ctx.createUser();
    notify({ userId: me.id, type: 'follow.new', actorId: a.id, href: `/u/${a.handle}`, target: { entityType: 'user', entityId: a.id } });
    notify({ userId: me.id, type: 'follow.new', actorId: b.id, href: `/u/${b.handle}`, target: { entityType: 'user', entityId: b.id } });
    expect(rowsFor(me.id).filter((r) => r.type === 'follow.new').length).toBe(2);
    like(me.id, a.id, 'reel_z', { collapse: false });
    like(me.id, b.id, 'reel_z', { collapse: false });
    expect(rowsFor(me.id).filter((r) => r.target_id === 'reel_z').length).toBe(2);
    notify({ userId: me.id, type: 'system.announcement', actorId: null, href: '/', data: { title: 'A', body: 'x' } });
    notify({ userId: me.id, type: 'system.announcement', actorId: null, href: '/', data: { title: 'B', body: 'y' } });
    expect(rowsFor(me.id).filter((r) => r.type === 'system.announcement').length).toBe(2);
  });
});

describe('notify: no-op rules', () => {
  it('skips self, blocked actors, non-active recipients and switched-off categories (safety always on)', () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    like(me.id, me.id);
    expect(rowsFor(me.id).length).toBe(0);

    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(me.id, a.id, now());
    like(me.id, a.id);
    expect(rowsFor(me.id).length).toBe(0);
    ctx.db.prepare('DELETE FROM blocks').run();

    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(me.id);
    like(me.id, a.id);
    expect(rowsFor(me.id).length).toBe(0);
    ctx.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(me.id);

    ctx.db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify({ notifications: { likes: false, safety: false } }), me.id);
    like(me.id, a.id);
    expect(rowsFor(me.id).length).toBe(0);
    notify({ userId: me.id, type: 'mod.warning', actorId: null, href: '/settings/account-status', target: { entityType: 'sanction', entityId: 's1' }, data: { category: 'hate', until: null, sanctionId: 's1' } });
    expect(rowsFor(me.id).map((r) => r.type)).toEqual(['mod.warning']);
  });
});

describe('notify: ws + quiet hours + badges', () => {
  it('publishes { notification, badges } after a write, only { badges } inside quiet hours', () => {
    const me = ctx.createUser();
    const a = ctx.createUser({ followedBy: [] });
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(me.id, a.id, now());
    like(me.id, a.id);
    const events = ctx.wsEventsFor(me.id);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.type).toBe('notification');
    if (e.type !== 'notification') throw new Error('unreachable');
    expect(e.badges).toEqual({ notifications: 1, messages: 0, requests: 0 });
    expect(e.notification).toMatchObject({ type: 'reel.like', anonymous: false, actorCount: 1, read: false, actor: { id: a.id, handle: a.handle } });
    expect((e.notification as { actorFollowedByViewer: boolean }).actorFollowedByViewer).toBe(true);
    expect((e.notification as { thumbnailUrl: string | null }).thumbnailUrl).toBeNull();

    setQuietHoursCheck(() => true);
    like(me.id, a.id, 'reel_q');
    const quiet = ctx.wsEventsFor(me.id).at(-1)!;
    expect(quiet.type).toBe('badges');
    expect(rowsFor(me.id).length).toBe(2);
    expect(badgesFor(me.id).notifications).toBe(2);
  });
});

describe('notifySeeded (SeedKit): seed-only actorIds', () => {
  it('writes ONE collapsed row with actor_count = actorIds.length, actor_id = last entry, read:true, no ws', () => {
    const me = ctx.createUser();
    const actors = Array.from({ length: 13 }, () => ctx.createUser().id);
    const at = now() - 3 * HOUR;
    notifySeeded({ userId: me.id, type: 'reel.like', actorId: null, actorIds: actors, href: '/reel/r1', target: { entityType: 'reel', entityId: 'r1' }, createdAt: at, read: true });
    const rows = rowsFor(me.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ actor_id: actors[12], actor_count: 13, created_at: at });
    expect(rows[0]!.read_at).not.toBeNull();
    expect(actorsOf(rows[0]!.id).length).toBe(13);
    expect(ctx.wsEventsFor(me.id)).toEqual([]);
    expect(serializeNotification(rows[0]!)).toMatchObject({ actorCount: 13, read: true, actor: { id: actors[12] } });
    // the live notify() IGNORES actorIds
    const b = ctx.createUser();
    notify({ userId: me.id, type: 'reel.like', actorId: b.id, actorIds: actors, href: '/reel/r2', target: { entityType: 'reel', entityId: 'r2' } });
    const live = rowsFor(me.id).find((r) => r.target_id === 'r2')!;
    expect(live).toMatchObject({ actor_id: b.id, actor_count: 1 });
    expect(actorsOf(live.id)).toEqual([b.id]);
  });
});

describe('notifyAnonymous: the variant that cannot carry an actor', () => {
  it('writes anonymous = 1 / actor_id NULL, strips forbidden data keys, serializes with actor: null and no identity keys', () => {
    const me = ctx.createUser();
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'buzz_0001', href: '/buzz/buzz_0001', data: { snippet: 'ok', handle: 'leak', userId: 'u_leak', authorId: 'x', nested: { a: 1 } as never } });
    const rows = rowsFor(me.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ anonymous: 1, actor_id: null, actor_count: 1, category: 'buzz', target_type: 'buzz', target_id: 'buzz_0001', thumbnail_url: null });
    expect(JSON.parse(rows[0]!.data_json)).toEqual({ snippet: 'ok' });
    expect(actorsOf(rows[0]!.id)).toEqual([]);
    const n = serializeNotification(rows[0]!);
    expect(n).toMatchObject({ anonymous: true, actor: null, actorCount: 1, thumbnailUrl: null, type: 'buzz.reply' });
    expect('actorFollowedByViewer' in n).toBe(false);
    assertNoForbiddenKeys(n);
    const e = ctx.wsEventsFor(me.id)[0]!;
    expect(e.type).toBe('notification');
    if (e.type === 'notification') assertNoForbiddenKeys(e.notification);
  });

  it('collapses replies on the same thread without ever counting distinct actors', () => {
    const me = ctx.createUser();
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'b1', href: '/buzz/b1' });
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'b1', href: '/buzz/b1' });
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'b2', href: '/buzz/b2' });
    const rows = rowsFor(me.id);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r).toMatchObject({ actor_count: 1, actor_id: null, anonymous: 1 });
  });

  it('buzz.milestone: max one per thread per day (the row is updated in place)', () => {
    const me = ctx.createUser();
    const t0 = 1_800_000_000_000;
    setNow(t0);
    notifyAnonymous({ userId: me.id, type: 'buzz.milestone', threadId: 'b1', href: '/buzz/b1', data: { upvotes: 10 } });
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ?').run(t0, me.id);
    setNow(t0 + 5 * HOUR);
    notifyAnonymous({ userId: me.id, type: 'buzz.milestone', threadId: 'b1', href: '/buzz/b1', data: { upvotes: 50 } });
    let rows = rowsFor(me.id);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]!.data_json)).toEqual({ upvotes: 50 });
    setNow(t0 + 25 * HOUR);
    notifyAnonymous({ userId: me.id, type: 'buzz.milestone', threadId: 'b1', href: '/buzz/b1', data: { upvotes: 100 } });
    rows = rowsFor(me.id);
    expect(rows.length).toBe(2);
  });

  it('the table CHECK constraint rejects an actor on an anonymous row (defence in depth)', () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    const insert = (): unknown =>
      ctx.db
        .prepare(
          `INSERT INTO notifications (id, user_id, type, category, anonymous, actor_id, href, created_at) VALUES ('bad', ?, 'buzz.reply', 'buzz', 1, ?, '/buzz/x', ?)`,
        )
        .run(me.id, a.id, now());
    expect(insert).toThrow(/CHECK constraint failed/);
    expect(rowsFor(me.id).length).toBe(0);
  });
});

describe('removeNotificationsFor + serializer', () => {
  it('deletes by target and fills actorFollowedByViewer from the recipient → actor edge', () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    like(me.id, a.id, 'reel_gone');
    like(me.id, a.id, 'reel_keep');
    removeNotificationsFor({ entityType: 'reel', entityId: 'reel_gone' });
    const rows = rowsFor(me.id);
    expect(rows.map((r) => r.target_id)).toEqual(['reel_keep']);
    const n = serializeNotification(rows[0]!);
    expect(n).toMatchObject({ actor: { id: a.id }, anonymous: false });
    expect((n as { actorFollowedByViewer: boolean }).actorFollowedByViewer).toBe(false);
  });
});

describe('routes #31–#32', () => {
  it('lists newest first with filter mapping, unreadCount, pagination and identity-safe anonymous rows; marks read', async () => {
    const me = ctx.createUser();
    const a = ctx.createUser();
    const t0 = 1_800_000_000_000;
    setNow(t0);
    notify({ userId: me.id, type: 'follow.new', actorId: a.id, href: `/u/${a.handle}`, target: { entityType: 'user', entityId: a.id } });
    setNow(t0 + MIN);
    notify({ userId: me.id, type: 'reel.comment', actorId: a.id, href: '/reel/r1?comments=1', target: { entityType: 'reel', entityId: 'r1' }, data: { snippet: 'nice', commentId: 'c1' } });
    setNow(t0 + 2 * MIN);
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'b1', href: '/buzz/b1' });
    setNow(t0 + 3 * MIN);
    notify({ userId: me.id, type: 'event.rsvp', actorId: a.id, href: '/campus/events/e1', target: { entityType: 'event', entityId: 'e1' }, data: { title: 'Hack night', state: 'going' } });
    setNow(null);

    const agent = ctx.as(me.id);
    const all = await agent.get('/api/notifications').query({ limit: 3 });
    expect(all.status).toBe(200);
    expect(all.body.items.map((n: { type: string }) => n.type)).toEqual(['event.rsvp', 'buzz.reply', 'reel.comment']);
    expect(all.body.unreadCount).toBe(4);
    expect(all.body.nextCursor).toBeTruthy();
    const page2 = await agent.get('/api/notifications').query({ limit: 3, cursor: all.body.nextCursor });
    expect(page2.body.items.map((n: { type: string }) => n.type)).toEqual(['follow.new']);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.items[0]).toMatchObject({ actor: { id: a.id }, actorFollowedByViewer: false, anonymous: false });

    const replies = await agent.get('/api/notifications').query({ filter: 'replies' });
    expect(replies.body.items.map((n: { type: string }) => n.type)).toEqual(['buzz.reply', 'reel.comment']);
    const anon = replies.body.items[0];
    expect(anon).toMatchObject({ anonymous: true, actor: null, thumbnailUrl: null });
    assertNoForbiddenKeys(anon);
    assertNoIdentityLeakFor(anon, [a.id, a.handle, a.displayName, a.email]);
    const events = await agent.get('/api/notifications').query({ filter: 'events' });
    expect(events.body.items.map((n: { type: string }) => n.type)).toEqual(['event.rsvp']);
    expect((await agent.get('/api/notifications').query({ filter: 'bogus' })).status).toBe(400);

    const readSome = await agent.post('/api/notifications/read').send({ ids: [all.body.items[0].id] });
    expect(readSome.status).toBe(200);
    expect(readSome.body).toEqual({ notifications: 3, messages: 0, requests: 0 });
    const readAll = await agent.post('/api/notifications/read').send({});
    expect(readAll.body.notifications).toBe(0);
    expect((await agent.get('/api/notifications')).body.unreadCount).toBe(0);
    expect((await ctx.anon().get('/api/notifications')).status).toBe(401);
  });
});

function assertNoIdentityLeakFor(body: unknown, strings: string[]): void {
  const text = JSON.stringify(body).toLowerCase();
  for (const s of strings) expect(text.includes(s.toLowerCase()), `leak: ${s}`).toBe(false);
}
