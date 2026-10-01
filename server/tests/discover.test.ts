/**
 * `discover` slice tests (SPEC §5.5). Isolation mode: `createTestApp({ slices: ['discover'] })` — only the core
 * schema + `05-discover.sql` exist, so every assertion runs with ALL other slice tables absent (proves isolation).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Paginated } from '@shared/core';
import type { DiscoverHome, SearchHit, Suggestion } from '@shared/discover';
import { DAY, now } from '../src/lib/clock';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import { ensureTeamUniversity } from '../src/lib/universities';
import { markPublicActivity } from '../src/lib/users';

/** Keys that would only ever exist in a Buzz payload; none may appear anywhere in a Discover response. */
const BUZZ_KEYS = ['alias', 'isOp', 'isMine', 'threadId', 'karma', 'score', 'emoji', 'aliasLabel', 'buzz', 'buzzId', 'poll'];

function walkKeys(value: unknown, out: Set<string>, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const v of value) walkKeys(v, out, seen);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.add(k);
    walkKeys(v, out, seen);
  }
}

function assertNoBuzzFields(body: unknown): void {
  const keys = new Set<string>();
  walkKeys(body, keys);
  const hits = BUZZ_KEYS.filter((k) => keys.has(k));
  expect(hits, `Buzz fields in a Discover response: ${hits.join(', ')}`).toEqual([]);
}

const ids = (list: Suggestion[]): string[] => list.map((s) => s.user.id);

