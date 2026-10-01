/**
 * `/campus/events/new` and `/campus/events/:id/edit` (product §2.9): title, category, start / end, location (+ private
 * address option), description, cover (8 presets or one upload), free-food toggle, optional capacity.
 * `ComposerModeBanner mode="public" verb="Hosting"` on both create and edit (Constitution §5.4).
 */
import { useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CalendarOff } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { EventCategory, EventCoverPreset, EventDetail, UpsertEventRequest } from '@shared/campus';
import {
  EVENT_ADDRESS_MAX, EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, EVENT_COVER_LABELS, EVENT_COVER_PRESETS, EVENT_COVER_URL_PREFIX,
  EVENT_LARGE_CAPACITY, EVENT_LOCATION_MAX, EVENT_MAX_CAPACITY,
} from '@shared/campus';
import { Button, Card, ChipGroup, EmptyState, ErrorState, Input, ListRow, PageHeader, Screen, Skeleton, Switch, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaBox, MediaPicker, NotFound } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { createEventRequest, invalidateCampus, seedEventDetail, updateEventRequest, useEvent } from './api';
import { fromDateTimeLocal, nextHalfHour, toDateTimeLocal } from './format';

const HOUR = 3_600_000;
const presetUrl = (p: EventCoverPreset): string => `${EVENT_COVER_URL_PREFIX}${p}.svg`;
const CATEGORY_OPTIONS = EVENT_CATEGORIES.map((c) => ({ value: c, label: EVENT_CATEGORY_LABELS[c] }));

export const EventFormPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  if (id) return <EditLoader id={id} />;
  return <EventForm key="new" />;
};

const EditLoader: FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();
  const q = useEvent(id);
  if (q.isLoading) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Edit event" />}>
        <div className="flex flex-col gap-4 px-4 py-4" aria-busy="true" aria-label="Loading event">
          <Skeleton w="100%" h={56} className="rounded-lg" />
          <Skeleton w="100%" h={44} className="rounded-md" />
          <Skeleton w="100%" h={44} className="rounded-md" />
          <Skeleton w="100%" h={120} className="rounded-md" />
        </div>
      </Screen>
    );
  }
  if (q.isError && isApiError(q.error) && q.error.status === 404) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Edit event" />}>
        <EmptyState icon={CalendarOff} title="This event isn't available" />
      </Screen>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Edit event" />}>
        <ErrorState title="Couldn't load this event" error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  if (!q.data.viewer.isHost) return <NotFound />;
  if (q.data.cancelled || q.data.endsAt <= Date.now()) {
    return (
      <Screen header={<PageHeader mode="compact" back title="Edit event" />}>
        <EmptyState
          icon={CalendarOff}
          title={q.data.cancelled ? 'This event was cancelled' : 'This event has ended'}
          description="Cancelled and past events can't be edited."
          action={{ label: 'View event', onClick: () => navigate(routes.event(id), { replace: true }) }}
        />
      </Screen>
    );
  }
  return <EventForm key={id} initial={q.data} />;
};

interface Errors {
  title?: string;
  time?: string;
  locationName?: string;
  cover?: string;
  capacity?: string;
}

