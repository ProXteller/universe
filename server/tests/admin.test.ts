/**
 * `admin` slice tests (SPEC §5.11; safety §8.2 #1 admin half, #5, #9–#10 where admin-owned). Isolation mode:
 * `createTestApp({ slices: ['admin'] })`. Content adapters for `buzz` / `buzz_reply` / `orbit_post` are in-memory fakes
 * (the owner slices are not loaded here); `message` / `conversation` / `profile` are foundation's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentEntityType, Id } from '@shared/core';
import type { AuditRow, StaffAppeal, StaffQueueItem, StaffQueueItemDetail, StaffSanctionRow, StaffUserDetail, UnmaskResponse } from '@shared/admin';
import { LIMITATIONS } from '@shared/admin';
import { trackEvent } from '../src/lib/analytics';
import { DAY, MIN, now, setNow } from '../src/lib/clock';
import { registerContentAdapter, type ContentAdapter, type ContentSnapshot } from '../src/lib/content';
import { blockedTarget, listRulePacks, modCtx, moderateWrite, setRulePackEnabled } from '../src/lib/moderation/index';
import { upsertQueueItem } from '../src/lib/moderation/queue';
import { getQueueRow, type AuditRowCore, type ModQueueRow, type StaffQueueItemCore, type StaffSanctionRowCore } from '../src/lib/moderation/staff';
import { createReport } from '../src/lib/reports';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../src/lib/testing';
import { getAuthedUser, type AuthedUser } from '../src/lib/users';
import { joinWaitlist } from '../src/lib/waitlist';
import { unmaskSubjectTag } from '../src/services/admin/common';
import { DEMO, U } from '../src/db/seeds/ids';

/* ───────────────────────────── compile-time contract checks (SPEC §4.2.14 / §5.11) ───────────────────────────── */

// StaffQueueItem ⇄ StaffQueueItemCore, AuditRow ⇄ AuditRowCore, StaffSanctionRow ⇄ StaffSanctionRowCore — both directions.
function _assignability(a: StaffQueueItem, b: StaffQueueItemCore, c: AuditRow, d: AuditRowCore, e: StaffSanctionRow, f: StaffSanctionRowCore): unknown[] {
  const a2: StaffQueueItemCore = a;
  const b2: StaffQueueItem = b;
  const c2: AuditRowCore = c;
  const d2: AuditRow = d;
  const e2: StaffSanctionRowCore = e;
  const f2: StaffSanctionRow = f;
  return [a2, b2, c2, d2, e2, f2];
}
void _assignability;

/* ───────────────────────────── fixtures ───────────────────────────── */

let ctx: TestCtx;
const memory = new Map<string, ContentSnapshot>();
const locked = new Set<string>();
const unregisters: (() => void)[] = [];

const ALIAS = { emoji: '🪐', label: 'Anon Comet', color: '#f87171' };

function adapterFor(entityType: ContentEntityType): ContentAdapter {
  const key = (id: string): string => `${entityType}:${id}`;
  const anon = entityType === 'buzz' || entityType === 'buzz_reply';
  return {
    entityType,
    load: (id) => memory.get(key(id)) ?? null,
    setStatus: (id, status, opts) => {
      const s = memory.get(key(id));
      if (s) memory.set(key(id), { ...s, status, autoHideImmune: opts?.immune ? true : s.autoHideImmune });
    },
    staffContext: (id) => {
      const s = memory.get(key(id));
      if (!s || !anon) return null;
      const item = { id, kind: 'buzz', threadId: id, alias: ALIAS, isOp: true, isMine: false, text: s.fields[0]?.text ?? '', score: 0, status: s.status, createdAt: s.createdAt };
      return { entityType, item, root: item, parents: [], siblings: [] };
    },
    ...(entityType === 'buzz'
      ? {
          setLocked: (id: Id, l: boolean) => {
            if (l) locked.add(id);
            else locked.delete(id);
          },
        }
      : {}),
  };
}

function seedItem(entityType: ContentEntityType, id: Id, authorId: Id, text: string, extra: Partial<ContentSnapshot> = {}): void {
  const anon = entityType === 'buzz' || entityType === 'buzz_reply';
  memory.set(`${entityType}:${id}`, {
    entityType, entityId: id, authorId, universityId: 'uni_utexas', status: 'active',
    surface: anon ? 'buzz' : 'orbit_post', anon, autoHideImmune: false, createdAt: now(),
    label: anon ? 'buzz' : 'post', fields: [{ field: 'body', text }], media: [], href: `/x/${id}`, parent: null, ...extra,
  });
}

function queueFor(
  entityType: ContentEntityType,
  id: Id,
  authorId: Id,
  o: { priority?: 'p0' | 'p1' | 'p2' | 'p3'; category?: string; severity?: 'none' | 'low' | 'medium' | 'high' | 'critical'; source?: 'rule_flag' | 'user_report'; label?: string | null } = {},
): ModQueueRow {
  const snap = memory.get(`${entityType}:${id}`)!;
  const qid = upsertQueueItem({
    entityType, entityId: id, surface: snap.surface, universityId: 'uni_utexas', authorId, source: o.source ?? 'rule_flag',
    category: (o.category as 'harassment_bullying') ?? 'harassment_bullying', severity: o.severity ?? 'medium', priority: o.priority ?? 'p1', label: o.label ?? null,
  });
  return getQueueRow(qid)!;
}

