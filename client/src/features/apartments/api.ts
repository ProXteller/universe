/**
 * `apartments` data hooks. Query keys start with `'apartments'` except the reserved notification key
 * `['notifications', filter]` (SPEC §4.4.5 — foundation invalidates it on ws reconnect and on every `notification`
 * event). All requests go through `@/lib/api`.
 */
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  AppealReceipt, Badges, BlockResult, BlockedUserRow, CreateAppealRequest, Id, InviteStats, MarkNotificationsReadRequest, Notification,
  NotificationFilter, Paginated, SanctionNotice, UpdateSettingsRequest, UserSettings, WaitlistState,
} from '@shared/core';
import { NOTIFICATION_FILTERS } from '@shared/core';
import type { SurveyAnswerRequest, SurveyQuestionId, SurveySplit, SurveyState } from '@shared/apartments';
import { SURVEY_QUESTION_IDS } from '@shared/apartments';
import { api } from '@/lib/api';
import { prependInfiniteItem, queryClient, useInfiniteList, type UseInfiniteListResult } from '@/lib/query';
import { setMe, useMe } from '@/lib/session';

export const keys = {
  waitlist: ['apartments', 'waitlist'] as const,
  survey: ['apartments', 'survey'] as const,
  settings: ['apartments', 'settings'] as const,
  blocks: ['apartments', 'blocks'] as const,
  invite: ['apartments', 'invite'] as const,
  sanctions: ['apartments', 'sanctions'] as const,
  /** Reserved foundation key (§4.4.5) — used verbatim. */
  notifications: (filter: NotificationFilter) => ['notifications', filter] as const,
};

const enc = (s: string) => encodeURIComponent(s);

/* ------------------------------------------------------------------ waitlist (#34–#35) */

export function useWaitlist(): UseQueryResult<WaitlistState> {
  return useQuery<WaitlistState>({ queryKey: keys.waitlist, queryFn: () => api.get<WaitlistState>('/waitlist/apartments') });
}

/** Optimistic join / leave: the button morphs at once, the real counts land with the response. */
export function useWaitlistToggle() {
  return useMutation<WaitlistState, unknown, { join: boolean; source: string }, { prev: WaitlistState | undefined }>({
    mutationFn: ({ join, source }) =>
      join ? api.post<WaitlistState>('/waitlist/apartments', { source }) : api.delete<WaitlistState>('/waitlist/apartments'),
    onMutate: async ({ join }) => {
      await queryClient.cancelQueries({ queryKey: keys.waitlist });
      const prev = queryClient.getQueryData<WaitlistState>(keys.waitlist);
      if (prev && prev.joined !== join) {
        const delta = join ? 1 : -1;
        queryClient.setQueryData<WaitlistState>(keys.waitlist, {
          ...prev,
          joined: join,
          joinedAt: join ? Date.now() : null,
          campusCount: Math.max(0, prev.campusCount + delta),
          totalCount: Math.max(0, prev.totalCount + delta),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(keys.waitlist, ctx.prev);
    },
    onSuccess: (state) => {
      queryClient.setQueryData(keys.waitlist, state);
    },
  });
}

/* ------------------------------------------------------------------ survey (slice endpoints) */

export function useSurvey(enabled: boolean): UseQueryResult<SurveyState> {
  return useQuery<SurveyState>({ queryKey: keys.survey, queryFn: () => api.get<SurveyState>('/apartments/survey'), enabled });
}

function mergeSurvey(prev: SurveyState | undefined, question: SurveyQuestionId, answer: string[], split: SurveySplit): SurveyState {
  const answers = { ...(prev?.answers ?? {}), [question]: answer };
  const splits = [...(prev?.splits ?? []).filter((s) => s.question !== question), split].sort(
    (a, b) => SURVEY_QUESTION_IDS.indexOf(a.question) - SURVEY_QUESTION_IDS.indexOf(b.question),
  );
  return { answers, completed: SURVEY_QUESTION_IDS.every((q) => (answers[q]?.length ?? 0) > 0), splits };
}

export function useAnswerSurvey() {
  return useMutation<SurveySplit, unknown, { question: SurveyQuestionId; answer: string[] }>({
    mutationFn: ({ question, answer }) => api.put<SurveySplit>(`/apartments/survey/${enc(question)}`, { answer } satisfies SurveyAnswerRequest),
    onSuccess: (split, vars) => {
      queryClient.setQueryData<SurveyState>(keys.survey, (prev) => mergeSurvey(prev, vars.question, vars.answer, split));
    },
  });
}

/* ------------------------------------------------------------------ notifications (#31–#32) */

export function useNotifications(filter: NotificationFilter): UseInfiniteListResult<Notification> {
  return useInfiniteList<Notification>({ queryKey: [...keys.notifications(filter)], path: '/notifications', query: { filter } });
}

type Pages = { pages: Paginated<Notification>[]; pageParams: unknown[] };

function patchCached(fn: (n: Notification) => Notification): void {
  queryClient.setQueriesData<Pages>({ queryKey: ['notifications'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn) })) } : data,
  );
}

