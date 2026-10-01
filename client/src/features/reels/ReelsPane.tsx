/**
 * The Reels pane (design §6.5 / §7.2, SPEC §5.2): a full-bleed vertical CSS snap feed nested inside the Home pager.
 * One reel plays at a time (IntersectionObserver ≥ 0.6), `<video>` mounts only within ±1 of the active reel, the pane
 * pauses when it is not the active Home tab or the document is hidden, the mute pill persists for the session,
 * Campus / Global toggle with the cold-start rule, skeleton / empty / error + retry / infinite scroll, keyboard
 * (↑ ↓ J K · Space · M), and the own FAB (viewer avatar + plus badge → /reel/new).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMotionValueEvent } from 'motion/react';
import { Clapperboard, Plus, Volume2, VolumeX } from 'lucide-react';
import type { Reel } from '@shared/reels';
import { Avatar, EmptyState, ErrorState, InfiniteSentinel, Skeleton } from '@/ui';
import { CampusScopeToggle, ColdStartBanner } from '@/components';
import type { HomePaneProps } from '@/app/contracts';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { useReducedMotionPref } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { useHomeTab } from '@/stores/home';
import { useReelFeed } from './api';
import { CommentsSheet } from './CommentsSheet';
import { ReelCard } from './ReelCard';
import { ensureReelsStoreReset, useReelsStore } from './store';

const TOP_INSET = 'calc(var(--topbar-h) + var(--safe-top) + 8px)';
const BOTTOM_INSET = 'var(--nav-clearance)';
const PRELOAD_WINDOW = 1;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'));
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export const ReelsPane: FC<HomePaneProps> = ({ active }) => {
  const me = useMe();
  const navigate = useNavigate();
  const reduced = useReducedMotionPref();
  const { progress, scrollTopSignal } = useHomeTab();
  const muted = useReelsStore((s) => s.muted);
  const scope = useReelsStore((s) => s.scope);
  const setScope = useReelsStore((s) => s.setScope);
  const setMuted = useReelsStore((s) => s.setMuted);
  const toggleMuted = useReelsStore((s) => s.toggleMuted);
  const visible = useDocumentVisible();

  useEffect(() => ensureReelsStoreReset(), []);

  // Defer the first query until the pager comes near (design §6.5); once near, stay enabled.
  const [near, setNear] = useState(active);
  useMotionValueEvent(progress, 'change', (v) => {
    if (v < 1 && !near) setNear(true);
  });
  const enabled = active || near;

  const feed = useReelFeed(scope, enabled);
  const reels = feed.items;

  /* ---------------------------------------------------------------- cold start (SPEC §1 rule 1) */

  const coldChecked = useRef(false);
  const [coldStart, setColdStart] = useState(false);
  useEffect(() => {
    if (coldChecked.current || !enabled || scope !== 'campus') return;
    if (feed.isLoading || feed.isError) return;
    coldChecked.current = true;
    if (reels.length === 0) {
      setScope('global');
      setColdStart(true);
    }
  }, [enabled, scope, feed.isLoading, feed.isError, reels.length, setScope]);

  /* ---------------------------------------------------------------- active reel */

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    setScrollerEl(el);
  }, []);
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionsRef = useRef(new Set<HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // The observer follows the scroller element (it mounts after the skeleton / empty states).
  useEffect(() => {
    const root = scrollerEl;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.index);
          if (Number.isFinite(idx)) setActiveIndex(idx);
        }
      },
      { root, threshold: 0.6 },
    );
    observerRef.current = io;
    for (const el of sectionsRef.current.values()) io.observe(el);
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, [scrollerEl]);

  // One stable ref callback for every section (React 19 ref cleanup): observe on mount, unobserve on unmount.
  const sectionRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    sectionsRef.current.add(el);
    observerRef.current?.observe(el);
    return () => {
      sectionsRef.current.delete(el);
      observerRef.current?.unobserve(el);
    };
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, Math.max(0, reels.length - 1)));
      el.scrollTo({ top: clamped * el.clientHeight, behavior: reduced ? 'auto' : behavior });
    },
    [reels.length, reduced],
  );

  // Re-tapping the Home tab / nav item → back to the first reel.
  const firstSignal = useRef(scrollTopSignal);
  useEffect(() => {
    if (scrollTopSignal === firstSignal.current) return;
    firstSignal.current = scrollTopSignal;
    scrollToIndex(0);
  }, [scrollTopSignal, scrollToIndex]);

  /* ---------------------------------------------------------------- keyboard (framed desktop layout) */

  const [toggleSignal, setToggleSignal] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (document.getElementById('overlay-root')?.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowDown' || key === 'j') {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      } else if (e.key === 'ArrowUp' || key === 'k') {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        setToggleSignal((n) => n + 1);
      } else if (key === 'm') {
        e.preventDefault();
        toggleMuted();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, activeIndex, scrollToIndex, toggleMuted]);

  /* ---------------------------------------------------------------- comments sheet */

  const [commentsFor, setCommentsFor] = useState<Reel | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const openComments = useCallback((reel: Reel) => {
    setCommentsFor(reel);
    setCommentsOpen(true);
  }, []);
  // keep the sheet's reel in sync with the cache (counts move while it is open)
  const commentsReel = useMemo(() => (commentsFor ? (reels.find((r) => r.id === commentsFor.id) ?? commentsFor) : null), [commentsFor, reels]);

  const onAutoplayBlocked = useCallback(() => setMuted(true), [setMuted]);
  const playingIndex = active && visible ? activeIndex : -1;

  /* ---------------------------------------------------------------- render */

  const controls = (
    <div className="pointer-events-none absolute inset-x-4 z-[6] flex items-center justify-between gap-3" style={{ top: TOP_INSET }}>
      <button
        type="button"
        onClick={toggleMuted}
        aria-pressed={!muted}
        aria-label={muted ? 'Tap for sound' : 'Mute'}
        className="press pointer-events-auto flex h-9 min-w-9 items-center gap-1.5 rounded-full bg-black/40 px-2.5 text-white backdrop-blur-md"
      >
        {muted ? <VolumeX size={18} strokeWidth={2} aria-hidden /> : <Volume2 size={18} strokeWidth={2} aria-hidden />}
        {muted ? <span className="type-caption">Tap for sound</span> : null}
      </button>
      <div className="pointer-events-auto rounded-full bg-black/35 p-0.5 backdrop-blur-md">
        <CampusScopeToggle
          size="sm"
          value={scope}
          onChange={(v) => {
            setScope(v);
            setColdStart(false);
            scrollToIndex(0, 'auto');
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => navigate(routes.reelNew())}
        aria-label="New reel"
        className="press pointer-events-auto relative flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        {/* own face / name only while Reels is the active tab: the pane stays mounted next to Buzz, and at rest on
            /home/buzz the frame must hold no avatar URL, name or handle of the viewer (FOUNDATION-NOTES, SPEC §3.2) */}
        {active ? (
          <Avatar src={me.avatarUrl} name={me.displayName} size="sm" shape={me.accountType === 'org' ? 'org' : 'circle'} className="ring-2 ring-white/25" />
        ) : (
          <span className="size-8 rounded-full bg-black/40 ring-2 ring-white/25" aria-hidden />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent ring-2 ring-canvas" aria-hidden>
          <Plus size={12} strokeWidth={3} />
        </span>
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (!enabled || (feed.isLoading && reels.length === 0)) {
    body = <ReelSkeleton />;
  } else if (feed.isError && reels.length === 0) {
    body = (
      <div className="absolute inset-0 flex items-center justify-center px-4" style={{ paddingTop: TOP_INSET, paddingBottom: BOTTOM_INSET }}>
        <ErrorState title="Couldn't load reels" error={feed.error} onRetry={() => void feed.refetch()} />
      </div>
    );
  } else if (reels.length === 0) {
    body = (
      <div className="absolute inset-0 flex items-center justify-center px-4" style={{ paddingTop: TOP_INSET, paddingBottom: BOTTOM_INSET }}>
        <EmptyState
          icon={Clapperboard}
          title={scope === 'campus' ? 'No campus reels yet' : 'No reels yet'}
          description="Post the first reel — 60 seconds max, from your public profile."
          action={{ label: 'Post the first reel', onClick: () => navigate(routes.reelNew()) }}
        />
      </div>
    );
  } else {
    body = (
      <div
        ref={setScroller}
        className="absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-y-contain"
        style={{ scrollbarWidth: 'none' }}
        aria-label="Reels feed"
      >
        {reels.map((reel, i) => (
          <section key={reel.id} ref={sectionRef} data-index={i} className="relative h-full w-full shrink-0 snap-start snap-always">
            <ReelCard
              reel={reel}
              mounted={Math.abs(i - activeIndex) <= PRELOAD_WINDOW}
              playing={i === playingIndex}
              muted={muted}
              onAutoplayBlocked={onAutoplayBlocked}
              onOpenComments={openComments}
              bottomInset={BOTTOM_INSET}
              toggleSignal={i === activeIndex ? toggleSignal : 0}
            />
          </section>
        ))}
        {feed.hasNextPage || feed.isFetchingNextPage ? (
          <InfiniteSentinel {...feed.sentinelProps} rootRef={scrollerRef} endLabel={null} className="h-px" />
        ) : (
          <section className="relative flex h-full w-full shrink-0 snap-start snap-always items-center justify-center px-4 bg-canvas">
            <EmptyState
              compact
              icon={Clapperboard}
              title="You're all caught up"
              description="New reels land all day."
              action={{ label: 'Back to top', onClick: () => scrollToIndex(0) }}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-canvas" data-active={active}>
      {body}
      {controls}
      {coldStart ? (
        <div className="absolute inset-x-0 z-[6]" style={{ top: `calc(${TOP_INSET} + 48px)` }}>
          <ColdStartBanner universityName={me.university.name} onDismiss={() => setColdStart(false)} onPost={() => navigate(routes.reelNew())} />
        </div>
      ) : null}
      <CommentsSheet reel={commentsReel} open={commentsOpen} onOpenChange={setCommentsOpen} />
    </div>
  );
};

/** Full-bleed skeleton: shimmering stage + ghost rail + ghost caption — the geometry of a real reel. */
export function ReelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-surface-1', className)} aria-hidden>
      <div className="skeleton absolute inset-0 rounded-none opacity-60" />
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-scrim-bottom" />
      <div className="absolute left-4 right-20 flex flex-col gap-3" style={{ bottom: `calc(${BOTTOM_INSET} + 14px)` }}>
        <div className="flex items-center gap-2.5">
          <Skeleton circle w={40} className="bg-surface-3" />
          <Skeleton w={120} h={14} className="bg-surface-3" />
          <Skeleton w={72} h={28} className="rounded-full bg-surface-3" />
        </div>
        <Skeleton w="90%" h={12} className="bg-surface-3" />
        <Skeleton w="60%" h={12} className="bg-surface-3" />
        <Skeleton w={96} h={28} className="rounded-full bg-surface-3" />
      </div>
      <div className="absolute right-3 flex flex-col items-center gap-5" style={{ bottom: `calc(${BOTTOM_INSET} + 18px)` }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} circle w={44} className="bg-surface-3" />
        ))}
      </div>
    </div>
  );
}
