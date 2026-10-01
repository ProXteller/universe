import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GUIDELINES_VERSION, SESSION_COOKIE } from '@shared/core';
import { MIN, now, setNow } from '../../src/lib/clock';
import { setMailer } from '../../src/lib/mailer';
import { createTestApp, overrideConfig, resetTestState, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
let restore: (() => void)[] = [];

beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
});
afterEach(() => {
  for (const r of restore.splice(0)) r();
  resetTestState();
});

async function signUp(email: string, handle: string, extra: Record<string, unknown> = {}): Promise<{ agent: ReturnType<TestCtx['anon']>; body: Record<string, any> }> {
  const agent = ctx.anon();
  const start = await agent.post('/api/auth/start').send({ email });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const verify = await agent.post('/api/auth/verify').send({ email, code: start.body.devCode });
  expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  expect(verify.body.status).toBe('needs_profile');
  const complete = await agent.post('/api/auth/complete').send({
    signupToken: verify.body.signupToken, displayName: 'Test Person', handle, accountType: 'student', isAdult: true, ...extra,
  });
  expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  return { agent, body: complete.body };
}

describe('domain gate (#2)', () => {
  it('classifies addresses and bare domains, always 200', async () => {
    const cases: [string, string, string | null][] = [
      ['maya.chen@utexas.edu', 'known', 'uni_utexas'],
      ['someone@cs.stanford.edu', 'known', 'uni_stanford'],
      ['utexas.edu', 'known', 'uni_utexas'],
      ['x@newcollege.edu', 'new', null],
      ['x@student.foo.ac.uk', 'new', null],
      ['x@uni-bonn.de', 'new', null],
      ['someone@gmail.com', 'personal', null],
      ['someone@mail.yahoo.com', 'personal', null],
      ['someone@mailinator.com', 'disposable', null],
      ['someone@example.com', 'invalid', null],
      ['not an email', 'invalid', null],
      ['someone@alumni.utexas.edu', 'invalid', null],
    ];
    for (const [email, status, uniId] of cases) {
      const res = await ctx.anon().get('/api/auth/domain').query({ email });
      expect(res.status).toBe(200);
      expect(res.body.status, email).toBe(status);
      if (uniId) expect(res.body.university?.id, email).toBe(uniId);
      else expect(res.body.university).toBeNull();
      if (status !== 'known') expect(typeof res.body.message).toBe('string');
    }
    const personal = await ctx.anon().get('/api/auth/domain').query({ email: 'x@gmail.com' });
    expect(personal.body.message).toBe("That's a personal email. UniVerse is students-only, so we need your university address.");
    const disposable = await ctx.anon().get('/api/auth/domain').query({ email: 'x@10minutemail.com' });
    expect(disposable.body.message).toBe("Temporary inboxes can't be verified. Use your university email.");
  });
});

