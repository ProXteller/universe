import { Router } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ApiError, decodeCursor, encodeCursor, keysetWhere, paginate } from '../../src/lib/http';
import { createTestApp, overrideConfig, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});

describe('cursors', () => {
  it('round-trips and rejects tampering with 400 invalid_cursor', () => {
    const c = encodeCursor({ k: 1_700_000_000_000, id: 'abc' });
    expect(decodeCursor(c)).toEqual({ k: 1_700_000_000_000, id: 'abc' });
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    const tampered = `${c.slice(0, -2)}${c.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(() => decodeCursor(tampered)).toThrow(ApiError);
    try {
      decodeCursor(tampered);
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe('invalid_cursor');
    }
    const [payload] = c.split('.');
    const forged = `${Buffer.from(JSON.stringify([0, 'zzz'])).toString('base64url')}.${c.split('.')[1]}`;
    expect(() => decodeCursor(forged)).toThrow(ApiError);
    expect(() => decodeCursor(payload!)).toThrow(ApiError);
    expect(() => decodeCursor('garbage')).toThrow(ApiError);
  });

  it('cursor tamper on an endpoint → 400', async () => {
    const maya = ctx.as('mayachen');
    const ok = await maya.get('/api/users/u_mayachen/followers').query({ limit: 5 });
    expect(ok.body.nextCursor).toBeTruthy();
    const bad = await maya.get('/api/users/u_mayachen/followers').query({ limit: 5, cursor: `${ok.body.nextCursor}x` });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_cursor');
    const bad2 = await maya.get('/api/me/blocks').query({ cursor: 'eyJrIjoxfQ.nope' });
    expect(bad2.status).toBe(400);
    expect(bad2.body.error.code).toBe('invalid_cursor');
  });

  it('paginate fetches limit + 1 and keysetWhere builds the fragment', () => {
    const rows = [3, 2, 1].map((k) => ({ k, id: `r${k}` }));
    const page = paginate(rows, 2, (r) => ({ k: r.k, id: r.id }), (r) => r.id);
    expect(page.items).toEqual(['r3', 'r2']);
    expect(decodeCursor(page.nextCursor!)).toEqual({ k: 2, id: 'r2' });
    const last = paginate(rows.slice(2), 2, (r) => ({ k: r.k, id: r.id }), (r) => r.id);
    expect(last.nextCursor).toBeNull();
    expect(keysetWhere('created_at', 'id', null, 'desc')).toEqual({ sql: '1 = 1', params: [] });
    expect(keysetWhere('created_at', 'id', { k: 5, id: 'x' }, 'desc')).toEqual({
      sql: '(created_at < ? OR (created_at = ? AND id < ?))', params: [5, 5, 'x'],
    });
    expect(keysetWhere('created_at', 'id', { k: 5, id: 'x' }, 'asc').sql).toContain('>');
  });
});

describe('validation & errors', () => {
  it('returns 400 validation_failed with flattened details', async () => {
    const res = await ctx.as('mayachen').get('/api/users/search').query({ q: 'x', limit: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.fieldErrors.limit).toBeTruthy();
    const body = await ctx.anon().post('/api/auth/start').set('Content-Type', 'application/json').send('{bad json');
    expect(body.status).toBe(400);
    expect(body.body.error.code).toBe('bad_request');
  });

  it('unknown api paths → 404 JSON; health is public', async () => {
    const res = await ctx.anon().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    const health = await ctx.anon().get('/api/health');
    expect(health.body).toEqual({ ok: true, name: 'UniVerse' });
  });

  it('serves generated avatars (#40) as immutable SVG', async () => {
    const res = await ctx.anon().get('/api/avatars/u_mayachen.svg').query({ t: 'student' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toContain('immutable');
    const svgText = (r: { text?: string; body: unknown }): string => r.text ?? String(r.body);
    expect(svgText(res).startsWith('<svg')).toBe(true);
    const org = await ctx.anon().get('/api/avatars/o_wic_ut.svg').query({ t: 'org' });
    expect(svgText(org).startsWith('<svg')).toBe(true);
    expect(svgText(org)).not.toBe(svgText(res));
    const me = await ctx.as('mayachen').get('/api/me');
    expect(me.body.avatarUrl).toBe('/api/avatars/u_mayachen.svg?t=student');
  });

  it("'trust proxy' is one hop outside production and TRUST_PROXY (default 0) in production", () => {
    const router = Router();
    const saved = process.env.TRUST_PROXY;
    try {
      delete process.env.TRUST_PROXY;
      expect(createApp(router).get('trust proxy')).toBe(1);
      const restore = overrideConfig({ env: 'production' });
      try {
        expect(createApp(router).get('trust proxy')).toBe(0); // no proxy assumed: a forged X-Forwarded-For never changes req.ip
        process.env.TRUST_PROXY = '2';
        expect(createApp(router).get('trust proxy')).toBe(2);
        process.env.TRUST_PROXY = 'loopback';
        expect(() => createApp(router)).toThrow(/TRUST_PROXY/);
      } finally {
        restore();
      }
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = saved;
    }
  });

  it('audit_log is append-only (UPDATE / DELETE raise)', () => {
    ctx.db.prepare("INSERT INTO audit_log (id, actor_id, actor_role, action, created_at) VALUES ('a1','system','system','test',1)").run();
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'x' WHERE id = 'a1'").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM audit_log WHERE id = 'a1'").run()).toThrow(/append-only/);
    expect(() =>
      ctx.db.prepare("INSERT INTO notifications (id, user_id, type, category, anonymous, actor_id, href, created_at) VALUES ('n','u_mayachen','buzz.reply','buzz',1,'u_arjunp','/',1)").run(),
    ).toThrow(/CHECK/);
  });
});
