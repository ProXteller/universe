/**
 * TanStack Query setup + the infinite-list helpers every slice uses (SPEC §4.4.1 `lib/query.ts`).
 */
import { useMemo } from 'react';
import { QueryClient, useInfiniteQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { Paginated } from '@shared/core';
import { DEFAULT_PAGE_LIMIT } from '@shared/core';
import type { InfiniteSentinelProps } from '@/ui';
import { api, isApiError, type Query } from './api';

function is4xx(err: unknown): boolean {
  return isApiError(err) && err.status >= 400 && err.status < 500;
}

/** staleTime 30 s, retry 1, no retry on 4xx. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, err) => !is4xx(err) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export interface UseInfiniteListOptions {
  queryKey: unknown[];
  /** Relative to `/api`, e.g. `'/market/listings'`. */
  path: string;
  query?: Record<string, unknown>;
  enabled?: boolean;
  limit?: number;
  refetchInterval?: number;
}

export interface UseInfiniteListResult<T> {
  items: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch(): Promise<unknown>;
  fetchNextPage(): Promise<unknown>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Spread onto `<InfiniteSentinel {...sentinelProps} />`. */
  sentinelProps: Pick<InfiniteSentinelProps, 'onReach' | 'hasMore' | 'isFetching' | 'error' | 'onRetry'>;
}

function toQuery(q?: Record<string, unknown>): Query {
  const out: Query = {};
  if (!q) return out;
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(',');
    else out[k] = String(v);
  }
  return out;
}

/** A cursor-paged list (`{ items, nextCursor }`) flattened for rendering, with the sentinel props ready. */
export function useInfiniteList<T>(opts: UseInfiniteListOptions): UseInfiniteListResult<T> {
  const { queryKey, path, query, enabled = true, limit = DEFAULT_PAGE_LIMIT, refetchInterval } = opts;
  const q = useInfiniteQuery<Paginated<T>, unknown, InfiniteData<Paginated<T>>, QueryKey, string | undefined>({
    queryKey,
    enabled,
    refetchInterval,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<T>>(path, { ...toQuery(query), limit, cursor: pageParam }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = q;
  const nextError = q.isFetchNextPageError ? q.error : undefined;

  return {
    items,
    isLoading: q.isLoading,
    isError: q.isError && !q.isFetchNextPageError,
    error: q.error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    sentinelProps: {
      onReach: () => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      hasMore: hasNextPage,
      isFetching: isFetchingNextPage,
      error: nextError,
      onRetry: () => void fetchNextPage(),
    },
  };
}

type Pages<T> = InfiniteData<Paginated<T>>;

function mapPages<T>(data: Pages<T> | undefined, fn: (items: T[]) => T[]): Pages<T> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) };
}

/** Patch one item in every cached list whose key starts with `queryKey`. */
export function updateInfiniteItem<T extends { id: string }>(queryKey: unknown[], id: string, fn: (t: T) => T): void {
  queryClient.setQueriesData<Pages<T>>({ queryKey }, (data) =>
    mapPages(data, (items) => items.map((it) => (it.id === id ? fn(it) : it))),
  );
}

export function removeInfiniteItem(queryKey: unknown[], id: string): void {
  queryClient.setQueriesData<Pages<{ id: string }>>({ queryKey }, (data) =>
    mapPages(data, (items) => items.filter((it) => it.id !== id)),
  );
}

/** Puts `item` at the top of the first page of every cached list under `queryKey` (dedupes by `id`). */
export function prependInfiniteItem<T extends { id: string }>(queryKey: unknown[], item: T): void {
  queryClient.setQueriesData<Pages<T>>({ queryKey }, (data) => {
    if (!data || data.pages.length === 0) return data;
    const [first, ...rest] = data.pages;
    if (!first) return data;
    return {
      ...data,
      pages: [{ ...first, items: [item, ...first.items.filter((it) => it.id !== item.id)] }, ...rest],
    };
  });
}
