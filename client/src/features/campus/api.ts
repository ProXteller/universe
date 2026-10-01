/**
 * Campus data layer: query keys (`['campus', …]`), fetchers through `@/lib/api`, the cache patch helpers the RSVP
 * mutation shares, and the market summary the hub's Today strip reads over HTTP (SPEC §6: `GET /api/market/summary`).
 */
import { useQuery } from '@tanstack/react-query';
import type { Id, MarketSummary, Paginated, UserListItem, WithModeration } from '@shared/core';
import type {
  CampusHub, Course, CourseJoinResponse, CreateCourseRequest, EventCard, EventDetail, EventFilter, RsvpState, UpdateEventRequest,
  UpsertEventRequest,
} from '@shared/campus';
import { api, isApiError } from '@/lib/api';
import { queryClient, updateInfiniteItem, useInfiniteList } from '@/lib/query';

const enc = (s: string) => encodeURIComponent(s);

/* ───────────────────────────── keys ───────────────────────────── */

export const campusKeys = {
  all: ['campus'] as const,
  hub: ['campus', 'hub'] as const,
  events: (filter: EventFilter | null, hostId?: Id) => ['campus', 'events', filter ?? 'all', hostId ?? ''] as const,
  event: (id: Id) => ['campus', 'event', id] as const,
  attendees: (id: Id, state: RsvpState) => ['campus', 'attendees', id, state] as const,
  userEvents: (userId: Id) => ['campus', 'userEvents', userId] as const,
  courses: (q: string) => ['campus', 'courses', 'search', q] as const,
  myCourses: ['campus', 'courses', 'mine'] as const,
  course: (id: Id) => ['campus', 'course', id] as const,
  marketSummary: ['campus', 'marketSummary'] as const,
};

/* ───────────────────────────── reads ───────────────────────────── */

export function useHub() {
  return useQuery<CampusHub>({
    queryKey: campusKeys.hub,
    queryFn: ({ signal }) => api.get<CampusHub>('/campus/hub', undefined, { signal }),
    staleTime: 15_000,
  });
}

/** `null` → the market slice is absent or unreachable: the Today strip simply omits the listings clause (R6). */
export function useMarketSummary() {
  return useQuery<MarketSummary | null>({
    queryKey: campusKeys.marketSummary,
    queryFn: async ({ signal }) => {
      try {
        return await api.get<MarketSummary>('/market/summary', undefined, { signal });
      } catch (e) {
        if (isApiError(e) && (e.status === 404 || e.status === 501)) return null;
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useEvents(filter: EventFilter | null, hostId?: Id) {
  return useInfiniteList<EventCard>({
    queryKey: [...campusKeys.events(filter, hostId)],
    path: '/campus/events',
    query: { filter: filter ?? undefined, hostId },
  });
}

export function useEvent(id: Id, initial?: EventDetail) {
  return useQuery<EventDetail>({
    queryKey: campusKeys.event(id),
    queryFn: ({ signal }) => api.get<EventDetail>(`/campus/events/${enc(id)}`, undefined, { signal }),
    initialData: initial,
    staleTime: initial ? 10_000 : 0,
  });
}

export function useUserEvents(userId: Id) {
  return useInfiniteList<EventCard>({ queryKey: [...campusKeys.userEvents(userId)], path: `/campus/users/${enc(userId)}/events` });
}

export function attendeesPath(id: Id, state: RsvpState): string {
  return `/campus/events/${enc(id)}/attendees?state=${state}`;
}

export function useCourses(q: string) {
  return useInfiniteList<Course>({ queryKey: [...campusKeys.courses(q)], path: '/campus/courses', query: { q } });
}

export function useMyCourses() {
  return useQuery<Paginated<Course>>({
    queryKey: campusKeys.myCourses,
    queryFn: ({ signal }) => api.get<Paginated<Course>>('/campus/courses/mine', undefined, { signal }),
  });
}

export function useCourse(id: Id) {
  return useQuery<Course>({
    queryKey: campusKeys.course(id),
    queryFn: ({ signal }) => api.get<Course>(`/campus/courses/${enc(id)}`, undefined, { signal }),
  });
}

export type Attendees = Paginated<UserListItem>;

/* ───────────────────────────── cache patches ───────────────────────────── */

/** Applies `fn` to every cached copy of the event: lists, hosted lists, the hub, the detail query. */
export function patchEvent(id: Id, fn: (e: EventCard) => EventCard): void {
  updateInfiniteItem<EventCard>(['campus', 'events'], id, fn);
  updateInfiniteItem<EventCard>(['campus', 'userEvents'], id, fn);
  queryClient.setQueryData<EventDetail>(campusKeys.event(id), (e) => (e ? { ...e, ...fn(e) } : e));
  queryClient.setQueryData<CampusHub>(campusKeys.hub, (hub) =>
    hub
      ? {
          ...hub,
          todayEvents: hub.todayEvents.map((e) => (e.id === id ? fn(e) : e)),
          upcoming: hub.upcoming.map((e) => (e.id === id ? fn(e) : e)),
        }
      : hub,
  );
}

export function seedEventDetail(event: EventDetail): void {
  queryClient.setQueryData<EventDetail>(campusKeys.event(event.id), event);
}

export function invalidateCampus(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: campusKeys.all });
}

/* ───────────────────────────── mutations ───────────────────────────── */

export function createEventRequest(body: UpsertEventRequest): Promise<WithModeration<EventDetail>> {
  return api.post<WithModeration<EventDetail>>('/campus/events', body);
}

export function updateEventRequest(id: Id, body: UpdateEventRequest): Promise<WithModeration<EventDetail>> {
  return api.patch<WithModeration<EventDetail>>(`/campus/events/${enc(id)}`, body);
}

export function cancelEventRequest(id: Id): Promise<EventDetail> {
  return api.post<EventDetail>(`/campus/events/${enc(id)}/cancel`);
}

export function rsvpRequest(id: Id, state: RsvpState | null): Promise<EventCard> {
  return api.put<EventCard>(`/campus/events/${enc(id)}/rsvp`, { state });
}

export function createCourseRequest(body: CreateCourseRequest): Promise<Course> {
  return api.post<Course>('/campus/courses', body);
}

export function joinCourseRequest(id: Id): Promise<CourseJoinResponse> {
  return api.post<CourseJoinResponse>(`/campus/courses/${enc(id)}/join`);
}

export function leaveCourseRequest(id: Id): Promise<void> {
  return api.post<void>(`/campus/courses/${enc(id)}/leave`);
}
