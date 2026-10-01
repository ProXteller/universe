/**
 * Content registry + cards (SPEC §4.2.10, §4.3 #39): registries never throw and restore on unregister; resolveCard
 * never throws, applies block + status rules, fills currency, forces ownerId null for buzz; the foundation `profile`
 * resolver + adapter; the profile card endpoint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { now } from '../../src/lib/clock';
import { getContentAdapter, registerCardResolver, registerContentAdapter, resolveCard, runUserLifecycleHooks, registerUserLifecycleHook } from '../../src/lib/content';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});

describe('registries', () => {
  it('registering never throws, malformed adapters are ignored, last write wins, unregister restores', () => {
    expect(() => registerContentAdapter(null as never)).not.toThrow();
    expect(() => registerContentAdapter({ entityType: 'reel' } as never)).not.toThrow();
    expect(getContentAdapter('reel')).toBeNull();
    const a = { entityType: 'reel' as const, load: () => null, setStatus: () => {} };
    const b = { entityType: 'reel' as const, load: () => null, setStatus: () => {} };
    const unA = registerContentAdapter(a);
    const unB = registerContentAdapter(b);
    expect(getContentAdapter('reel')).toBe(b);
    unA(); // out of order: leaves b alone
    expect(getContentAdapter('reel')).toBe(b);
    unB();
    expect(getContentAdapter('reel')).toBe(a);
    unA();
    expect(getContentAdapter('reel')).toBeNull();
    const calls: string[] = [];
    const un = registerUserLifecycleHook('t', { onBanned: (id) => calls.push(id) });
    runUserLifecycleHooks('onBanned', 'u_x');
    un();
    runUserLifecycleHooks('onBanned', 'u_y');
    expect(calls).toEqual(['u_x']);
  });
});

describe('resolveCard', () => {
  it('unknown kind / missing item → unavailable with the viewer currency; never throws', () => {
    const card = resolveCard({ kind: 'listing', id: 'nope' }, 'u_mayachen');
    expect(card).toMatchObject({ kind: 'listing', id: 'nope', status: 'unavailable', title: 'No longer available', currency: 'USD', ownerId: null, price: null });
    const un = registerCardResolver('listing', () => {
      throw new Error('boom');
    });
    expect(resolveCard({ kind: 'listing', id: 'x' }, 'u_mayachen').status).toBe('unavailable');
    un();
  });

  it('applies the block rule (both directions) and the owner status rule; fills currency from the OWNER campus', () => {
    const un = registerCardResolver('listing', (id) => ({
      title: `Listing ${id}`, subtitle: null, imageUrl: null, href: `/market/${id}`, status: 'available', price: 40, badge: null,
      ownerId: 'u_liamtrem', meetupSpot: 'Main library lobby',
    }));
    try {
      const ok = resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen');
      expect(ok).toMatchObject({ status: 'available', ownerId: 'u_liamtrem', price: 40, meetupSpot: 'Main library lobby' });
      expect(ok.currency).toBe('CAD'); // the OWNER's campus (U of T), not the viewer's USD
      ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run('u_liamtrem', 'u_mayachen', now());
      expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_mayachen').status).toBe('unavailable');
      expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_arjunp').status).toBe('available');
      ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u_liamtrem'").run();
      expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_arjunp').status).toBe('unavailable');
      // the owner still sees their own card
      expect(resolveCard({ kind: 'listing', id: 'l1' }, 'u_liamtrem').status).toBe('available');
    } finally {
      un();
    }
  });

  it('buzz cards never carry an owner or image', () => {
    const un = registerCardResolver('buzz', () => ({
      title: 'snippet', subtitle: 'Buzz · UT', imageUrl: '/x.png', href: '/buzz/t1', status: 'available', price: null, badge: null,
      ownerId: 'u_mayachen' as never, meetupSpot: null,
    }));
    try {
      const card = resolveCard({ kind: 'buzz', id: 't1' }, 'u_arjunp');
      expect(card.ownerId).toBeNull();
      expect(card.imageUrl).toBeNull();
      expect(card.status).toBe('available');
    } finally {
      un();
    }
  });
});

describe('foundation profile resolver + adapter', () => {
  it('GET /cards/profile/:id resolves a public profile; blocked / suspended / missing → unavailable', async () => {
    const maya = ctx.as('mayachen');
    const res = await maya.get('/api/cards/profile/u_arjunp');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'profile', id: 'u_arjunp', status: 'available', ownerId: 'u_arjunp', href: '/u/arjunp', price: null, currency: 'USD' });
    expect(res.body.subtitle).toContain('@arjunp');
    expect(res.body.imageUrl).toMatch(/^\/(api\/avatars|uploads|seed-media)\//);
    expect(res.body.title.length).toBeGreaterThan(1);
    expect(JSON.stringify(res.body)).not.toContain('@utexas.edu');
    expect((await maya.get('/api/cards/profile/u_nobody')).body.status).toBe('unavailable');
    await maya.post('/api/users/u_arjunp/block');
    expect((await maya.get('/api/cards/profile/u_arjunp')).body.status).toBe('unavailable');
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'u_bellarossi'").run();
    expect((await maya.get('/api/cards/profile/u_bellarossi')).body.status).toBe('unavailable');
    expect((await ctx.anon().get('/api/cards/profile/u_arjunp')).status).toBe(401);
  });

  it('the profile adapter loads a snapshot and setStatus blanks the offending profile text', () => {
    const adapter = getContentAdapter('profile');
    expect(adapter).not.toBeNull();
    ctx.db.prepare("UPDATE users SET bio = 'call me maybe', avatar_url = '/uploads/x.jpg' WHERE id = 'u_arjunp'").run();
    const snap = adapter!.load('u_arjunp');
    expect(snap).toMatchObject({ entityType: 'profile', entityId: 'u_arjunp', authorId: 'u_arjunp', status: 'active', surface: 'profile', anon: false, autoHideImmune: true, label: 'profile', href: '/u/arjunp' });
    expect(snap!.fields.map((f) => f.field)).toEqual(['name', 'bio']);
    expect(snap!.media).toEqual([{ url: '/uploads/x.jpg', kind: 'image' }]);
    expect(adapter!.load('nope')).toBeNull();
    adapter!.setStatus('u_arjunp', 'active');
    expect((ctx.db.prepare("SELECT bio FROM users WHERE id = 'u_arjunp'").get() as any).bio).toBe('call me maybe');
    adapter!.setStatus('u_arjunp', 'removed');
    expect(ctx.db.prepare("SELECT bio, avatar_url FROM users WHERE id = 'u_arjunp'").get()).toEqual({ bio: '', avatar_url: null });
    ctx.db.prepare("UPDATE users SET status = 'banned' WHERE id = 'u_arjunp'").run();
    expect(adapter!.load('u_arjunp')?.status).toBe('removed');
  });
});
