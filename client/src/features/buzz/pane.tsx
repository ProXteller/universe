/**
 * BuzzPane — the Home pane (design §7.2, SPEC §5.3). Already inside foundation's `<Surface mode="incognito">`.
 *
 * Gate: while the viewer has not accepted the Buzz guidelines the pane renders the INLINE gate panel (only while
 * `active`; an inactive un-accepted pane is an empty incognito canvas) and makes no `/api/buzz` request. Top-bar
 * tabs, horizontal swipe and the bottom nav stay fully usable. "Not now" → the previous non-Buzz tab.
 *
 * After acceptance: sort / scope row, Daily Campus Prompt card, cold-start banner (campus feed empty on the first page →
 * Global + dismissible banner), feed of BuzzCards with skeleton / empty / error / infinite scroll, FAB (pen + mask), composer.
 */
import { useEffect, useRef, useState, type FC, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, PenLine, Search, Sparkles, VenetianMask } from 'lucide-react';
import type { FeedScope } from '@shared/core';
import type { Buzz, BuzzSort, BuzzTopWindow } from '@shared/buzz';
import { Button, ChipGroup, EmptyState, ErrorState, FAB, InfiniteSentinel, SegmentedControl } from '@/ui';
import { CampusScopeToggle, ColdStartBanner } from '@/components';
import type { HomePaneProps } from '@/app/contracts';
import { track } from '@/lib/analytics';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useHomeTab } from '@/stores/home';
import { useBuzzFeed, useBuzzMeta } from './api';
import { BuzzCard, BuzzCardSkeleton } from './BuzzCard';
import { BuzzComposer } from './Composer';
import { BuzzGatePanel, useBuzzGate } from './gate';
import { ensureBuzzStoreReset, useBuzzStore } from './store';

const PANE_TOP = 'calc(var(--topbar-h) + var(--safe-top) + 8px)';

/** Scrolled less than this from the top, the filter bar always shows. */
const BAR_ALWAYS_UNDER = 48;
const DIRECTION_SLOP = 6;

/**
 * The sort / scope / search bar slides away while the feed scrolls down and comes back as soon as it scrolls up
 * (or reaches the top), like the bars in Twitter / Reddit.
 */
function useBarHidden(scrollRef: RefObject<HTMLDivElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = (): void => {
      const y = el.scrollTop;
      const dy = y - last;
      if (y <= BAR_ALWAYS_UNDER) setHidden(false);
      else if (dy > DIRECTION_SLOP) setHidden(true);
      else if (dy < -DIRECTION_SLOP) setHidden(false);
      if (Math.abs(dy) > DIRECTION_SLOP) last = y;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);
  return hidden;
}

const SORTS: { value: BuzzSort; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
];
const WINDOWS: { value: BuzzTopWindow; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All time' },
];

export const BuzzPane: FC<HomePaneProps> = ({ active }) => {
  const { accepted } = useBuzzGate();
  const { tab, setTab, scrollTopSignal } = useHomeTab();
  const previousTab = useBuzzStore((s) => s.previousTab);
  const setPreviousTab = useBuzzStore((s) => s.setPreviousTab);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureBuzzStoreReset();
  }, []);
  useEffect(() => {
    if (tab !== 'buzz') setPreviousTab(tab);
  }, [tab, setPreviousTab]);
  useEffect(() => {
    if (active) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollTopSignal, active]);

  if (!accepted) {
    // an inactive, un-accepted pane is an empty incognito canvas: nothing to fetch, nothing to trap
    if (!active) return <div className="h-full" aria-hidden />;
    return (
      <div className="h-full overflow-y-auto overscroll-y-contain" style={{ paddingTop: PANE_TOP, paddingBottom: 'var(--nav-clearance)' }}>
        <BuzzGatePanel variant="pane" onDismiss={() => setTab(previousTab === 'buzz' ? 'reels' : previousTab)} className="pt-4" />
      </div>
    );
  }
  return <Feed active={active} scrollRef={scrollRef} />;
};

