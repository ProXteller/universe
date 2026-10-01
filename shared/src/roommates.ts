/**
 * `roommates` slice contract (SPEC §5.7). Types + constants only; imported as `@shared/roommates` by the slice's
 * client and server halves. Private to the slice — no other slice imports this file (R1).
 */
import type { ContentStatus, EpochMs, Id, MediaImage, UserSummary } from './core';

/* ────────────────────────────── questionnaire ────────────────────────────── */

export const ROOMMATE_QUESTIONS = ['sleep', 'clean', 'noise', 'guests', 'hosting', 'smoking', 'pets', 'sharing'] as const;
export type RoommateQuestion = (typeof ROOMMATE_QUESTIONS)[number];
export type RoommateAnswer = 0 | 1 | 2 | 3;
export type RoommateAnswers = Record<RoommateQuestion, RoommateAnswer>;

export interface QuestionDef {
  title: string;
  /** Short line under the title. */
  hint: string;
  options: [string, string, string, string];
  /** Lifestyle tag for each option (shown on cards, used for "You both…"). */
  tags: [string, string, string, string];
}

export const QUESTION_DEFS: Record<RoommateQuestion, QuestionDef> = {
  sleep: {
    title: 'When do you usually go to sleep?',
    hint: 'On a normal weeknight.',
    options: ['Before 11 pm', 'Around midnight', 'Around 1 am', 'After 2 am'],
    tags: ['early bird', 'early-ish', 'night-ish', 'night owl'],
  },
  clean: {
    title: 'How tidy do you keep shared spaces?',
    hint: 'Kitchen, bathroom, living room.',
    options: ['Lived-in is fine', 'Tidy-ish', 'Pretty tidy', 'Spotless'],
    tags: ['relaxed about mess', 'tidy-ish', 'tidy', 'spotless'],
  },
  noise: {
    title: 'How much noise at home works for you?',
    hint: 'Music, calls, TV in shared rooms.',
    options: ['Library quiet', 'Quiet weeknights', 'Some noise is fine', 'Lively is great'],
    tags: ['library quiet', 'quiet weeknights', 'okay with noise', 'lively home'],
  },
  guests: {
    title: 'How often do you have guests over?',
    hint: 'Friends, study groups, partners.',
    options: ['Rarely', 'A few times a month', 'Weekly', 'Most days'],
    tags: ['rare guests', 'occasional guests', 'weekly guests', 'open door'],
  },
  hosting: {
    title: 'How do you feel about parties at home?',
    hint: 'Hosting, not attending.',
    options: ['Never', 'A couple a semester', 'Monthly', 'As often as possible'],
    tags: ['no parties', 'rare parties', 'monthly parties', 'party host'],
  },
  smoking: {
    title: 'Smoking or vaping?',
    hint: 'Including at home.',
    options: ['Never', 'Rarely, never inside', 'Sometimes, outside', 'Regularly'],
    tags: ['smoke-free', 'rarely smokes', 'smokes outside', 'smoker'],
  },
  pets: {
    title: 'Pets?',
    hint: 'Yours or a roommate’s.',
    options: ['No pets, please', 'Fine with pets', 'Would love a pet', 'I have a pet'],
    tags: ['pet-free', 'pet-friendly', 'wants a pet', 'pet owner'],
  },
  sharing: {
    title: 'Sharing food and stuff?',
    hint: 'Groceries, kitchen gear, the couch.',
    options: ['Everything separate', 'Ask first', 'Share the basics', 'What’s mine is yours'],
    tags: ['keeps things separate', 'asks first', 'shares basics', 'shares everything'],
  },
};

/** Sums to 100 (product's 7 weights + `hosting` split from `guests`). */
export const COMPAT_WEIGHTS: Record<RoommateQuestion, number> = {
  clean: 20, sleep: 20, noise: 15, smoking: 15, guests: 10, pets: 10, hosting: 5, sharing: 5,
};

/** Dealbreaker conflict caps the score here. */
export const COMPAT_CAP = 35;
/** ≥ this gets the one allowed `bouncy` ring pop. */
export const COMPAT_GREAT = 85;

export interface Compatibility {
  pct: number;
  /** A dealbreaker conflict capped the score at COMPAT_CAP. */
  capped: boolean;
  dimensions: { q: RoommateQuestion; similarity: number }[];
  /** Tags where the answers are equal. */
  both: string[];
  /** Questions where |Δ| ≥ 2 (the question's title keyword). */
  differs: string[];
  /** "You both: early birds, very tidy. Differs: guests." */
  sentence: string;
}

/* ────────────────────────────── payloads ────────────────────────────── */

