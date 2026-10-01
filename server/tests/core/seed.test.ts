import { beforeEach, describe, expect, it } from 'vitest';
import { GUIDELINES_VERSION } from '@shared/core';
import { DAY, HOUR, now } from '../../src/lib/clock';
import { createTestApp, type TestCtx } from '../../src/lib/testing';
import { DEMO, ORG, STAFF, U, UNI } from '../../src/db/seeds/ids';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});

const n = (sql: string, ...params: unknown[]): number => (ctx.db.prepare(sql).get(...params) as { n: number }).n;

describe('core seed at lite scale (SPEC §7)', () => {
  it('creates the eleven campuses, 40 personas, 12 orgs, 3 staff and the lite background users', () => {
    expect(n('SELECT COUNT(*) AS n FROM universities')).toBe(11);
    for (const id of Object.values(UNI)) expect(ctx.db.prepare('SELECT id FROM universities WHERE id = ?').get(id)).toBeTruthy();
    expect(n("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'u\\_%' ESCAPE '\\' AND role = 'user'")).toBe(40);
    for (const id of Object.values(U)) expect(ctx.db.prepare('SELECT id FROM users WHERE id = ?').get(id), id).toBeTruthy();
    expect(n("SELECT COUNT(*) AS n FROM users WHERE account_type = 'org'")).toBe(12);
    for (const id of Object.values(ORG)) expect(ctx.db.prepare("SELECT id FROM users WHERE id = ? AND account_type = 'org'").get(id), id).toBeTruthy();
    expect(ctx.db.prepare('SELECT role FROM users WHERE id = ?').get(STAFF.dana_w)).toEqual({ role: 'admin' });
    expect(ctx.db.prepare('SELECT role FROM users WHERE id = ?').get(STAFF.victor_o)).toEqual({ role: 'admin' });
    expect(ctx.db.prepare('SELECT role FROM users WHERE id = ?').get(STAFF.rileyshaw)).toEqual({ role: 'moderator' });
    expect(ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(DEMO.admin)).toEqual({ email: 'admin@utexas.edu' });
    expect(ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(DEMO.student)).toEqual({ email: 'maya.chen@utexas.edu' });
    // lite: 40 bg at the hero campus, 5 per medium campus, 0–1 at the small ones
    expect(n("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'bg\\_%' ESCAPE '\\' AND university_id = 'uni_utexas'")).toBe(40);
    for (const u of ['uni_umich', 'uni_stanford', 'uni_nyu']) expect(n("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'bg\\_%' ESCAPE '\\' AND university_id = ?", u)).toBe(5);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'bg\\_%' ESCAPE '\\'")).toBe(40 + 15 + 6);
    expect(n('SELECT COUNT(*) AS n FROM users')).toBe(40 + 12 + 3 + 61);
    // campus places: UT 16, generic 5 elsewhere
    expect(n("SELECT COUNT(*) AS n FROM campus_places WHERE university_id = 'uni_utexas'")).toBe(16);
    expect(n('SELECT COUNT(*) AS n FROM campus_places')).toBe(16 + 10 * 5);
  });

  it('honours the demo-user invariants of §7.5 that core owns', () => {
    const maya = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(U.mayachen) as any;
    expect(maya.following_count).toBe(28);
    expect(maya.follower_count).toBe(41);
    expect(maya.invite_code).toBe('MAYA2026');
    expect(n("SELECT COUNT(*) AS n FROM users WHERE invited_by = ?", U.mayachen)).toBe(4);
    for (const bg of ['bg_0001', 'bg_0002', 'bg_0003', 'bg_0004']) expect(ctx.db.prepare('SELECT invited_by FROM users WHERE id = ?').get(bg)).toEqual({ invited_by: U.mayachen });
    const follows = (ctx.db.prepare('SELECT followee_id AS id FROM follows WHERE follower_id = ?').all(U.mayachen) as { id: string }[]).map((r) => r.id);
    for (const o of ['wic_ut', 'solarcar', 'events_board', 'campusdaily', 'clubsoccer', 'isa_ut', 'premed_society', 'filmsociety', 'hacknight']) expect(follows, o).toContain(ORG[o as keyof typeof ORG]);
    for (const p of ['jordan_builds', 'andresilva', 'ninakow', 'kaiyama', 'rafacruz']) expect(follows, p).toContain(U[p as keyof typeof U]);
    expect(follows).not.toContain(U.bencarter);
    expect(follows).not.toContain(U.owenpark);
    expect(follows).not.toContain(U.samirk);
    expect(follows).not.toContain(U.chloedub);
    expect(follows).not.toContain(U.bellarossi);
    for (const h of ['bencarter', 'owenpark', 'samirk', 'ethan_ng']) {
      expect(ctx.db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(U[h as keyof typeof U], U.mayachen), h).toBeTruthy();
    }
    expect(ctx.db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(U.chloedub, U.mayachen)).toBeUndefined();
    expect(ctx.db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(U.bellarossi, U.mayachen)).toBeUndefined();
  });

  it('keeps every counter equal to its rows and every persona onboarded', () => {
    expect(
      n(`SELECT COUNT(*) AS n FROM users u WHERE u.follower_count != (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id)
          OR u.following_count != (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id)`),
    ).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE guidelines_version != ? OR buzz_gate_version != ? OR profile_completed_at IS NULL OR onboarding_completed_at IS NULL", GUIDELINES_VERSION, GUIDELINES_VERSION)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE status != 'active'")).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM users WHERE campus_rank <= 0')).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE campus_rank <= 100 AND university_id = 'uni_utexas'")).toBeGreaterThanOrEqual(55);
    expect(n('SELECT COUNT(*) AS n FROM follows WHERE follower_id = followee_id')).toBe(0);
    // follow edges never predate either account
    expect(n('SELECT COUNT(*) AS n FROM follows f JOIN users a ON a.id = f.follower_id JOIN users b ON b.id = f.followee_id WHERE f.created_at < a.created_at OR f.created_at < b.created_at')).toBe(0);
  });

  it('models the special personas: graceade (2 d, minor) and leofischer (10 h)', () => {
    const grace = ctx.db.prepare('SELECT is_adult, created_at FROM users WHERE id = ?').get(U.graceade) as any;
    expect(grace.is_adult).toBe(0);
    expect(now() - grace.created_at).toBeGreaterThan(1.9 * DAY);
    expect(now() - grace.created_at).toBeLessThan(3 * DAY);
    const leo = ctx.db.prepare('SELECT created_at FROM users WHERE id = ?').get(U.leofischer) as any;
    expect(now() - leo.created_at).toBeGreaterThanOrEqual(10 * HOUR);
    expect(now() - leo.created_at).toBeLessThan(11 * HOUR);
    expect(n("SELECT COUNT(*) AS n FROM users WHERE is_adult = 0")).toBe(1);
    // every other persona is 30–400 days old
    expect(n("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'u\\_%' ESCAPE '\\' AND id NOT IN (?, ?) AND (created_at > ? OR created_at < ?)", U.graceade, U.leofischer, now() - 30 * DAY, now() - 401 * DAY)).toBe(0);
    // org follower counts scale but keep their order at the top
    const wic = ctx.db.prepare('SELECT follower_count FROM users WHERE id = ?').get(ORG.wic_ut) as any;
    const climbing = ctx.db.prepare('SELECT follower_count FROM users WHERE id = ?').get(ORG.climbing_club) as any;
    expect(wic.follower_count).toBeGreaterThan(climbing.follower_count);
    expect(ctx.db.prepare('SELECT is_verified FROM users WHERE id = ?').get(ORG.wic_ut)).toEqual({ is_verified: 1 });
    expect(ctx.db.prepare('SELECT is_verified FROM users WHERE id = ?').get(ORG.solarcar)).toEqual({ is_verified: 0 });
  });

  it('is deterministic across runs', async () => {
    const digest = (): string =>
      JSON.stringify([
        ctx.db.prepare('SELECT id, handle, email, major, class_year, bio, interests_json, campus_rank FROM users ORDER BY id').all(),
        ctx.db.prepare('SELECT follower_id, followee_id FROM follows ORDER BY follower_id, followee_id').all(),
      ]);
    const first = digest();
    ctx = await createTestApp({ slices: [] });
    expect(digest()).toBe(first);
  });

  it('seeds the whole world through /me for the demo student', async () => {
    const me = await ctx.as('mayachen').get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      id: U.mayachen, handle: 'mayachen', displayName: 'Maya Chen', major: 'Computer Science', classKind: 'undergrad',
      followerCount: 41, followingCount: 28, inviteCode: 'MAYA2026', role: 'user', currency: 'USD', isFoundingMember: true,
      onboarding: { profileCompleted: true, guidelinesAccepted: true, completed: true },
      guidelinesAcceptedVersion: GUIDELINES_VERSION, buzzGateAcceptedVersion: GUIDELINES_VERSION, activeSanction: null,
    });
    expect(me.body.university).toEqual({ id: 'uni_utexas', name: 'The University of Texas at Austin', shortName: 'UT Austin' });
    const admin = await ctx.as(DEMO.admin).get('/api/me');
    expect(admin.body.role).toBe('admin');
  });
});
