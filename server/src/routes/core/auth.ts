/**
 * Foundation endpoints #2–#8 (SPEC §4.3): university email gate → OTP → session, handle availability, invite preview.
 * All public (`optionalAuth` is applied by mountCore) except logout.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type {
  AuthCompleteRequest, AuthCompleteResponse, AuthStartRequest, AuthStartResponse, AuthVerifyRequest, AuthVerifyResponse,
  DomainLookupResponse, EpochMs, HandleAvailabilityResponse, Id, InvitePreview, ModerationContext, PasswordCodeRequest,
  PasswordCodeResendRequest, PasswordCodeResendResponse, PasswordLoginRequest, PasswordLoginResponse, RemovePasswordRequest,
  SecuritySettings, SetPasswordRequest, TwoFactorRequest,
} from '@shared/core';
import { LIMITS, ORG_CATEGORIES, PASSWORD_MAX, PASSWORD_MIN } from '@shared/core';
import { config } from '../../config';
import { newId, prep, tx } from '../../db/index';
import { requireAuth } from '../../middleware/auth';
import { trackEvent } from '../../lib/analytics';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { handleBaseFrom, isHandleTaken, suggestHandles, validateHandle } from '../../lib/handles';
import { ApiError, asyncHandler, typed, validate } from '../../lib/http';
import { log } from '../../lib/logger';
import { getMailer, MAIL_UNAVAILABLE_MESSAGE, mailProviderConfigured } from '../../lib/mailer';
import { commitModeration, moderateWrite } from '../../lib/moderation/index';
import { consumeOtp, consumeSignupToken, issueOtp, issueSignupToken, readSignupToken } from '../../lib/otp';
import {
  assertPasswordAcceptable, burnPasswordCheck, checkPassword, consumeLoginChallenge, getPasswordRow, issueLoginChallenge,
  readLoginChallenge, removePassword, securityOf, setPassword, setTwoFactor,
} from '../../lib/passwords';
import { enforceRateLimit } from '../../lib/rateLimit';
import { revokeUserSockets } from '../../lib/realtime';
import { clearSessionCookie, createSession, revokeOtherSessions, revokeSession, setSessionCookie } from '../../lib/sessions';
import { APP_NAME } from '@shared/core';
import {
  EMAIL_COPY, isValidEmail, lookupDomain, normalizeEmail, previewUniversityForEmail, resolveUniversityForEmail,
} from '../../lib/universities';
import { getUserByEmail, getUserRow, toMeUser, tombstoneEmail, toUserSummary, universityRef, type UserRow } from '../../lib/users';

const router = Router();

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform(normalizeEmail)
  .refine(isValidEmail, { message: EMAIL_COPY.malformed });

const ROLE_RANK = { user: 0, moderator: 1, admin: 2 } as const;

function emailHash(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

/** 422 for the three gate rejections (exact STAFF_EMAILS addresses pass inside lookupDomain), 403 for banned. */
function assertEmailAcceptable(email: string): DomainLookupResponse {
  const looked = lookupDomain(email);
  if (looked.status === 'personal') throw new ApiError(422, 'email_personal', looked.message ?? EMAIL_COPY.personal);
  if (looked.status === 'disposable') throw new ApiError(422, 'email_disposable', looked.message ?? EMAIL_COPY.disposable);
  if (looked.status === 'invalid') throw new ApiError(422, 'email_not_academic', looked.message ?? EMAIL_COPY.notAcademic);
  if (prep('SELECT 1 FROM banned_emails WHERE email_hash = ?').get(emailHash(email))) {
    throw new ApiError(403, 'email_banned', "This email can't be used on UniVerse.");
  }
  return looked;
}

/**
 * STAFF_EMAILS bootstrap (SPEC §4.2.15): raise `users.role` to the mapped role when lower — at /auth/complete AND on
 * every /auth/verify sign-in. Never demotes. Writes `audit(role_bootstrap)`.
 */
function applyStaffBootstrap(user: UserRow): UserRow {
  const mapped = config.staffEmails.get(user.email.toLowerCase());
  if (!mapped || ROLE_RANK[user.role] >= ROLE_RANK[mapped]) return user;
  tx(() => {
    prep('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(mapped, now(), user.id);
    audit({ actor: 'system', action: 'role_bootstrap', targetType: 'user', targetId: user.id, metadata: { role: mapped } });
  });
  return getUserRow(user.id) ?? user;
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.replace(/\+.*$/, '').split(/[._-]+/).filter((p) => /^[a-z]+$/i.test(p));
  if (parts.length < 2) return '';
  return parts
    .slice(0, 3)
    .map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
    .slice(0, LIMITS.displayNameMax);
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(8);
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    if (!prep('SELECT 1 FROM users WHERE invite_code = ?').get(code)) return code;
  }
  return newId().toUpperCase();
}

