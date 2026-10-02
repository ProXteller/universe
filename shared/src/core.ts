/**
 * UniVerse — foundation contract types & constants.
 * READ-ONLY after the blueprint phase. Types + constants only. ZERO imports.
 * Imported from both sides as `@shared/core`.
 *
 * Rule: cross-slice React components and cross-slice HTTP payloads may only use types from this file
 * (plus primitives). `shared/src/<slice>.ts` types are private to that slice's client+server pair.
 * Anything two slices both need — a payload (MarketSummary) or a constant (MAJORS) — therefore lives HERE.
 */

/* ────────────────────────────── app constants ────────────────────────────── */

export const APP_NAME = 'UniVerse';
/** Wordmark split index: APP_NAME.slice(0, 3) regular + APP_NAME.slice(3) bold, rendered lowercase. */
export const APP_WORDMARK_SPLIT = 3;
export const GUIDELINES_VERSION = '2026-09-01';
export const SESSION_COOKIE = 'uv_session';
export const API_BASE = '/api';
export const WS_PATH = '/ws';
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

/** Text caps enforced by zod BEFORE moderation (server) and by counters (client). */
export const LIMITS = {
  buzzText: 500,
  /** Optional headline on a root buzz. */
  buzzTitle: 100,
  /** Photos on one buzz (or one video instead). */
  buzzImages: 4,
  /** Buzz search query length. */
  buzzSearch: 80,
  buzzReplyText: 500,
  pollOptionText: 60,
  pollMinOptions: 2,
  pollMaxOptions: 4,
  postText: 1000,
  postImages: 4,
  commentText: 500,
  reelCaption: 150,
  reelMaxDurationMs: 60_000,
  /**
   * The ONE tolerance for "≤ 60 s": client pre-check, POST /api/uploads and POST /api/reels all accept
   * duration ≤ reelMaxDurationMs + reelDurationToleranceMs (a clip trimmed to "1:00" often measures 60.2 s)
   * and store min(duration, reelMaxDurationMs).
   */
  reelDurationToleranceMs: 500,
  messageText: 2000,
  messageImages: 4,
  groupTitle: 60,
  listingTitle: 80,
  listingDescription: 1000,
  listingTradeFor: 80,
  listingPhotos: 6,
  roommateAbout: 600,
  roommatePhotos: 6,
  eventTitle: 100,
  eventDescription: 1500,
  displayNameMin: 2,
  displayNameMax: 40,
  handleMin: 3,
  handleMax: 20,
  bio: 160,
  interests: 5,
  reportNote: 500,
  appealText: 1000,
  imageMaxBytes: 8 * 1024 * 1024,
  /** A native 60 s 1080p phone clip is ~100–150 MB. Server uses multer DISK storage for video. */
  videoMaxBytes: 150 * 1024 * 1024,
  maxBlocks: 1000,
} as const;

export const HANDLE_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/* ────────────────────────────── primitives ────────────────────────────── */

/** nanoid(14) for generated rows; seed rows use the fixed ids listed in SPEC §7. */
export type Id = string;
/** Epoch milliseconds. Every timestamp in the API and DB. */
export type EpochMs = number;
/** Opaque pagination cursor (base64url + HMAC tag). Never parse on the client. */
export type Cursor = string;

export interface Paginated<T> {
  items: T[];
  nextCursor: Cursor | null;
}

export interface PageQuery {
  cursor?: Cursor;
  limit?: number;
}

export type FeedScope = 'campus' | 'global';

/* ────────────────────────────── errors ────────────────────────────── */

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media'
  | 'invalid_cursor'
  | 'content_blocked'
  | 'muted'
  | 'suspended'
  | 'banned'
  | 'cannot_message'
  | 'onboarding_required'
  | 'guidelines_required'
  | 'buzz_gate_required'
  | 'email_not_academic'
  | 'email_personal'
  | 'email_disposable'
  | 'email_banned'
  | 'otp_invalid'
  | 'otp_expired'
  | 'otp_locked'
  | 'otp_cooldown'
  /** 503 from POST /api/auth/start: production with no mail provider configured. */
  | 'mail_unavailable'
  | 'signup_token_invalid'
  | 'handle_taken'
  | 'handle_invalid'
  | 'handle_reserved'
  | 'internal';

export interface ApiError {
  code: ApiErrorCode | (string & {});
  message: string;
  details?: unknown;
}

/** Wire shape of every non-2xx response. */
export interface ApiErrorBody {
  error: ApiError;
}

export interface RateLimitedDetails {
  retryAfterSec: number;
}
export interface OtpInvalidDetails {
  attemptsLeft: number;
}
export interface MutedDetails {
  until: EpochMs;
  scope: SanctionScope;
}
export interface SuspendedDetails {
  until: EpochMs | null;
  category: ModerationCategory | null;
}
/** `details` of a 422 content_blocked. */
export interface ContentBlockedDetails {
  messageId: string;
  title: string;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  support: SupportResources | null;
}

/* ────────────────────────────── identity ────────────────────────────── */

export type Role = 'user' | 'moderator' | 'admin';
export type AccountType = 'student' | 'org';
export type UserStatus = 'active' | 'suspended' | 'banned' | 'deleted';
export type ClassKind = 'undergrad' | 'grad' | 'other';

export const ORG_CATEGORIES = [
  'Academic',
  'Cultural',
  'Sports & Rec',
  'Arts & Media',
  'Service',
  'Professional',
  'Greek life',
  'Student government',
  'Other',
] as const;
export type OrgCategory = (typeof ORG_CATEGORIES)[number];

export interface UniversityRef {
  id: Id;
  name: string;
  shortName: string;
}

/** ISO 4217 by ISO 3166-1 alpha-2. Market and Roommates are campus-only, so one currency per campus is enough. */
export const CURRENCY_BY_COUNTRY: Readonly<Record<string, string>> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
  AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', JP: 'JPY', KR: 'KRW', CN: 'CNY', TW: 'TWD', IN: 'INR', PK: 'PKR',
  BD: 'BDT', ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP', VN: 'VND', AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY',
  EG: 'EGP', NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP',
};
export const DEFAULT_CURRENCY = 'USD';

