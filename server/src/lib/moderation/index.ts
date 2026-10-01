/**
 * Moderation engine entry point (SPEC §4.2.6, safety §2 binding).       LANE S-M2a owns this file.
 *
 * Layout: `normalize.ts` (views) · `pii.ts` (PII detectors) · `rules/baseline.ts` (baseline pack) · `policy.ts`
 * (outcome matrix) · `copy.ts` (author copy + support) · `engine.ts` (pure evaluation) · `queue.ts` (mod_queue upsert) ·
 * `secondPass.ts` (optional AI escalator, inert without MODERATION_AI_API_KEY) · this file (DB-aware wrappers).
 */
import type {
  AuthorNotice, ContentEntityType, EpochMs, Id, ModerationCategory, ModerationContext, ModerationPriority, ModerationResult,
  ModerationSurface, SupportResources,
} from '@shared/core';
import { SURFACE_GROUP } from '@shared/core';
import { newId, prep, tx } from '../../db/index';
import { MIN, now } from '../clock';
import { ApiError } from '../http';
import { log } from '../logger';
import type { AuthedUser } from '../users';
import { supportResources } from './copy';
import { ENGINE_VERSION, evaluate, failClosedResult } from './engine';
import { higherPriority, SEVERITY_RANK, strictness } from './policy';
import { upsertQueueItem } from './queue';
import { BASELINE_PACK } from './rules/baseline';
import { enqueueSecondPass, getSecondPassClassifier, secondPassEligible, setSecondPassClassifier } from './secondPass';
import type { ModerationTarget, RulePack, SecondPassClassifier } from './types';

export type { ModerationRule, ModerationTarget, RulePack, SecondPassClassifier, SecondPassInput, SecondPassVerdict } from './types';
export { getSecondPassClassifier, setSecondPassClassifier };
export { ENGINE_VERSION };
export { flushSecondPass, resetSecondPass, secondPassMetrics } from './secondPass';
export { upsertQueueItem, openQueueItemFor, raiseQueuePriority, type QueueRow, type QueueSource, type QueueUpsert } from './queue';

/* ───────────────────────────── rule packs ───────────────────────────── */

const packs = new Map<string, RulePack>();
const disabled = new Set<string>();

/** Idempotent by id; a later registration replaces the earlier one. Pure (no DB). Never throws. */
export function registerRulePack(pack: RulePack): void {
  try {
    if (!pack || typeof pack.id !== 'string' || !Array.isArray(pack.rules)) return;
    packs.set(pack.id, pack);
  } catch {
    /* never throws */
  }
}

export function listRulePacks(): { id: string; version: string; ruleCount: number; enabled: boolean }[] {
  return [...packs.values()].map((p) => ({ id: p.id, version: p.version, ruleCount: p.rules.length, enabled: !disabled.has(p.id) }));
}

export function setRulePackEnabled(id: string, enabled: boolean): void {
  if (enabled) disabled.delete(id);
  else disabled.add(id);
}

function enabledPacks(): RulePack[] {
  return [...packs.values()].filter((p) => !disabled.has(p.id));
}

registerRulePack(BASELINE_PACK);

/* ───────────────────────────── internals (never on the public result shape) ───────────────────────────── */

interface Internals {
  surface: ModerationSurface;
  field: NonNullable<ModerationContext['field']>;
  text: string;
  textHash: string;
  label: string | null;
  /** Per-field matches of a merged result (field name per match) for `moderation_events.matches_json`. */
  fieldMatches: { field: string; match: ModerationResult['matches'][number] }[];
}

const internals = new WeakMap<ModerationResult, Internals>();

/* ───────────────────────────── moderateText ───────────────────────────── */

