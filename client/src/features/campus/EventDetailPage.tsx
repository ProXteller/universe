/**
 * `/campus/events/:id` (product §2.9, design §7.8): cover, host row with Follow, when / where, description, attendees
 * (follows first), the RSVP pair as the bottom bar (optimistic), Share, Add to calendar (client `.ics`), Report /
 * Block, host Edit / Cancel, "Follow {org}?" after an RSVP to an unfollowed org, cancelled + ended states.
 */
import { useEffect, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { CalendarDays, CalendarOff, CalendarPlus, CalendarX, Check, Ellipsis, MapPin, Share, SquarePen, Users, Utensils, X } from 'lucide-react';
import type { Id, UserSummary } from '@shared/core';
import type { EventCard as EventCardT, EventDetail as EventDetailT, RsvpState } from '@shared/campus';
import { EVENT_CATEGORY_LABELS } from '@shared/campus';
import { AvatarStack, Badge, Button, Card, Dialog, EmptyState, ErrorState, IconButton, ListRow, PageHeader, Screen, Skeleton, SkeletonText } from '@/ui';
import { FollowButton, MediaBox, OverflowMenu, UserAvatar, UserListSheet, UserRow } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { ContentStatusChip, handleModerationError } from '@/lib/moderation';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { queryClient } from '@/lib/query';
import { useMe } from '@/lib/session';
import { openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { attendeesPath, campusKeys, cancelEventRequest, invalidateCampus, patchEvent, rsvpRequest, seedEventDetail, useEvent } from './api';
import { formatEventRange } from './format';
import { downloadIcs } from './ics';

export const EventDetailPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  return <EventDetail key={id} id={id} />;
};

function optimistic(e: EventCardT, state: RsvpState | null): EventCardT {
  const wasGoing = e.myRsvp === 'going';
  const nowGoing = state === 'going';
  return { ...e, myRsvp: state, goingCount: Math.max(0, e.goingCount + (nowGoing ? 1 : 0) - (wasGoing ? 1 : 0)) };
}

function friendsSentence(friends: UserSummary[], goingCount: number): string | null {
  if (friends.length === 0) return null;
  const names = friends.map((f) => f.displayName.split(/\s+/)[0]);
  const others = goingCount - friends.length;
  const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names[2]}`;
  return others > 0 ? `${list} you follow ${names.length === 1 ? 'is' : 'are'} going, plus ${others} more` : `${list} you follow ${names.length === 1 ? 'is' : 'are'} going`;
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading event">
      <Skeleton w="100%" h={0} className="aspect-video h-auto rounded-none" />
      <div className="flex flex-col gap-3 px-4">
        <Skeleton w={96} h={20} className="rounded-full" />
        <Skeleton w="80%" h={22} />
        <Skeleton w="60%" h={14} />
        <Skeleton w="50%" h={14} />
        <div className="flex items-center gap-3 py-2">
          <Skeleton circle w={44} h={44} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton w="40%" h={12} />
            <Skeleton w="30%" h={10} />
          </div>
        </div>
        <SkeletonText lines={3} />
      </div>
    </div>
  );
}

const EventDetail: FC<{ id: Id }> = ({ id }) => {
  const me = useMe();
  const navigate = useNavigate();
  const q = useEvent(id);
  const reduced = useReducedMotionPref();
  const [menuOpen, setMenuOpen] = useState(false);
  const [attendees, setAttendees] = useState<RsvpState | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [followPrompt, setFollowPrompt] = useState(false);
  useScreenView('event_detail');

  const data = q.data;
  useEffect(() => {
    if (data) track('event_view', { category: data.category, host: data.host.accountType });
    // once per event id (the page is keyed by id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const rsvp = useMutation<EventCardT, unknown, RsvpState | null, { prev: EventDetailT | undefined }>({
    mutationFn: (state) => rsvpRequest(id, state),
    onMutate: (state) => {
      const prev = queryClient.getQueryData<EventDetailT>(campusKeys.event(id));
      patchEvent(id, (e) => optimistic(e, state));
      return { prev };
    },
    onError: (e, _state, ctx) => {
      if (ctx?.prev) seedEventDetail(ctx.prev);
      void invalidateCampus();
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
    onSuccess: (card, state) => {
      patchEvent(id, () => card);
      track('event_rsvp', { state: state ?? 'none', category: card.category });
      if (state && card.host.accountType === 'org' && data && !data.viewer.isFollowingHost && !data.viewer.isHost) setFollowPrompt(true);
    },
  });

  const gone = q.isError && isApiError(q.error) && q.error.status === 404;

  if (q.isLoading) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Event" />}>
        <DetailSkeleton />
      </Screen>
    );
  }
  if (gone) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Event" />}>
        <EmptyState
          icon={CalendarOff}
          title="This event isn't available"
          description="It may have been removed, or it's from someone you can't see."
          action={{ label: 'Browse events', onClick: () => navigate(routes.events(), { replace: true }) }}
        />
      </Screen>
    );
  }
  if (q.isError || !data) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Event" />}>
        <ErrorState title="Couldn't load this event" error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const isHost = data.viewer.isHost;
  const ended = data.endsAt <= Date.now();
  const open = !data.cancelled && !ended && data.status === 'active';
  // Saving always re-submits both times and the server rejects `endsAt <= now`, so Edit is only offered while the event is live (R7).
  const canEdit = isHost && !data.cancelled && !ended;
  const going = data.myRsvp === 'going';
  const interested = data.myRsvp === 'interested';
  const friends = friendsSentence(data.friendsGoing, data.goingCount);
  const share = {
    card: { kind: 'event' as const, id: data.id },
    url: routes.event(data.id),
    title: data.title,
    text: `${data.title} · ${formatEventRange(data.startsAt, data.endsAt)} · ${data.locationName}`,
  };

  const footer = open ? (
    <div className="flex gap-2 px-4 py-2">
      <Button
        fullWidth
        variant={going ? 'secondary' : 'primary'}
        disabled={!going && data.isFull}
        loading={rsvp.isPending && rsvp.variables !== 'interested'}
        aria-pressed={going}
        onClick={() => rsvp.mutate(going ? null : 'going')}
      >
        {going ? (
          <motion.span key="tick" initial={reduced ? false : { scale: 0.4 }} animate={{ scale: 1 }} transition={spring.bouncy} className="flex items-center gap-1.5">
            <Check size={18} strokeWidth={2.25} aria-hidden /> Going
          </motion.span>
        ) : data.isFull ? (
          'Full'
        ) : (
          'Going'
        )}
      </Button>
      <Button
        fullWidth
        variant={interested ? 'secondary' : 'outline'}
        loading={rsvp.isPending && rsvp.variables === 'interested'}
        aria-pressed={interested}
        onClick={() => rsvp.mutate(interested ? null : 'interested')}
      >
        {interested ? (
          <span className="flex items-center gap-1.5">
            <Check size={18} strokeWidth={2.25} aria-hidden /> Interested
          </span>
        ) : (
          'Interested'
        )}
      </Button>
    </div>
  ) : undefined;

  return (
    <Screen
      header={
        <PageHeader
          mode="compact"
          back
          title="Event"
          actions={
            <>
              <IconButton icon={Share} aria-label="Share event" onClick={() => openShare(share)} />
              <IconButton icon={Ellipsis} aria-label="More options" onClick={() => setMenuOpen(true)} />
            </>
          }
        />
      }
      footer={footer}
    >
      <MediaBox src={data.coverUrl} alt="" aspect="16:9" rounded="none" />
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="soft" tone="accent">{EVENT_CATEGORY_LABELS[data.category]}</Badge>
          {data.freeFood ? (
            <Badge variant="soft" tone="success">
              <Utensils size={12} strokeWidth={2} aria-hidden /> Free food
            </Badge>
          ) : null}
          {data.host.accountType === 'org' ? <Badge variant="outline" tone="neutral">Org event</Badge> : null}
          {data.cancelled ? <Badge variant="soft" tone="danger">Cancelled</Badge> : ended ? <Badge variant="soft" tone="neutral">Ended</Badge> : null}
          {isHost ? <ContentStatusChip status={data.status} /> : null}
        </div>
        <h1 className="type-title-2 text-ink">{data.title}</h1>

        {data.cancelled ? (
          <Card variant="flat" className="flex items-center gap-3 border-danger/45 bg-danger-soft">
            <CalendarX size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-danger" />
            <p className="type-footnote text-ink">This event was cancelled by the host.</p>
          </Card>
        ) : ended ? (
          <Card variant="flat" className="flex items-center gap-3">
            <CalendarOff size={20} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-3" />
            <p className="type-footnote text-ink-2">This event has ended.</p>
          </Card>
        ) : null}

        <Card variant="flat" className="p-0">
          <ListRow
            leading={
              <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <CalendarDays size={20} strokeWidth={1.75} aria-hidden />
              </span>
            }
            title={formatEventRange(data.startsAt, data.endsAt)}
            subtitle={data.capacity !== null ? (data.isFull ? `Full · ${data.capacity} spots` : `${data.goingCount} of ${data.capacity} spots taken`) : undefined}
            trailing={
              <Button size="sm" variant="ghost" leftIcon={CalendarPlus} onClick={() => { if (downloadIcs(data)) toast.success('Added to your downloads'); }}>
                Add
              </Button>
            }
          />
          <ListRow
            leading={
              <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <MapPin size={20} strokeWidth={1.75} aria-hidden />
              </span>
            }
            title={data.locationName}
            subtitle={data.address ?? (data.addressPrivate ? (going ? null : 'Address shared with RSVPs') : null)}
          />
        </Card>

        <UserRow user={data.host} size="lg" reason={data.host.accountType === 'org' ? 'Hosting this event' : 'Host'} />

        {data.description ? <p className="whitespace-pre-wrap type-body text-ink">{data.description}</p> : null}

        {followPrompt && data.host.accountType === 'org' && !data.viewer.isFollowingHost ? (
          <Card variant="raised" className="flex items-center gap-3">
            <UserAvatar user={data.host} size="md" link={false} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-label text-ink">Follow {data.host.displayName}?</span>
              <span className="type-caption text-ink-3">Their next events land in your Orbit.</span>
            </div>
            <FollowButton userId={data.host.id} initialFollowing={false} size="sm" onChange={(r) => { if (r.isFollowing) setFollowPrompt(false); }} />
            <IconButton icon={X} aria-label="Dismiss" size="sm" onClick={() => setFollowPrompt(false)} />
          </Card>
        ) : null}

        <Card variant="flat" className="p-0">
          <ListRow
            leading={
              data.friendsGoing.length > 0 ? (
                <AvatarStack size="sm" users={data.friendsGoing.map((u) => ({ src: u.avatarUrl, name: u.displayName, shape: u.accountType === 'org' ? 'org' : 'circle' }))} />
              ) : (
                <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
                  <Users size={20} strokeWidth={1.75} aria-hidden />
                </span>
              )
            }
            title={data.goingCount === 0 ? 'No RSVPs yet. Be the first.' : `${formatCount(data.goingCount)} going`}
            subtitle={friends ?? (data.interestedCount > 0 ? `${formatCount(data.interestedCount)} interested` : undefined)}
            trailing={data.goingCount > 0 ? 'chevron' : undefined}
            onClick={data.goingCount > 0 ? () => setAttendees('going') : undefined}
          />
          {data.interestedCount > 0 && friends ? (
            <ListRow title={`${formatCount(data.interestedCount)} interested`} trailing="chevron" onClick={() => setAttendees('interested')} />
          ) : null}
        </Card>

        {isHost && !data.cancelled ? (
          <div className="flex gap-2">
            {canEdit ? (
              <Button fullWidth variant="secondary" leftIcon={SquarePen} to={routes.eventEdit(data.id)}>
                Edit event
              </Button>
            ) : null}
            <Button fullWidth variant="danger-ghost" leftIcon={CalendarX} onClick={() => setCancelOpen(true)}>
              Cancel event
            </Button>
          </div>
        ) : null}
        <p className="type-caption text-ink-4">Hosted by @{data.host.handle}{isHost ? ` · Posting as @${me.handle}` : ''}</p>
      </div>

      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={isHost && !data.cancelled ? [
          ...(canEdit ? [{ icon: SquarePen, label: 'Edit event', onSelect: () => navigate(routes.eventEdit(data.id)) }] : []),
          { icon: CalendarX, label: 'Cancel event', destructive: true, onSelect: () => setCancelOpen(true) },
        ] : [{ icon: CalendarPlus, label: 'Add to calendar', onSelect: () => { downloadIcs(data); } }]}
        share={share}
        report={{ entityType: 'event', entityId: data.id, author: data.host }}
        blockUser={isHost ? null : data.host}
      />
      <UserListSheet
        open={attendees !== null}
        onOpenChange={(o) => { if (!o) setAttendees(null); }}
        title={attendees === 'interested' ? 'Interested' : 'Going'}
        path={attendeesPath(data.id, attendees ?? 'going')}
        queryKey={[...campusKeys.attendees(data.id, attendees ?? 'going')]}
        emptyTitle="No RSVPs yet. Be the first."
      />
      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this event?"
        description="Everyone who RSVP'd gets a notification. This can't be undone."
        icon={CalendarX}
        tone="danger"
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        onConfirm={async () => {
          try {
            const res = await cancelEventRequest(data.id);
            seedEventDetail(res);
            void invalidateCampus();
            toast.success('Event cancelled');
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Screen>
  );
};
