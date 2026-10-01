/**
 * Reports + auto-hide (SPEC §4.3 #30, safety §3.1–§3.2, §8.2 #9): idempotent 200, 404 without adapter, self-report
 * 400, `other` needs a note, queue upsert + counters; 3 eligible reporters hide a buzz, 3 brand-new accounts do not,
 * `self_harm` never hides, an approved (immune) item is immune, P0 reasons hide at 2, listings hide at 2 when all spam.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContentEntityType, Id } from '@shared/core';
import { HOUR, now } from '../../src/lib/clock';
import { registerContentAdapter, type ContentAdapter, type ContentSnapshot } from '../../src/lib/content';
import { createReport, evaluateAutoHide, reporterTrustFor } from '../../src/lib/reports';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
const memory = new Map<string, ContentSnapshot>();
const unregisters: (() => void)[] = [];

function adapterFor(entityType: ContentEntityType): ContentAdapter {
  return {
    entityType,
    load: (id) => memory.get(`${entityType}:${id}`) ?? null,
    setStatus: (id, status, opts) => {
      const s = memory.get(`${entityType}:${id}`);
      if (s) memory.set(`${entityType}:${id}`, { ...s, status, autoHideImmune: opts?.immune ? true : s.autoHideImmune });
    },
  };
}

function seedItem(entityType: ContentEntityType, id: Id, authorId: Id, extra: Partial<ContentSnapshot> = {}): void {
  memory.set(`${entityType}:${id}`, {
    entityType, entityId: id, authorId, universityId: 'uni_utexas', status: 'active',
    surface: entityType === 'buzz' ? 'buzz' : entityType === 'market_listing' ? 'market_listing' : 'orbit_post',
    anon: entityType === 'buzz', autoHideImmune: false, createdAt: now(), label: entityType, fields: [{ field: 'body', text: `text of ${id}` }],
    media: [], href: `/x/${id}`, parent: null, ...extra,
  });
}

const status = (entityType: ContentEntityType, id: Id): string | undefined => memory.get(`${entityType}:${id}`)?.status;
const queue = (entityType: ContentEntityType, id: Id): any => ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = ? AND entity_id = ? AND status != 'closed'").get(entityType, id);

beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
  memory.clear();
  for (const t of ['buzz', 'orbit_post', 'market_listing'] as const) unregisters.push(registerContentAdapter(adapterFor(t)));
});
afterEach(() => {
  for (const u of unregisters.splice(0)) u();
});

describe('POST /reports (#30)', () => {
  it('creates a report, upserts the queue item, is idempotent, hides the item for the reporter', async () => {
    seedItem('orbit_post', 'post_1', 'u_arjunp');
    const maya = ctx.as('mayachen');
    const res = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_1', reason: 'harassment' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ entityType: 'orbit_post', entityId: 'post_1', reason: 'harassment', alreadyReported: false });
    expect(typeof res.body.id).toBe('string');
    const q = queue('orbit_post', 'post_1');
    expect(q).toMatchObject({ source: 'user_report', priority: 'p1', category: 'harassment_bullying', report_count: 1, reporter_weight: 1, surface: 'orbit_post' });
    expect(q.author_id).toBe('u_arjunp');
    const row = ctx.db.prepare('SELECT * FROM reports WHERE id = ?').get(res.body.id) as any;
    expect(row).toMatchObject({ reporter_id: 'u_mayachen', eligible: 1, weight: 1, status: 'open', queue_id: q.id, university_id: 'uni_utexas' });
    // repeat → the same report, 200, alreadyReported
    const again = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_1', reason: 'spam_scam' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: res.body.id, reason: 'harassment', alreadyReported: true });
    expect(queue('orbit_post', 'post_1').report_count).toBe(1);
    // reported ids are filtered for the reporter
    const { reportedIdsFor } = await import('../../src/lib/graph');
    expect(reportedIdsFor('u_mayachen', 'orbit_post').has('post_1')).toBe(true);
    // status stays active (one report never hides)
    expect(status('orbit_post', 'post_1')).toBe('active');
  });

  it('validates: unknown entity 404, self-report 400, `other` needs a note ≥ 10, bad reason 400, anon 401', async () => {
    seedItem('orbit_post', 'mine', 'u_mayachen');
    const maya = ctx.as('mayachen');
    expect((await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'nope', reason: 'hate' })).status).toBe(404);
    expect((await maya.post('/api/reports').send({ entityType: 'reel', entityId: 'x', reason: 'hate' })).status).toBe(404); // no adapter
    const self = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'mine', reason: 'hate' });
    expect(self.status).toBe(400);
    seedItem('orbit_post', 'post_2', 'u_arjunp');
    const other = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_2', reason: 'other', note: 'short' });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('validation_failed');
    const ok = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_2', reason: 'other', note: 'This is long enough to explain.' });
    expect(ok.status).toBe(200);
    expect(queue('orbit_post', 'post_2')).toMatchObject({ priority: 'p3', category: null });
    expect((await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_2', reason: 'nonsense' })).status).toBe(400);
    expect((await ctx.anon().post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_2', reason: 'hate' })).status).toBe(401);
    // a note containing abuse is still accepted (report_note always allows)
    seedItem('orbit_post', 'post_3', 'u_arjunp');
    const quoted = await maya.post('/api/reports').send({ entityType: 'orbit_post', entityId: 'post_3', reason: 'threat', note: 'he wrote "i will kill you" and posted 512-555-0199' });
    expect(quoted.status).toBe(200);
    expect(queue('orbit_post', 'post_3').priority).toBe('p0');
  });

  it('self_harm reports go to P0 with label wellbeing; a spam report on a listing keeps the sub-reason', async () => {
    seedItem('buzz', 'b_sh', 'bg_0001');
    const r = createReport(ctx.createUser(), { entityType: 'buzz', entityId: 'b_sh', reason: 'self_harm' });
    expect(r.alreadyReported).toBe(false);
    expect(queue('buzz', 'b_sh')).toMatchObject({ priority: 'p0', label: 'wellbeing', category: 'self_harm' });
    seedItem('market_listing', 'l_1', 'u_arjunp');
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_1', reason: 'spam_scam', subReason: 'scam_fake' });
    expect((ctx.db.prepare("SELECT sub_reason FROM reports WHERE entity_id = 'l_1'").get() as any).sub_reason).toBe('scam_fake');
  });

  it('reporter trust: low reporters weigh 0, high reporters weigh 2 (still never alone)', () => {
    const low = ctx.createUser();
    const at = now();
    for (let i = 0; i < 3; i += 1) {
      ctx.db.prepare(
        `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, university_id, eligible, weight, status, created_at, closed_at)
         VALUES (?,?,?,?,?,?,1,1,'dismissed',?,?)`,
      ).run(`r_low_${i}`, low.id, 'orbit_post', `old_${i}`, 'spam_scam', 'uni_utexas', at - HOUR, at - HOUR);
    }
    expect(reporterTrustFor(low.id)).toBe('low');
    const high = ctx.createUser();
    for (let i = 0; i < 6; i += 1) {
      ctx.db.prepare(
        `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, university_id, eligible, weight, status, created_at, closed_at)
         VALUES (?,?,?,?,?,?,1,1,'actioned',?,?)`,
      ).run(`r_high_${i}`, high.id, 'orbit_post', `old_h_${i}`, 'spam_scam', 'uni_utexas', at - HOUR, at - HOUR);
    }
    expect(reporterTrustFor(high.id)).toBe('high');
    expect(reporterTrustFor(ctx.createUser().id)).toBe('normal');
    seedItem('buzz', 'b_w', 'bg_0002');
    createReport(low, { entityType: 'buzz', entityId: 'b_w', reason: 'harassment' });
    createReport(high, { entityType: 'buzz', entityId: 'b_w', reason: 'harassment' });
    expect(queue('buzz', 'b_w')).toMatchObject({ report_count: 2, reporter_weight: 2 });
    expect(status('buzz', 'b_w')).toBe('active'); // 1 eligible distinct reporter (weight 2) never hides alone
  });
});

describe('auto-hide (#9)', () => {
  it('3 eligible reporters hide a buzz, raise the queue priority and notify nobody but the author', () => {
    seedItem('buzz', 'b_1', 'bg_0003');
    const reporters = [ctx.createUser(), ctx.createUser(), ctx.createUser()];
    createReport(reporters[0]!, { entityType: 'buzz', entityId: 'b_1', reason: 'harassment' });
    createReport(reporters[1]!, { entityType: 'buzz', entityId: 'b_1', reason: 'harassment' });
    expect(status('buzz', 'b_1')).toBe('active');
    expect(queue('buzz', 'b_1').priority).toBe('p1');
    createReport(reporters[2]!, { entityType: 'buzz', entityId: 'b_1', reason: 'spam_scam' });
    expect(status('buzz', 'b_1')).toBe('hidden');
    expect(queue('buzz', 'b_1')).toMatchObject({ priority: 'p0', report_count: 3, reporter_weight: 3 });
    // the reported author is never told who reported: no reporter id anywhere on the queue item
    const q = queue('buzz', 'b_1');
    for (const r of reporters) expect(JSON.stringify(q)).not.toContain(r.id);
  });

  it('3 brand-new accounts (< 24 h) do not hide; ineligible reports still count in report_count', () => {
    seedItem('buzz', 'b_2', 'bg_0004');
    for (let i = 0; i < 3; i += 1) {
      const fresh = ctx.createUser({ createdAt: now() - HOUR });
      createReport(fresh, { entityType: 'buzz', entityId: 'b_2', reason: 'harassment' });
    }
    expect(status('buzz', 'b_2')).toBe('active');
    expect(queue('buzz', 'b_2')).toMatchObject({ report_count: 3, reporter_weight: 0 });
    expect((ctx.db.prepare("SELECT SUM(eligible) AS e FROM reports WHERE entity_id = 'b_2'").get() as any).e).toBe(0);
  });

  it('`self_harm` reason never hides (goes to P0 wellbeing); muted and blocked reporters are ineligible', () => {
    seedItem('buzz', 'b_3', 'bg_0005');
    for (let i = 0; i < 4; i += 1) createReport(ctx.createUser(), { entityType: 'buzz', entityId: 'b_3', reason: 'self_harm' });
    expect(status('buzz', 'b_3')).toBe('active');
    expect(queue('buzz', 'b_3')).toMatchObject({ priority: 'p0', label: 'wellbeing' });

    seedItem('orbit_post', 'p_blk', 'u_arjunp');
    const blocker = ctx.createUser();
    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(blocker.id, 'u_arjunp', now());
    createReport(blocker, { entityType: 'orbit_post', entityId: 'p_blk', reason: 'hate' });
    expect((ctx.db.prepare("SELECT eligible FROM reports WHERE reporter_id = ?").get(blocker.id) as any).eligible).toBe(0);
    const muted = ctx.createUser();
    ctx.db.prepare(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, starts_at, effective_at, ends_at, created_at) VALUES ('s_m', ?, 'mute', 'all', ?, ?, ?, ?)`,
    ).run(muted.id, now() - HOUR, now() - HOUR, now() + HOUR, now() - HOUR);
    createReport(muted, { entityType: 'orbit_post', entityId: 'p_blk', reason: 'hate' });
    expect((ctx.db.prepare("SELECT eligible FROM reports WHERE reporter_id = ?").get(muted.id) as any).eligible).toBe(0);
    // a Buzz report ignores the public block graph (blocks have zero effect on Buzz)
    seedItem('buzz', 'b_blk', 'u_arjunp');
    createReport(blocker, { entityType: 'buzz', entityId: 'b_blk', reason: 'hate' });
    expect((ctx.db.prepare("SELECT eligible FROM reports WHERE reporter_id = ? AND entity_type = 'buzz'").get(blocker.id) as any).eligible).toBe(1);
  });

  it('an approved (immune) item never auto-hides again; further reports still queue', () => {
    seedItem('buzz', 'b_4', 'bg_0006', { autoHideImmune: true });
    for (let i = 0; i < 5; i += 1) createReport(ctx.createUser(), { entityType: 'buzz', entityId: 'b_4', reason: 'harassment' });
    expect(status('buzz', 'b_4')).toBe('active');
    expect(queue('buzz', 'b_4').report_count).toBe(5);
    // hidden / removed items are left alone too
    seedItem('buzz', 'b_5', 'bg_0007', { status: 'removed' });
    evaluateAutoHide('buzz', 'b_5');
    expect(status('buzz', 'b_5')).toBe('removed');
  });

  it('thresholds: posts need 5, P0 reasons hide at 2, listings hide at 2 when every report is spam, rule-flagged −1', () => {
    seedItem('orbit_post', 'p_5', 'u_arjunp');
    for (let i = 0; i < 4; i += 1) createReport(ctx.createUser(), { entityType: 'orbit_post', entityId: 'p_5', reason: 'harassment' });
    expect(status('orbit_post', 'p_5')).toBe('active');
    createReport(ctx.createUser(), { entityType: 'orbit_post', entityId: 'p_5', reason: 'harassment' });
    expect(status('orbit_post', 'p_5')).toBe('hidden');

    seedItem('orbit_post', 'p_p0', 'u_arjunp');
    createReport(ctx.createUser(), { entityType: 'orbit_post', entityId: 'p_p0', reason: 'threat' });
    expect(status('orbit_post', 'p_p0')).toBe('active');
    createReport(ctx.createUser(), { entityType: 'orbit_post', entityId: 'p_p0', reason: 'doxxing' });
    expect(status('orbit_post', 'p_p0')).toBe('hidden');
    expect(queue('orbit_post', 'p_p0').priority).toBe('p0');

    seedItem('market_listing', 'l_spam', 'u_arjunp');
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_spam', reason: 'spam_scam' });
    expect(status('market_listing', 'l_spam')).toBe('active');
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_spam', reason: 'spam_scam' });
    expect(status('market_listing', 'l_spam')).toBe('hidden');

    seedItem('market_listing', 'l_mix', 'u_arjunp');
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_mix', reason: 'spam_scam' });
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_mix', reason: 'hate' });
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_mix', reason: 'hate' });
    expect(status('market_listing', 'l_mix')).toBe('active'); // mixed reasons: 4 needed
    createReport(ctx.createUser(), { entityType: 'market_listing', entityId: 'l_mix', reason: 'hate' });
    expect(status('market_listing', 'l_mix')).toBe('hidden');

    // rule-flagged: threshold − 1 (min 2) → a flagged buzz hides at 2
    seedItem('buzz', 'b_flag', 'bg_0008');
    ctx.db.prepare(
      `INSERT INTO mod_queue (id, entity_type, entity_id, surface, university_id, author_id, source, severity, priority, created_at)
       VALUES ('q_flag', 'buzz', 'b_flag', 'buzz', 'uni_utexas', 'bg_0008', 'rule_flag', 'medium', 'p2', ?)`,
    ).run(now());
    createReport(ctx.createUser(), { entityType: 'buzz', entityId: 'b_flag', reason: 'harassment' });
    expect(status('buzz', 'b_flag')).toBe('active');
    createReport(ctx.createUser(), { entityType: 'buzz', entityId: 'b_flag', reason: 'harassment' });
    expect(status('buzz', 'b_flag')).toBe('hidden');
    expect(queue('buzz', 'b_flag')).toMatchObject({ id: 'q_flag', source: 'rule_flag', priority: 'p0', report_count: 2 }); // p2 → p1 (report) → p0 (hide)
  });

  it('profiles never auto-hide; ≥ 5 reporters in 7 days raise the profile item to P1', () => {
    for (let i = 0; i < 5; i += 1) {
      const r = createReport(ctx.createUser(), { entityType: 'profile', entityId: 'u_arjunp', reason: 'spam_scam' });
      expect(r.entityType).toBe('profile');
    }
    expect((ctx.db.prepare("SELECT status FROM users WHERE id = 'u_arjunp'").get() as any).status).toBe('active');
    expect(queue('profile', 'u_arjunp')).toMatchObject({ priority: 'p1', report_count: 5, surface: 'profile' });
  });
});
