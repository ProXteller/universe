/**
 * `/campus` (product §2.9, design §7.8): "{university}" + member count + launch meter with [Share invite link], the
 * Today strip that reads as a sentence, the "Your courses" rail with unread dots, Upcoming, and the quick links.
 * `today.newListings` comes from `GET /api/market/summary` client-side; a missing market slice just drops the clause.
 */
import { useCallback, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BedDouble, BookOpen, Building2, CalendarDays, CalendarPlus, ChevronRight, GraduationCap, Link2, Share, ShieldCheck, Store, UserPlus, type LucideIcon,
} from 'lucide-react';
import { APP_NAME } from '@shared/core';
import type { Course } from '@shared/campus';
import { Badge, Button, CampusBadge, Card, EmptyState, ErrorState, ListRow, PageHeader, ProgressRing, Screen, Skeleton } from '@/ui';
import { SectionHeader } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { absoluteUrl, copyLink } from '@/lib/share';
import { useHub, useMarketSummary } from './api';
import { EventCard, EventCardSkeleton } from './EventCard';

const QUICK_LINKS: { label: string; icon: LucideIcon; to: string }[] = [
  { label: 'Events', icon: CalendarDays, to: routes.events() },
  { label: 'Course chats', icon: BookOpen, to: routes.courses() },
  { label: 'Roommates', icon: BedDouble, to: routes.roommates() },
  { label: 'Marketplace', icon: Store, to: routes.market() },
  { label: 'Apartments', icon: Building2, to: routes.apartments() },
  { label: 'Guidelines', icon: ShieldCheck, to: routes.guidelines() },
];

function todaySentence(events: number, freeFood: number, newListings: number | null): string {
  const parts: string[] = [];
  if (events === 0) parts.push('nothing on the calendar');
  else parts.push(`${events} ${events === 1 ? 'event' : 'events'}`);
  if (freeFood > 0) parts.push(`${freeFood} with free food`);
  if (newListings !== null) parts.push(`${formatCount(newListings)} new ${newListings === 1 ? 'listing' : 'listings'}`);
  return `Today: ${parts.join(' · ')}`;
}

function CourseTile({ course }: { course: Course }) {
  const unread = course.unread > 0;
  return (
    <Card
      variant="flat"
      to={course.conversationId ? routes.chat(course.conversationId) : routes.course(course.id)}
      aria-label={`${course.code}, ${course.title}${unread ? `, ${course.unread} new` : ''}`}
      className="flex w-40 shrink-0 snap-start flex-col gap-1.5 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display type-label text-ink">{course.code}</span>
        {unread ? <Badge variant="dot" tone="accent" /> : null}
      </div>
      <span className="line-clamp-2 type-caption text-ink-2">{course.title}</span>
      <span className="type-micro text-ink-3">{unread ? `${course.unread} new` : `${formatCount(course.memberCount)} classmates`}</span>
    </Card>
  );
}

function HubSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-4 py-3" aria-busy="true" aria-label="Loading campus">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-1 p-4">
        <Skeleton circle w={64} h={64} />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton w="60%" h={14} />
          <Skeleton w="40%" h={10} />
          <Skeleton w={140} h={36} className="rounded-full" />
        </div>
      </div>
      <Skeleton w="85%" h={14} />
      <div className="flex gap-3 overflow-hidden">
        <Skeleton w={160} h={92} className="rounded-lg" />
        <Skeleton w={160} h={92} className="rounded-lg" />
        <Skeleton w={160} h={92} className="rounded-lg" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        <EventCardSkeleton variant="rail" />
        <EventCardSkeleton variant="rail" />
      </div>
    </div>
  );
}

