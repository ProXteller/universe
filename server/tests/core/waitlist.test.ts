/**
 * lib/waitlist.ts (SPEC §4.2.15) + routes #34–#35: idempotent join / leave, real campus + total counts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DAY, now } from '../../src/lib/clock';
import { createTestApp, type TestCtx } from '../../src/lib/testing';
import { joinWaitlist, leaveWaitlist, waitlistStateFor } from '../../src/lib/waitlist';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});

describe('waitlist lib', () => {
  it('joins idempotently, leaves by setting left_at, re-joins by clearing it; counts are real rows', () => {
    const me = ctx.createUser();
    const campusMate = ctx.createUser();
    const far = ctx.createUser({ universityId: 'uni_umich' });
    expect(waitlistStateFor(me.id, 'apartments')).toEqual({ feature: 'apartments', joined: false, joinedAt: null, campusCount: 0, totalCount: 0 });
    const at = now() - 2 * DAY;
    joinWaitlist(me.id, 'apartments', { source: 'nav', at });
    joinWaitlist(me.id, 'apartments', { source: 'link' }); // idempotent: keeps the first row
    joinWaitlist(campusMate.id, 'apartments');
    joinWaitlist(far.id, 'apartments');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE feature = 'apartments'").get()).toEqual({ n: 3 });
    expect(ctx.db.prepare('SELECT source, university_id FROM waitlist WHERE user_id = ?').get(me.id)).toEqual({ source: 'nav', university_id: 'uni_utexas' });
    expect(waitlistStateFor(me.id, 'apartments')).toEqual({ feature: 'apartments', joined: true, joinedAt: at, campusCount: 2, totalCount: 3 });
    expect(waitlistStateFor(far.id, 'apartments')).toMatchObject({ joined: true, campusCount: 1, totalCount: 3 });

    leaveWaitlist(me.id, 'apartments');
    leaveWaitlist(me.id, 'apartments');
    expect(ctx.db.prepare('SELECT left_at FROM waitlist WHERE user_id = ?').get(me.id)).toEqual({ left_at: expect.any(Number) });
    expect(waitlistStateFor(me.id, 'apartments')).toMatchObject({ joined: false, joinedAt: null, campusCount: 1, totalCount: 2 });
    leaveWaitlist(ctx.createUser().id, 'apartments'); // never joined: no-op

    joinWaitlist(me.id, 'apartments', { source: 'campus' });
    const row = ctx.db.prepare('SELECT left_at, source, created_at FROM waitlist WHERE user_id = ?').get(me.id) as { left_at: number | null; source: string; created_at: number };
    expect(row.left_at).toBeNull();
    expect(row.source).toBe('campus');
    expect(row.created_at).toBeGreaterThan(at);
    expect(waitlistStateFor(me.id, 'apartments')).toMatchObject({ joined: true, joinedAt: row.created_at, campusCount: 2, totalCount: 3 });
  });

  it('hidden universities never count towards totalCount', () => {
    ctx.db.prepare("INSERT INTO universities (id, name, short_name, domain, is_hidden, created_at) VALUES ('uni_team','UniVerse Team','Team','team.universe.invalid',1,?)").run(now());
    const staff = ctx.createUser({ universityId: 'uni_team' });
    const me = ctx.createUser();
    joinWaitlist(staff.id, 'apartments');
    joinWaitlist(me.id, 'apartments');
    expect(waitlistStateFor(me.id, 'apartments')).toMatchObject({ campusCount: 1, totalCount: 1 });
    expect(waitlistStateFor(staff.id, 'apartments')).toMatchObject({ joined: true, campusCount: 1, totalCount: 1 });
  });
});

describe('routes #34–#35', () => {
  it('GET / POST / DELETE /waitlist/:feature answer WaitlistState; unknown features are 400', async () => {
    const me = ctx.createUser();
    const agent = ctx.as(me.id);
    const empty = await agent.get('/api/waitlist/apartments');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ feature: 'apartments', joined: false, joinedAt: null, campusCount: 0, totalCount: 0 });
    const joined = await agent.post('/api/waitlist/apartments').send({ source: 'nav' });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ joined: true, joinedAt: expect.any(Number), campusCount: 1, totalCount: 1 });
    expect((await agent.post('/api/waitlist/apartments').send({})).body).toEqual(joined.body);
    const left = await agent.delete('/api/waitlist/apartments');
    expect(left.status).toBe(200);
    expect(left.body).toMatchObject({ joined: false, joinedAt: null, campusCount: 0, totalCount: 0 });
    expect((await agent.get('/api/waitlist/parking')).status).toBe(400);
    expect((await ctx.anon().get('/api/waitlist/apartments')).status).toBe(401);
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL WHERE id = ?').run(fresh.id);
    expect((await ctx.as(fresh.id).post('/api/waitlist/apartments').send({})).status).toBe(403);
  });
});
