/**
 * FULL-MODE integration tests (SPEC §4.2.16 full mode, §7.5, §8 "Foundation done when"): the static routes/index.ts,
 * every schema and every seed. Checks that need a slice to have landed SKIP GRACEFULLY while that slice's router is
 * still the empty stub (a stub router has no routes), so the file stays green through the feature phase and lights
 * up at integration time. Everything foundation owns end-to-end runs unconditionally.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Router } from 'express';
import { GUIDELINES_VERSION } from '@shared/core';
import { DAY, now } from '../../src/lib/clock';
import { applySanction } from '../../src/lib/moderation/staff';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../../src/lib/testing';
import { SLICE_MOUNTS, type SliceName } from '../../src/routes/mounts';
import { DEMO, U } from '../../src/db/seeds/ids';

let ctx: TestCtx;
const stubs = new Set<SliceName>();

async function routeCount(slice: SliceName): Promise<number> {
  const mod = (await import(`../../src/routes/${slice}.ts`)) as { default: Router };
  return ((mod.default as unknown as { stack?: unknown[] }).stack ?? []).length;
}

const skipUnless = (t: { skip: (note?: string) => void }, slices: SliceName[]): boolean => {
  const missing = slices.filter((s) => stubs.has(s));
  if (missing.length === 0) return false;
  t.skip(`skipped: slice router(s) still stubbed — ${missing.join(', ')}`);
  return true;
};

beforeAll(async () => {
  ctx = await createTestApp({ seed: 'all' });
  for (const m of SLICE_MOUNTS) if ((await routeCount(m.slice)) === 0) stubs.add(m.slice);
});

describe('full mode boots with every router, schema and seed', () => {
  it('health + core seed invariants hold with every slice loaded', async () => {
    const health = await ctx.anon().get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, name: 'UniVerse' });
    const maya = ctx.db.prepare('SELECT following_count, follower_count, invite_code, status FROM users WHERE id = ?').get(U.mayachen) as any;
    expect(maya).toEqual({ following_count: 28, follower_count: 41, invite_code: 'MAYA2026', status: 'active' });
    const me = await ctx.as(DEMO.student).get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ handle: 'mayachen', email: 'maya.chen@utexas.edu', role: 'user', activeSanction: null });
    // every denormalised counter still equals its rows after ALL seeds ran
    const off = ctx.db.prepare(
      `SELECT COUNT(*) AS n FROM users u WHERE u.follower_count != (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id)
         OR u.following_count != (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id)`,
    ).get() as { n: number };
    expect(off.n).toBe(0);
  });

  it('every slice mount is guarded: signed-out → 401, signed-in unknown path → 404, non-onboarded → 403 onboarding_required', async () => {
    const fresh = ctx.createUser();
    ctx.db.prepare('UPDATE users SET guidelines_version = NULL, guidelines_accepted_at = NULL WHERE id = ?').run(fresh.id);
    const notOnboarded = ctx.as(fresh.id);
    const maya = ctx.as(DEMO.student);
    for (const m of SLICE_MOUNTS) {
      const path = `/api${m.mount}/__integration_probe__`;
      const anon = await ctx.anon().get(path);
      expect(anon.status, `${m.slice} signed-out`).toBe(401);
      expect(anon.body.error.code).toBe('unauthenticated');
      const signedIn = await maya.get(path);
      expect(signedIn.status, `${m.slice} unknown path`).toBe(404);
      const gated = await notOnboarded.get(path);
      if (m.onboarded) {
        expect(gated.status, `${m.slice} onboarding gate`).toBe(403);
        expect(gated.body.error.code).toBe('onboarding_required');
      } else {
        expect(gated.status, `${m.slice} (auth slice: requireAuth only)`).toBe(404);
      }
    }
    // the admin surface does not admit it exists to non-staff, stub or not
    expect((await maya.get('/api/admin/queue')).status).toBe(404);
  });

  it('a suspended session reaches only the allow-list — on every mount and every core route', async () => {
    const user = ctx.createUser();
    const sid = applySanction({ userId: user.id, kind: 'suspension', durationMs: 7 * DAY, category: 'hate', actor: 'system' });
    const s = ctx.as(user.id);
    expect((await s.get('/api/me')).body.activeSanction).toMatchObject({ id: sid, kind: 'suspension' });
    for (const m of SLICE_MOUNTS) {
      const res = await s.get(`/api${m.mount}/__integration_probe__`);
      expect(res.status, m.slice).toBe(403);
      expect(res.body.error.code).toBe('suspended');
    }
    for (const path of ['/api/me/badges', '/api/me/blocks', '/api/notifications', '/api/users/search?q=a', '/api/universities/me', '/api/share/targets']) {
      const res = await s.get(path);
      expect(res.status, path).toBe(403);
    }
    expect((await s.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'x', reason: 'hate' })).status).toBe(403);
    expect((await s.get('/api/me/sanctions')).status).toBe(200);
    expect((await s.post(`/api/me/sanctions/${sid}/ack`)).status).toBe(204);
    expect((await s.post('/api/appeals').send({ sanctionId: sid, text: 'Please take another look.' })).status).toBe(201);
    expect((await s.post('/api/auth/logout')).status).toBe(204);
    expect((await s.get('/api/me')).status).toBe(401);
  });
});

describe('demo-user invariants that need every slice (skip while stubbed)', () => {
  it('Maya: 12 notifications, 7 unread; GET /me/badges → notifications 7 twice in a row (§7.5)', async (t) => {
    if (skipUnless(t, ['reels', 'buzz', 'orbit', 'messages', 'market', 'campus', 'roommates', 'apartments', 'admin'])) return;
    const counts = ctx.db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM notifications WHERE user_id = ?').get(U.mayachen) as any;
    expect(counts).toEqual({ total: 12, unread: 7 });
    const maya = ctx.as(DEMO.student);
    const first = await maya.get('/api/me/badges');
    expect(first.status).toBe(200);
    expect(first.body.notifications).toBe(7);
    const second = await maya.get('/api/me/badges');
    expect(second.body.notifications).toBe(7); // the lazy hooks (reminders, still-looking, poll-closed) add nothing
    const list = await maya.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(7);
    expect(list.body.items.length).toBe(12);
    expect(first.body.requests).toBe(3); // messages 2 + market's chloedub request
  });

  it('Buzz firewall smoke: feed, thread and mine carry no forbidden key and no seeded identity string (skips while buzz is stubbed)', async (t) => {
    if (skipUnless(t, ['buzz'])) return;
    const maya = ctx.as(DEMO.student);
    const strings = ctx.seededIdentityStrings();
    const feed = await maya.get('/api/buzz/feed?sort=new&scope=campus');
    expect(feed.status, JSON.stringify(feed.body)).toBe(200);
    expect(feed.headers['cache-control']).toContain('no-store');
    assertNoForbiddenKeys(feed.body);
    assertNoIdentityLeak(feed.body, strings);
    const firstId: string | undefined = feed.body.items?.[0]?.id;
    if (firstId) {
      const thread = await maya.get(`/api/buzz/${firstId}`);
      expect(thread.status).toBe(200);
      assertNoForbiddenKeys(thread.body);
      assertNoIdentityLeak(thread.body, strings);
    }
    const mine = await maya.get('/api/buzz/mine?kind=threads');
    expect(mine.status).toBe(200);
    assertNoForbiddenKeys(mine.body);
    assertNoIdentityLeak(mine.body, strings);
    // no Buzz row ever reaches the public surfaces
    const profile = await maya.get('/api/users/mayachen');
    expect(profile.status).toBe(200);
    const buzzTexts = (ctx.db.prepare('SELECT text FROM buzz_posts WHERE author_id = ? LIMIT 5').all(U.mayachen) as { text: string }[]).map((r) => r.text).filter((s) => s.length > 20);
    assertNoIdentityLeak(profile.body, buzzTexts);
  });

  it('admin seed: 9 open / 14 closed queue items, 20 audit rows incl. one buzz_unmask, ryanoc muted (skips while admin is stubbed)', async (t) => {
    if (skipUnless(t, ['admin'])) return;
    // Only the admin seed's own rows (`kit.id('mq', n)` → `mq_NNNN`): the shared ctx also holds the `source:'appeal'` item that
    // the allow-list test above created through POST /appeals (§4.3 #19), which is runtime state, not seed state.
    const open = (ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE status != 'closed' AND id LIKE 'mq\\_%' ESCAPE '\\'").get() as { n: number }).n;
    const closed = (ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE status = 'closed' AND id LIKE 'mq\\_%' ESCAPE '\\'").get() as { n: number }).n;
    expect({ open, closed }).toEqual({ open: 9, closed: 14 });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'buzz_unmask'").get() as { n: number }).n).toBe(1);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action != 'role_bootstrap'").get() as { n: number }).n).toBeGreaterThanOrEqual(20);
    const mute = ctx.db.prepare("SELECT * FROM user_sanctions WHERE user_id = ? AND kind = 'mute' AND lifted_at IS NULL AND ends_at > ?").get(U.ryanoc, now()) as any;
    expect(mute).toBeTruthy();
    expect(mute.entity_type === null || !['buzz', 'buzz_reply'].includes(mute.entity_type)).toBe(true); // public origin
    // seeded anon-origin audit rows never target a user (§4.2.14 rule 3)
    const leak = ctx.db.prepare(
      `SELECT COUNT(*) AS n FROM audit_log a JOIN mod_queue q ON q.id = a.queue_id
        WHERE q.entity_type IN ('buzz','buzz_reply') AND a.target_type = 'user' AND a.action != 'buzz_unmask'`,
    ).get() as { n: number };
    expect(leak.n).toBe(0);
    // the moderator's audit list is served through serializeAuditRow: nothing there names a Buzz author
    const mod = ctx.as(DEMO.moderator);
    const audit = await mod.get('/api/admin/audit');
    expect(audit.status).toBe(200);
    const buzzAuthors = (ctx.db.prepare("SELECT DISTINCT author_id FROM mod_queue WHERE entity_type IN ('buzz','buzz_reply') AND author_id IS NOT NULL").all() as { author_id: string }[]).map((r) => r.author_id);
    for (const row of audit.body.items as { targetType: string | null; targetId: string | null }[]) {
      if (row.targetType === 'user' && row.targetId) expect(buzzAuthors, JSON.stringify(row)).not.toContain(row.targetId);
    }
  });
});

describe('cross-slice seams foundation owns (run regardless of stubs)', () => {
  it('every seeded user is onboarded on the current guidelines and no seed left a non-active demo account', () => {
    const bad = ctx.db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE id LIKE 'u\\_%' ESCAPE '\\' AND (guidelines_version != ? OR onboarding_completed_at IS NULL OR status != 'active')",
    ).get(GUIDELINES_VERSION) as { n: number };
    expect(bad.n).toBe(0);
  });

  it('the notification table never holds an anonymous row with an actor (CHECK) and every row belongs to an existing user', () => {
    expect(() => ctx.db.prepare(
      "INSERT INTO notifications (id, user_id, type, category, anonymous, actor_id, actor_count, href, data_json, created_at) VALUES ('bad_row', ?, 'buzz.reply', 'buzz', 1, ?, 1, '/buzz/x', '{}', ?)",
    ).run(U.mayachen, U.arjunp, now())).toThrowError();
    const orphans = ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE u.id IS NULL').get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});