export interface University extends UniversityRef {
  domain: string;
  countryCode: string;
  /** ISO 4217, from CURRENCY_BY_COUNTRY[countryCode] ?? DEFAULT_CURRENCY. */
  currency: string;
  city: string | null;
  /** Real COUNT of active users. */
  memberCount: number;
}

export type PlaceKind = 'meetup' | 'neighborhood' | 'venue';
export interface CampusPlace {
  id: Id;
  kind: PlaceKind;
  name: string;
}

/** The smallest public identity. Safe on every PUBLIC surface. MUST NEVER appear in a Buzz payload. */
export interface UserSummary {
  id: Id;
  handle: string;
  displayName: string;
  avatarUrl: string;
  accountType: AccountType;
  /** Org verified by an admin (gold tick). Always false for students. */
  isVerified: boolean;
  universityId: Id;
  universityShortName: string;
}

export interface ViewerRelation {
  isSelf: boolean;
  isFollowing: boolean;
  isFollowedBy: boolean;
  /** Viewer has blocked this user (profile then renders the "You blocked this account" shell). */
  isBlockedByMe: boolean;
  mutualCount: number;
  /** Up to 3 accounts the viewer follows who follow this user. */
  mutualSample: UserSummary[];
}

export interface PublicUser extends UserSummary {
  bio: string;
  major: string | null;
  classYear: number | null;
  classKind: ClassKind | null;
  pronouns: string | null;
  interests: string[];
  orgCategory: OrgCategory | null;
  university: UniversityRef;
  followerCount: number;
  followingCount: number;
  /** Public Orbit posts (from public_activity). Never includes Buzz. */
  postCount: number;
  reelCount: number;
  /** campus_rank <= 100 at their university. */
  isFoundingMember: boolean;
  /** Account age < 7 days. */
  isNewAccount: boolean;
  createdAt: EpochMs;
  viewer: ViewerRelation;
}

export type WhoCanMessage = 'everyone' | 'campus' | 'following';

export interface UserSettings {
  /** 'safety' is always true server-side and cannot be switched off. */
  notifications: Record<NotificationCategory, boolean>;
  quietHours: { enabled: boolean; startMin: number; endMin: number };
  whoCanMessage: WhoCanMessage;
  showPresence: boolean;
  autoplayVideos: boolean;
  reduceMotion: boolean;
}

export interface OnboardingState {
  profileCompleted: boolean;
  guidelinesAccepted: boolean;
  /** Set by POST /api/me/onboarding/complete (after follow suggestions). */
  completed: boolean;
}

/** Private view of the signed-in user. Only ever returned to that user. */
export interface MeUser extends PublicUser {
  email: string;
  role: Role;
  status: UserStatus;
  isAdult: boolean | null;
  inviteCode: string;
  invitedBy: UserSummary | null;
  onboarding: OnboardingState;
  guidelinesAcceptedVersion: string | null;
  buzzGateAcceptedVersion: string | null;
  settings: UserSettings;
  activeSanction: ActiveSanction | null;
  handleChangeAvailableAt: EpochMs | null;
  /** ISO 4217 of the user's campus. Every price the client renders goes through formatPrice(n, currency). */
  currency: string;
}

export interface Badges {
  notifications: number;
  messages: number;
  requests: number;
}

/* ────────────────────────────── auth ────────────────────────────── */

export type DomainStatus = 'known' | 'new' | 'personal' | 'disposable' | 'invalid';
export interface DomainLookupResponse {
  status: DomainStatus;
  domain: string;
  university: UniversityRef | null;
  /** Friendly copy for non-accepted statuses. */
  message: string | null;
}

export interface AuthStartRequest {
  email: string;
  inviteCode?: string;
}
export interface AuthStartResponse {
  email: string;
  university: UniversityRef & { isNew: boolean };
  expiresAt: EpochMs;
  resendAvailableAt: EpochMs;
  /** Non-production with no mail provider only. */
  devCode?: string;
}

export interface AuthVerifyRequest {
  email: string;
  code: string;
}
export type AuthVerifyResponse =
  | { status: 'signed_in'; user: MeUser }
  | {
      status: 'needs_profile';
      signupToken: string;
      email: string;
      university: UniversityRef & { isNew: boolean };
      suggested: { displayName: string; handle: string };
      expiresAt: EpochMs;
    };

export interface AuthCompleteRequest {
  signupToken: string;
  displayName: string;
  handle: string;
  accountType: AccountType;
  /**
   * Answer to the REQUIRED two-option question "Are you 18 or older? Yes / No" (no default; Continue is disabled
   * until answered). Never rendered as a pre-unchecked checkbox. Editable once later via PATCH /api/me.
   */
  isAdult: boolean;
  classYear?: number | null;
  classKind?: ClassKind | null;
  major?: string | null;
  bio?: string;
  orgCategory?: OrgCategory | null;
  /** DiceBear seed chosen with "Shuffle". Photo upload happens after sign-in via PATCH /api/me. */
  avatarSeed?: string;
  inviteCode?: string;
}
export interface AuthCompleteResponse {
  user: MeUser;
}

/* ── optional password sign-in (DECISIONS D9) ── */

/** Password length bounds (characters). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export interface PasswordLoginRequest {
  email: string;
  password: string;
}
/**
 * `signed_in` → session cookie set. `code_required` → two-factor is on: a 6-digit code was emailed; finish with
 * POST /auth/password/verify. An unknown email, an account without a password and a wrong password all answer the
 * same 401 `password_invalid`.
 */
export type PasswordLoginResponse =
  | { status: 'signed_in'; user: MeUser }
  | {
      status: 'code_required';
      challengeToken: string;
      email: string;
      expiresAt: EpochMs;
      resendAvailableAt: EpochMs;
      /** Non-production with no mail provider only. */
      devCode?: string;
    };
export interface PasswordCodeRequest {
  challengeToken: string;
  code: string;
}
export interface PasswordCodeResendRequest {
  challengeToken: string;
}
export interface PasswordCodeResendResponse {
  expiresAt: EpochMs;
  resendAvailableAt: EpochMs;
  devCode?: string;
}