function inviterFor(code: string | null | undefined, exceptUserId?: Id): UserRow | null {
  if (!code) return null;
  const row = prep("SELECT * FROM users WHERE invite_code = ? AND status = 'active'").get(code.trim().toUpperCase()) as UserRow | undefined;
  return row && row.id !== exceptUserId ? row : null;
}

/** Dev inbox: ONLY outside production AND only when no mail provider is configured. Never in production. */
function devInbox(code: string): { devCode?: string } {
  return config.env !== 'production' && !mailProviderConfigured() ? { devCode: code } : {};
}

/** Issues a sign-in code (all OTP limits apply) and emails it. 503 `mail_unavailable` when the mailer fails. */
async function sendSignInCode(email: string, inviteCode: string | null): Promise<{ code: string; expiresAt: EpochMs; resendAvailableAt: EpochMs }> {
  const otp = issueOtp(email, inviteCode);
  try {
    await getMailer().send(
      email,
      `${otp.code} is your ${APP_NAME} code`,
      `Your ${APP_NAME} sign-in code is ${otp.code}. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    log.error('mailer failed', err);
    throw new ApiError(503, 'mail_unavailable', MAIL_UNAVAILABLE_MESSAGE);
  }
  return otp;
}

/** Best-effort security notice ("your password changed"); never fails the request. */
function notifySecurityChange(email: string, what: string): void {
  void getMailer()
    .send(
      email,
      `Your ${APP_NAME} sign-in settings changed`,
      `${what}\n\nIf this wasn't you, sign in with an email code right away, then change your password in Settings → Password & sign-in.`,
    )
    .catch((err: unknown) => log.warn('security notice not sent', err));
}

/** Starts a session for an existing account (shared by code sign-in, password sign-in and the two-factor step). */
function signIn(req: Parameters<Parameters<typeof asyncHandler>[0]>[0], res: Parameters<Parameters<typeof asyncHandler>[0]>[1], existing: UserRow, method: 'code' | 'password' | 'password_2fa'): UserRow {
  const user = applyStaffBootstrap(existing);
  const session = createSession(user.id, req.get('user-agent'));
  setSessionCookie(res, session.token);
  trackEvent('login', { userId: user.id, universityId: user.university_id, sessionId: session.id }, { method });
  return user;
}

/* #2 GET /auth/domain?email= — always 200 */
router.get(
  '/auth/domain',
  validate({ query: z.object({ email: z.string().trim().max(254).default('') }) }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, { email: string }>(req);
    const out: DomainLookupResponse = lookupDomain(query.email);
    res.json(out);
  }),
);

/* #3 POST /auth/start */
router.post(
  '/auth/start',
  validate({ body: z.object({ email: emailSchema, inviteCode: z.string().trim().max(32).optional() }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<AuthStartRequest>(req);
    assertEmailAcceptable(body.email);
    const providerConfigured = mailProviderConfigured();
    if (config.env === 'production' && !providerConfigured) {
      throw new ApiError(503, 'mail_unavailable', MAIL_UNAVAILABLE_MESSAGE);
    }
    const university = previewUniversityForEmail(body.email);
    const otp = await sendSignInCode(body.email, body.inviteCode ? body.inviteCode.toUpperCase() : null);
    const out: AuthStartResponse = {
      email: body.email,
      university,
      expiresAt: otp.expiresAt,
      resendAvailableAt: otp.resendAvailableAt,
      ...devInbox(otp.code),
    };
    res.json(out);
  }),
);

/* #4 POST /auth/verify */
router.post(
  '/auth/verify',
  validate({ body: z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }) }),
  asyncHandler((req, res) => {
    const { body } = typed<AuthVerifyRequest>(req);
    assertEmailAcceptable(body.email);
    const { inviteCode } = consumeOtp(body.email, body.code);

    // getUserByEmail never returns a deleted tombstone: a deleted account's address signs up again as a fresh account.
    const existing = getUserByEmail(body.email);
    if (existing) {
      const user = signIn(req, res, existing, 'code');
      const out: AuthVerifyResponse = { status: 'signed_in', user: toMeUser(user) };
      res.json(out);
      return;
    }

    // The address is proven now → the campus record may be created (auto-create for unknown academic domains).
    const { university, isNew } = resolveUniversityForEmail(body.email);
    const token = issueSignupToken(body.email, university.id, inviteCode);
    const displayName = displayNameFromEmail(body.email);
    const base = handleBaseFrom(displayName || (body.email.split('@')[0] ?? 'student'));
    trackEvent('signup_verified', { userId: null, universityId: university.is_hidden ? null : university.id });
    const out: AuthVerifyResponse = {
      status: 'needs_profile',
      signupToken: token.token,
      email: body.email,
      university: { ...universityRef(university.id), isNew },
      suggested: { displayName, handle: suggestHandles(base, 1)[0] ?? '' },
      expiresAt: token.expiresAt,
    };
    res.json(out);
  }),
);

