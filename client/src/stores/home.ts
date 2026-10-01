/**
 * Home pager state (SPEC §4.4.1 `stores/home.ts`). The pager itself is pure CSS scroll-snap in
 * `app/home/HomePage.tsx`; this store is what the top bar, nav and panes read.
 *
 *  - `tab`: the active Home tab (source: the pager's settled position; set eagerly on a tab tap).
 *  - `progress`: MotionValue 0..2 = pager position, written on every scroll frame — glue for the indicator,
 *    the Me-button crossfade and the nav pill colour. Never React state.
 *  - `scrollTopSignal`: increments when the active Home tab / nav item is re-tapped.
 * The last tab is persisted in `localStorage['uv:home:tab']`; a first-ever session starts on `'reels'`.
 */
import { motionValue, type MotionValue } from 'motion/react';
import { create } from 'zustand';
import { HOME_TABS, type HomeTab } from '@shared/core';

export const HOME_TAB_KEY = 'uv:home:tab';

export function isHomeTab(v: unknown): v is HomeTab {
  return typeof v === 'string' && (HOME_TABS as readonly string[]).includes(v);
}

export function tabIndex(tab: HomeTab): number {
  return Math.max(0, HOME_TABS.indexOf(tab));
}

export function tabAt(index: number): HomeTab {
  return HOME_TABS[Math.min(HOME_TABS.length - 1, Math.max(0, Math.round(index)))] ?? 'reels';
}

/** Last tab from storage; `'reels'` on a first-ever session. */
export function readLastTab(): HomeTab {
  try {
    const v = localStorage.getItem(HOME_TAB_KEY);
    return isHomeTab(v) ? v : 'reels';
  } catch {
    return 'reels';
  }
}

function persistTab(tab: HomeTab): void {
  try {
    localStorage.setItem(HOME_TAB_KEY, tab);
  } catch {
    /* private mode */
  }
}

/** 0..2 pager position (Reels = 0, Buzz = 1, Orbit = 2). */
export const homeProgress: MotionValue<number> = motionValue(tabIndex(readLastTab()));
/** 1 while HomePage is mounted, else 0 — the nav uses it so the Phosphor tint never leaks onto other routes. */
export const homeMounted: MotionValue<number> = motionValue(0);

type PagerScroller = (index: number, behavior: ScrollBehavior) => void;
let pagerScroller: PagerScroller | null = null;

/** HomePage registers its scroll function so `setTab()` can drive the pager from anywhere. */
export function registerPager(fn: PagerScroller | null): void {
  pagerScroller = fn;
}

interface HomeState {
  tab: HomeTab;
  scrollTopSignal: number;
  /** Tab tap: eager state + smooth pager scroll. */
  setTab(tab: HomeTab): void;
  /** Pager settled on `tab` (scrollend): state only, no scroll. */
  settle(tab: HomeTab): void;
  bumpScrollTop(): void;
}

export const useHomeStore = create<HomeState>((set, get) => ({
  tab: readLastTab(),
  scrollTopSignal: 0,
  setTab: (tab) => {
    if (get().tab !== tab) {
      set({ tab });
      persistTab(tab);
    }
    pagerScroller?.(tabIndex(tab), 'smooth');
  },
  settle: (tab) => {
    if (get().tab === tab) return;
    set({ tab });
    persistTab(tab);
  },
  bumpScrollTop: () => set((s) => ({ scrollTopSignal: s.scrollTopSignal + 1 })),
}));

export interface HomeTabApi {
  tab: HomeTab;
  /** Smooth-scrolls the pager to `t`. */
  setTab(t: HomeTab): void;
  isActive(t: HomeTab): boolean;
  /** 0..2 pager position, updated on every scroll frame. */
  progress: MotionValue<number>;
  /** Increments when the active Home tab / nav item is re-tapped (scroll the pane to top / first reel). */
  scrollTopSignal: number;
}

export function useHomeTab(): HomeTabApi {
  const tab = useHomeStore((s) => s.tab);
  const setTab = useHomeStore((s) => s.setTab);
  const scrollTopSignal = useHomeStore((s) => s.scrollTopSignal);
  return {
    tab,
    setTab,
    isActive: (t) => t === tab,
    progress: homeProgress,
    scrollTopSignal,
  };
}

/** Logout reset (registered by AppShell): back to the first-session defaults, storage cleared. */
export function resetHomeStore(): void {
  try {
    localStorage.removeItem(HOME_TAB_KEY);
  } catch {
    /* ignore */
  }
  useHomeStore.setState({ tab: 'reels', scrollTopSignal: 0 });
  homeProgress.set(0);
}