/** GET /me/security — never contains the hash. */
export interface SecuritySettings {
  hasPassword: boolean;
  /** Password sign-ins also need an emailed code. Only possible with a password. */
  twoFactor: boolean;
  passwordSetAt: EpochMs | null;
}
/** PUT /me/password — `currentPassword` is required when a password already exists. */
export interface SetPasswordRequest {
  currentPassword?: string;
  newPassword: string;
}
/** PUT /me/two-factor */
export interface TwoFactorRequest {
  enabled: boolean;
  currentPassword: string;
}
/** DELETE /me/password — back to email-code sign-in only (two-factor turns off with it). */
export interface RemovePasswordRequest {
  currentPassword: string;
}

export interface HandleAvailabilityResponse {
  handle: string;
  available: boolean;
  reason: 'taken' | 'invalid' | 'reserved' | null;
  suggestions: string[];
}

export interface InvitePreview {
  code: string;
  inviter: UserSummary;
  universityName: string;
}

export interface InviteStats {
  code: string;
  url: string;
  joinedCount: number;
  joined: UserSummary[];
}

export interface UpdateMeRequest {
  displayName?: string;
  handle?: string;
  bio?: string;
  major?: string | null;
  classYear?: number | null;
  classKind?: ClassKind | null;
  pronouns?: string | null;
  interests?: string[];
  orgCategory?: OrgCategory | null;
  /** A URL returned by POST /api/uploads (kind 'avatar'), or null to go back to the generated avatar. */
  avatarUrl?: string | null;
  avatarSeed?: string;
  isAdult?: boolean;
}

export type GuidelinesKind = 'app' | 'buzz';
export interface AcceptGuidelinesRequest {
  kind: GuidelinesKind;
  version: string;
}

/* ────────────────────────────── follow / block ────────────────────────────── */

export interface FollowResult {
  userId: Id;
  isFollowing: boolean;
  followerCount: number;
}
export interface BlockResult {
  userId: Id;
  isBlocked: boolean;
  /** Group/course conversations shared with the blocked user (client offers "Leave group"). */
  sharedGroupConversationIds: Id[];
}
export interface BlockedUserRow {
  user: UserSummary;
  blockedAt: EpochMs;
}

/** Row of follower/following lists, user search, RSVP lists, likers — any PUBLIC list of people. */
export interface UserListItem extends UserSummary {
  bio: string;
  major: string | null;
  classYear: number | null;
  isNewAccount: boolean;
  viewer: Pick<ViewerRelation, 'isSelf' | 'isFollowing' | 'isFollowedBy'>;
}

export interface UserSearchQuery extends PageQuery {
  q: string;
  type?: 'all' | AccountType;
  /** 'campus' restricts to the viewer's university. Default 'global' with campus results first. */
  scope?: FeedScope;
}

/** Kinds written by `markPublicActivity()`. Buzz is structurally absent. */
export type PublicActivityKind = 'reel' | 'post' | 'event';

export interface DeleteAccountRequest {
  /** Must be the literal string 'DELETE'. */
  confirm: 'DELETE';
}

export type UpdateSettingsRequest = {
  notifications?: Partial<Record<NotificationCategory, boolean>>;
  quietHours?: Partial<UserSettings['quietHours']>;
  whoCanMessage?: WhoCanMessage;
  showPresence?: boolean;
  autoplayVideos?: boolean;
  reduceMotion?: boolean;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  notifications: {
    follows: true, replies: true, likes: true, messages: true, marketplace: true,
    roommates: true, events: true, buzz: true, safety: true, system: true,
  },
  quietHours: { enabled: true, startMin: 23 * 60, endMin: 8 * 60 },
  whoCanMessage: 'everyone',
  showPresence: true,
  autoplayVideos: true,
  reduceMotion: false,
};

/* ────────────────────────────── appeals (user side; staff side lives in shared/src/admin.ts) ───────────── */

export interface CreateAppealRequest {
  sanctionId: Id;
  text: string;
}
export interface AppealReceipt {
  id: Id;
  sanctionId: Id;
  status: Exclude<AppealStatus, 'none'>;
  createdAt: EpochMs;
}

/* ────────────────────────────── uploads ────────────────────────────── */

export type UploadKind = 'image' | 'video' | 'avatar';
/**
 * Accepted upload types. 'video/quicktime' = iOS .mov (the iPhone picker hands the browser a .MOV); it is probed with
 * the MP4 mvhd parser, stored as .mp4 and SERVED as 'video/mp4' — so UploadResult.mime is never 'video/quicktime'.
 */
export type UploadMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/webm';

export interface UploadResult {
  id: Id;
  /** Always `/uploads/<nanoid21>.<ext>`. */
  url: string;
  kind: 'image' | 'video';
  mime: Exclude<UploadMime, 'video/quicktime'>;
  size: number;
  width: number | null;
  height: number | null;
  /** Videos: min(measured, LIMITS.reelMaxDurationMs). */
  durationMs: number | null;
}

/** Image reference stored inside posts/listings/messages (JSON columns). */
export interface MediaImage {
  url: string;
  width: number | null;
  height: number | null;
  alt?: string;
}

/* ────────────────────────────── moderation (safety.md §2.8, binding) ────────────────────────────── */

export type ModerationSurface =
  | 'buzz' | 'buzz_reply' | 'buzz_poll'
  | 'orbit_post' | 'comment' | 'reel_caption' | 'event' | 'profile' | 'handle' | 'group_name'
  | 'market_listing' | 'roommate_listing'
  | 'message' | 'group_message'
  | 'report_note' | 'appeal';

export type ModerationSurfaceGroup = 'anon' | 'public' | 'commerce' | 'private' | 'staff';

export const SURFACE_GROUP: Record<ModerationSurface, ModerationSurfaceGroup> = {
  buzz: 'anon', buzz_reply: 'anon', buzz_poll: 'anon',
  orbit_post: 'public', comment: 'public', reel_caption: 'public', event: 'public',
  profile: 'public', handle: 'public', group_name: 'public',
  market_listing: 'commerce', roommate_listing: 'commerce',
  message: 'private', group_message: 'private',
  report_note: 'staff', appeal: 'staff',
};

