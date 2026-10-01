/**
 * HARDENING — lens: Buzz identity through the staff and data layer (Constitution §5, SPEC §3.2 #7–#9, §4.2.14).
 *
 * Full mode (real buzz router + real admin router), core seed. Staff are the seeded accounts:
 * mod = u_rileyshaw (mod@utexas.edu), admin = u_dana_w, second admin = u_victor_o.
 *
 * FAILING tests in this file are confirmed findings (left failing on purpose for the fixer).
 * PASSING tests are probes that found nothing and stay as regression tests.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id, ModerationCategory, ModerationPriority, ModerationSeverity } from '@shared/core';
import type { AuditRow, StaffAppeal, StaffQueueItemDetail, StaffUserDetail } from '@shared/admin';
import { upsertQueueItem } from '../../src/lib/moderation/queue';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../../src/lib/testing';
import type { AuthedUser } from '../../src/lib/users';

const A = '/api/admin';
const MOD = 'u_rileyshaw';
const ADMIN = 'u_dana_w';
const ADMIN2 = 'u_victor_o';
const BUZZ_TEXT = 'Whoever keeps microwaving fish on the fourth floor of Jester needs to stop immediately';

let ctx: TestCtx;
let author: AuthedUser;
let bystanders: AuthedUser[];

function identityOf(u: AuthedUser): string[] {
  const row = ctx.db.prepare('SELECT id, handle, display_name, email FROM users WHERE id = ?').get(u.id) as {
    id: string; handle: string; display_name: string; email: string;
  };
  return [row.id, row.handle, row.display_name, row.email];
}

async function postBuzz(userId: Id, text = BUZZ_TEXT): Promise<Id> {
  const res = await ctx.as(userId).post('/api/buzz').send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as Id;
}

/** What the engine / a report would create: an open queue item on the Buzz entity (author stored server-side). */
function flag(
  buzzId: Id,
  authorId: Id,
  o: { category?: ModerationCategory; severity?: ModerationSeverity; priority?: ModerationPriority; entityType?: 'buzz' | 'buzz_reply' } = {},
): Id {
  return upsertQueueItem({
    entityType: o.entityType ?? 'buzz', entityId: buzzId, surface: 'buzz', universityId: 'uni_utexas', authorId, source: 'rule_flag',
    category: o.category ?? 'harassment_bullying', severity: o.severity ?? 'medium', priority: o.priority ?? 'p1',
  });
}

async function modView(userId: Id): Promise<StaffUserDetail> {
  const res = await ctx.as(MOD).get(`${A}/users/${userId}`);
  expect(res.status).toBe(200);
  return res.body as StaffUserDetail;
}

