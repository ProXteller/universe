/**
 * OrbitPane (SPEC §5.4, design §7.2, DECISIONS D8): the strictly reverse-chronological feed of people and orgs you
 * follow (any campus), with popular / official posts from your own campus mixed in by time. `FollowingReelsRail`
 * on top, PostCards separated by `line-subtle` dividers, "New since your last visit" divider, "New posts" pill
 * (ws `orbit.new_post` + 60 s `new-count`), caught-up end cap, FAB → composer sheet. The pane is its own Y scroller
 * under the Home top bar (no `<Screen>`; the pager owns the frame) and defers its first query until it is (nearly)
 * active.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Orbit, Plus, Sparkles } from 'lucide-react';
import type { Post } from '@shared/orbit';
import type { HomePaneProps } from '@/app/contracts';
import { EmptyState, ErrorState, FAB, InfiniteSentinel, PullToRefresh } from '@/ui';
import { FollowingReelsRail } from '@/features/reels';
import { routes } from '@/lib/links';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { useRealtime } from '@/lib/realtime';
import { useMe } from '@/lib/session';
import { useHomeTab } from '@/stores/home';
import { fetchNewCount, markFeedSeen, reloadFeed, useOrbitFeed } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { PostComposer } from './PostComposer';
import { ensureOrbitStoreReset, useOrbitStore } from './store';

const PANE_PADDING = { paddingTop: 'calc(var(--topbar-h) + var(--safe-top) + 8px)', paddingBottom: 'var(--nav-clearance)' } as const;
const PILL_TOP = { top: 'calc(var(--topbar-h) + var(--safe-top) + 12px)' } as const;
const NEW_COUNT_EVERY_MS = 60_000;

export const OrbitPane: FC<HomePaneProps> = ({ active }) => {
  const navigate = useNavigate();
  const me = useMe();
  const reduced = useReducedMotionPref();
  const { progress, scrollTopSignal } = useHomeTab();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState(active);
  const [newCount, setNewCount] = useState(0);
  const composerOpen = useOrbitStore((s) => s.composerOpen);
  const openComposer = useOrbitStore((s) => s.openComposer);
  const closeComposer = useOrbitStore((s) => s.closeComposer);
  const visitMarker = useRef<number | null | undefined>(undefined);

  useEffect(() => ensureOrbitStoreReset(), []);

  // defer the first query until the pager is heading here (design §6.5: within 0.15 of the pane) or it is active
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => {
    if (visited) return;
    if (progress.get() > 1.85) {
      setVisited(true);
      return;
    }
    return progress.on('change', (v) => {
      if (v > 1.85) setVisited(true);
    });
  }, [progress, visited]);

  const feed = useOrbitFeed(visited);
  const { items, isLoading, isError, error, refetch, lastVisitAt, followingCount, sentinelProps } = feed;

  // the previous-visit marker is captured ONCE per mount so the divider does not move on refetches; then mark seen
  useEffect(() => {
    if (isLoading || isError || !visited) return;
    if (visitMarker.current !== undefined) return;
    visitMarker.current = lastVisitAt;
    void markFeedSeen().catch(() => undefined);
  }, [isLoading, isError, visited, lastVisitAt]);

  const newest = items[0]?.createdAt ?? null;
  // a LOADED empty feed has nothing to keep in place, so new posts replace the empty state straight away instead of
  // waiting behind a pill that has nowhere to render
  const feedEmpty = visited && !isLoading && !isError && items.length === 0;

  // "New posts": ws event + a 60 s poll while active
  useRealtime('orbit.new_post', () => {
    if (!visited || isLoading) return;
    if (feedEmpty) void reloadFeed();
    else setNewCount((n) => n + 1);
  });
  useEffect(() => {
    if (!active || !visited || isLoading || isError) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { count } = await fetchNewCount(newest ?? 0);
        if (cancelled || count === 0) return;
        if (newest === null) await reloadFeed();
        else setNewCount((n) => Math.max(n, count));
      } catch {
        /* the pill is best-effort */
      }
    };
    const t = window.setInterval(() => void tick(), NEW_COUNT_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [active, visited, newest, isLoading, isError]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  const loadNew = useCallback(async () => {
    setNewCount(0);
    scrollToTop();
    await reloadFeed();
  }, [scrollToTop]);

  // re-tapping the Orbit tab / Home nav item: scroll to top and refetch (product §2.0) — also the refresh path when
  // pull-to-refresh is off under reduced motion
  const lastSignal = useRef(scrollTopSignal);
  useEffect(() => {
    if (lastSignal.current === scrollTopSignal) return;
    lastSignal.current = scrollTopSignal;
    if (!active || !visited) return;
    void loadNew();
  }, [scrollTopSignal, active, visited, loadNew]);

  const refresh = useCallback(async () => {
    setNewCount(0);
    await reloadFeed();
  }, []);

  // index of the first item that is NOT new since the last visit → the divider sits above it
  const dividerBefore = useMemo(() => {
    const marker = visitMarker.current ?? lastVisitAt;
    if (marker === null || marker === undefined || items.length === 0) return -1;
    const i = items.findIndex((p) => p.createdAt <= marker);
    return i > 0 ? i : -1;
  }, [items, lastVisitAt]);

  let body: React.ReactNode;
  if (!visited || isLoading) {
    body = (
      <div aria-busy="true" aria-label="Loading your Orbit">
        <PostSkeleton />
        <PostSkeleton media />
        <PostSkeleton />
      </div>
    );
  } else if (isError) {
    body = <ErrorState title="Couldn't load your Orbit" error={error} onRetry={() => void refetch()} />;
  } else if (items.length === 0) {
    body =
      followingCount === 0 ? (
        <EmptyState
          icon={Orbit}
          title="Your Orbit is empty"
          description={`Posts from people and orgs you follow show up here, plus what's popular at ${me.university.shortName}.`}
          action={{ label: 'Find people to follow', onClick: () => navigate(routes.discover()) }}
          secondary={{ label: 'Write a post', onClick: openComposer }}
        />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Nobody in your Orbit has posted yet"
          description="Start the conversation."
          action={{ label: 'Write a post', onClick: openComposer }}
        />
      );
  } else {
    body = (
      <>
        <ul className="flex flex-col" aria-label="Posts">
          {items.map((post: Post, i) => (
            <li key={post.id} className="border-b border-line-subtle last:border-b-0">
              {i === dividerBefore ? <VisitDivider /> : null}
              <PostCard post={post} />
            </li>
          ))}
        </ul>
        <InfiniteSentinel {...sentinelProps} rootRef={scrollRef} endLabel="You're all caught up." skeleton={<PostSkeleton />} />
      </>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-y-contain" style={PANE_PADDING} data-orbit-scroll>
        <PullToRefresh onRefresh={refresh} disabled={!visited || isLoading}>
          {visited ? <FollowingReelsRail className="mb-2" /> : null}
          {body}
        </PullToRefresh>
      </div>

      <AnimatePresence>
        {newCount > 0 && items.length > 0 ? (
          <motion.div
            key="new-posts"
            className="pointer-events-none absolute inset-x-0 z-(--z-sticky) flex justify-center"
            style={PILL_TOP}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={spring.snappy}
          >
            <button
              type="button"
              onClick={() => void loadNew()}
              className="press pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 type-label-sm text-on-accent shadow-glow"
            >
              <ArrowUp size={16} strokeWidth={2.25} aria-hidden />
              {newCount === 1 ? '1 new post' : `${newCount} new posts`}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {visited ? <FAB icon={Plus} label="New post" extended onClick={openComposer} hideOnScroll={scrollRef} /> : null}
      <PostComposer open={composerOpen} onOpenChange={(o) => (o ? openComposer() : closeComposer())} onPosted={scrollToTop} />
    </div>
  );
};

/** Sits between the posts that arrived since the previous visit (above) and the ones already seen (below). */
const VisitDivider: FC = () => (
  <div className="flex items-center gap-3 px-4 py-2" role="separator" aria-label="New since your last visit">
    <span className="h-px flex-1 bg-accent-line" />
    <span className="inline-flex items-center gap-1 type-overline text-accent-ink">
      <ArrowUp size={12} strokeWidth={2.5} aria-hidden />
      New since your last visit
    </span>
    <span className="h-px flex-1 bg-accent-line" />
  </div>
);