export type ModerationCategory =
  | 'threat_violence' | 'harassment_bullying' | 'hate'
  | 'sexual_minors' | 'sexual_explicit'
  | 'drugs_illegal_sales' | 'self_harm'
  | 'pii_doxxing' | 'named_accusation' | 'impersonation'
  | 'spam_scam' | 'academic_dishonesty' | 'profanity';

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ModerationAction = 'allow' | 'flag' | 'block';
export type ModerationPriority = 'p0' | 'p1' | 'p2' | 'p3';
/** Canonical status column of EVERY UGC table. */
export type ContentStatus = 'active' | 'held' | 'hidden' | 'removed' | 'deleted';
export type RecipientBanner = 'B-SCAM' | 'B-OFFPLATFORM' | 'B-STAFF-IMPERSONATION' | 'B-SEXUAL';

export const GUIDELINE_ANCHORS: Record<ModerationCategory, string> = {
  threat_violence: '#threats',
  harassment_bullying: '#harassment',
  hate: '#hate',
  sexual_minors: '#sexual',
  sexual_explicit: '#sexual',
  drugs_illegal_sales: '#drugs',
  self_harm: '#self-harm',
  pii_doxxing: '#private-info',
  named_accusation: '#private-info',
  impersonation: '#impersonation',
  spam_scam: '#spam',
  academic_dishonesty: '#academic',
  profanity: '#harassment',
};

export const CATEGORY_LABELS: Record<ModerationCategory, string> = {
  threat_violence: 'Threats & violence',
  harassment_bullying: 'Harassment & bullying',
  hate: 'Hate',
  sexual_minors: 'Sexual content & minors',
  sexual_explicit: 'Sexual content',
  drugs_illegal_sales: 'Drugs & illegal sales',
  self_harm: 'Self-harm & suicide',
  pii_doxxing: 'Private info & doxxing',
  named_accusation: 'Naming people',
  impersonation: 'Impersonation',
  spam_scam: 'Spam & scams',
  academic_dishonesty: 'Academic dishonesty',
  profanity: 'Profanity',
};

export interface ModerationContext {
  surface: ModerationSurface;
  /** Which field of the entity this text is (for queue display). Default 'body'. */
  field?: 'title' | 'body' | 'option' | 'name' | 'bio' | 'handle';
  /** Author. Used for account modifiers and events only; never copied into the result. */
  userId: Id;
  role: Role;
  accountType: AccountType;
  accountAgeMs: number;
  activeStrikePoints: number;
  universityId: Id;
  /** ISO 3166-1 alpha-2 of the author's university; selects crisis resources. */
  countryCode?: string;
  /** PRIVATE surfaces: true when this is the first message of a not-yet-accepted request. */
  isMessageRequest?: boolean;
  /** Supplied by moderateWrite(); folded-text hashes of this user's writes in the last 10 min. */
  recentHashes?: readonly string[];
}

export interface ModerationMatch {
  ruleId: string;
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  /** [start, end) offsets into the ORIGINAL text. Staff-only; never sent to the author. */
  span: [number, number];
  view: 'canonical' | 'folded' | 'spaced' | 'squashed' | 'original';
}

export interface SupportResources {
  kind: 'self_harm';
  headline: string;
  body: string;
  lines: Array<{ label: string; detail: string; href: string }>;
  emergencyNote: string;
}

export interface ModerationUserMessage {
  id: string;
  title: string;
  body: string;
  guidelineAnchor: string | null;
}

export interface ModerationResult {
  action: ModerationAction;
  visibility: 'visible' | 'held';
  /** Status the caller MUST persist with: allow→'active', flag→'active'|'held'. Undefined for block. */
  persistStatus?: Extract<ContentStatus, 'active' | 'held'>;
  category: ModerationCategory | null;
  subcode: string | null;
  severity: ModerationSeverity;
  /** Staff-only. MUST NOT be serialized to non-staff clients. */
  matches: ModerationMatch[];
  escalate: boolean;
  priority: ModerationPriority | null;
  privateFlag: boolean;
  userMessage: ModerationUserMessage | null;
  support: SupportResources | null;
  recipientBanner: RecipientBanner | null;
  signals: {
    evasion: boolean;
    invisibleChars: number;
    homoglyphs: number;
    urls: number;
    mentions: number;
    capsRatio: number;
    hasFullName: boolean;
  };
  engine: { version: string; rulePacks: string[]; elapsedMs: number };
}

/** The ONLY moderation data a non-staff client may receive (from `toAuthorNotice`). */
export interface AuthorNotice {
  status: Extract<ContentStatus, 'active' | 'held'>;
  userMessage: ModerationUserMessage | null;
  support: SupportResources | null;
}

/** Every UGC create/update response is `WithModeration<Resource>`. */
export type WithModeration<T> = T & { moderation: AuthorNotice };

/* ────────────────────────────── content registry / reports ────────────────────────────── */

/**
 * One name per reportable / moderatable entity, used EVERYWHERE: reports.entity_type, mod_queue.entity_type,
 * moderation_events.entity_type, ModerationTarget.entityType, content registry keys.
 * (Deviation from safety.md: its single 'comment' is split into 'orbit_comment' | 'reel_comment' because the two
 * live in different slices' tables. Both use ModerationSurface 'comment'.)
 */
export type ContentEntityType =
  | 'buzz' | 'buzz_reply'
  | 'orbit_post' | 'orbit_comment'
  | 'reel' | 'reel_comment'
  | 'message' | 'conversation'
  | 'market_listing' | 'roommate_listing'
  | 'event' | 'profile';

export type ReportTargetType = ContentEntityType;

export const ANON_ENTITY_TYPES: readonly ContentEntityType[] = ['buzz', 'buzz_reply'];

/** Owner slice of each entity type (who registers the ContentAdapter). */
export const ENTITY_OWNER: Record<ContentEntityType, string> = {
  buzz: 'buzz', buzz_reply: 'buzz',
  orbit_post: 'orbit', orbit_comment: 'orbit',
  reel: 'reels', reel_comment: 'reels',
  message: 'foundation', conversation: 'foundation', profile: 'foundation',
  market_listing: 'market', roommate_listing: 'roommates',
  event: 'campus',
};