/* #5 GET /auth/handle-available?handle= */
router.get(
  '/auth/handle-available',
  validate({ query: z.object({ handle: z.string().trim().max(40).default('') }) }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, { handle: string }>(req);
    const handle = query.handle.replace(/^@/, '');
    const verdict = validateHandle(handle);
    const taken = verdict === 'ok' && isHandleTaken(handle, req.user?.id);
    const reason: HandleAvailabilityResponse['reason'] = verdict === 'invalid' ? 'invalid' : verdict === 'reserved' ? 'reserved' : taken ? 'taken' : null;
    const out: HandleAvailabilityResponse = {
      handle,
      available: reason === null,
      reason,
      suggestions: reason === null || handle.length === 0 ? [] : suggestHandles(handle, 3).filter((s) => s.toLowerCase() !== handle.toLowerCase()),
    };
    res.json(out);
  }),
);

const completeSchema = z.object({
  signupToken: z.string().min(10).max(200),
  displayName: z.string().trim().min(LIMITS.displayNameMin).max(LIMITS.displayNameMax),
  handle: z.string().trim().max(40).transform((h) => h.replace(/^@/, '')),
  accountType: z.enum(['student', 'org']),
  isAdult: z.boolean(),
  classYear: z.number().int().min(1950).max(2100).nullable().optional(),
  classKind: z.enum(['undergrad', 'grad', 'other']).nullable().optional(),
  major: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(LIMITS.bio).optional(),
  orgCategory: z.enum(ORG_CATEGORIES).nullable().optional(),
  avatarSeed: z.string().trim().min(1).max(64).regex(/^[\w.:-]+$/).optional(),
  inviteCode: z.string().trim().max(32).optional(),
});