export const HubPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const hub = useHub();
  const market = useMarketSummary();
  useScreenView('campus_hub');

  const shareInvite = useCallback(async () => {
    const url = absoluteUrl(routes.invite(me.inviteCode));
    track('invite_link_copied', { source: 'campus_hub' });
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Join me on ${APP_NAME}`, text: `${me.university.name} is on ${APP_NAME}. Join with my link.`, url });
        return;
      } catch {
        /* dismissed or unsupported → fall back to copy */
      }
    }
    await copyLink(url);
  }, [me.inviteCode, me.university.name]);

  const data = hub.data;
  const upcoming = data ? [...data.todayEvents, ...data.upcoming.filter((e) => !data.todayEvents.some((t) => t.id === e.id))] : [];
  const newListings = market.data ? market.data.newListings24h : null;

  return (
    <Screen nav header={<PageHeader mode="large" back title={me.university.name} subtitle={<CampusBadge name={me.university.shortName} />} />}>
      {hub.isLoading ? (
        <HubSkeleton />
      ) : hub.isError || !data ? (
        <ErrorState title="Couldn't load your campus" error={hub.error} onRetry={() => void hub.refetch()} />
      ) : (
        <div className="flex flex-col gap-6 pb-6 pt-2">
          {/* launch meter */}
          <section className="px-4" aria-label="Campus launch">
            <Card variant="hero" className="flex items-center gap-4">
              <ProgressRing
                size={64}
                value={data.launch.goal ? data.launch.count / data.launch.goal : 1}
                label={<span className="tabular-nums">{formatCount(data.launch.count)}</span>}
                aria-label={data.launch.goal ? `${data.launch.count} of ${data.launch.goal} students` : `${data.launch.count} students`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-col">
                  <span className="type-label text-ink tabular-nums">
                    {data.launch.goal ? `${formatCount(data.launch.count)} of ${formatCount(data.launch.goal)} students` : `${formatCount(data.launch.count)} students · 5,000+`}
                  </span>
                  <span className="type-caption text-ink-3">
                    {data.launch.goal ? `${data.launch.goal - data.launch.count} more and ${me.university.shortName} passes the next milestone.` : `${me.university.shortName} is fully launched.`}
                  </span>
                </div>
                <Button size="sm" variant="secondary" leftIcon={Share} onClick={() => void shareInvite()} className="self-start">
                  Share invite link
                </Button>
              </div>
            </Card>
          </section>

          {/* today strip */}
          <section className="px-4" aria-label="Today">
            <p className="type-body text-ink">{todaySentence(data.today.events, data.today.freeFood, newListings)}</p>
          </section>

          {/* your courses */}
          <section aria-label="Your courses">
            <SectionHeader title="Your courses" action={{ label: data.myCourses.length > 0 ? 'Find more' : 'Find', to: routes.courses() }} />
            {data.myCourses.length === 0 ? (
              <div className="px-4">
                <EmptyState
                  compact
                  icon={BookOpen}
                  title="Add your classes to find your people."
                  action={{ label: 'Find my courses', onClick: () => navigate(routes.courses()) }}
                />
              </div>
            ) : (
              <div className="scroll-x flex snap-x gap-3 px-4 py-1">
                {data.myCourses.map((c) => (
                  <CourseTile key={c.id} course={c} />
                ))}
              </div>
            )}
          </section>

          {/* upcoming */}
          <section aria-label="Upcoming events">
            <SectionHeader title="Upcoming" action={{ label: 'See all', to: routes.events() }} />
            {upcoming.length === 0 ? (
              <div className="px-4">
                <EmptyState
                  compact
                  icon={CalendarPlus}
                  title={`Nothing on the calendar at ${me.university.shortName} yet.`}
                  description="Hosting a study session, pickup game or club meeting? Put it up."
                  action={{ label: 'Create event', onClick: () => navigate(routes.eventNew()) }}
                />
              </div>
            ) : (
              <div className="scroll-x flex snap-x gap-3 px-4 py-1">
                {upcoming.map((e) => (
                  <EventCard key={e.id} event={e} variant="rail" />
                ))}
                <Card to={routes.events()} variant="flat" className="flex w-32 shrink-0 snap-start flex-col items-center justify-center gap-2 text-ink-2">
                  <ChevronRight size={20} strokeWidth={1.75} aria-hidden />
                  <span className="type-label-sm">All events</span>
                </Card>
              </div>
            )}
          </section>

          {/* quick links */}
          <section className="flex flex-col gap-3 px-4" aria-label="Quick links">
            <h2 className="type-title-3 text-ink">Around campus</h2>
            <div className="grid grid-cols-2 gap-3">
              {QUICK_LINKS.map(({ label, icon: Icon, to }) => (
                <Card key={label} to={to} variant="flat" className={cn('flex min-h-16 items-center gap-3 p-3')}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                    <Icon size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="type-label text-ink">{label}</span>
                </Card>
              ))}
            </div>
            <Card variant="flat" className="p-0">
              <ListRow
                leading={
                  <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
                    <UserPlus size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                }
                title="Invite friends"
                subtitle={`Your link: ${routes.invite(me.inviteCode)}`}
                trailing="chevron"
                to={routes.settings('invite')}
              />
              <ListRow
                leading={
                  <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
                    <Link2 size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                }
                title="Copy invite link"
                subtitle="Paste it where your class already talks."
                onClick={() => void shareInvite()}
              />
            </Card>
            <p className="flex items-center gap-1.5 px-1 type-caption text-ink-3">
              <GraduationCap size={14} strokeWidth={2} aria-hidden />
              Only verified {me.university.shortName} students can join.
            </p>
          </section>
        </div>
      )}
    </Screen>
  );
};
