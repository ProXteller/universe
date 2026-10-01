/**
 * Orbit data layer: query keys (`['orbit', …]`; the feed key `['orbit','feed']` is reserved — foundation invalidates it
 * on follow / unfollow / block), fetchers through `@/lib/api`, and the cache patch helpers every mutation shares.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { Id, Paginated, ShareCard, ShareCardKind, UserListItem, WithModeration } from '@shared/core';
import { DEFAULT_PAGE_LIMIT } from '@shared/core';
import type { CreatePostCommentRequest, CreatePostRequest, LikeState, NewPostCount, OrbitFeedResponse, Post, PostComment, PostPoll } from '@shared/orbit';
import type { InfiniteSentinelProps } from '@/ui';
import { api } from '@/lib/api';
import { queryClient, removeInfiniteItem, updateInfiniteItem, useInfiniteList } from '@/lib/query';

/* ───────────────────────────── keys ───────────────────────────── */

export const orbitKeys = {
  /** Reserved (SPEC §4.4.5). */
  feed: ['orbit', 'feed'] as const,
  post: (id: Id) => ['orbit', 'post', id] as const,
  comments: (postId: Id) => ['orbit', 'comments', postId] as const,
  likers: (postId: Id) => ['orbit', 'likers', postId] as const,
  userPosts: (userId: Id) => ['orbit', 'user', userId] as const,
  card: (kind: ShareCardKind, id: Id) => ['orbit', 'card', kind, id] as const,
};

const enc = (s: string) => encodeURIComponent(s);

/* ───────────────────────────── feed ───────────────────────────── */

export interface OrbitFeed {
  items: Post[];
  /** From the FIRST page: the previous visit marker + how many accounts the viewer follows. */
  lastVisitAt: number | null;
  followingCount: number | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch(): Promise<unknown>;
  sentinelProps: Pick<InfiniteSentinelProps, 'onReach' | 'hasMore' | 'isFetching' | 'error' | 'onRetry'>;
}

