/**
 * Buzz server state: query keys (prefix `['buzz', …]`), hooks and mutations. All requests through `@/lib/api`.
 * Every query is `enabled` only once the gate is accepted (SPEC §5.3: no `/api/buzz` request before acceptance).
 */
import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { FeedScope, Id, Paginated, WithModeration } from '@shared/core';
import type {
  Buzz, BuzzFeedMeta, BuzzKarma, BuzzPoll, BuzzReply, BuzzSort, BuzzThread, BuzzTopWindow, BuzzVoteState, CreateBuzzReplyRequest,
  CreateBuzzRequest, MyBuzzItem, MyBuzzKind,
} from '@shared/buzz';
import { api, isApiError } from '@/lib/api';
import { queryClient, useInfiniteList } from '@/lib/query';
import { refreshMe } from '@/lib/session';
import { useBuzzGate } from './gate';

export const buzzKeys = {
  all: ['buzz'] as const,
  feed: (sort: BuzzSort, window: BuzzTopWindow, scope: FeedScope) => ['buzz', 'feed', sort, sort === 'top' ? window : 'day', scope] as const,
  feeds: ['buzz', 'feed'] as const,
  meta: (scope: FeedScope) => ['buzz', 'meta', scope] as const,
  thread: (id: Id) => ['buzz', 'thread', id] as const,
  replies: (id: Id) => ['buzz', 'replies', id] as const,
  mine: (kind: MyBuzzKind) => ['buzz', 'mine', kind] as const,
  karma: ['buzz', 'karma'] as const,
};

/** A 403 `buzz_gate_required` (version bump mid-session) → refresh `me` so the inline panel shows (SPEC §5.3). */
export function useGateErrorGuard(error: unknown): void {
  useEffect(() => {
    if (isApiError(error, 'buzz_gate_required')) void refreshMe();
  }, [error]);
}

/* ───────────────────────────── reads ───────────────────────────── */

export function useBuzzFeed(sort: BuzzSort, window: BuzzTopWindow, scope: FeedScope, enabled = true) {
  const { accepted } = useBuzzGate();
  const list = useInfiniteList<Buzz>({
    queryKey: [...buzzKeys.feed(sort, window, scope)],
    path: '/buzz/feed',
    query: { sort, window: sort === 'top' ? window : undefined, scope },
    enabled: accepted && enabled,
  });
  useGateErrorGuard(list.error);
  return list;
}

export function useBuzzMeta(scope: FeedScope) {
  const { accepted } = useBuzzGate();
  return useQuery<BuzzFeedMeta>({
    queryKey: buzzKeys.meta(scope),
    queryFn: () => api.get<BuzzFeedMeta>('/buzz/meta', { scope }),
    enabled: accepted,
    staleTime: 5 * 60_000,
  });
}

/**
 * Seeds page 1 of a thread's reply list from the thread response (SPEC §5.3: "seed its first page from
 * `BuzzThread.replies`"). Runs inside the thread queryFn, i.e. before the thread data commits and before the replies
 * query is enabled, so that query never re-requests the page it was already given (`initialData` cannot do this: the
 * cache entry is created, disabled, on the screen's first render, and TanStack applies `initialData` only on creation).
 * A refetch in flight, or a list the viewer already paged deeper, is left alone — invalidation keeps those fresh.
 */
function seedReplies(threadId: Id, first: Paginated<BuzzReply>): void {
  const key = buzzKeys.replies(threadId);
  const state = queryClient.getQueryState<Pages<BuzzReply>>(key);
  if (state?.fetchStatus === 'fetching' || (state?.data && state.data.pages.length > 1)) return;
  queryClient.setQueryData<Pages<BuzzReply>>(key, { pages: [first], pageParams: [undefined] });
}

export function useBuzzThread(threadId: Id) {
  const { accepted } = useBuzzGate();
  const q = useQuery<BuzzThread>({
    queryKey: buzzKeys.thread(threadId),
    queryFn: async ({ signal }) => {
      const thread = await api.get<BuzzThread>(`/buzz/${encodeURIComponent(threadId)}`, undefined, { signal });
      seedReplies(threadId, thread.replies);
      return thread;
    },
    enabled: accepted,
  });
  useGateErrorGuard(q.error);
  return q;
}