/** Pure, sync, never throws (fail-closed hold on internal error). */
export function moderateText(text: string, ctx: ModerationContext): ModerationResult {
  const packList = enabledPacks();
  const field = ctx.field ?? 'body';
  try {
    const ev = evaluate(typeof text === 'string' ? text : '', ctx, packList);
    internals.set(ev.result, {
      surface: ctx.surface, field, text: typeof text === 'string' ? text : '', textHash: ev.textHash, label: ev.label,
      fieldMatches: ev.result.matches.map((match) => ({ field, match })),
    });
    return ev.result;
  } catch (err) {
    log.error('moderation engine failed (fail-closed hold)', err);
    const result = failClosedResult(packList.map((p) => p.id));
    internals.set(result, { surface: ctx.surface, field, text: '', textHash: '', label: null, fieldMatches: [] });
    return result;
  }
}

/* ───────────────────────────── moderateWrite ───────────────────────────── */

const RECENT_WINDOW_MS = 10 * MIN;

function loadRecentHashes(userId: Id, group: string, at: EpochMs): string[] {
  const rows = prep(
    'SELECT hash, conversation_id FROM recent_text_hashes WHERE user_id = ? AND surface_group = ? AND created_at > ?',
  ).all(userId, group, at - RECENT_WINDOW_MS) as { hash: string; conversation_id: string | null }[];
  if (group !== 'private') return rows.map((r) => r.hash);
  // PRIVATE: one entry per DISTINCT conversation (rows without a conversation id count individually)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.conversation_id) {
      const key = `${r.hash}:${r.conversation_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r.hash);
  }
  return out;
}

function recordHashes(userId: Id, group: string, hashes: string[], conversationId: Id | null, at: EpochMs): void {
  const ins = prep('INSERT INTO recent_text_hashes (user_id, surface_group, hash, conversation_id, created_at) VALUES (?,?,?,?,?)');
  for (const h of hashes) ins.run(userId, group, h, conversationId, at);
  if (at % 20 === 0) prep('DELETE FROM recent_text_hashes WHERE created_at < ?').run(at - 2 * RECENT_WINDOW_MS);
}

/** Strictest of several results (block > held > visible > allow; ties → higher severity). Merges support / banner / escalate. */
function mergeResults(results: ModerationResult[], surface: ModerationSurface): ModerationResult {
  const sorted = [...results].sort(
    (a, b) => strictness(b) - strictness(a) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const top = sorted[0]!;
  if (results.length === 1) return top;
  const matches = results.flatMap((r) => r.matches).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const merged: ModerationResult = {
    ...top,
    matches,
    severity: matches[0]?.severity ?? 'none',
    escalate: results.some((r) => r.escalate),
    priority: results.reduce<ModerationPriority | null>((p, r) => higherPriority(p, r.priority), null),
    support: sorted.find((r) => r.support)?.support ?? null,
    recipientBanner: sorted.find((r) => r.recipientBanner)?.recipientBanner ?? null,
    signals: {
      evasion: results.some((r) => r.signals.evasion),
      invisibleChars: results.reduce((n, r) => n + r.signals.invisibleChars, 0),
      homoglyphs: results.reduce((n, r) => n + r.signals.homoglyphs, 0),
      urls: results.reduce((n, r) => n + r.signals.urls, 0),
      mentions: results.reduce((n, r) => n + r.signals.mentions, 0),
      capsRatio: Math.max(...results.map((r) => r.signals.capsRatio)),
      hasFullName: results.some((r) => r.signals.hasFullName),
    },
    engine: { ...top.engine, elapsedMs: results.reduce((n, r) => n + r.engine.elapsedMs, 0) },
  };
  const topInternals = internals.get(top);
  internals.set(merged, {
    surface,
    field: topInternals?.field ?? 'body',
    text: results.map((r) => internals.get(r)?.text ?? '').filter(Boolean).join('\n'),
    textHash: topInternals?.textHash ?? '',
    label: results.map((r) => internals.get(r)?.label ?? null).find((l) => l) ?? null,
    fieldMatches: results.flatMap((r) => internals.get(r)?.fieldMatches ?? []),
  });
  return merged;
}

/**
 * Skips empty fields, loads / records `recent_text_hashes`, merges to the strictest result; on block:
 * `commitModeration` (event row; queue item only when escalate) then throws
 * `ApiError(422,'content_blocked', userMessage.body, ContentBlockedDetails)`.
 * `ctx.conversationId` (optional widening, PRIVATE surfaces) makes the duplicate detector count distinct conversations.
 */
export function moderateWrite(
  fields: { text: string | null | undefined; field?: ModerationContext['field'] }[],
  ctx: Omit<ModerationContext, 'field' | 'recentHashes'> & { conversationId?: Id },
  blockedTarget: Omit<ModerationTarget, 'entityId'>,
): ModerationResult {
  const present = fields.filter((f): f is { text: string; field?: ModerationContext['field'] } => typeof f.text === 'string' && f.text.trim().length > 0);
  const group = SURFACE_GROUP[ctx.surface];
  if (present.length === 0) {
    const r = moderateText('', { ...ctx, field: 'body' });
    return r;
  }
  const at = now();
  let recentHashes: readonly string[] = [];
  try {
    recentHashes = loadRecentHashes(ctx.userId, group, at);
  } catch (err) {
    log.error('moderateWrite: could not load recent hashes', err);
  }
  const { conversationId, ...pure } = ctx;
  const results = present.map((f) => moderateText(f.text, { ...pure, field: f.field ?? 'body', recentHashes }));
  const merged = mergeResults(results, ctx.surface);

  if (merged.action === 'block') {
    const text = present.map((f) => f.text).join('\n');
    try {
      commitModeration(merged, { ...blockedTarget, entityId: null, blockedText: text });
    } catch (err) {
      log.error('moderateWrite: commit of a blocked write failed', err);
    }
    const msg = merged.userMessage;
    throw new ApiError(422, 'content_blocked', msg?.body ?? 'This can’t be posted.', {
      messageId: msg?.id ?? 'M-GENERIC',
      title: msg?.title ?? 'This can’t be posted',
      category: merged.category,
      guidelineAnchor: msg?.guidelineAnchor ?? null,
      support: merged.support,
    });
  }
  try {
    const hashes = results.map((r) => internals.get(r)?.textHash ?? '').filter(Boolean);
    recordHashes(ctx.userId, group, hashes, conversationId ?? null, at);
  } catch (err) {
    log.error('moderateWrite: could not record recent hashes', err);
  }
  return merged;
}

/* ───────────────────────────── commitModeration ───────────────────────────── */

const SURFACE_FOR_ENTITY: Record<ContentEntityType, ModerationSurface> = {
  buzz: 'buzz', buzz_reply: 'buzz_reply', orbit_post: 'orbit_post', orbit_comment: 'comment', reel: 'reel_caption',
  reel_comment: 'comment', message: 'message', conversation: 'group_name', market_listing: 'market_listing',
  roommate_listing: 'roommate_listing', event: 'event', profile: 'profile',
};

function isPlainAllow(r: ModerationResult): boolean {
  return r.action === 'allow' && !r.support && !r.escalate;
}

/**
 * Writes the `moderation_events` row (flag / block / allow-with-support; never a plain allow), creates or merges the
 * `mod_queue` item when `(flag && !privateFlag) || escalate`, and enqueues the optional AI second pass.
 * Synchronous DB work; safe inside the caller's transaction. Never throws.
 */
export function commitModeration(result: ModerationResult, target: ModerationTarget): void {
  try {
    const meta = internals.get(result);
    const surface = meta?.surface ?? SURFACE_FOR_ENTITY[target.entityType];
    if (!isPlainAllow(result)) writeModerationRows(result, target, surface, meta);
    // optional second pass (allow | flag on ANON / PUBLIC / COMMERCE; never for blocks / private surfaces / unsaved rows)
    const group = secondPassEligible(surface, result.action);
    if (group && target.entityId && meta?.text && getSecondPassClassifier()) {
      enqueueSecondPass({
        input: { text: meta.text, surfaceGroup: group, firstPass: { category: result.category, severity: result.severity } },
        entityType: target.entityType, entityId: target.entityId, authorId: target.authorId, universityId: target.universityId, surface,
      });
    }
  } catch (err) {
    log.error('commitModeration failed', err);
  }
}

function writeModerationRows(result: ModerationResult, target: ModerationTarget, surface: ModerationSurface, meta: Internals | undefined): void {
  {
    const at = now();
    const ruleIds = [...new Set(result.matches.map((m) => m.ruleId))];
    const matchesJson = meta?.fieldMatches.length
      ? meta.fieldMatches.map(({ field, match }) => ({ ...match, field }))
      : result.matches.map((m) => ({ ...m, field: meta?.field ?? 'body' }));
    tx(() => {
      prep(
        `INSERT INTO moderation_events (id, entity_type, entity_id, surface, field, author_id, university_id, action, visibility, category, subcode,
           severity, rule_ids_json, matches_json, signals_json, text_hash, engine_version, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        newId(), target.entityType, target.entityId, surface, meta?.field ?? 'body', target.authorId, target.universityId, result.action,
        result.visibility, result.category, result.subcode, result.severity, JSON.stringify(ruleIds), JSON.stringify(matchesJson),
        JSON.stringify(result.signals), meta?.textHash ?? '', result.engine.version, at,
      );
      const queues = (result.action === 'flag' && !result.privateFlag) || result.escalate;
      if (queues && SURFACE_GROUP[surface] !== 'staff') {
        upsertQueueItem({
          entityType: target.entityType,
          entityId: target.entityId,
          surface,
          universityId: target.universityId,
          authorId: target.authorId,
          source: result.action === 'block' ? 'rule_block_escalation' : 'rule_flag',
          category: result.category,
          severity: result.severity,
          priority: result.priority ?? (result.escalate ? 'p0' : 'p2'),
          label: meta?.label ?? (result.category === 'self_harm' ? 'wellbeing' : null),
          blockedText: target.entityId === null ? (target.blockedText ?? meta?.text ?? null) : null,
          ruleIds,
        });
      }
    });
  }
}

