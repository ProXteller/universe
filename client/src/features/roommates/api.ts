/**
 * Roommates data layer — query keys (`['roommates', …]`), hooks and mutations. Every request goes through `@/lib/api`.
 *
 * Key layout: `['roommates','list', …]` is reserved for the infinite lists (browse / saved) so the optimistic save
 * patch (`updateInfiniteItem`) never touches the plain `me` / `detail` / `places` caches.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CampusPlace, Id, Paginated, WithModeration } from '@shared/core';
import type {
  MyRoommateProfile, MyRoommateProfileResponse, RoommateCard, RoommateDetail, RoommateFilters, SaveResponse, UpsertRoommateProfileRequest,
} from '@shared/roommates';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { queryClient, updateInfiniteItem, useInfiniteList } from '@/lib/query';

export const roommateKeys = {
  all: () => ['roommates'] as const,
  lists: () => ['roommates', 'list'] as const,
  browse: (filters: RoommateFilters) => ['roommates', 'list', 'browse', filters] as const,
  saved: () => ['roommates', 'list', 'saved'] as const,
  me: () => ['roommates', 'me'] as const,
  detail: (id: Id) => ['roommates', 'detail', id] as const,
  places: () => ['roommates', 'places'] as const,
};

/* ------------------------------------------------------------------ reads */

export function useBrowse(filters: RoommateFilters) {
  return useInfiniteList<RoommateCard>({
    queryKey: [...roommateKeys.browse(filters)],
    path: '/roommates',
    query: { ...filters },
  });
}

export function useSaved() {
  return useInfiniteList<RoommateCard>({ queryKey: [...roommateKeys.saved()], path: '/roommates/saved' });
}

export function useMyProfile() {
  return useQuery({
    queryKey: roommateKeys.me(),
    queryFn: () => api.get<MyRoommateProfileResponse>('/roommates/me'),
  });
}

export function useRoommate(id: Id | undefined) {
  return useQuery({
    queryKey: roommateKeys.detail(id ?? ''),
    queryFn: () => api.get<RoommateDetail>(`/roommates/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });
}

/** Campus neighborhood presets (foundation #28). */
export function useNeighborhoods() {
  return useQuery({
    queryKey: roommateKeys.places(),
    queryFn: () => api.get<Paginated<CampusPlace>>('/universities/me/places', { kind: 'neighborhood' }),
    select: (p) => p.items.map((x) => x.name),
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------------------------------------------ writes */

function setMe(profile: MyRoommateProfile | null): void {
  queryClient.setQueryData<MyRoommateProfileResponse>(roommateKeys.me(), { profile });
}

async function invalidateAll(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: roommateKeys.all() });
}

export function useUpsertProfile() {
  return useMutation({
    mutationFn: (body: UpsertRoommateProfileRequest) => api.put<WithModeration<MyRoommateProfile>>('/roommates/me', body),
    onSuccess: (res) => {
      const { moderation: _m, ...profile } = res;
      setMe(profile);
      void invalidateAll();
    },
  });
}

type MeAction = 'pause' | 'resume' | 'confirm' | 'unpublish';

export function useProfileAction() {
  return useMutation({
    mutationFn: (action: MeAction) => api.post<MyRoommateProfile>(`/roommates/me/${action}`),
    onSuccess: (profile) => {
      setMe(profile);
      void invalidateAll();
    },
  });
}

export function useDeleteProfile() {
  return useMutation({
    mutationFn: () => api.delete<void>('/roommates/me'),
    onSuccess: () => {
      setMe(null);
      void invalidateAll();
    },
  });
}

/** Silent save / unsave with an optimistic flip on every cached card + detail. */
export function useSaveToggle() {
  return useMutation<SaveResponse, unknown, { id: Id; saved: boolean }, { id: Id; previous: boolean }>({
    mutationFn: ({ id, saved }) =>
      saved ? api.put<SaveResponse>(`/roommates/${encodeURIComponent(id)}/save`) : api.delete<SaveResponse>(`/roommates/${encodeURIComponent(id)}/save`),
    onMutate: ({ id, saved }) => {
      const detail = queryClient.getQueryData<RoommateDetail>(roommateKeys.detail(id));
      const previous = detail?.saved ?? !saved;
      applySaved(id, saved);
      if (saved) track('roommate_save');
      return { id, previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) applySaved(ctx.id, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: roommateKeys.saved() });
    },
  });
}

function applySaved(id: Id, saved: boolean): void {
  updateInfiniteItem<RoommateCard>([...roommateKeys.lists()], id, (c) => ({ ...c, saved }));
  queryClient.setQueryData<RoommateDetail>(roommateKeys.detail(id), (d) => (d ? { ...d, saved } : d));
}
