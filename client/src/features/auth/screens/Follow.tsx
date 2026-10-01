/**
 * 1.6 Follow suggestions (product §1.6, SPEC §5.1): inviter pinned + tagged, sections with honest reason lines,
 * "Follow top 5" (`POST /onboarding/follow-many`), the sticky CTA that never blocks, the new-campus variant with
 * [Copy invite link], then `POST /me/onboarding/complete` → rings-expand exit → Home / `next` (+ one-time coach mark).
 *
 * Exit mechanics: `setMe(user)` with `onboarding.completed = true` flips the session to `'ready'`, and foundation's
 * `RedirectIfReady` (wrapping `/welcome/*`) then navigates to the stored `next` (or `/` → Home). The screen therefore
 * plays the exit FIRST and calls `setMe` last — it never navigates itself (a second navigate would race the guard).
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Link2, Orbit } from 'lucide-react';
import type { FollowResult, Id, UserListItem } from '@shared/core';
import type { OnboardingSuggestionRow, OnboardingSuggestions } from '@shared/auth';
import { Button, Card, EmptyState, ErrorState, Skeleton, SkeletonText } from '@/ui';
import { FollowButton, SectionHeader, UserRow } from '@/components';
import { errorMessage } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { useLocalStorage } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { useReducedMotionPref } from '@/lib/motion';
import { queryClient } from '@/lib/query';
import { getPendingNext, setMe, useMeOptional } from '@/lib/session';
import { absoluteUrl, copyLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { authApi, authKeys } from '../api';
import { RINGS_EXIT_MS, RingsExit } from '../RingsExit';
import { InlineError, StepFooter, StepScreen, StepTitle } from '../shared';

const COPY = {
  title: 'Build your Orbit',
  sub: 'Orbit only shows people and orgs you follow — no algorithm, no strangers. Pick a few to start.',
  newCampus: (university: string) => `You're the first from ${university}. Here are people from other campuses while yours fills up.`,
  bring: 'Bring your campus with you',
  bringSub: 'Share your invite link — everyone who joins from it lands in your Orbit.',
  coach: 'Swipe for Buzz and Orbit',
  emptyTitle: 'Nobody to suggest yet',
  emptySub: 'Your Orbit fills up as your campus joins. You can follow people from Discover any time.',
} as const;

const GOAL = 3;
const TOP_N = 5;
/** `/home` — the coach mark only makes sense when the exit lands on the Home pager. */
const HOME_PREFIX = routes.home('reels').slice(0, routes.home('reels').lastIndexOf('/'));

/* ------------------------------------------------------------------ cache helpers */

function patchRows(data: OnboardingSuggestions, fn: (row: OnboardingSuggestionRow) => OnboardingSuggestionRow): OnboardingSuggestions {
  return {
    ...data,
    inviter: data.inviter ? fn(data.inviter) : null,
    sections: data.sections.map((s) => ({ ...s, rows: s.rows.map(fn) })),
  };
}

function setFollowing(ids: ReadonlySet<Id>, following: boolean): void {
  queryClient.setQueryData<OnboardingSuggestions>(authKeys.suggestions(), (data) =>
    data
      ? patchRows(data, (row) => (ids.has(row.user.id) ? { ...row, user: { ...row.user, viewer: { ...row.user.viewer, isFollowing: following } } } : row))
      : data,
  );
}

function allRows(data: OnboardingSuggestions): OnboardingSuggestionRow[] {
  return [...(data.inviter ? [data.inviter] : []), ...data.sections.flatMap((s) => s.rows)];
}

/* ------------------------------------------------------------------ pieces */

/**
 * Suggestion row. `UserRow`'s default body tap navigates to `/u/:handle`, an onboarded-only route: mid-onboarding
 * `RequireOnboarded` would overwrite the stored `?next=` with `/u/<handle>` and bounce back to `/welcome`, so the exit
 * would land on the profile instead of `next`. Every session on this screen is `'onboarding'` (`RedirectIfReady`
 * bounces ready ones), so the profile is unreachable anyway — the body is inert and the FollowButton is the action.
 */
function Row({ row }: { row: OnboardingSuggestionRow }) {
  const user: UserListItem = row.user;
  return (
    <UserRow
      user={user}
      reason={row.reason}
      tag={row.tag === 'invited_you' ? 'Invited you' : undefined}
      onClick={() => {
        /* no navigation before onboarding completes */
      }}
      trailing={
        <FollowButton
          userId={user.id}
          initialFollowing={user.viewer.isFollowing}
          followsMe={user.viewer.isFollowedBy}
          size="sm"
          onChange={(r: FollowResult) => setFollowing(new Set([r.userId]), r.isFollowing)}
        />
      }
    />
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading suggestions">
      <div className="px-4 py-2.5">
        <Skeleton w={160} h={20} />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-2">
          <Skeleton w={40} h={40} circle />
          <div className="flex flex-1 flex-col gap-1.5">
            <SkeletonText lines={2} />
          </div>
          <Skeleton w={72} h={36} className="rounded-full" />
        </div>
      ))}
    </div>
  );
}

