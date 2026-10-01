/**
 * lib/analytics.ts (SPEC §4.2.13) + route #33: anonymous Buzz events, hidden campuses, never throws,
 * the signed-out allow-list (`PRE_AUTH_ANALYTICS_EVENTS`), unknown names dropped, 204 always.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANON_ANALYTICS_EVENTS, PRE_AUTH_ANALYTICS_EVENTS } from '@shared/core';
import { ANALYTICS_EVENT_NAMES, anonHashFor, trackEvent } from '../../src/lib/analytics';
import { DAY, MIN, now, setNow } from '../../src/lib/clock';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});
afterEach(() => setNow(null));

interface Row { name: string; user_id: string | null; anon_hash: string | null; university_id: string | null; session_id: string | null; props_json: string; created_at: number }
const rows = (name?: string): Row[] =>
  ctx.db.prepare(`SELECT * FROM analytics_events ${name ? 'WHERE name = ?' : ''} ORDER BY created_at, rowid`).all(...(name ? [name] : [])) as Row[];

describe('trackEvent', () => {
  it('stores user + campus + session for public events and keeps the client clock as a prop', () => {
    const me = ctx.createUser();
    const at = now() - MIN;
    trackEvent('listing_view', { userId: me.id, universityId: me.universityId, sessionId: 'sess1' }, { listingId: 'lst_1', price: 40, clientTs: 5 }, at);
    expect(rows('listing_view')).toEqual([
      { id: expect.any(String), name: 'listing_view', user_id: me.id, anon_hash: null, university_id: 'uni_utexas', session_id: 'sess1', props_json: JSON.stringify({ listingId: 'lst_1', price: 40, clientTs: 5 }), created_at: at },
    ]);
  });

  it('ANON_ANALYTICS_EVENTS: user_id NULL, daily-salted anon_hash, minute-floored time, /id$/ props dropped, no session', () => {
    const me = ctx.createUser();
    const t = 1_800_000_123_456;
    setNow(t);
    for (const name of ANON_ANALYTICS_EVENTS) {
      trackEvent(name, { userId: me.id, universityId: me.universityId, sessionId: 'sess1' }, { threadId: 'buzz_0001', entity_id: 'x', replyID: 'y', scope: 'campus', n: 2 });
    }
    const stored = rows();
    expect(stored.length).toBe(ANON_ANALYTICS_EVENTS.length);
    for (const r of stored) {
      expect(r.user_id).toBeNull();
      expect(r.session_id).toBeNull();
      expect(r.anon_hash).toBe(anonHashFor(me.id, t));
      expect(r.anon_hash).not.toContain(me.id);
      expect(r.university_id).toBe('uni_utexas');
      expect(r.created_at).toBe(Math.floor(t / MIN) * MIN);
      expect(JSON.parse(r.props_json)).toEqual({ scope: 'campus', n: 2 });
    }
    // the hash rotates daily and differs per user
    expect(anonHashFor(me.id, t + DAY)).not.toBe(anonHashFor(me.id, t));
    expect(anonHashFor(ctx.createUser().id, t)).not.toBe(anonHashFor(me.id, t));
  });

  it('never throws (unknown name, bad props, missing user) and nulls hidden campuses', () => {
    expect(() => trackEvent('not_a_real_event' as never, { userId: 'ghost', universityId: 'nope' }, { a: {} as never, b: Number.NaN, c: 'x'.repeat(400) })).not.toThrow();
    expect(rows().length).toBe(0);
    trackEvent('app_open', { userId: null, universityId: null }, { a: {} as never, b: Number.NaN, c: 'x'.repeat(400) });
    expect(JSON.parse(rows('app_open')[0]!.props_json)).toEqual({ c: 'x'.repeat(200) });
    ctx.db.prepare("INSERT INTO universities (id, name, short_name, domain, is_hidden, created_at) VALUES ('uni_team','UniVerse Team','Team','team.universe.invalid',1,?)").run(now());
    const staff = ctx.createUser({ universityId: 'uni_team' });
    trackEvent('login', { userId: staff.id, universityId: staff.universityId });
    expect(rows('login')[0]).toMatchObject({ user_id: staff.id, university_id: null });
  });

  it('exposes every AnalyticsEventName at runtime', () => {
    expect(ANALYTICS_EVENT_NAMES).toEqual(expect.arrayContaining([...ANON_ANALYTICS_EVENTS, ...PRE_AUTH_ANALYTICS_EVENTS, 'apartments.cta_click', 'listing_sold']));
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });
});

describe('POST /analytics/track (#33)', () => {
  it('signed-out: only PRE_AUTH_ANALYTICS_EVENTS are stored, with user_id NULL and university_id NULL; still 204', async () => {
    const res = await ctx.anon().post('/api/analytics/track').send({
      events: [
        { name: 'app_open', props: { source: 'pwa' }, ts: 123 },
        { name: 'signup_started' }, { name: 'signup_code_sent' }, { name: 'invite_link_opened', props: { code: 'MAYA2026' } },
        { name: 'reel_view', props: { reelId: 'r1' } }, { name: 'buzz_feed_view' }, { name: 'login' }, { name: 'made_up' },
      ],
    });
    expect(res.status).toBe(204);
    const stored = rows();
    expect(stored.map((r) => r.name).sort()).toEqual([...PRE_AUTH_ANALYTICS_EVENTS].sort());
    for (const r of stored) expect(r).toMatchObject({ user_id: null, university_id: null, anon_hash: null, session_id: null });
    expect(JSON.parse(stored.find((r) => r.name === 'app_open')!.props_json)).toEqual({ source: 'pwa', clientTs: 123 });
    expect((await ctx.anon().post('/api/analytics/track').send({ events: [] })).status).toBe(204);
    expect((await ctx.anon().post('/api/analytics/track').send({ events: [{ name: 'made_up' }] })).status).toBe(204);
    expect((await ctx.anon().post('/api/analytics/track').send({ events: Array.from({ length: 51 }, () => ({ name: 'app_open' })) })).status).toBe(400);
    expect((await ctx.anon().post('/api/analytics/track').send({ events: [{ name: 'app_open', props: { nested: { a: 1 } } }] })).status).toBe(400);
  });

  it('signed-in: every known name is stored with user + campus + session; Buzz names go anonymous; unknown names dropped', async () => {
    const me = ctx.createUser();
    const res = await ctx.as(me.id).post('/api/analytics/track').send({
      events: [{ name: 'reel_view', props: { reelId: 'r1' } }, { name: 'buzz_vote', props: { threadId: 'b1', dir: 'up' } }, { name: 'nope' }, { name: 'app_open' }],
    });
    expect(res.status).toBe(204);
    const stored = rows();
    expect(stored.map((r) => r.name).sort()).toEqual(['app_open', 'buzz_vote', 'reel_view']);
    expect(stored.find((r) => r.name === 'reel_view')).toMatchObject({ user_id: me.id, university_id: 'uni_utexas', session_id: expect.any(String) });
    expect(stored.find((r) => r.name === 'app_open')).toMatchObject({ user_id: me.id, university_id: 'uni_utexas' });
    const anon = stored.find((r) => r.name === 'buzz_vote')!;
    expect(anon).toMatchObject({ user_id: null, session_id: null, university_id: 'uni_utexas', anon_hash: expect.any(String) });
    expect(JSON.parse(anon.props_json)).toEqual({ dir: 'up' });
    // onboarding is NOT required for tracking (optionalAuth only)
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL WHERE id = ?').run(fresh.id);
    expect((await ctx.as(fresh.id).post('/api/analytics/track').send({ events: [{ name: 'onboarding_step', props: { step: 'profile' } }] })).status).toBe(204);
    expect(rows('onboarding_step')[0]).toMatchObject({ user_id: fresh.id });
  });
});
