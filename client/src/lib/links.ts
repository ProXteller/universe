/**
 * `routes` — the only place hrefs are built (SPEC §4.4.1 `lib/links.ts`; canonical patterns in §4.5).
 * Slices MUST NOT hard-code path strings; a missing builder is a foundation gap to report.
 */
import type { HomeTab, Id } from '@shared/core';

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const enc = (s: string) => encodeURIComponent(s);

/** The canonical onboarding sub-paths of SPEC §4.5 (`/welcome/<step>`). */
export type WelcomeStep = 'email' | 'code' | 'password' | 'profile' | 'guidelines' | 'follow';

export const routes = {
  welcome: (next?: string) => `/welcome${qs({ next })}`,
  /** Foundation addition (not in the §4.4.1 list): the §4.5 onboarding steps, so `auth` never hard-codes them. */
  welcomeStep: (step: WelcomeStep) => `/welcome/${step}`,
  home: (tab?: HomeTab) => `/home/${tab ?? 'reels'}`,

  reel: (id: Id, opts?: { comments?: boolean }) => `/reel/${enc(id)}${qs({ comments: opts?.comments ? 1 : undefined })}`,
  reelNew: () => '/reel/new',

  buzzThread: (id: Id) => `/buzz/${enc(id)}`,
  buzzMine: () => '/buzz/mine',
  buzzSearch: () => '/buzz/search',

  post: (id: Id) => `/post/${enc(id)}`,

  profile: (handle: string) => `/u/${enc(handle)}`,
  followers: (handle: string) => `/u/${enc(handle)}/followers`,
  following: (handle: string) => `/u/${enc(handle)}/following`,
  editProfile: () => '/me/edit',

  discover: () => '/discover',
  search: (q?: string) => `/discover/search${qs({ q })}`,

  messages: () => '/messages',
  messagesRequests: () => '/messages/requests',
  messagesNew: () => '/messages/new',
  chat: (id: Id) => `/messages/${enc(id)}`,
  chatInfo: (id: Id) => `/messages/${enc(id)}/info`,

  roommates: (query?: { mode?: 'need' | 'have' }) => `/roommates${qs({ mode: query?.mode })}`,
  roommatesSaved: () => '/roommates/saved',
  roommatesMe: () => '/roommates/me',
  roommatesMeEdit: () => '/roommates/me/edit',
  roommate: (id: Id) => `/roommates/${enc(id)}`,

  market: (query?: { q?: string; course?: string; type?: string }) =>
    `/market${qs({ q: query?.q, course: query?.course, type: query?.type })}`,
  marketSaved: () => '/market/saved',
  marketMine: () => '/market/mine',
  listing: (id: Id) => `/market/${enc(id)}`,
  listingEdit: (id: Id) => `/market/${enc(id)}/edit`,
  listingNew: (prefill?: { type?: string; title?: string }) => `/market/new${qs({ type: prefill?.type, title: prefill?.title })}`,

  campus: () => '/campus',
  events: () => '/campus/events',
  eventNew: () => '/campus/events/new',
  event: (id: Id) => `/campus/events/${enc(id)}`,
  eventEdit: (id: Id) => `/campus/events/${enc(id)}/edit`,
  courses: () => '/campus/courses',
  course: (id: Id) => `/c/${enc(id)}`,

  apartments: () => '/apartments',
  notifications: () => '/notifications',
  settings: (section?: string) => (section ? `/settings/${section}` : '/settings'),
  accountStatus: () => '/settings/account-status',
  legal: (doc: 'terms' | 'privacy') => `/legal/${doc}`,
  guidelines: (anchor?: string) => `/guidelines${anchor ? (anchor.startsWith('#') ? anchor : `#${anchor}`) : ''}`,

  admin: (section?: string) => (section ? `/admin/${section}` : '/admin'),
  adminQueueItem: (id: Id) => `/admin/queue/${enc(id)}`,
  adminUser: (id: Id) => `/admin/users/${enc(id)}`,

  invite: (code: string) => `/i/${enc(code)}`,
} as const;

export type Routes = typeof routes;
