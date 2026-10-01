/**
 * `apartments` slice tests (SPEC §5.10) — isolation mode: `createTestApp({ slices: ['apartments'] })`.
 * Survey validation + campus-scoped split math, idempotent waitlist join/leave with real counts, tracked events
 * landing in `analytics_events` with user + university, settings patch cannot disable `safety`, notification
 * filter mapping + anonymous rows carrying `actor: null`, and the seed (Maya joined / survey unanswered, funnel shape,
 * determinism).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Notification, NotificationListResponse, UserSettings, WaitlistState } from '@shared/core';
import { SURVEY, type SurveySplit, type SurveyState } from '@shared/apartments';
import { notify, notifyAnonymous } from '../src/lib/notify';
import { createTestApp, type TestCtx } from '../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: ['apartments'] });
});

/** Author-notice hygiene (SPEC §5 common rules): no engine internals in any body. */
function assertHygiene(body: unknown): void {
  const text = JSON.stringify(body ?? null);
  for (const key of ['"matches"', '"ruleId"', '"signals"', '"engine"']) expect(text).not.toContain(key);
}

describe('apartments (smoke)', () => {
  it('boots in isolation mode with the core seed', async () => {
    const health = await ctx.anon().get('/api/health');
    expect(health.status).toBe(200);
    const me = await ctx.as('mayachen').get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe('mayachen');
  });
});

describe('survey', () => {
  it('starts empty, answers upsert, and GET /survey returns splits only for answered questions', async () => {
    const me = ctx.createUser();
    const agent = ctx.as(me.id);

    const empty = await agent.get('/api/apartments/survey');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ answers: {}, completed: false, splits: [] } satisfies SurveyState);

    const first = await agent.put('/api/apartments/survey/when').send({ answer: ['next_semester'] });
    expect(first.status).toBe(200);
    const split = first.body as SurveySplit;
    expect(split.question).toBe('when');
    expect(split.total).toBe(1);
    expect(split.options.map((o) => o.id)).toEqual(SURVEY[0].options.map((o) => o.id));
    expect(split.options.find((o) => o.id === 'next_semester')).toEqual({ id: 'next_semester', count: 1, pct: 100 });
    expect(split.options.find((o) => o.id === 'next_fall')).toEqual({ id: 'next_fall', count: 0, pct: 0 });
    assertHygiene(first.body);

    // re-answering replaces the row (one row per user + question)
    const again = await agent.put('/api/apartments/survey/when').send({ answer: ['next_fall'] });
    expect(again.status).toBe(200);
    expect((again.body as SurveySplit).total).toBe(1);
    expect((again.body as SurveySplit).options.find((o) => o.id === 'next_fall')?.count).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM apartment_survey_answers WHERE user_id = ?').get(me.id)).toEqual({ n: 1 });

    const partial = await agent.get('/api/apartments/survey');
    expect(partial.body.answers).toEqual({ when: ['next_fall'] });
    expect(partial.body.completed).toBe(false);
    expect(partial.body.splits.map((s: SurveySplit) => s.question)).toEqual(['when']);

    expect((await agent.put('/api/apartments/survey/budget').send({ answer: ['600_900'] })).status).toBe(200);
    expect((await agent.put('/api/apartments/survey/priorities').send({ answer: ['price', 'walk'] })).status).toBe(200);
    const done = await agent.get('/api/apartments/survey');
    expect(done.body.completed).toBe(true);
    expect(done.body.answers).toEqual({ when: ['next_fall'], budget: ['600_900'], priorities: ['price', 'walk'] });
    expect(done.body.splits.map((s: SurveySplit) => s.question)).toEqual(['when', 'budget', 'priorities']);
    assertHygiene(done.body);
  });

  it('validates options, question ids and the per-question max (2 for priorities)', async () => {
    const agent = ctx.as(ctx.createUser().id);
    const bad = async (question: string, body: object) => (await agent.put(`/api/apartments/survey/${question}`).send(body)).status;
    expect(await bad('parking', { answer: ['x'] })).toBe(400);
    expect(await bad('when', { answer: ['never'] })).toBe(400);
    expect(await bad('when', { answer: [] })).toBe(400);
    expect(await bad('when', { answer: 'next_fall' })).toBe(400);
    expect(await bad('when', {})).toBe(400);
    expect(await bad('when', { answer: ['this_semester', 'next_fall'] })).toBe(400);
    expect(await bad('priorities', { answer: ['price', 'walk', 'safety'] })).toBe(400);
    expect(await bad('priorities', { answer: ['price', 'nope'] })).toBe(400);
    // duplicates collapse instead of counting twice
    const dup = await agent.put('/api/apartments/survey/priorities').send({ answer: ['price', 'price'] });
    expect(dup.status).toBe(200);
    expect((await agent.get('/api/apartments/survey')).body.answers).toEqual({ priorities: ['price'] });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM apartment_survey_answers').get()).toEqual({ n: 1 });
  });

  it('split math is campus-scoped (distinct answerers; multi-select pcts count per option)', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser();
    const c = ctx.createUser();
    const far = ctx.createUser({ universityId: 'uni_umich' });
    await ctx.as(a.id).put('/api/apartments/survey/priorities').send({ answer: ['price', 'walk'] });
    await ctx.as(b.id).put('/api/apartments/survey/priorities').send({ answer: ['price'] });
    await ctx.as(far.id).put('/api/apartments/survey/priorities').send({ answer: ['safety'] });
    const res = await ctx.as(c.id).put('/api/apartments/survey/priorities').send({ answer: ['laundry', 'price'] });
    const split = res.body as SurveySplit;
    expect(split.total).toBe(3);
    const by = Object.fromEntries(split.options.map((o) => [o.id, o]));
    expect(by.price).toEqual({ id: 'price', count: 3, pct: 100 });
    expect(by.walk).toEqual({ id: 'walk', count: 1, pct: 33 });
    expect(by.laundry).toEqual({ id: 'laundry', count: 1, pct: 33 });
    expect(by.safety).toEqual({ id: 'safety', count: 0, pct: 0 });

    const farState = (await ctx.as(far.id).get('/api/apartments/survey')).body as SurveyState;
    expect(farState.splits).toHaveLength(1);
    expect(farState.splits[0]!.total).toBe(1);
    expect(farState.splits[0]!.options.find((o) => o.id === 'safety')).toEqual({ id: 'safety', count: 1, pct: 100 });
    expect(farState.splits[0]!.options.find((o) => o.id === 'price')?.count).toBe(0);
  });

  it('requires a session (401) and onboarding (403)', async () => {
    expect((await ctx.anon().get('/api/apartments/survey')).status).toBe(401);
    expect((await ctx.anon().put('/api/apartments/survey/when').send({ answer: ['next_fall'] })).status).toBe(401);
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL WHERE id = ?').run(fresh.id);
    const res = await ctx.as(fresh.id).get('/api/apartments/survey');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('onboarding_required');
  });
});