const EventForm: FC<{ initial?: EventDetail }> = ({ initial }) => {
  const me = useMe();
  const navigate = useNavigate();
  useScreenView(initial ? 'event_edit' : 'event_new');

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<EventCategory>(initial?.category ?? 'social');
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(initial?.startsAt ?? nextHalfHour(Date.now(), 60)));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(initial?.endsAt ?? nextHalfHour(Date.now(), 60) + 2 * HOUR));
  const [locationName, setLocationName] = useState(initial?.locationName ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [addressPrivate, setAddressPrivate] = useState(initial?.addressPrivate ?? false);
  const initialPreset = EVENT_COVER_PRESETS.find((p) => presetUrl(p) === initial?.coverUrl) ?? null;
  const [preset, setPreset] = useState<EventCoverPreset | null>(initial ? initialPreset : 'social');
  const [upload, setUpload] = useState<MediaImage[]>(initial && !initialPreset ? [{ url: initial.coverUrl, width: null, height: null }] : []);
  const [uploading, setUploading] = useState(false);
  const [freeFood, setFreeFood] = useState(initial?.freeFood ?? false);
  const [limited, setLimited] = useState(initial?.capacity !== null && initial?.capacity !== undefined);
  const [capacity, setCapacity] = useState(initial?.capacity ? String(initial.capacity) : '');
  const [errors, setErrors] = useState<Errors>({});

  const coverUrl = upload[0]?.url ?? (preset ? presetUrl(preset) : null);

  const save = useMutation({
    mutationFn: (body: UpsertEventRequest) => (initial ? updateEventRequest(initial.id, body) : createEventRequest(body)),
    onSuccess: (res) => {
      const { moderation, ...event } = res;
      seedEventDetail(event);
      void invalidateCampus();
      navigate(routes.event(event.id), { replace: true });
      showModerationNotice(moderation);
      if (!initial) toast.success('Your event is up');
    },
    onError: (e) => {
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
  });

  const onStartChange = (v: string) => {
    setStartsAt(v);
    const s = fromDateTimeLocal(v);
    const e = fromDateTimeLocal(endsAt);
    if (s !== null && (e === null || e <= s)) setEndsAt(toDateTimeLocal(s + 2 * HOUR));
  };

  const submit = () => {
    const next: Errors = {};
    const s = fromDateTimeLocal(startsAt);
    const e = fromDateTimeLocal(endsAt);
    if (title.trim().length < 3) next.title = 'Give it a title (at least 3 characters).';
    if (s === null || e === null) next.time = 'Pick a start and an end time.';
    else if (e <= s) next.time = 'The event has to end after it starts.';
    else if (e <= Date.now()) next.time = 'Pick a time in the future.';
    if (locationName.trim().length < 2) next.locationName = 'Where is it?';
    if (!coverUrl) next.cover = 'Pick a cover.';
    const cap = limited ? Number.parseInt(capacity, 10) : null;
    if (limited && (!Number.isFinite(cap) || (cap as number) < 1 || (cap as number) > EVENT_MAX_CAPACITY)) next.capacity = `Between 1 and ${EVENT_MAX_CAPACITY}.`;
    setErrors(next);
    if (Object.keys(next).length > 0 || s === null || e === null || !coverUrl) return;
    save.mutate({
      title: title.trim(),
      description: description.trim(),
      category,
      startsAt: s,
      endsAt: e,
      locationName: locationName.trim(),
      address: address.trim() || null,
      addressPrivate,
      coverUrl,
      freeFood,
      capacity: limited ? cap : null,
    });
  };

  return (
    <Screen
      header={<PageHeader mode="compact" back title={initial ? 'Edit event' : 'Host an event'} />}
      footer={
        <div className="px-4 py-2">
          <Button fullWidth size="lg" loading={save.isPending} disabled={uploading} onClick={submit}>
            {initial ? 'Save changes' : 'Publish event'}
          </Button>
        </div>
      }
    >
      <ComposerGuard>
        <form
          className="flex flex-col gap-5 px-4 py-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <ComposerModeBanner mode="public" verb="Hosting" note={me.accountType === 'org' ? 'Org events carry the org badge and reach your followers.' : 'Your event links to your public profile.'} />

          <Input label="Title" value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={LIMITS.eventTitle} error={errors.title} placeholder="BIO 311C exam 2 study session" autoComplete="off" />

          <div className="flex flex-col gap-2">
            <span className="type-label-sm text-ink-2">Category</span>
            <ChipGroup<EventCategory> aria-label="Category" options={CATEGORY_OPTIONS} value={category} onChange={(v: EventCategory) => setCategory(v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Starts" type="datetime-local" value={startsAt} onChange={(ev) => onStartChange(ev.target.value)} />
            <Input label="Ends" type="datetime-local" value={endsAt} min={startsAt} onChange={(ev) => setEndsAt(ev.target.value)} error={errors.time} />
          </div>

          <Input label="Location" value={locationName} onChange={(ev) => setLocationName(ev.target.value)} maxLength={EVENT_LOCATION_MAX} error={errors.locationName} placeholder="PCL group room 2.402" autoComplete="off" />
          <Input label="Street address (optional)" value={address} onChange={(ev) => setAddress(ev.target.value)} maxLength={EVENT_ADDRESS_MAX} placeholder="2100 Speedway" helper={addressPrivate ? 'Only people who RSVP as going can see this.' : 'Public venues can list a street address.'} autoComplete="off" />
          <Card variant="flat" className="p-0">
            <ListRow
              title={<span id="event-address-private">Share address only with RSVPs</span>}
              subtitle="Hosting at a private residence? Keep the street address for people who are going."
              trailing={<Switch checked={addressPrivate} onChange={setAddressPrivate} aria-labelledby="event-address-private" />}
            />
            <ListRow
              title={<span id="event-free-food">Free food</span>}
              subtitle="Shows up in the Free food filter."
              trailing={<Switch checked={freeFood} onChange={setFreeFood} aria-labelledby="event-free-food" />}
            />
            <ListRow
              title={<span id="event-capacity">Limit spots</span>}
              subtitle={limited ? `Going closes at the limit${!initial && me.isNewAccount ? ` · new accounts can host up to ${EVENT_LARGE_CAPACITY}` : ''}.` : 'No limit on RSVPs.'}
              trailing={<Switch checked={limited} onChange={setLimited} aria-labelledby="event-capacity" />}
            />
          </Card>
          {limited ? (
            <Input label="Capacity" type="number" inputMode="numeric" min={1} max={EVENT_MAX_CAPACITY} value={capacity} onChange={(ev) => setCapacity(ev.target.value)} error={errors.capacity} placeholder="40" />
          ) : null}

          <Textarea label="Description" value={description} onChange={(ev) => setDescription(ev.target.value)} maxLength={LIMITS.eventDescription} minRows={4} placeholder="What's happening, who it's for, what to bring." />

          <div className="flex flex-col gap-2">
            <span className="type-label-sm text-ink-2">Cover</span>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Cover art">
              {EVENT_COVER_PRESETS.map((p) => {
                const selected = upload.length === 0 && preset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={EVENT_COVER_LABELS[p]}
                    onClick={() => {
                      setPreset(p);
                      setUpload([]);
                    }}
                    className={cn('press flex flex-col gap-1 rounded-md p-0.5 text-left', selected && 'ring-2 ring-accent')}
                  >
                    <MediaBox src={presetUrl(p)} alt="" aspect="16:9" rounded="sm" />
                    <span className={cn('px-1 type-micro', selected ? 'text-accent-ink' : 'text-ink-3')}>{EVENT_COVER_LABELS[p]}</span>
                  </button>
                );
              })}
            </div>
            <MediaPicker value={upload} onChange={(v) => { setUpload(v); if (v.length > 0) setPreset(null); }} max={1} variant="tray" hint="Or upload your own (16:9 works best)" onUploadingChange={setUploading} />
            {errors.cover ? <span className="type-caption text-danger">{errors.cover}</span> : null}
          </div>
        </form>
      </ComposerGuard>
    </Screen>
  );
};
