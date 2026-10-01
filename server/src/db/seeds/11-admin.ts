/**
 * Admin seed (SPEC §5.11 / §7.5, runs last): 9 open queue items · 14 closed · ≥ 20 audit rows incl. exactly one
 * `buzz_unmask` (for `buzz_0102`) · `ryanoc` muted 24 h (public-origin, appealed) · strikes consistent with actions.
 *
 * Cross-slice content (`buzz_0101`, `buzz_0102`, `lst_0061`) is owner-seeded. Queue rows for them are built only when
 * `getContentAdapter(type)?.load(id)` returns non-null; otherwise an equivalent `blocked_text` item (entity_id NULL)
 * takes its place, so the seed never depends on another slice having landed and the 9 / 14 counts always hold.
 * The link-spam group chat is created here with `kit.convo.*` (`message` / `conversation` are foundation entities).
 *
 * Anon-origin rows target the ENTITY, never a user (SPEC §4.2.14 rule 3). Buzz seed-text hygiene (§5.3): no §7.2–§7.4
 * handle or display name appears in any blocked_text / excerpt. Deterministic: `kit.rng` only; both scales.
 */
import type { ContentEntityType, ModerationCategory, ModerationPriority, ModerationSeverity, ModerationSurface } from '@shared/core';
import { getContentAdapter } from '../../lib/content';
import { DAY, HOUR, MIN } from '../../lib/clock';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { unmaskSubjectTag } from '../../services/admin/common';
import { STAFF, U, UNI } from './ids';

type QueueStatus = 'open' | 'claimed' | 'escalated' | 'closed';
type Resolution = 'approved' | 'removed' | 'dismissed' | 'sanctioned' | 'escalated_external';

interface QueueInput {
  entityType: ContentEntityType;
  entityId: string | null;
  surface: ModerationSurface;
  authorId: string | null;
  source: string;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label?: string | null;
  status: QueueStatus;
  blockedText?: string | null;
  ruleIds?: string[];
  reportCount?: number;
  reporterWeight?: number;
  legalHold?: boolean;
  reference?: string | null;
  appealId?: string | null;
  createdAt: number;
  firstActionAt?: number | null;
  closedAt?: number | null;
  resolution?: Resolution | null;
  claimedBy?: string | null;
  claimedAt?: number | null;
}

interface ActionInput {
  queueId: string;
  entityType: ContentEntityType;
  entityId: string | null;
  targetUserId: string | null;
  actorId: string;
  actorRole: 'moderator' | 'admin';
  action: string;
  category: ModerationCategory | null;
  note: string | null;
  createdAt: number;
  sanctionId?: string | null;
}

