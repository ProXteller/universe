/**
 * Reels data layer: query keys (prefix `['reels', …]`; `['reels','following']` is the reserved rail key of SPEC §4.4.5),
 * the HTTP calls (all through `@/lib/api`) and the cache patches shared by the pane, the deep-link page and the grid.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FeedScope, Id, Paginated, WithModeration } from '@shared/core';
import type { CreateReelCommentRequest, CreateReelRequest, LikeState, Reel, ReelComment } from '@shared/reels';
import { api, errorMessage } from '@/lib/api';
import { handleModerationError } from '@/lib/moderation';
import { prependInfiniteItem, queryClient, removeInfiniteItem, updateInfiniteItem, useInfiniteList } from '@/lib/query';
import { toast } from '@/lib/toast';

export const reelKeys = {
  all: ['reels'] as const,
  feed: (scope: FeedScope) => ['reels', 'feed', scope] as const,
  /** Reserved (SPEC §4.4.5): foundation invalidates it after follow / unfollow / block. */
  following: ['reels', 'following'] as const,
  user: (userId: Id) => ['reels', 'user', userId] as const,
  detail: (id: Id) => ['reels', 'detail', id] as const,
  comments: (reelId: Id) => ['reels', 'comments', reelId] as const,
  replies: (commentId: Id) => ['reels', 'replies', commentId] as const,
  likers: (reelId: Id) => ['reels', 'likers', reelId] as const,
};

const enc = (s: string) => encodeURIComponent(s);

/* ───────────────────────────── reads ───────────────────────────── */

export function useReelFeed(scope: FeedScope, enabled: boolean) {
  return useInfiniteList<Reel>({ queryKey: [...reelKeys.feed(scope)], path: '/reels/feed', query: { scope }, enabled, limit: 8 });
}

export function useUserReels(userId: Id) {
  return useInfiniteList<Reel>({ queryKey: [...reelKeys.user(userId)], path: `/reels/user/${enc(userId)}`, limit: 18 });
}

export function useReel(id: Id | undefined) {
  return useQuery<Reel>({
    queryKey: reelKeys.detail(id ?? ''),
    queryFn: () => api.get<Reel>(`/reels/${enc(id!)}`),
    enabled: Boolean(id),
    initialData: () => (id ? findCachedReel(id) : undefined),
    initialDataUpdatedAt: () => (id && findCachedReel(id) ? Date.now() - 60_000 : undefined),
  });
}

export function useFollowingReels(enabled = true) {
  return useQuery<Paginated<Reel>>({
    queryKey: reelKeys.following,
    queryFn: () => api.get<Paginated<Reel>>('/reels/following', { limit: 20 }),
    enabled,
    staleTime: 60_000,
  });
}

export function useReelComments(reelId: Id, enabled: boolean) {
  return useInfiniteList<ReelComment>({ queryKey: [...reelKeys.comments(reelId)], path: `/reels/${enc(reelId)}/comments`, enabled, limit: 20 });
}

export function useCommentReplies(commentId: Id, enabled: boolean) {
  return useInfiniteList<ReelComment>({ queryKey: [...reelKeys.replies(commentId)], path: `/reels/comments/${enc(commentId)}/replies`, enabled, limit: 20 });
}

/** The reel as any cached list or detail knows it (lets the deep-link page paint before its own fetch). */
export function findCachedReel(id: Id): Reel | undefined {
  const detail = queryClient.getQueryData<Reel>(reelKeys.detail(id));
  if (detail) return detail;
  for (const [, data] of queryClient.getQueriesData<{ pages: Paginated<Reel>[] }>({ queryKey: ['reels'] })) {
    const pages = data?.pages;
    if (!pages) continue;
    for (const p of pages) {
      const hit = p.items.find((r) => r && r.id === id && 'videoUrl' in r);
      if (hit) return hit;
    }
  }
  return undefined;
}

/* ───────────────────────────── cache patches ───────────────────────────── */

/** Patches one reel in every reels list + its detail query. */
export function patchReel(id: Id, fn: (r: Reel) => Reel): void {
  updateInfiniteItem<Reel>([...reelKeys.all], id, fn);
  queryClient.setQueryData<Reel>(reelKeys.detail(id), (r) => (r ? fn(r) : r));
}

export function dropReel(id: Id): void {
  removeInfiniteItem([...reelKeys.all], id);
  queryClient.removeQueries({ queryKey: reelKeys.detail(id) });
}

/** After a successful upload: the reel leads the campus feed, the global feed (when global) and the own grid. */
export function insertNewReel(reel: Reel): void {
  prependInfiniteItem([...reelKeys.feed('campus')], reel);
  if (reel.visibility === 'global') prependInfiniteItem([...reelKeys.feed('global')], reel);
  prependInfiniteItem([...reelKeys.user(reel.author.id)], reel);
  queryClient.setQueryData(reelKeys.detail(reel.id), reel);
  void queryClient.invalidateQueries({ queryKey: reelKeys.user(reel.author.id) });
}

/* ───────────────────────────── writes ───────────────────────────── */

