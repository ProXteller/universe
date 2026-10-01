/**
 * Foundation endpoints #9–#20 (SPEC §4.3): the signed-in user.
 * #17–#19 (sanctions / appeals) are LANE S-M3: allowed while suspended (middleware/auth.ts allow-list); #17 is the ONLY
 * endpoint that returns `contentExcerpt`.
 */
import { Router } from 'express';
import { z } from 'zod';
import type {
  AcceptGuidelinesRequest, AppealReceipt, Badges, BlockedUserRow, ContentEntityType, CreateAppealRequest, DeleteAccountRequest,
  InviteStats, MeUser, ModerationSurface, Paginated, SanctionNotice, UpdateMeRequest, UpdateSettingsRequest, UserSettings, WithModeration,
} from '@shared/core';
import { GUIDELINES_VERSION, LIMITS, ORG_CATEGORIES } from '@shared/core';
import { db, newId, prep, tx } from '../../db/index';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { trackEvent } from '../../lib/analytics';
import { audit } from '../../lib/audit';
import { now } from '../../lib/clock';
import { getContentAdapter, runUserLifecycleHooks, type ContentSnapshot } from '../../lib/content';
import { isHandleTaken, suggestHandles, validateHandle } from '../../lib/handles';
import { ApiError, asyncHandler, decodeCursor, keysetWhere, noStore, pageQuery, paginate, typed, validate } from '../../lib/http';
import { log } from '../../lib/logger';
import {
  blockedTarget, commitModeration, modCtx, moderateText, moderateWrite, NO_NOTICE, toAuthorNotice, upsertQueueItem,
} from '../../lib/moderation/index';
import { badgesFor, notify } from '../../lib/notify';
import { assertCanPost, enforceRateLimit } from '../../lib/rateLimit';
import { revokeUserSockets } from '../../lib/realtime';
import { appealableUntil, getSanctionRow, sanctionNoticesFor } from '../../lib/sanctions';
import { revokeAllSessions } from '../../lib/sessions';
import { assertOwnUpload } from '../../lib/uploads';
import {
  getUserRow, HANDLE_CHANGE_COOLDOWN_MS, settingsOf, toMeUser, tombstoneEmail, toUserSummary, userSummariesByIds, type UserRow,
} from '../../lib/users';

const router = Router();

function me(userId: string): MeUser {
  const row = getUserRow(userId);
  if (!row) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return toMeUser(row);
}

/* #9 GET /me — allowed while suspended */
router.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    noStore(res);
    res.json(me(req.user!.id));
  }),
);

const updateMeSchema = z.object({
  displayName: z.string().trim().min(LIMITS.displayNameMin).max(LIMITS.displayNameMax).optional(),
  handle: z.string().trim().max(40).transform((h) => h.replace(/^@/, '')).optional(),
  bio: z.string().trim().max(LIMITS.bio).optional(),
  major: z.string().trim().max(80).nullable().optional(),
  classYear: z.number().int().min(1950).max(2100).nullable().optional(),
  classKind: z.enum(['undergrad', 'grad', 'other']).nullable().optional(),
  pronouns: z.string().trim().max(30).nullable().optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(LIMITS.interests).optional(),
  orgCategory: z.enum(ORG_CATEGORIES).nullable().optional(),
  avatarUrl: z.string().trim().max(300).nullable().optional(),
  avatarSeed: z.string().trim().min(1).max(64).regex(/^[\w.:-]+$/).optional(),
  isAdult: z.boolean().optional(),
});