export default function seed(kit: SeedKit): void {
  const db = kit.db;
  const hero = UNI.utexas;
  const dana = kit.users.get(STAFF.dana_w);
  const victor = kit.users.get(STAFF.victor_o);
  const riley = kit.users.get(STAFF.rileyshaw);
  const ryanoc = kit.users.get(U.ryanoc);
  const bgAll = kit.users.bg(hero);
  if (bgAll.length < 16) throw new Error('admin seed: core seed must run first (needs ≥ 16 hero background users)');
  const bg = kit.sample(bgAll, 16);
  const pickBg = (i: number): SeedUser => bg[i % bg.length]!;

  /* ───────────── counters + inserters (direct SQL, deterministic ids) ───────────── */
  let nq = 0;
  let nr = 0;
  let na = 0;
  let nl = 0;
  let ns = 0;
  let nsan = 0;
  let nev = 0;
  const insQueue = db.prepare(
    `INSERT INTO mod_queue (id, entity_type, entity_id, surface, university_id, author_id, source, category, severity, priority, label, status, claimed_by, claimed_at,
       report_count, reporter_weight, blocked_text, rule_ids_json, ai_verdict_json, legal_hold, reference, appeal_id, created_at, first_action_at, closed_at, resolution)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)`,
  );
  const insReport = db.prepare(
    `INSERT INTO reports (id, reporter_id, entity_type, entity_id, reason, sub_reason, note, context_json, university_id, eligible, weight, status, bad_faith, queue_id, created_at, closed_at)
     VALUES (?,?,?,?,?,NULL,?,NULL,?,1,1,?,?,?,?,?)`,
  );
  const insAction = db.prepare(
    `INSERT INTO moderation_actions (id, queue_id, entity_type, entity_id, target_user_id, actor_id, actor_role, action, category, note, batch_id, sanction_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
  );
  const insAudit = db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, target_type, target_id, queue_id, batch_id, reason_code, reason, metadata_json, created_at)
     VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)`,
  );
  const insStrike = db.prepare(
    `INSERT INTO strikes (id, user_id, entity_type, entity_id, category, severity, points, action_id, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)`,
  );
  const insSanction = db.prepare(
    `INSERT INTO user_sanctions (id, user_id, kind, scope, category, entity_type, entity_id, content_excerpt, content_label, action_id, actor_id, starts_at, effective_at, ends_at,
       acknowledged_at, lifted_at, lifted_by, created_at) VALUES (?,?,?,'all',?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)`,
  );
  const insEvent = db.prepare(
    `INSERT INTO moderation_events (id, entity_type, entity_id, surface, field, author_id, university_id, action, visibility, category, subcode, severity, rule_ids_json, matches_json,
       signals_json, text_hash, engine_version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uv-engine/1.0.0',?)`,
  );
  const insAppeal = db.prepare(`INSERT INTO appeals (id, user_id, sanction_id, text, status, reviewer_id, outcome_note, created_at, decided_at) VALUES (?,?,?,?,'open',NULL,NULL,?,NULL)`);

  const queue = (q: QueueInput): string => {
    nq += 1;
    const id = kit.id('mq', nq);
    insQueue.run(
      id, q.entityType, q.entityId, q.surface, hero, q.authorId, q.source, q.category, q.severity, q.priority, q.label ?? null, q.status, q.claimedBy ?? null, q.claimedAt ?? null,
      q.reportCount ?? 0, q.reporterWeight ?? 0, q.blockedText ?? null, JSON.stringify(q.ruleIds ?? []), q.legalHold ? 1 : 0, q.reference ?? null, q.appealId ?? null,
      q.createdAt, q.firstActionAt ?? null, q.closedAt ?? null, q.resolution ?? null,
    );
    return id;
  };
  const report = (queueId: string, entityType: ContentEntityType, entityId: string, reporter: SeedUser, reason: string, note: string | null, at: number, status: 'open' | 'actioned' | 'dismissed', closedAt: number | null, badFaith = false): string => {
    nr += 1;
    const id = kit.id('rep', nr);
    insReport.run(id, reporter.id, entityType, entityId, reason, note, hero, status, badFaith ? 1 : 0, queueId, at, closedAt);
    return id;
  };
  const audit = (actorId: string, actorRole: string, action: string, targetType: string | null, targetId: string | null, queueId: string | null, at: number, extra: { reasonCode?: string; reason?: string; metadata?: Record<string, unknown> } = {}): string => {
    nl += 1;
    const id = kit.id('al', nl);
    insAudit.run(id, actorId, actorRole, action, targetType, targetId, queueId, extra.reasonCode ?? null, extra.reason ?? null, JSON.stringify(extra.metadata ?? {}), at);
    return id;
  };
  const anonType = (t: ContentEntityType): boolean => t === 'buzz' || t === 'buzz_reply';
  /** moderation_actions + the audit row recordAction would write (entity-targeted; identity only for public origin). */
  const action = (a: ActionInput): string => {
    na += 1;
    const id = kit.id('ma', na);
    insAction.run(id, a.queueId, a.entityType, a.entityId, a.targetUserId, a.actorId, a.actorRole, a.action, a.category, a.note, a.sanctionId ?? null, a.createdAt);
    const anon = anonType(a.entityType);
    audit(a.actorId, a.actorRole, a.action, a.entityType, a.entityId ?? (anon ? null : a.targetUserId), a.queueId, a.createdAt, {
      reason: a.note ?? undefined,
      metadata: { actionId: id, category: a.category, sanctionId: a.sanctionId ?? null, ...(anon || !a.targetUserId ? {} : { targetUserId: a.targetUserId }) },
    });
    db.prepare('UPDATE mod_queue SET first_action_at = COALESCE(first_action_at, ?) WHERE id = ?').run(a.createdAt, a.queueId);
    return id;
  };
  const strike = (userId: string, entityType: ContentEntityType, entityId: string, category: ModerationCategory, severity: ModerationSeverity, actionId: string, queueId: string, actor: SeedUser, actorRole: string, excerpt: string, label: string, at: number): void => {
    ns += 1;
    const points = severity === 'critical' ? 5 : severity === 'high' ? 3 : severity === 'medium' ? 2 : 1;
    const ttl = severity === 'critical' ? null : severity === 'high' ? 180 * DAY : 90 * DAY;
    const id = kit.id('str', ns);
    insStrike.run(id, userId, entityType, entityId, category, severity, points, actionId, ttl === null ? null : at + ttl, at);
    nsan += 1;
    insSanction.run(kit.id('san', nsan), userId, 'removal', category, entityType, entityId, excerpt.slice(0, 140), label, actionId, actor.id, at, at, null, at + 20 * MIN, at);
    audit(actor.id, actorRole, 'strike_add', entityType, entityId, queueId, at + 1, {
      metadata: { strikeId: id, points, severity, category, expiresAt: ttl === null ? null : at + ttl, ...(anonType(entityType) ? {} : { userId }) },
    });
  };
  const sanction = (o: { userId: string; kind: 'warning' | 'mute'; category: ModerationCategory; entityType: ContentEntityType; entityId: string | null; excerpt: string | null; label: string | null; actionId: string; queueId: string; actor: SeedUser; actorRole: string; at: number; durationMs?: number; acknowledgedAt?: number | null; delayMin?: number }): string => {
    nsan += 1;
    const id = kit.id('san', nsan);
    const effectiveAt = o.at + (o.delayMin ?? 0) * MIN;
    const endsAt = o.kind === 'mute' ? effectiveAt + (o.durationMs ?? 24 * HOUR) : null;
    insSanction.run(id, o.userId, o.kind, o.category, o.entityType, o.entityId, o.excerpt ? o.excerpt.slice(0, 140) : null, o.label, o.actionId, o.actor.id, effectiveAt, effectiveAt, endsAt, o.acknowledgedAt ?? null, o.at);
    db.prepare('UPDATE moderation_actions SET sanction_id = ? WHERE id = ?').run(id, o.actionId);
    const anon = anonType(o.entityType);
    audit(o.actor.id, o.actorRole, 'sanction_apply', anon ? o.entityType : 'user', anon ? (o.entityId ?? o.queueId) : o.userId, o.queueId, o.at + 2, {
      metadata: { sanctionId: id, kind: o.kind, scope: 'all', category: o.category, durationMs: o.durationMs ?? null, effectiveAt, endsAt, ...(anon ? {} : { entityType: o.entityType, entityId: o.entityId }) },
    });
    return id;
  };
  const event = (o: { entityType: ContentEntityType; entityId: string | null; surface: ModerationSurface; field?: string; authorId: string; action: 'allow' | 'flag' | 'block'; visibility: 'visible' | 'held'; category: ModerationCategory; subcode: string; severity: ModerationSeverity; ruleIds: string[]; matches: { ruleId: string; category: ModerationCategory; subcode: string; severity: ModerationSeverity; span: [number, number]; field: string }[]; at: number }): void => {
    nev += 1;
    insEvent.run(
      kit.id('me', nev), o.entityType, o.entityId, o.surface, o.field ?? 'body', o.authorId, hero, o.action, o.visibility, o.category, o.subcode, o.severity, JSON.stringify(o.ruleIds),
      JSON.stringify(o.matches.map((m) => ({ ...m, view: 'folded' }))), JSON.stringify({ evasion: false, invisibleChars: 0, homoglyphs: 0, urls: 0, mentions: 0, capsRatio: 0, hasFullName: false }),
      `seed${nev}`, o.at,
    );
  };
  const span = (text: string, phrase: string): [number, number] => {
    const i = text.toLowerCase().indexOf(phrase.toLowerCase());
    return i < 0 ? [0, Math.min(text.length, phrase.length)] : [i, i + phrase.length];
  };
  /** Owner-seeded content when its adapter is present; otherwise the blocked_text fallback. */
  const resolve = (entityType: ContentEntityType, entityId: string, fallbackAuthor: SeedUser): { entityId: string | null; authorId: string; text: string | null; loaded: boolean } => {
    let snap: ReturnType<NonNullable<ReturnType<typeof getContentAdapter>>['load']> = null;
    try {
      snap = getContentAdapter(entityType)?.load(entityId) ?? null;
    } catch {
      snap = null;
    }
    if (snap) return { entityId, authorId: snap.authorId, text: null, loaded: true };
    return { entityId: null, authorId: fallbackAuthor.id, text: null, loaded: false };
  };

  /* ═══════════════════════════ OPEN (9) ═══════════════════════════ */

  // 1. buzz_0101 — RA insult, hidden by reports (Auto-hidden view). Text is the buzz seed's fixture text (§7.5).
  {
    const text = 'The RA on the 7th floor of Jester West, Kyle, is a power-tripping loser who writes people up for breathing. Avoid his floor and make his life miserable.';
    const r = resolve('buzz', 'buzz_0101', pickBg(0));
    const at = kit.ago({ d: 1, h: 8 });
    const q = queue({
      entityType: 'buzz', entityId: r.entityId, surface: 'buzz', authorId: r.authorId, source: 'rule_flag', category: 'harassment_bullying', severity: 'high', priority: 'p1',
      status: 'open', blockedText: r.loaded ? null : text, ruleIds: ['har.pile_on.v1', 'adm.har.pile_on_ext.v1'], reportCount: r.loaded ? 3 : 0, reporterWeight: r.loaded ? 3 : 0, createdAt: at,
    });
    event({
      entityType: 'buzz', entityId: r.entityId, surface: 'buzz', authorId: r.authorId, action: 'flag', visibility: 'visible', category: 'harassment_bullying', subcode: 'pile_on_call', severity: 'high',
      ruleIds: ['har.pile_on.v1', 'adm.har.pile_on_ext.v1'],
      matches: [
        { ruleId: 'adm.har.pile_on_ext.v1', category: 'harassment_bullying', subcode: 'pile_on_call', severity: 'high', span: span(text, 'make his life miserable'), field: 'body' },
        { ruleId: 'har.mild_insult.v1', category: 'harassment_bullying', subcode: 'targeted_insult', severity: 'medium', span: span(text, 'power-tripping loser'), field: 'body' },
      ],
      at,
    });
    if (r.entityId) {
      report(q, 'buzz', r.entityId, pickBg(1), 'harassment', 'Names an RA and tells people to go after him.', at + 40 * MIN, 'open', null);
      report(q, 'buzz', r.entityId, pickBg(2), 'harassment', null, at + 2 * HOUR, 'open', null);
      report(q, 'buzz', r.entityId, pickBg(3), 'doxxing', 'Floor plus first name is enough to identify him.', at + 3 * HOUR, 'open', null);
    }
    audit(dana.id, 'admin', 'reporter_viewed', 'buzz', r.entityId, q, kit.ago({ h: 20 }));
  }

  // 2. lst_0061 — Rx-stimulant Wanted listing, held (Held view).
  {
    const title = 'Looking for Adderall for finals week';
    const desc = 'Anyone have a few spare study pills? Will pay cash, dm me.';
    const r = resolve('market_listing', 'lst_0061', pickBg(4));
    const at = kit.ago({ h: 19 });
    const q = queue({
      entityType: 'market_listing', entityId: r.entityId, surface: 'market_listing', authorId: r.authorId, source: 'rule_flag', category: 'drugs_illegal_sales', severity: 'high', priority: 'p1',
      status: 'open', blockedText: r.loaded ? null : `${title}\n${desc}`, ruleIds: ['drg.rx_sale.v1', 'adm.com.rx_listing.v1'], createdAt: at,
    });
    event({
      entityType: 'market_listing', entityId: r.entityId, surface: 'market_listing', field: 'title', authorId: r.authorId, action: 'flag', visibility: 'held', category: 'drugs_illegal_sales', subcode: 'rx_sale', severity: 'high',
      ruleIds: ['drg.rx_sale.v1', 'adm.com.rx_listing.v1'],
      matches: [
        { ruleId: 'adm.com.rx_listing.v1', category: 'drugs_illegal_sales', subcode: 'rx_sale', severity: 'high', span: span(title, 'Adderall'), field: 'title' },
        { ruleId: 'drg.rx_sale.v1', category: 'drugs_illegal_sales', subcode: 'rx_sale', severity: 'high', span: span(desc, 'spare study pills'), field: 'body' },
      ],
      at,
    });
    void q;
  }

  // 3–5. link spam in a background-user group chat this seed creates (message ×2 + the conversation).
  const spammer = pickBg(5);
  const members = [pickBg(6), pickBg(7), pickBg(8), pickBg(9)];
  const groupAt = kit.ago({ d: 3, h: 2 });
  const convId = kit.convo.group('Off-campus housing leads', members[0]!.id, [members[1]!.id, members[2]!.id, members[3]!.id, spammer.id]);
  kit.convo.say(convId, members[0]!.id, 'Starting this so we can swap leads on West Campus places for next year.', groupAt);
  kit.convo.say(convId, members[1]!.id, 'Anyone toured the new building on 26th? Curious about the noise.', groupAt + 25 * MIN);
  const spamTexts = [
    'guys i found a site with 40% off leases just sign up here rentdealz-austin.top/promo?ref=44 before it closes tonight',
    'last chance!!! rentdealz-austin.top/promo?ref=44 they pay you $200 for each friend that signs up, dm me your zelle',
    'ok fr this one is legit: cheap-leases-atx.site/apply?ref=44 pay the $50 application fee first and they waive the deposit',
  ];
  const spamMsgs = spamTexts.map((t, i) => kit.convo.say(convId, spammer.id, t, groupAt + (i + 3) * 40 * MIN));
  kit.convo.say(convId, members[2]!.id, 'Please stop posting these, nobody asked.', groupAt + 6 * 40 * MIN);
  {
    const at = groupAt + 7 * 40 * MIN;
    for (let i = 0; i < 2; i += 1) {
      const m = spamMsgs[i]!;
      const q = queue({
        entityType: 'message', entityId: m.id, surface: 'group_message', authorId: spammer.id, source: 'user_report', category: 'spam_scam', severity: 'none', priority: 'p2',
        status: 'open', blockedText: spamTexts[i], reportCount: 2, reporterWeight: 2, createdAt: at + i * 10 * MIN,
      });
      report(q, 'message', m.id, members[2]!, 'spam_scam', 'Same referral link three times, asks for zelle.', at + i * 10 * MIN, 'open', null);
      report(q, 'message', m.id, members[3]!, 'spam_scam', null, at + i * 10 * MIN + 15 * MIN, 'open', null);
      if (i === 0) audit(riley.id, 'moderator', 'dm_context_viewed', 'message', m.id, q, at + 3 * HOUR);
    }
    const qc = queue({
      entityType: 'conversation', entityId: convId, surface: 'group_name', authorId: members[0]!.id, source: 'user_report', category: 'spam_scam', severity: 'none', priority: 'p3',
      status: 'open', blockedText: 'Off-campus housing leads', reportCount: 1, reporterWeight: 1, createdAt: at + 30 * MIN,
    });
    report(qc, 'conversation', convId, members[1]!, 'spam_scam', 'The whole group has turned into referral-link spam.', at + 30 * MIN, 'open', null);
  }

  // 6. buzz_0102 — vague building threat, escalated (admins only), unmasked with reason by dana.
  let unmaskQueueId = '';
  let unmaskTarget: { type: string; id: string | null } = { type: 'queue', id: null };
  {
    const text = "Don't come to the GDC tomorrow. Trust me on this one.";
    const r = resolve('buzz', 'buzz_0102', pickBg(10));
    const at = kit.ago({ h: 13 });
    const q = queue({
      entityType: 'buzz', entityId: r.entityId, surface: 'buzz', authorId: r.authorId, source: 'rule_flag', category: 'threat_violence', severity: 'high', priority: 'p0',
      status: 'escalated', blockedText: r.loaded ? null : text, ruleIds: ['adm.thr.vague_warning.v1'], reportCount: r.loaded ? 2 : 0, reporterWeight: r.loaded ? 2 : 0, createdAt: at, firstActionAt: at + 50 * MIN,
    });
    event({
      entityType: 'buzz', entityId: r.entityId, surface: 'buzz', authorId: r.authorId, action: 'flag', visibility: 'visible', category: 'threat_violence', subcode: 'threat_place', severity: 'high',
      ruleIds: ['adm.thr.vague_warning.v1'],
      matches: [{ ruleId: 'adm.thr.vague_warning.v1', category: 'threat_violence', subcode: 'threat_place', severity: 'high', span: span(text, "Don't come to the GDC tomorrow"), field: 'body' }],
      at,
    });
    if (r.entityId) {
      report(q, 'buzz', r.entityId, pickBg(11), 'threat', 'This reads like a warning about the building.', at + 30 * MIN, 'open', null);
      report(q, 'buzz', r.entityId, pickBg(12), 'threat', null, at + 45 * MIN, 'open', null);
    }
    action({ queueId: q, entityType: 'buzz', entityId: r.entityId, targetUserId: r.authorId, actorId: riley.id, actorRole: 'moderator', action: 'escalate', category: 'threat_violence', note: 'Vague warning about a specific building tomorrow; two threat reports within an hour. Needs admin eyes tonight.', createdAt: at + 50 * MIN });
    unmaskQueueId = q;
    unmaskTarget = { type: r.entityId ? 'buzz' : 'queue', id: r.entityId ?? q };
  }

  // 7. wellbeing P0 — blocked_text item, entity_id NULL (self-harm ideation never sanctions).
  {
    const text = "honestly not sure i want to be around for next semester. everything feels pointless and i'm tired of pretending it's fine.";
    const author = pickBg(13);
    const at = kit.ago({ h: 3, m: 20 });
    queue({
      entityType: 'buzz', entityId: null, surface: 'buzz', authorId: author.id, source: 'rule_flag', category: 'self_harm', severity: 'medium', priority: 'p0', label: 'wellbeing',
      status: 'open', blockedText: text, ruleIds: ['sh.ideation.v1'], createdAt: at,
    });
    event({
      entityType: 'buzz', entityId: null, surface: 'buzz', authorId: author.id, action: 'allow', visibility: 'visible', category: 'self_harm', subcode: 'ideation', severity: 'medium', ruleIds: ['sh.ideation.v1'],
      matches: [{ ruleId: 'sh.ideation.v1', category: 'self_harm', subcode: 'ideation', severity: 'medium', span: span(text, 'not sure i want to be around'), field: 'body' }],
      at,
    });
  }

  // 8. ryanoc: closed profile item → 24 h mute (public origin) → open appeal.
  {
    const bio = 'Jester 7 RA is a joke, ask anyone. If you see him in the hall let him know.';
    const at = kit.ago({ d: 1, h: 2 });
    const closedAt = kit.ago({ h: 18 });
    const q = queue({
      entityType: 'profile', entityId: ryanoc.id, surface: 'profile', authorId: ryanoc.id, source: 'user_report', category: 'harassment_bullying', severity: 'medium', priority: 'p1',
      status: 'closed', blockedText: bio, reportCount: 2, reporterWeight: 2, createdAt: at, closedAt, resolution: 'sanctioned',
    });
    report(q, 'profile', ryanoc.id, pickBg(1), 'harassment', 'Bio is aimed at a named RA, second time this month.', at, 'actioned', closedAt);
    report(q, 'profile', ryanoc.id, pickBg(6), 'harassment', null, at + 3 * HOUR, 'actioned', closedAt);
    const a = action({ queueId: q, entityType: 'profile', entityId: ryanoc.id, targetUserId: ryanoc.id, actorId: dana.id, actorRole: 'admin', action: 'remove_and_mute_24h', category: 'harassment_bullying', note: 'Bio targeted a named RA after a warning last month; removed the line and muting 24 h per the ladder (3 points).', createdAt: closedAt });
    strike(ryanoc.id, 'profile', ryanoc.id, 'harassment_bullying', 'medium', a, q, dana, 'admin', bio, 'profile', closedAt);
    const s = sanction({ userId: ryanoc.id, kind: 'mute', category: 'harassment_bullying', entityType: 'profile', entityId: ryanoc.id, excerpt: bio, label: 'profile', actionId: a, queueId: q, actor: dana, actorRole: 'admin', at: closedAt, durationMs: 24 * HOUR, acknowledgedAt: closedAt + 25 * MIN });
    // the mute runs until now + 6 h (started 18 h ago)
    db.prepare('UPDATE user_sanctions SET ends_at = ? WHERE id = ?').run(kit.now + 6 * HOUR, s);
    const appealAt = kit.ago({ h: 12 });
    const appealId = kit.id('apl', 1);
    insAppeal.run(appealId, ryanoc.id, s, "I was venting about a real situation and I've already changed the line. A full day mute for one bio sentence feels heavy; I'd appreciate a second look.", appealAt);
    const aq = queue({
      entityType: 'profile', entityId: ryanoc.id, surface: 'appeal', authorId: ryanoc.id, source: 'appeal', category: 'harassment_bullying', severity: 'none', priority: 'p2',
      status: 'open', blockedText: bio, appealId, createdAt: appealAt,
    });
    audit('system', 'system', 'appeal_create', 'appeal', appealId, aq, appealAt, { metadata: { kind: 'mute' } });
  }

  // 9. plain report on a background user's profile (impersonation).
  {
    const target = pickBg(14);
    const at = kit.ago({ h: 6 });
    const q = queue({
      entityType: 'profile', entityId: target.id, surface: 'profile', authorId: target.id, source: 'user_report', category: 'impersonation', severity: 'none', priority: 'p2',
      status: 'open', reportCount: 1, reporterWeight: 1, createdAt: at,
    });
    report(q, 'profile', target.id, pickBg(15), 'impersonation', 'Profile photo and name copy someone from my hall.', at, 'open', null);
  }

  /* ═══════════════════════════ CLOSED (14) ═══════════════════════════ */

  interface ClosedSpec {
    entityType: ContentEntityType;
    entityId: string;
    surface: ModerationSurface;
    text: string;
    label: string;
    author: SeedUser;
    source: string;
    category: ModerationCategory;
    severity: ModerationSeverity;
    priority: ModerationPriority;
    queueLabel?: string;
    resolution: Resolution;
    action: string;
    actor: SeedUser;
    actorRole: 'moderator' | 'admin';
    note: string;
    daysAgo: number;
    reports?: { reporter: SeedUser; reason: string; badFaith?: boolean }[];
    sanction?: 'warning' | 'mute';
    legalHold?: boolean;
    reference?: string;
  }

  const removedSpam = spamMsgs[2]!;
  const closedSpecs: ClosedSpec[] = [
    { entityType: 'buzz_reply', entityId: 'bzr_0901', surface: 'buzz_reply', text: 'lol everyone on your floor thinks you are pathetic, just transfer already', label: 'reply', author: pickBg(0), source: 'user_report', category: 'harassment_bullying', severity: 'medium', priority: 'p1', resolution: 'removed', action: 'remove', actor: riley, actorRole: 'moderator', note: 'Targeted pile-on at a specific person on the floor; three reports agree.', daysAgo: 2, reports: [{ reporter: pickBg(2), reason: 'harassment' }, { reporter: pickBg(3), reason: 'harassment' }, { reporter: pickBg(4), reason: 'harassment' }] },
    { entityType: 'buzz', entityId: 'buzz_0902', surface: 'buzz', text: 'the dining hall pasta is a war crime and i will die on this hill', label: 'buzz', author: pickBg(1), source: 'user_report', category: 'harassment_bullying', severity: 'none', priority: 'p2', resolution: 'approved', action: 'approve', actor: riley, actorRole: 'moderator', note: '', daysAgo: 3, reports: [{ reporter: pickBg(5), reason: 'harassment' }, { reporter: pickBg(6), reason: 'threat' }, { reporter: pickBg(7), reason: 'other' }] },
    { entityType: 'buzz', entityId: 'buzz_0903', surface: 'buzz', text: 'selling my calc textbook, dm if interested, moving to the marketplace tab now', label: 'buzz', author: pickBg(2), source: 'user_report', category: 'spam_scam', severity: 'none', priority: 'p3', resolution: 'dismissed', action: 'dismiss_reports', actor: riley, actorRole: 'moderator', note: '', daysAgo: 4, reports: [{ reporter: pickBg(8), reason: 'spam_scam' }] },
    { entityType: 'buzz', entityId: 'buzz_0904', surface: 'buzz', text: 'week 6 and i still eat every meal alone. does it get better', label: 'buzz', author: pickBg(3), source: 'rule_flag', category: 'self_harm', severity: 'medium', priority: 'p0', queueLabel: 'wellbeing', resolution: 'approved', action: 'approve', actor: dana, actorRole: 'admin', note: '', daysAgo: 5 },
    { entityType: 'buzz', entityId: 'buzz_0905', surface: 'buzz', text: 'the international kids in my lab dont belong in engineering, change my mind', label: 'buzz', author: pickBg(4), source: 'rule_flag', category: 'hate', severity: 'medium', priority: 'p1', resolution: 'sanctioned', action: 'remove_and_warn', actor: dana, actorRole: 'admin', note: 'Exclusion call aimed at a group of classmates; first violation so removal plus a warning.', daysAgo: 6, sanction: 'warning' },
    { entityType: 'message', entityId: removedSpam.id, surface: 'group_message', text: spamTexts[2]!, label: 'message', author: spammer, source: 'user_report', category: 'spam_scam', severity: 'high', priority: 'p2', resolution: 'removed', action: 'remove', actor: riley, actorRole: 'moderator', note: 'Deposit-first scam link posted to a housing group; reported by two members.', daysAgo: 1, reports: [{ reporter: members[1]!, reason: 'spam_scam' }, { reporter: members[3]!, reason: 'spam_scam' }] },
    { entityType: 'profile', entityId: pickBg(5).id, surface: 'profile', text: 'Not the official events account, just a fan of good events.', label: 'profile', author: pickBg(5), source: 'user_report', category: 'impersonation', severity: 'none', priority: 'p2', resolution: 'approved', action: 'approve', actor: dana, actorRole: 'admin', note: '', daysAgo: 7, reports: [{ reporter: pickBg(9), reason: 'impersonation' }, { reporter: pickBg(10), reason: 'impersonation' }] },
    { entityType: 'profile', entityId: pickBg(6).id, surface: 'profile', text: 'Speaking for the whole climbing club: come to our thing on Thursday.', label: 'profile', author: pickBg(6), source: 'rule_flag', category: 'impersonation', severity: 'medium', priority: 'p2', resolution: 'sanctioned', action: 'warn_only', actor: riley, actorRole: 'moderator', note: 'Bio claims to speak for an org they are not an officer of; warning and asked to reword.', daysAgo: 8, sanction: 'warning' },
    { entityType: 'buzz', entityId: 'buzz_0909', surface: 'buzz', text: 'im bringing something to the stadium saturday and nobody is going to forget it', label: 'buzz', author: pickBg(7), source: 'rule_flag', category: 'threat_violence', severity: 'critical', priority: 'p0', resolution: 'escalated_external', action: 'escalate_external', actor: dana, actorRole: 'admin', note: 'Credible-enough threat against a game-day venue; UTPD contacted and the account was suspended pending their review.', daysAgo: 9, legalHold: true, reference: 'UTPD-2026-0912-117' },
    { entityType: 'buzz', entityId: 'buzz_0910', surface: 'buzz', text: 'everyone go flood the dms of the girl who runs the study group, she deserves it', label: 'buzz', author: pickBg(8), source: 'rule_flag', category: 'harassment_bullying', severity: 'high', priority: 'p1', resolution: 'sanctioned', action: 'remove_and_mute_24h', actor: dana, actorRole: 'admin', note: 'Pile-on call with a target the floor can identify; second confirmed violation this term.', daysAgo: 10, sanction: 'mute' },
    { entityType: 'buzz', entityId: 'buzz_0911', surface: 'buzz', text: 'does anyone else find the honor code quiz weirdly easy', label: 'buzz', author: pickBg(9), source: 'user_report', category: 'academic_dishonesty', severity: 'none', priority: 'p3', resolution: 'dismissed', action: 'dismiss_reports', actor: riley, actorRole: 'moderator', note: '', daysAgo: 11, reports: [{ reporter: pickBg(11), reason: 'academic_dishonesty', badFaith: true }] },
    { entityType: 'profile', entityId: pickBg(10).id, surface: 'profile', text: 'Ask my ex in Duren 512 how the breakup went, room 4c, she is home weeknights.', label: 'profile', author: pickBg(10), source: 'rule_flag', category: 'pii_doxxing', severity: 'high', priority: 'p1', resolution: 'removed', action: 'remove', actor: riley, actorRole: 'moderator', note: 'Bio published a third party room number and schedule; removed and strike recorded.', daysAgo: 12 },
    { entityType: 'buzz', entityId: 'buzz_0914', surface: 'buzz', text: 'plug for zaza and pre rolls on west campus, discreet, hmu tonight', label: 'buzz', author: pickBg(12), source: 'rule_flag', category: 'drugs_illegal_sales', severity: 'high', priority: 'p1', resolution: 'removed', action: 'remove', actor: riley, actorRole: 'moderator', note: 'Clear sale offer with delivery; removed and strike recorded.', daysAgo: 16 },
  ];

  for (const c of closedSpecs) {
    const createdAt = kit.ago({ d: c.daysAgo, h: 5 });
    const closedAt = createdAt + 2 * HOUR + kit.int(10, 300) * MIN;
    const q = queue({
      entityType: c.entityType, entityId: c.entityId, surface: c.surface, authorId: c.author.id, source: c.source, category: c.category ?? null, severity: c.severity, priority: c.priority,
      label: c.queueLabel ?? null, status: 'closed', blockedText: c.text, reportCount: c.reports?.length ?? 0, reporterWeight: c.reports?.length ?? 0, legalHold: c.legalHold,
      reference: c.reference ?? null, createdAt, closedAt, resolution: c.resolution,
    });
    const reportOutcome = c.resolution === 'approved' || c.resolution === 'dismissed' ? 'dismissed' : 'actioned';
    for (const [i, rp] of (c.reports ?? []).entries()) {
      const rid = report(q, c.entityType, c.entityId, rp.reporter, rp.reason, null, createdAt + (i + 1) * 20 * MIN, reportOutcome, closedAt, rp.badFaith);
      kit.notify({
        userId: rp.reporter.id, type: 'mod.report_resolved', actorId: null, href: '/guidelines', target: { entityType: 'report', entityId: rid }, collapse: false,
        data: { outcome: reportOutcome === 'actioned' ? 'actioned' : 'no_violation' }, createdAt: closedAt, read: true,
      });
    }
    const a = action({
      queueId: q, entityType: c.entityType, entityId: c.entityId, targetUserId: c.author.id, actorId: c.actor.id, actorRole: c.actorRole, action: c.action, category: c.category ?? null,
      note: c.note || null, createdAt: closedAt,
    });
    if (c.action.startsWith('remove')) {
      if (c.entityType === 'message') {
        try {
          getContentAdapter('message')?.setStatus(c.entityId, 'removed');
        } catch {
          /* the message adapter is foundation; a missing row only means the excerpt falls back */
        }
      }
      strike(c.author.id, c.entityType, c.entityId, c.category, c.severity, a, q, c.actor, c.actorRole, c.text, c.label, closedAt);
    }
    if (c.sanction === 'warning') {
      sanction({ userId: c.author.id, kind: 'warning', category: c.category, entityType: c.entityType, entityId: c.entityId, excerpt: c.text, label: c.label, actionId: a, queueId: q, actor: c.actor, actorRole: c.actorRole, at: closedAt, acknowledgedAt: closedAt + 3 * HOUR, delayMin: anonType(c.entityType) ? kit.int(5, 30) : 0 });
    } else if (c.sanction === 'mute') {
      sanction({ userId: c.author.id, kind: 'mute', category: c.category, entityType: c.entityType, entityId: c.entityId, excerpt: c.text, label: c.label, actionId: a, queueId: q, actor: c.actor, actorRole: c.actorRole, at: closedAt, durationMs: 24 * HOUR, acknowledgedAt: closedAt + 40 * MIN, delayMin: kit.int(5, 30) });
    }
  }

  /* ═══════════════════════════ the one unmask + account admin rows ═══════════════════════════ */
  {
    const at = kit.ago({ h: 11 });
    const reason = 'Vague warning to avoid a named campus building tomorrow morning; UTPD asked us to identify the account so they can check in tonight.';
    const unmaskId = audit(dana.id, 'admin', 'buzz_unmask', unmaskTarget.type, unmaskTarget.id, unmaskQueueId, at, { reasonCode: 'credible_threat', reason, metadata: { caseRef: 'UTPD-2026-0921-042' } });
    const authorRow = db.prepare('SELECT author_id FROM mod_queue WHERE id = ?').get(unmaskQueueId) as { author_id: string | null };
    const authorId = authorRow.author_id ?? pickBg(10).id;
    // the subject row carries a keyed tag of the account, never the id or handle (safety §6.6 / P3; see services/admin/unmask.ts)
    audit(dana.id, 'admin', 'buzz_unmask_subject', unmaskTarget.type, unmaskTarget.id, unmaskQueueId, at + 1, { reasonCode: 'credible_threat', metadata: { unmaskId, subjectTag: unmaskSubjectTag(authorId) } });
    kit.notify({
      userId: victor.id, type: 'admin.unmask_alert', actorId: null, href: '/admin/audit', target: null, collapse: false, data: { reasonCode: 'credible_threat', auditId: unmaskId },
      createdAt: at + 1, read: true,
    });
  }
  audit(dana.id, 'admin', 'role_grant', 'user', riley.id, null, kit.ago({ d: 21 }), { metadata: { from: 'user', to: 'moderator' } });
  audit(dana.id, 'admin', 'org_verify', 'user', kit.users.get('wic_ut').id, null, kit.ago({ d: 20 }), {});
  audit(victor.id, 'admin', 'rule_pack_toggle', 'rule_pack', 'admin.commerce', null, kit.ago({ d: 15, h: 3 }), { metadata: { enabled: false, version: '1.0.0' } });
  audit(victor.id, 'admin', 'rule_pack_toggle', 'rule_pack', 'admin.commerce', null, kit.ago({ d: 15, h: 1 }), { metadata: { enabled: true, version: '1.0.0' } });
}