export type ReportReason =
  | 'self_harm' | 'threat' | 'minor_safety' | 'doxxing' | 'harassment' | 'hate' | 'sexual'
  | 'drugs_illegal' | 'impersonation' | 'spam_scam' | 'academic_dishonesty' | 'other';

export interface ReportReasonDef {
  id: ReportReason;
  label: string;
  priority: ModerationPriority;
  category: ModerationCategory | null;
  noteRequired: boolean;
}

/** Order is the order shown in the ReportSheet. */
export const REPORT_REASONS: readonly ReportReasonDef[] = [
  { id: 'self_harm', label: "I'm worried about this person", priority: 'p0', category: 'self_harm', noteRequired: false },
  { id: 'threat', label: 'Threat or violence', priority: 'p0', category: 'threat_violence', noteRequired: false },
  { id: 'minor_safety', label: 'Involves a minor', priority: 'p0', category: 'sexual_minors', noteRequired: false },
  { id: 'doxxing', label: 'Shares private info', priority: 'p1', category: 'pii_doxxing', noteRequired: false },
  { id: 'harassment', label: 'Harassment or bullying', priority: 'p1', category: 'harassment_bullying', noteRequired: false },
  { id: 'hate', label: 'Hate', priority: 'p1', category: 'hate', noteRequired: false },
  { id: 'sexual', label: 'Sexual content or unwanted advances', priority: 'p1', category: 'sexual_explicit', noteRequired: false },
  { id: 'drugs_illegal', label: 'Drugs or illegal sales', priority: 'p2', category: 'drugs_illegal_sales', noteRequired: false },
  { id: 'impersonation', label: 'Pretending to be someone', priority: 'p2', category: 'impersonation', noteRequired: false },
  { id: 'spam_scam', label: 'Spam or scam', priority: 'p2', category: 'spam_scam', noteRequired: false },
  { id: 'academic_dishonesty', label: 'Cheating or academic dishonesty', priority: 'p3', category: 'academic_dishonesty', noteRequired: false },
  { id: 'other', label: 'Something else', priority: 'p3', category: null, noteRequired: true },
] as const;

/** Extra sub-choices shown when reason = 'spam_scam' on a market_listing / roommate_listing. */
export const LISTING_REPORT_SUBREASONS = [
  { id: 'scam_fake', label: 'Scam or fake listing' },
  { id: 'prohibited_item', label: 'Prohibited item' },
  { id: 'sold_misleading', label: 'Already sold / misleading' },
] as const;
export type ListingReportSubReason = (typeof LISTING_REPORT_SUBREASONS)[number]['id'];

export interface CreateReportRequest {
  entityType: ReportTargetType;
  entityId: Id;
  reason: ReportReason;
  subReason?: ListingReportSubReason;
  note?: string;
  /** entityType 'message' | 'conversation' only: attach the reported message + up to 10 preceding ones. */
  includeContext?: boolean;
}
export interface ReportReceipt {
  id: Id;
  entityType: ReportTargetType;
  entityId: Id;
  reason: ReportReason;
  createdAt: EpochMs;
  /** True when this call returned an existing report (idempotent repeat). */
  alreadyReported: boolean;
}

/** What client code passes to `openReport()`. */
export interface ReportTarget {
  entityType: ReportTargetType;
  entityId: Id;
  /** Public author, if any → the confirmation step offers Block. MUST be omitted for Buzz. */
  author?: UserSummary | null;
  /** Called after a successful report so the caller can drop the item from its list. */
  onReported?: () => void;
}

/* ────────────────────────────── sanctions ────────────────────────────── */

export type SanctionKind = 'warning' | 'mute' | 'suspension' | 'ban';
export type SanctionScope = 'all' | 'buzz_only' | 'requests';
export type AppealStatus = 'none' | 'open' | 'upheld' | 'reversed' | 'reduced';

export interface ActiveSanction {
  id: Id;
  kind: Exclude<SanctionKind, 'warning'>;
  scope: SanctionScope;
  category: ModerationCategory | null;
  until: EpochMs | null;
  canAppeal: boolean;
  appealStatus: AppealStatus;
}

/**
 * Row of GET /api/me/sanctions: everything the affected user is entitled to see about their own account.
 * FIREWALL: this type (it quotes the user's own content, possibly a buzz) is returned ONLY to that user by
 * GET /api/me/sanctions. Staff payloads MUST NOT reuse it — they use StaffSanctionRow (shared/src/admin.ts),
 * which has no contentExcerpt/contentLabel; a named account next to Buzz text is an unmask.
 */
export interface SanctionNotice {
  id: Id;
  kind: SanctionKind | 'removal';
  scope: SanctionScope;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  /** The user's own content, quoted back, max 140 chars. */
  contentExcerpt: string | null;
  contentLabel: string | null;
  startsAt: EpochMs;
  until: EpochMs | null;
  acknowledgedAt: EpochMs | null;
  canAppeal: boolean;
  appealStatus: AppealStatus;
  appealDeadline: EpochMs | null;
  createdAt: EpochMs;
}

/* ────────────────────────────── share / context cards ────────────────────────────── */

export type ShareCardKind = 'listing' | 'roommate' | 'reel' | 'post' | 'event' | 'buzz' | 'profile' | 'course';
/** Kinds that may be PINNED to a DM as its context (opened from Marketplace / Roommates). */
export type ContextCardKind = Extract<ShareCardKind, 'listing' | 'roommate'>;

export interface ShareCardRef {
  kind: ShareCardKind;
  id: Id;
}
export interface ContextCardRef {
  kind: ContextCardKind;
  id: Id;
}

export type ShareCardStatus = 'available' | 'sold' | 'returned' | 'paused' | 'cancelled' | 'ended' | 'unavailable';

/**
 * Resolved LIVE at read time by the owning slice's registered card resolver (a sold listing shows "Sold").
 * kind 'buzz': title = text snippet, subtitle = "Buzz · {university shortName}"; ownerId MUST be null and the
 * card MUST NOT carry alias / isOp / isMine.
 */
