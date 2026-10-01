/**
 * Stubs check (SPEC §4.6 / §8): every slice stub exists, every §4.3 endpoint is mounted, the registries behave, and
 * no `client/src/features/<slice>/index.ts` shadows the `index.tsx` entry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { getContentAdapter, registerCardResolver, registerContentAdapter, registerUserLifecycleHook, resolveCard, runUserLifecycleHooks, type ContentAdapter } from '../../src/lib/content';
import { registerNotificationHook, runNotificationHooks } from '../../src/lib/notify';
import { listRulePacks, registerRulePack, setRulePackEnabled } from '../../src/lib/moderation/index';
import { SLICE_MOUNTS } from '../../src/routes/mounts';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SLICES = ['auth', 'reels', 'buzz', 'orbit', 'discover', 'messages', 'roommates', 'market', 'campus', 'apartments', 'admin'] as const;

describe('slice stubs', () => {
  it('server + shared stub files exist for all eleven slices', () => {
    SLICES.forEach((s, i) => {
      const nn = String(i + 1).padStart(2, '0');
      for (const f of [
        `server/src/routes/${s}.ts`, `server/src/db/schema/${nn}-${s}.sql`, `server/src/db/seeds/${nn}-${s}.ts`,
        `server/tests/${s}.test.ts`, `shared/src/${s}.ts`,
      ]) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    });
    expect(SLICE_MOUNTS.map((m) => m.slice)).toEqual([...SLICES]);
    expect(SLICE_MOUNTS.find((m) => m.slice === 'auth')?.onboarded).toBe(false);
  });

  it('no client feature has a sibling index.ts that would shadow index.tsx', () => {
    const features = path.join(ROOT, 'client/src/features');
    if (!fs.existsSync(features)) return; // the client lanes have not created it yet
    for (const dir of fs.readdirSync(features)) {
      expect(fs.existsSync(path.join(features, dir, 'index.ts')), `client/src/features/${dir}/index.ts must not exist`).toBe(false);
    }
  });

  it('never calls Date.now() outside lib/clock.ts', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts') && !p.endsWith(`lib${path.sep}clock.ts`) && /\bDate\.now\(\)/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'server/src'));
    expect(offenders).toEqual([]);
  });
});

describe('every §4.3 endpoint is mounted (full mode)', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('answers something other than 404 for every foundation path, and slice mounts are gated by auth', async () => {
    const maya = ctx.as('mayachen');
    // #18 answers a generic 404 for a sanction that is not the caller's, so probe it with a real warning row (S-M3)
    ctx.db.prepare(
      "INSERT INTO user_sanctions (id, user_id, kind, scope, category, starts_at, effective_at, created_at) VALUES ('san_probe', 'u_mayachen', 'warning', 'all', NULL, 1, 1, 1)",
    ).run();
    const paths: [string, string][] = [
      ['get', '/api/me/badges'], ['get', '/api/me/blocks'], ['get', '/api/me/invite'], ['get', '/api/me/sanctions'],
      ['post', '/api/me/sanctions/san_probe/ack'], ['post', '/api/appeals'], ['get', '/api/users/search?q=a'],
      ['get', '/api/universities/me'], ['get', '/api/universities/me/places'], ['post', '/api/uploads'], ['post', '/api/reports'],
      ['get', '/api/notifications'], ['post', '/api/notifications/read'], ['post', '/api/analytics/track'],
      ['get', '/api/waitlist/apartments'], ['post', '/api/waitlist/apartments'], ['delete', '/api/waitlist/apartments'],
      ['post', '/api/dm'], ['get', '/api/share/targets'], ['post', '/api/share'], ['get', '/api/cards/listing/x'],
    ];
    for (const [method, p] of paths) {
      const res = await (maya as any)[method](p).send({});
      expect(res.status, `${method.toUpperCase()} ${p}`).not.toBe(404);
      if (res.status === 501) expect(res.body.error.code, p).toBe('not_implemented');
    }
    for (const m of SLICE_MOUNTS) {
      const anon = await ctx.anon().get(`/api${m.mount}/whatever`);
      expect(anon.status, m.mount).toBe(401);
    }
    const card = await maya.get('/api/cards/listing/nope');
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ kind: 'listing', id: 'nope', status: 'unavailable', title: 'No longer available', currency: 'USD' });
    const track = await ctx.anon().post('/api/analytics/track').send({ events: [{ name: 'app_open' }] });
    expect(track.status).toBe(204);
  });
});

describe('isolation mode', () => {
  it('mounts only the named slice routers (dynamic import) and only their schemas', async () => {
    const ctx = await createTestApp({ slices: ['market'] });
    expect((await ctx.anon().get('/api/market/anything')).status).toBe(401); // mounted → requireAuth answers
    expect((await ctx.anon().get('/api/buzz/anything')).status).toBe(404); // not mounted
    expect((await ctx.as('mayachen').get('/api/me')).status).toBe(200);
  });
});

describe('registries: last write wins, never throw, unregister restores', () => {
  it('content adapters + card resolvers + lifecycle hooks + notification hooks + rule packs', async () => {
    await createTestApp({ slices: [] });
    // The full-mode describe above already imported routes/index.ts, so the reels slice's real adapter is registered for
    // 'reel' in this process (registries are module-level). "Restore" therefore means back to that baseline, not null.
    const base = getContentAdapter('reel');
    const a1: ContentAdapter = { entityType: 'reel', load: () => null, setStatus: () => {} };
    const a2: ContentAdapter = { entityType: 'reel', load: () => null, setStatus: () => {} };
    const un1 = registerContentAdapter(a1);
    const un2 = registerContentAdapter(a2);
    expect(getContentAdapter('reel')).toBe(a2);
    un2();
    expect(getContentAdapter('reel')).toBe(a1);
    un1();
    expect(getContentAdapter('reel')).toBe(base);
    // out-of-order unregister leaves the newer entry alone; the newer one's unregister restores the older
    const un3 = registerContentAdapter(a1);
    const un4 = registerContentAdapter(a2);
    un3();
    expect(getContentAdapter('reel')).toBe(a2);
    un4();
    expect(getContentAdapter('reel')).toBe(a1);
    un3();
    expect(getContentAdapter('reel')).toBe(base);

    const unCard = registerCardResolver('listing', (id) => ({
      title: `Listing ${id}`, subtitle: null, imageUrl: null, href: `/market/${id}`, status: 'available', price: 40, badge: null,
      ownerId: 'u_arjunp', meetupSpot: null,
    }));
    const card = resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen');
    expect(card).toMatchObject({ kind: 'listing', id: 'l1', title: 'Listing l1', price: 40, currency: 'USD', ownerId: 'u_arjunp' });
    const unThrow = registerCardResolver('listing', () => {
      throw new Error('boom');
    });
    expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen').status).toBe('unavailable');
    unThrow();
    expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen').status).toBe('available');
    unCard();
    expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen').status).toBe('unavailable');

    const seen: string[] = [];
    const unHook = registerUserLifecycleHook('t', { onDeleted: (id) => seen.push(id), onBanned: () => { throw new Error('x'); } });
    runUserLifecycleHooks('onBanned', 'u');
    runUserLifecycleHooks('onDeleted', 'u_x');
    expect(seen).toEqual(['u_x']);
    unHook();
    runUserLifecycleHooks('onDeleted', 'u_y');
    expect(seen).toEqual(['u_x']);

    const calls: string[] = [];
    const unA = registerNotificationHook('n', () => calls.push('a'));
    const unB = registerNotificationHook('n', () => calls.push('b'));
    runNotificationHooks('u');
    expect(calls).toEqual(['b']);
    unB();
    runNotificationHooks('u');
    expect(calls).toEqual(['b', 'a']);
    unA();

    registerRulePack({ id: 'test.pack', version: '1', rules: [] });
    registerRulePack({ id: 'test.pack', version: '2', rules: [] });
    expect(listRulePacks().filter((p) => p.id === 'test.pack')).toEqual([{ id: 'test.pack', version: '2', ruleCount: 0, enabled: true }]);
    setRulePackEnabled('test.pack', false);
    expect(listRulePacks().find((p) => p.id === 'test.pack')?.enabled).toBe(false);
  });
});