export type RoommateMode = 'need' | 'have';
export type LivingWith = 'anyone' | 'same_gender';
export type RoommateGender = 'woman' | 'man' | 'nonbinary';
export type RoommateSort = 'best' | 'newest' | 'budget';

export const ROOMMATE_MODE_LABEL: Record<RoommateMode, string> = { need: 'Needs a place', have: 'Has a place' };

export interface RoommatePlace {
  rent: number;
  roomType: 'private' | 'shared';
  beds: number;
  baths: number;
  furnished: boolean;
  utilitiesIncluded: boolean;
}

export interface RoommateCard {
  id: Id;
  user: UserSummary;
  firstName: string;
  classLabel: string | null;
  major: string | null;
  mode: RoommateMode;
  budget: number;
  /** 'YYYY-MM'. */
  moveIn: string;
  neighborhoods: string[];
  /** 3 lifestyle tags. */
  tags: string[];
  archetype: string;
  coverUrl: string | null;
  /** null when the viewer has no answers. */
  compat: Compatibility | null;
  isNewAccount: boolean;
  lowPriceFlag: boolean;
  saved: boolean;
  createdAt: EpochMs;
}

export interface RoommateDetail extends RoommateCard {
  about: string;
  photos: MediaImage[];
  leaseMonths: number | null;
  livingWith: LivingWith;
  place: RoommatePlace | null;
  answers: RoommateAnswers;
}

export interface MyRoommateProfile extends Omit<RoommateDetail, 'mode' | 'budget' | 'moveIn'> {
  mode: RoommateMode | null;
  budget: number | null;
  /** null only while unpublished. */
  moveIn: string | null;
  status: ContentStatus;
  paused: boolean;
  published: boolean;
  publishedAt: EpochMs | null;
  /** MAX(publishedAt, confirmedAt) is older than 30 days → "Still looking?" */
  needsConfirmation: boolean;
  gender: RoommateGender | null;
  dealbreakSmoking: boolean;
  dealbreakPets: boolean;
}

/**
 * publish:false ("Just browse & match") needs ONLY answers + the two dealbreakers; everything else is optional and may be null.
 * publish:true ("Post that I'm looking") additionally REQUIRES mode, budget, moveIn, neighborhoods (≥ 1), livingWith → else 400 validation_failed.
 */
export interface UpsertRoommateProfileRequest {
  answers: RoommateAnswers;
  dealbreakSmoking: boolean;
  dealbreakPets: boolean;
  publish: boolean;
  mode?: RoommateMode | null;
  budget?: number | null;
  moveIn?: string | null;
  leaseMonths?: number | null;
  neighborhoods?: string[];
  livingWith?: LivingWith;
  gender?: RoommateGender | null;
  about?: string;
  photos?: MediaImage[];
  place?: RoommatePlace | null;
}

export interface RoommateFilters {
  mode?: RoommateMode;
  budgetMin?: number;
  budgetMax?: number;
  /** 'YYYY-MM' — posts moving in on or before this month. */
  moveIn?: string;
  leaseMonths?: number;
  neighborhoods?: string[];
  livingWith?: LivingWith;
  sort?: RoommateSort;
}

export interface MyRoommateProfileResponse {
  profile: MyRoommateProfile | null;
}

export interface SaveResponse {
  saved: boolean;
}

/* ────────────────────────────── limits & copy ────────────────────────────── */

export const ROOMMATE_LIMITS = {
  budgetMin: 100,
  budgetMax: 5000,
  leaseMin: 1,
  leaseMax: 24,
  neighborhoodsMax: 6,
  neighborhoodNameMax: 40,
  bedsMax: 8,
  bathsMax: 6,
} as const;

/** Safety §7.5 final copy. */
export const ROOMMATE_SAFETY = {
  title: 'Before you commit',
  points: [
    'Video call first, then meet in a public place.',
    'Tour the actual unit and confirm the lease with the landlord or housing office.',
    'Never pay a deposit before you’ve seen the place and a written agreement.',
    'Don’t share your SSN, passport, or bank login in chat.',
    'Tell a friend where you’re going.',
    'Trust your gut and report anything off.',
  ],
} as const;

export const ROOMMATE_PHOTO_HINT = 'Avoid photos that show house numbers, mail, or documents.';

/** Month names for 'YYYY-MM' rendering (the client and server each format with these; shared holds no functions). */
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** `moveIn` wire format. */
export const MOVE_IN_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** localStorage key for the persisted Browse filters (`uv:<slice>:` prefix rule). */
export const ROOMMATE_FILTERS_STORAGE_KEY = 'uv:roommates:filters';