/* #10 PATCH /me */
router.patch(
  '/me',
  requireAuth,
  validate({ body: updateMeSchema }),
  asyncHandler((req, res) => {
    const user = req.user!;
    const { body } = typed<UpdateMeRequest>(req);
    const row = getUserRow(user.id)!;
    const at = now();
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown): void => {
      sets.push(`${col} = ?`);
      params.push(v);
    };

    const textFields: { text: string | null | undefined; field: 'name' | 'bio' }[] = [];
    if (body.displayName !== undefined && body.displayName !== row.display_name) {
      textFields.push({ text: body.displayName, field: 'name' });
      set('display_name', body.displayName);
    }
    if (body.bio !== undefined && body.bio !== row.bio) {
      textFields.push({ text: body.bio, field: 'bio' });
      set('bio', body.bio);
    }
    let handleChange: string | null = null;
    if (body.handle !== undefined && body.handle.toLowerCase() !== row.handle.toLowerCase()) {
      const verdict = validateHandle(body.handle);
      if (verdict === 'invalid') throw new ApiError(422, 'handle_invalid', 'Use 3–20 letters, numbers or underscores.');
      if (verdict === 'reserved') throw new ApiError(422, 'handle_reserved', 'That handle is reserved. Try another one.');
      if (row.handle_changed_at !== null && at - row.handle_changed_at < HANDLE_CHANGE_COOLDOWN_MS) {
        throw ApiError.conflict('You can change your handle once every 14 days.');
      }
      if (isHandleTaken(body.handle, user.id)) {
        throw new ApiError(409, 'handle_taken', `@${body.handle} is taken.`, { suggestions: suggestHandles(body.handle, 3) });
      }
      handleChange = body.handle;
      set('handle', body.handle);
      set('handle_changed_at', at);
    } else if (body.handle !== undefined && body.handle !== row.handle) {
      set('handle', body.handle); // case-only change, no cooldown
    }

    const touchesText = textFields.length > 0 || handleChange !== null;
    let notice = NO_NOTICE;
    if (touchesText) {
      assertCanPost(user, 'public');
      enforceRateLimit(user, 'profile_edit');
      const mod = moderateWrite(textFields, modCtx(user, 'profile'), blockedTarget(user, 'profile'));
      const modHandle = handleChange
        ? moderateWrite([{ text: handleChange, field: 'handle' }], modCtx(user, 'handle'), blockedTarget(user, 'profile'))
        : null;
      commitModeration(mod, { ...blockedTarget(user, 'profile'), entityId: user.id });
      if (modHandle) commitModeration(modHandle, { ...blockedTarget(user, 'profile'), entityId: user.id });
      notice = toAuthorNotice(modHandle && modHandle.severity !== 'none' ? modHandle : mod);
    }

    const isOrg = row.account_type === 'org';
    if (body.major !== undefined) set('major', isOrg ? null : body.major);
    if (body.classYear !== undefined) set('class_year', isOrg ? null : body.classYear);
    if (body.classKind !== undefined) set('class_kind', isOrg ? null : body.classKind);
    if (body.pronouns !== undefined) set('pronouns', body.pronouns);
    if (body.interests !== undefined) set('interests_json', JSON.stringify([...new Set(body.interests)].slice(0, LIMITS.interests)));
    if (body.orgCategory !== undefined) set('org_category', isOrg ? body.orgCategory : null);
    if (body.avatarSeed !== undefined) set('avatar_seed', body.avatarSeed);
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === null) set('avatar_url', null);
      else set('avatar_url', assertOwnUpload(user, body.avatarUrl, 'image').url);
    }
    if (body.isAdult !== undefined && (row.is_adult === null ? true : body.isAdult !== (row.is_adult === 1))) {
      if (row.is_adult !== null && row.is_adult_edited === 1) throw ApiError.conflict('Your age answer can only be changed once.');
      set('is_adult', body.isAdult ? 1 : 0);
      if (row.is_adult !== null) set('is_adult_edited', 1);
    }

    if (sets.length > 0) {
      set('updated_at', at);
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, user.id);
    }
    noStore(res);
    const out: WithModeration<MeUser> = { ...me(user.id), moderation: notice };
    res.json(out);
  }),
);

