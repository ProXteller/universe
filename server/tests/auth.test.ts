/**
 * `auth` slice tests (SPEC §5.1) — isolation mode: `createTestApp({ slices: ['auth'] })`.
 * Endpoints under test: GET /api/onboarding/suggestions, POST /api/onboarding/follow-many.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OnboardingSuggestions } from '../../shared/src/auth';
import { DAY, now } from '../src/lib/clock';
import { markPublicActivity } from '../src/lib/users';
import { createTestApp, type TestCtx } from '../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: ['auth'] });
});
afterEach(() => {
  delete process.env.RATE_LIMITS;
});

const allRows = (s: OnboardingSuggestions) => [...(s.inviter ? [s.inviter] : []), ...s.sections.flatMap((x) => x.rows)];
const allIds = (s: OnboardingSuggestions) => allRows(s).map((r) => r.user.id);
const section = (s: OnboardingSuggestions, id: string) => s.sections.find((x) => x.id === id);

/** A freshly signed-up UT Austin student who has NOT finished onboarding (profile done, guidelines not accepted). */
function freshStudent(o: Parameters<TestCtx['createUser']>[0] = {}) {
  const user = ctx.createUser({ createdAt: now() - 60_000, ...o });
  ctx.db
    .prepare('UPDATE users SET guidelines_version = NULL, guidelines_accepted_at = NULL, onboarding_completed_at = NULL, major = ?, class_year = ?, class_kind = ? WHERE id = ?')
    .run(o.accountType === 'org' ? null : 'Computer Science', o.accountType === 'org' ? null : 2028, o.accountType === 'org' ? null : 'undergrad', user.id);
  return user;
}

describe('mount & auth', () => {
  it('boots in isolation mode with the core seed', async () => {
    const health = await ctx.anon().get('/api/health');
    expect(health.status).toBe(200);
    const me = await ctx.as('mayachen').get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe('mayachen');
  });

  it('401 for signed-out callers on both endpoints', async () => {
    expect((await ctx.anon().get('/api/onboarding/suggestions')).status).toBe(401);
    expect((await ctx.anon().post('/api/onboarding/follow-many').send({ userIds: ['u_mayachen'] })).status).toBe(401);
  });

  it('is reachable BEFORE onboarding is complete (requireAuth only, never requireOnboarded)', async () => {
    const fresh = freshStudent();
    const res = await ctx.as(fresh.id).get('/api/onboarding/suggestions');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    // The same session is still gated on an onboarded-only foundation route.
    expect((await ctx.as(fresh.id).get('/api/me/badges')).status).toBe(403);
  });

  it('validation: follow-many needs 1–10 ids', async () => {
    const fresh = freshStudent();
    const empty = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('validation_failed');
    const tooMany = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: Array.from({ length: 11 }, (_, i) => `x${i}`) });
    expect(tooMany.status).toBe(400);
    const wrongShape = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: 'u_mayachen' });
    expect(wrongShape.status).toBe(400);
  });
});

