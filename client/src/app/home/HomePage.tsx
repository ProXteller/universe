/**
 * Home pager (design §6.5 + SPEC §8 "Foundation done when" criteria 1–8).
 *
 * Pure CSS scroll-snap (`snap-x snap-mandatory`, every pane `snap-always` so one swipe moves exactly one pane).
 * Motion only *reads* the scroll: `homeProgress` (0..2) is written on every scroll frame and glues the top-bar
 * indicator, the Me-button crossfade and the nav pill colour to the finger. The settled pane index is derived
 * from the scroll (`scrollend`, with an 80 ms debounce fallback) → `useHomeStore.settle()` → URL replace.
 *
 * Keeps all three panes mounted (their scroll positions persist), wraps `BuzzPane` in `<Surface mode="incognito">`,
 * sets the initial `scrollLeft` in a layout effect (a reload on `/home/orbit` paints on Orbit with no slide),
 * handles ← / →, and carries the one sanctioned `pointerType === 'mouse'` click-drag handler so the framed
 * desktop layout can swipe too (8 px slop, suppresses the click, ignores drags that start inside `.scroll-x`).
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { HOME_TABS, type HomeTab } from '@shared/core';
import { setNavVisibility, Surface } from '@/ui';
import { PageLoader, RouteError } from '@/components';
import { track } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { useReducedMotionPref } from '@/lib/motion';
import { homeMounted, homeProgress, isHomeTab, readLastTab, registerPager, tabAt, tabIndex, useHomeStore } from '@/stores/home';
import { HomeTopBar } from './HomeTopBar';

const ReelsPane = lazy(() => import('@/features/reels').then((m) => ({ default: m.ReelsPane })));
const BuzzPane = lazy(() => import('@/features/buzz').then((m) => ({ default: m.BuzzPane })));
const OrbitPane = lazy(() => import('@/features/orbit').then((m) => ({ default: m.OrbitPane })));

const DRAG_SLOP = 8;
const FLING_PX_PER_MS = 0.5;
const SETTLE_DEBOUNCE_MS = 80;
const NO_DRAG = '.scroll-x, input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-pager-drag]';

interface Drag {
  id: number;
  startX: number;
  startLeft: number;
  active: boolean;
  lastX: number;
  lastT: number;
  vx: number;
}

const PANE_CLASS = 'relative h-full w-full flex-none snap-start snap-always overflow-hidden';

/** Props of a pane that is not the settled tab: unfocusable, out of the accessibility tree (visual swipe unaffected). */
function restingProps(inactive: boolean): { inert?: boolean; 'aria-hidden'?: true } {
  return inactive ? { inert: true, 'aria-hidden': true } : {};
}

function PaneFallback() {
  return <PageLoader className="bg-transparent" />;
}

/**
 * Route element for `/home/:tab`. Validates the param BEFORE the pager mounts: an invalid tab redirects to the
 * last tab (same route, so React would otherwise keep the pager instance whose mount-only effects ran without
 * a scroller and never re-run).
 */
export function HomePage() {
  const { tab } = useParams<{ tab: string }>();
  if (!isHomeTab(tab)) return <Navigate to={routes.home(readLastTab())} replace />;
  return <HomePager param={tab} />;
}

