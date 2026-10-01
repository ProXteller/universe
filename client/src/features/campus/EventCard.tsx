/**
 * Event card (design §7.8): `media` Card with a 16:9 cover, a 48px date tile, title, host row, place · time, going
 * count and the friends-going AvatarStack. `rail` = the 280px carousel variant on the hub. Plus its skeleton.
 */
import { forwardRef } from 'react';
import { MapPin, Utensils } from 'lucide-react';
import type { EventCard as EventCardT } from '@shared/campus';
import { AvatarStack, Badge, Card, Skeleton } from '@/ui';
import { MediaBox, UserAvatar } from '@/components';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { dateTile, formatStartTime } from './format';

export interface EventCardProps {
  event: EventCardT;
  variant?: 'list' | 'rail';
  className?: string;
}

export const EventCard = forwardRef<HTMLElement, EventCardProps>(function EventCard({ event, variant = 'list', className }, ref) {
  const tile = dateTile(event.startsAt);
  const rail = variant === 'rail';
  const goingLabel = event.goingCount === 1 ? '1 going' : `${event.goingCount} going`;
  return (
    <Card
      ref={ref}
      variant="media"
      to={routes.event(event.id)}
      aria-label={`${event.title}, ${tile.weekday} ${tile.month} ${tile.day} at ${formatStartTime(event.startsAt)}`}
      className={cn('flex flex-col', rail ? 'w-70 shrink-0 snap-start' : 'w-full', event.cancelled && 'opacity-80', className)}
    >
      <MediaBox
        src={event.coverUrl}
        alt=""
        aspect="16:9"
        rounded="none"
        overlay={
          <>
            <div aria-hidden className="absolute left-3 top-3 flex w-12 flex-col items-center rounded-md bg-glass-strong py-1.5 text-ink backdrop-blur-sm">
              <span className="type-overline leading-none text-ink-2">{tile.month}</span>
              <span className="font-display type-title-2 leading-none">{tile.day}</span>
            </div>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
              {event.cancelled ? <Badge variant="soft" tone="danger">Cancelled</Badge> : null}
              {event.freeFood ? (
                <Badge variant="soft" tone="success">
                  <Utensils size={12} strokeWidth={2} aria-hidden /> Free food
                </Badge>
              ) : null}
              {event.myRsvp ? <Badge variant="soft" tone="accent">{event.myRsvp === 'going' ? 'Going' : 'Interested'}</Badge> : null}
            </div>
          </>
        }
      />
      <div className={cn('flex flex-col gap-2 p-3.5', rail && 'p-3')}>
        <h3 className={cn('line-clamp-2 text-ink', rail ? 'type-label' : 'type-title-3')}>{event.title}</h3>
        <div className="flex min-w-0 items-center gap-2">
          <UserAvatar user={event.host} size="xs" link={false} />
          <span className="truncate type-caption text-ink-2">{event.host.displayName}</span>
          {event.host.accountType === 'org' ? <Badge variant="outline" tone="neutral">Org</Badge> : null}
        </div>
        <p className="flex min-w-0 items-center gap-1.5 type-caption text-ink-3">
          <MapPin size={14} strokeWidth={2} aria-hidden className="shrink-0" />
          <span className="truncate">{event.locationName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{formatStartTime(event.startsAt)}</span>
        </p>
        <div className="flex min-h-6 items-center justify-between gap-2">
          <span className="type-caption text-ink-2 tabular-nums">{goingLabel}</span>
          {event.friendsGoing.length > 0 ? (
            <AvatarStack
              size="xs"
              users={event.friendsGoing.map((u) => ({ src: u.avatarUrl, name: u.displayName, shape: u.accountType === 'org' ? 'org' : 'circle' }))}
            />
          ) : null}
        </div>
      </div>
    </Card>
  );
});

export function EventCardSkeleton({ variant = 'list' }: { variant?: 'list' | 'rail' }) {
  const rail = variant === 'rail';
  return (
    <div aria-hidden className={cn('overflow-hidden rounded-lg border border-line bg-surface-1', rail ? 'w-70 shrink-0' : 'w-full')}>
      <Skeleton w="100%" h={0} className="aspect-video h-auto rounded-none" />
      <div className={cn('flex flex-col gap-2.5 p-3.5', rail && 'p-3')}>
        <Skeleton w="72%" h={16} />
        <div className="flex items-center gap-2">
          <Skeleton circle w={24} h={24} />
          <Skeleton w="40%" h={10} />
        </div>
        <Skeleton w="55%" h={10} />
        <Skeleton w="30%" h={10} />
      </div>
    </div>
  );
}