describe('GET /onboarding/suggestions', () => {
  it('returns the §5.1 shape with Popular orgs first, honest reason lines, and UserListItem rows', async () => {
    const fresh = freshStudent();
    const res = await ctx.as(fresh.id).get('/api/onboarding/suggestions');
    expect(res.status).toBe(200);
    const body = res.body as OnboardingSuggestions;
    expect(body.isNewCampus).toBe(false);
    expect(body.inviter).toBeNull();
    expect(body.sections.length).toBeGreaterThan(0);

    const orgs = section(body, 'popular_orgs');
    expect(orgs).toBeDefined();
    expect(orgs!.title).toBe('Popular at The University of Texas at Austin');
    expect(orgs!.rows.length).toBeGreaterThanOrEqual(5);
    expect(orgs!.rows.length).toBeLessThanOrEqual(8);
    for (const row of orgs!.rows) {
      expect(row.user.accountType).toBe('org');
      expect(row.user.universityId).toBe('uni_utexas');
      expect(row.reason).toMatch(/^Org · \d+ followers?$/);
      expect(row.tag).toBeNull();
      expect(row.user.viewer).toEqual({ isSelf: false, isFollowing: false, isFollowedBy: false });
      const n = Number(row.reason.match(/(\d+)/)![1]);
      const real = ctx.db.prepare('SELECT follower_count AS n FROM users WHERE id = ?').get(row.user.id) as { n: number };
      expect(n).toBe(real.n);
    }
    // ordered by follower_count desc
    const counts = orgs!.rows.map((r) => Number(r.reason.match(/(\d+)/)![1]));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);

    const major = section(body, 'in_major');
    expect(major).toBeDefined();
    expect(major!.title).toBe('In Computer Science');
    for (const row of major!.rows) {
      expect(row.user.major?.toLowerCase()).toBe('computer science');
      expect(row.user.accountType).toBe('student');
      expect(row.reason).toMatch(/^Same major/);
    }
    // the class-year fallback only appears when there is no major section
    expect(section(body, 'class_year')).toBeUndefined();

    // no duplicates across sections, never self
    const ids = allIds(body);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(fresh.id);
  });

  it('falls back to "Class of {year}" when nobody shares the major', async () => {
    const fresh = freshStudent();
    ctx.db.prepare("UPDATE users SET major = 'Xenolinguistics' WHERE id = ?").run(fresh.id);
    const body = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(section(body, 'in_major')).toBeUndefined();
    const year = section(body, 'class_year');
    expect(year).toBeDefined();
    expect(year!.title).toBe('Class of 2028');
    for (const row of year!.rows) {
      expect(row.user.classYear).toBe(2028);
      expect(row.reason).toMatch(/^Class of 2028/);
    }
  });

  it('excludes self, already-followed and blocked (both directions) accounts', async () => {
    const fresh = freshStudent();
    const first = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    const [a, b, c] = allIds(first);
    expect(a && b && c).toBeTruthy();
    // follow a, block b, get blocked by c
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(fresh.id, a, now());
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(fresh.id, b, now());
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(c, fresh.id, now());
    const { clearBlockCache } = await import('../src/lib/graph');
    clearBlockCache();
    const second = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    const ids = allIds(second);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
    // suspended accounts vanish too
    const [d] = ids;
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(d);
    const third = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(allIds(third)).not.toContain(d);
  });

  it('pins the inviter first, tagged invited_you, and keeps them pinned once followed', async () => {
    const fresh = freshStudent();
    ctx.db.prepare('UPDATE users SET invited_by = ? WHERE id = ?').run('u_mayachen', fresh.id);
    const body = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(body.inviter).not.toBeNull();
    expect(body.inviter!.user.id).toBe('u_mayachen');
    expect(body.inviter!.user.handle).toBe('mayachen');
    expect(body.inviter!.tag).toBe('invited_you');
    expect(body.inviter!.reason).toBe('Invited you · UT Austin');
    expect(body.inviter!.user.viewer.isFollowing).toBe(false);
    // never repeated inside a section
    for (const s of body.sections) expect(s.rows.map((r) => r.user.id)).not.toContain('u_mayachen');

    // after following: still pinned, now "Following"
    const fm = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: ['u_mayachen'] });
    expect(fm.status).toBe(200);
    expect(fm.body).toEqual({ followed: ['u_mayachen'] });
    const again = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(again.inviter!.user.id).toBe('u_mayachen');
    expect(again.inviter!.user.viewer.isFollowing).toBe(true);

    // a blocked inviter is not pinned
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run('u_mayachen', fresh.id, now());
    const { clearBlockCache } = await import('../src/lib/graph');
    clearBlockCache();
    const blocked = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(blocked.inviter).toBeNull();
  });

  it('new-campus variant: < 5 other users at the campus → isNewCampus + rows from other (non-hidden) campuses', async () => {
    const fresh = freshStudent({ universityId: 'uni_ethz' });
    const body = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(body.isNewCampus).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    const orgs = section(body, 'popular_orgs');
    expect(orgs).toBeDefined();
    expect(orgs!.title).toBe('Popular orgs on other campuses');
    const campuses = new Set(allRows(body).map((r) => r.user.universityId));
    expect(campuses.has('uni_utexas')).toBe(true);
    expect(campuses.has('uni_team')).toBe(false);
    expect(allIds(body)).not.toContain(fresh.id);
  });

  it('"Active on campus" comes only from public_activity (markPublicActivity) with an honest reason line', async () => {
    const fresh = freshStudent();
    const before = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(section(before, 'active')).toBeUndefined();

    markPublicActivity('u_noahg', 'reel', 'reel_test_1', now() - DAY);
    markPublicActivity('u_noahg', 'reel', 'reel_test_2', now() - 2 * DAY);
    markPublicActivity('u_aaliyah_w', 'post', 'post_test_1', now() - 3 * DAY);
    markPublicActivity('u_kaiyama', 'reel', 'reel_test_3', now() - DAY); // Stanford: not on this campus
    markPublicActivity('u_diegoh', 'event', 'event_old', now() - 40 * DAY); // outside the 14-day window

    const after = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    const active = section(after, 'active');
    expect(active).toBeDefined();
    expect(active!.title).toBe('Active on campus');
    const byId = new Map(active!.rows.map((r) => [r.user.id, r]));
    expect(byId.get('u_noahg')?.reason).toBe('Radio-TV-Film · 2 reels this month');
    expect(byId.get('u_aaliyah_w')?.reason).toBe('Journalism · 1 post this month');
    expect(byId.has('u_kaiyama')).toBe(false);
    expect(byId.has('u_diegoh')).toBe(false);
    // newest activity first
    expect(active!.rows[0]!.user.id).toBe('u_noahg');
  });

  it('org viewers get no major / class-year section', async () => {
    const org = freshStudent({ accountType: 'org' });
    const body = (await ctx.as(org.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(section(body, 'in_major')).toBeUndefined();
    expect(section(body, 'class_year')).toBeUndefined();
    expect(section(body, 'popular_orgs')).toBeDefined();
  });

  it('is identical with every slice table empty (no slice-derived input) and leaks no private fields', async () => {
    const fresh = freshStudent();
    const first = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    // The auth slice has no tables; the isolation DB holds ONLY core tables. Assert that, then assert determinism.
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) expect(t).not.toMatch(/^(reels|buzz|posts|listings|roommate|events|courses|admin_)/);
    const second = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    expect(second).toEqual(first);
    const text = JSON.stringify(first);
    expect(text).not.toMatch(/"email"|"settings"|"role"|"status"|"inviteCode"/);
  });
});

