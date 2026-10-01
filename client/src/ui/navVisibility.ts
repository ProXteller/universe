/**
 * Bottom-nav visibility — a tiny external store owned by the kit because `<Screen nav>` is its only writer
 * and `FAB` needs to read it. `stores/ui.ts` re-exports `useNavVisibility` as `useNavVisible` (SPEC §4.4.1);
 * `BottomNav` reads it to slide in/out.
 */
import { useSyncExternalStore } from 'react';

let visible = false;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getNavVisibility(): boolean {
  return visible;
}

export function setNavVisibility(next: boolean): void {
  if (visible === next) return;
  visible = next;
  listeners.forEach((fn) => fn());
}

export function useNavVisibility(): boolean {
  return useSyncExternalStore(subscribe, getNavVisibility, getNavVisibility);
}
