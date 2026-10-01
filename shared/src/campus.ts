/**
 * `campus` slice contract (SPEC §5.9). Types + constants only, zero imports beyond `@shared/core` types.
 * Private to the campus client + server pair; other slices consume campus only over HTTP / foundation helpers.
 */
import type { ContentStatus, EpochMs, Id, University, UserSummary } from './core';

/* ───────────────────────────── events ───────────────────────────── */

export const EVENT_CATEGORIES = ['academic', 'social', 'sports', 'career', 'arts'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  academic: 'Academic',
  social: 'Social',
  sports: 'Sports',
  career: 'Career',
  arts: 'Arts',
};

export type EventFilter = 'today' | 'week' | 'free_food' | EventCategory;
export const EVENT_FILTERS: readonly EventFilter[] = ['today', 'week', 'free_food', ...EVENT_CATEGORIES];

export type RsvpState = 'going' | 'interested';

/** The 8 preset covers foundation pre-generates at boot (`lib/seedArt.ts`); URL = `${EVENT_COVER_URL_PREFIX}${preset}.svg`. */
export const EVENT_COVER_PRESETS = ['academic', 'social', 'sports', 'career', 'arts', 'food', 'music', 'outdoors'] as const;
export type EventCoverPreset = (typeof EVENT_COVER_PRESETS)[number];
export const EVENT_COVER_URL_PREFIX = '/seed-media/generated/event-covers/';

export const EVENT_COVER_LABELS: Record<EventCoverPreset, string> = {
  academic: 'Academic',
  social: 'Social',
  sports: 'Sports',
  career: 'Career',
  arts: 'Arts',
  food: 'Food',
  music: 'Music',
  outdoors: 'Outdoors',
};

/** Capacity above this needs an account ≥ 7 days old (safety §3.4). */
export const EVENT_LARGE_CAPACITY = 50;
export const EVENT_MAX_CAPACITY = 10_000;
export const EVENT_LOCATION_MAX = 80;
export const EVENT_ADDRESS_MAX = 160;

export interface EventCard {
  id: Id;
  title: string;
  category: EventCategory;
  startsAt: EpochMs;
  endsAt: EpochMs;
  locationName: string;
  coverUrl: string;
  freeFood: boolean;
  host: UserSummary;
  goingCount: number;
  /** ≤ 3 accounts the viewer follows who are going. */
  friendsGoing: UserSummary[];
  myRsvp: RsvpState | null;
  cancelled: boolean;
}

export interface EventDetail extends EventCard {
  description: string;
  /** null unless the address is public or the viewer is going / the host. */
  address: string | null;
  addressPrivate: boolean;
  capacity: number | null;
  isFull: boolean;
  interestedCount: number;
  viewer: { isHost: boolean; isFollowingHost: boolean };
  status: ContentStatus;
  createdAt: EpochMs;
}

export interface UpsertEventRequest {
  title: string;
  description?: string;
  category: EventCategory;
  startsAt: EpochMs;
  endsAt: EpochMs;
  locationName: string;
  address?: string | null;
  addressPrivate?: boolean;
  /** A preset url (`EVENT_COVER_URL_PREFIX…`) or the viewer's own image upload. */
  coverUrl: string;
  freeFood: boolean;
  capacity?: number | null;
}

export type UpdateEventRequest = Partial<UpsertEventRequest>;

export interface RsvpRequest {
  state: RsvpState | null;
}

export interface EventsQuery {
  filter?: EventFilter;
  hostId?: Id;
}

/* ───────────────────────────── courses ───────────────────────────── */

export interface Course {
  id: Id;
  /** Normalised, e.g. "CS 314". */
  code: string;
  title: string;
  term: string;
  memberCount: number;
  lastActiveAt: EpochMs | null;
  joined: boolean;
  /** Set when joined. */
  conversationId: Id | null;
  unread: number;
}

export interface CreateCourseRequest {
  code: string;
  title: string;
}

export interface CourseJoinResponse {
  conversationId: Id;
}

/** `details` of the 409 `conflict` a duplicate `POST /courses` returns. */
export interface CourseConflictDetails {
  course: Course;
}

export const COURSE_TITLE_MAX = 80;
export const COURSE_CODE_INPUT_MAX = 16;

/** First system message of every course chat (product §2.9). */
export const COURSE_CHAT_WELCOME =
  'Course chats are for help, not answers. Sharing exam or graded-assignment answers breaks the guidelines.';

/* ───────────────────────────── hub ───────────────────────────── */

export const LAUNCH_GOALS = [25, 100, 500, 1000, 2500, 5000] as const;

export interface CampusHub {
  university: University;
  /** `goal` is the next ladder entry above `count`; null → "5,000+ students". */
  launch: { count: number; goal: number | null };
  /** `newListings` is filled CLIENT-side from `GET /api/market/summary`; the server always returns null. */
  today: { events: number; freeFood: number; newListings: number | null };
  todayEvents: EventCard[];
  upcoming: EventCard[];
  myCourses: Course[];
}
