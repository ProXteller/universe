/**
 * `mod_queue` upsert (one OPEN item per entity — index `one_open_per_entity`). Used by commitModeration,
 * enqueueSystemFlag, reports (user_report) and the AI second pass. Staff actions on items live in staff.ts (S-M3).
 */
import type { ContentEntityType, EpochMs, Id, ModerationCategory, ModerationPriority, ModerationSeverity, ModerationSurface } from '@shared/core';
import { newId, prep } from '../../db/index';
import { now } from '../clock';
import { higherPriority, SEVERITY_RANK } from './policy';

export type QueueSource = 'rule_flag' | 'rule_block_escalation' | 'ai_flag' | 'user_report' | 'community_score' | 'appeal' | 'system';

export interface QueueRow {
  id: Id;
  entity_type: ContentEntityType;
  entity_id: Id | null;
  surface: ModerationSurface;
  university_id: Id;
  author_id: Id | null;
  source: QueueSource;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label: string | null;
  status: 'open' | 'claimed' | 'escalated' | 'closed';
  claimed_by: Id | null;
  claimed_at: EpochMs | null;
  report_count: number;
  reporter_weight: number;
  blocked_text: string | null;
  rule_ids_json: string;
  ai_verdict_json: string | null;
  legal_hold: number;
  reference: string | null;
  appeal_id: Id | null;
  created_at: EpochMs;
  first_action_at: EpochMs | null;
  closed_at: EpochMs | null;
  resolution: string | null;
}

export interface QueueUpsert {
  entityType: ContentEntityType;
  entityId: Id | null;
  surface: ModerationSurface;
  universityId: Id;
  authorId: Id | null;
  source: QueueSource;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label?: string | null;
  blockedText?: string | null;
  ruleIds?: string[];
  reportDelta?: number;
  weightDelta?: number;
  aiVerdict?: unknown;
}

export function openQueueItemFor(entityType: ContentEntityType, entityId: Id): QueueRow | null {
  return (
    (prep("SELECT * FROM mod_queue WHERE entity_type = ? AND entity_id = ? AND status != 'closed'").get(entityType, entityId) as QueueRow | undefined) ?? null
  );
}

/**
 * Inserts a new open item, or merges into the existing open item of the entity: priority = the higher one,
 * severity = the higher one, category / label / author filled when missing, rule ids merged, report counters added.
 * The original `source` is kept. Returns the item id.
 */
export function upsertQueueItem(i: QueueUpsert): Id {
  const at = now();
  const existing = i.entityId ? openQueueItemFor(i.entityType, i.entityId) : null;
  if (existing) {
    const ruleIds = new Set<string>(JSON.parse(existing.rule_ids_json || '[]') as string[]);
    for (const r of i.ruleIds ?? []) ruleIds.add(r);
    const severity = SEVERITY_RANK[i.severity] > SEVERITY_RANK[existing.severity] ? i.severity : existing.severity;
    prep(
      `UPDATE mod_queue SET priority = ?, severity = ?, category = COALESCE(category, ?), label = COALESCE(label, ?), author_id = COALESCE(author_id, ?),
         rule_ids_json = ?, report_count = report_count + ?, reporter_weight = reporter_weight + ?,
         ai_verdict_json = COALESCE(?, ai_verdict_json)
       WHERE id = ?`,
    ).run(
      higherPriority(existing.priority, i.priority) ?? i.priority, severity, i.category, i.label ?? null, i.authorId, JSON.stringify([...ruleIds]),
      i.reportDelta ?? 0, i.weightDelta ?? 0, i.aiVerdict === undefined ? null : JSON.stringify(i.aiVerdict), existing.id,
    );
    return existing.id;
  }
  const id = newId();
  prep(
    `INSERT INTO mod_queue (id, entity_type, entity_id, surface, university_id, author_id, source, category, severity, priority, label, status,
       report_count, reporter_weight, blocked_text, rule_ids_json, ai_verdict_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?)`,
  ).run(
    id, i.entityType, i.entityId, i.surface, i.universityId, i.authorId, i.source, i.category, i.severity, i.priority, i.label ?? null,
    i.reportDelta ?? 0, i.weightDelta ?? 0, i.blockedText ?? null, JSON.stringify(i.ruleIds ?? []),
    i.aiVerdict === undefined ? null : JSON.stringify(i.aiVerdict), at,
  );
  return id;
}

/** Raises the open item's priority to `priority` when that is higher (never lowers). */
export function raiseQueuePriority(queueId: Id, priority: ModerationPriority): void {
  const row = prep('SELECT priority FROM mod_queue WHERE id = ?').get(queueId) as { priority: ModerationPriority } | undefined;
  if (!row) return;
  const next = higherPriority(row.priority, priority) ?? priority;
  if (next !== row.priority) prep('UPDATE mod_queue SET priority = ? WHERE id = ?').run(next, queueId);
}
