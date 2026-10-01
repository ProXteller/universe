/**
 * `admin` slice contract (SPEC §5.11) — Trust & Safety request / response types. Types + constants only, zero imports
 * from npm. Private to the admin client + server pair (R1); everything cross-slice lives in `@shared/core`.
 *
 * FIREWALL: no staff payload below carries an author / reporter / user field for anon entity types. `StaffQueueItem`
 * is structurally identical to foundation's `StaffQueueItemCore` (§4.2.14); the admin test file holds the compile-time
 * assignability check in both directions.
 */
import type {
  AppealStatus, ContentEntityType, ContentStatus, EpochMs, Id, ModerationCategory, ModerationPriority, ModerationResult,
  ModerationSeverity, ModerationSurface, PublicUser, ReportReason, Role, SanctionKind, SanctionNotice, SanctionScope,
  UserStatus, UserSummary,
} from './core';

/* ───────────────────────────── queue ───────────────────────────── */

export type QueueView = 'priority' | 'wellbeing' | 'held' | 'auto_hidden' | 'reports' | 'escalated' | 'appeals' | 'mine' | 'closed';

export const QUEUE_VIEWS: readonly { id: QueueView; label: string; adminOnly?: boolean }[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'wellbeing', label: 'Wellbeing' },
  { id: 'held', label: 'Held' },
  { id: 'auto_hidden', label: 'Auto-hidden' },
  { id: 'reports', label: 'Reports' },
  { id: 'escalated', label: 'Escalated', adminOnly: true },
  { id: 'appeals', label: 'Appeals' },
  { id: 'mine', label: 'Mine' },
  { id: 'closed', label: 'Closed' },
];

export type StaffAction =
  | 'approve' | 'remove' | 'remove_and_warn' | 'remove_and_mute_24h' | 'remove_and_mute_72h' | 'remove_and_mute_7d' | 'warn_only'
  | 'dismiss_reports' | 'lock_thread' | 'escalate' | 'escalate_external' | 'suspend_7d' | 'suspend_30d' | 'ban' | 'lift_sanction' | 'restore';

export interface StaffActionDef {
  id: StaffAction;
  label: string;
  /** Short consequence line shown in the ladder sheet. */
  detail: string;
  /** `admin` = admin only (safety §6.1). */
  role: 'mod' | 'admin';
  /** Note ≥ 10 required (safety §6.4). */
  needsNote: boolean;
  /** Renders as a destructive control. */
  destructive?: boolean;
}

/** Ladder order (safety §4.1 / §6.4). */
export const STAFF_ACTIONS: readonly StaffActionDef[] = [
  { id: 'approve', label: 'Approve', detail: 'Content stays up and becomes immune to report-based auto-hide. Reports close as not violating.', role: 'mod', needsNote: false },
  { id: 'dismiss_reports', label: 'Dismiss reports', detail: 'Closes the reports without touching the content.', role: 'mod', needsNote: false },
  { id: 'warn_only', label: 'Warn only', detail: 'Content stays. The author must acknowledge a warning before their next post.', role: 'mod', needsNote: true },
  { id: 'remove', label: 'Remove', detail: 'Content is removed and a strike is recorded. Author and reporters are notified.', role: 'mod', needsNote: true, destructive: true },
  { id: 'remove_and_warn', label: 'Remove + warn', detail: 'Remove, strike, and a warning the author must acknowledge.', role: 'mod', needsNote: true, destructive: true },
  { id: 'remove_and_mute_24h', label: 'Remove + mute 24h', detail: 'Remove, strike, and a 24-hour mute of the author.', role: 'mod', needsNote: true, destructive: true },
  { id: 'remove_and_mute_72h', label: 'Remove + mute 72h', detail: 'Remove, strike, and a 72-hour mute of the author.', role: 'mod', needsNote: true, destructive: true },
  { id: 'remove_and_mute_7d', label: 'Remove + mute 7d', detail: 'Remove, strike, and a 7-day mute of the author.', role: 'mod', needsNote: true, destructive: true },
  { id: 'lock_thread', label: 'Lock thread', detail: 'No new replies on this Buzz thread. Content stays.', role: 'mod', needsNote: true },
  { id: 'escalate', label: 'Escalate to admin', detail: 'Leaves the moderator queues. An admin decides.', role: 'mod', needsNote: true },
  { id: 'restore', label: 'Restore', detail: 'Reverses a removal: content back up, strike revoked, author notified.', role: 'mod', needsNote: true },
  { id: 'suspend_7d', label: 'Suspend 7 days', detail: 'All sessions revoked. Content stays unless removed separately.', role: 'admin', needsNote: true, destructive: true },
  { id: 'suspend_30d', label: 'Suspend 30 days', detail: 'All sessions revoked for 30 days.', role: 'admin', needsNote: true, destructive: true },
  { id: 'ban', label: 'Ban permanently', detail: 'Permanent. The email can never register again. Type BAN to confirm.', role: 'admin', needsNote: true, destructive: true },
  { id: 'lift_sanction', label: 'Lift sanction', detail: 'Lifts the sanction tied to this item.', role: 'admin', needsNote: true },
  { id: 'escalate_external', label: 'Escalate externally', detail: 'Records that an outside authority was contacted; puts the content under legal hold.', role: 'admin', needsNote: true },
];