describe('POST /onboarding/follow-many', () => {
  it('follows up to 10 ids, is idempotent, skips self / blocked / missing, and keeps counters real', async () => {
    const fresh = freshStudent();
    const sugg = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    const orgs = section(sugg, 'popular_orgs')!.rows.map((r) => r.user.id).slice(0, 5);
    const blockedId = 'u_ryanoc';
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(fresh.id, blockedId, now());
    const { clearBlockCache } = await import('../src/lib/graph');
    clearBlockCache();

    const before = orgs.map((id) => (ctx.db.prepare('SELECT follower_count AS n FROM users WHERE id = ?').get(id) as { n: number }).n);
    const res = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: [...orgs, fresh.id, blockedId, 'nope_missing', orgs[0]] });
    expect(res.status).toBe(200);
    expect(res.body.followed).toEqual(orgs);

    for (let i = 0; i < orgs.length; i++) {
      const after = (ctx.db.prepare('SELECT follower_count AS n FROM users WHERE id = ?').get(orgs[i]) as { n: number }).n;
      const rows = (ctx.db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(orgs[i]) as { n: number }).n;
      expect(after).toBe(before[i]! + 1);
      expect(after).toBe(rows);
    }
    const following = (ctx.db.prepare('SELECT following_count AS n FROM users WHERE id = ?').get(fresh.id) as { n: number }).n;
    expect(following).toBe(orgs.length);
    expect(ctx.db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(fresh.id, blockedId)).toBeUndefined();

    // idempotent: already-followed ids are still reported as followed, no double counting
    const again = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: orgs });
    expect(again.body.followed).toEqual(orgs);
    expect((ctx.db.prepare('SELECT following_count AS n FROM users WHERE id = ?').get(fresh.id) as { n: number }).n).toBe(orgs.length);

    // followed accounts leave the suggestions
    const next = (await ctx.as(fresh.id).get('/api/onboarding/suggestions')).body as OnboardingSuggestions;
    for (const id of orgs) expect(allIds(next)).not.toContain(id);
  });

  it('respects the follow rate limit (429 when nothing could be followed)', async () => {
    process.env.RATE_LIMITS = 'on';
    const fresh = freshStudent(); // 1-minute-old account → new-account column (30 / hour)
    const at = now();
    const ins = ctx.db.prepare('INSERT INTO rate_events (user_id, action, created_at) VALUES (?,?,?)');
    for (let i = 0; i < 30; i++) ins.run(fresh.id, 'follow', at - 1000 - i);
    const res = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: ['o_wic_ut', 'o_solarcar'] });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(fresh.id)).toEqual({ n: 0 });
  });

  it('returns the partial list when the limit trips mid-loop', async () => {
    process.env.RATE_LIMITS = 'on';
    const fresh = freshStudent();
    const at = now();
    const ins = ctx.db.prepare('INSERT INTO rate_events (user_id, action, created_at) VALUES (?,?,?)');
    for (let i = 0; i < 29; i++) ins.run(fresh.id, 'follow', at - 1000 - i); // one follow left in the window
    const res = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: ['o_wic_ut', 'o_solarcar', 'o_hacknight'] });
    expect(res.status).toBe(200);
    expect(res.body.followed).toEqual(['o_wic_ut']);
  });

  it('follow-many produces the follow.new notification through the foundation helper (no invented side effects)', async () => {
    const fresh = freshStudent();
    const res = await ctx.as(fresh.id).post('/api/onboarding/follow-many').send({ userIds: ['u_bellarossi'] });
    expect(res.status).toBe(200);
    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_bellarossi' AND actor_id = ? AND type = 'follow.new'").get(fresh.id) as { n: number };
    expect(n.n).toBe(1);
  });
});
