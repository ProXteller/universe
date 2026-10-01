/**
 * Copy + label helpers shared by the market screens. Prices ALWAYS go through `formatPrice`.
 */
import { format } from 'date-fns';
import type { EpochMs } from '@shared/core';
import type { ListingCard, ListingCategory, ListingState, ListingType } from '@shared/market';
import { LISTING_CATEGORIES, LISTING_TYPE_LABELS } from '@shared/market';
import { formatPrice } from '@/lib/format';

export function categoryLabel(id: ListingCategory | string): string {
  return LISTING_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}

export function typeLabel(type: ListingType): string {
  return LISTING_TYPE_LABELS[type];
}

/** The headline of a card / detail: "$45", "Free", "Trade · for a desk fan", "Wanted", "Lost", "Found". */
export function priceLine(card: Pick<ListingCard, 'type' | 'price' | 'tradeFor'>): string {
  switch (card.type) {
    case 'sell':
      return formatPrice(card.price);
    case 'free':
      return 'Free';
    case 'trade':
      return card.price !== null ? `Trade · for ${card.tradeFor ?? '?'} or ${formatPrice(card.price)}` : `Trade · for ${card.tradeFor ?? '?'}`;
    case 'wanted':
      return 'Wanted';
    case 'lost':
      return 'Lost';
    case 'found':
      return 'Found';
  }
}

/** Badge text for non-sale types (the sale price is written out instead). */
export function typeBadge(card: Pick<ListingCard, 'type'>): { label: string; tone: 'gold' | 'info' | 'neutral' | 'warning' | 'success'; variant: 'soft' | 'outline' } | null {
  switch (card.type) {
    case 'free':
      return { label: 'FREE', tone: 'gold', variant: 'soft' };
    case 'trade':
      return { label: 'TRADE', tone: 'info', variant: 'soft' };
    case 'wanted':
      return { label: 'WANTED', tone: 'neutral', variant: 'outline' };
    case 'lost':
      return { label: 'LOST', tone: 'warning', variant: 'soft' };
    case 'found':
      return { label: 'FOUND', tone: 'success', variant: 'soft' };
    default:
      return null;
  }
}

export function stateLabel(state: ListingState): string | null {
  switch (state) {
    case 'sold':
      return 'Sold';
    case 'returned':
      return 'Returned';
    case 'expired':
      return 'Expired';
    default:
      return null;
  }
}

/** The closing verb for the owner's "Mark …" control: lost / found items are "returned", everything else "sold". */
export function closeState(type: ListingType): 'sold' | 'returned' {
  return type === 'lost' || type === 'found' ? 'returned' : 'sold';
}

export function memberSince(ts: EpochMs): string {
  return format(new Date(ts), 'MMM yyyy');
}

/** "2026-09-21" → "Sep 21". */
export function occurredOnLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), 'MMM d');
}

export const MARKET_COPY = {
  campusEmpty: (university: string) => `Nothing listed at ${university} yet. Got a mini fridge collecting dust? List it in about a minute.`,
  noMatches: 'No listings match. Try fewer filters — or post a Wanted and let sellers come to you.',
  savedEmpty: 'Tap the heart on anything you like. We’ll tell you if the price drops.',
  mineEmpty: 'You haven’t listed anything yet.',
  gone: 'This listing is no longer available.',
  prohibited: (category: string) => `This looks like a prohibited item (${category}). See what can’t be listed.`,
} as const;