/* #11 POST /me/guidelines */
router.post(
  '/me/guidelines',
  requireAuth,
  validate({ body: z.object({ kind: z.enum(['app', 'buzz']), version: z.string().min(1).max(40) }) }),
  asyncHandler((req, res) => {
    const { body } = typed<AcceptGuidelinesRequest>(req);
    if (body.version !== GUIDELINES_VERSION) {
      throw new ApiError(400, 'validation_failed', 'These guidelines are out of date. Reload and try again.', { currentVersion: GUIDELINES_VERSION });
    }
    const at = now();
    const user = req.user!;
    if (body.kind === 'app') {
      prep('UPDATE users SET guidelines_version = ?, guidelines_accepted_at = ?, updated_at = ? WHERE id = ?').run(GUIDELINES_VERSION, at, at, user.id);
    } else {
      prep('UPDATE users SET buzz_gate_version = ?, buzz_gate_accepted_at = ?, updated_at = ? WHERE id = ?').run(GUIDELINES_VERSION, at, at, user.id);
      trackEvent('buzz_gate_accepted', { userId: user.id, universityId: user.universityId });
    }
    noStore(res);
    res.json(me(user.id));
  }),
);

/* #12 POST /me/onboarding/complete — idempotent */
router.post(
  '/me/onboarding/complete',
  requireAuth,
  asyncHandler((req, res) => {
    const user = req.user!;
    const at = now();
    const r = prep('UPDATE users SET onboarding_completed_at = ?, updated_at = ? WHERE id = ? AND onboarding_completed_at IS NULL').run(at, at, user.id);
    if (r.changes > 0) trackEvent('onboarding_completed', { userId: user.id, universityId: user.universityId });
    noStore(res);
    res.json(me(user.id));
  }),
);

/* #13 GET / PATCH /me/settings */
router.get(
  '/me/settings',
  requireAuth,
  asyncHandler((req, res) => {
    noStore(res);
    const out: UserSettings = settingsOf(getUserRow(req.user!.id)!);
    res.json(out);
  }),
);

const notificationCategories = ['follows', 'replies', 'likes', 'messages', 'marketplace', 'roommates', 'events', 'buzz', 'safety', 'system'] as const;
const settingsSchema = z.object({
  notifications: z.object(Object.fromEntries(notificationCategories.map((c) => [c, z.boolean().optional()]))).partial().optional(),
  quietHours: z.object({ enabled: z.boolean().optional(), startMin: z.number().int().min(0).max(1439).optional(), endMin: z.number().int().min(0).max(1439).optional() }).optional(),
  whoCanMessage: z.enum(['everyone', 'campus', 'following']).optional(),
  showPresence: z.boolean().optional(),
  autoplayVideos: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
});

router.patch(
  '/me/settings',
  requireAuth,
  validate({ body: settingsSchema }),
  asyncHandler((req, res) => {
    const { body } = typed<UpdateSettingsRequest>(req);
    const row = getUserRow(req.user!.id)!;
    const current = settingsOf(row);
    const next: UserSettings = {
      notifications: { ...current.notifications, ...(body.notifications ?? {}), safety: true },
      quietHours: { ...current.quietHours, ...(body.quietHours ?? {}) },
      whoCanMessage: body.whoCanMessage ?? current.whoCanMessage,
      showPresence: body.showPresence ?? current.showPresence,
      autoplayVideos: body.autoplayVideos ?? current.autoplayVideos,
      reduceMotion: body.reduceMotion ?? current.reduceMotion,
    };
    prep('UPDATE users SET settings_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now(), row.id);
    noStore(res);
    res.json(next);
  }),
);

/* #14 GET /me/badges */
router.get(
  '/me/badges',
  requireAuth,
  requireOnboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: Badges = badgesFor(req.user!.id);
    res.json(out);
  }),
);

