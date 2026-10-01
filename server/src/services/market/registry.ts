/**
 * `market` slice — the cross-slice seam (SPEC §4.2.10): ContentAdapter `market_listing`, CardResolver `listing`,
 * user lifecycle hook. Registered once by the router at import time (R4 allows registry writes; no DB is touched here).
 */
import type { ShareCard } from '@shared/core';
import { LISTING_CATEGORIES, LISTING_CONDITION_LABELS } from '@shared/market';
import { registerCardResolver, registerContentAdapter, registerUserLifecycleHook, type ContentSnapshot } from '../../lib/content';
import { getUserRow } from '../../lib/users';
import { coverOf, getListingRow, photosOf, removeListingsOf, setListingStatus, stateOf, type ListingRow } from './listings';

export const LISTING_LABEL = 'listing';

function categoryLabel(id: string): string {
  return LISTING_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}

export function listingSnapshot(row: ListingRow): ContentSnapshot {
  const fields: { field: string; text: string }[] = [{ field: 'title', text: row.title }];
  if (row.description) fields.push({ field: 'body', text: row.description });
  if (row.trade_for) fields.push({ field: 'body', text: row.trade_for });
  return {
    entityType: 'market_listing',
    entityId: row.id,
    authorId: row.seller_id,
    universityId: row.university_id,
    status: row.status,
    surface: 'market_listing',
    anon: false,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: LISTING_LABEL,
    fields,
    media: photosOf(row).map((p) => ({ url: p.url, kind: 'image' as const })),
    href: `/market/${row.id}`,
    parent: null,
  };
}

function badgeOf(row: ListingRow): string | null {
  const state = stateOf(row);
  if (state === 'sold') return 'Sold';
  if (state === 'returned') return 'Returned';
  switch (row.type) {
    case 'free':
      return 'FREE';
    case 'trade':
      return 'TRADE';
    case 'wanted':
      return 'WANTED';
    case 'lost':
      return 'LOST';
    case 'found':
      return 'FOUND';
    default:
      return null;
  }
}

/** Card status from the row alone; foundation `resolveCard` adds the block + owner-status rules and the currency. */
export function listingCard(row: ListingRow): Omit<ShareCard, 'kind' | 'id' | 'currency'> {
  const state = stateOf(row);
  const status: ShareCard['status'] =
    row.status !== 'active' ? 'unavailable' : state === 'expired' ? 'unavailable' : state === 'sold' ? 'sold' : state === 'returned' ? 'returned' : 'available';
  const subtitle =
    row.type === 'trade' && row.trade_for
      ? `for ${row.trade_for}`
      : row.condition
        ? `${LISTING_CONDITION_LABELS[row.condition]} · ${categoryLabel(row.category)}`
        : categoryLabel(row.category);
  return {
    title: row.title,
    subtitle,
    imageUrl: coverOf(row),
    href: `/market/${row.id}`,
    status,
    price: row.price,
    badge: badgeOf(row),
    ownerId: row.seller_id,
    meetupSpot: row.meetup_spot,
  };
}

let registered = false;

/** Idempotent: the router calls it at import time. */
export function registerMarketRegistries(): void {
  if (registered) return;
  registered = true;
  registerContentAdapter({
    entityType: 'market_listing',
    load(id) {
      const row = getListingRow(id);
      return row ? listingSnapshot(row) : null;
    },
    setStatus(id, status, opts) {
      setListingStatus(id, status, opts);
    },
  });
  registerCardResolver('listing', (id, viewerId) => {
    const row = getListingRow(id);
    if (!row || row.status === 'deleted') return null;
    if (row.seller_id !== viewerId) {
      // SPEC §4.2.10 / §3.1: held / hidden / removed listings are the seller's alone; market is campus-only (§5.8).
      if (row.status !== 'active') return null;
      if (getUserRow(viewerId)?.university_id !== row.university_id) return null;
    }
    return listingCard(row);
  });
  registerUserLifecycleHook('market', {
    onBanned: (userId) => removeListingsOf(userId),
    onDeleted: (userId) => removeListingsOf(userId),
  });
}