export interface StaffQueueItem {
  id: Id;
  entityType: ContentEntityType;
  entityId: Id | null;
  surface: ModerationSurface;
  anon: boolean;
  universityShortName: string;
  source: string;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label: string | null;
  status: 'open' | 'claimed' | 'escalated' | 'closed';
  resolution: string | null;
  reportCount: number;
  excerpt: string;
  contentStatus: ContentStatus | null;
  claimedByMe: boolean;
  claimedByOther: boolean;
  slaDueAt: EpochMs;
  createdAt: EpochMs;
  closedAt: EpochMs | null;
}

export interface QueueListQuery {
  view?: QueueView;
  surface?: ModerationSurface;
  category?: ModerationCategory;
  universityId?: Id;
  source?: string;
  /** Closed view: queue id search. */
  q?: string;
  cursor?: string;
  limit?: number;
}

export type QueueCounts = Record<QueueView, number>;

/** Staff view of a sanction: SanctionNotice WITHOUT contentExcerpt/contentLabel (those exist only on GET /me/sanctions), plus origin.
 *  Mirrors foundation's StaffSanctionRowCore (§4.2.14). Anon-origin rows: omitted entirely for moderators; for admins present with day-floored timestamps. */
export interface StaffSanctionRow extends Omit<SanctionNotice, 'contentExcerpt' | 'contentLabel'> {
  origin: 'public' | 'anon';
}

/** Public entity types ONLY; values from staffStandingFor(). */
export interface StaffAuthorPanel {
  kind: 'public';
  user: UserSummary;
  accountAgeDays: number;
  strikePoints: number;
  sanctions: StaffSanctionRow[];
}

export interface StaffBlindAuthorPanel {
  kind: 'blind';
  accountAge: '<24h' | '<7d' | '<30d' | '30d+';
  strikePoints: string;
  priorByCategory: Record<string, string>;
  sanction: SanctionKind | null;
  otherOpenItems: string;
}

export interface StaffQueueItemDetail extends StaffQueueItem {
  fields: { field: string; text: string; spans: [number, number][] }[];
  media: { url: string; kind: 'image' | 'video' }[];
  ruleHits: { ruleId: string; category: ModerationCategory; subcode: string; severity: ModerationSeverity }[];
  signals: ModerationResult['signals'] | null;
  aiVerdict: unknown | null;
  /** adapter.staffContext — Buzz: the blind serializer's thread context; messages: the reported window. */
  context: unknown | null;
  reports: {
    id: Id;
    reason: ReportReason;
    subReason: string | null;
    note: string | null;
    reporterTrust: 'high' | 'normal' | 'low';
    /** Admin only, audited (`reporter_viewed`). */
    reporter: UserSummary | null;
    createdAt: EpochMs;
  }[];
  history: { action: string; actorRole: Role; actorName: string | null; note: string | null; createdAt: EpochMs }[];
  author: StaffAuthorPanel | StaffBlindAuthorPanel;
  suggestion: { action: StaffAction; reason: string } | null;
  canUnmask: boolean;
}

export interface StaffActionRequest {
  action: StaffAction;
  category: ModerationCategory;
  note?: string;
  /** `escalate_external`: the outside reference number. */
  reference?: string;
  /** `ban`: the literal 'BAN'. */
  confirmText?: string;
  /** `dismiss_reports`: mark the reports as bad faith (lowers reporter trust). */
  badFaith?: boolean;
}

export type BulkAction = Extract<StaffAction, 'approve' | 'remove' | 'dismiss_reports'>;

export interface BulkActionRequest {
  /** ≤ 50 ids. */
  ids: Id[];
  action: BulkAction;
  category: ModerationCategory;
  note?: string;
}

