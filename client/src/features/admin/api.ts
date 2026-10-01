/**
 * Admin data layer — query keys (`['admin', …]`), hooks and mutations. Every request goes through `@/lib/api`.
 * The unmask mutation keeps `gcTime: 0` (safety §6.5: the identity is never cached).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Id, Paginated } from '@shared/core';
import type {
  AnalyticsOverview, AnalyticsQuery, ApartmentsFunnel, AppealDecisionRequest, AuditQuery, AuditRow, BulkActionRequest, BulkActionResponse, LiftSanctionRequest,
  ModerationMetrics, QueueCounts, QueueListQuery, RulePackRow, StaffActionRequest, StaffAppeal, StaffQueueItem, StaffQueueItemDetail, StaffRoleRequest,
  StaffSanctionRequest, StaffUserDetail, StaffVerifyRequest, UnmaskRequest, UnmaskResponse,
} from '@shared/admin';
import { LIMITATIONS } from '@shared/admin';
import { api, errorMessage } from '@/lib/api';
import { handleModerationError } from '@/lib/moderation';
import { queryClient, useInfiniteList } from '@/lib/query';
import { toast } from '@/lib/toast';

export type QueueFilters = Pick<QueueListQuery, 'view' | 'surface' | 'category' | 'source' | 'universityId' | 'q'>;
export type AuditFilters = Pick<AuditQuery, 'actor' | 'action' | 'targetType' | 'from' | 'to'>;

export const adminKeys = {
  all: () => ['admin'] as const,
  queue: (f: QueueFilters) => ['admin', 'queue', 'list', f] as const,
  counts: () => ['admin', 'queue', 'counts'] as const,
  item: (id: Id) => ['admin', 'queue', 'item', id] as const,
  users: (q: string) => ['admin', 'users', 'list', q] as const,
  user: (id: Id) => ['admin', 'users', 'detail', id] as const,
  appeals: (status: string) => ['admin', 'appeals', 'list', status] as const,
  audit: (f: AuditFilters) => ['admin', 'audit', 'list', f] as const,
  overview: (q: AnalyticsQuery) => ['admin', 'analytics', 'overview', q] as const,
  funnel: (q: AnalyticsQuery) => ['admin', 'analytics', 'apartments', q] as const,
  metrics: (q: AnalyticsQuery) => ['admin', 'analytics', 'moderation', q] as const,
  rulePacks: () => ['admin', 'rule-packs'] as const,
  limitations: () => ['admin', 'limitations'] as const,
};

export function onMutationError(e: unknown): void {
  if (!handleModerationError(e)) toast.error(errorMessage(e));
}

function invalidateAdmin(): void {
  void queryClient.invalidateQueries({ queryKey: adminKeys.all() });
}

/* ------------------------------------------------------------------ queue */

export function useQueueList(filters: QueueFilters) {
  return useInfiniteList<StaffQueueItem>({ queryKey: [...adminKeys.queue(filters)], path: '/admin/queue', query: { ...filters } });
}

export function useQueueCounts() {
  return useQuery({ queryKey: adminKeys.counts(), queryFn: () => api.get<QueueCounts>('/admin/queue/counts'), staleTime: 15_000 });
}