export interface ShareCard extends ShareCardRef {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  /** In-app route, e.g. `/market/abc`. */
  href: string;
  status: ShareCardStatus;
  /** Whole units of `currency` (listing price / roommate budget). */
  price: number | null;
  /** ISO 4217 of the owner's campus; filled by foundation `resolveCard`, not by slice resolvers. */
  currency: string;
  /** Short chip text, e.g. "FREE", "92% match", "Sold". */
  badge: string | null;
  /** Public owner (seller, roommate poster, host, author). ALWAYS null for kind 'buzz'. */
  ownerId: Id | null;
  /** Campus meetup spot (listings) — feeds the chat quick replies. */
  meetupSpot: string | null;
}

/** The context card type used when Marketplace / Roommates open a DM. */
export type ContextCard = ShareCard & { kind: ContextCardKind };

export interface OpenDmRequest {
  userId: Id;
  context?: ContextCardRef;
}
export interface OpenDmResponse {
  conversationId: Id;
  created: boolean;
}

/** POST /api/share — send one card into up to 10 conversations the viewer is an active member of. */
export interface ShareRequest {
  card: ShareCardRef;
  conversationIds: Id[];
  text?: string;
}
export interface ShareResponse {
  sent: number;
  failedConversationIds: Id[];
}

/* ────────────────────────────── conversations & messages (core tables; routes owned by `messages`) ───── */

export type ConversationKind = 'dm' | 'group' | 'course';
/**
 * Viewer's membership state. 'request' = waiting in MY Requests tab; 'active' = in Chats.
 * The sender of a pending request is 'active' and sees `requestPending: true`.
 */
export type MemberState = 'active' | 'request' | 'declined' | 'left';
export type MessageKind = 'text' | 'image' | 'card' | 'offer' | 'system';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';
export const MESSAGE_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTIONS)[number];

export interface MessageOffer {
  listingId: Id;
  amount: number;
  /** ISO 4217 of the listing's campus (filled by foundation). */
  currency: string;
  status: OfferStatus;
}

export interface MessageReaction {
  emoji: MessageReactionEmoji;
  count: number;
  mine: boolean;
}

export interface Message {
  id: Id;
  conversationId: Id;
  /** null for kind 'system'. */
  sender: UserSummary | null;
  kind: MessageKind;
  /** '' when deleted. */
  text: string;
  images: MediaImage[];
  /** True while the conversation is an unaccepted request: images are withheld ("Accept to view photos"). */
  imagesWithheld: boolean;
  card: ShareCard | null;
  offer: MessageOffer | null;
  reactions: MessageReaction[];
  replyToId: Id | null;
  /** Echo of the client's optimistic temp id (only to the sender). */
  clientId: string | null;
  /** Safety banner for the RECIPIENT only (null for the sender). */
  banner: RecipientBanner | null;
  /** Group/course chats: sender is blocked by/has blocked the viewer → render collapsed. */
  collapsedByBlock: boolean;
  deleted: boolean;
  createdAt: EpochMs;
}

export interface MessagePreview {
  id: Id;
  kind: MessageKind;
  /** Already humanised server-side: "Photo", "Offer: $40" (campus currency), "Shared a listing", or the text (≤ 120 chars). */
  text: string;
  senderId: Id | null;
  senderName: string | null;
  createdAt: EpochMs;
}

/**
 * Built by foundation from conversations.course_id / course_code / course_title / course_term, which
 * `createCourseConversation({ …, code, title, term })` stores. Foundation never reads the campus slice's tables.
 */
export interface CourseChatMeta {
  courseId: Id;
  /** Normalised code, e.g. "CS 314". Equals ConversationSummary.title for course chats. */
  code: string;
  /** Course name, e.g. "Data Structures". */
  title: string;
  term: string;
}

export interface ConversationSummary {
  id: Id;
  kind: ConversationKind;
  /** DM: peer display name. Group: title or joined first names. Course: "CS 314". */
  title: string;
  avatarUrl: string | null;
  /** DM only. */
  peer: UserSummary | null;
  /** Up to 4 members for avatar stacks (never includes the viewer unless alone). */
  memberPreview: UserSummary[];
  memberCount: number;
  state: MemberState;
  /** Viewer sent a request the peer has not accepted yet. */
  requestPending: boolean;
  context: ContextCard | null;
  /** "About your listing" | "About your roommate post" | null. */
  contextLabel: string | null;
  course: CourseChatMeta | null;
  lastMessage: MessagePreview | null;
  unreadCount: number;
  muted: boolean;
  nameLocked: boolean;
  /** DM peer account age < 7 days. */
  peerIsNewAccount: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface SendMessageRequest {
  kind: Exclude<MessageKind, 'system'>;
  text?: string;
  images?: MediaImage[];
  card?: ShareCardRef;
  offer?: { listingId: Id; amount: number };
  replyToId?: Id;
  clientId?: string;
}

/* ────────────────────────────── notifications ────────────────────────────── */

export type NotificationCategory =
  | 'follows' | 'replies' | 'likes' | 'messages' | 'marketplace' | 'roommates' | 'events' | 'buzz' | 'safety' | 'system';

/** Types whose actor is a real public profile (or the system: actor null). */
export type PublicNotificationType =
  // foundation
  | 'follow.new'
  | 'system.announcement'
  // reels
  | 'reel.like' | 'reel.comment' | 'reel.comment_reply'
  // orbit
  | 'post.like' | 'post.comment' | 'post.comment_reply'
  // messages
  | 'message.request' | 'message.request_accepted' | 'message.group_added'
  // market
  | 'market.offer' | 'market.offer_accepted' | 'market.offer_declined' | 'market.price_drop'
  // roommates
  | 'roommate.still_looking'
  // campus
  | 'event.rsvp' | 'event.reminder' | 'event.cancelled' | 'event.updated' | 'campus.milestone'
  // moderation (foundation + admin). Actor is ALWAYS null (staff are never named).
  | 'mod.report_resolved' | 'mod.content_hidden' | 'mod.content_restored' | 'mod.content_removed'
  | 'mod.warning' | 'mod.muted' | 'mod.suspended' | 'mod.appeal_received' | 'mod.appeal_result'
  | 'admin.unmask_alert';

/** Buzz-origin types. Rows are written with actor_id = NULL; there is no API to attach an actor. */
export type AnonymousNotificationType = 'buzz.reply' | 'buzz.milestone' | 'buzz.poll_closed';

export type NotificationType = PublicNotificationType | AnonymousNotificationType;

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  'follow.new': 'follows',
  'system.announcement': 'system',
  'reel.like': 'likes', 'reel.comment': 'replies', 'reel.comment_reply': 'replies',
  'post.like': 'likes', 'post.comment': 'replies', 'post.comment_reply': 'replies',
  'message.request': 'messages', 'message.request_accepted': 'messages', 'message.group_added': 'messages',
  'market.offer': 'marketplace', 'market.offer_accepted': 'marketplace', 'market.offer_declined': 'marketplace',
  'market.price_drop': 'marketplace',
  'roommate.still_looking': 'roommates',
  'event.rsvp': 'events', 'event.reminder': 'events', 'event.cancelled': 'events', 'event.updated': 'events',
  'campus.milestone': 'events',
  'mod.report_resolved': 'safety', 'mod.content_hidden': 'safety', 'mod.content_restored': 'safety',
  'mod.content_removed': 'safety', 'mod.warning': 'safety', 'mod.muted': 'safety', 'mod.suspended': 'safety',
  'mod.appeal_received': 'safety', 'mod.appeal_result': 'safety', 'admin.unmask_alert': 'safety',
  'buzz.reply': 'buzz', 'buzz.milestone': 'buzz', 'buzz.poll_closed': 'buzz',
};