/* #15 GET /me/blocks */
router.get(
  '/me/blocks',
  requireAuth,
  requireOnboarded,
  validate({ query: pageQuery }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, { cursor?: string; limit: number }>(req);
    const cur = decodeCursor(query.cursor);
    const ks = keysetWhere('b.created_at', 'b.blocked_id', cur, 'desc');
    const rows = db
      .prepare(`SELECT b.blocked_id AS id, b.created_at AS at FROM blocks b WHERE b.blocker_id = ? AND ${ks.sql} ORDER BY b.created_at DESC, b.blocked_id DESC LIMIT ?`)
      .all(req.user!.id, ...ks.params, query.limit + 1) as { id: string; at: number }[];
    const summaries = userSummariesByIds(rows.map((r) => r.id));
    noStore(res);
    const out: Paginated<BlockedUserRow> = paginate(
      rows.filter((r) => summaries.has(r.id)),
      query.limit,
      (r) => ({ k: r.at, id: r.id }),
      (r) => ({ user: summaries.get(r.id)!, blockedAt: r.at }),
    );
    res.json(out);
  }),
);

/* #16 GET /me/invite */
router.get(
  '/me/invite',
  requireAuth,
  requireOnboarded,
  asyncHandler((req, res) => {
    const row = getUserRow(req.user!.id)!;
    const joined = prep("SELECT * FROM users WHERE invited_by = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50").all(row.id) as UserRow[];
    const count = (prep("SELECT COUNT(*) AS n FROM users WHERE invited_by = ? AND status = 'active'").get(row.id) as { n: number }).n;
    const proto = req.get('x-forwarded-proto') ?? req.protocol;
    const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
    noStore(res);
    const out: InviteStats = { code: row.invite_code, url: `${proto}://${host}/i/${row.invite_code}`, joinedCount: count, joined: joined.map(toUserSummary) };
    res.json(out);
  }),
);

/* #17 GET /me/sanctions — allowed while suspended; the ONLY endpoint that returns contentExcerpt.   [LANE S-M3] */
router.get(
  '/me/sanctions',
  requireAuth,
  asyncHandler((req, res) => {
    noStore(res);
    const out: Paginated<SanctionNotice> = { items: sanctionNoticesFor(req.user!.id), nextCursor: null };
    res.json(out);
  }),
);

/* #18 POST /me/sanctions/:id/ack — allowed while suspended.   [LANE S-M3] */
router.post(
  '/me/sanctions/:id/ack',
  requireAuth,
  asyncHandler((req, res) => {
    const row = getSanctionRow(String(req.params.id));
    if (!row || row.user_id !== req.user!.id) throw ApiError.notFound("That notice isn't available.");
    if (row.acknowledged_at === null) prep('UPDATE user_sanctions SET acknowledged_at = ? WHERE id = ?').run(now(), row.id);
    noStore(res);
    res.status(204).end();
  }),
);

/** Surface of an appeal queue item when the adapter cannot tell us (entity gone / owner slice absent). */
const APPEAL_SURFACE: Record<ContentEntityType, ModerationSurface> = {
  buzz: 'buzz', buzz_reply: 'buzz_reply', orbit_post: 'orbit_post', orbit_comment: 'comment', reel: 'reel_caption', reel_comment: 'comment',
  message: 'message', conversation: 'group_message', market_listing: 'market_listing', roommate_listing: 'roommate_listing', event: 'event',
  profile: 'profile',
};

/*
 * #19 POST /appeals — allowed while suspended.   [LANE S-M3]
 * One appeal per sanction or removal, within 14 d (safety §4.5), surface `appeal` (always allow). Creates / merges the
 * entity's queue item with `source:'appeal'` + `appeal_id` (a direct sanction without content appeals on the user's
 * `profile` entity), audits, and sends `mod.appeal_received`.
 */