/* ───────────────────────────── notices / contexts ───────────────────────────── */

/** The ONLY moderation data a non-staff client may receive. */
export function toAuthorNotice(result: ModerationResult): AuthorNotice {
  return { status: result.persistStatus ?? 'active', userMessage: result.userMessage, support: result.support };
}

/** For writes without text. */
export const NO_NOTICE: AuthorNotice = { status: 'active', userMessage: null, support: null };

export function modCtx(
  user: AuthedUser,
  surface: ModerationSurface,
  extra?: { isMessageRequest?: boolean },
): Omit<ModerationContext, 'field' | 'recentHashes'> {
  return {
    surface,
    userId: user.id,
    role: user.role,
    accountType: user.accountType,
    accountAgeMs: user.accountAgeMs,
    activeStrikePoints: user.activeStrikePoints,
    universityId: user.universityId,
    countryCode: user.countryCode,
    ...(extra?.isMessageRequest !== undefined ? { isMessageRequest: extra.isMessageRequest } : {}),
  };
}

export function blockedTarget(user: AuthedUser, entityType: ContentEntityType): Omit<ModerationTarget, 'entityId'> {
  return { entityType, authorId: user.id, universityId: user.universityId };
}

/** Buzz score auto-hide, Market / Roommates low-price flag. Never throws. */
export function enqueueSystemFlag(input: {
  entityType: ContentEntityType;
  entityId: Id;
  authorId: Id;
  universityId: Id;
  surface: ModerationSurface;
  source: 'community_score' | 'system';
  priority: ModerationPriority;
  category?: ModerationCategory | null;
}): void {
  try {
    upsertQueueItem({
      entityType: input.entityType, entityId: input.entityId, surface: input.surface, universityId: input.universityId,
      authorId: input.authorId, source: input.source, category: input.category ?? null, severity: 'none', priority: input.priority,
    });
  } catch (err) {
    log.error('enqueueSystemFlag failed', err);
  }
}

/** S-HEAD / S-BODY + crisis lines for the country (safety §2.10). */
export function supportResourcesFor(countryCode: string): SupportResources {
  return supportResources(countryCode, 'ideation');
}
