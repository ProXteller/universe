/**
 * Optional AI second pass (safety §2.9, SPEC §3.3): an ESCALATOR ONLY.
 *  - Active only when `MODERATION_AI_API_KEY` is set (or a test installs a classifier via `setSecondPassClassifier`).
 *    With the key absent nothing is enqueued and no network call can occur.
 *  - Runs after the write, asynchronously; never delays or fails a user request.
 *  - Scope: ANON / PUBLIC / COMMERCE with rule outcome allow | flag. PRIVATE surfaces are never sent. Blocks are not sent.
 *  - Payload: text + surface group + first-pass verdict only (no user / entity / campus / time). Correlation = random nonce.
 *  - Powers: allow → flag (queue item source `ai_flag`), or active → hidden (P1) when confidence ≥ 0.90 and the category
 *    maps to severity ≥ high. It can never approve, restore, un-block, remove or sanction.
 *  - Resilience: 2 retries with jitter, then drop; circuit breaker after 5 consecutive failures for 5 min; in-memory
 *    queue capped at 500 (oldest dropped). Failures are counted and otherwise silent.
 */
import crypto from 'node:crypto';
import type { ContentEntityType, Id, ModerationCategory, ModerationSeverity } from '@shared/core';
import { SURFACE_GROUP, type ModerationSurface } from '@shared/core';
import { config } from '../../config';
import { tx } from '../../db/index';
import { MIN, now } from '../clock';
import { getContentAdapter } from '../content';
import { log } from '../logger';
import { SEVERITY_RANK } from './policy';
import { openQueueItemFor, upsertQueueItem } from './queue';
import type { SecondPassClassifier, SecondPassInput, SecondPassVerdict } from './types';

const MAX_JOBS = 500;
const RETRIES = 2;
const BREAKER_FAILURES = 5;
const BREAKER_OPEN_MS = 5 * MIN;

export interface SecondPassJob {
  nonce: string;
  input: SecondPassInput;
  entityType: ContentEntityType;
  entityId: Id;
  authorId: Id;
  universityId: Id;
  surface: ModerationSurface;
}

const queue: SecondPassJob[] = [];
let draining: Promise<void> | null = null;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;
export const secondPassMetrics = { processed: 0, failed: 0, dropped: 0, escalated: 0 };

/* ───────────────────────────── classifier ───────────────────────────── */

let override: SecondPassClassifier | null = null;
let envClassifier: SecondPassClassifier | null = null;

const VALID_CATEGORIES: ReadonlySet<string> = new Set<ModerationCategory>([
  'threat_violence', 'harassment_bullying', 'hate', 'sexual_minors', 'sexual_explicit', 'drugs_illegal_sales', 'self_harm',
  'pii_doxxing', 'named_accusation', 'impersonation', 'spam_scam', 'academic_dishonesty', 'profanity',
]);
const VALID_SEVERITIES: ReadonlySet<string> = new Set<ModerationSeverity>(['none', 'low', 'medium', 'high', 'critical']);

function parseVerdict(raw: unknown): SecondPassVerdict {
  const v = (raw ?? {}) as Record<string, unknown>;
  const category = typeof v.category === 'string' && VALID_CATEGORIES.has(v.category) ? (v.category as ModerationCategory) : null;
  const severity = typeof v.severity === 'string' && VALID_SEVERITIES.has(v.severity) ? (v.severity as ModerationSeverity) : 'none';
  const confidence = typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0;
  const rationale = typeof v.rationale === 'string' ? v.rationale.slice(0, 280) : '';
  return { category, severity, confidence, rationale };
}

