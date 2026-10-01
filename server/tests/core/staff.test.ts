/**
 * LANE S-M3 — staff lib, sanctions ladder + enforcement, appeals, audit (SPEC §4.2.9, §4.2.14, §4.3 #17–#19, safety §4,
 * §8.2 #10): suggestion table, GET /me/sanctions is the only excerpt-bearing payload, mute → 403 `muted` on writes,
 * suspension / ban → restricted session allow-list + `session.revoked` + `banned_emails`, lift, strikes + expiry,
 * recordAction / audit, the anon-origin rule (`staffStandingFor`, `serializeAuditRow`), queue serializer + claims +
 * visibility, applyContentStatus / closeReportsFor notices, append-only audit triggers, appeals, quiet hours (T2).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentEntityType, Id, SanctionNotice } from '@shared/core';
import { DAY, HOUR, MIN, now, setNow } from '../../src/lib/clock';
import { audit } from '../../src/lib/audit';
import { registerContentAdapter, registerUserLifecycleHook, type ContentAdapter, type ContentSnapshot } from '../../src/lib/content';
import { upsertQueueItem } from '../../src/lib/moderation/queue';
import {
  addStrike, applyContentStatus, applySanction, blindAuthorStanding, claimQueueItem, closeReportsFor, getQueueRow, liftSanction,
  queueVisibleTo, recordAction, releaseQueueItem, resolveAuthorId, revokeStrikesFor, serializeAuditRow, serializeQueueItem,
  staffStandingFor, CLAIM_LEASE_MS, type AuditLogRow, type ModQueueRow,
} from '../../src/lib/moderation/staff';
import { isInQuietHours, isInQuietHoursFor, isWithinWindow, localMinuteOfDay, quietHoursEnforced } from '../../src/lib/quietHours';
import { assertCanPost } from '../../src/lib/rateLimit';
import { createReport } from '../../src/lib/reports';
import { activeSanctionFor, activeStrikePoints, sanctionNoticesFor, suggestSanction } from '../../src/lib/sanctions';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../../src/lib/testing';
import { getAuthedUser } from '../../src/lib/users';

let ctx: TestCtx;
const memory = new Map<string, ContentSnapshot>();
const statusCalls: { entityType: string; id: string; status: string; immune?: boolean }[] = [];
const unregisters: (() => void)[] = [];

function adapterFor(entityType: ContentEntityType): ContentAdapter {
  return {
    entityType,
    load: (id) => memory.get(`${entityType}:${id}`) ?? null,
    setStatus: (id, status, opts) => {
      statusCalls.push({ entityType, id, status, immune: opts?.immune });
      const s = memory.get(`${entityType}:${id}`);
      if (s) memory.set(`${entityType}:${id}`, { ...s, status, autoHideImmune: opts?.immune ? true : s.autoHideImmune });
    },
  };
}

function seedItem(entityType: ContentEntityType, id: Id, authorId: Id, text: string, extra: Partial<ContentSnapshot> = {}): void {
  memory.set(`${entityType}:${id}`, {
    entityType, entityId: id, authorId, universityId: 'uni_utexas', status: 'active',
    surface: entityType === 'buzz' ? 'buzz' : 'orbit_post', anon: entityType === 'buzz', autoHideImmune: false, createdAt: now(),
    label: entityType === 'buzz' ? 'buzz' : 'post', fields: [{ field: 'body', text }], media: [], href: `/x/${id}`, parent: null, ...extra,
  });
}

/** A queue item for a seeded entity (as commitModeration / reports would create it). */
function queueFor(entityType: ContentEntityType, id: Id, authorId: Id, priority: 'p0' | 'p1' | 'p2' | 'p3' = 'p1'): ModQueueRow {
  const snap = memory.get(`${entityType}:${id}`)!;
  const qid = upsertQueueItem({
    entityType, entityId: id, surface: snap.surface, universityId: 'uni_utexas', authorId, source: 'rule_flag',
    category: 'harassment_bullying', severity: 'medium', priority,
  });
  return getQueueRow(qid)!;
}

const notifs = (userId: Id, type?: string): any[] =>
  ctx.db.prepare(`SELECT * FROM notifications WHERE user_id = ?${type ? ' AND type = ?' : ''} ORDER BY created_at, rowid`).all(...(type ? [userId, type] : [userId])) as any[];