/** Filter chips of the Notifications screen → categories. */
export const NOTIFICATION_FILTERS = {
  all: null,
  replies: ['replies', 'buzz'],
  follows: ['follows'],
  marketplace: ['marketplace', 'roommates', 'messages'],
  events: ['events'],
} as const;
export type NotificationFilter = keyof typeof NOTIFICATION_FILTERS;

export type NotificationData = Record<string, string | number | boolean | null>;

export interface NotificationTargetRef {
  /** Free-form for non-content targets ('user', 'conversation', 'course', 'sanction', 'university'). */
  entityType: ContentEntityType | 'user' | 'course' | 'sanction' | 'university' | 'report';
  entityId: Id;
}

interface NotificationBase {
  id: Id;
  category: NotificationCategory;
  /** In-app route to open on tap. */
  href: string;
  target: NotificationTargetRef | null;
  /** Small square preview (reel poster, listing photo). Never an avatar. Always null for Buzz. */
  thumbnailUrl: string | null;
  /** Per-type payload; keys are listed per type in SPEC §4.4. Never contains identity for Buzz types. */
  data: NotificationData;
  /** Collapsed rows ("{name} and 12 others liked your reel"): total distinct actors, ≥ 1. */
  actorCount: number;
  read: boolean;
  createdAt: EpochMs;
}

export interface PublicNotification extends NotificationBase {
  type: PublicNotificationType;
  anonymous: false;
  /** Most recent actor; null for system/moderation notices. */
  actor: UserSummary | null;
  /** The viewer (recipient) already follows `actor` → FollowButton.initialFollowing on follow.new rows. False when actor is null. */
  actorFollowedByViewer: boolean;
}

/** Buzz variant: structurally incapable of carrying an actor. Rendered with the mask glyph, never an avatar. */
export interface AnonymousNotification extends NotificationBase {
  type: AnonymousNotificationType;
  anonymous: true;
  actor: null;
}

export type Notification = PublicNotification | AnonymousNotification;

export interface NotificationListResponse extends Paginated<Notification> {
  unreadCount: number;
}
export interface MarkNotificationsReadRequest {
  /** Omit or 'all' → mark everything read. */
  ids?: Id[] | 'all';
}

/* ────────────────────────────── realtime (ws) ────────────────────────────── */

/**
 * Server → client. Buzz events carry ids only (safety L13).
 * Producers (all foundation, lib/conversations.ts): message.new ← sendMessage · message.updated ← setReaction, setOfferStatus ·
 * message.deleted ← deleteMessage · conversation.updated ← updateConversation, acceptRequest, addMember (non-silent) and
 * touchContext(kind, id) — which market / roommates call when a pinned listing / roommate post changes (sold, paused, price…).
 */
export type WsServerEvent =
  | { type: 'hello'; userId: Id; serverTime: EpochMs }
  | { type: 'message.new'; conversationId: Id; message: Message }
  | { type: 'message.updated'; conversationId: Id; message: Message }
  | { type: 'message.deleted'; conversationId: Id; messageId: Id }
  | { type: 'conversation.updated'; conversationId: Id }
  | { type: 'typing'; conversationId: Id; userId: Id; displayName: string; isTyping: boolean }
  | { type: 'read'; conversationId: Id; userId: Id; lastReadMessageId: Id; readAt: EpochMs }
  | { type: 'presence'; userId: Id; online: boolean; lastActiveAt: EpochMs | null }
  | { type: 'notification'; notification: Notification; badges: Badges }
  | { type: 'badges'; badges: Badges }
  | { type: 'buzz.thread_updated'; threadId: Id }
  | { type: 'orbit.new_post' }
  | { type: 'session.revoked'; reason: 'logout' | 'suspended' | 'banned' | 'deleted' };

/** Client → server. */
export type WsClientEvent =
  | { type: 'ping' }
  | { type: 'typing.set'; conversationId: Id; isTyping: boolean }
  | { type: 'conversation.focus'; conversationId: Id | null }
  | { type: 'presence.subscribe'; userIds: Id[] };

export type WsEvent = WsServerEvent;
export type WsEventType = WsServerEvent['type'];
export type WsEventOf<T extends WsEventType> = Extract<WsServerEvent, { type: T }>;

/* ────────────────────────────── analytics ────────────────────────────── */

