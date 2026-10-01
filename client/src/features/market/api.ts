/**
 * Market data layer: query keys (`['market', …]`), fetchers through `@/lib/api`, cache patches shared by every
 * mutation, and the optimistic save toggle. Campus-only: every list is the viewer's campus by construction.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CampusPlace, Id, MarketSummary, Paginated, WithModeration } from '@shared/core';
import type {
  Listing, ListingCard, ListingFilters, MyListingCard, MyListingsState, OfferResponse, SaveResponse, UpsertListingRequest,
} from '@shared/market';
import { api, errorMessage } from '@/lib/api';
import { queryClient, removeInfiniteItem, updateInfiniteItem, useInfiniteList } from '@/lib/query';
import { toast } from '@/lib/toast';

/* ───────────────────────────── keys ───────────────────────────── */

export const marketKeys = {
  all: ['market'] as const,
  browse: (filters: ListingFilters) => ['market', 'browse', filters] as const,
  browseAll: ['market', 'browse'] as const,
  listing: (id: Id) => ['market', 'listing', id] as const,
  saved: ['market', 'saved'] as const,
  mine: (state: MyListingsState) => ['market', 'mine', state] as const,
  mineAll: ['market', 'mine'] as const,
  places: ['market', 'places', 'meetup'] as const,
  summary: ['market', 'summary'] as const,
};

const enc = (s: string) => encodeURIComponent(s);
const path = (id: Id, suffix = '') => `/market/listings/${enc(id)}${suffix}`;

/* ───────────────────────────── reads ───────────────────────────── */

/** Drops empty filter values so the query key (and the request) only carries what is set. */
export function cleanFilters(f: ListingFilters): ListingFilters {
  const out: ListingFilters = {};
  if (f.q?.trim()) out.q = f.q.trim();
  if (f.category) out.category = f.category;
  if (f.type) out.type = f.type;
  if (typeof f.min === 'number' && Number.isFinite(f.min)) out.min = f.min;
  if (typeof f.max === 'number' && Number.isFinite(f.max)) out.max = f.max;
  if (f.condition) out.condition = f.condition;
  if (f.within) out.within = f.within;
  if (f.course?.trim()) out.course = f.course.trim();
  if (f.sort && f.sort !== 'newest') out.sort = f.sort;
  return out;
}

export function useBrowse(filters: ListingFilters) {
  const clean = cleanFilters(filters);
  return useInfiniteList<ListingCard>({ queryKey: [...marketKeys.browse(clean)], path: '/market/listings', query: { ...clean } as Record<string, unknown> });
}

export function useListing(id: Id, initial?: Listing) {
  return useQuery<Listing>({
    queryKey: marketKeys.listing(id),
    queryFn: ({ signal }) => api.get<Listing>(path(id), undefined, { signal }),
    initialData: initial,
    staleTime: initial ? 10_000 : 0,
  });
}

export function useSaved() {
  return useInfiniteList<ListingCard>({ queryKey: [...marketKeys.saved], path: '/market/saved' });
}

export function useMine(state: MyListingsState) {
  return useInfiniteList<MyListingCard>({ queryKey: [...marketKeys.mine(state)], path: '/market/mine', query: { state } });
}

/** Campus meetup presets (foundation endpoint #28). */
export function useMeetupPlaces() {
  return useQuery<Paginated<CampusPlace>>({
    queryKey: marketKeys.places,
    queryFn: ({ signal }) => api.get<Paginated<CampusPlace>>('/universities/me/places', { kind: 'meetup' }, { signal }),
    staleTime: 10 * 60_000,
  });
}

export function useMarketSummary() {
  return useQuery<MarketSummary>({
    queryKey: marketKeys.summary,
    queryFn: ({ signal }) => api.get<MarketSummary>('/market/summary', undefined, { signal }),
    staleTime: 60_000,
  });
}

/* ───────────────────────────── writes ───────────────────────────── */

export function createListingRequest(body: UpsertListingRequest): Promise<WithModeration<Listing>> {
  return api.post<WithModeration<Listing>>('/market/listings', body);
}

export function updateListingRequest(id: Id, body: Partial<UpsertListingRequest>): Promise<WithModeration<Listing>> {
  return api.patch<WithModeration<Listing>>(path(id), body);
}

export function deleteListingRequest(id: Id): Promise<void> {
  return api.delete<void>(path(id));
}

export function markClosedRequest(id: Id, state: 'sold' | 'returned'): Promise<Listing> {
  return api.post<Listing>(path(id, '/sold'), { state });
}

export function relistRequest(id: Id): Promise<Listing> {
  return api.post<Listing>(path(id, '/relist'));
}

export function saveRequest(id: Id, saved: boolean): Promise<SaveResponse> {
  return saved ? api.put<SaveResponse>(path(id, '/save')) : api.delete<SaveResponse>(path(id, '/save'));
}

export function offerRequest(id: Id, amount: number): Promise<OfferResponse> {
  return api.post<OfferResponse>(path(id, '/offers'), { amount });
}

/* ───────────────────────────── cache patches ───────────────────────────── */

/** Applies `fn` to every cached copy of a listing: browse pages, saved, my listings and the detail query. */
export function patchListing(id: Id, fn: <T extends ListingCard>(card: T) => T): void {
  updateInfiniteItem<ListingCard>([...marketKeys.browseAll], id, fn);
  updateInfiniteItem<ListingCard>([...marketKeys.saved], id, fn);
  updateInfiniteItem<MyListingCard>([...marketKeys.mineAll], id, fn);
  queryClient.setQueryData<Listing>(marketKeys.listing(id), (l) => (l ? fn(l) : l));
}

export function seedListingDetail(listing: Listing): void {
  queryClient.setQueryData<Listing>(marketKeys.listing(listing.id), listing);
}

export function dropListing(id: Id): void {
  removeInfiniteItem([...marketKeys.browseAll], id);
  removeInfiniteItem([...marketKeys.saved], id);
  removeInfiniteItem([...marketKeys.mineAll], id);
  queryClient.removeQueries({ queryKey: marketKeys.listing(id) });
}

/** After a create / edit / state change: every list re-reads on its next paint. */
export function invalidateMarketLists(): void {
  void queryClient.invalidateQueries({ queryKey: marketKeys.browseAll });
  void queryClient.invalidateQueries({ queryKey: marketKeys.mineAll });
  void queryClient.invalidateQueries({ queryKey: marketKeys.saved });
  void queryClient.invalidateQueries({ queryKey: marketKeys.summary });
}

/* ───────────────────────────── save toggle ───────────────────────────── */

/** Optimistic heart: patches every cached copy first, rolls back on error, settles on the server's answer. */
export function useSaveMutation() {
  return useMutation<SaveResponse, unknown, { id: Id; saved: boolean }, { prev: boolean }>({
    mutationFn: ({ id, saved }) => saveRequest(id, saved),
    onMutate: ({ id, saved }) => {
      patchListing(id, (c) => ({ ...c, saved }));
      return { prev: !saved };
    },
    onError: (e, { id }, snapshot) => {
      if (snapshot) patchListing(id, (c) => ({ ...c, saved: snapshot.prev }));
      toast.error(errorMessage(e));
    },
    onSuccess: (res, { id }) => {
      patchListing(id, (c) => ({ ...c, saved: res.saved }));
      if (res.saved) {
        void queryClient.invalidateQueries({ queryKey: marketKeys.saved });
        toast.success('Saved. We’ll tell you if the price drops.');
      } else {
        removeInfiniteItem([...marketKeys.saved], id);
      }
    },
  });
}
