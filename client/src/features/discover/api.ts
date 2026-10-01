/**
 * Discover data layer: query keys (`['discover', …]` + the reserved foundation keys `['users', id]` /
 * `['users','handle', handle]` of SPEC §4.4.5), hooks and mutations. Every request goes through `@/lib/api`.
 */
import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  BlockResult, HandleAvailabilityResponse, Id, InviteStats, MeUser, PublicUser, UpdateMeRequest, UserListItem, WithModeration,
} from '@shared/core';
import type { DiscoverHome, DiscoverSearchType, DismissSuggestionRequest, SearchHit, Suggestion, SuggestionSection } from '@shared/discover';
import { api } from '@/lib/api';
import { queryClient, useInfiniteList } from '@/lib/query';

const enc = (s: string): string => encodeURIComponent(s);

export const discoverKeys = {
  home: () => ['discover', 'home'] as const,
  search: (q: string, type: DiscoverSearchType) => ['discover', 'search', q, type] as const,
  follows: (userId: Id, dir: 'followers' | 'following', q: string) => ['discover', 'follows', userId, dir, q] as const,
  handle: (handle: string) => ['discover', 'handle-available', handle] as const,
  invite: () => ['discover', 'invite'] as const,
  /** Reserved foundation keys (§4.4.5) — MUST be exactly these. */
  user: (id: Id) => ['users', id] as const,
  userByHandle: (handle: string) => ['users', 'handle', handle.toLowerCase()] as const,
};

/* ------------------------------------------------------------------ home */

export function useDiscoverHome() {
  return useQuery({
    queryKey: discoverKeys.home(),
    queryFn: () => api.get<DiscoverHome>('/discover/home'),
  });
}

function sectionField(section: SuggestionSection): keyof Pick<DiscoverHome, 'peopleYouMayKnow' | 'activeCreators' | 'popularOrgs'> {
  if (section === 'people_you_may_know') return 'peopleYouMayKnow';
  if (section === 'active_creators') return 'activeCreators';
  return 'popularOrgs';
}

/**
 * Optimistic dismiss: the card leaves the cached home immediately; the server row makes it stick.
 * `suggestion_dismiss` is tracked by the endpoint (SPEC §5.5), never here — otherwise a rejected or rolled-back
 * dismissal would still count.
 */
export function useDismissSuggestion() {
  return useMutation<void, unknown, Suggestion, { previous: DiscoverHome | undefined }>({
    mutationFn: (s) => {
      const body: DismissSuggestionRequest = { userId: s.user.id, section: s.section };
      return api.post<void>('/discover/dismiss', body);
    },
    onMutate: (s) => {
      const previous = queryClient.getQueryData<DiscoverHome>(discoverKeys.home());
      queryClient.setQueryData<DiscoverHome>(discoverKeys.home(), (home) => {
        if (!home) return home;
        const field = sectionField(s.section);
        return { ...home, [field]: home[field].filter((x) => x.user.id !== s.user.id) };
      });
      return { previous };
    },
    onError: (_e, _s, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(discoverKeys.home(), ctx.previous);
    },
  });
}

/* ------------------------------------------------------------------ search */

export function useDiscoverSearch(q: string, type: DiscoverSearchType) {
  return useInfiniteList<SearchHit>({
    queryKey: [...discoverKeys.search(q, type)],
    path: '/discover/search',
    query: { q, type },
    enabled: q.length > 0,
  });
}

/* ------------------------------------------------------------------ profiles (foundation endpoints #22–#23) */

/**
 * Profile by handle. The row is ALSO written to the reserved `['users', id]` key (§4.4.5), which `FollowButton`
 * patches / invalidates after a follow, so the page re-renders from the id key once it exists.
 */
export function useProfile(handle: string) {
  const byHandle = useQuery({
    queryKey: discoverKeys.userByHandle(handle),
    queryFn: () => api.get<PublicUser>(`/users/${enc(handle)}`),
    enabled: handle.length > 0,
  });
  const id = byHandle.data?.id;
  useEffect(() => {
    if (byHandle.data) queryClient.setQueryData(discoverKeys.user(byHandle.data.id), byHandle.data);
  }, [byHandle.data]);
  const byId = useQuery({
    queryKey: discoverKeys.user(id ?? ''),
    queryFn: () => api.get<PublicUser>(`/users/by-id/${enc(id ?? '')}`),
    enabled: !!id,
  });
  return {
    user: byId.data ?? byHandle.data ?? null,
    isLoading: byHandle.isLoading,
    isError: byHandle.isError,
    error: byHandle.error,
    refetch: byHandle.refetch,
  };
}

export function invalidateProfile(user: Pick<PublicUser, 'id' | 'handle'>): void {
  void queryClient.invalidateQueries({ queryKey: discoverKeys.user(user.id) });
  void queryClient.invalidateQueries({ queryKey: discoverKeys.userByHandle(user.handle) });
}

export function useUnblock() {
  return useMutation<BlockResult, unknown, Pick<PublicUser, 'id' | 'handle'>>({
    mutationFn: (u) => api.delete<BlockResult>(`/users/${enc(u.id)}/block`),
    onSuccess: (_r, u) => {
      invalidateProfile(u);
      void queryClient.invalidateQueries({ queryKey: discoverKeys.home() });
    },
  });
}

/* ------------------------------------------------------------------ follow lists (#24) */

export function useFollowList(userId: Id | null, dir: 'followers' | 'following', q: string) {
  return useInfiniteList<UserListItem>({
    queryKey: [...discoverKeys.follows(userId ?? '', dir, q)],
    path: `/users/${enc(userId ?? '')}/${dir}`,
    query: q ? { q } : undefined,
    enabled: !!userId,
  });
}

/* ------------------------------------------------------------------ edit profile (#10, #5) */

export function useUpdateMe() {
  return useMutation<WithModeration<MeUser>, unknown, UpdateMeRequest>({
    mutationFn: (body) => api.patch<WithModeration<MeUser>>('/me', body),
  });
}

export function useHandleAvailability(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: discoverKeys.handle(handle),
    queryFn: () => api.get<HandleAvailabilityResponse>('/auth/handle-available', { handle }),
    enabled: enabled && handle.length > 0,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ invite (#16) */

export function fetchInvite(): Promise<InviteStats> {
  return queryClient.fetchQuery({ queryKey: discoverKeys.invite(), queryFn: () => api.get<InviteStats>('/me/invite'), staleTime: 60_000 });
}