export type AnalyticsEventName =
  // lifecycle (foundation)
  | 'app_open' | 'screen_view' | 'home_tab_view' | 'share_click' | 'invite_link_copied' | 'invite_link_opened'
  // auth
  | 'signup_started' | 'signup_code_sent' | 'signup_verified' | 'signup_completed' | 'onboarding_step'
  | 'onboarding_completed' | 'login'
  // graph
  | 'follow' | 'unfollow' | 'block' | 'report_submitted'
  // reels
  | 'reel_view' | 'reel_complete' | 'reel_like' | 'reel_comment' | 'reel_upload'
  // orbit
  | 'post_create' | 'post_like' | 'post_comment'
  // buzz — ANONYMOUS: stored with user_id NULL and no entity id (see ANON_ANALYTICS_EVENTS)
  | 'buzz_feed_view' | 'buzz_post' | 'buzz_reply' | 'buzz_vote' | 'buzz_poll_vote' | 'buzz_gate_accepted'
  // discover
  | 'search' | 'profile_view' | 'suggestion_dismiss'
  // messages
  | 'message_send' | 'conversation_open' | 'request_accept' | 'request_decline'
  // roommates
  | 'roommate_profile_publish' | 'roommate_view' | 'roommate_save' | 'roommate_message'
  // market
  | 'listing_create' | 'listing_view' | 'listing_save' | 'listing_message' | 'listing_offer' | 'listing_sold'
  // campus
  | 'event_view' | 'event_rsvp' | 'event_create' | 'course_join' | 'course_create'
  // apartments (engagement funnel — Constitution §0.6)
  | 'apartments.page_view' | 'apartments.dwell' | 'apartments.cta_click' | 'apartments.cta_undo'
  | 'apartments.survey_start' | 'apartments.survey_answer' | 'apartments.survey_complete'
  | 'apartments.share_click' | 'apartments.roommates_crosslink_click';

/** Stored with user_id = NULL, a daily-salted anon hash, campus id, minute-floored time; `entityId` props dropped. */
export const ANON_ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  'buzz_feed_view', 'buzz_post', 'buzz_reply', 'buzz_vote', 'buzz_poll_vote', 'buzz_gate_accepted',
];

/** The ONLY events POST /api/analytics/track stores for a signed-out caller (user_id NULL, university_id NULL). */
export const PRE_AUTH_ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  'app_open', 'signup_started', 'signup_code_sent', 'invite_link_opened',
];

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export interface TrackEventInput {
  name: AnalyticsEventName;
  props?: AnalyticsProps;
  /** Client clock; the server stores its own time and keeps this only as a prop. */
  ts?: EpochMs;
}
export interface TrackRequest {
  events: TrackEventInput[];
}

/* ────────────────────────────── waitlist ────────────────────────────── */

export type WaitlistFeature = 'apartments';
export interface WaitlistState {
  feature: WaitlistFeature;
  joined: boolean;
  joinedAt: EpochMs | null;
  /** Real count of active waitlist rows at the viewer's university. */
  campusCount: number;
  totalCount: number;
}

/* ────────────────────────────── cross-slice payloads & constants ────────────────────────────── */

/** GET /api/market/summary (owner: market). Read by the campus hub's Today strip, hence a core type. Viewer's campus only. */
export interface MarketSummary {
  newListings24h: number;
  activeListings: number;
}

/** Major typeahead (free text is still allowed). Used by auth (profile step) and discover (Edit profile). */
export const MAJORS: readonly string[] = [
  'Accounting', 'Advertising', 'Aerospace Engineering', 'African American Studies', 'Agricultural Science',
  'American Studies', 'Animal Science', 'Anthropology', 'Applied Mathematics', 'Architectural Engineering',
  'Architecture', 'Art History', 'Asian Studies', 'Astronomy', 'Biochemistry', 'Bioengineering', 'Biology',
  'Biomedical Engineering', 'Business Administration', 'Business Analytics', 'Chemical Engineering', 'Chemistry',
  'Civil Engineering', 'Classics', 'Cognitive Science', 'Communication Studies', 'Comparative Literature',
  'Computational Biology', 'Computer Engineering', 'Computer Science', 'Construction Management', 'Criminal Justice',
  'Dance', 'Data Science', 'Dental Hygiene', 'Design', 'Earth Systems', 'Economics', 'Education',
  'Electrical & Computer Engineering', 'Electrical Engineering', 'Elementary Education', 'Engineering Science',
  'English', 'Entrepreneurship', 'Environmental Engineering', 'Environmental Science', 'Exercise Science',
  'Fashion Design', 'Film & TV', 'Finance', 'Food Science', 'French', 'Game Design', 'Gender Studies', 'Geography',
  'Geology', 'German', 'Government', 'Graphic Design', 'Health Sciences', 'History', 'Hospitality Management',
  'Human Development', 'Human Resources', 'Industrial Design', 'Industrial Engineering', 'Information Science',
  'Information Systems', 'Interior Design', 'International Business', 'International Relations', 'Journalism',
  'Kinesiology', 'Latin American Studies', 'Law', 'Linguistics', 'Management', 'Marine Biology', 'Marketing',
  'Materials Science', 'Mathematics', 'Mechanical Engineering', 'Media, Culture & Communication', 'Medicine',
  'Microbiology', 'Middle Eastern Studies', 'Molecular Biology', 'Music', 'Music Performance', 'Neuroscience',
  'Nursing', 'Nutrition', 'Operations Research', 'Petroleum Engineering', 'Pharmacy', 'Philosophy', 'Physics',
  'Political Science', 'Pre-Law', 'Pre-Med', 'Product Design', 'Psychology', 'Public Health', 'Public Policy',
  'Public Relations', 'Radio-TV-Film', 'Real Estate', 'Religious Studies', 'Robotics', 'Social Work', 'Sociology',
  'Software Engineering', 'Spanish', 'Sport Management', 'Statistics', 'Studio Art', 'Supply Chain Management',
  'Sustainability', 'Symbolic Systems', 'Theatre', 'Drama', 'Urban Planning', 'Urban Studies', 'Veterinary Science',
  'Undeclared',
];

/* ────────────────────────────── home ────────────────────────────── */

export const HOME_TABS = ['reels', 'buzz', 'orbit'] as const;
export type HomeTab = (typeof HOME_TABS)[number];