const A = '/api/admin';
const act = (agent: ReturnType<TestCtx['as']>, id: Id, body: Record<string, unknown>) => agent.post(`${A}/queue/${id}/actions`).send(body);
const auditRows = (where = '1=1', ...params: unknown[]): { action: string; target_type: string | null; target_id: string | null; queue_id: string | null; metadata_json: string; batch_id: string | null; created_at: number }[] =>
  ctx.db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at, rowid`).all(...params) as never;

interface Staff {
  mod: AuthedUser;
  mod2: AuthedUser;
  admin: AuthedUser;
  admin2: AuthedUser;
}
function staff(): Staff {
  return {
    mod: ctx.createUser({ role: 'moderator' }),
    mod2: ctx.createUser({ role: 'moderator' }),
    admin: ctx.createUser({ role: 'admin' }),
    admin2: ctx.createUser({ role: 'admin' }),
  };
}

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['admin'] });
  memory.clear();
  locked.clear();
  for (const t of ['buzz', 'buzz_reply', 'orbit_post'] as const) unregisters.push(registerContentAdapter(adapterFor(t)));
});
afterEach(() => {
  for (const u of unregisters.splice(0)) u();
  setNow(null);
  for (const p of listRulePacks()) setRulePackEnabled(p.id, true);
});

/* ───────────────────────────── access ───────────────────────────── */

const ROUTES: [string, string, Record<string, unknown>?][] = [
  ['get', '/queue'], ['get', '/queue/counts'], ['get', '/queue/x'], ['post', '/queue/x/claim'], ['post', '/queue/x/release'],
  ['post', '/queue/x/actions', { action: 'approve', category: 'spam_scam' }], ['post', '/queue/bulk', { ids: ['x'], action: 'approve', category: 'spam_scam' }],
  ['post', '/buzz/buzz/x/unmask', { reasonCode: 'credible_threat', reason: 'x'.repeat(40), confirmText: 'UNMASK' }],
  ['get', '/audit'], ['get', '/audit/export.csv'], ['get', '/users?q=a'], ['get', '/users/x'], ['post', '/users/x/role', { role: 'moderator' }],
  ['post', '/users/x/verify', { verified: true }], ['post', '/users/x/sanctions', { kind: 'warning', category: 'spam_scam', note: 'n'.repeat(12) }],
  ['post', '/sanctions/x/lift', { note: 'n'.repeat(12) }], ['get', '/appeals'], ['get', '/appeals/x'], ['post', '/appeals/x/decide', { outcome: 'upheld', note: 'n'.repeat(12) }],
  ['get', '/analytics/overview'], ['get', '/analytics/apartments'], ['get', '/analytics/moderation'], ['get', '/rule-packs'],
  ['patch', '/rule-packs/baseline', { enabled: true }], ['get', '/limitations'],
];

describe('access (safety §6, SPEC §4.2.5)', () => {
  it('non-staff get 404 on every route; signed-out get 401', async () => {
    // a fresh agent and `Connection: close` per probe: a stale keep-alive socket must never poison the next request
    for (const [method, path, body] of ROUTES) {
      const m = method as 'get' | 'post' | 'patch';
      const r = await ctx.as('mayachen')[m](`${A}${path}`).set('Connection', 'close').send(body ?? {});
      expect(r.status, `${method} ${path}`).toBe(404);
      const r2 = await ctx.anon()[m](`${A}${path}`).set('Connection', 'close').send(body ?? {});
      expect(r2.status, `anon ${method} ${path}`).toBe(401);
    }
  });

  it('moderator vs admin matrix: admin-only endpoints answer 404 to moderators, admin-only actions 403', async () => {
    const s = staff();
    const mod = ctx.as(s.mod.id);
    const admin = ctx.as(s.admin.id);
    expect((await mod.get(`${A}/rule-packs`)).status).toBe(404);
    expect((await mod.patch(`${A}/rule-packs/baseline`).send({ enabled: true })).status).toBe(404);
    expect((await mod.post(`${A}/users/${s.mod2.id}/role`).send({ role: 'user' })).status).toBe(404);
    expect((await mod.post(`${A}/users/${s.mod2.id}/verify`).send({ verified: true })).status).toBe(404);
    expect((await mod.post(`${A}/sanctions/x/lift`).send({ note: 'n'.repeat(12) })).status).toBe(404);
    expect((await mod.get(`${A}/audit/export.csv`)).status).toBe(404);
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'rude post');
    const q = queueFor('orbit_post', 'p1', author.id);
    for (const action of ['suspend_7d', 'suspend_30d', 'ban', 'escalate_external', 'lift_sanction']) {
      const r = await act(mod, q.id, { action, category: 'harassment_bullying', note: 'n'.repeat(40), confirmText: 'BAN', reference: 'X-1' });
      expect(r.status, action).toBe(403);
    }
    const packs = await admin.get(`${A}/rule-packs`);
    expect(packs.status).toBe(200);
    expect(packs.body.nextCursor).toBeNull();
    expect((packs.body.items as { id: string }[]).map((p) => p.id)).toEqual(expect.arrayContaining(['baseline', 'admin.threats', 'admin.harassment', 'admin.hate', 'admin.sexual', 'admin.drugs', 'admin.selfharm', 'admin.pii', 'admin.impersonation', 'admin.spam', 'admin.academic', 'admin.commerce']));
    const lim = await mod.get(`${A}/limitations`);
    expect(lim.body.items).toEqual(LIMITATIONS);
    expect(lim.headers['cache-control']).toBe('no-store');
  });
});

/* ───────────────────────────── queue ───────────────────────────── */

describe('queue (safety §6.2 / §6.3)', () => {
  it('list, counts and detail for anon entities pass the firewall checks for both roles; blind author panel; canUnmask only for admins', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('buzz', 'b1', author.id, 'zq firewall probe text kilo');
    const q = queueFor('buzz', 'b1', author.id, { priority: 'p1' });
    const reporter = ctx.createUser();
    createReport(reporter, { entityType: 'buzz', entityId: 'b1', reason: 'harassment', note: 'they keep doing this' });
    const ids = ctx.seededIdentityStrings();
    for (const who of [s.mod, s.admin]) {
      const agent = ctx.as(who.id);
      const list = await agent.get(`${A}/queue?view=priority`);
      expect(list.status).toBe(200);
      expect(list.body.items.map((i: StaffQueueItem) => i.id)).toContain(q.id);
      const item = list.body.items.find((i: StaffQueueItem) => i.id === q.id) as StaffQueueItem;
      expect(item.anon).toBe(true);
      expect(item.excerpt).toBe('zq firewall probe text kilo');
      expect(item.reportCount).toBe(1);
      assertNoForbiddenKeys(list.body);
      assertNoIdentityLeak(list.body, ids);
      const counts = await agent.get(`${A}/queue/counts`);
      expect(counts.body.priority).toBe(1);
      expect(counts.body.reports).toBe(1);
      const detail = await agent.get(`${A}/queue/${q.id}`);
      expect(detail.status).toBe(200);
      const d = detail.body as StaffQueueItemDetail;
      assertNoForbiddenKeys(d);
      assertNoIdentityLeak(d, ids);
      expect(d.author.kind).toBe('blind');
      expect(d.fields[0]!.text).toBe('zq firewall probe text kilo');
      expect((d.context as { item: { alias: typeof ALIAS } }).item.alias.label).toBe('Anon Comet');
      expect(d.reports.length).toBe(1);
      // reporter identity is never joined to an anon item, for any role (the L1 key walk is binding)
      expect(d.reports[0]!.reporter).toBeNull();
      expect(d.canUnmask).toBe(who.role === 'admin');
      expect(d.suggestion?.action).toBeDefined();
      // the ladder hint on an anon item quotes a blind bucket, never the exact strike total (rule 5, for every role)
      expect(d.suggestion!.reason).toMatch(/^Strike points after this violation: (0|1|2|3-5|6\+) → /);
      expect(d.suggestion!.reason).not.toMatch(/\d+ active strike point/);
      expect(d.claimedByMe).toBe(true);
      await agent.post(`${A}/queue/${q.id}/release`);
    }
    expect(auditRows("action = 'reporter_viewed'").length).toBe(0);
  });

  it('public entity detail shows the author panel with standing; held / auto-hidden views resolve through the adapter', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'held post', { status: 'held' });
    seedItem('orbit_post', 'p2', author.id, 'hidden post', { status: 'hidden' });
    const q1 = queueFor('orbit_post', 'p1', author.id);
    const q2 = queueFor('orbit_post', 'p2', author.id, { source: 'user_report' });
    const reporter = ctx.createUser();
    createReport(reporter, { entityType: 'orbit_post', entityId: 'p2', reason: 'spam_scam' });
    const mod = ctx.as(s.mod.id);
    const detail = await mod.get(`${A}/queue/${q1.id}`);
    expect(detail.body.author.kind).toBe('public');
    expect(detail.body.author.user.id).toBe(author.id);
    expect(detail.body.author.strikePoints).toBe(0);
    expect(detail.body.contentStatus).toBe('held');
    // reporter identity on a PUBLIC item: admin only, audited once per day
    expect((await mod.get(`${A}/queue/${q2.id}`)).body.reports[0].reporter).toBeNull();
    await mod.post(`${A}/queue/${q2.id}/release`);
    const asAdmin = await ctx.as(s.admin.id).get(`${A}/queue/${q2.id}`);
    expect(asAdmin.body.reports[0].reporter).toEqual(expect.objectContaining({ id: reporter.id }));
    await ctx.as(s.admin.id).get(`${A}/queue/${q2.id}`);
    expect(auditRows("action = 'reporter_viewed'").length).toBe(1);
    await ctx.as(s.admin.id).post(`${A}/queue/${q2.id}/release`);
    const held = await mod.get(`${A}/queue?view=held`);
    expect(held.body.items.map((i: StaffQueueItem) => i.id)).toEqual([q1.id]);
    const hidden = await mod.get(`${A}/queue?view=auto_hidden`);
    expect(hidden.body.items.map((i: StaffQueueItem) => i.id)).toEqual([q2.id]);
    const counts = await mod.get(`${A}/queue/counts`);
    expect(counts.body.held).toBe(1);
    expect(counts.body.auto_hidden).toBe(1);
  });

  it('claim lease: 10 minutes, "being reviewed" for others, released by time', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'post');
    const q = queueFor('orbit_post', 'p1', author.id);
    const a = ctx.as(s.mod.id);
    const b = ctx.as(s.mod2.id);
    setNow(now());
    expect((await a.get(`${A}/queue/${q.id}`)).body.claimedByMe).toBe(true);
    const seenByB = await b.get(`${A}/queue/${q.id}`);
    expect(seenByB.body.claimedByOther).toBe(true);
    expect(seenByB.body.claimedByMe).toBe(false);
    expect((await act(b, q.id, { action: 'approve', category: 'harassment_bullying' })).status).toBe(409);
    expect((await b.post(`${A}/queue/${q.id}/claim`)).status).toBe(409);
    const mine = await a.get(`${A}/queue?view=mine`);
    expect(mine.body.items.map((i: StaffQueueItem) => i.id)).toEqual([q.id]);
    setNow(now() + 11 * MIN);
    const done = await act(b, q.id, { action: 'approve', category: 'harassment_bullying' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('closed');
    expect(done.body.resolution).toBe('approved');
  });

  it('conflict of interest: a moderator who reported the item cannot see or action it', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'post');
    const q = queueFor('orbit_post', 'p1', author.id);
    createReport(s.mod, { entityType: 'orbit_post', entityId: 'p1', reason: 'harassment' });
    const mod = ctx.as(s.mod.id);
    expect((await mod.get(`${A}/queue/${q.id}`)).status).toBe(404);
    expect((await act(mod, q.id, { action: 'approve', category: 'harassment_bullying' })).status).toBe(404);
    expect((await mod.get(`${A}/queue`)).body.items.map((i: StaffQueueItem) => i.id)).not.toContain(q.id);
    expect((await ctx.as(s.mod2.id).get(`${A}/queue/${q.id}`)).status).toBe(200);
  });

  it('validation: notes, unknown actions, BAN confirmation, self-harm never sanctions', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'post');
    const q = queueFor('orbit_post', 'p1', author.id);
    const admin = ctx.as(s.admin.id);
    expect((await act(admin, q.id, { action: 'remove', category: 'harassment_bullying' })).status).toBe(400);
    expect((await act(admin, q.id, { action: 'nuke', category: 'harassment_bullying' })).status).toBe(400);
    expect((await act(admin, q.id, { action: 'ban', category: 'harassment_bullying', note: 'n'.repeat(40) })).status).toBe(400);
    expect((await act(admin, q.id, { action: 'ban', category: 'harassment_bullying', note: 'short', confirmText: 'BAN' })).status).toBe(400);
    expect((await act(admin, q.id, { action: 'escalate_external', category: 'harassment_bullying', note: 'n'.repeat(20) })).status).toBe(400);
    const r = await act(admin, q.id, { action: 'remove_and_warn', category: 'self_harm', note: 'n'.repeat(20) });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/never sanction/i);
  });

  it('approve closes the item, dismisses reports (reporter notified: no_violation) and immunises the content', async () => {
    const s = staff();
    const author = ctx.createUser();
    const reporter = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'fine post');
    const q = queueFor('orbit_post', 'p1', author.id, { source: 'user_report' });
    createReport(reporter, { entityType: 'orbit_post', entityId: 'p1', reason: 'harassment' });
    const r = await act(ctx.as(s.mod.id), q.id, { action: 'approve', category: 'harassment_bullying' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('closed');
    expect(r.body.resolution).toBe('approved');
    expect(memory.get('orbit_post:p1')!.autoHideImmune).toBe(true);
    expect((ctx.db.prepare("SELECT status FROM reports WHERE reporter_id = ?").get(reporter.id) as { status: string }).status).toBe('dismissed');
    const n = ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'mod.report_resolved'").get(reporter.id) as { data_json: string };
    expect(JSON.parse(n.data_json).outcome).toBe('no_violation');
    expect(r.body.history.map((h: { action: string }) => h.action)).toEqual(['approve']);
  });

  it('remove_and_mute_24h: content removed, strike, mute, reporters notified, history without actor names for moderators', async () => {
    const s = staff();
    const author = ctx.createUser();
    const reporter = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'rude post');
    const q = queueFor('orbit_post', 'p1', author.id, { severity: 'high' });
    createReport(reporter, { entityType: 'orbit_post', entityId: 'p1', reason: 'harassment' });
    const r = await act(ctx.as(s.admin.id), q.id, { action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'clearly targeted at a classmate' });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe('sanctioned');
    expect(memory.get('orbit_post:p1')!.status).toBe('removed');
    expect(ctx.db.prepare('SELECT points FROM strikes WHERE user_id = ?').all(author.id)).toEqual([{ points: 3 }]);
    const mute = ctx.db.prepare("SELECT kind, ends_at, effective_at FROM user_sanctions WHERE user_id = ? AND kind = 'mute'").get(author.id) as { kind: string; ends_at: number; effective_at: number };
    expect(mute.ends_at - mute.effective_at).toBe(24 * 60 * MIN);
    expect((ctx.db.prepare("SELECT status FROM reports WHERE reporter_id = ?").get(reporter.id) as { status: string }).status).toBe('actioned');
    const asMod = await ctx.as(s.mod.id).get(`${A}/queue/${q.id}`);
    expect(asMod.body.history[0].actorName).toBeNull();
    expect(asMod.body.history[0].actorRole).toBe('admin');
    expect(asMod.body.author.sanctions.map((x: StaffSanctionRow) => x.kind)).toEqual(expect.arrayContaining(['removal', 'mute']));
  });

  it('lock_thread only on Buzz roots; escalate leaves the moderator queues; zero tolerance suspends', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('buzz', 'b1', author.id, 'thread');
    seedItem('orbit_post', 'p1', author.id, 'post');
    seedItem('orbit_post', 'p2', author.id, 'minor post');
    const qb = queueFor('buzz', 'b1', author.id);
    const qp = queueFor('orbit_post', 'p1', author.id);
    const qz = queueFor('orbit_post', 'p2', author.id, { severity: 'critical', category: 'sexual_minors', priority: 'p0' });
    const mod = ctx.as(s.mod.id);
    expect((await act(mod, qb.id, { action: 'lock_thread', category: 'harassment_bullying', note: 'locking the pile-on' })).status).toBe(200);
    expect(locked.has('b1')).toBe(true);
    expect((await act(mod, qp.id, { action: 'lock_thread', category: 'harassment_bullying', note: 'locking the pile-on' })).status).toBe(400);
    expect((await act(mod, qp.id, { action: 'escalate', category: 'harassment_bullying', note: 'needs admin eyes' })).status).toBe(200);
    expect((await mod.get(`${A}/queue/${qp.id}`)).status).toBe(404);
    const admin = ctx.as(s.admin.id);
    expect((await admin.get(`${A}/queue?view=escalated`)).body.items.map((i: StaffQueueItem) => i.id)).toEqual([qp.id]);
    expect((await mod.get(`${A}/queue?view=escalated`)).body.items).toEqual([]);
    expect((await act(mod, qz.id, { action: 'remove', category: 'sexual_minors', note: 'zero tolerance content' })).status).toBe(200);
    expect(getAuthedUser(author.id)!.status).toBe('suspended');
  });

  it('bulk: ≤ 50 ids, not for P0 / wellbeing / escalated / appeals, one audit row per item sharing batchId', async () => {
    const s = staff();
    const author = ctx.createUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      seedItem('orbit_post', `p${i}`, author.id, `post ${i}`);
      ids.push(queueFor('orbit_post', `p${i}`, author.id, { priority: 'p2' }).id);
    }
    seedItem('buzz', 'w', author.id, 'wellbeing');
    const p0 = queueFor('buzz', 'w', author.id, { priority: 'p0', label: 'wellbeing', category: 'self_harm' });
    const mod = ctx.as(s.mod.id);
    expect((await mod.post(`${A}/queue/bulk`).send({ ids: Array.from({ length: 51 }, (_, i) => `x${i}`), action: 'approve', category: 'spam_scam' })).status).toBe(400);
    const r = await mod.post(`${A}/queue/bulk`).send({ ids: [...ids, p0.id, 'nope'], action: 'approve', category: 'spam_scam' });
    expect(r.status).toBe(200);
    const byId = new Map((r.body.results as { id: string; ok: boolean; error?: string }[]).map((x) => [x.id, x]));
    for (const id of ids) expect(byId.get(id)?.ok).toBe(true);
    expect(byId.get(p0.id)).toEqual({ id: p0.id, ok: false, error: 'not_bulk_eligible' });
    expect(byId.get('nope')).toEqual({ id: 'nope', ok: false, error: 'not_found' });
    expect(auditRows('batch_id = ?', r.body.batchId).length).toBe(3);
    expect((await mod.get(`${A}/queue/counts`)).body.priority).toBe(1);
  });
});

/* ───────────────────────────── named-account firewall (SPEC §3.2 #9, §4.2.14) ───────────────────────────── */

describe('named-account firewall', () => {
  it('a Buzz sanction never reaches a moderator through /users, /audit or /appeals; admins see origin anon, day-floored, no excerpt', async () => {
    const s = staff();
    const author = ctx.createUser();
    const text = 'zq firewall probe text kilo lima';
    seedItem('buzz', 'b1', author.id, text);
    const q = queueFor('buzz', 'b1', author.id, { severity: 'high' });
    const mod = ctx.as(s.mod.id);
    const before = (await mod.get(`${A}/users/${author.id}`)).body as StaffUserDetail;
    expect(before.strikePoints).toBe(0);
    expect(before.openQueueItems).toBe(0);
    expect(before.sanctions).toEqual([]);
    expect(before.email).toBeNull();

    const r = await act(mod, q.id, { action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'pile-on call aimed at a floor mate' });
    expect(r.status).toBe(200);
    assertNoForbiddenKeys(r.body);
    assertNoIdentityLeak(r.body, ctx.seededIdentityStrings());
    expect(memory.get('buzz:b1')!.status).toBe('removed');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM user_sanctions WHERE user_id = ? AND kind = 'mute'").get(author.id)).toEqual({ n: 1 });

    // the user appeals (their own excerpt is only ever on GET /me/sanctions)
    const mute = ctx.db.prepare("SELECT id FROM user_sanctions WHERE user_id = ? AND kind = 'mute'").get(author.id) as { id: string };
    const appeal = await ctx.as(author.id).post('/api/appeals').send({ sanctionId: mute.id, text: 'That was a joke among friends on the floor, nobody was hurt.' });
    expect(appeal.status).toBe(201);

    const after = (await mod.get(`${A}/users/${author.id}`)).body as StaffUserDetail;
    expect(after.strikePoints).toBe(before.strikePoints);
    expect(after.openQueueItems).toBe(before.openQueueItems);
    expect(after.sanctions).toEqual([]);
    const search = await mod.get(`${A}/users?q=${author.handle}`);
    expect(search.body.items.map((u: StaffUserDetail) => u.user.id)).toContain(author.id);
    const audit = await mod.get(`${A}/audit`);
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
    for (const body of [after, search.body, audit.body]) expect(JSON.stringify(body)).not.toContain(text.slice(0, 12));
    for (const row of audit.body.items as AuditRow[]) {
      expect(row.targetType === 'user' && row.targetId === author.id, JSON.stringify(row)).toBe(false);
      expect(JSON.stringify(row.metadata ?? {})).not.toContain(author.id);
    }
    // rule 2 on a PUBLIC item by the same author: the ladder hint uses the moderator-visible tally (public-origin only),
    // so it agrees with the author panel instead of betraying the hidden Buzz strike (0 + medium 2 = 2, not 3 + 2)
    seedItem('orbit_post', 'p9', author.id, 'a public post by the same author');
    const pub = queueFor('orbit_post', 'p9', author.id);
    const modHint = (await mod.get(`${A}/queue/${pub.id}`)).body as StaffQueueItemDetail;
    expect(modHint.author.kind).toBe('public');
    expect(modHint.suggestion?.reason).toMatch(/^2 active strike points after this violation/);
    await mod.post(`${A}/queue/${pub.id}/release`);
    const appeals = await mod.get(`${A}/appeals`);
    expect(appeals.status).toBe(200);
    expect(appeals.body.items.length).toBe(1);
    assertNoIdentityLeak(appeals.body, ctx.seededIdentityStrings());
    const a = appeals.body.items[0] as StaffAppeal;
    expect(a.sanction.origin).toBe('anon');
    expect(a.sanction.id).toBe(a.id);
    expect(a.contentExcerpt).toBe(text);
    expect(a.canReview).toBe(false); // the moderator actioned it

    const admin = ctx.as(s.admin.id);
    const asAdmin = (await admin.get(`${A}/users/${author.id}`)).body as StaffUserDetail;
    const anonRows = asAdmin.sanctions.filter((x) => x.origin === 'anon');
    expect(anonRows.map((x) => x.kind)).toEqual(expect.arrayContaining(['mute', 'removal']));
    for (const row of anonRows) {
      expect('contentExcerpt' in row).toBe(false);
      expect('contentLabel' in row).toBe(false);
      expect(row.startsAt % DAY).toBe(0);
      expect(row.createdAt % DAY).toBe(0);
    }
    expect(asAdmin.strikePoints).toBe(3);
    expect(asAdmin.email).toBe(author.email);
    expect(JSON.stringify(asAdmin)).not.toContain(text.slice(0, 12));
    // admins see every origin, so their hint is the true tally (3 + 2 = 5)
    const adminHint = (await admin.get(`${A}/queue/${pub.id}`)).body as StaffQueueItemDetail;
    expect(adminHint.suggestion?.reason).toMatch(/^5 active strike points after this violation/);
  });
});

/* ───────────────────────────── unmask (safety §6.5, §8.2 #5) ───────────────────────────── */

describe('unmask', () => {
  it('moderator 404; short reason / wrong confirmation 400; ok 200 with the audit row before the identity row; other admins alerted; no-store', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('buzz', 'b1', author.id, 'threat-ish buzz');
    const q = queueFor('buzz', 'b1', author.id, { category: 'threat_violence', severity: 'high', priority: 'p0' });
    const path = `${A}/buzz/buzz/b1/unmask`;
    const body = { reasonCode: 'credible_threat', reason: 'Vague warning to avoid a building tomorrow; campus safety asked us to identify the account tonight.', confirmText: 'UNMASK' };
    expect((await ctx.as(s.mod.id).post(path).send(body)).status).toBe(404);
    const admin = ctx.as(s.admin.id);
    expect((await admin.post(path).send({ ...body, reason: 'too short' })).status).toBe(400);
    expect((await admin.post(path).send({ ...body, confirmText: 'unmask' })).status).toBe(400);
    expect((await admin.post(path).send({ ...body, reasonCode: 'curiosity' })).status).toBe(400);
    expect((await admin.post(`${A}/buzz/buzz/nope/unmask`).send(body)).status).toBe(404);
    expect(auditRows("action = 'buzz_unmask'").length).toBe(0);

    const r = await admin.post(path).send(body);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const u = r.body as UnmaskResponse;
    expect(u.user).toEqual({ id: author.id, handle: author.handle, displayName: author.displayName, email: author.email, universityId: 'uni_utexas' });
    expect(u.expiresAt - now()).toBeGreaterThan(4 * MIN);
    const rows = auditRows("action IN ('buzz_unmask','buzz_unmask_subject')");
    expect(rows.map((x) => x.action)).toEqual(['buzz_unmask', 'buzz_unmask_subject']);
    expect(rows[0]!.queue_id).toBe(q.id);
    expect(rows[0]!.created_at).toBeLessThanOrEqual(rows[1]!.created_at);
    // the subject row proves which account was resolved (keyed tag) but never stores the id or handle (safety §6.6, P3)
    expect(JSON.parse(rows[1]!.metadata_json)).toEqual({ unmaskId: u.unmaskId, subjectTag: unmaskSubjectTag(author.id) });
    for (const row of rows) {
      expect(row.metadata_json).not.toContain(author.id);
      expect(row.metadata_json).not.toContain(author.handle);
    }
    expect(u.unmaskId).toBe((ctx.db.prepare("SELECT id FROM audit_log WHERE action = 'buzz_unmask'").get() as { id: string }).id);
    const alert = ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'admin.unmask_alert'").get(s.admin2.id) as { data_json: string } | undefined;
    expect(alert).toBeTruthy();
    expect(JSON.parse(alert!.data_json)).toEqual({ reasonCode: 'credible_threat', auditId: u.unmaskId });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'admin.unmask_alert'").get(s.admin.id)).toEqual({ n: 0 });

    // audit views: admins see the subject tag only (identity comes from the unmask endpoint alone); moderators (own rows) nothing
    const asAdmin = await admin.get(`${A}/audit?action=buzz_unmask_subject`);
    expect((asAdmin.body.items[0] as AuditRow).metadata?.subjectTag).toBe(unmaskSubjectTag(author.id));
    expect(JSON.stringify(asAdmin.body)).not.toContain(author.id);
    expect(JSON.stringify(asAdmin.body)).not.toContain(author.handle);
    const modAudit = await ctx.as(s.mod.id).get(`${A}/audit`);
    expect(JSON.stringify(modAudit.body)).not.toContain(author.id);
    expect(modAudit.body.items.map((x: AuditRow) => x.action)).not.toContain('buzz_unmask');
    // the CSV export goes through the same serializer
    const csv = await admin.get(`${A}/audit/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('buzz_unmask');
  });

  it('audit_log is append-only', () => {
    const s = staff();
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'x' WHERE actor_id = ?").run(s.admin.id)).not.toThrow();
    ctx.db.prepare("INSERT INTO audit_log (id, actor_id, actor_role, action, metadata_json, created_at) VALUES ('probe', ?, 'admin', 'probe', '{}', ?)").run(s.admin.id, now());
    expect(() => ctx.db.prepare("UPDATE audit_log SET action = 'y' WHERE id = 'probe'").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM audit_log WHERE id = 'probe'").run()).toThrow(/append-only/);
  });

  /* Polish P6: a BLOCKED Buzz write never becomes an entity (entity_id NULL). Threat / self-harm-risk items are still
     unmaskable by admins through the same endpoint + gate, addressed by the queue item id; nothing else is. */
  describe('blocked text (no entity)', () => {
    const THREAT = "the guy in 3rd floor jester, i'm gonna k1ll you tomorrow";
    const BODY = { reasonCode: 'credible_threat', reason: 'Blocked, specific threat to kill a floor resident tomorrow; campus police need the account tonight.', confirmText: 'UNMASK' };
    const identity = (u: AuthedUser): string[] => [u.id, u.handle, u.displayName, u.email];

    /** What the Buzz composer does: the engine blocks, commits the event + escalation queue item (entity_id NULL), throws 422. */
    function blockedBuzzWrite(author: AuthedUser, text: string): ModQueueRow {
      let err: unknown = null;
      try {
        moderateWrite([{ text }], modCtx(author, 'buzz'), blockedTarget(author, 'buzz'));
      } catch (e) {
        err = e;
      }
      expect((err as { code?: string } | null)?.code).toBe('content_blocked');
      const row = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = 'buzz' AND entity_id IS NULL AND author_id = ? ORDER BY created_at DESC LIMIT 1").get(author.id) as ModQueueRow | undefined;
      expect(row, 'a blocked critical threat escalates to the queue').toBeTruthy();
      return row!;
    }

    function blockedItem(authorId: Id, o: { category: 'spam_scam' | 'harassment_bullying' | 'self_harm'; label?: string | null; text: string }): Id {
      return upsertQueueItem({
        entityType: 'buzz', entityId: null, surface: 'buzz', universityId: 'uni_utexas', authorId, source: 'rule_block_escalation',
        category: o.category, severity: 'high', priority: 'p0', label: o.label ?? null, blockedText: o.text,
      });
    }

    it('escalated blocked threat: admin can unmask (audit first, subject tag, alert); moderator 404 and never sees it', async () => {
      const s = staff();
      const author = ctx.createUser();
      const ident = identity(author);
      const row = blockedBuzzWrite(author, THREAT);
      expect(row.entity_id).toBeNull();
      expect(row.blocked_text).toContain('k1ll');
      expect(row.category).toBe('threat_violence');
      const mod = ctx.as(s.mod.id);
      const admin = ctx.as(s.admin.id);
      const path = `${A}/buzz/buzz/${row.id}/unmask`;

      // moderator: blind item, no unmask control, endpoint 404; then escalates it out of the moderator queues
      const modDetail = await mod.get(`${A}/queue/${row.id}`);
      expect(modDetail.status).toBe(200);
      expect((modDetail.body as StaffQueueItemDetail).canUnmask).toBe(false);
      assertNoForbiddenKeys(modDetail.body);
      assertNoIdentityLeak(modDetail.body, ident);
      expect((await mod.post(path).send(BODY)).status).toBe(404);
      await mod.post(`${A}/queue/${row.id}/release`);
      const esc = await act(mod, row.id, { action: 'escalate', category: 'threat_violence', note: 'Specific threat to kill a floor resident tomorrow. Needs an admin tonight.' });
      expect(esc.status, JSON.stringify(esc.body)).toBe(200);
      expect((await mod.get(`${A}/queue/${row.id}`)).status).toBe(404);
      expect((await mod.post(path).send(BODY)).status).toBe(404);

      // admin: blind detail with the unmask control
      const d = (await admin.get(`${A}/queue/${row.id}`)).body as StaffQueueItemDetail;
      expect(d.status).toBe('escalated');
      expect(d.entityId).toBeNull();
      expect(d.author.kind).toBe('blind');
      expect(d.canUnmask).toBe(true);
      assertNoForbiddenKeys(d);
      assertNoIdentityLeak(d, ident);

      // same gate: reason ≥ 30, typed UNMASK, a valid reason code, the item's own entity type; none writes an audit row
      expect((await admin.post(path).send({ ...BODY, reason: 'too short' })).status).toBe(400);
      expect((await admin.post(path).send({ ...BODY, confirmText: 'unmask' })).status).toBe(400);
      expect((await admin.post(path).send({ ...BODY, reasonCode: 'curiosity' })).status).toBe(400);
      expect((await admin.post(`${A}/buzz/buzz_reply/${row.id}/unmask`).send(BODY)).status).toBe(404);
      expect(auditRows("action LIKE 'buzz_unmask%'").length).toBe(0);

      const r = await admin.post(path).send(BODY);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const u = r.body as UnmaskResponse;
      expect(u.user).toEqual({ id: author.id, handle: author.handle, displayName: author.displayName, email: author.email, universityId: 'uni_utexas' });
      expect(u.expiresAt - now()).toBeGreaterThan(4 * MIN);
      const rows = auditRows("action IN ('buzz_unmask','buzz_unmask_subject')");
      expect(rows.map((x) => x.action)).toEqual(['buzz_unmask', 'buzz_unmask_subject']);
      expect(rows.map((x) => [x.queue_id, x.target_type, x.target_id])).toEqual([[row.id, 'buzz', null], [row.id, 'buzz', null]]);
      expect(u.unmaskId).toBe((ctx.db.prepare("SELECT id, reason FROM audit_log WHERE action = 'buzz_unmask'").get() as { id: string }).id);
      expect((ctx.db.prepare("SELECT reason, reason_code FROM audit_log WHERE action = 'buzz_unmask'").get() as { reason: string; reason_code: string })).toEqual({ reason: BODY.reason, reason_code: 'credible_threat' });
      expect(JSON.parse(rows[1]!.metadata_json)).toEqual({ unmaskId: u.unmaskId, subjectTag: unmaskSubjectTag(author.id) });
      for (const x of rows) for (const sId of ident) expect(x.metadata_json).not.toContain(sId);
      const alert = ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'admin.unmask_alert'").get(s.admin2.id) as { data_json: string } | undefined;
      expect(JSON.parse(alert!.data_json)).toEqual({ reasonCode: 'credible_threat', auditId: u.unmaskId });

      // moderators: nothing in the audit view, no identity anywhere they can read
      const modAudit = await mod.get(`${A}/audit`);
      expect(modAudit.body.items.map((x: AuditRow) => x.action)).not.toContain('buzz_unmask');
      assertNoIdentityLeak(modAudit.body, ident);
      const modQueue = await mod.get(`${A}/queue?view=priority`);
      assertNoIdentityLeak(modQueue.body, ident);
    });

    it('non-threat blocked items stay masked (403, no audit row); a blocked self-harm risk is unmaskable by admins only; a queue id never stands in for an entity', async () => {
      const s = staff();
      const author = ctx.createUser();
      const admin = ctx.as(s.admin.id);
      const mod = ctx.as(s.mod.id);
      const spam = blockedItem(author.id, { category: 'spam_scam', text: 'dm me for cheap essays, guaranteed A, 20 bucks a page' });
      const harassment = blockedItem(author.id, { category: 'harassment_bullying', text: 'everyone on the fourth floor is a worthless loser' });
      for (const qid of [spam, harassment]) {
        const d = (await admin.get(`${A}/queue/${qid}`)).body as StaffQueueItemDetail;
        expect(d.canUnmask, qid).toBe(false);
        await admin.post(`${A}/queue/${qid}/release`);
        const r = await admin.post(`${A}/buzz/buzz/${qid}/unmask`).send(BODY);
        expect(r.status).toBe(403);
        assertNoIdentityLeak(r.body, identity(author));
      }
      expect(auditRows("action LIKE 'buzz_unmask%'").length).toBe(0);

      const wellbeing = blockedItem(author.id, { category: 'self_harm', label: 'wellbeing', text: 'i do not want to be here anymore, tonight is the night' });
      expect(((await mod.get(`${A}/queue/${wellbeing}`)).body as StaffQueueItemDetail).canUnmask).toBe(false);
      await mod.post(`${A}/queue/${wellbeing}/release`);
      expect(((await admin.get(`${A}/queue/${wellbeing}`)).body as StaffQueueItemDetail).canUnmask).toBe(true);
      expect((await mod.post(`${A}/buzz/buzz/${wellbeing}/unmask`).send({ ...BODY, reasonCode: 'self_harm_emergency' })).status).toBe(404);
      const ok = await admin.post(`${A}/buzz/buzz/${wellbeing}/unmask`).send({ ...BODY, reasonCode: 'self_harm_emergency' });
      expect(ok.status).toBe(200);
      expect((ok.body as UnmaskResponse).user.id).toBe(author.id);

      // an entity-backed Buzz item is unmasked by its entity id only; its queue id is not a second door
      seedItem('buzz', 'b9', author.id, 'threat-ish buzz');
      const q = queueFor('buzz', 'b9', author.id, { category: 'threat_violence', severity: 'high', priority: 'p0' });
      expect((await admin.post(`${A}/buzz/buzz/${q.id}/unmask`).send(BODY)).status).toBe(404);
      expect(auditRows("action = 'buzz_unmask'").length).toBe(1);
    });
  });
});