const auditRows = (where = '1=1', ...params: unknown[]): AuditLogRow[] =>
  ctx.db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at, rowid`).all(...params) as AuditLogRow[];

beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
  setNow(now()); // freeze the clock so timestamp arithmetic is exact
  memory.clear();
  statusCalls.length = 0;
  for (const t of ['buzz', 'orbit_post'] as const) unregisters.push(registerContentAdapter(adapterFor(t)));
});
afterEach(() => {
  for (const u of unregisters.splice(0)) u();
  setNow(null);
});

/* ───────────────────────────── ladder ───────────────────────────── */

describe('sanctions ladder (safety §4.2)', () => {
  it('suggestSanction follows the table; warning only when there is no prior warning', () => {
    expect(suggestSanction(0, false)).toEqual({ kind: 'warning', durationMs: null });
    expect(suggestSanction(2, false)).toEqual({ kind: 'warning', durationMs: null });
    expect(suggestSanction(2, true)).toEqual({ kind: 'removal', durationMs: null });
    expect(suggestSanction(3, true)).toEqual({ kind: 'mute', durationMs: 24 * HOUR });
    expect(suggestSanction(4, false)).toEqual({ kind: 'mute', durationMs: 24 * HOUR });
    expect(suggestSanction(5, false)).toEqual({ kind: 'mute', durationMs: 72 * HOUR });
    expect(suggestSanction(6, false)).toEqual({ kind: 'mute', durationMs: 72 * HOUR });
    expect(suggestSanction(7, false)).toEqual({ kind: 'mute', durationMs: 7 * DAY });
    expect(suggestSanction(8, false)).toEqual({ kind: 'mute', durationMs: 7 * DAY });
    expect(suggestSanction(9, false)).toEqual({ kind: 'suspension', durationMs: 7 * DAY });
    expect(suggestSanction(11, false)).toEqual({ kind: 'suspension', durationMs: 7 * DAY });
    expect(suggestSanction(12, false)).toEqual({ kind: 'suspension', durationMs: 30 * DAY });
    expect(suggestSanction(14, false)).toEqual({ kind: 'suspension', durationMs: 30 * DAY });
    expect(suggestSanction(15, false)).toEqual({ kind: 'ban', durationMs: null });
    expect(suggestSanction(40, true)).toEqual({ kind: 'ban', durationMs: null });
  });

  it('strikes: points per severity, expiry, true totals, revoke lifts the removal notice', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('orbit_post', 'p1', author.id, 'rude post one');
    seedItem('orbit_post', 'p2', author.id, 'rude post two');
    const q = queueFor('orbit_post', 'p1', author.id);
    const a1 = recordAction({ queueId: q.id, entityType: 'orbit_post', entityId: 'p1', actor: mod, action: 'remove', category: 'harassment_bullying', note: 'clearly targeted' });
    expect(addStrike({ userId: author.id, entityType: 'orbit_post', entityId: 'p1', category: 'harassment_bullying', severity: 'medium', actionId: a1 })).toBe(2);
    const a2 = recordAction({ entityType: 'orbit_post', entityId: 'p2', actor: mod, action: 'remove', category: 'pii_doxxing' });
    expect(addStrike({ userId: author.id, entityType: 'orbit_post', entityId: 'p2', category: 'pii_doxxing', severity: 'high', actionId: a2 })).toBe(5);
    const rows = ctx.db.prepare('SELECT * FROM strikes WHERE user_id = ? ORDER BY created_at').all(author.id) as any[];
    expect(rows.map((r) => r.points)).toEqual([2, 3]);
    expect(rows[0].expires_at - rows[0].created_at).toBe(90 * DAY);
    expect(rows[1].expires_at - rows[1].created_at).toBe(180 * DAY);
    // the removal notice carries the user's own excerpt (only ever returned to them)
    const notices = sanctionNoticesFor(author.id);
    expect(notices.map((n) => n.kind)).toEqual(['removal', 'removal']);
    expect(notices.find((n) => n.contentExcerpt === 'rude post one')).toBeTruthy();
    expect(notices.find((n) => n.contentExcerpt === 'rude post two')!.guidelineAnchor).toBe('#private-info');
    // ModerationContext sees the true total
    expect(getAuthedUser(author.id)!.activeStrikePoints).toBe(5);
    // 91 days later the medium strike has expired
    const t0 = now();
    setNow(t0 + 91 * DAY);
    expect(activeStrikePoints(author.id)).toBe(3);
    setNow(t0);
    revokeStrikesFor('orbit_post', 'p2');
    expect(activeStrikePoints(author.id)).toBe(2);
    expect(sanctionNoticesFor(author.id).filter((n) => n.kind === 'removal').length).toBe(2);
    expect((ctx.db.prepare("SELECT lifted_at FROM user_sanctions WHERE entity_id = 'p2'").get() as any).lifted_at).not.toBeNull();
    // audit rows: strike_add + strike_revoke target the entity
    expect(auditRows("action = 'strike_add'").length).toBe(2);
    expect(auditRows("action = 'strike_revoke' AND target_type = 'orbit_post' AND target_id = 'p2'").length).toBe(1);
  });
});

/* ───────────────────────────── enforcement ───────────────────────────── */

describe('applySanction / enforcement (safety §4.1, §4.4, SPEC §4.2.5)', () => {
  it('warning: no restriction until acknowledged; mute: 403 muted on writes, scope-aware; GET /me shows activeSanction', async () => {
    const user = ctx.createUser();
    const admin = ctx.createUser({ role: 'admin' });
    const wid = applySanction({ userId: user.id, kind: 'warning', category: 'profanity', actor: admin });
    expect(() => assertCanPost(getAuthedUser(user.id)!, 'public')).toThrowError(/acknowledge/);
    const warnNotif = notifs(user.id, 'mod.warning');
    expect(warnNotif.length).toBe(1);
    expect(JSON.parse(warnNotif[0].data_json)).toMatchObject({ category: 'profanity', until: null, sanctionId: wid });
    // ack through the endpoint
    const me = ctx.as(user.id);
    expect((await me.post(`/api/me/sanctions/${wid}/ack`)).status).toBe(204);
    expect(() => assertCanPost(getAuthedUser(user.id)!, 'public')).not.toThrow();
    expect((await ctx.as(admin.id).post(`/api/me/sanctions/${wid}/ack`)).status).toBe(404); // not mine
    expect((await me.get('/api/me')).body.activeSanction).toBeNull(); // warnings never restrict

    const mid = applySanction({ userId: user.id, kind: 'mute', durationMs: 24 * HOUR, scope: 'buzz_only', category: 'harassment_bullying', actor: admin });
    expect(() => assertCanPost(getAuthedUser(user.id)!, 'public')).not.toThrow();
    expect(() => assertCanPost(getAuthedUser(user.id)!, 'buzz')).toThrowError(/muted/);
    const meBody = (await me.get('/api/me')).body;
    expect(meBody.activeSanction).toMatchObject({ id: mid, kind: 'mute', scope: 'buzz_only', canAppeal: true, appealStatus: 'none' });
    expect(meBody.activeSanction.until - now()).toBeGreaterThan(23 * HOUR);
    applySanction({ userId: user.id, kind: 'mute', durationMs: 72 * HOUR, category: 'harassment_bullying', actor: admin });
    const patched = await me.patch('/api/me').send({ bio: 'hello there' });
    expect(patched.status).toBe(403);
    expect(patched.body.error.code).toBe('muted');
    expect(patched.body.error.details).toMatchObject({ scope: 'all' });
    expect(notifs(user.id, 'mod.muted').length).toBe(2);
    // the mute expires
    setNow(now() + 73 * HOUR);
    expect(activeSanctionFor(user.id)).toBeNull();
    expect(() => assertCanPost(getAuthedUser(user.id)!, 'public')).not.toThrow();
  });

  it('GET /me/sanctions is the only excerpt-bearing payload; staff standing never carries the excerpt', async () => {
    const user = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('orbit_post', 'p1', user.id, 'my own words quoted back');
    const a = recordAction({ entityType: 'orbit_post', entityId: 'p1', actor: mod, action: 'remove', category: 'spam_scam' });
    addStrike({ userId: user.id, entityType: 'orbit_post', entityId: 'p1', category: 'spam_scam', severity: 'low', actionId: a });
    applySanction({ userId: user.id, kind: 'mute', category: 'spam_scam', entity: { entityType: 'orbit_post', entityId: 'p1' }, actor: mod, actionId: a });
    const res = await ctx.as(user.id).get('/api/me/sanctions');
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const items = res.body.items as SanctionNotice[];
    expect(items.length).toBe(2);
    expect(items.every((n) => n.contentExcerpt === 'my own words quoted back' && n.contentLabel === 'post')).toBe(true);
    expect(items.find((n) => n.kind === 'mute')).toMatchObject({ canAppeal: true, appealStatus: 'none', category: 'spam_scam', guidelineAnchor: '#spam' });
    expect(items.find((n) => n.kind === 'mute')!.appealDeadline! - now()).toBe(14 * DAY);
    const standing = staffStandingFor(user.id, 'moderator');
    expect(standing.sanctions.length).toBe(2);
    for (const s of standing.sanctions) {
      expect(s).not.toHaveProperty('contentExcerpt');
      expect(s).not.toHaveProperty('contentLabel');
      expect(s.origin).toBe('public');
    }
    expect(standing.strikePoints).toBe(1);
    expect(JSON.stringify(standing)).not.toContain('quoted back');
    // the action row links to the sanction
    expect((ctx.db.prepare('SELECT sanction_id FROM moderation_actions WHERE id = ?').get(a) as any).sanction_id).toBe(standing.sanctions.find((s) => s.kind === 'mute')!.id);
  });

  it('suspension: status, sessions + sockets revoked, restricted session allow-list, lift → active + treated as new', async () => {
    const user = ctx.createUser();
    const admin = ctx.createUser({ role: 'admin' });
    const before = ctx.as(user.id);
    expect((await before.get('/api/me')).status).toBe(200);
    const sid = applySanction({ userId: user.id, kind: 'suspension', durationMs: 7 * DAY, category: 'threat_violence', actor: admin });
    expect((ctx.db.prepare('SELECT status FROM users WHERE id = ?').get(user.id) as any).status).toBe('suspended');
    expect((await before.get('/api/me')).status).toBe(401); // old session revoked
    expect(ctx.wsEventsFor(user.id).some((e) => e.type === 'session.revoked' && e.reason === 'suspended')).toBe(true);
    expect(notifs(user.id, 'mod.suspended').length).toBe(1); // notice written before the status flip
    // a fresh sign-in lands on the suspension screen: only the allow-list answers
    const s = ctx.as(user.id);
    const me = await s.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.status).toBe('suspended');
    expect(me.body.activeSanction).toMatchObject({ id: sid, kind: 'suspension', category: 'threat_violence' });
    expect((await s.get('/api/me/sanctions')).status).toBe(200);
    const blocked = await s.get('/api/users/search?q=a');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('suspended');
    expect(blocked.body.error.details).toMatchObject({ category: 'threat_violence' });
    expect(blocked.body.error.details.until - now()).toBeGreaterThan(6 * DAY);
    expect((await s.get('/api/me/badges')).status).toBe(403);
    expect((await s.patch('/api/me/settings').send({ reduceMotion: true })).status).toBe(403);
    const appeal = await s.post('/api/appeals').send({ sanctionId: sid, text: 'I believe this was a misunderstanding.' });
    expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);
    expect((await s.post(`/api/me/sanctions/${sid}/ack`)).status).toBe(204);
    expect((await s.post('/api/auth/logout')).status).toBe(204);
    // lift → active again, restricted for 72 h (isNewAccount)
    liftSanction(sid, admin);
    const row = ctx.db.prepare('SELECT status, restricted_until FROM users WHERE id = ?').get(user.id) as any;
    expect(row.status).toBe('active');
    expect(row.restricted_until - now()).toBe(72 * HOUR);
    expect(getAuthedUser(user.id)!.isNewAccount).toBe(true);
    expect((await ctx.as(user.id).get('/api/me/badges')).status).toBe(200);
    expect(auditRows("action = 'sanction_lift' AND target_type = 'user' AND target_id = ?", user.id).length).toBe(1);
    liftSanction(sid, admin); // idempotent
    expect(auditRows("action = 'sanction_lift'").length).toBe(1);
  });

  it('suspension expiry flips the account back lazily (requireAuth) with the 72 h restriction', async () => {
    const user = ctx.createUser();
    applySanction({ userId: user.id, kind: 'suspension', durationMs: 7 * DAY, category: 'hate', actor: 'system' });
    setNow(now() + 8 * DAY);
    const res = await ctx.as(user.id).get('/api/me/badges');
    expect(res.status).toBe(200);
    const row = ctx.db.prepare('SELECT status, restricted_until FROM users WHERE id = ?').get(user.id) as any;
    expect(row.status).toBe('active');
    expect(row.restricted_until).toBeGreaterThan(now());
  });

  it('ban: banned_emails blocks re-registration, lifecycle hook runs, lift clears the hash', async () => {
    const user = ctx.createUser({ email: 'banned.person@utexas.edu' });
    const admin = ctx.createUser({ role: 'admin' });
    const hooked: string[] = [];
    unregisters.push(registerUserLifecycleHook('staff-test', { onBanned: (id) => hooked.push(id) }));
    const bid = applySanction({ userId: user.id, kind: 'ban', category: 'sexual_minors', actor: admin });
    expect(hooked).toEqual([user.id]);
    expect((ctx.db.prepare('SELECT status FROM users WHERE id = ?').get(user.id) as any).status).toBe('banned');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM banned_emails').get()).toEqual({ n: 1 });
    expect(ctx.wsEventsFor(user.id).some((e) => e.type === 'session.revoked' && e.reason === 'banned')).toBe(true);
    const start = await ctx.anon().post('/api/auth/start').send({ email: 'Banned.Person@utexas.edu' });
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('email_banned');
    const s = ctx.as(user.id);
    const me = await s.get('/api/me');
    expect(me.body.status).toBe('banned');
    expect(me.body.activeSanction).toMatchObject({ id: bid, kind: 'ban', until: null });
    const denied = await s.get('/api/me/invite');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('banned');
    liftSanction(bid, admin);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM banned_emails').get()).toEqual({ n: 0 });
    expect((ctx.db.prepare('SELECT status FROM users WHERE id = ?').get(user.id) as any).status).toBe('active');
    expect((await ctx.anon().post('/api/auth/start').send({ email: 'banned.person@utexas.edu' })).status).toBe(200);
  });
});

/* ───────────────────────────── anon-origin rule ───────────────────────────── */

describe('anon-origin rule (SPEC §4.2.14, safety §8.2 #10)', () => {
  it('a Buzz sanction is invisible to moderators (numbers unchanged), day-floored for admins, enforced for real', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('orbit_post', 'pub1', author.id, 'public post text');
    seedItem('buzz', 'bz1', author.id, 'anonymous buzz text that must never sit next to a name');
    // one public-origin sanction first, so the moderator view has something to compare
    const pa = recordAction({ entityType: 'orbit_post', entityId: 'pub1', actor: mod, action: 'remove', category: 'profanity', note: 'baseline' });
    addStrike({ userId: author.id, entityType: 'orbit_post', entityId: 'pub1', category: 'profanity', severity: 'low', actionId: pa });
    applySanction({ userId: author.id, kind: 'warning', category: 'profanity', entity: { entityType: 'orbit_post', entityId: 'pub1' }, actor: mod, actionId: pa });
    queueFor('orbit_post', 'pub1', author.id); // an open public item
    const before = staffStandingFor(author.id, 'moderator');
    expect(before).toMatchObject({ strikePoints: 1, openQueueItems: 1 });
    expect(before.sanctions.map((s) => s.kind).sort()).toEqual(['removal', 'warning']);

    // now the moderator acts blind on the Buzz item: remove + mute (72 h)
    const q = queueFor('buzz', 'bz1', author.id, 'p1');
    const actionId = recordAction({ queueId: q.id, entityType: 'buzz', entityId: 'bz1', actor: mod, action: 'remove_and_mute_72h', category: 'harassment_bullying', note: 'targeted at the RA', targetUserId: author.id, metadata: { userId: author.id, note: 'kept' } });
    applyContentStatus('buzz', 'bz1', 'removed');
    const points = addStrike({ userId: author.id, entityType: 'buzz', entityId: 'bz1', category: 'harassment_bullying', severity: 'medium', actionId });
    const sid = applySanction({ userId: author.id, kind: 'mute', durationMs: 72 * HOUR, category: 'harassment_bullying', entity: { entityType: 'buzz', entityId: 'bz1' }, actor: mod, actionId, delayed: false });
    expect(points).toBe(3); // enforcement sees the true total
    expect(activeSanctionFor(author.id)).toMatchObject({ id: sid, kind: 'mute' });
    expect(() => assertCanPost(getAuthedUser(author.id)!, 'public')).toThrowError(/muted/);

    // moderator: nothing moved
    const after = staffStandingFor(author.id, 'moderator');
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('anonymous buzz');
    // admin: present as anon origin, no excerpt, timestamps floored to the UTC day
    const adminView = staffStandingFor(author.id, 'admin');
    expect(adminView.strikePoints).toBe(3);
    expect(adminView.openQueueItems).toBe(2);
    const anonRows = adminView.sanctions.filter((s) => s.origin === 'anon');
    expect(anonRows.map((s) => s.kind).sort()).toEqual(['mute', 'removal']);
    for (const s of anonRows) {
      expect(s).not.toHaveProperty('contentExcerpt');
      expect(s.createdAt % DAY).toBe(0);
      expect(s.startsAt % DAY).toBe(0);
      if (s.until !== null) expect(s.until % DAY).toBe(0);
      if (s.appealDeadline !== null) expect(s.appealDeadline % DAY).toBe(0);
    }
    expect(JSON.stringify(adminView)).not.toContain('anonymous buzz');

    // audit / action rows: the entity is the target, never the user; metadata never names the user
    const rows = auditRows('queue_id = ?', q.id);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.target_type).toBe('buzz');
      expect(r.target_id).toBe('bz1');
      expect(r.metadata_json).not.toContain(author.id);
    }
    expect(auditRows("target_type = 'user' AND target_id = ?", author.id).length).toBe(1); // only the public warning
    const action = ctx.db.prepare('SELECT * FROM moderation_actions WHERE id = ?').get(actionId) as any;
    expect(action.target_user_id).toBe(author.id); // server-internal
    expect(action.sanction_id).toBe(sid);
    expect(getQueueRow(q.id)!.first_action_at).not.toBeNull();
    // the moderator's serialized audit rows never name the user
    for (const r of rows) {
      const out = serializeAuditRow(r, mod);
      expect(JSON.stringify(out)).not.toContain(author.id);
      assertNoIdentityLeak(out, [author.id, author.handle, author.displayName, author.email]);
    }
    // the affected user still sees their own notice with the excerpt
    const mine = sanctionNoticesFor(author.id).find((n) => n.id === sid)!;
    expect(mine.contentExcerpt).toContain('anonymous buzz');
    expect(notifs(author.id, 'mod.content_removed').length).toBe(1);
    expect(JSON.parse(notifs(author.id, 'mod.content_removed')[0].data_json)).toMatchObject({ label: 'buzz', category: 'harassment_bullying', anon: true });
  });

  it('anon-origin warnings / mutes get a random 5–30 min effective_at (not on P0, not when delayed:false)', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('buzz', 'bz1', author.id, 'x');
    seedItem('buzz', 'bz0', author.id, 'y');
    queueFor('buzz', 'bz1', author.id, 'p2');
    queueFor('buzz', 'bz0', author.id, 'p0');
    const at = now();
    const delayedId = applySanction({ userId: author.id, kind: 'mute', category: 'hate', entity: { entityType: 'buzz', entityId: 'bz1' }, actor: mod });
    const delayed = ctx.db.prepare('SELECT effective_at, ends_at, starts_at FROM user_sanctions WHERE id = ?').get(delayedId) as any;
    expect(delayed.effective_at - at).toBeGreaterThanOrEqual(5 * MIN);
    expect(delayed.effective_at - at).toBeLessThanOrEqual(30 * MIN);
    expect(delayed.ends_at - delayed.effective_at).toBe(24 * HOUR);
    expect(activeSanctionFor(author.id)).toBeNull(); // not in force yet
    setNow(at + 31 * MIN);
    expect(activeSanctionFor(author.id)).toMatchObject({ id: delayedId });
    setNow(at);
    const p0 = applySanction({ userId: author.id, kind: 'mute', category: 'threat_violence', entity: { entityType: 'buzz', entityId: 'bz0' }, actor: mod });
    expect((ctx.db.prepare('SELECT effective_at FROM user_sanctions WHERE id = ?').get(p0) as any).effective_at).toBe(now());
    const forced = applySanction({ userId: author.id, kind: 'warning', category: 'hate', entity: { entityType: 'buzz', entityId: 'bz1' }, actor: mod, delayed: false });
    expect((ctx.db.prepare('SELECT effective_at FROM user_sanctions WHERE id = ?').get(forced) as any).effective_at).toBe(now());
  });

  it('serializeAuditRow: user-targeted rows tied to an anon item lose targetId (except admin + buzz_unmask); metadata stripped for moderators', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    const admin = ctx.createUser({ role: 'admin' });
    seedItem('buzz', 'bz1', author.id, 'z');
    const q = queueFor('buzz', 'bz1', author.id);
    // a legacy / seeded row that names the user on an anon item
    const legacy = audit({ actor: mod, action: 'legacy_mute', targetType: 'user', targetId: author.id, queueId: q.id, metadata: { userId: author.id, note: 'x' } });
    const unmask = audit({ actor: admin, action: 'buzz_unmask', targetType: 'user', targetId: author.id, queueId: q.id, reasonCode: 'credible_threat', reason: 'thirty characters of justification here', metadata: { userId: author.id } });
    const plain = audit({ actor: admin, action: 'role_grant', targetType: 'user', targetId: author.id, metadata: { role: 'moderator' } });
    const rows = new Map(auditRows().map((r) => [r.id, r]));
    const modLegacy = serializeAuditRow(rows.get(legacy)!, mod);
    expect(modLegacy.targetId).toBeNull();
    expect(modLegacy.metadata).toEqual({ note: 'x' });
    expect(modLegacy.actor).toMatchObject({ id: mod.id, role: 'moderator' });
    expect(serializeAuditRow(rows.get(legacy)!, admin).targetId).toBeNull(); // admin, but not buzz_unmask
    const modUnmask = serializeAuditRow(rows.get(unmask)!, mod);
    expect(modUnmask.targetId).toBeNull();
    expect(modUnmask.metadata).toBeNull();
    const adminUnmask = serializeAuditRow(rows.get(unmask)!, admin);
    expect(adminUnmask.targetId).toBe(author.id);
    expect(adminUnmask.metadata).toEqual({ userId: author.id });
    expect(adminUnmask).toMatchObject({ reasonCode: 'credible_threat', queueId: q.id, actor: { id: admin.id, role: 'admin', displayName: admin.displayName } });
    const modPlain = serializeAuditRow(rows.get(plain)!, mod);
    expect(modPlain.targetId).toBe(author.id);
    expect(modPlain.metadata).toEqual({ role: 'moderator' });
    const system = serializeAuditRow(auditRows("action = 'strike_add' OR action = 'legacy_mute'")[0], admin);
    expect(system.actor).not.toBeNull();
  });
});

/* ───────────────────────────── queue ───────────────────────────── */

describe('queue helpers', () => {
  it('serializeQueueItem: every StaffQueueItemCore field, no author field, excerpt from adapter or blocked_text', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('buzz', 'bz1', author.id, `${'long '.repeat(40)}end`);
    const q = queueFor('buzz', 'bz1', author.id, 'p0');
    const item = serializeQueueItem(q, mod);
    assertNoForbiddenKeys(item);
    assertNoIdentityLeak(item, [author.id, author.handle, author.displayName, author.email]);
    expect(Object.keys(item).sort()).toEqual([
      'anon', 'category', 'claimedByMe', 'claimedByOther', 'closedAt', 'contentStatus', 'createdAt', 'entityId', 'entityType', 'excerpt', 'id',
      'label', 'priority', 'reportCount', 'resolution', 'severity', 'slaDueAt', 'source', 'status', 'surface', 'universityShortName',
    ]);
    expect(item).toMatchObject({ anon: true, entityType: 'buzz', entityId: 'bz1', universityShortName: 'UT Austin', contentStatus: 'active', status: 'open', claimedByMe: false, claimedByOther: false, priority: 'p0' });
    expect(item.excerpt.length).toBe(140);
    expect(item.slaDueAt).toBe(q.created_at + HOUR);
    // blocked_text fallback (entity_id NULL)
    const bid = upsertQueueItem({ entityType: 'buzz', entityId: null, surface: 'buzz', universityId: 'uni_umich', authorId: author.id, source: 'rule_block_escalation', category: 'threat_violence', severity: 'critical', priority: 'p0', blockedText: '  blocked   text  ' });
    const blocked = serializeQueueItem(getQueueRow(bid)!, mod);
    expect(blocked).toMatchObject({ excerpt: 'blocked text', contentStatus: null, entityId: null, universityShortName: 'UMich' });
    // no adapter → '' excerpt, null status
    const rid = upsertQueueItem({ entityType: 'reel', entityId: 'r1', surface: 'reel_caption', universityId: 'uni_utexas', authorId: author.id, source: 'user_report', category: null, severity: 'none', priority: 'p3' });
    expect(serializeQueueItem(getQueueRow(rid)!, mod)).toMatchObject({ excerpt: '', contentStatus: null, anon: false, slaDueAt: getQueueRow(rid)!.created_at + 72 * HOUR });
  });

  it('claims: 10-minute lease, 409 for others, expired leases re-claimable, release', () => {
    const author = ctx.createUser();
    const mod1 = ctx.createUser({ role: 'moderator' });
    const mod2 = ctx.createUser({ role: 'moderator' });
    seedItem('orbit_post', 'p1', author.id, 'x');
    const q = queueFor('orbit_post', 'p1', author.id);
    claimQueueItem(q.id, mod1);
    expect(serializeQueueItem(getQueueRow(q.id)!, mod1)).toMatchObject({ status: 'claimed', claimedByMe: true, claimedByOther: false });
    expect(serializeQueueItem(getQueueRow(q.id)!, mod2)).toMatchObject({ claimedByMe: false, claimedByOther: true });
    expect(() => claimQueueItem(q.id, mod2)).toThrowError(/reviewed/);
    expect(() => releaseQueueItem(q.id, mod2)).toThrowError(/reviewed/);
    claimQueueItem(q.id, mod1); // renew is fine
    setNow(now() + CLAIM_LEASE_MS + 1);
    expect(serializeQueueItem(getQueueRow(q.id)!, mod2)).toMatchObject({ status: 'open', claimedByOther: false });
    claimQueueItem(q.id, mod2); // expired → mod2 takes it
    expect(getQueueRow(q.id)!.claimed_by).toBe(mod2.id);
    releaseQueueItem(q.id, mod2);
    expect(getQueueRow(q.id)!).toMatchObject({ claimed_by: null, claimed_at: null, status: 'open' });
    expect(() => claimQueueItem('nope', mod1)).toThrowError();
    ctx.db.prepare("UPDATE mod_queue SET status = 'closed', closed_at = ? WHERE id = ?").run(now(), q.id);
    expect(() => claimQueueItem(q.id, mod1)).toThrowError(/closed/);
  });

  it('queueVisibleTo: never own / reported / DM items; legal hold + escalated only for admins; claim of an invisible item → 404', () => {
    const author = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    const admin = ctx.createUser({ role: 'admin' });
    seedItem('orbit_post', 'mine', mod.id, 'the moderator wrote this');
    seedItem('orbit_post', 'reported', author.id, 'the moderator reported this');
    seedItem('orbit_post', 'held', author.id, 'legal hold');
    seedItem('orbit_post', 'esc', author.id, 'escalated');
    seedItem('orbit_post', 'ok', author.id, 'plain');
    const own = queueFor('orbit_post', 'mine', mod.id);
    createReport(mod, { entityType: 'orbit_post', entityId: 'reported', reason: 'hate' });
    const held = queueFor('orbit_post', 'held', author.id);
    ctx.db.prepare('UPDATE mod_queue SET legal_hold = 1 WHERE id = ?').run(held.id);
    const esc = queueFor('orbit_post', 'esc', author.id);
    ctx.db.prepare("UPDATE mod_queue SET status = 'escalated' WHERE id = ?").run(esc.id);
    const ok = queueFor('orbit_post', 'ok', author.id);
    const visible = (staff: typeof mod): string[] => {
      const v = queueVisibleTo(staff);
      return (ctx.db.prepare(`SELECT id FROM mod_queue WHERE ${v.sql} ORDER BY created_at`).all(...v.params) as { id: string }[]).map((r) => r.id);
    };
    expect(visible(mod)).toEqual([ok.id]);
    expect(visible(admin).sort()).toEqual([own.id, held.id, esc.id, ok.id, (ctx.db.prepare("SELECT id FROM mod_queue WHERE entity_id = 'reported'").get() as any).id].sort());
    expect(() => claimQueueItem(own.id, mod)).toThrowError(/not found|isn't available|Not found/i);
  });

  it('blindAuthorStanding buckets the anon-origin history only; resolveAuthorId falls back to the queue / events', () => {
    const author = ctx.createUser({ createdAt: now() - 2 * DAY });
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('buzz', 'bz1', author.id, 'a');
    const q = queueFor('buzz', 'bz1', author.id);
    // public-origin history (named account): must NOT reach the blind panel (hypothesis-testing oracle, hardening fix)
    seedItem('orbit_post', 'pub', author.id, 'p');
    queueFor('orbit_post', 'pub', author.id);
    const pa = recordAction({ entityType: 'orbit_post', entityId: 'pub', actor: mod, action: 'remove', category: 'harassment_bullying' });
    addStrike({ userId: author.id, entityType: 'orbit_post', entityId: 'pub', category: 'harassment_bullying', severity: 'high', actionId: pa });
    applySanction({ userId: author.id, kind: 'suspension', category: 'harassment_bullying', actor: mod, delayed: false });
    expect(blindAuthorStanding(author.id, q.id)).toEqual({ accountAge: '<7d', strikePoints: '0', priorByCategory: {}, sanction: null, otherOpenItems: '0' });
    // anon-origin history (the Buzz persona's own record)
    for (let i = 0; i < 4; i += 1) {
      seedItem('buzz', `p${i}`, author.id, 'p');
      queueFor('buzz', `p${i}`, author.id);
      const a = recordAction({ entityType: 'buzz', entityId: `p${i}`, actor: mod, action: 'remove', category: 'spam_scam' });
      addStrike({ userId: author.id, entityType: 'buzz', entityId: `p${i}`, category: 'spam_scam', severity: 'low', actionId: a });
    }
    applySanction({ userId: author.id, kind: 'mute', category: 'spam_scam', actor: mod, entity: { entityType: 'buzz', entityId: 'p0' }, delayed: false });
    const standing = blindAuthorStanding(author.id, q.id);
    expect(standing).toEqual({ accountAge: '<7d', strikePoints: '3-5', priorByCategory: { spam_scam: '3-5' }, sanction: 'mute', otherOpenItems: '3-5' });
    assertNoIdentityLeak(standing, [author.id, author.handle, author.displayName, author.email]);
    expect(blindAuthorStanding('ghost')).toMatchObject({ accountAge: '30d+', strikePoints: '0', otherOpenItems: '0', sanction: null });
    expect(resolveAuthorId('buzz', 'bz1')).toBe(author.id);
    memory.delete('buzz:bz1');
    expect(resolveAuthorId('buzz', 'bz1')).toBe(author.id); // queue item
    expect(resolveAuthorId('buzz', 'unknown')).toBeNull();
  });

  it('applyContentStatus notifies the author (removed / hidden / restored) with category from the queue; approve is silent', () => {
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'some post text');
    queueFor('orbit_post', 'p1', author.id);
    applyContentStatus('orbit_post', 'p1', 'active', { immune: true });
    expect(statusCalls.at(-1)).toMatchObject({ status: 'active', immune: true });
    expect(notifs(author.id).length).toBe(0);
    applyContentStatus('orbit_post', 'p1', 'hidden');
    applyContentStatus('orbit_post', 'p1', 'removed', { sanctionId: 'san_1' });
    applyContentStatus('orbit_post', 'p1', 'active');
    const types = notifs(author.id).map((n) => n.type);
    expect(types).toEqual(['mod.content_hidden', 'mod.content_removed', 'mod.content_restored']);
    expect(JSON.parse(notifs(author.id, 'mod.content_removed')[0].data_json)).toEqual({ label: 'post', excerpt: 'some post text', category: 'harassment_bullying', sanctionId: 'san_1', anon: false });
    expect(notifs(author.id)[0].href).toBe('/settings/account-status');
    expect(() => applyContentStatus('reel', 'nope', 'removed')).toThrowError();
    expect(() => applyContentStatus('orbit_post', 'nope', 'removed')).toThrowError();
  });

  it('closeReportsFor closes open reports, notifies reporters with the outcome, marks bad faith', () => {
    const author = ctx.createUser();
    const r1 = ctx.createUser();
    const r2 = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'x');
    createReport(r1, { entityType: 'orbit_post', entityId: 'p1', reason: 'spam_scam' });
    createReport(r2, { entityType: 'orbit_post', entityId: 'p1', reason: 'hate' });
    closeReportsFor('orbit_post', 'p1', 'dismissed', { badFaith: true });
    const rows = ctx.db.prepare("SELECT status, bad_faith, closed_at FROM reports WHERE entity_id = 'p1'").all() as any[];
    expect(rows.every((r) => r.status === 'dismissed' && r.bad_faith === 1 && r.closed_at !== null)).toBe(true);
    for (const u of [r1, r2]) {
      const n = notifs(u.id, 'mod.report_resolved');
      expect(n.length).toBe(1);
      expect(JSON.parse(n[0].data_json)).toEqual({ outcome: 'no_violation' });
      expect(n[0].href).toBe('/guidelines');
    }
    closeReportsFor('orbit_post', 'p1', 'actioned'); // nothing open → no second notice
    expect(notifs(r1.id, 'mod.report_resolved').length).toBe(1);
    seedItem('orbit_post', 'p2', author.id, 'y');
    createReport(r1, { entityType: 'orbit_post', entityId: 'p2', reason: 'hate' });
    closeReportsFor('orbit_post', 'p2', 'actioned');
    expect(JSON.parse(notifs(r1.id, 'mod.report_resolved').at(-1).data_json)).toEqual({ outcome: 'actioned' });
  });
});

/* ───────────────────────────── audit ───────────────────────────── */

describe('audit log (safety §6.6)', () => {
  it('is append-only: UPDATE and DELETE raise; rows carry actor / target / metadata', () => {
    const admin = ctx.createUser({ role: 'admin' });
    const id = audit({ actor: admin, action: 'rule_pack_toggle', targetType: 'rule_pack', targetId: 'admin.spam', metadata: { enabled: false } });
    const row = ctx.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as any;
    expect(row).toMatchObject({ actor_id: admin.id, actor_role: 'admin', action: 'rule_pack_toggle', target_type: 'rule_pack', target_id: 'admin.spam', metadata_json: '{"enabled":false}' });
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'x' WHERE id = ?").run(id)).toThrowError(/append-only/);
    expect(() => ctx.db.prepare('DELETE FROM audit_log WHERE id = ?').run(id)).toThrowError(/append-only/);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE id = ?').get(id)).toEqual({ n: 1 });
    const sys = audit({ actor: 'system', action: 'role_bootstrap', targetType: 'user', targetId: admin.id, metadata: { role: 'admin' } });
    expect(ctx.db.prepare('SELECT actor_id, actor_role FROM audit_log WHERE id = ?').get(sys)).toEqual({ actor_id: 'system', actor_role: 'system' });
  });
});

/* ───────────────────────────── appeals ───────────────────────────── */

describe('POST /appeals (#19, safety §4.5)', () => {
  it('one appeal per sanction within 14 d; queue item source appeal + appeal_id; notice; blind for anon origin', async () => {
    const user = ctx.createUser();
    const other = ctx.createUser();
    const mod = ctx.createUser({ role: 'moderator' });
    seedItem('buzz', 'bz1', user.id, 'the buzz under appeal');
    const q = queueFor('buzz', 'bz1', user.id);
    ctx.db.prepare("UPDATE mod_queue SET status = 'closed', closed_at = ?, resolution = 'sanctioned' WHERE id = ?").run(now(), q.id);
    const a = recordAction({ queueId: q.id, entityType: 'buzz', entityId: 'bz1', actor: mod, action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted' });
    const sid = applySanction({ userId: user.id, kind: 'mute', category: 'harassment_bullying', actor: mod, actionId: a, delayed: false });
    const me = ctx.as(user.id);
    const bad = await me.post('/api/appeals').send({ sanctionId: sid, text: '' });
    expect(bad.status).toBe(400);
    expect((await ctx.as(other.id).post('/api/appeals').send({ sanctionId: sid, text: 'not mine' })).status).toBe(404);
    const res = await me.post('/api/appeals').send({ sanctionId: sid, text: 'That reply was a joke between friends, please review.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ sanctionId: sid, status: 'open' });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.createdAt).toBe(now());
    const appeal = ctx.db.prepare('SELECT * FROM appeals WHERE id = ?').get(res.body.id) as any;
    expect(appeal).toMatchObject({ user_id: user.id, sanction_id: sid, status: 'open', reviewer_id: null });
    const item = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = 'bz1' AND status != 'closed'").get() as ModQueueRow;
    expect(item).toMatchObject({ source: 'appeal', appeal_id: res.body.id, category: 'harassment_bullying', priority: 'p2' });
    const serialized = serializeQueueItem(item, mod);
    assertNoForbiddenKeys(serialized);
    assertNoIdentityLeak(serialized, [user.id, user.handle, user.displayName, user.email]);
    expect(serialized.excerpt).toBe('the buzz under appeal');
    expect(auditRows("action = 'appeal_create'").length).toBe(1);
    expect(auditRows("action = 'appeal_create'")[0].metadata_json).not.toContain(user.id);
    const n = notifs(user.id, 'mod.appeal_received');
    expect(n.length).toBe(1);
    expect(JSON.parse(n[0].data_json)).toEqual({ outcome: 'open', sanctionId: sid });
    // second appeal → 409; activeSanction now reports appealStatus open + canAppeal false
    const dup = await me.post('/api/appeals').send({ sanctionId: sid, text: 'again' });
    expect(dup.status).toBe(409);
    const meBody = (await me.get('/api/me')).body;
    expect(meBody.activeSanction).toMatchObject({ id: sid, canAppeal: false, appealStatus: 'open' });
    const notices = (await me.get('/api/me/sanctions')).body.items as SanctionNotice[];
    expect(notices.find((x) => x.id === sid)).toMatchObject({ canAppeal: false, appealStatus: 'open' });
  });

  it('warnings cannot be appealed; the window closes after 14 days; a direct sanction appeals on the profile entity', async () => {
    const user = ctx.createUser();
    const admin = ctx.createUser({ role: 'admin' });
    const wid = applySanction({ userId: user.id, kind: 'warning', category: 'profanity', actor: admin });
    const me = ctx.as(user.id);
    const warn = await me.post('/api/appeals').send({ sanctionId: wid, text: 'please' });
    expect(warn.status).toBe(400);
    const mid = applySanction({ userId: user.id, kind: 'mute', durationMs: 7 * DAY, category: 'spam_scam', actor: admin });
    const t0 = now();
    setNow(t0 + 15 * DAY);
    const late = await me.post('/api/appeals').send({ sanctionId: mid, text: 'too late' });
    expect(late.status).toBe(400);
    expect(late.body.error.message).toMatch(/14-day/);
    setNow(t0);
    const sid = applySanction({ userId: user.id, kind: 'suspension', durationMs: 7 * DAY, category: 'spam_scam', actor: admin });
    const ok = await ctx.as(user.id).post('/api/appeals').send({ sanctionId: sid, text: 'A direct sanction, no content behind it.' });
    expect(ok.status).toBe(201);
    const item = ctx.db.prepare("SELECT * FROM mod_queue WHERE appeal_id = ?").get(ok.body.id) as ModQueueRow;
    expect(item).toMatchObject({ entity_type: 'profile', entity_id: user.id, surface: 'profile', source: 'appeal' });
    expect(serializeQueueItem(item, admin).excerpt).toContain(user.displayName); // profile text is the entity itself, public origin
  });
});

/* ───────────────────────────── quiet hours (T2) ───────────────────────────── */

describe('quiet hours (T2)', () => {
  it('window math wraps midnight and uses the campus country offset; disabled in tests unless QUIET_HOURS=on', () => {
    expect(isWithinWindow(23 * 60, 8 * 60, 23 * 60 + 30)).toBe(true);
    expect(isWithinWindow(23 * 60, 8 * 60, 3 * 60)).toBe(true);
    expect(isWithinWindow(23 * 60, 8 * 60, 8 * 60)).toBe(false);
    expect(isWithinWindow(23 * 60, 8 * 60, 12 * 60)).toBe(false);
    expect(isWithinWindow(9 * 60, 17 * 60, 10 * 60)).toBe(true);
    expect(isWithinWindow(9 * 60, 17 * 60, 20 * 60)).toBe(false);
    expect(isWithinWindow(600, 600, 600)).toBe(false);
    // 2026-03-10T05:00:00Z = 23:00 the previous evening in US Central (UTC−6)
    const at = Date.UTC(2026, 2, 10, 5, 0, 0);
    expect(localMinuteOfDay(at, -360)).toBe(23 * 60);
    expect(localMinuteOfDay(at, 0)).toBe(5 * 60);
    expect(isInQuietHours({ enabled: true, startMin: 23 * 60, endMin: 8 * 60 }, 'US', at)).toBe(true);
    expect(isInQuietHours({ enabled: true, startMin: 23 * 60, endMin: 8 * 60 }, 'GB', at)).toBe(true); // 05:00 London
    expect(isInQuietHours({ enabled: true, startMin: 23 * 60, endMin: 8 * 60 }, 'JP', at)).toBe(false); // 14:00 Tokyo
    expect(isInQuietHours({ enabled: false, startMin: 23 * 60, endMin: 8 * 60 }, 'US', at)).toBe(false);
    const maya = getAuthedUser('mayachen')!;
    expect(isInQuietHoursFor(maya.id, at)).toBe(true); // default settings: quiet 23:00–08:00, UT Austin
    expect(isInQuietHoursFor(maya.id, Date.UTC(2026, 2, 10, 18, 0, 0))).toBe(false); // noon in Austin
    ctx.db.prepare("UPDATE users SET settings_json = ? WHERE id = ?").run(JSON.stringify({ quietHours: { enabled: false } }), maya.id);
    expect(isInQuietHoursFor(maya.id, at)).toBe(false);
    expect(isInQuietHoursFor('ghost', at)).toBe(false);
    expect(quietHoursEnforced()).toBe(process.env.QUIET_HOURS === 'on');
  });
});
