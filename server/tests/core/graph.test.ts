import { beforeEach, describe, expect, it } from 'vitest';
import { blockedIdsFor, isBlockedBetween, isFollowing, sqlAuthorVisible, sqlNotBlocked } from '../../src/lib/graph';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});

const counts = (id: string): { follower_count: number; following_count: number } =>
  ctx.db.prepare('SELECT follower_count, following_count FROM users WHERE id = ?').get(id) as any;

describe('follow (#25)', () => {
  it('follows, is idempotent, keeps counters equal to rows, and unfollows', async () => {
    const maya = ctx.as('mayachen');
    const target = 'u_bellarossi';
    const before = counts(target);
    const res = await maya.post(`/api/users/${target}/follow`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: target, isFollowing: true, followerCount: before.follower_count + 1 });
    const again = await maya.post(`/api/users/${target}/follow`);
    expect(again.body.followerCount).toBe(before.follower_count + 1);
    expect(isFollowing('u_mayachen', target)).toBe(true);
    const rows = ctx.db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(target) as { n: number };
    expect(counts(target).follower_count).toBe(rows.n);
    const profile = await maya.get('/api/users/bellarossi');
    expect(profile.body.viewer).toMatchObject({ isFollowing: true, isSelf: false });

    const un = await maya.delete(`/api/users/${target}/follow`);
    expect(un.status).toBe(200);
    expect(un.body).toEqual({ userId: target, isFollowing: false, followerCount: before.follower_count });
    expect(isFollowing('u_mayachen', target)).toBe(false);
  });

  it('refuses self-follow and follows of missing / non-active accounts with the generic 404', async () => {
    const maya = ctx.as('mayachen');
    expect((await maya.post('/api/users/u_mayachen/follow')).status).toBe(400);
    const missing = await maya.post('/api/users/nope/follow');
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe("This account isn't available");
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u_bellarossi'").run();
    const suspended = await maya.post('/api/users/u_bellarossi/follow');
    expect(suspended.status).toBe(404);
    expect(suspended.body).toEqual(missing.body);
  });

  it('lists followers / following with search and keyset pagination', async () => {
    const maya = ctx.as('mayachen');
    const first = await maya.get('/api/users/u_mayachen/followers').query({ limit: 10 });
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBe(10);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await maya.get('/api/users/u_mayachen/followers').query({ limit: 10, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    const ids = new Set([...first.body.items, ...second.body.items].map((i: any) => i.id));
    expect(ids.size).toBe(20);
    const following = await maya.get('/api/users/u_mayachen/following').query({ limit: 50 });
    expect(following.body.items.length).toBe(28);
    expect(following.body.nextCursor).toBeNull();
    const searched = await maya.get('/api/users/u_mayachen/following').query({ q: 'wic' });
    expect(searched.body.items.map((i: any) => i.handle)).toEqual(['wic_ut']);
    for (const item of following.body.items) {
      expect(item.viewer.isFollowing).toBe(true);
      expect(item.email).toBeUndefined();
    }
  });
});

describe('block (#26, safety §7.1 / §8.2 #12)', () => {
  it('is symmetric, silent, deletes both follow edges and hides the blocker from the blocked user', async () => {
    // arjunp follows maya and maya follows arjunp (seeded)
    expect(isFollowing('u_mayachen', 'u_arjunp')).toBe(true);
    expect(isFollowing('u_arjunp', 'u_mayachen')).toBe(true);
    const mayaBefore = counts('u_mayachen');
    const arjunBefore = counts('u_arjunp');

    const maya = ctx.as('mayachen');
    const res = await maya.post('/api/users/u_arjunp/block');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u_arjunp', isBlocked: true, sharedGroupConversationIds: [] });
    expect(isBlockedBetween('u_mayachen', 'u_arjunp')).toBe(true);
    expect(isBlockedBetween('u_arjunp', 'u_mayachen')).toBe(true);
    expect(isFollowing('u_mayachen', 'u_arjunp')).toBe(false);
    expect(isFollowing('u_arjunp', 'u_mayachen')).toBe(false);
    expect(counts('u_mayachen')).toEqual({ follower_count: mayaBefore.follower_count - 1, following_count: mayaBefore.following_count - 1 });
    expect(counts('u_arjunp')).toEqual({ follower_count: arjunBefore.follower_count - 1, following_count: arjunBefore.following_count - 1 });
    expect(blockedIdsFor('u_arjunp').has('u_mayachen')).toBe(true);

    // the blocked user gets a 404 identical to a nonexistent account
    const arjun = ctx.as('arjunp');
    const blocked = await arjun.get('/api/users/mayachen');
    const missing = await arjun.get('/api/users/does_not_exist');
    expect(blocked.status).toBe(404);
    expect(blocked.body).toEqual(missing.body);
    expect((await arjun.get('/api/users/by-id/u_mayachen')).body).toEqual(missing.body);
    expect((await arjun.post('/api/users/u_mayachen/follow')).status).toBe(404);

    // the blocker still opens the profile: a shell with zeroed counts and isBlockedByMe
    const shell = await maya.get('/api/users/arjunp');
    expect(shell.status).toBe(200);
    expect(shell.body.viewer.isBlockedByMe).toBe(true);
    expect(shell.body).toMatchObject({ followerCount: 0, followingCount: 0, postCount: 0, bio: '', interests: [] });
    expect((await maya.post('/api/users/u_arjunp/follow')).status).toBe(404);

    // search excludes both ways; follower lists exclude
    const s1 = await maya.get('/api/users/search').query({ q: 'arjun' });
    expect(s1.body.items.map((i: any) => i.id)).not.toContain('u_arjunp');
    const s2 = await arjun.get('/api/users/search').query({ q: 'maya' });
    expect(s2.body.items.map((i: any) => i.id)).not.toContain('u_mayachen');
    const followers = await arjun.get('/api/users/u_jordan_builds/followers').query({ limit: 50 });
    expect(followers.body.items.map((i: any) => i.id)).not.toContain('u_mayachen');

    // block list
    const list = await maya.get('/api/me/blocks');
    expect(list.body.items.map((i: any) => i.user.id)).toEqual(['u_arjunp']);
    expect(list.body.nextCursor).toBeNull();

    // unblock never restores follows
    const un = await maya.delete('/api/users/u_arjunp/block');
    expect(un.body).toEqual({ userId: 'u_arjunp', isBlocked: false, sharedGroupConversationIds: [] });
    expect(isBlockedBetween('u_mayachen', 'u_arjunp')).toBe(false);
    expect(isFollowing('u_mayachen', 'u_arjunp')).toBe(false);
    expect((await arjun.get('/api/users/mayachen')).status).toBe(200);
  });

  it('removes notifications between the two and lists shared groups', async () => {
    const at = 1_700_000_000_000;
    ctx.db.prepare(
      `INSERT INTO notifications (id, user_id, type, category, anonymous, actor_id, href, created_at) VALUES ('n1','u_mayachen','follow.new','follows',0,'u_arjunp','/u/arjunp',?)`,
    ).run(at);
    ctx.db.prepare(
      `INSERT INTO conversations (id, kind, title, created_by, created_at, updated_at) VALUES ('c1','group','Study','u_mayachen',?,?)`,
    ).run(at, at);
    ctx.db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role, state, joined_at) VALUES ('c1','u_mayachen','owner','active',?), ('c1','u_arjunp','member','active',?)`).run(at, at);
    const res = await ctx.as('mayachen').post('/api/users/u_arjunp/block');
    expect(res.body.sharedGroupConversationIds).toEqual(['c1']);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE id = 'n1'").get()).toEqual({ n: 0 });
  });

  it('SQL fragments hide blocked and non-active authors', () => {
    ctx.db.prepare("INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('u_mayachen','u_arjunp',1)").run();
    ctx.db.prepare("UPDATE users SET status = 'banned' WHERE id = 'u_tbrooks'").run();
    const nb = sqlNotBlocked('u_mayachen', 'u.id');
    const rows = ctx.db
      .prepare(`SELECT u.id FROM users u WHERE u.id IN ('u_arjunp','u_tbrooks','u_noahg') AND ${nb.sql} AND ${sqlAuthorVisible('u.id')}`)
      .all(...nb.params) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['u_noahg']);
    const nb2 = sqlNotBlocked('u_arjunp', 'u.id');
    const rows2 = ctx.db.prepare(`SELECT u.id FROM users u WHERE u.id = 'u_mayachen' AND ${nb2.sql}`).all(...nb2.params);
    expect(rows2).toEqual([]);
  });
});

describe('profiles & search (#21–#23)', () => {
  it('returns PublicUser with viewer relation and mutuals; campus first in search', async () => {
    const maya = ctx.as('mayachen');
    const p = await maya.get('/api/users/bellarossi');
    expect(p.status).toBe(200);
    expect(p.body.viewer.isSelf).toBe(false);
    expect(p.body.viewer.mutualCount).toBeGreaterThan(0);
    expect(p.body.viewer.mutualSample.length).toBeGreaterThan(0);
    expect(p.body.viewer.mutualSample.length).toBeLessThanOrEqual(3);
    expect(p.body.email).toBeUndefined();
    expect(p.body.isFoundingMember).toBe(true);
    const self = await maya.get('/api/users/by-id/u_mayachen');
    expect(self.body.viewer.isSelf).toBe(true);
    expect(self.body.followerCount).toBe(41);
    expect(self.body.followingCount).toBe(28);

    const s = await maya.get('/api/users/search').query({ q: 'kai' });
    expect(s.status).toBe(200);
    expect(s.body.items.some((i: any) => i.handle === 'kaiyama')).toBe(true);
    const orgs = await maya.get('/api/users/search').query({ q: 'club', type: 'org' });
    for (const i of orgs.body.items) expect(i.accountType).toBe('org');
    const campus = await maya.get('/api/users/search').query({ q: 'a', scope: 'campus', limit: 50 });
    for (const i of campus.body.items) expect(i.universityId).toBe('uni_utexas');
    const empty = await maya.get('/api/users/search').query({ q: '' });
    expect(empty.body).toEqual({ items: [], nextCursor: null });
  });

  it('serves the campus (#27) and its places (#28)', async () => {
    const maya = ctx.as('mayachen');
    const uni = await maya.get('/api/universities/me');
    expect(uni.body).toMatchObject({ id: 'uni_utexas', shortName: 'UT Austin', domain: 'utexas.edu', countryCode: 'US', currency: 'USD', city: 'Austin' });
    expect(uni.body.memberCount).toBe((ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE university_id = 'uni_utexas' AND status = 'active'").get() as any).n);
    const places = await maya.get('/api/universities/me/places').query({ kind: 'meetup' });
    expect(places.body.items.map((p: any) => p.name)).toEqual(['PCL lobby', 'Texas Union front desk', 'GDC atrium', 'Gregory Gym entrance', 'UTPD safe-exchange zone']);
    expect(places.body.nextCursor).toBeNull();
    const all = await maya.get('/api/universities/me/places');
    expect(all.body.items.length).toBe(16);
  });

  it('requires onboarding for #21–#28 and auth for everything', async () => {
    expect((await ctx.anon().get('/api/users/mayachen')).status).toBe(401);
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL WHERE id = ?').run(fresh.id);
    const res = await ctx.as(fresh.id).get('/api/users/mayachen');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('onboarding_required');
  });
});
