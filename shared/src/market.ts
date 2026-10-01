/**
 * `market` slice — request / response types (SPEC §5.8). Types + constants only, zero imports beyond `./core`.
 * `MarketSummary` (GET /summary) is a cross-slice payload and lives in `@shared/core`.
 */
import type { ContentStatus, EpochMs, Id, MediaImage, UserSummary } from './core';

/* ───────────────────────────── enums ───────────────────────────── */

export const LISTING_TYPES = ['sell', 'trade', 'free', 'wanted', 'lost', 'found'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  sell: 'Sell',
  trade: 'Trade',
  free: 'Free',
  wanted: 'Wanted',
  lost: 'Lost',
  found: 'Found',
};

export const LISTING_CATEGORIES = [
  { id: 'textbooks', label: 'Textbooks' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'dorm_kitchen', label: 'Dorm & Kitchen' },
  { id: 'clothing', label: 'Clothing' },
  { id: 'bikes_scooters', label: 'Bikes & Scooters' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'other', label: 'Other' },
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]['id'];
export const LISTING_CATEGORY_IDS = LISTING_CATEGORIES.map((c) => c.id) as readonly ListingCategory[];

export type ListingCondition = 'new' | 'like_new' | 'good' | 'fair';
export const LISTING_CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
export const LISTING_CONDITION_LABELS: Record<ListingCondition, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
};

/** `expired` is computed (state 'active' past `expiresAt`); the DB stores only active / sold / returned. */
export type ListingState = 'active' | 'sold' | 'returned' | 'expired';

export type ListingSort = 'newest' | 'price_asc' | 'price_desc';
export const LISTING_SORTS: readonly { value: ListingSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export type ListingWithin = '24h' | '7d' | '30d';

/** Categories that get the price-sanity flag (safety §7.4 #5). */
export const LOW_PRICE_CATEGORIES: readonly ListingCategory[] = ['electronics', 'tickets', 'bikes_scooters'];

/** Days a listing stays live, and how long a sold / returned one keeps showing in Browse. */
export const LISTING_TTL_DAYS = 30;
export const CLOSED_VISIBLE_DAYS = 7;

/* ───────────────────────────── payloads ───────────────────────────── */

export interface ListingCard {
  id: Id;
  type: ListingType;
  category: ListingCategory;
  title: string;
  /** Whole units of the campus currency; null for free / wanted / lost / found (and trade without "or {price}"). */
  price: number | null;
  tradeFor: string | null;
  coverUrl: string | null;
  meetupSpot: string | null;
  courseCode: string | null;
  state: ListingState;
  saved: boolean;
  /** The viewer is the seller (cards hide the save heart; my-listings rows are always own). */
  isOwn: boolean;
  lowPriceFlag: boolean;
  createdAt: EpochMs;
}

export interface SellerTrust {
  memberSince: EpochMs;
  /** Account age < 7 days. */
  isNewAccount: boolean;
  activeListings: number;
  /** Listings marked sold. */
  completedListings: number;
  classLabel: string | null;
}

export interface ListingViewer {
  isSelf: boolean;
  /** A DM between the viewer and the seller exists (any state the viewer can open). */
  hasConversation: boolean;
  conversationId: Id | null;
  /** The viewer's request to the seller has not been accepted yet. */
  requestPending: boolean;
  /** The viewer has a pending offer on THIS listing. */
  hasPendingOffer: boolean;
}

export interface ListingStats {
  views: number;
  saves: number;
  chats: number;
}

export interface Listing extends ListingCard {
  description: string;
  condition: ListingCondition | null;
  photos: MediaImage[];
  /** Lost / found: where it was lost or found. */
  locationText: string | null;
  /** Lost / found: 'YYYY-MM-DD'. */
  occurredOn: string | null;
  seller: UserSummary;
  sellerTrust: SellerTrust;
  viewer: ListingViewer;
  /** Owner only; null for everyone else. */
  stats: ListingStats | null;
  status: ContentStatus;
  expiresAt: EpochMs;
}

/** Rows of GET /mine — the owner's cards carry their stats and moderation status. */
export interface MyListingCard extends ListingCard {
  stats: ListingStats;
  status: ContentStatus;
}

export interface UpsertListingRequest {
  type: ListingType;
  category: ListingCategory;
  title: string;
  description?: string;
  price?: number | null;
  tradeFor?: string | null;
  condition?: ListingCondition | null;
  /** Textbooks only; normalised server-side ("cs314" → "CS 314"). */
  courseCode?: string | null;
  meetupSpot?: string | null;
  locationText?: string | null;
  occurredOn?: string | null;
  photos: MediaImage[];
}

export interface ListingFilters {
  q?: string;
  category?: ListingCategory;
  type?: ListingType;
  min?: number;
  max?: number;
  condition?: ListingCondition;
  within?: ListingWithin;
  course?: string;
  sort?: ListingSort;
}

export interface MarkSoldRequest {
  state: 'sold' | 'returned';
}

export interface SaveResponse {
  saved: boolean;
  saveCount: number;
}

export interface OfferRequest {
  amount: number;
}
export interface OfferResponse {
  conversationId: Id;
  messageId: Id;
}

export type MyListingsState = 'active' | 'closed';

/* ───────────────────────────── copy (safety §7.4, final) ───────────────────────────── */

export const MARKET_SAFETY_TITLE = 'Stay safe';
export const MARKET_SAFETY_POINTS: string[] = [
  'Meet in a public spot on campus: the library lobby, student union, or a campus safe-exchange zone.',
  'Go in daylight and bring a friend if you can.',
  'Check the item before you pay.',
  'Pay in person. Never send deposits, gift cards, or codes.',
  'Keep the conversation in UniVerse so we can help if something goes wrong.',
];

export const PROHIBITED_ITEMS_COPY: string[] = [
  'Drugs, prescription meds, alcohol, nicotine and vapes',
  'Weapons and weapon parts',
  'Fake IDs, student ID cards, accounts and login credentials',
  'Stolen, recalled or counterfeit goods',
  'Exam materials and coursework services',
  'Adult content or services',
  'Live animals',
  'Financial instruments and "get paid to" schemes',
];

export const LOW_PRICE_COPY = 'Price is unusually low. Take extra care.';
export const LISTING_GONE_COPY = 'This listing is no longer available.';
