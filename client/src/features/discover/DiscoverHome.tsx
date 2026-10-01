/**
 * Discover home (design §7.3 / SPEC §5.5): large header with the search field, Campus hub hero card, then
 * People you may know (rail) · Active creators · Popular orgs — each with a visible reason and a dismiss (x).
 * No Buzz content, no alias, no Phosphor here.
 */
import { useCallback, useState, type FC, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, MessagesSquare, Search, ShoppingBag, Sparkles, Users, type LucideIcon } from 'lucide-react';
import type { Suggestion } from '@shared/discover';
import { Button, Card, EmptyState, ErrorState, PageHeader, Screen, Skeleton } from '@/ui';
import { SectionHeader, UserAvatar } from '@/components';
import { errorMessage } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { copyLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { fetchInvite, useDiscoverHome, useDismissSuggestion } from './api';
import { SuggestionCard, SuggestionCardSkeleton, SuggestionRow, UserRowSkeleton } from './suggestions';

/* ------------------------------------------------------------------ campus hub hero */

const QUICK_LINKS: { label: string; icon: LucideIcon; to: string }[] = [
  { label: 'Events', icon: CalendarDays, to: routes.events() },
  { label: 'Course chats', icon: MessagesSquare, to: routes.courses() },
  { label: 'Marketplace', icon: ShoppingBag, to: routes.market() },
  { label: 'Roommates', icon: Users, to: routes.roommates() },
];

function CampusHubCard({ universityName }: { universityName: string }) {
  const navigate = useNavigate();
  return (
    <section aria-labelledby="discover-hub" className="px-4">
      <Card variant="hero">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-overline text-accent-ink">Campus hub</p>
            <h2 id="discover-hub" className="mt-0.5 truncate type-title-3 text-ink">
              {universityName}
            </h2>
            <p className="type-footnote text-ink-3">What's happening at your school today.</p>
          </div>
          <Button variant="secondary" size="sm" to={routes.campus()} className="shrink-0">
            Open
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {QUICK_LINKS.map((l) => (
            <button
              key={l.label}
              type="button"
              onClick={() => navigate(l.to)}
              className="press flex min-h-11 items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-left type-label-sm text-ink hover:border-line-strong"
            >
              <l.icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-ink" />
              <span className="truncate">{l.label}</span>
            </button>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ sections */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

function Rail({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-x flex snap-x gap-3 px-4 pb-1" role="list">
      {children}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div aria-hidden aria-busy className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center px-4">
          <Skeleton w={180} h={20} />
        </div>
        <Rail>
          {Array.from({ length: 4 }, (_, i) => (
            <SuggestionCardSkeleton key={i} />
          ))}
        </Rail>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center px-4">
          <Skeleton w={140} h={20} />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <UserRowSkeleton key={i} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center px-4">
          <Skeleton w={120} h={20} />
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <UserRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export const DiscoverHomePage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const home = useDiscoverHome();
  const dismiss = useDismissSuggestion();
  const [copying, setCopying] = useState(false);
  useScreenView('discover');

  const onDismiss = useCallback((s: Suggestion) => dismiss.mutate(s), [dismiss]);

  const copyInvite = async () => {
    setCopying(true);
    try {
      const invite = await fetchInvite();
      await copyLink(invite.url);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCopying(false);
    }
  };

  const data = home.data;
  const empty = data && data.peopleYouMayKnow.length === 0 && data.activeCreators.length === 0 && data.popularOrgs.length === 0;

  return (
    <Screen
      nav
      header={
        <PageHeader
          title="Discover"
          mode="large"
          actions={<UserAvatar user={me} size="sm" ring="orbit" className="mr-1" />}
          below={
            <button
              type="button"
              onClick={() => navigate(routes.search())}
              aria-label="Search people and orgs"
              className="press flex h-11 w-full items-center gap-2.5 rounded-full border border-line bg-surface-2 px-4 text-left type-body text-ink-3 hover:border-line-strong"
            >
              <Search size={18} strokeWidth={2} aria-hidden className="shrink-0" />
              <span className="truncate">Search people and orgs</span>
            </button>
          }
        />
      }
    >
      <div className="flex flex-col gap-6 pb-6 pt-2">
        <CampusHubCard universityName={me.university.name} />

        {home.isLoading ? (
          <HomeSkeleton />
        ) : home.isError ? (
          <ErrorState title="Couldn't load suggestions" error={home.error} onRetry={() => void home.refetch()} />
        ) : empty ? (
          <EmptyState
            icon={Sparkles}
            title="You're early."
            description={`As more of ${me.university.name} joins, people you may know show up here.`}
            action={{ label: copying ? 'Copying…' : 'Copy invite link', onClick: () => void copyInvite() }}
          />
        ) : data ? (
          <>
            {data.peopleYouMayKnow.length > 0 ? (
              <Section title="People you may know">
                <Rail>
                  {data.peopleYouMayKnow.map((s) => (
                    <div key={s.user.id} role="listitem" className="flex">
                      <SuggestionCard suggestion={s} onDismiss={onDismiss} />
                    </div>
                  ))}
                </Rail>
              </Section>
            ) : null}
            {data.activeCreators.length > 0 ? (
              <Section title="Active creators">
                <div role="list" className="flex flex-col">
                  {data.activeCreators.map((s) => (
                    <div key={s.user.id} role="listitem">
                      <SuggestionRow suggestion={s} onDismiss={onDismiss} />
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
            {data.popularOrgs.length > 0 ? (
              <Section title="Popular orgs">
                <div role="list" className="flex flex-col">
                  {data.popularOrgs.map((s) => (
                    <div key={s.user.id} role="listitem">
                      <SuggestionRow suggestion={s} onDismiss={onDismiss} />
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>
    </Screen>
  );
};
