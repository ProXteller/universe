/**
 * `roommates` slice tests (SPEC §5.7) — isolation mode only.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RoommateAnswers, UpsertRoommateProfileRequest } from '@shared/roommates';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import { DAY, HOUR, now, setNow } from '../src/lib/clock';
import { resolveCard } from '../src/lib/content';
import { applySanction } from '../src/lib/moderation/staff';
import { badgesFor } from '../src/lib/notify';
import { archetypeOf, computeCompatibility, tagsOf } from '../src/services/roommates/compat';
import { runStillLookingHook } from '../src/services/roommates/registry';

const A = (sleep: number, clean: number, noise: number, guests: number, hosting: number, smoking: number, pets: number, sharing: number): RoommateAnswers =>
  ({ sleep, clean, noise, guests, hosting, smoking, pets, sharing }) as RoommateAnswers;

const MAYA = A(1, 2, 1, 1, 1, 0, 1, 1);

function body(over: Partial<UpsertRoommateProfileRequest> = {}): UpsertRoommateProfileRequest {
  return {
    answers: MAYA, dealbreakSmoking: false, dealbreakPets: false, publish: true, mode: 'need', budget: 900, moveIn: '2027-08',
    leaseMonths: 12, neighborhoods: ['West Campus'], livingWith: 'anyone', about: 'Quiet CS student looking near campus.', ...over,
  };
}

const FORBIDDEN_NOTICE_KEYS = ['matches', 'ruleId', 'signals', 'engine'];
function assertNoticeHygiene(b: unknown): void {
  const text = JSON.stringify(b);
  for (const k of FORBIDDEN_NOTICE_KEYS) expect(text.includes(`"${k}"`)).toBe(false);
}

/* ───────────────────────────── pure compat ───────────────────────────── */

describe('compat math', () => {
  const party = (answers: RoommateAnswers, ds = false, dp = false) => ({ answers, dealbreakSmoking: ds, dealbreakPets: dp });

  it.each([
    ['identical', A(1, 2, 1, 1, 1, 0, 1, 1), 100],
    ['hosting Δ1', A(1, 2, 1, 1, 0, 0, 1, 1), 98],
    ['guests Δ1', A(1, 2, 1, 2, 1, 0, 1, 1), 97],
    ['noise Δ1', A(1, 2, 0, 1, 1, 0, 1, 1), 95],
    ['sleep+clean Δ1, hosting Δ1', A(0, 3, 1, 1, 0, 0, 1, 1), 85],
    ['far apart', A(3, 0, 3, 3, 3, 0, 2, 3), 47],
    ['opposite everything', A(3, 0, 3, 3, 3, 3, 3, 3), 0 + Math.round(100 - (20 * 2 / 3 + 20 * 2 / 3 + 15 * 2 / 3 + 10 * 2 / 3 + 5 * 2 / 3 + 15 + 10 * 2 / 3 + 5 * 2 / 3))],
  ])('%s → %i %%', (_label, other, pct) => {
    const c = computeCompatibility(party(MAYA), party(other));
    expect(c.pct).toBe(pct);
    expect(c.capped).toBe(false);
    expect(c.dimensions).toHaveLength(8);
  });

  it('dealbreakers cap at 35 in either direction', () => {
    const smoker = A(1, 2, 1, 1, 1, 3, 1, 1); // raw = 100 − 15 = 85
    const c1 = computeCompatibility(party(MAYA, true), party(smoker));
    expect(c1.pct).toBe(35);
    expect(c1.capped).toBe(true);
    const c2 = computeCompatibility(party(smoker), party(MAYA, true));
    expect(c2.pct).toBe(35);
    expect(c2.capped).toBe(true);
    // smoking = 1 does not trigger the dealbreaker
    expect(computeCompatibility(party(MAYA, true), party(A(1, 2, 1, 1, 1, 1, 1, 1))).capped).toBe(false);
    // pets: only "I have a pet" (3) conflicts
    expect(computeCompatibility(party(MAYA, false, true), party(A(1, 2, 1, 1, 1, 0, 3, 1))).pct).toBe(35);
    expect(computeCompatibility(party(MAYA, false, true), party(A(1, 2, 1, 1, 1, 0, 2, 1))).capped).toBe(false);
    // a low raw score stays below the cap
    expect(computeCompatibility(party(MAYA, true), party(A(3, 0, 3, 3, 3, 3, 3, 3))).pct).toBeLessThan(35);
  });

  it('both / differs / sentence / archetype / tags', () => {
    const c = computeCompatibility(party(MAYA), party(A(1, 2, 3, 1, 1, 0, 1, 1)));
    expect(c.both).toContain('early-ish');
    expect(c.both).toContain('tidy');
    expect(c.differs).toEqual(['noise']);
    expect(c.sentence).toMatch(/^You both: .* Differs: noise\.$/);
    expect(archetypeOf(MAYA)).toBe('Tidy Early Bird');
    expect(archetypeOf(A(3, 0, 0, 0, 0, 0, 0, 0))).toBe('Easygoing Night Owl');
    expect(tagsOf(MAYA)).toEqual(['early-ish', 'tidy', 'quiet weeknights']);
  });
});