/* #6 POST /auth/complete */
router.post(
  '/auth/complete',
  validate({ body: completeSchema }),
  asyncHandler((req, res) => {
    const { body } = typed<AuthCompleteRequest>(req);
    const token = readSignupToken(body.signupToken);

    const verdict = validateHandle(body.handle);
    if (verdict === 'invalid') throw new ApiError(422, 'handle_invalid', 'Use 3–20 letters, numbers or underscores.');
    if (verdict === 'reserved') throw new ApiError(422, 'handle_reserved', "That handle is reserved. Try another one.");
    if (isHandleTaken(body.handle)) {
      throw new ApiError(409, 'handle_taken', `@${body.handle} is taken.`, { suggestions: suggestHandles(body.handle, 3) });
    }
    if (getUserByEmail(token.email)) throw new ApiError(401, 'signup_token_invalid', 'That sign-up link was already used. Sign in instead.');

    const id = newId();
    const isOrg = body.accountType === 'org';
    const ctx: Omit<ModerationContext, 'field' | 'recentHashes'> = {
      surface: 'profile', userId: id, role: 'user', accountType: body.accountType, accountAgeMs: 0, activeStrikePoints: 0,
      universityId: token.university_id,
    };
    const target = { entityType: 'profile' as const, authorId: id, universityId: token.university_id };
    const modProfile = moderateWrite([{ text: body.displayName, field: 'name' }, { text: body.bio, field: 'bio' }], ctx, target);
    const modHandle = moderateWrite([{ text: body.handle, field: 'handle' }], { ...ctx, surface: 'handle' }, target);

    const inviter = inviterFor(body.inviteCode ?? token.invite_code);
    const at = now();
    const user = tx(() => {
      // Defence in depth for rows deleted before tombstone emails existed: release the address before the INSERT.
      const stale = prep("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'deleted'").all(token.email) as { id: Id }[];
      for (const s of stale) prep('UPDATE users SET email = ? WHERE id = ?').run(tombstoneEmail(s.id), s.id);
      const rank = (prep('SELECT COUNT(*) AS n FROM users WHERE university_id = ?').get(token.university_id) as { n: number }).n + 1;
      prep(
        `INSERT INTO users (id, email, handle, display_name, avatar_seed, account_type, university_id, bio, major, class_year,
           class_kind, org_category, is_adult, campus_rank, invite_code, invited_by, profile_completed_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id, token.email, body.handle, body.displayName, body.avatarSeed ?? id, body.accountType, token.university_id,
        body.bio ?? '', isOrg ? null : (body.major ?? null), isOrg ? null : (body.classYear ?? null),
        isOrg ? null : (body.classKind ?? null), isOrg ? (body.orgCategory ?? 'Other') : null, body.isAdult ? 1 : 0, rank,
        generateInviteCode(), inviter?.id ?? null, at, at, at,
      );
      consumeSignupToken(token.id);
      commitModeration(modProfile, { ...target, entityId: id });
      commitModeration(modHandle, { ...target, entityId: id });
      return applyStaffBootstrap(getUserRow(id)!);
    });

    const session = createSession(user.id, req.get('user-agent'));
    setSessionCookie(res, session.token);
    const hidden = (prep('SELECT is_hidden AS h FROM universities WHERE id = ?').get(user.university_id) as { h: number } | undefined)?.h === 1;
    trackEvent('signup_completed', { userId: user.id, universityId: hidden ? null : user.university_id, sessionId: session.id }, {
      accountType: user.account_type, invited: inviter !== null,
    });
    const out: AuthCompleteResponse = { user: toMeUser(user) };
    res.json(out);
  }),
);

/* #7 POST /auth/logout — allowed while suspended */
router.post(
  '/auth/logout',
  requireAuth,
  asyncHandler((req, res) => {
    if (req.sessionId) revokeSession(req.sessionId);
    if (req.user) revokeUserSockets(req.user.id, 'logout');
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

/* ─────────────── optional password sign-in + two-factor (DECISIONS D9) ─────────────── */

const passwordSchema = z.string().min(1, 'Enter your password.').max(PASSWORD_MAX);
const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);
const codeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');

const BAD_LOGIN = "That email and password don't match. Forgot it? Sign in with an email code instead.";

/* POST /auth/password/login */
router.post(
  '/auth/password/login',
  validate({ body: z.object({ email: emailSchema, password: passwordSchema }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<PasswordLoginRequest>(req);
    assertEmailAcceptable(body.email);
    const user = getUserByEmail(body.email);
    const row = user ? getPasswordRow(user.id) : null;
    // Unknown address, no password set and a wrong password all look the same (same status, same copy, one scrypt).
    if (!user || !row) {
      await burnPasswordCheck(body.password);
      throw new ApiError(401, 'password_invalid', BAD_LOGIN);
    }
    if (!(await checkPassword(row, body.password))) throw new ApiError(401, 'password_invalid', BAD_LOGIN);

    if (row.two_factor === 1) {
      const otp = await sendSignInCode(user.email, null);
      const challenge = issueLoginChallenge(user.id);
      const out: PasswordLoginResponse = {
        status: 'code_required',
        challengeToken: challenge.token,
        email: user.email,
        expiresAt: Math.min(otp.expiresAt, challenge.expiresAt),
        resendAvailableAt: otp.resendAvailableAt,
        ...devInbox(otp.code),
      };
      res.json(out);
      return;
    }
    const signedIn = signIn(req, res, user, 'password');
    const out: PasswordLoginResponse = { status: 'signed_in', user: toMeUser(signedIn) };
    res.json(out);
  }),
);

/* POST /auth/password/verify — the emailed code after a correct password (two-factor on) */
router.post(
  '/auth/password/verify',
  validate({ body: z.object({ challengeToken: z.string().min(10).max(200), code: codeSchema }) }),
  asyncHandler((req, res) => {
    const { body } = typed<PasswordCodeRequest>(req);
    const challenge = readLoginChallenge(body.challengeToken);
    const user = getUserRow(challenge.userId);
    if (!user || user.status === 'deleted') throw new ApiError(401, 'challenge_invalid', 'That sign-in timed out. Enter your password again.');
    consumeOtp(user.email, body.code);
    consumeLoginChallenge(challenge.id);
    const signedIn = signIn(req, res, user, 'password_2fa');
    const out: AuthVerifyResponse = { status: 'signed_in', user: toMeUser(signedIn) };
    res.json(out);
  }),
);

/* POST /auth/password/resend — a fresh code for the same two-factor step (OTP resend limits apply) */
router.post(
  '/auth/password/resend',
  validate({ body: z.object({ challengeToken: z.string().min(10).max(200) }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<PasswordCodeResendRequest>(req);
    const challenge = readLoginChallenge(body.challengeToken);
    const user = getUserRow(challenge.userId);
    if (!user || user.status === 'deleted') throw new ApiError(401, 'challenge_invalid', 'That sign-in timed out. Enter your password again.');
    const otp = await sendSignInCode(user.email, null);
    const out: PasswordCodeResendResponse = { expiresAt: otp.expiresAt, resendAvailableAt: otp.resendAvailableAt, ...devInbox(otp.code) };
    res.json(out);
  }),
);

/** The current password must match before anything about it changes (same lockout as sign-in). */
async function requireCurrentPassword(userId: Id, password: string | undefined): Promise<void> {
  const row = getPasswordRow(userId);
  if (!row) throw new ApiError(409, 'password_not_set', "You don't have a password yet.");
  if (!password || !(await checkPassword(row, password))) {
    throw new ApiError(403, 'password_incorrect', "That's not your current password.");
  }
}

/* GET /me/security */
router.get(
  '/me/security',
  requireAuth,
  asyncHandler((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const out: SecuritySettings = securityOf(req.user!.id);
    res.json(out);
  }),
);

/* PUT /me/password — set a first password, or change it (current password required then) */
router.put(
  '/me/password',
  requireAuth,
  validate({ body: z.object({ currentPassword: passwordSchema.optional(), newPassword: newPasswordSchema }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<SetPasswordRequest>(req);
    const user = req.user!;
    enforceRateLimit(user, 'password_change');
    const had = getPasswordRow(user.id) !== null;
    if (had) await requireCurrentPassword(user.id, body.currentPassword);
    const email = getUserRow(user.id)?.email ?? '';
    assertPasswordAcceptable(body.newPassword, email);
    await setPassword(user.id, body.newPassword);
    // A new password signs every other device out; this one stays signed in.
    revokeOtherSessions(user.id, req.sessionId);
    audit({ actor: user, action: had ? 'password_changed' : 'password_set', targetType: 'user', targetId: user.id });
    notifySecurityChange(email, had ? 'Your UniVerse password was changed.' : 'A password was added to your UniVerse account.');
    const out: SecuritySettings = securityOf(user.id);
    res.json(out);
  }),
);

/* DELETE /me/password — back to email-code sign-in only */
router.delete(
  '/me/password',
  requireAuth,
  validate({ body: z.object({ currentPassword: passwordSchema }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<RemovePasswordRequest>(req);
    const user = req.user!;
    enforceRateLimit(user, 'password_change');
    await requireCurrentPassword(user.id, body.currentPassword);
    removePassword(user.id);
    audit({ actor: user, action: 'password_removed', targetType: 'user', targetId: user.id });
    const email = getUserRow(user.id)?.email ?? '';
    notifySecurityChange(email, 'The password on your UniVerse account was removed. You now sign in with email codes only.');
    const out: SecuritySettings = securityOf(user.id);
    res.json(out);
  }),
);

/* PUT /me/two-factor — needs a password, and the current password to change it */
router.put(
  '/me/two-factor',
  requireAuth,
  validate({ body: z.object({ enabled: z.boolean(), currentPassword: passwordSchema }) }),
  asyncHandler(async (req, res) => {
    const { body } = typed<TwoFactorRequest>(req);
    const user = req.user!;
    enforceRateLimit(user, 'password_change');
    await requireCurrentPassword(user.id, body.currentPassword);
    setTwoFactor(user.id, body.enabled);
    audit({ actor: user, action: body.enabled ? 'two_factor_on' : 'two_factor_off', targetType: 'user', targetId: user.id });
    const email = getUserRow(user.id)?.email ?? '';
    notifySecurityChange(
      email,
      body.enabled
        ? 'Two-step sign-in is on: signing in with your password now also needs a code sent to this email.'
        : 'Two-step sign-in was turned off on your UniVerse account.',
    );
    const out: SecuritySettings = securityOf(user.id);
    res.json(out);
  }),
);

/* #8 GET /invites/:code */
router.get(
  '/invites/:code',
  validate({ params: z.object({ code: z.string().trim().min(1).max(32) }) }),
  asyncHandler((req, res) => {
    const inviter = inviterFor(req.params.code);
    if (!inviter) throw ApiError.notFound('That invite link is no longer valid.');
    const uni = universityRef(inviter.university_id);
    const out: InvitePreview = { code: inviter.invite_code, inviter: toUserSummary(inviter), universityName: uni.name };
    res.json(out);
  }),
);

export default router;