export interface BulkActionResponse {
  results: { id: Id; ok: boolean; error?: string }[];
  batchId: Id;
}

/* ───────────────────────────── unmask ───────────────────────────── */

export const UNMASK_REASON_CODES = ['credible_threat', 'self_harm_emergency', 'child_safety', 'severe_repeat_harassment', 'legal_request', 'ban_evasion'] as const;
export type UnmaskReasonCode = (typeof UNMASK_REASON_CODES)[number];

export const UNMASK_REASON_LABELS: Record<UnmaskReasonCode, string> = {
  credible_threat: 'Credible threat',
  self_harm_emergency: 'Self-harm emergency',
  child_safety: 'Child safety',
  severe_repeat_harassment: 'Severe or repeated harassment',
  legal_request: 'Valid legal request',
  ban_evasion: 'Ban evasion',
};

export const UNMASK_REASON_MIN = 30;
/** The identity stays on screen for 5 minutes, then re-masks (product §2.11). */
export const UNMASK_VISIBLE_MS = 5 * 60_000;

export interface UnmaskRequest {
  reasonCode: UnmaskReasonCode;
  /** ≥ 30 chars. */
  reason: string;
  confirmText: 'UNMASK';
  caseRef?: string;
}

export interface UnmaskResponse {
  user: { id: Id; handle: string; displayName: string; email: string; universityId: Id };
  /** The `buzz_unmask` audit row id. */
  unmaskId: Id;
  /** now + 5 min, UI re-mask. */
  expiresAt: EpochMs;
}

/* ───────────────────────────── audit ───────────────────────────── */

export interface AuditRow {
  id: Id;
  actor: { id: Id; displayName: string; role: Role } | null;
  action: string;
  targetType: string | null;
  /** null for targetType 'user' rows tied to an anon-origin queue item, except action 'buzz_unmask' for admins — serializeAuditRow, §4.2.14 */
  targetId: Id | null;
  queueId: Id | null;
  batchId: Id | null;
  reasonCode: string | null;
  reason: string | null;
  /** stripped for moderators on buzz_unmask */
  metadata: Record<string, unknown> | null;
  createdAt: EpochMs;
}

export interface AuditQuery {
  actor?: Id;
  action?: string;
  targetType?: string;
  from?: EpochMs;
  to?: EpochMs;
  cursor?: string;
  limit?: number;
}

/* ───────────────────────────── users ───────────────────────────── */

export interface StaffUserDetail {
  user: PublicUser;
  /** admin only */
  email: string | null;
  role: Role;
  status: UserStatus;
  /** moderators: public-origin strikes only */
  strikePoints: number;
  sanctions: StaffSanctionRow[];
  /** moderators: public-origin items only */
  openQueueItems: number;
}

export interface StaffRoleRequest {
  role: Role;
}
export interface StaffVerifyRequest {
  verified: boolean;
}
export interface StaffSanctionRequest {
  kind: SanctionKind;
  durationMs?: number;
  scope?: SanctionScope;
  category: ModerationCategory;
  /** ≥ 10 chars. */
  note: string;
}
export interface LiftSanctionRequest {
  note: string;
}

export const SANCTION_KIND_LABELS: Record<SanctionKind | 'removal', string> = {
  warning: 'Warning',
  mute: 'Mute',
  suspension: 'Suspension',
  ban: 'Ban',
  removal: 'Removal',
};

/** Direct sanction presets (safety §4.1). Moderators may apply the first four. */
export const DIRECT_SANCTION_PRESETS: readonly { id: string; label: string; kind: SanctionKind; durationMs: number | null; adminOnly: boolean }[] = [
  { id: 'warning', label: 'Warning', kind: 'warning', durationMs: null, adminOnly: false },
  { id: 'mute_24h', label: 'Mute 24h', kind: 'mute', durationMs: 24 * 60 * 60_000, adminOnly: false },
  { id: 'mute_72h', label: 'Mute 72h', kind: 'mute', durationMs: 72 * 60 * 60_000, adminOnly: false },
  { id: 'mute_7d', label: 'Mute 7 days', kind: 'mute', durationMs: 7 * 24 * 60 * 60_000, adminOnly: false },
  { id: 'suspend_7d', label: 'Suspend 7 days', kind: 'suspension', durationMs: 7 * 24 * 60 * 60_000, adminOnly: true },
  { id: 'suspend_30d', label: 'Suspend 30 days', kind: 'suspension', durationMs: 30 * 24 * 60 * 60_000, adminOnly: true },
  { id: 'ban', label: 'Ban', kind: 'ban', durationMs: null, adminOnly: true },
];