export function useOrbitFeed(enabled: boolean): OrbitFeed {
  const q = useInfiniteQuery<OrbitFeedResponse, unknown, InfiniteData<OrbitFeedResponse>, QueryKey, string | undefined>({
    queryKey: orbitKeys.feed,
    enabled,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) => api.get<OrbitFeedResponse>('/orbit/feed', { limit: DEFAULT_PAGE_LIMIT, cursor: pageParam }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const first = q.data?.pages[0];
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = q;
  return {
    items,
    lastVisitAt: first ? first.lastVisitAt : null,
    followingCount: first ? first.followingCount : null,
    isLoading: q.isLoading,
    isError: q.isError && !q.isFetchNextPageError,
    error: q.error,
    refetch,
    sentinelProps: {
      onReach: () => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      hasMore: hasNextPage,
      isFetching: isFetchingNextPage,
      error: q.isFetchNextPageError ? q.error : undefined,
      onRetry: () => void fetchNextPage(),
    },
  };
}

/**
 * Replaces the cached feed with a fresh first page WITHOUT a loading state (the "New posts" pill and pull-to-refresh):
 * the list stays painted until the new page lands. Falls back to a plain invalidate on error.
 */
export async function reloadFeed(): Promise<void> {
  try {
    const first = await api.get<OrbitFeedResponse>('/orbit/feed', { limit: DEFAULT_PAGE_LIMIT });
    queryClient.setQueryData<InfiniteData<OrbitFeedResponse, string | undefined>>(orbitKeys.feed, { pages: [first], pageParams: [undefined] });
  } catch {
    await queryClient.invalidateQueries({ queryKey: orbitKeys.feed, exact: true });
  }
}

export function fetchNewCount(since: number): Promise<NewPostCount> {
  return api.get<NewPostCount>('/orbit/feed/new-count', { since });
}

export function markFeedSeen(): Promise<void> {
  return api.post<void>('/orbit/feed/seen');
}

/* ───────────────────────────── single post / lists ───────────────────────────── */

export function usePost(id: Id, initial?: Post) {
  return useQuery<Post>({
    queryKey: orbitKeys.post(id),
    queryFn: ({ signal }) => api.get<Post>(`/orbit/posts/${enc(id)}`, undefined, { signal }),
    initialData: initial,
    staleTime: initial ? 15_000 : 0,
  });
}

export function useUserPosts(userId: Id) {
  return useInfiniteList<Post>({ queryKey: [...orbitKeys.userPosts(userId)], path: `/orbit/users/${enc(userId)}/posts` });
}

export function useComments(postId: Id, enabled = true) {
  return useInfiniteList<PostComment>({ queryKey: [...orbitKeys.comments(postId)], path: `/orbit/posts/${enc(postId)}/comments`, enabled });
}

export function useLinkCard(kind: ShareCardKind, id: Id) {
  return useQuery<ShareCard>({
    queryKey: orbitKeys.card(kind, id),
    queryFn: ({ signal }) => api.get<ShareCard>(`/cards/${kind}/${enc(id)}`, undefined, { signal }),
    staleTime: 60_000,
  });
}

export type Likers = Paginated<UserListItem>;

/* ───────────────────────────── cache patches ───────────────────────────── */

/** Applies `fn` to every cached copy of the post: feed pages, user lists, the detail query. */
export function patchPost(id: Id, fn: (p: Post) => Post): void {
  updateInfiniteItem<Post>([...orbitKeys.feed], id, fn);
  updateInfiniteItem<Post>(['orbit', 'user'], id, fn);
  queryClient.setQueryData<Post>(orbitKeys.post(id), (p) => (p ? fn(p) : p));
}

export function dropPost(id: Id): void {
  removeInfiniteItem([...orbitKeys.feed], id);
  removeInfiniteItem(['orbit', 'user'], id);
  queryClient.removeQueries({ queryKey: orbitKeys.post(id) });
}

export function seedPostDetail(post: Post): void {
  queryClient.setQueryData<Post>(orbitKeys.post(post.id), post);
}

/* ───────────────────────────── mutations ───────────────────────────── */

export function createPostRequest(body: CreatePostRequest): Promise<WithModeration<Post>> {
  return api.post<WithModeration<Post>>('/orbit/posts', body);
}

export function deletePostRequest(id: Id): Promise<void> {
  return api.delete<void>(`/orbit/posts/${enc(id)}`);
}

export function setLikeRequest(id: Id, liked: boolean): Promise<LikeState> {
  return liked ? api.put<LikeState>(`/orbit/posts/${enc(id)}/like`) : api.delete<LikeState>(`/orbit/posts/${enc(id)}/like`);
}

export function votePollRequest(id: Id, optionId: Id): Promise<PostPoll> {
  return api.post<PostPoll>(`/orbit/posts/${enc(id)}/poll/vote`, { optionId });
}

export function createCommentRequest(postId: Id, body: CreatePostCommentRequest): Promise<WithModeration<PostComment>> {
  return api.post<WithModeration<PostComment>>(`/orbit/posts/${enc(postId)}/comments`, body);
}

export function deleteCommentRequest(id: Id): Promise<void> {
  return api.delete<void>(`/orbit/comments/${enc(id)}`);
}

/**
 * Optimistic like / unlike shared by the action row and the double-tap. Patches every cached copy first, rolls back
 * on error, then settles on the server's count.
 */
export function useLikeMutation(post: Pick<Post, 'id' | 'viewer' | 'likeCount'>) {
  return useMutation<LikeState, unknown, boolean, { liked: boolean; likeCount: number }>({
    mutationFn: (next) => setLikeRequest(post.id, next),
    onMutate: (next) => {
      const snapshot = { liked: post.viewer.liked, likeCount: post.likeCount };
      patchPost(post.id, (p) => ({
        ...p,
        likeCount: Math.max(0, p.likeCount + (next === p.viewer.liked ? 0 : next ? 1 : -1)),
        viewer: { ...p.viewer, liked: next },
      }));
      return snapshot;
    },
    onError: (_e, _next, snapshot) => {
      if (snapshot) patchPost(post.id, (p) => ({ ...p, likeCount: snapshot.likeCount, viewer: { ...p.viewer, liked: snapshot.liked } }));
    },
    onSuccess: (state) => {
      patchPost(post.id, (p) => ({ ...p, likeCount: state.likeCount, viewer: { ...p.viewer, liked: state.liked } }));
    },
  });
}