describe('discover — home suggestions', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ slices: ['discover'], seed: 'all' });
  });

  it('runs with every other slice table absent (isolation)', () => {
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toContain('discover_dismissals');
    for (const other of ['reels', 'buzzes', 'orbit_posts', 'market_listings', 'roommate_listings', 'events']) {
      expect(tables).not.toContain(other);
    }
  });

  it('returns the three sections with a reason on every card and never a Buzz field', async () => {
    const res = await ctx.as('mayachen').get('/api/discover/home');
    expect(res.status).toBe(200);
    const home = res.body as DiscoverHome;
    expect(Array.isArray(home.peopleYouMayKnow)).toBe(true);
    expect(Array.isArray(home.activeCreators)).toBe(true);
    expect(Array.isArray(home.popularOrgs)).toBe(true);
    expect(typeof home.isEarlyCampus).toBe('boolean');
    expect(home.peopleYouMayKnow.length).toBeLessThanOrEqual(12);
    expect(home.activeCreators.length).toBeLessThanOrEqual(10);
    expect(home.popularOrgs.length).toBeLessThanOrEqual(10);
    for (const s of [...home.peopleYouMayKnow, ...home.activeCreators, ...home.popularOrgs]) {
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.user.viewer.isFollowing).toBe(false);
      expect(s.user.viewer.isSelf).toBe(false);
    }
    for (const s of home.peopleYouMayKnow) expect(s.section).toBe('people_you_may_know');
    for (const s of home.popularOrgs) expect(s.section).toBe('popular_orgs');
    assertNoBuzzFields(home);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("Maya's PYMK is same-campus students she does not follow, and skips the 3 seeded dismissals", async () => {
    const home = (await ctx.as('mayachen').get('/api/discover/home')).body as DiscoverHome;
    const pymk = ids(home.peopleYouMayKnow);
    expect(pymk.length).toBeGreaterThan(0);
    // §7.5: the seed dismissed calebt / chloedub / ryanoc for Maya
    const dismissed = (ctx.db.prepare("SELECT target_id FROM discover_dismissals WHERE user_id = 'u_mayachen'").all() as { target_id: string }[]).map((r) => r.target_id);
    expect(dismissed.sort()).toEqual(['u_calebt', 'u_chloedub', 'u_ryanoc']);
    for (const d of dismissed) expect(pymk).not.toContain(d);
    // followed accounts never suggested
    const followed = (ctx.db.prepare("SELECT followee_id FROM follows WHERE follower_id = 'u_mayachen'").all() as { followee_id: string }[]).map((r) => r.followee_id);
    for (const f of followed) expect(pymk).not.toContain(f);
    for (const s of home.peopleYouMayKnow) {
      expect(s.user.universityId).toBe('uni_utexas');
      expect(s.user.accountType).toBe('student');
    }
    // §7.5 named candidates: fatima_as shares Maya's class year
    expect(pymk).toContain('u_fatima_as');
  });

  it('PYMK reasons derive from real rows (major / class year / mutuals)', async () => {
    const home = (await ctx.as('mayachen').get('/api/discover/home')).body as DiscoverHome;
    const maya = ctx.db.prepare("SELECT major, class_year FROM users WHERE id = 'u_mayachen'").get() as { major: string; class_year: number };
    for (const s of home.peopleYouMayKnow) {
      const row = ctx.db.prepare('SELECT major, class_year FROM users WHERE id = ?').get(s.user.id) as { major: string | null; class_year: number | null };
      const mutuals = (
        ctx.db
          .prepare(
            `SELECT COUNT(*) AS n FROM follows mine JOIN follows theirs ON theirs.follower_id = mine.followee_id AND theirs.followee_id = ?
              WHERE mine.follower_id = 'u_mayachen'`,
          )
          .get(s.user.id) as { n: number }
      ).n;
      const sameMajor = !!row.major && row.major.toLowerCase() === maya.major.toLowerCase();
      const sameYear = row.class_year === maya.class_year;
      expect(sameMajor || sameYear || mutuals >= 1).toBe(true);
      if (mutuals >= 1) expect(s.reason).toMatch(new RegExp(`${mutuals} mutual`));
      else if (sameMajor) expect(s.reason).toBe('CS');
      else expect(s.reason).toBe(`Class of ${maya.class_year}`);
      if (mutuals === 0) expect(s.reason).not.toMatch(/mutual/);
    }
    // ranked by mutuals descending
    const counts = home.peopleYouMayKnow.map((s) => {
      const m = s.reason.match(/(\d+) mutual/);
      return m ? Number(m[1]) : 0;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]!);
  });

  it('PYMK gate, rank and reason share one mutual definition (active, unblocked mutuals only)', async () => {
    const m1 = ctx.createUser({ handle: 'mut_active_1' });
    const m2 = ctx.createUser({ handle: 'mut_active_2' });
    const m3 = ctx.createUser({ handle: 'mut_suspended_1' });
    const m4 = ctx.createUser({ handle: 'mut_suspended_2' });
    const m5 = ctx.createUser({ handle: 'mut_blocks_viewer' });
    const viewer = ctx.createUser({ handle: 'viewer_mutuals', follows: [m1.id, m2.id, m3.id, m4.id, m5.id] });
    // test users carry no major / class year, so the ONLY way into this viewer's PYMK is >= 1 mutual
    const strong = ctx.createUser({ handle: 'cand_two_real', followedBy: [m1.id, m2.id] }); // 2 real mutuals
    const inflated = ctx.createUser({ handle: 'cand_one_real', followedBy: [m1.id, m3.id, m4.id] }); // 3 raw edges, 1 real
    const viaSuspended = ctx.createUser({ handle: 'cand_via_suspended', followedBy: [m3.id] });
    const viaBlocked = ctx.createUser({ handle: 'cand_via_blocked', followedBy: [m5.id] });
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id IN (?, ?)").run(m3.id, m4.id);
    // a direct row keeps the viewer -> m5 follow edge in place (blockUser would also drop it), which is the case that matters
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(m5.id, viewer.id, now());

    const home = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    // strong (2 real) ranks above inflated (1 real, 3 raw); candidates whose only mutual is suspended / blocked are not admitted
    expect(ids(home.peopleYouMayKnow)).toEqual([strong.id, inflated.id]);
    expect(home.peopleYouMayKnow[0]!.reason).toBe('2 mutuals');
    expect(home.peopleYouMayKnow[1]!.reason).toBe('1 mutual');
    expect(ids(home.peopleYouMayKnow)).not.toContain(viaSuspended.id);
    expect(ids(home.peopleYouMayKnow)).not.toContain(viaBlocked.id);
    for (const s of home.peopleYouMayKnow) expect(s.reason).not.toBe('On your campus');
    ctx.db.prepare("UPDATE users SET status = 'active' WHERE id IN (?, ?)").run(m3.id, m4.id);
  });

  it('popular orgs are campus orgs the viewer does not follow, with a real follower count', async () => {
    const home = (await ctx.as('mayachen').get('/api/discover/home')).body as DiscoverHome;
    // Maya follows 9 of the 10 UT Austin orgs → exactly Climbing Club remains
    expect(ids(home.popularOrgs)).toEqual(['o_climbing_club']);
    const org = home.popularOrgs[0]!;
    const followers = (ctx.db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followee_id = 'o_climbing_club'").get() as { n: number }).n;
    expect(org.reason).toBe(`${followers} follower${followers === 1 ? '' : 's'} at UT Austin`);
    expect(org.user.accountType).toBe('org');
    // a fresh user with no follows sees the whole campus roster, sorted by follower_count
    const fresh = ctx.createUser({ handle: 'fresh_orgs' });
    const theirs = (await ctx.as(fresh.id).get('/api/discover/home')).body as DiscoverHome;
    expect(theirs.popularOrgs.length).toBe(10);
    const rows = theirs.popularOrgs.map((s) => (ctx.db.prepare('SELECT follower_count AS n FROM users WHERE id = ?').get(s.user.id) as { n: number }).n);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]).toBeGreaterThanOrEqual(rows[i]!);
    for (const s of theirs.popularOrgs) expect(s.user.universityId).toBe('uni_utexas');
  });

  it('active creators come from public_activity in the last 14 days with a "this week" reason, campus first', async () => {
    const viewer = ctx.createUser({ handle: 'viewer_ac' });
    const before = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(before.activeCreators).toEqual([]);

    const at = now();
    markPublicActivity('u_noahg', 'reel', 'reel_test_1', at - 2 * DAY);
    markPublicActivity('u_noahg', 'reel', 'reel_test_2', at - 3 * DAY);
    markPublicActivity('u_noahg', 'reel', 'reel_test_3', at - 4 * DAY);
    markPublicActivity('u_aaliyah_w', 'post', 'post_test_1', at - 10 * DAY); // older than a week, inside 14 d
    markPublicActivity('u_kaiyama', 'reel', 'reel_test_4', at - 1 * DAY); // Stanford → after campus rows
    markPublicActivity('u_hanasato', 'post', 'post_test_old', at - 20 * DAY); // outside the window

    const home = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    const list = ids(home.activeCreators);
    expect(list.slice(0, 2)).toEqual(['u_noahg', 'u_aaliyah_w']);
    expect(list).toContain('u_kaiyama');
    expect(list.indexOf('u_kaiyama')).toBeGreaterThan(list.indexOf('u_aaliyah_w'));
    expect(list).not.toContain('u_hanasato');
    const noah = home.activeCreators.find((s) => s.user.id === 'u_noahg')!;
    expect(noah.reason).toBe('3 reels this week');
    const aaliyah = home.activeCreators.find((s) => s.user.id === 'u_aaliyah_w')!;
    expect(aaliyah.reason).toBe('1 post in the last 2 weeks');
    for (const s of home.activeCreators) expect(s.section).toBe('active_creators');

    // following the creator removes them; a minor is never suggested cross-campus
    await ctx.as(viewer.id).post('/api/users/u_noahg/follow');
    ctx.db.prepare("UPDATE users SET is_adult = 0 WHERE id = 'u_kaiyama'").run();
    const after = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(after.activeCreators)).not.toContain('u_noahg');
    expect(ids(after.activeCreators)).not.toContain('u_kaiyama');
    ctx.db.prepare("UPDATE users SET is_adult = 1 WHERE id = 'u_kaiyama'").run();
  });

  it('excludes blocked accounts in both directions and dismissed ones per section', async () => {
    const viewer = ctx.createUser({ handle: 'viewer_blk' });
    const home = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    const first = home.popularOrgs[0]!.user.id;
    // dismiss → gone from that section
    const dismiss = await ctx.as(viewer.id).post('/api/discover/dismiss').send({ userId: first, section: 'popular_orgs' });
    expect(dismiss.status).toBe(204);
    const afterDismiss = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(afterDismiss.popularOrgs)).not.toContain(first);
    // idempotent repeat
    expect((await ctx.as(viewer.id).post('/api/discover/dismiss').send({ userId: first, section: 'popular_orgs' })).status).toBe(204);

    // viewer blocks an org → gone
    const second = afterDismiss.popularOrgs[0]!.user.id;
    await ctx.as(viewer.id).post(`/api/users/${second}/block`);
    const afterBlock = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(afterBlock.popularOrgs)).not.toContain(second);

    // a student who blocked the viewer never shows up in PYMK (3 mutuals → ranked first)
    const peer = ctx.createUser({ handle: 'peer_blocks_viewer', followedBy: ['u_mayachen', 'u_arjunp', 'u_noahg'] });
    const viewer2 = ctx.createUser({ handle: 'viewer_blocked', follows: ['u_mayachen', 'u_arjunp', 'u_noahg'] });
    const pre = (await ctx.as(viewer2.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(pre.peopleYouMayKnow)).toContain(peer.id);
    expect(pre.peopleYouMayKnow.find((s) => s.user.id === peer.id)!.reason).toBe('3 mutuals');
    await ctx.as(peer.id).post(`/api/users/${viewer2.id}/block`);
    const post = (await ctx.as(viewer2.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(post.peopleYouMayKnow)).not.toContain(peer.id);
  });

  it('suspended users and hidden-university (uni_team) users are never suggested', async () => {
    const viewer = ctx.createUser({ handle: 'viewer_hidden', follows: ['u_arjunp'] });
    ctx.db.prepare("UPDATE users SET major = 'Computer Science' WHERE id = ?").run(viewer.id);
    const suspended = ctx.createUser({ handle: 'susp_cs', follows: ['u_mayachen'], followedBy: ['u_arjunp'] });
    ctx.db.prepare("UPDATE users SET major = 'Computer Science' WHERE id = ?").run(suspended.id);
    ensureTeamUniversity();
    const staff = ctx.createUser({ handle: 'team_cs', universityId: 'uni_team', followedBy: ['u_arjunp'] });
    ctx.db.prepare("UPDATE users SET major = 'Computer Science' WHERE id = ?").run(staff.id);

    const before = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(before.peopleYouMayKnow)).toContain(suspended.id);
    expect(ids(before.peopleYouMayKnow)).not.toContain(staff.id);

    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(suspended.id);
    const after = (await ctx.as(viewer.id).get('/api/discover/home')).body as DiscoverHome;
    expect(ids(after.peopleYouMayKnow)).not.toContain(suspended.id);
    ctx.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(suspended.id);
  });

  it('dismiss validates its body and 404s an unknown user', async () => {
    const bad = await ctx.as('mayachen').post('/api/discover/dismiss').send({ userId: 'u_bellarossi', section: 'trending' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    const missing = await ctx.as('mayachen').post('/api/discover/dismiss').send({ userId: 'nope', section: 'people_you_may_know' });
    expect(missing.status).toBe(404);
    const self = await ctx.as('mayachen').post('/api/discover/dismiss').send({ userId: 'u_mayachen', section: 'people_you_may_know' });
    expect(self.status).toBe(400);
  });

  it('requires a session on every endpoint', async () => {
    expect((await ctx.anon().get('/api/discover/home')).status).toBe(401);
    expect((await ctx.anon().get('/api/discover/search?q=maya')).status).toBe(401);
    expect((await ctx.anon().post('/api/discover/dismiss').send({ userId: 'u_bellarossi', section: 'people_you_may_know' })).status).toBe(401);
  });
});

