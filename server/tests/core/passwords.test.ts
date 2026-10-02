/**
 * Optional password sign-in + two-factor (DECISIONS D9): POST /auth/password/{login,verify,resend},
 * GET /me/security, PUT/DELETE /me/password, PUT /me/two-factor.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '@shared/core';
import { MIN, now, setNow } from '../../src/lib/clock';
import { setMailer } from '../../src/lib/mailer';
import { PASSWORD_LOCK_MS, PASSWORD_MAX_FAILS } from '../../src/lib/passwords';
import { createTestApp, overrideConfig, resetTestState, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
let restore: (() => void)[] = [];

beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});
afterEach(() => {
  for (const r of restore.splice(0)) r();
  setMailer(null);
  resetTestState();
});

const EMAIL = 'maya.chen@utexas.edu';
const GOOD = 'correct horse battery';

async function givePassword(password = GOOD) {
  const res = await ctx.as('u_mayachen').put('/api/me/password').send({ newPassword: password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

describe('setting a password', () => {
  it('starts with none, sets one, stores only a scrypt hash, and reports it on /me/security', async () => {
    const before = await ctx.as('u_mayachen').get('/api/me/security');
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ hasPassword: false, twoFactor: false, passwordSetAt: null });

    const set = await givePassword();
    expect(set.body.hasPassword).toBe(true);
    expect(set.body.twoFactor).toBe(false);
    expect(typeof set.body.passwordSetAt).toBe('number');
    expect(JSON.stringify(set.body)).not.toContain('scrypt');

    const row = ctx.db.prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?').get('u_mayachen') as { password_hash: string };
    expect(row.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(row.password_hash).not.toContain(GOOD);
    // never on the MeUser payload
    expect(JSON.stringify((await ctx.as('u_mayachen').get('/api/me')).body)).not.toMatch(/password|scrypt/i);
    // audited
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'password_set' AND target_id = 'u_mayachen'").get()).toEqual({ n: 1 });
  });

  it('rejects short, common and email-based passwords', async () => {
    const maya = ctx.as('u_mayachen');
    const short = await maya.put('/api/me/password').send({ newPassword: 'abc' });
    expect(short.status).toBe(400);
    for (const weak of ['password123', 'aaaaaaaaaa', 'maya.chen-2026!', 'maya.chen@utexas.edu']) {
      const res = await maya.put('/api/me/password').send({ newPassword: weak });
      expect(res.status, weak).toBe(422);
      expect(res.body.error.code, weak).toBe('password_weak');
    }
  });

  it('needs the current password to change it, and signs every other device out', async () => {
    await givePassword();
    const here = ctx.as('u_mayachen');
    const elsewhere = ctx.as('u_mayachen');
    const missing = await here.put('/api/me/password').send({ newPassword: 'another long phrase' });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('password_incorrect');
    const wrong = await here.put('/api/me/password').send({ currentPassword: 'not it at all', newPassword: 'another long phrase' });
    expect(wrong.status).toBe(403);

    const ok = await here.put('/api/me/password').send({ currentPassword: GOOD, newPassword: 'another long phrase' });
    expect(ok.status).toBe(200);
    expect((await here.get('/api/me')).status).toBe(200);
    expect((await elsewhere.get('/api/me')).status).toBe(401);
  });

  it('is signed-in only', async () => {
    expect((await ctx.anon().get('/api/me/security')).status).toBe(401);
    expect((await ctx.anon().put('/api/me/password').send({ newPassword: GOOD })).status).toBe(401);
    expect((await ctx.anon().put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD })).status).toBe(401);
  });
});

describe('POST /auth/password/login', () => {
  it('signs in with the right password and sets the session cookie', async () => {
    await givePassword();
    const agent = ctx.anon();
    const res = await agent.post('/api/auth/password/login').send({ email: 'Maya.Chen@UTexas.edu', password: GOOD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('signed_in');
    expect(res.body.user.id).toBe('u_mayachen');
    expect(String(res.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
    expect((await agent.get('/api/me')).body.id).toBe('u_mayachen');
  });

  it('answers wrong password, unknown account and no-password account identically', async () => {
    await givePassword();
    const wrong = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: 'definitely wrong' });
    const unknown = await ctx.anon().post('/api/auth/password/login').send({ email: 'nobody.here@utexas.edu', password: GOOD });
    ctx.createUser({ handle: 'nopass', email: 'no.pass@utexas.edu' });
    const noPassword = await ctx.anon().post('/api/auth/password/login').send({ email: 'no.pass@utexas.edu', password: GOOD });
    for (const r of [wrong, unknown, noPassword]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toEqual(wrong.body.error);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(wrong.body.error.code).toBe('password_invalid');
    // the email gate still runs first
    expect((await ctx.anon().post('/api/auth/password/login').send({ email: 'x@gmail.com', password: GOOD })).status).toBe(422);
  });

  it(`locks password sign-in for 15 minutes after ${PASSWORD_MAX_FAILS} wrong tries, but email codes still work`, async () => {
    await givePassword();
    for (let i = 1; i < PASSWORD_MAX_FAILS; i++) {
      expect((await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: `wrong ${i} attempt` })).status).toBe(401);
    }
    const locking = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: 'wrong final attempt' });
    expect(locking.status).toBe(423);
    expect(locking.body.error.code).toBe('password_locked');
    // even the right password is refused while locked
    expect((await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD })).status).toBe(423);
    // the email-code way in is unaffected
    const start = await ctx.anon().post('/api/auth/start').send({ email: EMAIL });
    const verify = await ctx.anon().post('/api/auth/verify').send({ email: EMAIL, code: start.body.devCode });
    expect(verify.body.status).toBe('signed_in');
    // and the lock lifts
    setNow(now() + PASSWORD_LOCK_MS + MIN);
    expect((await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD })).status).toBe(200);
  });
});

describe('two-factor', () => {
  it('can only be turned on with a password, and needs the current password', async () => {
    const none = await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('password_not_set');
    await givePassword();
    const wrong = await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: 'nope nope nope' });
    expect(wrong.status).toBe(403);
    const on = await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ hasPassword: true, twoFactor: true });
  });

  it('a correct password then needs the emailed code; the challenge is single-use', async () => {
    await givePassword();
    await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });

    const agent = ctx.anon();
    const login = await agent.post('/api/auth/password/login').send({ email: EMAIL, password: GOOD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.status).toBe('code_required');
    expect(login.body.email).toBe(EMAIL);
    expect(typeof login.body.challengeToken).toBe('string');
    expect(login.headers['set-cookie']).toBeUndefined();
    expect((await agent.get('/api/me')).status).toBe(401);

    const wrongCode = login.body.devCode === '000000' ? '111111' : '000000';
    const bad = await agent.post('/api/auth/password/verify').send({ challengeToken: login.body.challengeToken, code: wrongCode });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('otp_invalid');

    const ok = await agent.post('/api/auth/password/verify').send({ challengeToken: login.body.challengeToken, code: login.body.devCode });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('signed_in');
    expect((await agent.get('/api/me')).body.id).toBe('u_mayachen');

    const again = await ctx.anon().post('/api/auth/password/verify').send({ challengeToken: login.body.challengeToken, code: login.body.devCode });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('challenge_invalid');
  });

  it('a wrong password never sends a code, and the challenge expires', async () => {
    const sent: string[] = [];
    await givePassword();
    await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    setMailer({ send: async (to, subject) => { if (/code/.test(subject)) sent.push(to); } });
    const wrong = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: 'wrong password here' });
    expect(wrong.status).toBe(401);
    expect(sent).toEqual([]);

    const login = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD });
    expect(login.body.status).toBe('code_required');
    expect(login.body.devCode).toBeUndefined(); // a provider is configured
    expect(sent).toEqual([EMAIL]);
    setNow(now() + 11 * MIN);
    const late = await ctx.anon().post('/api/auth/password/resend').send({ challengeToken: login.body.challengeToken });
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('challenge_invalid');
  });

  it('resend issues a fresh code under the normal OTP cooldown', async () => {
    await givePassword();
    await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    const login = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD });
    const tooSoon = await ctx.anon().post('/api/auth/password/resend').send({ challengeToken: login.body.challengeToken });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('otp_cooldown');
    setNow(now() + 31_000);
    const fresh = await ctx.anon().post('/api/auth/password/resend').send({ challengeToken: login.body.challengeToken });
    expect(fresh.status).toBe(200);
    const ok = await ctx.anon().post('/api/auth/password/verify').send({ challengeToken: login.body.challengeToken, code: fresh.body.devCode });
    expect(ok.status).toBe(200);
  });

  it('never returns devCode in production', async () => {
    await givePassword();
    await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    setMailer({ send: async () => {} });
    restore.push(overrideConfig({ env: 'production' }));
    const login = await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain('devCode');
  });
});

describe('removing a password', () => {
  it('needs the current password, turns two-factor off with it, and password sign-in stops working', async () => {
    await givePassword();
    await ctx.as('u_mayachen').put('/api/me/two-factor').send({ enabled: true, currentPassword: GOOD });
    expect((await ctx.as('u_mayachen').delete('/api/me/password').send({ currentPassword: 'wrong wrong wrong' })).status).toBe(403);
    const removed = await ctx.as('u_mayachen').delete('/api/me/password').send({ currentPassword: GOOD });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ hasPassword: false, twoFactor: false, passwordSetAt: null });
    expect((await ctx.anon().post('/api/auth/password/login').send({ email: EMAIL, password: GOOD })).status).toBe(401);
  });

  it('deleting the account drops the password', async () => {
    await givePassword();
    const del = await ctx.as('u_mayachen').delete('/api/me').send({ confirm: 'DELETE' });
    expect(del.status).toBe(204);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM user_passwords WHERE user_id = 'u_mayachen'").get()).toEqual({ n: 0 });
  });
});