const Feed: FC<{ active: boolean; scrollRef: RefObject<HTMLDivElement | null> }> = ({ active, scrollRef }) => {
  const me = useMe();
  const sort = useBuzzStore((s) => s.sort);
  const window = useBuzzStore((s) => s.window);
  const scope = useBuzzStore((s) => s.scope);
  const coldStart = useBuzzStore((s) => s.coldStart);
  const coldStartDismissed = useBuzzStore((s) => s.coldStartDismissed);
  const { setSort, setWindow, setScope, dismissColdStart, openComposer } = useBuzzStore.getState();
  const feed = useBuzzFeed(sort, window, scope);
  const meta = useBuzzMeta(scope);
  const tracked = useRef<string>('');
  const navigate = useNavigate();
  const barHidden = useBarHidden(scrollRef);

  useEffect(() => {
    const key = `${sort}:${scope}`;
    if (active && tracked.current !== key) {
      tracked.current = key;
      track('buzz_feed_view', { sort, scope });
    }
  }, [active, sort, scope]);

  // cold start (SPEC §1 rule 1): campus first page empty → Global + banner
  useEffect(() => {
    if (scope === 'campus' && !feed.isLoading && !feed.isError && feed.items.length === 0 && sort === 'hot' && !coldStartDismissed) {
      setScope('global', { coldStart: true });
    }
  }, [scope, sort, feed.isLoading, feed.isError, feed.items.length, coldStartDismissed, setScope]);

  const gateError = isApiError(feed.error, 'buzz_gate_required');
  const onScope = (v: FeedScope): void => {
    setScope(v);
    if (v === 'campus') useBuzzStore.getState().dismissColdStart();
  };

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-y-contain" style={{ paddingTop: PANE_TOP }}>
        <div
          className={cn(
            'sticky z-(--z-sticky) flex flex-col gap-2 bg-canvas/85 px-4 py-2 backdrop-blur-md transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-opacity',
            barHidden && 'pointer-events-none -translate-y-full opacity-0',
          )}
          // The scroller's padding-top (PANE_TOP) already clears the top bar, and a sticky offset counts from inside that
          // padding — so -8px pins the bar flush under the top bar (the old `topbar-h` offset parked it 52px too low,
          // over the first card, leaving an empty band above it).
          style={{ top: -8 }}
          aria-hidden={barHidden || undefined}
          inert={barHidden || undefined}
        >
          <button
            type="button"
            onClick={() => {
              useBuzzStore.getState().setSearch({ scope });
              navigate(routes.buzzSearch());
            }}
            className="press flex h-10 w-full items-center gap-2 rounded-full bg-surface-2 px-4 text-left type-body text-ink-3"
          >
            <Search size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="truncate">Search {scope === 'campus' ? me.university.shortName : 'Global'} buzz</span>
          </button>
          <div className="flex items-center justify-between gap-2">
            <SegmentedControl<BuzzSort> aria-label="Sort" size="sm" value={sort} onChange={setSort} options={SORTS} />
            <CampusScopeToggle value={scope} onChange={onScope} size="sm" />
          </div>
        </div>
        {sort === 'top' ? (
          <div className="px-4 pb-2">
            <ChipGroup<BuzzTopWindow> aria-label="Top window" size="sm" scroll="x" value={window} onChange={(v: BuzzTopWindow) => setWindow(v)} options={WINDOWS} />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 pb-4">
          {coldStart && !coldStartDismissed && scope === 'global' ? (
            <ColdStartBanner universityName={me.university.name} onDismiss={dismissColdStart} onPost={() => openComposer()} />
          ) : null}
          {meta.data?.smallCampusNote && scope === 'campus' ? (
            <p className="mx-4 rounded-md bg-surface-2 px-3 py-2 type-footnote text-ink-3">Small campus: be mindful that details can identify you.</p>
          ) : null}
          {meta.data?.prompt && sort === 'hot' ? (
            <div className="mx-4 flex flex-col gap-3 rounded-lg border border-accent-line bg-hero-soft p-4">
              <div className="flex items-center gap-2 type-overline text-accent-ink">
                <Sparkles size={14} strokeWidth={2} aria-hidden />
                Today's prompt
              </div>
              <p className="type-headline text-ink">{meta.data.prompt.text}</p>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => openComposer({ promptId: meta.data!.prompt!.id })}>
                Answer anonymously
              </Button>
            </div>
          ) : null}

          {feed.isLoading ? (
            <div className="flex flex-col gap-3 px-4" aria-busy>
              <BuzzCardSkeleton />
              <BuzzCardSkeleton />
              <BuzzCardSkeleton />
            </div>
          ) : feed.isError && !gateError ? (
            <ErrorState title="Buzz didn't load. That's on us." error={feed.error} onRetry={() => void feed.refetch()} className="px-4" />
          ) : feed.items.length === 0 ? (
            <FeedEmpty sort={sort} window={window} scope={scope} universityName={me.university.name} onSeeGlobal={() => onScope('global')} onCheckNew={() => setSort('new')} onPost={() => openComposer()} />
          ) : (
            <div className="flex flex-col gap-3 px-4">
              {feed.items.map((b: Buzz) => (
                <BuzzCard key={b.id} buzz={b} />
              ))}
              <InfiniteSentinel {...feed.sentinelProps} rootRef={scrollRef} skeleton={<BuzzCardSkeleton />} endLabel="That's everything for now" />
            </div>
          )}
        </div>
        <div aria-hidden className="shrink-0" style={{ height: 'var(--nav-clearance)' }} />
      </div>
      <FAB icon={PenLine} label="New buzz" badgeIcon={VenetianMask} hideOnScroll={scrollRef} onClick={() => openComposer()} />
      <BuzzComposer />
    </div>
  );
};

const FeedEmpty: FC<{
  sort: BuzzSort; window: BuzzTopWindow; scope: FeedScope; universityName: string;
  onSeeGlobal(): void; onCheckNew(): void; onPost(): void;
}> = ({ sort, window, scope, universityName, onSeeGlobal, onCheckNew, onPost }) => {
  if (sort === 'top' && window === 'day') {
    return <EmptyState icon={Compass} title="Nothing has taken off today yet." action={{ label: 'Check New', onClick: onCheckNew }} compact />;
  }
  if (scope === 'campus') {
    return (
      <EmptyState
        icon={VenetianMask}
        title={`It's quiet at ${universityName}. Somebody has to say it first.`}
        action={{ label: 'Start the first buzz', onClick: onPost }}
        secondary={{ label: 'See Global', onClick: onSeeGlobal }}
        compact
      />
    );
  }
  return <EmptyState icon={VenetianMask} title="Nothing here yet." description="Be the first to say it." action={{ label: 'Start the first buzz', onClick: onPost }} compact />;
};