function ctaLabel(n: number): string {
  if (n === 0) return 'Skip for now';
  if (n < GOAL) return `Continue — follow ${GOAL - n} more for a better Orbit`;
  return 'Enter UniVerse';
}

/* ------------------------------------------------------------------ screen */

export function FollowScreen() {
  const me = useMeOptional();
  const reduced = useReducedMotionPref();
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coachSeen, setCoachSeen] = useLocalStorage<boolean>('uv:auth:coach', false);
  useScreenView('welcome_follow');

  // The server drops followed accounts from the response, so the list is fetched once per visit and then kept
  // stable in the cache (a focus / reconnect refetch would make rows vanish under the user's thumb).
  const q = useQuery({
    queryKey: authKeys.suggestions(),
    queryFn: authApi.suggestions,
    enabled: Boolean(me) && Boolean(me?.onboarding.guidelinesAccepted),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const followTop = useMutation({
    mutationFn: (ids: Id[]) => authApi.followMany({ userIds: ids }),
    onMutate: (ids) => setFollowing(new Set(ids), true),
    onSuccess: (res, ids) => {
      const followed = new Set(res.followed);
      setFollowing(new Set(ids.filter((id) => !followed.has(id))), false);
      track('follow', { count: res.followed.length, source: 'onboarding_top' });
      void queryClient.invalidateQueries({ queryKey: ['orbit', 'feed'] });
      void queryClient.invalidateQueries({ queryKey: ['reels', 'following'] });
    },
    onError: (e, ids) => {
      setFollowing(new Set(ids), false);
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
  });

  const enter = useMutation({
    mutationFn: authApi.completeOnboarding,
    onSuccess: async (user) => {
      const followed = q.data ? allRows(q.data).filter((r) => r.user.viewer.isFollowing).length : 0;
      track('onboarding_completed', { followed });
      const next = getPendingNext();
      const landsOnHome = !next || next === '/' || next.startsWith(HOME_PREFIX);
      if (!reduced) {
        setExiting(true);
        await new Promise((r) => window.setTimeout(r, RINGS_EXIT_MS));
      }
      if (landsOnHome && !coachSeen) {
        setCoachSeen(true);
        toast.info(COPY.coach, { duration: 5000 });
      }
      setMe(user); // → session 'ready' → RedirectIfReady navigates to `next` / Home
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!me) return <Navigate to={routes.welcome()} replace />;
  if (!me.onboarding.guidelinesAccepted) return <Navigate to={routes.welcomeStep('guidelines')} replace />;

  const data = q.data;
  const rows = data ? allRows(data) : [];
  const followedCount = rows.filter((r) => r.user.viewer.isFollowing).length;
  const orgSection = data?.sections.find((s) => s.id === 'popular_orgs');
  const topIds = orgSection ? orgSection.rows.filter((r) => !r.user.viewer.isFollowing).slice(0, TOP_N).map((r) => r.user.id) : [];
  const isEmpty = data && rows.length === 0;

  const copyInvite = async () => {
    await copyLink(absoluteUrl(routes.invite(me.inviteCode)));
    track('invite_link_copied', { source: 'onboarding' });
  };

  return (
    <StepScreen
      step="follow"
      title="Build your Orbit"
      back={false}
      footer={
        <StepFooter>
          {error ? <InlineError>{error}</InlineError> : null}
          <Button
            variant={followedCount >= GOAL ? 'hero' : 'primary'}
            size="lg"
            fullWidth
            loading={enter.isPending || exiting}
            rightIcon={ArrowRight}
            onClick={() => enter.mutate()}
          >
            {ctaLabel(followedCount)}
          </Button>
        </StepFooter>
      }
    >
      <StepTitle title={COPY.title} sub={data?.isNewCampus ? COPY.newCampus(me.university.name) : COPY.sub} />

      {data?.isNewCampus ? (
        <Card variant="hero">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="type-headline text-ink">{COPY.bring}</p>
              <p className="type-footnote text-ink-2">{COPY.bringSub}</p>
            </div>
            <Button variant="secondary" size="md" leftIcon={Link2} onClick={() => void copyInvite()}>
              Copy invite link
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="-mx-4 flex flex-col">
        {q.isLoading ? <ListSkeleton /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {isEmpty ? <EmptyState icon={Orbit} title={COPY.emptyTitle} description={COPY.emptySub} compact /> : null}

        {data?.inviter ? (
          <div className="mb-2">
            <Row row={data.inviter} />
          </div>
        ) : null}

        {data?.sections.map((section) => (
          <section key={section.id} className="mb-2" aria-label={section.title}>
            <SectionHeader
              title={section.title}
              action={
                section.id === 'popular_orgs' && topIds.length > 0
                  ? { label: `Follow top ${Math.min(TOP_N, topIds.length)}`, onClick: () => followTop.mutate(topIds) }
                  : undefined
              }
            />
            {section.rows.map((row) => (
              <Row key={row.user.id} row={row} />
            ))}
          </section>
        ))}
      </div>

      {exiting ? <RingsExit /> : null}
    </StepScreen>
  );
}
