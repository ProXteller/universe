/**
 * `discover` slice — request / response types (SPEC §5.5). Types + constants only. ZERO imports besides `./core`.
 * Private to the discover client + server pair; other slices never import this file (R1).
 */
import type { Id, Paginated, UserListItem } from './core';

export type SuggestionSection = 'people_you_may_know' | 'active_creators' | 'popular_orgs';

export const SUGGESTION_SECTIONS: readonly SuggestionSection[] = ['people_you_may_know', 'active_creators', 'popular_orgs'];

export interface Suggestion {
  user: UserListItem;
  /** "CS · 3 mutuals" | "4 reels this week" | "184 followers at UT Austin" — always derived from real rows. */
  reason: string;
  section: SuggestionSection;
}

export interface DiscoverHome {
  peopleYouMayKnow: Suggestion[];
  activeCreators: Suggestion[];
  popularOrgs: Suggestion[];
  /** The viewer's campus is still small (product §2.5 "You're early" copy). */
  isEarlyCampus: boolean;
}

export type SearchMatch = 'name' | 'handle' | 'major';

export interface SearchHit {
  user: UserListItem;
  matched: SearchMatch;
  sameCampus: boolean;
}

/** ONE list, ordered campus-first server-side (sameCampus DESC, then rank); the client splits on `sameCampus`. */
export type DiscoverSearchResponse = Paginated<SearchHit>;

export type DiscoverSearchType = 'all' | 'people' | 'orgs';

export interface DiscoverSearchQuery {
  q: string;
  type?: DiscoverSearchType;
  cursor?: string;
  limit?: number;
}

export interface DismissSuggestionRequest {
  userId: Id;
  section: SuggestionSection;
}

/** Caps of the three home sections (SPEC §5.5: ≤ 12 / 10 / 10). */
export const DISCOVER_HOME_LIMITS = { peopleYouMayKnow: 12, activeCreators: 10, popularOrgs: 10 } as const;

/** Active-creator window (SPEC §5.5: public_activity in the last 14 days). */
export const ACTIVE_CREATOR_WINDOW_DAYS = 14;

/** Local recents key (`uv:<slice>:…`) and cap. */
export const DISCOVER_RECENTS_KEY = 'uv:discover:recent';
export const DISCOVER_RECENTS_MAX = 8;

/** ~40 interest chips for Edit profile (≤ LIMITS.interests selected). */
export const INTEREST_OPTIONS: readonly string[] = [
  'Anime', 'Art', 'Astronomy', 'Baking', 'Basketball', 'Board games', 'Books', 'Climbing', 'Coffee', 'Cooking',
  'Crypto', 'Cycling', 'Dance', 'Design', 'DJing', 'Entrepreneurship', 'Esports', 'Fashion', 'Film', 'Fitness',
  'Football', 'Gaming', 'Hackathons', 'Hiking', 'Investing', 'K-pop', 'Languages', 'Music', 'Photography', 'Podcasts',
  'Politics', 'Research', 'Running', 'Soccer', 'Streaming', 'Sustainability', 'Tennis', 'Theatre', 'Travel',
  'Volunteering', 'Writing', 'Yoga',
];