describe('auth flow (#3–#7)', () => {
  it('rejects personal / disposable / non-academic addresses with 422 codes', async () => {
    const a = await ctx.anon().post('/api/auth/start').send({ email: 'someone@gmail.com' });
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe('email_personal');
    const b = await ctx.anon().post('/api/auth/start').send({ email: 'someone@guerrillamail.com' });
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe('email_disposable');
    const c = await ctx.anon().post('/api/auth/start').send({ email: 'someone@example.org' });
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe('email_not_academic');
    const d = await ctx.anon().post('/api/auth/start').send({ email: 'nope' });
    expect(d.status).toBe(400);
    expect(d.body.error.code).toBe('validation_failed');
  });

  it('signs a new student up end-to-end and auto-creates an unknown academic campus', async () => {
    const email = 'first.last@newcollege.edu';
    const agent = ctx.anon();
    const start = await agent.post('/api/auth/start').send({ email });
    expect(start.status).toBe(200);
    expect(start.body.email).toBe(email);
    expect(start.body.university.isNew).toBe(true);
    expect(start.body.devCode).toMatch(/^\d{6}$/);
    expect(start.body.resendAvailableAt - now()).toBeLessThanOrEqual(30_000);
    // nothing is created before the address is proven
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM universities WHERE domain = 'newcollege.edu'").get()).toEqual({ n: 0 });

    const verify = await agent.post('/api/auth/verify').send({ email, code: start.body.devCode });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe('needs_profile');
    expect(verify.body.suggested.displayName).toBe('First Last');
    expect(verify.body.suggested.handle).toBeTruthy();
    expect(verify.body.university.isNew).toBe(true);
    const uni = ctx.db.prepare("SELECT * FROM universities WHERE domain = 'newcollege.edu'").get() as any;
    expect(uni.is_auto_created).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM campus_places WHERE university_id = ?').get(uni.id)).toEqual({ n: 5 });

    const complete = await agent.post('/api/auth/complete').send({
      signupToken: verify.body.signupToken, displayName: 'First Last', handle: 'first_last', accountType: 'student', isAdult: true,
      major: 'Physics', classYear: 2028, classKind: 'undergrad',
    });
    expect(complete.status).toBe(200);
    expect(String(complete.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
    expect(complete.body.user.handle).toBe('first_last');
    expect(complete.body.user.university.id).toBe(uni.id);
    expect(complete.body.user.onboarding).toEqual({ profileCompleted: true, guidelinesAccepted: false, completed: false });
    expect(complete.body.user.isFoundingMember).toBe(true);
    expect(complete.body.user.inviteCode).toMatch(/^[A-Z2-9]{8}$/);

    // session works; onboarded endpoints are gated until the guidelines are accepted
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    const badges = await agent.get('/api/me/badges');
    expect(badges.status).toBe(403);
    expect(badges.body.error.code).toBe('onboarding_required');
    const guidelines = await agent.post('/api/me/guidelines').send({ kind: 'app', version: GUIDELINES_VERSION });
    expect(guidelines.status).toBe(200);
    expect(guidelines.body.onboarding.guidelinesAccepted).toBe(true);
    const badges2 = await agent.get('/api/me/badges');
    expect(badges2.status).toBe(200);
    expect(badges2.body).toEqual({ notifications: 0, messages: 0, requests: 0 });
    const done = await agent.post('/api/me/onboarding/complete');
    expect(done.body.onboarding.completed).toBe(true);

    // the signup token is single-use
    const again = await ctx.anon().post('/api/auth/complete').send({
      signupToken: verify.body.signupToken, displayName: 'X Y', handle: 'other_one', accountType: 'student', isAdult: true,
    });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('signup_token_invalid');
  });

  it('signs an existing user in with the code and sets the cookie', async () => {
    const email = 'maya.chen@utexas.edu';
    const agent = ctx.anon();
    const start = await agent.post('/api/auth/start').send({ email });
    expect(start.status).toBe(200);
    expect(start.body.university).toMatchObject({ id: 'uni_utexas', shortName: 'UT Austin', isNew: false });
    const verify = await agent.post('/api/auth/verify').send({ email: 'Maya.Chen@UTexas.edu', code: start.body.devCode });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe('signed_in');
    expect(verify.body.user.handle).toBe('mayachen');
    expect(verify.body.user.email).toBe(email);
    expect(String(verify.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe('u_mayachen');
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    const after = await agent.get('/api/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('unauthenticated');
  });

  it('enforces OTP limits: wrong code, lockout after 5, expiry, resend cooldown', async () => {
    const email = 'maya.chen@utexas.edu';
    const start = await ctx.anon().post('/api/auth/start').send({ email });
    const wrong = start.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const res = await ctx.anon().post('/api/auth/verify').send({ email, code: wrong });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('otp_invalid');
      expect(res.body.error.details).toEqual({ attemptsLeft: 5 - i });
    }
    const locked = await ctx.anon().post('/api/auth/verify').send({ email, code: wrong });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('otp_locked');
    // even the right code is refused once locked
    const right = await ctx.anon().post('/api/auth/verify').send({ email, code: start.body.devCode });
    expect(right.status).toBe(423);

    // resend cooldown (30 s)
    const tooSoon = await ctx.anon().post('/api/auth/start').send({ email });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('otp_cooldown');
    expect(tooSoon.body.error.details.retryAfterSec).toBeGreaterThan(0);

    setNow(now() + 31_000);
    const fresh = await ctx.anon().post('/api/auth/start').send({ email });
    expect(fresh.status).toBe(200);
    // expiry (10 min)
    setNow(now() + 11 * MIN);
    const expired = await ctx.anon().post('/api/auth/verify').send({ email, code: fresh.body.devCode });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('otp_expired');
    // codes are stored hashed
    const rows = ctx.db.prepare('SELECT code_hash FROM otp_codes WHERE email = ?').all(email) as { code_hash: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.code_hash).not.toBe(fresh.body.devCode);
  });

  it('validates handles on complete: invalid / reserved / taken (with suggestions)', async () => {
    const email = 'new.person@utexas.edu';
    const agent = ctx.anon();
    const start = await agent.post('/api/auth/start').send({ email });
    const verify = await agent.post('/api/auth/verify').send({ email, code: start.body.devCode });
    const base = { signupToken: verify.body.signupToken, displayName: 'New Person', accountType: 'student', isAdult: true };
    const invalid = await agent.post('/api/auth/complete').send({ ...base, handle: 'a b' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('handle_invalid');
    const reserved = await agent.post('/api/auth/complete').send({ ...base, handle: 'admin' });
    expect(reserved.status).toBe(422);
    expect(reserved.body.error.code).toBe('handle_reserved');
    const taken = await agent.post('/api/auth/complete').send({ ...base, handle: 'MayaChen' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('handle_taken');
    expect(taken.body.error.details.suggestions.length).toBeGreaterThan(0);
    const missingAge = await agent.post('/api/auth/complete').send({ signupToken: base.signupToken, displayName: 'X Y', accountType: 'student', handle: 'new_person' });
    expect(missingAge.status).toBe(400);
  });

  it('answers handle availability (#5) with reasons and suggestions', async () => {
    const taken = await ctx.anon().get('/api/auth/handle-available').query({ handle: 'mayachen' });
    expect(taken.body).toMatchObject({ handle: 'mayachen', available: false, reason: 'taken' });
    expect(taken.body.suggestions.length).toBe(3);
    for (const s of taken.body.suggestions) expect(ctx.db.prepare('SELECT 1 FROM users WHERE handle = ? COLLATE NOCASE').get(s)).toBeUndefined();
    const free = await ctx.anon().get('/api/auth/handle-available').query({ handle: '@totally_free_1' });
    expect(free.body).toEqual({ handle: 'totally_free_1', available: true, reason: null, suggestions: [] });
    const bad = await ctx.anon().get('/api/auth/handle-available').query({ handle: 'ab' });
    expect(bad.body.reason).toBe('invalid');
    const reserved = await ctx.anon().get('/api/auth/handle-available').query({ handle: 'support' });
    expect(reserved.body.reason).toBe('reserved');
  });

  it('previews invites (#8) and records invited_by on complete', async () => {
    const preview = await ctx.anon().get('/api/invites/MAYA2026');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ code: 'MAYA2026', inviter: { handle: 'mayachen' }, universityName: 'The University of Texas at Austin' });
    expect(preview.body.inviter.email).toBeUndefined();
    const missing = await ctx.anon().get('/api/invites/NOPE1234');
    expect(missing.status).toBe(404);

    const email = 'invited.friend@utexas.edu';
    const agent = ctx.anon();
    const start = await agent.post('/api/auth/start').send({ email, inviteCode: 'maya2026' });
    const verify = await agent.post('/api/auth/verify').send({ email, code: start.body.devCode });
    const complete = await agent.post('/api/auth/complete').send({
      signupToken: verify.body.signupToken, displayName: 'Invited Friend', handle: 'invited_friend', accountType: 'student', isAdult: true,
    });
    expect(complete.status).toBe(200);
    expect(complete.body.user.invitedBy.handle).toBe('mayachen');
    await agent.post('/api/me/guidelines').send({ kind: 'app', version: GUIDELINES_VERSION });
    const stats = await ctx.as('mayachen').get('/api/me/invite');
    expect(stats.status).toBe(200);
    expect(stats.body.code).toBe('MAYA2026');
    expect(stats.body.url).toMatch(/\/i\/MAYA2026$/);
    expect(stats.body.joinedCount).toBe(5); // 4 seeded background users + the new one
  });

  it('never returns devCode when a mail provider is configured, and never in production', async () => {
    const sent: string[] = [];
    setMailer({ send: async (to) => { sent.push(to); } });
    const withProvider = await ctx.anon().post('/api/auth/start').send({ email: 'maya.chen@utexas.edu' });
    expect(withProvider.status).toBe(200);
    expect(withProvider.body.devCode).toBeUndefined();
    expect(sent).toEqual(['maya.chen@utexas.edu']);

    restore.push(overrideConfig({ env: 'production' }));
    setNow(now() + 31_000);
    const prod = await ctx.anon().post('/api/auth/start').send({ email: 'maya.chen@utexas.edu' });
    expect(prod.status).toBe(200);
    expect(prod.body.devCode).toBeUndefined();
    expect(JSON.stringify(prod.body)).not.toContain('devCode');
  });

  it('returns 503 mail_unavailable in production without a mail provider (and never falls back to console)', async () => {
    restore.push(overrideConfig({ env: 'production', resendApiKey: null }));
    const res = await ctx.anon().post('/api/auth/start').send({ email: 'maya.chen@utexas.edu' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('mail_unavailable');
    expect(res.body.error.message).toBe("We can't send sign-in codes right now. Please try again soon.");
    expect(res.body.devCode).toBeUndefined();
    // no code was issued
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM otp_codes').get()).toEqual({ n: 0 });
    // the gate still runs first
    const gmail = await ctx.anon().post('/api/auth/start').send({ email: 'x@gmail.com' });
    expect(gmail.status).toBe(422);
  });
});

describe('STAFF_EMAILS bootstrap (§4.2.15)', () => {
  it('lets an exact non-academic staff address through the gate into the hidden uni_team with the role + audit row', async () => {
    restore.push(overrideConfig({ staffEmails: new Map([['dev@example.com', 'admin'], ['mod@company.com', 'moderator']]) }));
    const domain = await ctx.anon().get('/api/auth/domain').query({ email: 'dev@example.com' });
    expect(domain.body.status).toBe('known');
    expect(domain.body.university.id).toBe('uni_team');
    // a non-listed personal address is still rejected; so is a different address at the same domain
    const gmail = await ctx.anon().post('/api/auth/start').send({ email: 'someone@gmail.com' });
    expect(gmail.status).toBe(422);
    const sibling = await ctx.anon().post('/api/auth/start').send({ email: 'other@example.com' });
    expect(sibling.status).toBe(422);
    expect(sibling.body.error.code).toBe('email_not_academic');

    const { agent, body } = await signUp('dev@example.com', 'dev_admin');
    expect(body.user.role).toBe('admin');
    expect(body.user.university.id).toBe('uni_team');
    const team = ctx.db.prepare("SELECT is_hidden FROM universities WHERE id = 'uni_team'").get() as { is_hidden: number };
    expect(team.is_hidden).toBe(1);
    const audit = ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'role_bootstrap' AND target_id = ?").all(body.user.id) as any[];
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe('system');
    expect(JSON.parse(audit[0].metadata_json)).toEqual({ role: 'admin' });

    // absent from search for a normal user (hidden campus), invisible in follower counts, but /admin admits them
    await agent.post('/api/me/guidelines').send({ kind: 'app', version: GUIDELINES_VERSION });
    const search = await ctx.as('mayachen').get('/api/users/search').query({ q: 'dev_admin' });
    expect(search.status).toBe(200);
    expect(search.body.items).toEqual([]);
    const search2 = await ctx.as('mayachen').get('/api/users/search').query({ q: 'Test Person' });
    expect(search2.body.items.map((i: any) => i.handle)).not.toContain('dev_admin');
    const admin = await agent.get('/api/admin/anything');
    expect(admin.status).not.toBe(401);
    expect(admin.status).not.toBe(403);

    // an academic staff address keeps its real campus and the moderator role
    restore.push(overrideConfig({ staffEmails: new Map([['new.mod@utexas.edu', 'moderator']]) }));
    const mod = await signUp('new.mod@utexas.edu', 'new_mod');
    expect(mod.body.user.role).toBe('moderator');
    expect(mod.body.user.university.id).toBe('uni_utexas');
  });

  it('raises the role of an existing lower-role account on every sign-in and never demotes', async () => {
    restore.push(overrideConfig({ staffEmails: new Map([['maya.chen@utexas.edu', 'moderator']]) }));
    const email = 'maya.chen@utexas.edu';
    const start = await ctx.anon().post('/api/auth/start').send({ email });
    const verify = await ctx.anon().post('/api/auth/verify').send({ email, code: start.body.devCode });
    expect(verify.body.user.role).toBe('moderator');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'role_bootstrap' AND target_id = 'u_mayachen'").get()).toEqual({ n: 1 });

    // the admin seed account is not demoted when listed as moderator
    restore.push(overrideConfig({ staffEmails: new Map([['admin@utexas.edu', 'moderator']]) }));
    setNow(now() + 31_000);
    const s2 = await ctx.anon().post('/api/auth/start').send({ email: 'admin@utexas.edu' });
    const v2 = await ctx.anon().post('/api/auth/verify').send({ email: 'admin@utexas.edu', code: s2.body.devCode });
    expect(v2.body.user.role).toBe('admin');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'role_bootstrap' AND target_id = 'u_dana_w'").get()).toEqual({ n: 0 });
  });
});

describe('me (#9–#16, #20)', () => {
  it('PATCH /me edits text, enforces the 14-day handle rule and the once-only age change', async () => {
    const agent = ctx.as('mayachen');
    const res = await agent.patch('/api/me').send({ bio: 'New bio', pronouns: 'she/her', interests: ['a', 'b', 'a'] });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe('New bio');
    expect(res.body.interests).toEqual(['a', 'b']);
    expect(res.body.moderation).toEqual({ status: 'active', userMessage: null, support: null });
    const h1 = await agent.patch('/api/me').send({ handle: 'maya_chen' });
    expect(h1.status).toBe(200);
    expect(h1.body.handle).toBe('maya_chen');
    expect(h1.body.handleChangeAvailableAt).toBeGreaterThan(now());
    const h2 = await agent.patch('/api/me').send({ handle: 'maya_chen2' });
    expect(h2.status).toBe(409);
    const age1 = await agent.patch('/api/me').send({ isAdult: false });
    expect(age1.status).toBe(200);
    expect(age1.body.isAdult).toBe(false);
    const age2 = await agent.patch('/api/me').send({ isAdult: true });
    expect(age2.status).toBe(409);
  });

  it('settings force notifications.safety = true', async () => {
    const agent = ctx.as('mayachen');
    const res = await agent.patch('/api/me/settings').send({ notifications: { safety: false, likes: false }, whoCanMessage: 'campus' });
    expect(res.status).toBe(200);
    expect(res.body.notifications.safety).toBe(true);
    expect(res.body.notifications.likes).toBe(false);
    expect(res.body.whoCanMessage).toBe('campus');
    const get = await agent.get('/api/me/settings');
    expect(get.body).toEqual(res.body);
  });

  it('DELETE /me tombstones the account and revokes the session', async () => {
    const user = ctx.createUser({ follows: ['u_mayachen'], followedBy: ['u_arjunp'] });
    const before = ctx.db.prepare("SELECT follower_count FROM users WHERE id = 'u_mayachen'").get() as { follower_count: number };
    const agent = ctx.as(user.id);
    const bad = await agent.delete('/api/me').send({ confirm: 'nope' });
    expect(bad.status).toBe(400);
    const res = await agent.delete('/api/me').send({ confirm: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/me')).status).toBe(401);
    const row = ctx.db.prepare('SELECT status, display_name, bio FROM users WHERE id = ?').get(user.id) as any;
    expect(row).toMatchObject({ status: 'deleted', display_name: 'Deleted account', bio: '' });
    const after = ctx.db.prepare("SELECT follower_count FROM users WHERE id = 'u_mayachen'").get() as { follower_count: number };
    expect(after.follower_count).toBe(before.follower_count - 1);
    const profile = await ctx.as('mayachen').get(`/api/users/by-id/${user.id}`);
    expect(profile.status).toBe(404);
  });

  it('a deleted account releases its address: the same email signs up again as a fresh account (not a ban)', async () => {
    const email = 'again.later@utexas.edu';
    const first = await signUp(email, 'again_later');
    const firstId: string = first.body.user.id;
    const del = await first.agent.delete('/api/me').send({ confirm: 'DELETE' });
    expect(del.status).toBe(204);
    const tomb = ctx.db.prepare('SELECT status, email FROM users WHERE id = ?').get(firstId) as { status: string; email: string };
    expect(tomb.status).toBe('deleted');
    expect(tomb.email.toLowerCase()).not.toBe(email);
    expect(tomb.email).toMatch(/@deleted\.invalid$/);

    // the OTP cooldown is per address; step past it
    setNow(now() + 31_000);
    const second = await signUp(email, 'again_later2');
    expect(second.body.user.id).not.toBe(firstId);
    expect(second.body.user.email).toBe(email);
    expect((await second.agent.get('/api/me')).status).toBe(200);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'deleted' AND id = ?").get(firstId)).toEqual({ n: 1 });

    // a bare sign-in with the address now reaches the NEW account, never the tombstone
    setNow(now() + 31_000);
    const start = await ctx.anon().post('/api/auth/start').send({ email });
    const verify = await ctx.anon().post('/api/auth/verify').send({ email, code: start.body.devCode });
    expect(verify.body).toMatchObject({ status: 'signed_in', user: { id: second.body.user.id } });
    setNow(null);
  });
});