/* ───────────────────────────── API ───────────────────────────── */

describe('roommates API', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ slices: ['roommates'], seed: 'all' });
  });
  afterEach(() => setNow(null));

  it('401 without a session; validation 400', async () => {
    expect((await ctx.anon().get('/api/roommates')).status).toBe(401);
    expect((await ctx.anon().put('/api/roommates/me').send(body())).status).toBe(401);
    const bad = await ctx.as('mayachen').put('/api/roommates/me').send({ answers: { sleep: 9 }, publish: false });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    const badMove = await ctx.as('mayachen').put('/api/roommates/me').send(body({ moveIn: '2027-13' }));
    expect(badMove.status).toBe(400);
    const badQuery = await ctx.as('mayachen').get('/api/roommates?sort=nope');
    expect(badQuery.status).toBe(400);
  });

  it('seed: Maya browses ranked matches with the §7.5 spread; her own post is absent; saved = 3; unpublished bg row never listed', async () => {
    const maya = ctx.as('mayachen');
    const res = await maya.get('/api/roommates?limit=50');
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string; user: { handle: string }; compat: { pct: number; capped: boolean } | null; firstName: string; saved: boolean }[];
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.some((i) => i.user.handle === 'mayachen')).toBe(false);
    for (const i of items) expect(i.compat).not.toBeNull();
    const pcts = items.map((i) => i.compat!.pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a)); // best first
    expect(pcts.filter((p) => p >= 90).length).toBeGreaterThanOrEqual(3);
    expect(pcts.filter((p) => p < 50).length).toBeGreaterThanOrEqual(4);
    expect(items.filter((i) => i.compat!.capped).length).toBeGreaterThanOrEqual(1);
    expect(items.find((i) => i.user.handle === 'calebt')!.compat!.pct).toBe(35);
    expect(items.filter((i) => i.saved).length).toBe(3);
    // first name only on cards
    for (const i of items) expect(i.firstName.includes(' ')).toBe(false);
    // the unpublished bg row is never listed
    const unpublished = ctx.db.prepare('SELECT id, user_id FROM roommate_profiles WHERE published_at IS NULL').all() as { id: string; user_id: string }[];
    expect(unpublished.length).toBe(1);
    expect(items.some((i) => i.id === unpublished[0]!.id)).toBe(false);
    const me = await maya.get('/api/roommates/me');
    expect(me.body.profile).toMatchObject({ published: true, paused: false, needsConfirmation: false, mode: 'need', dealbreakSmoking: true });
    expect(now() - me.body.profile.publishedAt).toBeLessThan(14 * DAY);
    const saved = await maya.get('/api/roommates/saved');
    expect(saved.body.items.length).toBe(3);
    // Maya has no roommate notification on first load (§7.5)
    runStillLookingHook('u_mayachen');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_mayachen' AND type = 'roommate.still_looking'").get()).toEqual({ n: 0 });
  });

  it('match-without-posting: a publish:false profile is invisible everywhere yet ranks its owner', async () => {
    const lurker = ctx.createUser({ handle: 'lurker_rm' });
    const other = ctx.createUser({ handle: 'other_rm' });
    const agent = ctx.as(lurker.id);
    // before answering: compat is null on every card
    const before = await agent.get('/api/roommates');
    expect(before.body.items.length).toBeGreaterThan(0);
    for (const i of before.body.items) expect(i.compat).toBeNull();

    const put = await agent.put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: true, dealbreakPets: false, publish: false });
    expect(put.status).toBe(201);
    expect(put.body).toMatchObject({ published: false, publishedAt: null, mode: null, budget: null, moveIn: null, moderation: { status: 'active' } });
    assertNoticeHygiene(put.body);
    const id = put.body.id as string;

    // ranked % now
    const after = await agent.get('/api/roommates');
    for (const i of after.body.items) expect(i.compat).not.toBeNull();
    expect(after.body.items.find((i: { user: { handle: string } }) => i.user.handle === 'calebt').compat.pct).toBe(35);

    // absent from GET / for others, GET /saved, 404 on GET /:id, unavailable as a card
    const otherAgent = ctx.as(other.id);
    const list = await otherAgent.get('/api/roommates?limit=50');
    expect(list.body.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await otherAgent.put(`/api/roommates/${id}/save`)).status).toBe(404);
    const saved = await otherAgent.get('/api/roommates/saved');
    expect(saved.body.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await otherAgent.get(`/api/roommates/${id}`)).status).toBe(404);
    const card = await otherAgent.get(`/api/cards/roommate/${id}`);
    expect(card.status).toBe(200);
    expect(card.body.status).toBe('unavailable');
    expect(resolveCard({ kind: 'roommate', id }, other.id).status).toBe('unavailable');
    // the owner can still open their own row
    expect((await agent.get(`/api/roommates/${id}`)).status).toBe(200);
    // ... and message / save published posts
    const target = list.body.items[0].id as string;
    expect((await agent.put(`/api/roommates/${target}/save`)).body).toEqual({ saved: true });

    // publish:true without basics → 400
    const noBasics = await agent.put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: true, dealbreakPets: false, publish: true });
    expect(noBasics.status).toBe(400);
    expect(noBasics.body.error.code).toBe('validation_failed');

    // publish with basics → visible; unpublish → hidden again, answers kept
    const pub = await agent.put('/api/roommates/me').send(body({ dealbreakSmoking: true }));
    expect(pub.status).toBe(200);
    expect(pub.body.published).toBe(true);
    expect(pub.body.publishedAt).not.toBeNull();
    expect((await otherAgent.get(`/api/roommates/${id}`)).status).toBe(200);
    expect(resolveCard({ kind: 'roommate', id }, other.id).status).toBe('available');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'roommate_profile_publish' AND user_id = ?").get(lurker.id)).toEqual({ n: 1 });
    // publish:false never unpublishes an already-published post
    const keep = await agent.put('/api/roommates/me').send(body({ publish: false, dealbreakSmoking: true }));
    expect(keep.status).toBe(200);
    expect(keep.body.published).toBe(true);
    const un = await agent.post('/api/roommates/me/unpublish');
    expect(un.status).toBe(200);
    expect(un.body).toMatchObject({ published: false, publishedAt: null });
    expect(un.body.answers).toEqual(MAYA);
    expect((await otherAgent.get(`/api/roommates/${id}`)).status).toBe(404);
    expect(resolveCard({ kind: 'roommate', id }, other.id).status).toBe('unavailable');
    const mine = await agent.get('/api/roommates');
    for (const i of mine.body.items) expect(i.compat).not.toBeNull();
  });

  it('under-18 cannot publish (403), but can browse & match', async () => {
    const minor = ctx.createUser({ isAdult: false });
    const agent = ctx.as(minor.id);
    const pub = await agent.put('/api/roommates/me').send(body());
    expect(pub.status).toBe(403);
    expect(pub.body.error.code).toBe('forbidden');
    expect(pub.body.error.message).toMatch(/18 or older/);
    const match = await agent.put('/api/roommates/me').send(body({ publish: false }));
    expect(match.status).toBe(201);
    expect(match.body.published).toBe(false);
  });

  it('moderation: street address → 422 M-PII; discriminatory text → 422 M-LISTING-DISCRIM; notice hygiene', async () => {
    const u = ctx.createUser();
    const agent = ctx.as(u.id);
    const pii = await agent.put('/api/roommates/me').send(body({ about: 'Come see the place at 2400 Nueces St apt 4b, message me.' }));
    expect(pii.status).toBe(422);
    expect(pii.body.error.code).toBe('content_blocked');
    expect(pii.body.error.details.messageId).toBe('M-PII');
    assertNoticeHygiene(pii.body);
    const discrim = await agent.put('/api/roommates/me').send(body({ about: 'Nice place, no international students please.' }));
    expect(discrim.status).toBe(422);
    expect(discrim.body.error.details.messageId).toBe('M-LISTING-DISCRIM');
    assertNoticeHygiene(discrim.body);
    // custom neighborhoods and photo alts are UGC too: a street address typed as an "area" / a slur in an alt is blocked
    const hoodPii = await agent.put('/api/roommates/me').send(body({ neighborhoods: ['West Campus', '2400 Nueces St Apt 4'] }));
    expect(hoodPii.status).toBe(422);
    expect(hoodPii.body.error.details.messageId).toBe('M-PII');
    assertNoticeHygiene(hoodPii.body);
    const altDiscrim = await agent.put('/api/roommates/me').send(
      body({ photos: [{ url: '/seed-media/generated/roommates/rm_0007-1.svg', width: 1080, height: 1350, alt: 'Bright room, no international students please.' }] }),
    );
    expect(altDiscrim.status).toBe(422);
    expect(altDiscrim.body.error.details.messageId).toBe('M-LISTING-DISCRIM');
    // the same neighborhoods / alt on a match-only row (publish:false) are blocked too — they are stored either way
    const lurkPii = await agent.put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: false, dealbreakPets: false, publish: false, neighborhoods: ['2400 Nueces St Apt 4'] });
    expect(lurkPii.status).toBe(422);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM roommate_profiles WHERE user_id = ?').get(u.id)).toEqual({ n: 0 });
  });

  it('held text: the author sees the row with status held, others do not see it; an edit that clears the text restores it', async () => {
    const author = ctx.createUser();
    const viewer = ctx.createUser();
    const agent = ctx.as(author.id);
    // a deposit-scam pattern is held (flag, visibility held) on commerce surfaces
    const held = await agent.put('/api/roommates/me').send(body({ about: 'Room near campus, pay the deposit first then i ship the keys.' }));
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('held');
    expect(held.body.moderation.status).toBe('held');
    assertNoticeHygiene(held.body);
    const id = held.body.id as string;
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    const list = await ctx.as(viewer.id).get('/api/roommates?limit=50');
    expect(list.body.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await agent.get('/api/roommates/me')).body.profile.status).toBe('held');
    // an edit that leaves the held text in place (budget only, well inside the 10-min duplicate window) is not
    // re-moderated as a new write (no M-DUP), stays held, and says so in the notice
    const budgetOnly = await agent.put('/api/roommates/me').send(body({ about: 'Room near campus, pay the deposit first then i ship the keys.', budget: 950 }));
    expect(budgetOnly.status).toBe(200);
    expect(budgetOnly.body.budget).toBe(950);
    expect(budgetOnly.body.status).toBe('held');
    expect(budgetOnly.body.moderation.status).toBe('held');
    assertNoticeHygiene(budgetOnly.body);
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    // changing a different text field (neighborhoods) re-moderates only that field: the hold on `about` is kept
    const hoods = await agent.put('/api/roommates/me').send(body({ about: 'Room near campus, pay the deposit first then i ship the keys.', neighborhoods: ['Hyde Park'] }));
    expect(hoods.status).toBe(200);
    expect(hoods.body.status).toBe('held');
    expect(hoods.body.moderation.status).toBe('held');
    expect(hoods.body.neighborhoods).toEqual(['Hyde Park']);
    const cleared = await agent.put('/api/roommates/me').send(body({ about: '' }));
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe('active');
    expect(cleared.body.moderation.status).toBe('active');
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(200);
    // re-saving unchanged clean text right away is fine too (unchanged fields never hit the duplicate detector)
    const again = await agent.put('/api/roommates/me').send(body({ about: '', budget: 975 }));
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('active');
  });

  it('muted user → 403 muted on PUT /me', async () => {
    const u = ctx.createUser();
    const admin = ctx.createUser({ role: 'admin' });
    applySanction({ userId: u.id, kind: 'mute', durationMs: 24 * HOUR, category: 'harassment_bullying', actor: admin, delayed: false });
    const res = await ctx.as(u.id).put('/api/roommates/me').send(body());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('muted');
  });

  it('filters: mode, budget range, move-in, lease, neighborhoods, livingWith, sort', async () => {
    const maya = ctx.as('mayachen');
    const all = (await maya.get('/api/roommates?limit=50')).body.items as { mode: string; budget: number; moveIn: string; neighborhoods: string[]; createdAt: number }[];
    const have = (await maya.get('/api/roommates?mode=have&limit=50')).body.items as { mode: string }[];
    expect(have.length).toBeGreaterThan(0);
    for (const i of have) expect(i.mode).toBe('have');
    const budget = (await maya.get('/api/roommates?budgetMin=800&budgetMax=900&limit=50')).body.items as { budget: number }[];
    expect(budget.length).toBeGreaterThan(0);
    for (const i of budget) {
      expect(i.budget).toBeGreaterThanOrEqual(800);
      expect(i.budget).toBeLessThanOrEqual(900);
    }
    const soonest = [...all].map((i) => i.moveIn).sort()[0]!;
    const move = (await maya.get(`/api/roommates?moveIn=${soonest}&limit=50`)).body.items as { moveIn: string }[];
    expect(move.length).toBeGreaterThan(0);
    for (const i of move) expect(i.moveIn <= soonest).toBe(true);
    const lease = (await maya.get('/api/roommates?leaseMonths=6&limit=50')).body.items as { id: string }[];
    expect(lease.length).toBeGreaterThan(0);
    expect(lease.length).toBeLessThan(all.length);
    const hood = (await maya.get('/api/roommates?neighborhoods=Hyde%20Park&limit=50')).body.items as { neighborhoods: string[] }[];
    expect(hood.length).toBeGreaterThan(0);
    for (const i of hood) expect(i.neighborhoods).toContain('Hyde Park');
    const combo = (await maya.get('/api/roommates?mode=need&neighborhoods=West%20Campus,Riverside&budgetMax=800&limit=50')).body.items as { mode: string; budget: number; neighborhoods: string[] }[];
    for (const i of combo) {
      expect(i.mode).toBe('need');
      expect(i.budget).toBeLessThanOrEqual(800);
      expect(i.neighborhoods.some((n) => n === 'West Campus' || n === 'Riverside')).toBe(true);
    }
    const newest = (await maya.get('/api/roommates?sort=newest&limit=50')).body.items as { createdAt: number }[];
    const ts = newest.map((i) => i.createdAt);
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
    const byBudget = (await maya.get('/api/roommates?sort=budget&limit=50')).body.items as { budget: number }[];
    const bs = byBudget.map((i) => i.budget);
    expect(bs).toEqual([...bs].sort((a, b) => a - b));
    // no results with filters
    const none = await maya.get('/api/roommates?budgetMin=4900&budgetMax=5000');
    expect(none.body).toEqual({ items: [], nextCursor: null });
    // pagination: offset cursor
    const p1 = await maya.get('/api/roommates?limit=3');
    expect(p1.body.items.length).toBe(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await maya.get(`/api/roommates?limit=3&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.body.items.length).toBeGreaterThan(0);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect((await maya.get('/api/roommates?limit=3&cursor=garbage')).status).toBe(400);
  });

  it('living_with same_gender: only shown to viewers whose own profile has the same gender', async () => {
    const poster = ctx.createUser({ isAdult: true });
    const posted = await ctx.as(poster.id).put('/api/roommates/me').send(body({ livingWith: 'same_gender', gender: 'woman' }));
    expect(posted.status).toBe(201);
    const id = posted.body.id as string;
    const noProfile = ctx.createUser();
    expect(((await ctx.as(noProfile.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(false);
    const man = ctx.createUser();
    await ctx.as(man.id).put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: false, dealbreakPets: false, publish: false, gender: 'man' });
    expect(((await ctx.as(man.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(false);
    const woman = ctx.createUser();
    await ctx.as(woman.id).put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: false, dealbreakPets: false, publish: false, gender: 'woman' });
    expect(((await ctx.as(woman.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(true);
    // a same_gender post without a gender is rejected
    expect((await ctx.as(ctx.createUser().id).put('/api/roommates/me').send(body({ livingWith: 'same_gender', gender: null }))).status).toBe(400);
  });

  it('pause / resume / confirm: paused hidden from browse and card says paused; needsConfirmation after 30 d; auto-pause after 60 d', async () => {
    const poster = ctx.createUser();
    const viewer = ctx.createUser();
    const agent = ctx.as(poster.id);
    const id = (await agent.put('/api/roommates/me').send(body())).body.id as string;
    expect(((await ctx.as(viewer.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(true);
    const paused = await agent.post('/api/roommates/me/pause');
    expect(paused.status).toBe(200);
    expect(paused.body.paused).toBe(true);
    expect(((await ctx.as(viewer.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(false);
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    const card = resolveCard({ kind: 'roommate', id }, viewer.id);
    expect(card.status).toBe('paused');
    expect(card.ownerId).toBe(poster.id);
    const resumed = await agent.post('/api/roommates/me/resume');
    expect(resumed.body.paused).toBe(false);
    expect(((await ctx.as(viewer.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(true);

    // 31 days later (rows backdated: moving the clock would expire the 30-day test session): needsConfirmation + one
    // still_looking notification (hook), no duplicates
    const backdate = (ms: number) => ctx.db.prepare('UPDATE roommate_profiles SET published_at = ?, confirmed_at = ? WHERE id = ?').run(now() - ms, now() - ms, id);
    backdate(31 * DAY);
    expect((await agent.get('/api/roommates/me')).body.profile.needsConfirmation).toBe(true);
    badgesFor(poster.id);
    badgesFor(poster.id);
    const notifs = ctx.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'roommate.still_looking'").all(poster.id) as { href: string; actor_id: string | null }[];
    expect(notifs.length).toBe(1);
    expect(notifs[0]).toMatchObject({ href: '/roommates/me', actor_id: null });
    const confirmed = await agent.post('/api/roommates/me/confirm');
    expect(confirmed.body.needsConfirmation).toBe(false);
    // 61 days after the confirmation: auto-pause
    backdate(61 * DAY);
    badgesFor(poster.id);
    expect((await agent.get('/api/roommates/me')).body.profile.paused).toBe(true);
    expect(((await ctx.as(viewer.id).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id)).toBe(false);
  });

  it('save is silent (no notification row), toggles, and cannot target own post', async () => {
    const poster = ctx.createUser();
    const saver = ctx.createUser();
    const id = (await ctx.as(poster.id).put('/api/roommates/me').send(body())).body.id as string;
    const agent = ctx.as(saver.id);
    const before = (ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n;
    expect((await agent.put(`/api/roommates/${id}/save`)).body).toEqual({ saved: true });
    expect((await agent.put(`/api/roommates/${id}/save`)).body).toEqual({ saved: true }); // idempotent
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n).toBe(before);
    expect(ctx.wsEventsFor(poster.id).some((e) => e.type === 'notification')).toBe(false);
    const saved = await agent.get('/api/roommates/saved');
    expect(saved.body.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(saved.body.items[0].saved).toBe(true);
    expect((await agent.get(`/api/roommates/${id}`)).body.saved).toBe(true);
    expect((await agent.delete(`/api/roommates/${id}/save`)).body).toEqual({ saved: false });
    expect((await agent.get('/api/roommates/saved')).body.items).toEqual([]);
    expect((await ctx.as(poster.id).put(`/api/roommates/${id}/save`)).status).toBe(400);
  });

  it('blocks hide posts both ways; reported posts disappear for the reporter; suspended authors are hidden', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser();
    const aId = (await ctx.as(a.id).put('/api/roommates/me').send(body())).body.id as string;
    const bId = (await ctx.as(b.id).put('/api/roommates/me').send(body())).body.id as string;
    const sees = async (viewer: string, id: string): Promise<boolean> =>
      ((await ctx.as(viewer).get('/api/roommates?limit=50')).body.items as { id: string }[]).some((i) => i.id === id);
    expect(await sees(a.id, bId)).toBe(true);
    expect(await sees(b.id, aId)).toBe(true);
    await ctx.as(b.id).put(`/api/roommates/${aId}/save`);
    expect((await ctx.as(a.id).post(`/api/users/${b.id}/block`)).status).toBe(200);
    expect(await sees(a.id, bId)).toBe(false);
    expect(await sees(b.id, aId)).toBe(false);
    expect((await ctx.as(a.id).get(`/api/roommates/${bId}`)).status).toBe(404);
    expect((await ctx.as(b.id).get(`/api/roommates/${aId}`)).status).toBe(404);
    expect((await ctx.as(b.id).get('/api/roommates/saved')).body.items).toEqual([]);
    expect(resolveCard({ kind: 'roommate', id: aId }, b.id).status).toBe('unavailable');
    await ctx.as(a.id).delete(`/api/users/${b.id}/block`);
    expect(await sees(a.id, bId)).toBe(true);

    // report → gone for the reporter only
    const reporter = ctx.createUser();
    expect(await sees(reporter.id, aId)).toBe(true);
    const rep = await ctx.as(reporter.id).post('/api/reports').send({ entityType: 'roommate_listing', entityId: aId, reason: 'spam_scam', subReason: 'scam_fake' });
    expect(rep.status).toBe(200);
    expect(await sees(reporter.id, aId)).toBe(false);
    expect(await sees(b.id, aId)).toBe(true);
    // reporting an unpublished row → 404 (never reportable)
    const lurk = ctx.createUser();
    const lid = (await ctx.as(lurk.id).put('/api/roommates/me').send(body({ publish: false }))).body.id as string;
    expect((await ctx.as(reporter.id).post('/api/reports').send({ entityType: 'roommate_listing', entityId: lid, reason: 'spam_scam' })).status).toBe(404);

    // suspended author hidden
    const admin = ctx.createUser({ role: 'admin' });
    applySanction({ userId: b.id, kind: 'suspension', durationMs: 7 * DAY, category: 'harassment_bullying', actor: admin });
    expect(await sees(a.id, bId)).toBe(false);
  });

  it('card resolver output + share card endpoint', async () => {
    const poster = ctx.createUser({ displayName: 'Nadia Okonkwo' });
    const viewer = ctx.createUser();
    const id = (await ctx.as(poster.id).put('/api/roommates/me').send(body({ mode: 'have', budget: 1100, moveIn: '2027-01', place: { rent: 1100, roomType: 'private', beds: 2, baths: 1, furnished: true, utilitiesIncluded: false } }))).body.id as string;
    await ctx.as(viewer.id).put('/api/roommates/me').send({ answers: MAYA, dealbreakSmoking: false, dealbreakPets: false, publish: false });
    const card = (await ctx.as(viewer.id).get(`/api/cards/roommate/${id}`)).body;
    expect(card).toMatchObject({
      kind: 'roommate', id, title: 'Nadia · Has a place', subtitle: 'Move-in Jan 2027', href: `/roommates/${id}`, status: 'available',
      price: 1100, currency: 'USD', badge: '100% match', ownerId: poster.id, imageUrl: null, meetupSpot: null,
    });
    // the owner sees no match badge
    expect((await ctx.as(poster.id).get(`/api/cards/roommate/${id}`)).body.badge).toBeNull();
    // opening a DM with the roommate context pins it
    const dm = await ctx.as(viewer.id).post('/api/dm').send({ userId: poster.id, context: { kind: 'roommate', id } });
    expect(dm.status).toBe(200);
    const conv = ctx.db.prepare('SELECT context_kind, context_id FROM conversations WHERE id = ?').get(dm.body.conversationId);
    expect(conv).toEqual({ context_kind: 'roommate', context_id: id });
  });

  it('detail: answers, place, photos, why-you-match; view tracked; delete removes the row and 404s the card', async () => {
    const poster = ctx.createUser();
    const viewer = ctx.createUser();
    const agent = ctx.as(poster.id);
    const created = await agent.put('/api/roommates/me').send(body({ mode: 'have', place: { rent: 800, roomType: 'shared', beds: 3, baths: 2, furnished: false, utilitiesIncluded: true }, photos: [{ url: '/seed-media/generated/roommates/rm_0007-1.svg', width: 1080, height: 1350 }] }));
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await ctx.as(viewer.id).put('/api/roommates/me').send({ answers: A(1, 2, 3, 1, 1, 0, 1, 1), dealbreakSmoking: false, dealbreakPets: false, publish: false });
    const detail = await ctx.as(viewer.id).get(`/api/roommates/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id, mode: 'have', budget: 900, moveIn: '2027-08', leaseMonths: 12, livingWith: 'anyone', archetype: 'Tidy Early Bird',
      place: { rent: 800, roomType: 'shared', beds: 3, baths: 2, furnished: false, utilitiesIncluded: true }, answers: MAYA,
      coverUrl: '/seed-media/generated/roommates/rm_0007-1.svg', saved: false, lowPriceFlag: false,
    });
    expect(detail.body.compat.pct).toBe(90);
    expect(detail.body.compat.differs).toEqual(['noise']);
    expect(detail.body.tags).toHaveLength(3);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'roommate_view' AND user_id = ?").get(viewer.id)).toEqual({ n: 1 });
    // a photo the user does not own → 404
    expect((await agent.put('/api/roommates/me').send(body({ photos: [{ url: '/uploads/nope.jpg', width: 1, height: 1 }] }))).status).toBe(404);
    // delete
    expect((await agent.delete('/api/roommates/me')).status).toBe(204);
    expect((await agent.get('/api/roommates/me')).body).toEqual({ profile: null });
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    expect(resolveCard({ kind: 'roommate', id }, viewer.id).status).toBe('unavailable');
    expect((await agent.post('/api/roommates/me/pause')).status).toBe(404);
  });

  it('content adapter: load / setStatus (hidden → gone for others, restore → back; removed → notifications gone)', async () => {
    const { getContentAdapter } = await import('../src/lib/content');
    const poster = ctx.createUser();
    const viewer = ctx.createUser();
    const id = (
      await ctx.as(poster.id).put('/api/roommates/me').send(
        body({
          about: 'Looking for a calm roommate near campus.', neighborhoods: ['West Campus', 'Hyde Park'], mode: 'have',
          place: { rent: 900, roomType: 'private', beds: 2, baths: 1, furnished: false, utilitiesIncluded: false },
          photos: [{ url: '/seed-media/generated/roommates/rm_0007-1.svg', width: 1080, height: 1350, alt: 'Sunny bedroom' }],
        }),
      )
    ).body.id as string;
    const adapter = getContentAdapter('roommate_listing')!;
    const snap = adapter.load(id)!;
    expect(snap).toMatchObject({ entityType: 'roommate_listing', entityId: id, authorId: poster.id, status: 'active', surface: 'roommate_listing', anon: false, label: 'roommate post', href: `/roommates/${id}` });
    // every moderated text field is in the snapshot (queue shows what was checked): neighborhoods, about, photo alts
    expect(snap.fields).toEqual([
      { field: 'title', text: 'West Campus, Hyde Park' },
      { field: 'body', text: 'Looking for a calm roommate near campus.' },
      { field: 'body', text: 'Sunny bedroom' },
    ]);
    expect(snap.media).toEqual([{ url: '/seed-media/generated/roommates/rm_0007-1.svg', kind: 'image' }]);
    adapter.setStatus(id, 'hidden');
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    expect((await ctx.as(poster.id).get('/api/roommates/me')).body.profile.status).toBe('hidden');
    // an edit while hidden keeps the staff decision
    expect((await ctx.as(poster.id).put('/api/roommates/me').send(body({ about: 'Edited text, still looking.' }))).body.status).toBe('hidden');
    adapter.setStatus(id, 'active');
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(200);
    adapter.setStatus(id, 'removed');
    expect(adapter.load(id)!.status).toBe('removed');
    expect((await ctx.as(viewer.id).get(`/api/roommates/${id}`)).status).toBe(404);
    // an unpublished row is not loadable (never reportable)
    const lurk = ctx.createUser();
    const lid = (await ctx.as(lurk.id).put('/api/roommates/me').send(body({ publish: false }))).body.id as string;
    expect(adapter.load(lid)).toBeNull();
  });

  it('lifecycle: a banned author’s post is removed', async () => {
    const { runUserLifecycleHooks } = await import('../src/lib/content');
    const poster = ctx.createUser();
    const id = (await ctx.as(poster.id).put('/api/roommates/me').send(body())).body.id as string;
    runUserLifecycleHooks('onBanned', poster.id);
    expect(ctx.db.prepare('SELECT status FROM roommate_profiles WHERE id = ?').get(id)).toEqual({ status: 'removed' });
  });

  it('low-price flag: a have post far below the campus median (≥ 10 comparables) is flagged visible P3', async () => {
    const mk = async (rent: number): Promise<{ id: string; user: string }> => {
      const u = ctx.createUser();
      const r = await ctx.as(u.id).put('/api/roommates/me').send(body({ mode: 'have', budget: rent, place: { rent, roomType: 'private', beds: 2, baths: 1, furnished: false, utilitiesIncluded: false } }));
      expect(r.status).toBe(201);
      return { id: r.body.id as string, user: u.id };
    };
    for (let i = 0; i < 10; i++) await mk(1000 + i * 10);
    const cheap = await mk(300);
    const detail = await ctx.as(ctx.createUser().id).get(`/api/roommates/${cheap.id}`);
    expect(detail.status).toBe(200); // still visible
    expect(detail.body.lowPriceFlag).toBe(true);
    const q = ctx.db.prepare("SELECT source, priority, status FROM mod_queue WHERE entity_type = 'roommate_listing' AND entity_id = ?").get(cheap.id);
    expect(q).toMatchObject({ source: 'system', priority: 'p3', status: 'open' });
    const normal = await mk(950);
    expect((await ctx.as(ctx.createUser().id).get(`/api/roommates/${normal.id}`)).body.lowPriceFlag).toBe(false);
  });
});
