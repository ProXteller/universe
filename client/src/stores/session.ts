/**
 * Session store (zustand) — the single source for "who is signed in". The public API lives in `lib/session.ts`
 * (SPEC §4.4.1); this store exists so `lib/api.ts` can reset / restrict the session without importing
 * `lib/session.ts` (which imports `lib/api.ts`).
 */
import { create } from 'zustand';
import type { MeUser } from '@shared/core';
import { setReducedMotionSetting } from '@/lib/motion';

export type SessionStatus = 'loading' | 'anon' | 'onboarding' | 'ready' | 'restricted';

export interface SessionState {
  status: SessionStatus;
  me: MeUser | null;
  /** Bumps once per sign-in so per-session effects (warning acks, realtime) can key on it. */
  sessionEpoch: number;
  setMe(me: MeUser): void;
  setAnon(): void;
  /** A 403 `suspended` / `banned` arrived: flip the session to restricted right away. */
  markRestricted(status: 'suspended' | 'banned'): void;
}

export function statusFor(me: MeUser | null): SessionStatus {
  if (!me) return 'anon';
  if (me.status === 'suspended' || me.status === 'banned') return 'restricted';
  if (!me.onboarding.completed) return 'onboarding';
  return 'ready';
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  me: null,
  sessionEpoch: 0,
  setMe: (me) => {
    const prev = get().me;
    setReducedMotionSetting(Boolean(me.settings?.reduceMotion));
    set({ me, status: statusFor(me), sessionEpoch: prev && prev.id === me.id ? get().sessionEpoch : get().sessionEpoch + 1 });
  },
  setAnon: () => {
    setReducedMotionSetting(false);
    set({ me: null, status: 'anon' });
  },
  markRestricted: (status) => {
    const me = get().me;
    set({ status: 'restricted', me: me ? { ...me, status } : me });
  },
}));

/** Non-hook read for helpers that run outside React (formatPrice, analytics). */
export function getSessionMe(): MeUser | null {
  return useSessionStore.getState().me;
}