async function detail(as: string, queueId: Id): Promise<StaffQueueItemDetail> {
  const res = await ctx.as(as).get(`${A}/queue/${queueId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as StaffQueueItemDetail;
}

/** The part of the blind panel + ladder suggestion a moderator sees on a Buzz item. */
function blindView(d: StaffQueueItemDetail): unknown {
  return { author: d.author, suggestion: d.suggestion };
}

beforeEach(async () => {
  ctx = await createTestApp({ seed: 'core' });
  author = ctx.createUser({ handle: 'quinn_harlow', displayName: 'Quinn Harlow' });
  bystanders = [ctx.createUser({ handle: 'bystander_one' }), ctx.createUser({ handle: 'bystander_two' })];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ═════════════════════════════ (a) MODERATOR ═════════════════════════════ */

describe('(a) moderator cannot learn a Buzz author through /api/admin', () => {
  it('probe: every moderator-readable admin endpoint stays blind after a Buzz remove + mute (payloads, standing, audit)', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    const ident = identityOf(author);

    const beforeAuthor = await modView(author.id);
    const beforeOthers = await Promise.all(bystanders.map((b) => modView(b.id)));

    const d0 = await detail(MOD, qid);
    assertNoForbiddenKeys(d0);
    assertNoIdentityLeak(d0, ident);
    expect(d0.author.kind).toBe('blind');
    expect(d0.canUnmask).toBe(false);

    const acted = await ctx.as(MOD).post(`${A}/queue/${qid}/actions`).send({ action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted harassment of a dorm floor' });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    assertNoForbiddenKeys(acted.body);
    assertNoIdentityLeak(acted.body, ident);

    // queue list (every view), counts, detail
    for (const view of ['priority', 'wellbeing', 'held', 'auto_hidden', 'reports', 'escalated', 'appeals', 'mine', 'closed']) {
      const res = await ctx.as(MOD).get(`${A}/queue?view=${view}`);
      expect(res.status).toBe(200);
      assertNoForbiddenKeys(res.body);
      assertNoIdentityLeak(res.body, ident);
    }
    const counts = await ctx.as(MOD).get(`${A}/queue/counts`);
    assertNoIdentityLeak(counts.body, ident);
    const d1 = await detail(MOD, qid);
    assertNoForbiddenKeys(d1);
    assertNoIdentityLeak(d1, ident);

    // user lookup / standing: unchanged before vs after, no Buzz text, no anon-origin rows
    const afterAuthor = await modView(author.id);
    expect(afterAuthor).toEqual(beforeAuthor);
    expect(JSON.stringify(afterAuthor)).not.toContain('microwaving');
    const afterOthers = await Promise.all(bystanders.map((b) => modView(b.id)));
    expect(afterOthers).toEqual(beforeOthers);
    const search = await ctx.as(MOD).get(`${A}/users?q=quinn`);
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.body)).not.toContain('microwaving');
    expect((search.body.items as StaffUserDetail[])[0]?.sanctions ?? []).toEqual([]);

    // audit (own rows): entity-targeted only, no user target, no identity
    const audit = await ctx.as(MOD).get(`${A}/audit?limit=50`);
    expect(audit.status).toBe(200);
    assertNoIdentityLeak(audit.body, ident);
    for (const row of audit.body.items as AuditRow[]) {
      expect(row.targetType).not.toBe('user');
      expect(row.targetId).not.toBe(author.id);
    }
    // CSV export is admin only
    expect((await ctx.as(MOD).get(`${A}/audit/export.csv`)).status).toBe(404);

    // analytics
    for (const p of ['overview', 'apartments', 'moderation']) {
      const res = await ctx.as(MOD).get(`${A}/analytics/${p}`);
      expect(res.status).toBe(200);
      assertNoIdentityLeak(res.body, ident);
    }
  });

  it('probe: appeals of an anon-origin sanction are blind (no user, sanction id replaced, day-floored) and the appeal queue item is blind', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    const acted = await ctx.as(ADMIN).post(`${A}/queue/${qid}/actions`).send({ action: 'remove_and_mute_72h', category: 'harassment_bullying', note: 'repeat harassment on the floor thread' });
    expect(acted.status).toBe(200);
    const mine = await ctx.as(author.id).get('/api/me/sanctions');
    const mute = (mine.body.items as { id: Id; kind: string }[]).find((s) => s.kind === 'mute')!;
    expect(mute).toBeTruthy();
    const appeal = await ctx.as(author.id).post('/api/appeals').send({ sanctionId: mute.id, text: 'I was quoting someone else, please look again.' });
    expect(appeal.status, JSON.stringify(appeal.body)).toBe(201);

    const ident = identityOf(author);
    const list = await ctx.as(MOD).get(`${A}/appeals?status=all`);
    expect(list.status).toBe(200);
    assertNoForbiddenKeys(list.body);
    assertNoIdentityLeak(list.body, ident);
    const row = (list.body.items as StaffAppeal[]).find((a) => a.id === appeal.body.id)!;
    expect(row.sanction.origin).toBe('anon');
    expect(row.sanction.id).not.toBe(mute.id);
    expect(row.createdAt % 86_400_000).toBe(0);
    expect(row.sanction.createdAt % 86_400_000).toBe(0);
    expect(JSON.stringify(list.body)).not.toContain(mute.id);

    // the appeal's queue item is itself a Buzz item → blind panel
    expect(row.queueId).toBeTruthy();
    const d = await detail(MOD, row.queueId!);
    expect(d.author.kind).toBe('blind');
    assertNoIdentityLeak(d, ident);

    // moderator's user view still shows nothing anon-origin
    const u = await modView(author.id);
    expect(u.sanctions).toEqual([]);
    expect(u.openQueueItems).toBe(0);
  });

  it('FINDING: a zero-tolerance Buzz removal by a moderator flips the author\'s `status` in /admin/users (moderator diff reveals the author)', async () => {
    const buzzId = await postBuzz(author.id, 'Someone should bring a knife to the Jester floor meeting tonight and settle this');
    const qid = flag(buzzId, author.id, { category: 'threat_violence', severity: 'critical', priority: 'p0' });

    // the moderator snapshots every candidate's staff view, then acts on the Buzz item
    const candidates = [author, ...bystanders];
    const before = await Promise.all(candidates.map((c) => modView(c.id)));
    const acted = await ctx.as(MOD).post(`${A}/queue/${qid}/actions`).send({ action: 'remove', category: 'threat_violence', note: 'credible threat of violence at floor meeting' });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    const after = await Promise.all(candidates.map((c) => modView(c.id)));

    const changed = candidates.filter((_c, i) => JSON.stringify(before[i]) !== JSON.stringify(after[i])).map((c) => c.id);
    // Firewall (SPEC §3.2 #9): nothing a moderator sees about a named account may move when a Buzz item is actioned.
    expect(changed, `moderator-visible user payload changed for ${changed.join(', ')} (status ${before[0]!.status} → ${after[0]!.status})`).toEqual([]);
  });

  it('FINDING: escalating a Buzz item as sexual_minors auto-suspends the author and the moderator sees the status flip in /admin/users', async () => {
    const buzzId = await postBuzz(author.id, 'Posting about the freshman in 4B again, you all know who I mean');
    const qid = flag(buzzId, author.id, { category: 'harassment_bullying', severity: 'high', priority: 'p1' });
    const before = await modView(author.id);
    const acted = await ctx.as(MOD).post(`${A}/queue/${qid}/actions`).send({ action: 'escalate', category: 'sexual_minors', note: 'possible minor involved, escalating now' });
    expect(acted.status, JSON.stringify(acted.body)).toBe(200);
    const after = await modView(author.id);
    expect(after.status, 'moderator learns which account wrote the escalated Buzz item').toBe(before.status);
  });

  it('FINDING: blind author panel reacts to a public-origin MUTE the moderator applies directly (hypothesis-testing oracle)', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    const base = blindView(await detail(MOD, qid));
    const probe = { kind: 'mute', durationMs: 60 * 60_000, category: 'spam_scam', note: 'probe: repeated low-effort spam' };

    // wrong guess: panel does not move
    expect((await ctx.as(MOD).post(`${A}/users/${bystanders[0]!.id}/sanctions`).send(probe)).status).toBe(200);
    expect(blindView(await detail(MOD, qid))).toEqual(base);

    // right guess: the panel's `author.sanction` flips null → 'mute' — the moderator now knows who wrote the Buzz
    expect((await ctx.as(MOD).post(`${A}/users/${author.id}/sanctions`).send(probe)).status).toBe(200);
    expect(blindView(await detail(MOD, qid))).toEqual(base);
  });

  it('FINDING: Buzz ladder suggestion reacts to a public-origin WARNING the moderator applies directly (hypothesis-testing oracle)', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    const base = (await detail(MOD, qid)).suggestion;
    const probe = { kind: 'warning', category: 'spam_scam', note: 'probe: repeated low-effort spam' };

    expect((await ctx.as(MOD).post(`${A}/users/${bystanders[1]!.id}/sanctions`).send(probe)).status).toBe(200);
    expect((await detail(MOD, qid)).suggestion).toEqual(base);

    expect((await ctx.as(MOD).post(`${A}/users/${author.id}/sanctions`).send(probe)).status).toBe(200);
    // suggestion flips remove_and_warn → remove because hasActiveWarning() counts the public-origin warning
    expect((await detail(MOD, qid)).suggestion).toEqual(base);
  });

  it('FINDING: blind panel `otherOpenItems` counts the author\'s PUBLIC queue items, which moderators see with the author named', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    const base = blindView(await detail(MOD, qid));
    // a public (named) queue item appears for the author — the moderator sees it in the queue with the author panel
    const profileQ = upsertQueueItem({
      entityType: 'profile', entityId: author.id, surface: 'profile', universityId: 'uni_utexas', authorId: author.id, source: 'user_report',
      category: 'spam_scam', severity: 'low', priority: 'p3', reportDelta: 1,
    });
    const pub = await detail(MOD, profileQ);
    expect(pub.author.kind).toBe('public');
    expect(blindView(await detail(MOD, qid))).toEqual(base);
  });
});

/* ═════════════════════════════ (b) ADMIN ═════════════════════════════ */

describe('(b) admin: unmask only through the dedicated endpoint', () => {
  const GOOD = { reasonCode: 'credible_threat', reason: 'Specific threat of violence against a named floor meeting tonight.', confirmText: 'UNMASK' };
  const unmaskRows = (): { id: string; action: string; created_at: number; reason: string | null }[] =>
    ctx.db.prepare("SELECT id, action, created_at, reason FROM audit_log WHERE action IN ('buzz_unmask','buzz_unmask_subject') ORDER BY created_at, rowid").all() as never;

  it('probe: moderator 404, short reason 400, missing UNMASK 400, no queue item 404 — none writes an audit row or leaks identity', async () => {
    const buzzId = await postBuzz(author.id);
    const ident = identityOf(author);
    // no queue item yet
    const noQueue = await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send(GOOD);
    expect(noQueue.status).toBe(404);
    flag(buzzId, author.id);

    const asMod = await ctx.as(MOD).post(`${A}/buzz/buzz/${buzzId}/unmask`).send(GOOD);
    expect(asMod.status).toBe(404);
    const short = await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send({ ...GOOD, reason: 'x'.repeat(29) });
    expect(short.status).toBe(400);
    const padded = await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send({ ...GOOD, reason: `   ${'y'.repeat(25)}        ` });
    expect(padded.status).toBe(400);
    const noConfirm = await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send({ ...GOOD, confirmText: 'unmask' });
    expect(noConfirm.status).toBe(400);
    const wrongType = await ctx.as(ADMIN).post(`${A}/buzz/orbit_post/${buzzId}/unmask`).send(GOOD);
    expect(wrongType.status).toBe(400);
    for (const r of [noQueue, asMod, short, padded, noConfirm, wrongType]) assertNoIdentityLeak(r.body, ident);
    expect(unmaskRows()).toEqual([]);
  });

  it('probe: a valid unmask returns identity, writes buzz_unmask (with reason) before the subject row, alerts the other admin, hides from moderators', async () => {
    const buzzId = await postBuzz(author.id);
    flag(buzzId, author.id);
    const res = await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send(GOOD);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.id).toBe(author.id);
    const rows = unmaskRows();
    expect(rows.map((r) => r.action)).toEqual(['buzz_unmask', 'buzz_unmask_subject']);
    expect(rows[0]!.reason).toBe(GOOD.reason);
    expect(res.body.unmaskId).toBe(rows[0]!.id);
    // the audit trail never stores the identity readably
    const raw = JSON.stringify(ctx.db.prepare("SELECT * FROM audit_log WHERE action LIKE 'buzz_unmask%'").all());
    for (const s of identityOf(author)) expect(raw).not.toContain(s);
    // alert to the other admin
    const alert = ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'admin.unmask_alert'").get(ADMIN2) as { data_json: string } | undefined;
    expect(alert).toBeTruthy();
    for (const s of identityOf(author)) expect(alert!.data_json).not.toContain(s);
    // moderators never see admin rows
    const modAudit = await ctx.as(MOD).get(`${A}/audit?action=buzz_unmask`);
    expect(modAudit.body.items).toEqual([]);
  });

  it('probe: Buzz queue detail is blind for admins too (no author panel, no reporter identity)', async () => {
    const buzzId = await postBuzz(author.id);
    const rep = await ctx.as(bystanders[0]!.id).post('/api/reports').send({ entityType: 'buzz', entityId: buzzId, reason: 'harassment' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    const q = ctx.db.prepare("SELECT id FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(buzzId) as { id: Id };
    const d = await detail(ADMIN, q.id);
    assertNoForbiddenKeys(d);
    assertNoIdentityLeak(d, [...identityOf(author), ...identityOf(bystanders[0]!)]);
    expect(d.author.kind).toBe('blind');
    expect(d.canUnmask).toBe(true);
  });

  it('FINDING: admin links a Buzz post to its author WITHOUT unmask — audit `sanction_apply.metadata.sanctionId` joins /admin/users sanctions', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    expect((await ctx.as(MOD).post(`${A}/queue/${qid}/actions`).send({ action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted harassment of a dorm floor' })).status).toBe(200);

    // 1. audit (admin sees all rows): the entity-targeted sanction row carries the real sanction id
    const audit = await ctx.as(ADMIN).get(`${A}/audit?action=sanction_apply&limit=50`);
    const row = (audit.body.items as AuditRow[]).find((r) => r.targetId === buzzId)!;
    expect(row).toBeTruthy();
    const sanctionId = row.metadata?.sanctionId as string | undefined;

    // 2. enumerate users (substring search over email) and find the one holding that sanction id
    let found: string | null = null;
    let cursor: string | null = null;
    do {
      const page = await ctx.as(ADMIN).get(`${A}/users?q=edu&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page.status).toBe(200);
      for (const u of page.body.items as StaffUserDetail[]) if (u.sanctions.some((s) => s.id === sanctionId)) found = u.user.id;
      cursor = page.body.nextCursor;
    } while (cursor && !found);

    const unmasks = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'buzz_unmask'").get() as { n: number };
    expect(unmasks.n).toBe(0);
    expect(found, 'Buzz author identified by sanction-id join, no buzz_unmask row written').toBeNull();
  });

  it('FINDING: POST /admin/sanctions/:id/lift on an anon-origin sanction returns the Buzz author\'s StaffUserDetail (unmask without reason / UNMASK / buzz_unmask row)', async () => {
    const buzzId = await postBuzz(author.id);
    const qid = flag(buzzId, author.id);
    expect((await ctx.as(MOD).post(`${A}/queue/${qid}/actions`).send({ action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted harassment of a dorm floor' })).status).toBe(200);
    const audit = await ctx.as(ADMIN).get(`${A}/audit?action=sanction_apply&limit=50`);
    const sanctionId = (audit.body.items as AuditRow[]).find((r) => r.targetId === buzzId)!.metadata!.sanctionId as string;

    const lift = await ctx.as(ADMIN).post(`${A}/sanctions/${sanctionId}/lift`).send({ note: 'lifting to review context' });
    expect(lift.status).toBe(200);
    const unmasks = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'buzz_unmask'").get() as { n: number };
    expect(unmasks.n).toBe(0);
    assertNoIdentityLeak(lift.body, identityOf(author));
  });
});

/* ═════════════════════════════ (c) DB + LOGS ═════════════════════════════ */

describe('(c) data layer and logs', () => {
  it('probe: a full Buzz moderation flow prints no Buzz author id or Buzz text to the console', async () => {
    const printed: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void printed.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? String(x))).join(' ')));
    }
    const buzzId = await postBuzz(author.id);
    await ctx.as(bystanders[0]!.id).post('/api/reports').send({ entityType: 'buzz', entityId: buzzId, reason: 'harassment' });
    const q = ctx.db.prepare("SELECT id FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(buzzId) as { id: Id };
    await ctx.as(MOD).get(`${A}/queue/${q.id}`);
    await ctx.as(MOD).post(`${A}/queue/${q.id}/actions`).send({ action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted harassment of a dorm floor' });
    await ctx.as(ADMIN).post(`${A}/buzz/buzz/${buzzId}/unmask`).send({ reasonCode: 'credible_threat', reason: 'Specific threat of violence against a named floor meeting tonight.', confirmText: 'UNMASK' });
    const out = printed.join('\n');
    for (const s of [...identityOf(author), 'microwaving']) expect(out).not.toContain(s);
  });

  it('probe: Buzz analytics rows carry no user id, no session id, no *id props, minute-floored time', async () => {
    await postBuzz(author.id);
    const rows = ctx.db.prepare("SELECT * FROM analytics_events WHERE name LIKE 'buzz_%'").all() as {
      user_id: string | null; session_id: string | null; props_json: string; created_at: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.user_id).toBeNull();
      expect(r.session_id).toBeNull();
      expect(r.created_at % 60_000).toBe(0);
      expect(Object.keys(JSON.parse(r.props_json) as object).filter((k) => /id$/i.test(k))).toEqual([]);
      expect(r.props_json).not.toContain(author.id);
    }
    // no named analytics / public_activity row was produced by the Buzz write
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE user_id = ?').get(author.id)).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM public_activity WHERE user_id = ?').get(author.id)).toEqual({ n: 0 });
  });

  it('probe: inventory — only the expected tables hold a row joining a Buzz post to its author after the full moderation flow', async () => {
    const buzzId = await postBuzz(author.id);
    await ctx.as(bystanders[0]!.id).post('/api/reports').send({ entityType: 'buzz', entityId: buzzId, reason: 'harassment' });
    const q = ctx.db.prepare("SELECT id FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = ?").get(buzzId) as { id: Id };
    await ctx.as(MOD).post(`${A}/queue/${q.id}/actions`).send({ action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'targeted harassment of a dorm floor' });

    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    const joining: string[] = [];
    for (const t of tables) {
      const rows = ctx.db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
      if (rows.some((r) => {
        const s = JSON.stringify(r);
        return s.includes(author.id) && s.includes(buzzId);
      })) joining.push(t);
    }
    // enforcement / moderation / the author's own inbox — none of these is serialized to non-admin staff with the user
    const allowed = ['buzz_posts', 'mod_queue', 'moderation_events', 'moderation_actions', 'strikes', 'user_sanctions', 'notifications'];
    expect(joining.filter((t) => !allowed.includes(t))).toEqual([]);
    // the audit log in particular never holds the pair
    expect(joining).not.toContain('audit_log');
  });
});

/* Runs LAST: it re-imports the logger in a fresh module graph (NODE_ENV=development), which would detach later tests' DB. */
describe('(c) request logger', () => {
  it('probe: request logger prints only the prefix for /api/buzz/** and /api/admin/** (no ids, no query)', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const { requestLogger } = await import('../../src/lib/logger');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const paths = [
      '/api/admin/buzz/buzz/bz_SECRETID123/unmask?reason=x',
      '/api/admin/queue/q_SECRETID456',
      '/api/buzz/threads/bz_SECRETID789?cursor=abc',
      `/api/admin/users/${author.id}`,
    ];
    for (const p of paths) {
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      requestLogger({ method: 'POST', originalUrl: p, url: p } as never, res as never, () => undefined);
      res.emit('finish');
    }
    expect(lines).toHaveLength(4);
    const out = lines.join('\n');
    for (const secret of ['SECRETID', author.id, 'reason=', 'cursor=']) expect(out).not.toContain(secret);
  });
});