describe('discover — search', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ slices: ['discover'] });
  });

  const search = (as: string, q: Record<string, string | number>) => ctx.as(as).get('/api/discover/search').query(q);

  it('returns one Paginated<SearchHit> with matched + sameCampus and no Buzz fields', async () => {
    const res = await search('mayachen', { q: 'Ram' });
    expect(res.status).toBe(200);
    const body = res.body as Paginated<SearchHit>;
    expect(Array.isArray(body.items)).toBe(true);
    expect('nextCursor' in body).toBe(true);
    expect(body.items.map((h) => h.user.handle)).toContain('sofiaram');
    const sofia = body.items.find((h) => h.user.handle === 'sofiaram')!;
    expect(sofia.matched).toBe('name');
    expect(sofia.sameCampus).toBe(true);
    for (const h of body.items) {
      expect(['name', 'handle', 'major']).toContain(h.matched);
      expect(typeof h.sameCampus).toBe('boolean');
    }
    assertNoBuzzFields(body);
  });

  it('matches handle, name and major; an empty query returns nothing without touching the DB', async () => {
    const byHandle = (await search('mayachen', { q: '@noahg' })).body as Paginated<SearchHit>;
    expect(byHandle.items[0]?.user.handle).toBe('noahg');
    expect(byHandle.items[0]?.matched).toBe('handle');
    const byMajor = (await search('mayachen', { q: 'Nursing' })).body as Paginated<SearchHit>;
    expect(byMajor.items.some((h) => h.user.handle === 'sofiaram' && h.matched === 'major')).toBe(true);
    const empty = (await search('mayachen', { q: '   ' })).body as Paginated<SearchHit>;
    expect(empty).toEqual({ items: [], nextCursor: null });
  });

  it('orders campus-first across page boundaries with an opaque keyset cursor', async () => {
    // "a" hits many users on every campus at lite scale
    const all: SearchHit[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: Record<string, string | number> = { q: 'a', limit: 5 };
      if (cursor) q.cursor = cursor;
      const res = await search('mayachen', q);
      expect(res.status).toBe(200);
      const body = res.body as Paginated<SearchHit>;
      all.push(...body.items);
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 80);
    expect(pages).toBeGreaterThan(2);
    // every UT Austin hit precedes every other-campus hit, across pages
    const firstOther = all.findIndex((h) => !h.sameCampus);
    expect(firstOther).toBeGreaterThan(0);
    for (let i = firstOther; i < all.length; i++) expect(all[i]!.sameCampus).toBe(false);
    for (let i = 0; i < firstOther; i++) expect(all[i]!.user.universityId).toBe('uni_utexas');
    // no duplicates, no gaps
    const idsSeen = all.map((h) => h.user.id);
    expect(new Set(idsSeen).size).toBe(idsSeen.length);
    const total = (await search('mayachen', { q: 'a', limit: 50 })).body as Paginated<SearchHit>;
    for (const h of total.items) expect(idsSeen).toContain(h.user.id);
    // tampered cursor → 400
    const tampered = await search('mayachen', { q: 'a', cursor: `${cursor ?? 'abc'}x` });
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.code).toBe('invalid_cursor');
  });

  it('filters by type and validates the query', async () => {
    const orgs = (await search('mayachen', { q: 'club', type: 'orgs' })).body as Paginated<SearchHit>;
    expect(orgs.items.length).toBeGreaterThan(0);
    for (const h of orgs.items) expect(h.user.accountType).toBe('org');
    const people = (await search('mayachen', { q: 'a', type: 'people', limit: 50 })).body as Paginated<SearchHit>;
    for (const h of people.items) expect(h.user.accountType).toBe('student');
    const bad = await search('mayachen', { q: 'a', type: 'robots' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    const tooBig = await search('mayachen', { q: 'a', limit: 500 });
    expect(tooBig.status).toBe(400);
  });

  it('never returns blocked (either way), suspended or hidden-university users', async () => {
    const viewer = ctx.createUser({ handle: 'searcher', displayName: 'Search Er' });
    const blockedByMe = ctx.createUser({ handle: 'zz_blocked_by_me', displayName: 'Zz Blocked' });
    const blockedMe = ctx.createUser({ handle: 'zz_blocked_me', displayName: 'Zz Blocker' });
    const suspended = ctx.createUser({ handle: 'zz_suspended', displayName: 'Zz Suspended' });
    ensureTeamUniversity();
    const staff = ctx.createUser({ handle: 'zz_team', displayName: 'Zz Team', universityId: 'uni_team' });
    const visible = ctx.createUser({ handle: 'zz_visible', displayName: 'Zz Visible' });

    const before = (await search(viewer.id, { q: 'zz_' })).body as Paginated<SearchHit>;
    const handles = before.items.map((h) => h.user.handle);
    expect(handles).toEqual(expect.arrayContaining(['zz_blocked_by_me', 'zz_blocked_me', 'zz_suspended', 'zz_visible']));
    expect(handles).not.toContain('zz_team');

    await ctx.as(viewer.id).post(`/api/users/${blockedByMe.id}/block`);
    await ctx.as(blockedMe.id).post(`/api/users/${viewer.id}/block`);
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(suspended.id);

    const after = (await search(viewer.id, { q: 'zz_' })).body as Paginated<SearchHit>;
    const left = after.items.map((h) => h.user.handle);
    expect(left).toContain('zz_visible');
    expect(left).not.toContain('zz_blocked_by_me');
    expect(left).not.toContain('zz_blocked_me');
    expect(left).not.toContain('zz_suspended');
    expect(left).not.toContain('zz_team');
    expect(after.items.map((h) => h.user.id)).not.toContain(staff.id);
    expect(after.items.find((h) => h.user.id === visible.id)?.sameCampus).toBe(true);
  });

  it('never leaks another campus user through an @handle lookup of a blocked account', async () => {
    const viewer = ctx.createUser({ handle: 'searcher_two' });
    await ctx.as(viewer.id).post('/api/users/u_kaiyama/block');
    const res = (await search(viewer.id, { q: '@kaiyama' })).body as Paginated<SearchHit>;
    expect(res.items.map((h) => h.user.id)).not.toContain('u_kaiyama');
  });
});