function HomePager({ param }: { param: HomeTab }) {
  const navigate = useNavigate();
  const reduced = useReducedMotionPref();
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tab = useHomeStore((s) => s.tab);
  const settle = useHomeStore((s) => s.settle);
  const setTab = useHomeStore((s) => s.setTab);
  const paramRef = useRef(param);
  paramRef.current = param;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useLayoutEffect(() => {
    setNavVisibility(true);
  }, []);

  useEffect(() => {
    homeMounted.set(1);
    return () => {
      homeMounted.set(0);
    };
  }, []);

  // The store's `setTab()` drives this scroller from anywhere (top bar, nav, ← / →, slices).
  useLayoutEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    registerPager((index, behavior) => {
      el.scrollTo({ left: index * el.clientWidth, behavior: reducedRef.current ? 'auto' : behavior });
    });
    return () => registerPager(null);
  }, []);

  // Initial position before first paint: the URL's tab. No visible slide (criterion 5).
  useLayoutEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    const initial: HomeTab = param;
    el.scrollLeft = tabIndex(initial) * el.clientWidth;
    homeProgress.set(tabIndex(initial));
    settle(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL → pager while mounted (a slice navigating to another tab, browser history).
  useEffect(() => {
    if (param !== useHomeStore.getState().tab) setTab(param);
  }, [param, setTab]);

  const restoreSnap = useCallback(() => {
    const el = pagerRef.current;
    if (el && el.style.scrollSnapType) el.style.scrollSnapType = '';
  }, []);

  // Scroll → progress; settle → store + URL (replace) + analytics; resize → re-pin the active pane.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let debounce: number | null = null;
    let lastTracked: HomeTab | null = null;

    const onSettle = () => {
      if (debounce !== null) {
        window.clearTimeout(debounce);
        debounce = null;
      }
      if (dragRef.current?.active) return;
      const w = el.clientWidth || 1;
      const t = tabAt(el.scrollLeft / w);
      settle(t);
      restoreSnap();
      if (paramRef.current !== t) navigate(routes.home(t), { replace: true });
      if (lastTracked !== t) {
        lastTracked = t;
        track('home_tab_view', { tab: t });
      }
    };
    const onScroll = () => {
      const w = el.clientWidth || 1;
      homeProgress.set(el.scrollLeft / w);
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(onSettle, SETTLE_DEBOUNCE_MS);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onSettle);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (!w) return;
      const target = tabIndex(useHomeStore.getState().tab) * w;
      if (Math.abs(el.scrollLeft - target) > 1 && !dragRef.current?.active) el.scrollLeft = target;
    });
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onSettle);
      ro.disconnect();
      if (debounce !== null) window.clearTimeout(debounce);
    };
  }, [navigate, settle, restoreSnap]);

  // ← / → switch panes (framed desktop layout). Ignored while typing or while an overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (document.getElementById('overlay-root')?.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const current = tabIndex(useHomeStore.getState().tab);
      const next = e.key === 'ArrowLeft' ? current - 1 : current + 1;
      if (next < 0 || next >= HOME_TABS.length) return;
      e.preventDefault();
      setTab(tabAt(next));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setTab]);

  // The sanctioned mouse click-drag handler (SPEC §4.4.3).
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = pagerRef.current;
      if (!el || e.pointerType !== 'mouse' || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(NO_DRAG)) return;
      const drag: Drag = { id: e.pointerId, startX: e.clientX, startLeft: el.scrollLeft, active: false, lastX: e.clientX, lastT: performance.now(), vx: 0 };
      dragRef.current = drag;

      const suppressClick = () => {
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        el.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 300);
      };

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d || ev.pointerId !== d.id) return;
        const dx = ev.clientX - d.startX;
        if (!d.active) {
          if (Math.abs(dx) < DRAG_SLOP) return;
          d.active = true;
          el.style.scrollSnapType = 'none';
          document.body.style.userSelect = 'none';
          window.getSelection()?.removeAllRanges();
        }
        const now = performance.now();
        d.vx = (ev.clientX - d.lastX) / Math.max(1, now - d.lastT);
        d.lastX = ev.clientX;
        d.lastT = now;
        el.scrollLeft = d.startLeft - dx;
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const d = dragRef.current;
        dragRef.current = null;
        if (!d || ev.pointerId !== d.id) return;
        if (!d.active) return; // a plain click still clicks
        document.body.style.userSelect = '';
        suppressClick();
        const w = el.clientWidth || 1;
        const startIndex = Math.round(d.startLeft / w);
        const dx = ev.clientX - d.startX;
        let index: number;
        if (Math.abs(d.vx) > FLING_PX_PER_MS) index = d.vx < 0 ? startIndex + 1 : startIndex - 1;
        else if (Math.abs(dx) > w * 0.2) index = dx < 0 ? startIndex + 1 : startIndex - 1;
        else index = startIndex;
        index = Math.min(HOME_TABS.length - 1, Math.max(0, index));
        const next = tabAt(index);
        // Release to snap: smooth-scroll to the pane; snapping is re-enabled once the scroll settles.
        if (next !== useHomeStore.getState().tab) setTab(next);
        else el.scrollTo({ left: index * w, behavior: reducedRef.current ? 'auto' : 'smooth' });
        window.setTimeout(restoreSnap, 600);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [setTab, restoreSnap],
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-canvas" data-home-root>
      <div
        ref={pagerRef}
        role="presentation"
        data-home-pager
        onPointerDown={onPointerDown}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ scrollbarWidth: 'none', scrollBehavior: 'auto' }}
      >
        {/* settled on another tab → the pane is inert + aria-hidden: no focus, no a11y-tree exposure of a public pane
            (the viewer's own avatar / posts) next to the anonymous Buzz pane (SPEC §3.2, FOUNDATION-NOTES) */}
        <section id="home-pane-reels" role="tabpanel" aria-labelledby="home-tab-reels" aria-label="Reels" data-home-pane="reels" className={PANE_CLASS} {...restingProps(tab !== 'reels')}>
          <RouteError title="Couldn't load Reels">
            <Suspense fallback={<PaneFallback />}>
              <ReelsPane active={tab === 'reels'} />
            </Suspense>
          </RouteError>
        </section>
        <section id="home-pane-buzz" role="tabpanel" aria-labelledby="home-tab-buzz" aria-label="Buzz" data-home-pane="buzz" className={PANE_CLASS} {...restingProps(tab !== 'buzz')}>
          <Surface mode="incognito" className="h-full">
            <RouteError title="Couldn't load Buzz">
              <Suspense fallback={<PaneFallback />}>
                <BuzzPane active={tab === 'buzz'} />
              </Suspense>
            </RouteError>
          </Surface>
        </section>
        <section id="home-pane-orbit" role="tabpanel" aria-labelledby="home-tab-orbit" aria-label="Orbit" data-home-pane="orbit" className={PANE_CLASS} {...restingProps(tab !== 'orbit')}>
          <RouteError title="Couldn't load Orbit">
            <Suspense fallback={<PaneFallback />}>
              <OrbitPane active={tab === 'orbit'} />
            </Suspense>
          </RouteError>
        </section>
      </div>
      <HomeTopBar />
    </div>
  );
}