router.post(
  '/appeals',
  requireAuth,
  validate({ body: z.object({ sanctionId: z.string().min(1), text: z.string().trim().min(1).max(LIMITS.appealText) }) }),
  asyncHandler((req, res) => {
    const user = req.user!;
    const { body } = typed<CreateAppealRequest>(req);
    const row = getSanctionRow(body.sanctionId);
    if (!row || row.user_id !== user.id) throw ApiError.notFound("That notice isn't available.");
    if (prep('SELECT 1 FROM appeals WHERE sanction_id = ?').get(row.id)) throw ApiError.conflict('You already appealed this notice.');
    const deadline = appealableUntil(row);
    if (deadline === null) throw ApiError.badRequest("Warnings can't be appealed.");
    if (row.lifted_at !== null) throw ApiError.conflict('This notice is no longer in effect.');
    const at = now();
    if (at > deadline) throw ApiError.badRequest('The 14-day appeal window for this notice has closed.');
    // staff surface: always allow; the engine only records signals
    moderateText(body.text, modCtx(user, 'appeal'));

    const entityType: ContentEntityType = (row.entity_type as ContentEntityType | null) ?? 'profile';
    const entityId = row.entity_id ?? user.id;
    let snap: ContentSnapshot | null = null;
    try {
      snap = getContentAdapter(entityType)?.load(entityId) ?? null;
    } catch (err) {
      log.error('appeal: adapter load failed', err);
    }
    const id = newId();
    tx(() => {
      prep("INSERT INTO appeals (id, user_id, sanction_id, text, status, created_at) VALUES (?,?,?,?,'open',?)").run(id, user.id, row.id, body.text, at);
      const queueId = upsertQueueItem({
        entityType, entityId, surface: snap?.surface ?? APPEAL_SURFACE[entityType], universityId: snap?.universityId ?? user.universityId,
        authorId: user.id, source: 'appeal', category: row.category, severity: 'none', priority: 'p2',
      });
      prep('UPDATE mod_queue SET appeal_id = COALESCE(appeal_id, ?) WHERE id = ?').run(id, queueId);
      audit({ actor: 'system', action: 'appeal_create', targetType: 'appeal', targetId: id, queueId, metadata: { kind: row.kind } });
    });
    try {
      notify({
        userId: user.id, type: 'mod.appeal_received', actorId: null, href: '/settings/account-status',
        target: { entityType: 'sanction', entityId: row.id }, collapse: false, data: { outcome: 'open', sanctionId: row.id },
      });
    } catch (err) {
      log.error('appeal: notice failed', err);
    }
    noStore(res);
    const out: AppealReceipt = { id, sanctionId: row.id, status: 'open', createdAt: at };
    res.status(201).json(out);
  }),
);

/* #20 DELETE /me */
router.delete(
  '/me',
  requireAuth,
  validate({ body: z.object({ confirm: z.literal('DELETE') }) }),
  asyncHandler((req, res) => {
    const { body } = typed<DeleteAccountRequest>(req);
    void body;
    const user = req.user!;
    const at = now();
    tx(() => {
      // The address is released with the account (users.email is UNIQUE): deletion is a tombstone, not a ban, so the
      // same university email can sign up again as a fresh account (SPEC §4.3 #20; only `banned_emails` locks an address).
      prep(
        `UPDATE users SET status = 'deleted', deleted_at = ?, updated_at = ?, email = ?, display_name = 'Deleted account', bio = '', major = NULL,
           class_year = NULL, class_kind = NULL, pronouns = NULL, interests_json = '[]', avatar_url = NULL, org_category = NULL,
           settings_json = '{}', follower_count = 0, following_count = 0
         WHERE id = ?`,
      ).run(at, at, tombstoneEmail(user.id), user.id);
      // Follow edges vanish with the account; keep the other side's counters equal to the rows.
      prep('UPDATE users SET following_count = MAX(following_count - 1, 0) WHERE id IN (SELECT follower_id FROM follows WHERE followee_id = ?)').run(user.id);
      prep('UPDATE users SET follower_count = MAX(follower_count - 1, 0) WHERE id IN (SELECT followee_id FROM follows WHERE follower_id = ?)').run(user.id);
      prep('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').run(user.id, user.id);
      prep('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').run(user.id, user.id);
      prep('DELETE FROM public_activity WHERE user_id = ?').run(user.id);
      prep('DELETE FROM waitlist WHERE user_id = ?').run(user.id);
      revokeAllSessions(user.id);
    });
    revokeUserSockets(user.id, 'deleted');
    runUserLifecycleHooks('onDeleted', user.id);
    res.clearCookie('uv_session', { path: '/' });
    res.status(204).end();
  }),
);

export default router;