export function createReel(body: CreateReelRequest): Promise<WithModeration<Reel>> {
  return api.post<WithModeration<Reel>>('/reels', body);
}

export function deleteReel(id: Id): Promise<void> {
  return api.delete<void>(`/reels/${enc(id)}`);
}

/** Fire-and-forget view ping (idempotent server-side). */
export function recordView(id: Id, completed = false): void {
  api.post<void>(`/reels/${enc(id)}/view`, completed ? { completed: true } : {}).catch(() => undefined);
}

export function notInterested(id: Id): Promise<void> {
  return api.post<void>(`/reels/${enc(id)}/not-interested`);
}

/** Optimistic like / unlike across every cache; reverts on error. */
export function useToggleReelLike() {
  return useMutation<LikeState, unknown, Reel, { prev: Reel }>({
    mutationFn: (reel) => (reel.viewer.liked ? api.delete<LikeState>(`/reels/${enc(reel.id)}/like`) : api.put<LikeState>(`/reels/${enc(reel.id)}/like`)),
    onMutate: (reel) => {
      const next = !reel.viewer.liked;
      patchReel(reel.id, (r) => ({ ...r, likeCount: Math.max(0, r.likeCount + (next ? 1 : -1)), viewer: { ...r.viewer, liked: next } }));
      return { prev: reel };
    },
    onSuccess: (state, reel) => {
      patchReel(reel.id, (r) => ({ ...r, likeCount: state.likeCount, viewer: { ...r.viewer, liked: state.liked } }));
    },
    onError: (e, _reel, ctxt) => {
      if (ctxt) patchReel(ctxt.prev.id, (r) => ({ ...r, likeCount: ctxt.prev.likeCount, viewer: { ...r.viewer, liked: ctxt.prev.viewer.liked } }));
      toast.error(errorMessage(e));
    },
  });
}

/* ───────────────────────────── comments ───────────────────────────── */

export function createComment(reelId: Id, body: CreateReelCommentRequest): Promise<WithModeration<ReelComment>> {
  return api.post<WithModeration<ReelComment>>(`/reels/${enc(reelId)}/comments`, body);
}

export function deleteComment(id: Id): Promise<void> {
  return api.delete<void>(`/reels/comments/${enc(id)}`);
}

function patchComment(reelId: Id, id: Id, fn: (c: ReelComment) => ReelComment): void {
  // top-level rows + previewed replies in the comments list, and rows in every replies list
  updateInfiniteItem<ReelComment>([...reelKeys.comments(reelId)], id, fn);
  queryClient.setQueriesData<{ pages: Paginated<ReelComment>[] }>({ queryKey: reelKeys.comments(reelId) }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => ({ ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) })) })) } : data,
  );
  updateInfiniteItem<ReelComment>(['reels', 'replies'], id, fn);
}

export function useToggleCommentLike(reelId: Id) {
  return useMutation<LikeState, unknown, ReelComment, { prev: ReelComment }>({
    mutationFn: (c) => (c.viewer.liked ? api.delete<LikeState>(`/reels/comments/${enc(c.id)}/like`) : api.put<LikeState>(`/reels/comments/${enc(c.id)}/like`)),
    onMutate: (c) => {
      const next = !c.viewer.liked;
      patchComment(reelId, c.id, (x) => ({ ...x, likeCount: Math.max(0, x.likeCount + (next ? 1 : -1)), viewer: { ...x.viewer, liked: next } }));
      return { prev: c };
    },
    onSuccess: (state, c) => patchComment(reelId, c.id, (x) => ({ ...x, likeCount: state.likeCount, viewer: { ...x.viewer, liked: state.liked } })),
    onError: (e, _c, ctxt) => {
      if (ctxt) patchComment(reelId, ctxt.prev.id, (x) => ({ ...x, likeCount: ctxt.prev.likeCount, viewer: { ...x.viewer, liked: ctxt.prev.viewer.liked } }));
      toast.error(errorMessage(e));
    },
  });
}

export function useDeleteComment(reelId: Id) {
  return useMutation<void, unknown, ReelComment>({
    mutationFn: (c) => deleteComment(c.id),
    onSuccess: (_v, c) => {
      const removed = 1 + (c.parentId === null ? c.replyCount : 0);
      if (c.parentId === null) removeInfiniteItem([...reelKeys.comments(reelId)], c.id);
      else {
        removeInfiniteItem([...reelKeys.replies(c.parentId)], c.id);
        patchComment(reelId, c.parentId, (p) => ({ ...p, replyCount: Math.max(0, p.replyCount - 1), replies: p.replies.filter((r) => r.id !== c.id) }));
      }
      patchReel(reelId, (r) => ({ ...r, commentCount: Math.max(0, r.commentCount - removed) }));
      toast.success('Comment deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Shared error path for every reels write (SPEC §3.1 client rule). */
export function onWriteError(e: unknown, opts?: { onEdit?(): void }): void {
  if (!handleModerationError(e, opts)) toast.error(errorMessage(e));
}