/* ───────────────────────────── users ───────────────────────────── */

describe('users', () => {
  it('search, role grants (audited), org verification, direct sanctions per role, lift', async () => {
    const s = staff();
    const student = ctx.createUser({ handle: 'zzsearchme' });
    const org = ctx.createUser({ accountType: 'org' });
    const mod = ctx.as(s.mod.id);
    const admin = ctx.as(s.admin.id);
    const found = await mod.get(`${A}/users?q=zzsear`);
    expect(found.body.items.map((u: StaffUserDetail) => u.user.id)).toEqual([student.id]);
    expect(found.body.items[0].email).toBeNull();
    expect((await admin.get(`${A}/users?q=zzsear`)).body.items[0].email).toBe(student.email);
    expect((await admin.get(`${A}/users?q=`)).body.items).toEqual([]);

    const role = await admin.post(`${A}/users/${student.id}/role`).send({ role: 'moderator' });
    expect(role.body.role).toBe('moderator');
    expect(auditRows("action = 'role_grant' AND target_id = ?", student.id).length).toBe(1);
    expect((await admin.post(`${A}/users/${s.admin.id}/role`).send({ role: 'user' })).status).toBe(400);
    expect((await admin.post(`${A}/users/${student.id}/verify`).send({ verified: true })).status).toBe(400);
    expect((await admin.post(`${A}/users/${org.id}/verify`).send({ verified: true })).body.user.isVerified).toBe(true);
    expect(auditRows("action = 'org_verify'").length).toBe(1);

    const target = ctx.createUser();
    expect((await mod.post(`${A}/users/${target.id}/sanctions`).send({ kind: 'suspension', category: 'spam_scam', note: 'n'.repeat(12) })).status).toBe(403);
    expect((await mod.post(`${A}/users/${target.id}/sanctions`).send({ kind: 'mute', category: 'spam_scam', note: 'short' })).status).toBe(400);
    const muted = await mod.post(`${A}/users/${target.id}/sanctions`).send({ kind: 'mute', durationMs: 72 * 60 * MIN, category: 'spam_scam', note: 'repeated referral spam in three group chats' });
    expect(muted.status).toBe(200);
    expect(muted.body.sanctions[0]).toMatchObject({ kind: 'mute', origin: 'public' });
    expect(getAuthedUser(target.id)!.activeStrikePoints).toBe(0);
    const canPost = await ctx.as(target.id).get('/api/me');
    expect(canPost.body.activeSanction.kind).toBe('mute');
    const lift = await admin.post(`${A}/sanctions/${muted.body.sanctions[0].id}/lift`).send({ note: 'lifted after a second look' });
    expect(lift.status).toBe(200);
    expect((await ctx.as(target.id).get('/api/me')).body.activeSanction).toBeNull();
    expect(auditRows("action = 'sanction_lift'").length).toBe(1);
  });

  it('ban via the queue adds banned_emails and blocks re-registration; deleted users 404', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'unacceptable');
    const q = queueFor('orbit_post', 'p1', author.id, { severity: 'critical' });
    const r = await act(ctx.as(s.admin.id), q.id, { action: 'ban', category: 'hate', note: 'third confirmed hate violation after a suspension; banning per the ladder', confirmText: 'BAN' });
    expect(r.status).toBe(200);
    expect(getAuthedUser(author.id)!.status).toBe('banned');
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM banned_emails').get() as { n: number }).n).toBe(1);
    const start = await ctx.anon().post('/api/auth/start').send({ email: author.email });
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe('email_banned');
    expect((await ctx.as(s.mod.id).get(`${A}/users/nope`)).status).toBe(404);
  });
});