/** Further reply pages; page 1 is already in the cache (`seedReplies`) by the time `first` exists, so enabling costs no request. */
export function useBuzzReplies(threadId: Id, first: Paginated<BuzzReply> | undefined) {
  const { accepted } = useBuzzGate();
  const q = useInfiniteQuery<Paginated<BuzzReply>, unknown, InfiniteData<Paginated<BuzzReply>>, readonly unknown[], string | undefined>({
    queryKey: buzzKeys.replies(threadId),
    enabled: accepted && first !== undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) => api.get<Paginated<BuzzReply>>(`/buzz/${encodeURIComponent(threadId)}/replies`, { cursor: pageParam, limit: 20 }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? first?.items ?? [];
  return {
    items,
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: q.fetchNextPage,
    error: q.isFetchNextPageError ? q.error : undefined,
  };
}

export function useMyBuzzes(kind: MyBuzzKind) {
  const { accepted } = useBuzzGate();
  const list = useInfiniteList<MyBuzzItem>({ queryKey: [...buzzKeys.mine(kind)], path: '/buzz/mine', query: { kind }, enabled: accepted });
  useGateErrorGuard(list.error);
  return list;
}

export function useBuzzKarma() {
  const { accepted } = useBuzzGate();
  return useQuery<BuzzKarma>({ queryKey: buzzKeys.karma, queryFn: () => api.get<BuzzKarma>('/buzz/karma'), enabled: accepted });
}

/* ───────────────────────────── cache patching ───────────────────────────── */

type Item = Buzz | BuzzReply;
type Pages<T> = InfiniteData<Paginated<T>>;

/** Applies `fn` to every cached copy of the item: feed pages, mine pages, thread root and reply pages. */
export function patchBuzzItem(id: Id, fn: (item: Item) => Item): void {
  queryClient.setQueriesData<Pages<Buzz>>({ queryKey: buzzKeys.feeds }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? (fn(it) as Buzz) : it)) })) } : data,
  );
  queryClient.setQueriesData<Pages<MyBuzzItem>>({ queryKey: ['buzz', 'mine'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.item.id === id ? { ...m, item: fn(m.item) } : m)) })) } : data,
  );
  queryClient.setQueriesData<BuzzThread>({ queryKey: ['buzz', 'thread'] }, (t) => {
    if (!t) return t;
    const root = t.root.id === id ? (fn(t.root) as Buzz) : t.root;
    const replies = { ...t.replies, items: t.replies.items.map((r) => (r.id === id ? (fn(r) as BuzzReply) : r)) };
    return root === t.root && replies.items === t.replies.items ? t : { ...t, root, replies };
  });
  queryClient.setQueriesData<Pages<BuzzReply>>({ queryKey: ['buzz', 'replies'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? (fn(it) as BuzzReply) : it)) })) } : data,
  );
}

export function removeBuzzItem(id: Id): void {
  queryClient.setQueriesData<Pages<Buzz>>({ queryKey: buzzKeys.feeds }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((it) => it.id !== id) })) } : data,
  );
  queryClient.setQueriesData<Pages<MyBuzzItem>>({ queryKey: ['buzz', 'mine'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.item.id !== id) })) } : data,
  );
}

/* ───────────────────────────── mutations ───────────────────────────── */

export function useCreateBuzz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBuzzRequest) => api.post<WithModeration<Buzz>>('/buzz', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buzzKeys.feeds });
      void qc.invalidateQueries({ queryKey: ['buzz', 'mine'] });
    },
  });
}

export function useCreateReply(threadId: Id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBuzzReplyRequest) => api.post<WithModeration<BuzzReply>>(`/buzz/${encodeURIComponent(threadId)}/replies`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buzzKeys.thread(threadId) });
      void qc.invalidateQueries({ queryKey: buzzKeys.replies(threadId) });
      void qc.invalidateQueries({ queryKey: ['buzz', 'mine'] });
    },
  });
}

/** Optimistic vote with undo (tap again → 0). Rolls back on error. */
export function useVote() {
  return useMutation({
    mutationFn: ({ id, value }: { id: Id; value: -1 | 0 | 1 }) => api.put<BuzzVoteState>(`/buzz/posts/${encodeURIComponent(id)}/vote`, { value }),
    onMutate: ({ id, value }) => {
      let prev: Item | null = null;
      patchBuzzItem(id, (it) => {
        prev = it;
        return { ...it, myVote: value, score: it.score - it.myVote + value };
      });
      return { prev };
    },
    onError: (_e, { id }, ctxData) => {
      const prev = ctxData?.prev as Item | null;
      if (prev) patchBuzzItem(id, () => prev);
    },
    onSuccess: (state, { id }) => {
      patchBuzzItem(id, (it) => ({ ...it, score: state.score, myVote: state.myVote, collapsed: state.collapsed }));
    },
  });
}

export function usePollVote(threadId: Id) {
  return useMutation({
    mutationFn: (optionId: Id) => api.post<BuzzPoll>(`/buzz/${encodeURIComponent(threadId)}/poll/vote`, { optionId }),
    onSuccess: (poll) => {
      patchBuzzItem(threadId, (it) => (it.kind === 'buzz' ? { ...it, poll } : it));
    },
  });
}

export function useDeleteBuzz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => api.delete<void>(`/buzz/posts/${encodeURIComponent(id)}`),
    onSuccess: (_v, id) => {
      removeBuzzItem(id);
      void qc.invalidateQueries({ queryKey: ['buzz', 'thread'] });
      void qc.invalidateQueries({ queryKey: ['buzz', 'replies'] });
      void qc.invalidateQueries({ queryKey: buzzKeys.karma });
    },
  });
}

export function useHideThread() {
  return useMutation({
    mutationFn: ({ threadId, hide }: { threadId: Id; hide: boolean }) =>
      hide ? api.post<void>(`/buzz/${encodeURIComponent(threadId)}/hide`) : api.delete<void>(`/buzz/${encodeURIComponent(threadId)}/hide`),
    onMutate: ({ threadId, hide }) => {
      if (hide) removeBuzzItem(threadId);
    },
  });
}

export function useHideAuthor() {
  return useMutation({
    mutationFn: (postId: Id) => api.post<void>(`/buzz/posts/${encodeURIComponent(postId)}/hide-author`),
    onSuccess: (_v, postId) => {
      patchBuzzItem(postId, (it) => ({ ...it, collapsed: true }));
    },
  });
}

export function invalidateThread(threadId: Id): void {
  void queryClient.invalidateQueries({ queryKey: buzzKeys.thread(threadId) });
  void queryClient.invalidateQueries({ queryKey: buzzKeys.replies(threadId) });
}