describe('waitlist (foundation #34–#35, as the page uses them)', () => {
  it('join / leave are idempotent and counts are real campus rows', async () => {
    const me = ctx.createUser();
    const mate = ctx.createUser();
    const far = ctx.createUser({ universityId: 'uni_umich' });
    const agent = ctx.as(me.id);
    const before = (await agent.get('/api/waitlist/apartments')).body as WaitlistState;
    expect(before).toMatchObject({ feature: 'apartments', joined: false, joinedAt: null, campusCount: 0, totalCount: 0 });

    const joined = (await agent.post('/api/waitlist/apartments').send({ source: 'nav' })).body as WaitlistState;
    expect(joined).toMatchObject({ joined: true, campusCount: 1, totalCount: 1 });
    expect(joined.joinedAt).toEqual(expect.any(Number));
    const again = (await agent.post('/api/waitlist/apartments').send({ source: 'nav' })).body as WaitlistState;
    expect(again).toEqual(joined);
    await ctx.as(mate.id).post('/api/waitlist/apartments').send({ source: 'campus' });
    await ctx.as(far.id).post('/api/waitlist/apartments').send({ source: 'link' });
    expect((await agent.get('/api/waitlist/apartments')).body).toMatchObject({ joined: true, campusCount: 2, totalCount: 3 });
    expect((await ctx.as(far.id).get('/api/waitlist/apartments')).body).toMatchObject({ joined: true, campusCount: 1, totalCount: 3 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE feature = 'apartments' AND left_at IS NULL").get()).toEqual({ n: 3 });

    const left = (await agent.delete('/api/waitlist/apartments')).body as WaitlistState;
    expect(left).toMatchObject({ joined: false, joinedAt: null, campusCount: 1, totalCount: 2 });
    expect((await agent.delete('/api/waitlist/apartments')).body).toEqual(left);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE feature = 'apartments'").get()).toEqual({ n: 3 });

    const rejoined = (await agent.post('/api/waitlist/apartments').send({})).body as WaitlistState;
    expect(rejoined).toMatchObject({ joined: true, campusCount: 2, totalCount: 3 });
  });
});

describe('engagement tracking (foundation #33)', () => {
  it('every apartments.* event lands in analytics_events with the user and the university', async () => {
    const me = ctx.createUser();
    const events = [
      { name: 'apartments.page_view', props: { source: 'nav' } },
      { name: 'apartments.cta_click', props: { source: 'nav' } },
      { name: 'apartments.cta_undo' },
      { name: 'apartments.survey_start' },
      { name: 'apartments.survey_answer', props: { question: 'when', answer: 'next_fall' } },
      { name: 'apartments.survey_complete' },
      { name: 'apartments.share_click', props: { method: 'copy' } },
      { name: 'apartments.roommates_crosslink_click' },
      { name: 'apartments.dwell', props: { dwellBucket: '15-60s', dwellMs: 20_000 } },
    ];
    const res = await ctx.as(me.id).post('/api/analytics/track').send({ events });
    expect(res.status).toBe(204);
    const rows = ctx.db
      .prepare("SELECT name, user_id, university_id, props_json FROM analytics_events WHERE name LIKE 'apartments.%' ORDER BY rowid")
      .all() as { name: string; user_id: string | null; university_id: string | null; props_json: string }[];
    expect(rows.map((r) => r.name)).toEqual(events.map((e) => e.name));
    for (const r of rows) {
      expect(r.user_id).toBe(me.id);
      expect(r.university_id).toBe('uni_utexas');
    }
    expect(JSON.parse(rows[4]!.props_json)).toMatchObject({ question: 'when', answer: 'next_fall' });
    expect(JSON.parse(rows[8]!.props_json)).toMatchObject({ dwellBucket: '15-60s' });
    // signed-out: apartments events are never stored
    expect((await ctx.anon().post('/api/analytics/track').send({ events: [{ name: 'apartments.page_view' }] })).status).toBe(204);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name LIKE 'apartments.%'").get()).toEqual({ n: rows.length });
  });
});

describe('settings (foundation #13)', () => {
  it('changes persist and safety notifications cannot be switched off', async () => {
    const me = ctx.createUser();
    const agent = ctx.as(me.id);
    const patch = await agent.patch('/api/me/settings').send({
      notifications: { safety: false, likes: false },
      quietHours: { enabled: false },
      whoCanMessage: 'following',
      reduceMotion: true,
    });
    expect(patch.status).toBe(200);
    const s = patch.body as UserSettings;
    expect(s.notifications.safety).toBe(true);
    expect(s.notifications.likes).toBe(false);
    expect(s.quietHours.enabled).toBe(false);
    expect(s.whoCanMessage).toBe('following');
    expect(s.reduceMotion).toBe(true);
    expect((await agent.get('/api/me/settings')).body).toEqual(s);
    expect((await agent.get('/api/me')).body.settings).toEqual(s);
  });
});

describe('notifications (foundation #31–#32, rendered by this slice)', () => {
  it('filter chips map to categories and anonymous rows carry actor: null', async () => {
    const me = ctx.createUser();
    const fan = ctx.createUser({ follows: [me.id] });
    notify({ userId: me.id, type: 'follow.new', actorId: fan.id, href: `/u/${fan.handle}`, collapse: false });
    notifyAnonymous({ userId: me.id, type: 'buzz.reply', threadId: 'buzz_t1', href: '/buzz/buzz_t1', data: { snippet: 'same' } });
    notify({ userId: me.id, type: 'market.offer', actorId: fan.id, href: '/messages/c1', target: { entityType: 'market_listing', entityId: 'lst_t1' }, data: { amount: 40, title: 'TI-84', listingId: 'lst_t1' } });
    notify({ userId: me.id, type: 'system.announcement', actorId: null, href: '/campus', collapse: false, data: { title: 'Welcome week', body: 'See you there' } });

    const agent = ctx.as(me.id);
    const all = (await agent.get('/api/notifications')).body as NotificationListResponse;
    expect(all.items.map((n) => n.type).sort()).toEqual(['buzz.reply', 'follow.new', 'market.offer', 'system.announcement']);
    expect(all.unreadCount).toBe(4);
    assertHygiene(all);

    const anon = all.items.find((n) => n.type === 'buzz.reply') as Notification;
    expect(anon.anonymous).toBe(true);
    expect(anon.actor).toBeNull();
    expect(anon.thumbnailUrl).toBeNull();
    expect(JSON.stringify(anon)).not.toContain(fan.id);

    const follow = all.items.find((n) => n.type === 'follow.new');
    expect(follow?.anonymous).toBe(false);
    expect(follow && !follow.anonymous ? follow.actor?.id : null).toBe(fan.id);
    expect(follow && !follow.anonymous ? follow.actorFollowedByViewer : null).toBe(false);

    const replies = (await agent.get('/api/notifications?filter=replies')).body as NotificationListResponse;
    expect(replies.items.map((n) => n.type)).toEqual(['buzz.reply']);
    const follows = (await agent.get('/api/notifications?filter=follows')).body as NotificationListResponse;
    expect(follows.items.map((n) => n.type)).toEqual(['follow.new']);
    const market = (await agent.get('/api/notifications?filter=marketplace')).body as NotificationListResponse;
    expect(market.items.map((n) => n.type)).toEqual(['market.offer']);
    expect(market.items[0]!.data).toMatchObject({ amount: 40, title: 'TI-84' });
    const events = (await agent.get('/api/notifications?filter=events')).body as NotificationListResponse;
    expect(events.items).toEqual([]);
    expect((await agent.get('/api/notifications?filter=nope')).status).toBe(400);

    // tap → mark one read; "Mark all read" → everything
    const one = await agent.post('/api/notifications/read').send({ ids: [anon.id] });
    expect(one.status).toBe(200);
    expect(one.body.notifications).toBe(3);
    const everything = await agent.post('/api/notifications/read').send({ ids: 'all' });
    expect(everything.body.notifications).toBe(0);
    expect((await agent.get('/api/notifications')).body.items.every((n: Notification) => n.read)).toBe(true);
  });
});

describe('seed', () => {
  interface Funnel { views: number; cta: number; undo: number; complete: number; start: number; answers: number; total: number }
  function funnel(): Funnel {
    const count = (name: string): number =>
      (ctx.db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE name = ?').get(name) as { n: number }).n;
    return {
      views: count('apartments.page_view'),
      cta: count('apartments.cta_click'),
      undo: count('apartments.cta_undo'),
      complete: count('apartments.survey_complete'),
      start: count('apartments.survey_start'),
      answers: count('apartments.survey_answer'),
      total: (ctx.db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name LIKE 'apartments.%'").get() as { n: number }).n,
    };
  }

  it('Maya joined with the survey unanswered; ~40 rows at lite with answers for ~60 %; funnel ≈ 100 → 38 → 61 %', async () => {
    ctx = await createTestApp({ slices: ['apartments'], seed: 'all' });
    const maya = ctx.as('mayachen');
    const wl = (await maya.get('/api/waitlist/apartments')).body as WaitlistState;
    expect(wl.joined).toBe(true);
    expect(wl.totalCount).toBe(40);
    expect(wl.campusCount).toBeGreaterThanOrEqual(10);
    const survey = (await maya.get('/api/apartments/survey')).body as SurveyState;
    expect(survey.answers).toEqual({});
    expect(survey.completed).toBe(false);

    const waitlisters = ctx.db.prepare("SELECT user_id, university_id FROM waitlist WHERE feature = 'apartments' AND left_at IS NULL").all() as { user_id: string; university_id: string }[];
    expect(waitlisters).toHaveLength(40);
    const universities = ctx.db.prepare('SELECT COUNT(DISTINCT university_id) AS n FROM waitlist').get() as { n: number };
    expect(universities.n).toBeGreaterThanOrEqual(2);

    const answerers = ctx.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM apartment_survey_answers').get() as { n: number };
    expect(answerers.n / waitlisters.length).toBeGreaterThanOrEqual(0.45);
    expect(answerers.n / waitlisters.length).toBeLessThanOrEqual(0.8);
    // every answer row belongs to a waitlister at their own campus, and each survey row is a valid option set
    const onList = new Map(waitlisters.map((w) => [w.user_id, w.university_id]));
    const rows = ctx.db.prepare('SELECT user_id, university_id, question, answer_json FROM apartment_survey_answers').all() as { user_id: string; university_id: string; question: string; answer_json: string }[];
    for (const r of rows) {
      expect(onList.get(r.user_id)).toBe(r.university_id);
      const def = SURVEY.find((q) => q.id === r.question)!;
      const answer = JSON.parse(r.answer_json) as string[];
      expect(answer.length).toBeGreaterThanOrEqual(1);
      expect(answer.length).toBeLessThanOrEqual(def.max);
      for (const id of answer) expect(def.options.map((o) => o.id)).toContain(id);
    }
    // Maya's split from GET /survey would be empty, but the campus split itself is live and non-empty at the hero campus
    const utSplit = ctx.db.prepare("SELECT COUNT(*) AS n FROM apartment_survey_answers WHERE university_id = 'uni_utexas' AND question = 'priorities'").get() as { n: number };
    expect(utSplit.n).toBeGreaterThan(0);

    const f = funnel();
    expect(f.cta).toBeGreaterThanOrEqual(40);
    expect(f.cta / f.views).toBeGreaterThan(0.3);
    expect(f.cta / f.views).toBeLessThan(0.46);
    expect(f.complete / f.cta).toBeGreaterThan(0.48);
    expect(f.complete / f.cta).toBeLessThan(0.74);
    expect(f.start).toBeGreaterThanOrEqual(f.complete);
    expect(f.answers).toBeGreaterThanOrEqual(f.complete * SURVEY.length);
    expect(f.total).toBeGreaterThan(200);

    // every event carries user + university and sits inside the last 30 days
    const bad = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name LIKE 'apartments.%' AND (user_id IS NULL OR university_id IS NULL)")
      .get() as { n: number };
    expect(bad.n).toBe(0);
    const span = ctx.db.prepare("SELECT MIN(created_at) AS lo, MAX(created_at) AS hi FROM analytics_events WHERE name LIKE 'apartments.%'").get() as { lo: number; hi: number };
    expect(span.hi - span.lo).toBeLessThanOrEqual(31 * 24 * 3_600_000);
    // Maya: page views + CTA + a roommates cross-link tap, no survey events (§7.5)
    const mayaEvents = ctx.db.prepare("SELECT name FROM analytics_events WHERE user_id = 'u_mayachen' AND name LIKE 'apartments.%' ORDER BY created_at").all() as { name: string }[];
    expect(mayaEvents.map((e) => e.name)).toContain('apartments.cta_click');
    expect(mayaEvents.map((e) => e.name)).toContain('apartments.roommates_crosslink_click');
    expect(mayaEvents.some((e) => e.name.startsWith('apartments.survey'))).toBe(false);
  });

  it('is deterministic (same rows on a second run)', async () => {
    ctx = await createTestApp({ slices: ['apartments'], seed: 'all' });
    const snapshot = () => ({
      waitlist: ctx.db.prepare("SELECT user_id, university_id, source FROM waitlist WHERE feature = 'apartments' ORDER BY user_id").all(),
      answers: ctx.db.prepare('SELECT id, user_id, question, answer_json FROM apartment_survey_answers ORDER BY id').all(),
      events: ctx.db.prepare("SELECT name, user_id, props_json FROM analytics_events WHERE name LIKE 'apartments.%' ORDER BY user_id, name, props_json").all(),
    });
    const first = snapshot();
    ctx = await createTestApp({ slices: ['apartments'], seed: 'all' });
    expect(snapshot()).toEqual(first);
    expect(first.answers.length).toBeGreaterThan(20);
  });
});