/* ───────────────────────────── appeals (safety §4.5) ───────────────────────────── */

describe('appeals', () => {
  it('reviewer ≠ actor; reversed restores content, revokes the strike and lifts the mute; suspensions are admin only', async () => {
    const s = staff();
    const author = ctx.createUser();
    seedItem('orbit_post', 'p1', author.id, 'contested post');
    const q = queueFor('orbit_post', 'p1', author.id, { severity: 'medium' });
    const actor = ctx.as(s.admin.id);
    expect((await act(actor, q.id, { action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted insult at a named student' })).status).toBe(200);
    const mute = ctx.db.prepare("SELECT id FROM user_sanctions WHERE user_id = ? AND kind = 'mute'").get(author.id) as { id: string };
    const created = await ctx.as(author.id).post('/api/appeals').send({ sanctionId: mute.id, text: 'The post was about a public figure, not a classmate.' });
    expect(created.status).toBe(201);
    const appealId = created.body.id as string;

    const mine = await actor.get(`${A}/appeals`);
    expect(mine.body.items[0].canReview).toBe(false);
    expect((await actor.post(`${A}/appeals/${appealId}/decide`).send({ outcome: 'reversed', note: 'we got this one wrong' })).status).toBe(403);
    const reviewer = ctx.as(s.admin2.id);
    expect((await reviewer.get(`${A}/appeals/${appealId}`)).body.canReview).toBe(true);
    expect((await reviewer.post(`${A}/appeals/${appealId}/decide`).send({ outcome: 'reduced', note: 'shorter is enough here', reducedUntil: now() - 1 })).status).toBe(400);
    const decided = await reviewer.post(`${A}/appeals/${appealId}/decide`).send({ outcome: 'reversed', note: 'public figure, no classmate named' });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('reversed');
    expect(memory.get('orbit_post:p1')!.status).toBe('active');
    expect(getAuthedUser(author.id)!.activeStrikePoints).toBe(0);
    expect((await ctx.as(author.id).get('/api/me')).body.activeSanction).toBeNull();
    expect((ctx.db.prepare("SELECT status FROM mod_queue WHERE appeal_id = ?").get(appealId) as { status: string }).status).toBe('closed');
    expect(auditRows("action = 'appeal_decide'").length).toBe(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'mod.appeal_result'").get(author.id)).toEqual({ n: 1 });
    expect((await reviewer.post(`${A}/appeals/${appealId}/decide`).send({ outcome: 'upheld', note: 'already decided here' })).status).toBe(409);

    // suspension appeals are admin only
    const other = ctx.createUser();
    seedItem('orbit_post', 'p2', other.id, 'suspended for this');
    const q2 = queueFor('orbit_post', 'p2', other.id, { severity: 'high' });
    expect((await actor.post(`${A}/queue/${q2.id}/actions`).send({ action: 'suspend_7d', category: 'threat_violence', note: 'credible enough to suspend' })).status).toBe(200);
    const susp = ctx.db.prepare("SELECT id FROM user_sanctions WHERE user_id = ? AND kind = 'suspension'").get(other.id) as { id: string };
    const ap2 = await ctx.as(other.id).post('/api/appeals').send({ sanctionId: susp.id, text: 'I would like a second look at this decision please.' });
    expect(ap2.status).toBe(201);
    const modView = await ctx.as(s.mod.id).get(`${A}/appeals`);
    expect(modView.body.items.find((x: StaffAppeal) => x.id === ap2.body.id).canReview).toBe(false);
    expect((await ctx.as(s.mod.id).post(`${A}/appeals/${ap2.body.id}/decide`).send({ outcome: 'upheld', note: 'stands as decided' })).status).toBe(403);
    expect((await reviewer.post(`${A}/appeals/${ap2.body.id}/decide`).send({ outcome: 'upheld', note: 'stands as decided' })).status).toBe(200);
  });
});

/* ───────────────────────────── rule packs + analytics ───────────────────────────── */

describe('rule packs and analytics', () => {
  it('rule-pack toggle is admin only, persisted and audited', async () => {
    const s = staff();
    const admin = ctx.as(s.admin.id);
    const off = await admin.patch(`${A}/rule-packs/admin.spam`).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ id: 'admin.spam', enabled: false });
    expect(listRulePacks().find((p) => p.id === 'admin.spam')!.enabled).toBe(false);
    expect(ctx.db.prepare('SELECT enabled FROM admin_rule_pack_state WHERE pack_id = ?').get('admin.spam')).toEqual({ enabled: 0 });
    expect(auditRows("action = 'rule_pack_toggle'").length).toBe(1);
    expect((await admin.patch(`${A}/rule-packs/nope`).send({ enabled: false })).status).toBe(404);
    const on = await admin.patch(`${A}/rule-packs/admin.spam`).send({ enabled: true });
    expect(on.body.enabled).toBe(true);
    expect((await admin.get(`${A}/rule-packs`)).body.items.find((p: { id: string }) => p.id === 'admin.spam').enabled).toBe(true);
  });

  it('Apartments funnel math from tracked events + waitlist; overview and moderation metrics have the contract shape', async () => {
    const s = staff();
    const users = [ctx.createUser({ createdAt: now() - DAY }), ctx.createUser({ createdAt: now() - DAY }), ctx.createUser({ createdAt: now() - DAY })];
    const c = (u: AuthedUser) => ({ userId: u.id, universityId: u.universityId });
    for (const u of users) trackEvent('apartments.page_view', c(u));
    trackEvent('apartments.page_view', c(users[0]!));
    trackEvent('apartments.page_view', c(users[1]!));
    trackEvent('apartments.cta_click', c(users[0]!));
    trackEvent('apartments.cta_click', c(users[1]!));
    trackEvent('apartments.survey_start', c(users[0]!));
    trackEvent('apartments.survey_start', c(users[1]!));
    trackEvent('apartments.survey_complete', c(users[0]!));
    joinWaitlist(users[0]!.id, 'apartments');
    joinWaitlist(users[1]!.id, 'apartments');
    trackEvent('post_create', c(users[2]!));
    const mod = ctx.as(s.mod.id);
    const funnel = await mod.get(`${A}/analytics/apartments`);
    expect(funnel.status).toBe(200);
    expect(funnel.body.totals).toEqual({ views: 5, ctaClicks: 2, surveyStarts: 2, surveyCompletes: 1, waitlist: 2 });
    expect(funnel.body.byCampus[0]).toMatchObject({ universityShortName: 'UT Austin', views: 5, waitlist: 2 });
    const to = now();
    const overview = await mod.get(`${A}/analytics/overview?from=${to - 7 * DAY}&to=${to}`);
    expect(overview.status).toBe(200);
    expect(overview.body.signupsByCampus.find((x: { universityShortName: string }) => x.universityShortName === 'UT Austin').count).toBeGreaterThanOrEqual(3);
    expect(overview.body.dau.length).toBe(8);
    expect(overview.body.dau[7].count).toBe(3);
    expect(overview.body.activationRate).toBeGreaterThan(0);
    expect(overview.body.activationRate).toBeLessThanOrEqual(1);
    expect(overview.body.range.to - overview.body.range.from).toBe(7 * DAY);
    const metrics = await mod.get(`${A}/analytics/moderation`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.openByPriority).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
    expect(metrics.body.timeToFirstAction.p0.slaMin).toBe(60);
    expect(metrics.body.activeSanctions).toEqual({ warning: 0, mute: 0, suspension: 0, ban: 0 });
  });
});

/* ───────────────────────────── seed (§5.11 / §7.5) ───────────────────────────── */

describe('seed', () => {
  it('9 open / 14 closed, exactly one buzz_unmask, ≥ 20 audit rows, ryanoc muted (public origin), no user-targeted anon audit row; staff views work', async () => {
    ctx = await createTestApp({ slices: ['admin'], seed: 'all' });
    const count = (sql: string, ...p: unknown[]): number => (ctx.db.prepare(sql).get(...p) as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM mod_queue WHERE status != 'closed'")).toBe(9);
    expect(count("SELECT COUNT(*) AS n FROM mod_queue WHERE status = 'closed'")).toBe(14);
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'buzz_unmask'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE action != 'role_bootstrap'")).toBeGreaterThanOrEqual(20);
    const mute = ctx.db.prepare("SELECT * FROM user_sanctions WHERE user_id = ? AND kind = 'mute' AND lifted_at IS NULL AND ends_at > ?").get(U.ryanoc, now()) as { entity_type: string | null };
    expect(mute).toBeTruthy();
    expect(mute.entity_type).toBe('profile');
    expect(count(`SELECT COUNT(*) AS n FROM audit_log a JOIN mod_queue q ON q.id = a.queue_id WHERE q.entity_type IN ('buzz','buzz_reply') AND a.target_type = 'user' AND a.action != 'buzz_unmask'`)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM appeals')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM mod_queue WHERE source = 'appeal' AND status != 'closed'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM mod_queue WHERE label = 'wellbeing' AND status != 'closed'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM mod_queue WHERE status = 'escalated'")).toBe(1);
    // report_count equals rows
    const drift = ctx.db.prepare('SELECT q.id FROM mod_queue q WHERE q.report_count != (SELECT COUNT(*) FROM reports r WHERE r.queue_id = q.id)').all();
    expect(drift).toEqual([]);
    // strikes consistent with removals
    expect(count("SELECT COUNT(*) AS n FROM strikes")).toBe(count("SELECT COUNT(*) AS n FROM moderation_actions WHERE action LIKE 'remove%'"));

    const mod = ctx.as(DEMO.moderator);
    const ids = ctx.seededIdentityStrings();
    const list = await mod.get(`${A}/queue`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(6);
    for (const item of list.body.items as StaffQueueItem[]) {
      if (item.anon) {
        assertNoForbiddenKeys(item);
        assertNoIdentityLeak(item, ids);
        const detail = await mod.get(`${A}/queue/${item.id}`);
        expect(detail.status).toBe(200);
        assertNoForbiddenKeys(detail.body);
        assertNoIdentityLeak(detail.body, ids);
        expect(detail.body.author.kind).toBe('blind');
      }
    }
    const counts = await mod.get(`${A}/queue/counts`);
    expect(counts.body.wellbeing).toBe(1);
    expect(counts.body.appeals).toBe(1);
    expect(counts.body.escalated).toBe(0);
    const admin = ctx.as(DEMO.admin);
    expect((await admin.get(`${A}/queue/counts`)).body.escalated).toBe(1);
    expect((await admin.get(`${A}/queue?view=closed&limit=50`)).body.items.length).toBe(14);
    expect((await mod.get(`${A}/queue?view=closed&limit=50`)).body.items.length).toBe(13); // legal-hold item is admin only
    const audit = await mod.get(`${A}/audit`);
    expect(audit.status).toBe(200);
    for (const row of audit.body.items as AuditRow[]) expect(row.actor?.id).toBe(DEMO.moderator);
    const appeals = await mod.get(`${A}/appeals`);
    expect(appeals.body.items.length).toBe(1);
    expect(appeals.body.items[0].canReview).toBe(true);
    expect(appeals.body.items[0].sanction.origin).toBe('public');
    const ryan = await mod.get(`${A}/users/${U.ryanoc}`);
    expect(ryan.body.sanctions.map((x: StaffSanctionRow) => x.kind)).toEqual(expect.arrayContaining(['mute', 'removal']));
    const metrics = await admin.get(`${A}/analytics/moderation`);
    expect(metrics.body.unmasksByReason).toEqual({ credible_threat: 1 });
    expect(metrics.body.openByPriority.p0).toBeGreaterThanOrEqual(2);
  });
});
