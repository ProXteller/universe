/**
 * `OrgEventsList` (SPEC §4.6 / §6): the Events tab of a profile — events hosted by `userId`, upcoming then past.
 * Embedded in discover's profile `<Screen>`: it MUST NOT create its own scroll container.
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import type { UserContentProps } from '@/app/contracts';
import { EmptyState, ErrorState, InfiniteSentinel } from '@/ui';
import { routes } from '@/lib/links';
import { useUserEvents } from './api';
import { EventCard, EventCardSkeleton } from './EventCard';

export const OrgEventsList: FC<UserContentProps> = ({ userId, isSelf }) => {
  const navigate = useNavigate();
  const list = useUserEvents(userId);

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-3 px-4 py-3" aria-busy="true" aria-label="Loading events">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </div>
    );
  }
  if (list.isError) {
    return <ErrorState title="Couldn't load events" error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarDays}
        title={isSelf ? 'No events yet.' : 'No events yet.'}
        description={isSelf ? 'Host a study session, a pickup game or a club meeting.' : 'Check back when they host something.'}
        action={isSelf ? { label: 'Host an event', onClick: () => navigate(routes.eventNew()) } : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {list.items.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
      <InfiniteSentinel {...list.sentinelProps} skeleton={<EventCardSkeleton />} endLabel={null} />
    </div>
  );
};