/** Minimal `fetch` classifier (provider `anthropic` by default). Built lazily; only when the env key is present. */
function buildEnvClassifier(): SecondPassClassifier | null {
  const { apiKey, provider, model, timeoutMs } = config.moderationAi;
  if (!apiKey) return null;
  const endpoint = provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : provider;
  return {
    name: provider,
    async classify(input, signal): Promise<SecondPassVerdict> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = (): void => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const prompt =
          `Classify the following ${input.surfaceGroup} post from a university social app against these categories: ` +
          `${[...VALID_CATEGORIES].join(', ')}. First-pass verdict: ${input.firstPass.category ?? 'none'} / ${input.firstPass.severity}. ` +
          'Reply with JSON only: {"category": <category or null>, "severity": "none|low|medium|high|critical", "confidence": 0..1, "rationale": "<= 280 chars"}.\n\n' +
          `TEXT:\n${input.text}`;
        // Raw HTTP on purpose: the locked stack has no SDK dependency (SPEC §3.3 "minimal fetch classifier").
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: model ?? 'claude-opus-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`second pass HTTP ${res.status}`);
        const body = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
        if (body.stop_reason === 'refusal') return { category: null, severity: 'none', confidence: 0, rationale: '' };
        const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
        const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? '{}';
        return parseVerdict(JSON.parse(json));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** null ⇔ `MODERATION_AI_API_KEY` absent and no test classifier installed. */
export function getSecondPassClassifier(): SecondPassClassifier | null {
  if (override) return override;
  if (!config.moderationAi.apiKey) return null;
  envClassifier ??= buildEnvClassifier();
  return envClassifier;
}

/** Tests. */
export function setSecondPassClassifier(c: SecondPassClassifier | null): void {
  override = c;
  envClassifier = null;
}

/* ───────────────────────────── queue ───────────────────────────── */

/** Enqueue (fire-and-forget). No-op without a classifier. Caller has already checked the surface group + outcome. */
export function enqueueSecondPass(job: Omit<SecondPassJob, 'nonce'>): void {
  if (!getSecondPassClassifier()) return;
  if (queue.length >= MAX_JOBS) {
    queue.shift();
    secondPassMetrics.dropped += 1;
  }
  queue.push({ ...job, nonce: crypto.randomBytes(8).toString('hex') });
  void drain();
}

/** Drains the in-memory queue (tests await this). */
export function flushSecondPass(): Promise<void> {
  return drain();
}

async function drainLoop(): Promise<void> {
  while (queue.length) {
    const job = queue.shift()!;
    await process(job);
  }
}

function drain(): Promise<void> {
  if (draining) return draining;
  if (queue.length === 0) return Promise.resolve();
  // `.finally` settles asynchronously, so the reset always runs AFTER the assignment below (never a stale promise)
  const p: Promise<void> = drainLoop().finally(() => {
    if (draining === p) draining = null;
  });
  draining = p;
  return p;
}

async function process(job: SecondPassJob): Promise<void> {
  const classifier = getSecondPassClassifier();
  if (!classifier) return;
  if (now() < breakerOpenUntil) {
    secondPassMetrics.dropped += 1;
    return;
  }
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const controller = new AbortController();
      const verdict = parseVerdict(await classifier.classify(job.input, controller.signal));
      consecutiveFailures = 0;
      secondPassMetrics.processed += 1;
      applyVerdict(job, verdict);
      return;
    } catch {
      secondPassMetrics.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= BREAKER_FAILURES) {
        breakerOpenUntil = now() + BREAKER_OPEN_MS;
        consecutiveFailures = 0;
        return;
      }
      if (attempt < RETRIES && config.env !== 'test') await new Promise((r) => setTimeout(r, 200 + Math.random() * 400));
    }
  }
}

/** Escalate only: allow → flag (queue item, source ai_flag); active → hidden pending review when confident + severe. */
function applyVerdict(job: SecondPassJob, verdict: SecondPassVerdict): void {
  if (!verdict.category || verdict.severity === 'none' || verdict.confidence < 0.7) return;
  const adapter = getContentAdapter(job.entityType);
  const snap = adapter?.load(job.entityId) ?? null;
  if (!snap) return;
  const hide = verdict.confidence >= 0.9 && SEVERITY_RANK[verdict.severity] >= SEVERITY_RANK.high && snap.status === 'active';
  try {
    tx(() => {
      const existing = openQueueItemFor(job.entityType, job.entityId);
      upsertQueueItem({
        entityType: job.entityType, entityId: job.entityId, surface: job.surface, universityId: job.universityId, authorId: job.authorId,
        source: 'ai_flag', category: verdict.category, severity: verdict.severity, priority: hide ? 'p1' : SEVERITY_RANK[verdict.severity] >= SEVERITY_RANK.high ? 'p1' : 'p2',
        aiVerdict: { ...verdict, classifier: classifierName(), nonce: job.nonce },
      });
      if (hide && adapter) adapter.setStatus(job.entityId, 'hidden');
      if (!existing || hide) secondPassMetrics.escalated += 1;
    });
  } catch (err) {
    log.error('second pass: could not apply verdict', err);
  }
}

function classifierName(): string {
  return getSecondPassClassifier()?.name ?? 'none';
}

/** Whether a first-pass outcome is in scope for the second pass (safety §2.9). */
export function secondPassEligible(surface: ModerationSurface, action: 'allow' | 'flag' | 'block'): SecondPassInput['surfaceGroup'] | null {
  if (action === 'block') return null;
  const g = SURFACE_GROUP[surface];
  if (g === 'anon' || g === 'public' || g === 'commerce') return g;
  return null;
}

/** Tests: clear the queue and breaker. */
export function resetSecondPass(): void {
  queue.length = 0;
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
  secondPassMetrics.processed = 0;
  secondPassMetrics.failed = 0;
  secondPassMetrics.dropped = 0;
  secondPassMetrics.escalated = 0;
}
