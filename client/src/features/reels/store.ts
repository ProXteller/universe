/**
 * Reels UI state (zustand, UI only): the session-wide mute switch ("mute pill persists for session") and the feed
 * scope. Mirrored into `sessionStorage['uv:reels:*']` so a reload keeps the choice; wiped by `logout()` through
 * `registerStoreReset` (registered lazily on first use — index.tsx must stay side-effect free, R4).
 */
import { create } from 'zustand';
import type { FeedScope } from '@shared/core';
import { registerStoreReset } from '@/lib/session';

const MUTED_KEY = 'uv:reels:muted';
const SCOPE_KEY = 'uv:reels:scope';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

interface ReelsState {
  /** First load autoplays muted; one tap on the pill unmutes for the rest of the session. */
  muted: boolean;
  scope: FeedScope;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
  setScope(scope: FeedScope): void;
}

export const useReelsStore = create<ReelsState>((set, get) => ({
  muted: readSession(MUTED_KEY) !== '0',
  scope: readSession(SCOPE_KEY) === 'global' ? 'global' : 'campus',
  setMuted: (muted) => {
    set({ muted });
    writeSession(MUTED_KEY, muted ? '1' : '0');
  },
  toggleMuted: () => get().setMuted(!get().muted),
  setScope: (scope) => {
    set({ scope });
    writeSession(SCOPE_KEY, scope);
  },
}));

let resetRegistered = false;

/** Called by the pane on mount so `logout()` clears this store (firewall §3.2 #5). Idempotent. */
export function ensureReelsStoreReset(): void {
  if (resetRegistered) return;
  resetRegistered = true;
  registerStoreReset(() => {
    writeSession(MUTED_KEY, null);
    writeSession(SCOPE_KEY, null);
    useReelsStore.setState({ muted: true, scope: 'campus' });
  });
}