export function useQueueItem(id: Id | undefined) {
  return useQuery({
    queryKey: adminKeys.item(id ?? ''),
    queryFn: () => api.get<StaffQueueItemDetail>(`/admin/queue/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });
}

export function useQueueAction(id: Id) {
  return useMutation({
    mutationFn: (body: StaffActionRequest) => api.post<StaffQueueItemDetail>(`/admin/queue/${encodeURIComponent(id)}/actions`, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(adminKeys.item(id), detail);
      invalidateAdmin();
    },
    onError: onMutationError,
  });
}

export function useClaim(id: Id) {
  return useMutation({
    mutationFn: (mode: 'claim' | 'release') => api.post<StaffQueueItem>(`/admin/queue/${encodeURIComponent(id)}/${mode}`),
    onSuccess: () => invalidateAdmin(),
    onError: onMutationError,
  });
}

export function useBulk() {
  return useMutation({
    mutationFn: (body: BulkActionRequest) => api.post<BulkActionResponse>('/admin/queue/bulk', body),
    onSuccess: () => invalidateAdmin(),
    onError: onMutationError,
  });
}

/** `id` = the Buzz entity id, or the queue item id for blocked text (no entity; threats / self-harm risk only). */
export function useUnmask(entityType: 'buzz' | 'buzz_reply', id: Id) {
  return useMutation({
    mutationFn: (body: UnmaskRequest) => api.post<UnmaskResponse>(`/admin/buzz/${entityType}/${encodeURIComponent(id)}/unmask`, body),
    gcTime: 0,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
  });
}

/* ------------------------------------------------------------------ users */

export function useUserSearch(q: string) {
  return useInfiniteList<StaffUserDetail>({ queryKey: [...adminKeys.users(q)], path: '/admin/users', query: { q }, enabled: q.trim().length >= 2 });
}

export function useStaffUser(id: Id | undefined) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    queryFn: () => api.get<StaffUserDetail>(`/admin/users/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });
}

function userMutation<B>(path: (id: Id) => string) {
  return (id: Id) =>
    useMutation({
      mutationFn: (body: B) => api.post<StaffUserDetail>(path(id), body),
      onSuccess: (detail) => {
        queryClient.setQueryData(adminKeys.user(id), detail);
        invalidateAdmin();
      },
      onError: onMutationError,
    });
}

export const useSetRole = userMutation<StaffRoleRequest>((id) => `/admin/users/${encodeURIComponent(id)}/role`);
export const useSetVerified = userMutation<StaffVerifyRequest>((id) => `/admin/users/${encodeURIComponent(id)}/verify`);
export const useDirectSanction = userMutation<StaffSanctionRequest>((id) => `/admin/users/${encodeURIComponent(id)}/sanctions`);

export function useLiftSanction(userId: Id) {
  return useMutation({
    mutationFn: (input: { sanctionId: Id } & LiftSanctionRequest) => api.post<StaffUserDetail>(`/admin/sanctions/${encodeURIComponent(input.sanctionId)}/lift`, { note: input.note }),
    onSuccess: (detail) => {
      queryClient.setQueryData(adminKeys.user(userId), detail);
      invalidateAdmin();
    },
    onError: onMutationError,
  });
}

/* ------------------------------------------------------------------ appeals */

export function useAppeals(status: string) {
  return useInfiniteList<StaffAppeal>({ queryKey: [...adminKeys.appeals(status)], path: '/admin/appeals', query: { status } });
}

export function useDecideAppeal() {
  return useMutation({
    mutationFn: (input: { id: Id } & AppealDecisionRequest) => {
      const { id, ...body } = input;
      return api.post<StaffAppeal>(`/admin/appeals/${encodeURIComponent(id)}/decide`, body);
    },
    onSuccess: () => invalidateAdmin(),
    onError: onMutationError,
  });
}

/* ------------------------------------------------------------------ audit */

export function useAudit(filters: AuditFilters) {
  return useInfiniteList<AuditRow>({ queryKey: [...adminKeys.audit(filters)], path: '/admin/audit', query: { ...filters } });
}

/* ------------------------------------------------------------------ analytics */

export function useOverview(q: AnalyticsQuery) {
  return useQuery({ queryKey: adminKeys.overview(q), queryFn: () => api.get<AnalyticsOverview>('/admin/analytics/overview', { ...q }) });
}
export function useFunnel(q: AnalyticsQuery) {
  return useQuery({ queryKey: adminKeys.funnel(q), queryFn: () => api.get<ApartmentsFunnel>('/admin/analytics/apartments', { ...q }) });
}
export function useMetrics(q: AnalyticsQuery) {
  return useQuery({ queryKey: adminKeys.metrics(q), queryFn: () => api.get<ModerationMetrics>('/admin/analytics/moderation', { ...q }) });
}

/* ------------------------------------------------------------------ rule packs + limitations */

export function useRulePacks(enabled: boolean) {
  return useQuery({ queryKey: adminKeys.rulePacks(), queryFn: () => api.get<Paginated<RulePackRow>>('/admin/rule-packs'), enabled, select: (p) => p.items });
}

export function useTogglePack() {
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => api.patch<RulePackRow>(`/admin/rule-packs/${encodeURIComponent(input.id)}`, { enabled: input.enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.rulePacks() }),
    onError: onMutationError,
  });
}

export function useLimitations() {
  return useQuery({
    queryKey: adminKeys.limitations(),
    queryFn: () => api.get<Paginated<(typeof LIMITATIONS)[number]>>('/admin/limitations'),
    select: (p) => p.items,
    staleTime: 60 * 60_000,
    placeholderData: { items: LIMITATIONS, nextCursor: null },
  });
}
