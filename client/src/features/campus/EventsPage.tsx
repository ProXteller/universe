/**
 * `/campus/events` (product §2.9): filter chips Today · This week · Free food · Academic · Social · Sports · Career ·
 * Arts, date-grouped event cards, one FAB to host. Empty states carry the product copy.
 */
import { useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus, Utensils } from 'lucide-react';
import type { EventCard as EventCardT, EventFilter } from '@shared/campus';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS } from '@shared/campus';
import { ChipGroup, EmptyState, ErrorState, FAB, InfiniteSentinel, PageHeader, Screen } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useEvents } from './api';
import { EventCard, EventCardSkeleton } from './EventCard';
import { dayGroupLabel, dayKey } from './format';

type FilterValue = 'all' | EventFilter;

const FILTER_OPTIONS: readonly { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'free_food', label: 'Free food' },
  ...EVENT_CATEGORIES.map((c) => ({ value: c, label: EVENT_CATEGORY_LABELS[c] })),
];

function groupByDay(items: EventCardT[]): { key: string; label: string; items: EventCardT[] }[] {
  const groups: { key: string; label: string; items: EventCardT[] }[] = [];
  for (const e of items) {
    const key = dayKey(e.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, label: dayGroupLabel(e.startsAt), items: [e] });
  }
  return groups;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-3" aria-busy="true" aria-label="Loading events">
      <EventCardSkeleton />
      <EventCardSkeleton />
    </div>
  );
}

export const EventsPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const list = useEvents(filter === 'all' ? null : filter);
  useScreenView('campus_events', { filter });
  const groups = useMemo(() => groupByDay(list.items), [list.items]);

  return (
    <Screen
      scrollRef={scrollRef}
      header={
        <PageHeader
          mode="compact"
          back
          title="Events"
          below={
            <ChipGroup<FilterValue>
              aria-label="Filter events"
              scroll="x"
              size="sm"
              options={FILTER_OPTIONS}
              value={filter}
              onChange={(v: FilterValue) => setFilter(v)}
              className="px-4 py-2"
            />
          }
        />
      }
    >
      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState title="Couldn't load events" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        filter === 'free_food' ? (
          <EmptyState
            icon={Utensils}
            title="No free food right now."
            description="We're as disappointed as you are."
            action={{ label: 'Clear filter', onClick: () => setFilter('all') }}
          />
        ) : (
          <EmptyState
            icon={CalendarPlus}
            title={`Nothing on the calendar at ${me.university.shortName} yet.`}
            description="Hosting a study session, pickup game or club meeting? Put it up."
            action={{ label: 'Create event', onClick: () => navigate(routes.eventNew()) }}
            secondary={filter !== 'all' ? { label: 'Clear filter', onClick: () => setFilter('all') } : undefined}
          />
        )
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-24 pt-2">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="flex flex-col gap-3 pb-3">
              <h2 className="pt-2 type-overline text-ink-3">{g.label}</h2>
              {g.items.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </section>
          ))}
          <InfiniteSentinel {...list.sentinelProps} rootRef={scrollRef} skeleton={<EventCardSkeleton />} endLabel="That's everything coming up" />
        </div>
      )}
      <FAB icon={Plus} label="Host an event" extended hideOnScroll={scrollRef} onClick={() => navigate(routes.eventNew())} />
    </Screen>
  );
};
