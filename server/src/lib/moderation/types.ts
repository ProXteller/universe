/**
 * Moderation engine types (SPEC §4.2.6, safety §2.3 / §2.8 / §2.9).    LANE S-M2a owns this file.
 *
 * STATUS (created by lane S-M1): the exported NAMES are final (`RulePack`, `ModerationRule`, `ModerationTarget`,
 * `SecondPass*`). S-M2a may extend the optional matcher fields of `ModerationRule`; the admin slice builds its
 * `admin.<category>` packs from this file.
 */
import type {
  ContentEntityType, Id, ModerationCategory, ModerationMatch, ModerationSeverity, ModerationSurface,
} from '@shared/core';

export type RuleKind = 'term' | 'combo' | 'guard' | 'regex' | 'behavioral';
export type TextView = ModerationMatch['view'];

/** Each rule is data (safety §2.3). Rule ids are stable strings (`thr.intent_target.v1`). */
export interface ModerationRule {
  id: string;
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  kind: RuleKind;
  /** Which normalised view(s) of the text the rule reads. */
  view: TextView | TextView[];
  /** Restrict to these surfaces (default: all). */
  surfaces?: ModerationSurface[];
  /** Phrases that cancel a match in the same sentence (never cancel `critical` severe-list matches). */
  guards?: string[];
  /**
   * kind 'term': word-boundary list lookup on `folded` / `spaced`; on `squashed` a substring lookup (terms shorter
   * than `minSquashLength`, default 5, are skipped there) guarded by the Scunthorpe allow-list.
   */
  terms?: string[];
  minSquashLength?: number;
  /**
   * kind 'combo': every slot must hit within `window` tokens (default 12). Slot entries: phrases, `re:<source>`
   * (unicode regex, boundary-wrapped), or the specials `<fullname>`, `<handle>`, `<name>` (either).
   */
  slots?: string[][];
  window?: number;
  /** kind 'regex': source + flags (compiled once by the engine). */
  pattern?: string;
  flags?: string;
  /** Create a queue item even when the outcome is `block` (threats, minors, self-harm methods). */
  escalate?: boolean;
}

export interface RulePack {
  id: string;
  version: string;
  rules: ModerationRule[];
}

export interface ModerationTarget {
  entityType: ContentEntityType;
  /** null when the action is `block` (nothing was persisted). */
  entityId: Id | null;
  authorId: Id;
  universityId: Id;
  /** Required when entityId is null and result.escalate is true: the blocked text is stored on the queue item. */
  blockedText?: string;
}

export interface SecondPassInput {
  text: string;
  surfaceGroup: 'anon' | 'public' | 'commerce' | 'private_reported';
  firstPass: { category: ModerationCategory | null; severity: ModerationSeverity };
}

export interface SecondPassVerdict {
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  /** 0..1 */
  confidence: number;
  /** ≤ 280 chars, staff-only. */
  rationale: string;
}

export interface SecondPassClassifier {
  readonly name: string;
  classify(input: SecondPassInput, signal: AbortSignal): Promise<SecondPassVerdict>;
}