/** Marks rows read optimistically in every cached filter list, then syncs the nav badges from the response. */
export async function markNotificationsRead(ids: Id[] | 'all'): Promise<void> {
  const set = ids === 'all' ? null : new Set(ids);
  patchCached((n) => (set === null || set.has(n.id) ? (n.read ? n : { ...n, read: true }) : n));
  try {
    const badges = await api.post<Badges>('/notifications/read', { ids } satisfies MarkNotificationsReadRequest);
    queryClient.setQueryData(['badges'], badges);
  } catch (e) {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    throw e;
  }
}

/** A live `notification` ws event: prepend to every cached list whose filter admits its category. */
export function prependNotification(n: Notification): void {
  for (const filter of Object.keys(NOTIFICATION_FILTERS) as NotificationFilter[]) {
    const cats = NOTIFICATION_FILTERS[filter] as readonly string[] | null;
    if (cats === null || cats.includes(n.category)) prependInfiniteItem<Notification>([...keys.notifications(filter)], n);
  }
}

/* ------------------------------------------------------------------ settings (#13) */

export function useSettings(): UseQueryResult<UserSettings> {
  const me = useMe();
  return useQuery<UserSettings>({
    queryKey: keys.settings,
    queryFn: () => api.get<UserSettings>('/me/settings'),
    placeholderData: me.settings,
  });
}

function applySettingsPatch(current: UserSettings, patch: UpdateSettingsRequest): UserSettings {
  return {
    ...current,
    notifications: { ...current.notifications, ...(patch.notifications ?? {}), safety: true },
    quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) },
    whoCanMessage: patch.whoCanMessage ?? current.whoCanMessage,
    showPresence: patch.showPresence ?? current.showPresence,
    autoplayVideos: patch.autoplayVideos ?? current.autoplayVideos,
    reduceMotion: patch.reduceMotion ?? current.reduceMotion,
  };
}

/** Optimistic PATCH; the session's `me.settings` follows so Reduce motion applies immediately. */
export function useUpdateSettings() {
  const me = useMe();
  return useMutation<UserSettings, unknown, UpdateSettingsRequest, { prev: UserSettings | undefined }>({
    mutationFn: (patch) => api.patch<UserSettings>('/me/settings', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: keys.settings });
      const prev = queryClient.getQueryData<UserSettings>(keys.settings) ?? me.settings;
      const next = applySettingsPatch(prev, patch);
      queryClient.setQueryData(keys.settings, next);
      setMe({ ...me, settings: next });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(keys.settings, ctx.prev);
        setMe({ ...me, settings: ctx.prev });
      }
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(keys.settings, settings);
      setMe({ ...me, settings });
    },
  });
}

/* ------------------------------------------------------------------ blocks (#15, #26) */

export function useBlockedUsers(): UseInfiniteListResult<BlockedUserRow> {
  return useInfiniteList<BlockedUserRow>({ queryKey: [...keys.blocks], path: '/me/blocks' });
}

export function useUnblock() {
  return useMutation<BlockResult, unknown, Id>({
    mutationFn: (userId) => api.delete<BlockResult>(`/users/${enc(userId)}/block`),
    onSuccess: (_r, userId) => {
      queryClient.setQueriesData<{ pages: Paginated<BlockedUserRow>[]; pageParams: unknown[] }>({ queryKey: [...keys.blocks] }, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((row) => row.user.id !== userId) })) } : data,
      );
      void queryClient.invalidateQueries({ queryKey: ['users', userId] });
      void queryClient.invalidateQueries({ queryKey: ['users', 'handle'] });
    },
  });
}

/* ------------------------------------------------------------------ invite (#16) */

export function useInvite(): UseQueryResult<InviteStats> {
  return useQuery<InviteStats>({ queryKey: keys.invite, queryFn: () => api.get<InviteStats>('/me/invite') });
}

/* ------------------------------------------------------------------ sanctions + appeals (#17–#19; allowed while restricted) */

export function useSanctions(): UseQueryResult<Paginated<SanctionNotice>> {
  return useQuery<Paginated<SanctionNotice>>({ queryKey: keys.sanctions, queryFn: () => api.get<Paginated<SanctionNotice>>('/me/sanctions') });
}

function patchSanction(id: Id, fn: (s: SanctionNotice) => SanctionNotice): void {
  queryClient.setQueryData<Paginated<SanctionNotice>>(keys.sanctions, (d) => (d ? { ...d, items: d.items.map((s) => (s.id === id ? fn(s) : s)) } : d));
  void queryClient.invalidateQueries({ queryKey: ['me', 'sanctions'] });
}

export function useAcknowledgeSanction() {
  return useMutation<void, unknown, Id>({
    mutationFn: (id) => api.post<void>(`/me/sanctions/${enc(id)}/ack`),
    onSuccess: (_r, id) => patchSanction(id, (s) => ({ ...s, acknowledgedAt: Date.now() })),
  });
}

export function useAppeal() {
  return useMutation<AppealReceipt, unknown, CreateAppealRequest>({
    mutationFn: (body) => api.post<AppealReceipt>('/appeals', body),
    onSuccess: (receipt) => patchSanction(receipt.sanctionId, (s) => ({ ...s, appealStatus: receipt.status, canAppeal: false })),
  });
}

/* ------------------------------------------------------------------ delete account (#20) */

export function deleteAccount(): Promise<void> {
  return api.delete<void>('/me', { confirm: 'DELETE' });
}