/* ───────────────────────────── appeals ───────────────────────────── */

/** Appeals are reviewed BLIND: no user field, ever. For origin 'anon' the row carries the appealed content (so it can be judged) but `sanction.id` is replaced by the
 *  appeal id and timestamps are day-floored, so it cannot be joined with /admin/users; the reviewer decides on content + appeal text alone. */
export interface StaffAppeal {
  id: Id;
  sanction: StaffSanctionRow;
  contentExcerpt: string | null;
  contentLabel: string | null;
  text: string;
  status: AppealStatus;
  createdAt: EpochMs;
  queueId: Id | null;
  canReview: boolean;
}

export type AppealOutcome = 'upheld' | 'reversed' | 'reduced';

export interface AppealDecisionRequest {
  outcome: AppealOutcome;
  /** ≥ 10 chars. */
  note: string;
  /** `reduced`: the new end time (must be earlier than the current one). */
  reducedUntil?: EpochMs;
}

/* ───────────────────────────── analytics ───────────────────────────── */

export interface AnalyticsQuery {
  from?: EpochMs;
  to?: EpochMs;
  universityId?: Id;
}

export interface AnalyticsOverview {
  range: { from: EpochMs; to: EpochMs };
  signupsByCampus: { universityShortName: string; count: number }[];
  dau: { day: string; count: number }[];
  wau: number;
  activationRate: number;
  contentPerDay: { day: string; surface: string; count: number }[];
  reportsPer1k: number;
  medianTimeToActionMin: number | null;
}

export interface ApartmentsFunnel {
  byCampus: { universityShortName: string; views: number; ctaClicks: number; surveyStarts: number; surveyCompletes: number; waitlist: number }[];
  totals: { views: number; ctaClicks: number; surveyStarts: number; surveyCompletes: number; waitlist: number };
}

export interface ModerationMetrics {
  openByPriority: Record<ModerationPriority, number>;
  oldestOpenMin: number | null;
  timeToFirstAction: Record<ModerationPriority, { medianMin: number | null; p90Min: number | null; slaMin: number }>;
  rulePrecision: { ruleId: string; flagged: number; removed: number; approved: number }[];
  appealOverturnRate: number | null;
  autoHideReversalRate: { reports: number | null; score: number | null };
  activeSanctions: Record<SanctionKind, number>;
  unmasksByReason: Record<string, number>;
  wellbeingPerWeek: number;
}

/* ───────────────────────────── rule packs & limitations ───────────────────────────── */

export interface RulePackRow {
  id: string;
  version: string;
  ruleCount: number;
  enabled: boolean;
}

export interface RulePackPatchRequest {
  enabled: boolean;
}

export type LimitationId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'A1';

/** safety §8.3 known gaps + A1 = single-admin ban confirmation (SPEC §3.3). */
export const LIMITATIONS: { id: LimitationId; title: string; body: string }[] = [
  {
    id: 'G1',
    title: 'No automated image or video classification',
    body: 'The stack has no vision component. Uploaded media is sanitised and size-limited, but what it shows is judged only by reports and human review.',
  },
  {
    id: 'G2',
    title: 'Video container metadata is not stripped',
    body: 'Image metadata is removed on upload; video container metadata (device, location tags) is kept as uploaded.',
  },
  {
    id: 'G3',
    title: 'The rule engine is English-first',
    body: 'Other languages rely on reports and the optional second pass. Rule packs are structured per locale so lists can be added without code changes.',
  },
  {
    id: 'G4',
    title: 'Writing style can still identify people',
    body: 'Stylometry across Buzz threads cannot be technically prevented; the guidelines and the per-thread alias are the mitigation.',
  },
  {
    id: 'G5',
    title: 'Anonymity depends on server integrity',
    body: 'A compromised server with the alias secret and database access defeats anonymity by definition; the author link is stored by Constitutional requirement. Admins who unmask can also correlate an anon-origin sanction with the account it restricts. Mitigation is operational: secret management, least-privilege access and this audit log.',
  },
  {
    id: 'A1',
    title: 'Bans are confirmed by one admin',
    body: 'A second-admin confirmation step is not built in v1. A ban requires the literal confirmation text, a note of at least 30 characters, and is written to the append-only audit log.',
  },
];
