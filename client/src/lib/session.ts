/**
 * Session API (SPEC §4.4.1 `lib/session.ts`). State lives in `stores/session.ts`; this module is what slices import.
 */
import { useQuery } from '@tanstack/react-query';
import type { Badges, EpochMs, MeUser } from '@shared/core';
import { useSessionStore, type SessionStatus } from '@/stores/session';
import { api, isApiError } from './api';
import { navigateTo } from './navigation';
import { queryClient } from './query';
import { routes } from './links';

export type { SessionStatus } from '@/stores/session';

/* ------------------------------------------------------------------ reads */

/** The signed-in user. Throws outside the authed shell (guards guarantee a session on every `A` route). */
export function useMe(): MeUser {
  const me = useSessionStore((s) => s.me);
  if (!me) throw new Error('useMe() called outside the authed shell — use useMeOptional() here.');
  return me;
}

export function useMeOptional(): MeUser | null {
  return useSessionStore((s) => s.me);
}

export function useSessionStatus(): SessionStatus {
  return useSessionStore((s) => s.status);
}

/* ------------------------------------------------------------------ writes */

let inflight: Promise<MeUser | null> | null = null;

/** Re-reads `GET /me`. Resolves `null` (and marks the session anon) on 401. Never redirects by itself. */
export function refreshMe(): Promise<MeUser | null> {
  if (inflight) return inflight;
  inflight = api
    .get<MeUser>('/me', undefined, { silent: true })
    .then((me) => {
      useSessionStore.getState().setMe(me);
      queryClient.setQueryData(['me'], me);
      return me;
    })
    .catch((e: unknown) => {
      if (isApiError(e) && e.status === 401) {
        useSessionStore.getState().setAnon();
        return null;
      }
      // Network / 5xx: keep whatever we had; a fresh boot falls back to anon so the app is never stuck on "loading".
      const s = useSessionStore.getState();
      if (s.status === 'loading') s.setAnon();
      return s.me;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function setMe(me: MeUser): void {
  useSessionStore.getState().setMe(me);
  queryClient.setQueryData(['me'], me);
}

/* ------------------------------------------------------------------ store resets (logout wipes everything) */

const resets = new Set<() => void>();

/** Slices with zustand stores MUST register a reset so `logout()` clears them (firewall §3.2 #5). */
export function registerStoreReset(fn: () => void): () => void {
  resets.add(fn);
  return () => {
    resets.delete(fn);
  };
}

/** Hook for `lib/realtime.ts` so `logout()` can close the socket without a circular import. */
let wsCloser: (() => void) | null = null;
export function registerWsCloser(fn: (() => void) | null): void {
  wsCloser = fn;
}

/** Clears client state without calling the API (used after `session.revoked` and by `logout`). */
export function clearClientSession(): void {
  wsCloser?.();
  queryClient.clear();
  resets.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a slice reset must never block logout */
    }
  });
  useSessionStore.getState().setAnon();
  try {
    sessionStorage.removeItem(NEXT_KEY);
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

/** `POST /auth/logout`, `queryClient.clear()`, every registered store reset, ws close, then `/welcome`. */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', undefined, { silent: true });
  } catch {
    /* the cookie may already be gone; the client-side wipe still happens */
  }
  clearClientSession();
  navigateTo(routes.welcome(), { replace: true });
}

/* ------------------------------------------------------------------ badges / posting rights */

const EMPTY_BADGES: Badges = { notifications: 0, messages: 0, requests: 0 };

/** Nav + bell counts. Seeded by `GET /me/badges`, kept live by ws `badges` / `notification` events. */
export function useBadges(): Badges {
  const status = useSessionStore((s) => s.status);
  const q = useQuery<Badges>({
    queryKey: ['badges'],
    queryFn: () => api.get<Badges>('/me/badges'),
    enabled: status === 'ready',
    staleTime: 60_000,
  });
  return q.data ?? EMPTY_BADGES;
}

/** Whether the viewer may write on a surface right now (active mute / suspension → no). */
export function useCanPost(scope: 'public' | 'buzz' = 'public'): { allowed: boolean; mutedUntil: EpochMs | null } {
  const me = useSessionStore((s) => s.me);
  const sanction = me?.activeSanction ?? null;
  if (!sanction) return { allowed: true, mutedUntil: null };
  if (sanction.kind === 'suspension' || sanction.kind === 'ban') return { allowed: false, mutedUntil: sanction.until };
  if (sanction.kind === 'mute') {
    if (sanction.until !== null && sanction.until <= Date.now()) return { allowed: true, mutedUntil: null };
    const applies = sanction.scope === 'all' || (sanction.scope === 'buzz_only' && scope === 'buzz');
    return applies ? { allowed: false, mutedUntil: sanction.until } : { allowed: true, mutedUntil: null };
  }
  return { allowed: true, mutedUntil: null };
}

/* ------------------------------------------------------------------ pending next / invite (kept across the auth flow) */

const NEXT_KEY = 'uv:auth:next';
const INVITE_KEY = 'uv:auth:invite';

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Only in-app paths are accepted (never a full URL — no open redirects). */
function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.startsWith('/welcome')) return null;
  return value;
}

export function setPendingNext(next: string | null | undefined): void {
  const safe = safeNext(next);
  if (safe) writeStorage(NEXT_KEY, safe);
}

export function getPendingNext(): string | null {
  return safeNext(readStorage(NEXT_KEY));
}

/** Pops the stored `next` (default `/home/reels`). */
export function consumePendingNext(): string {
  const next = getPendingNext();
  writeStorage(NEXT_KEY, null);
  return next ?? routes.home('reels');
}

export function setPendingInvite(code: string | null | undefined): void {
  if (code && /^[A-Za-z0-9_-]{2,64}$/.test(code)) writeStorage(INVITE_KEY, code);
}

export function getPendingInvite(): string | null {
  return readStorage(INVITE_KEY);
}

export function consumePendingInvite(): string | null {
  const code = getPendingInvite();
  writeStorage(INVITE_KEY, null);
  return code;
}
