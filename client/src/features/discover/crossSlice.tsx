/**
 * The three cross-slice React components the profile tabs embed (SPEC §6: reels `UserReelsGrid`, orbit
 * `UserPostsList`, campus `OrgEventsList`). Loaded lazily so another slice's chunk never blocks Discover, and
 * wrapped in a boundary that renders NOTHING when the provider is a stub, throws or fails to load (R6).
 */
import { Component, Suspense, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { Skeleton } from '@/ui';
import type { UserContentProps } from '@/app/contracts';

const ReelsGrid = lazy(() => import('@/features/reels').then((m) => ({ default: m.UserReelsGrid })));
const PostsList = lazy(() => import('@/features/orbit').then((m) => ({ default: m.UserPostsList })));
const EventsList = lazy(() => import('@/features/campus').then((m) => ({ default: m.OrgEventsList })));

interface BoundaryState {
  failed: boolean;
}

/** Degrades silently (R6): a broken provider renders nothing, never a crash. */
class SilentBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.warn('discover: embedded slice component failed', error, info.componentStack);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function TabSkeleton({ kind }: { kind: 'grid' | 'list' }) {
  if (kind === 'grid') {
    return (
      <div aria-hidden className="grid grid-cols-3 gap-0.5 px-0">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16] w-full rounded-none" />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col gap-4 px-4 py-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Skeleton w={40} h={40} circle />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton w="45%" h={14} />
              <Skeleton w="30%" h={12} />
            </div>
          </div>
          <Skeleton w="100%" h={14} />
          <Skeleton w="80%" h={14} />
        </div>
      ))}
    </div>
  );
}

function embed(Inner: ComponentType<UserContentProps>, kind: 'grid' | 'list'): ComponentType<UserContentProps> {
  const Embedded = (props: UserContentProps) => (
    <SilentBoundary>
      <Suspense fallback={<TabSkeleton kind={kind} />}>
        <Inner {...props} />
      </Suspense>
    </SilentBoundary>
  );
  Embedded.displayName = `Embedded(${Inner.displayName ?? Inner.name ?? 'Slice'})`;
  return Embedded;
}

export const EmbeddedReelsGrid = embed(ReelsGrid, 'grid');
export const EmbeddedPostsList = embed(PostsList, 'list');
export const EmbeddedEventsList = embed(EventsList, 'list');
