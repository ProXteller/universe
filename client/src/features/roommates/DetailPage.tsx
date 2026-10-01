/**
 * Roommate detail — hero, identity (first name only), budget / dates / areas, compat ring 96 + "Why you match" bars +
 * sentence, about, lifestyle grid, place details + photos (has-a-place), safety card, Message (context card + opener)
 * and Save in the bottom bar. Report + Block via the overflow menu. Owners see their own post with an Edit CTA.
 */
import { useState, type FC, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bookmark, Ellipsis, MessageCircle, Pencil, Users } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { COMPAT_WEIGHTS, QUESTION_DEFS, ROOMMATE_MODE_LABEL, ROOMMATE_QUESTIONS, ROOMMATE_SAFETY, type RoommateDetail, type RoommateQuestion } from '@shared/roommates';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, IconButton, Lightbox, PageHeader, ProgressBar, Screen, Skeleton, SkeletonText } from '@/ui';
import { MediaBox, OverflowMenu, SafetyCard, UserAvatar } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { isApiError } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { absoluteUrl } from '@/lib/share';
import { useRoommate, useSaveToggle } from './api';
import { formatMoveIn, LIVING_WITH_LABEL } from './filters';
import { CompatRing, CoverBox, MatchBanner, ModeBadge, useMessageRoommate } from './parts';

const Q_LABEL: Record<RoommateQuestion, string> = {
  sleep: 'Sleep', clean: 'Tidiness', noise: 'Noise', guests: 'Guests', hosting: 'Parties', smoking: 'Smoking', pets: 'Pets', sharing: 'Sharing',
};

const TOP_DIMENSIONS = 4;

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-3">
    <h2 className="type-headline">{title}</h2>
    {children}
  </section>
);

const MatchSection: FC<{ d: RoommateDetail }> = ({ d }) => {
  const compat = d.compat;
  if (!compat) return <MatchBanner />;
  const bars = [...compat.dimensions].sort((a, b) => COMPAT_WEIGHTS[b.q] - COMPAT_WEIGHTS[a.q]).slice(0, TOP_DIMENSIONS);
  return (
    <Card variant="raised" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <CompatRing compat={compat} size={96} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="type-title-3">{compat.capped ? 'Capped by a dealbreaker' : compat.pct >= 85 ? 'Great match' : compat.pct >= 65 ? 'Good match' : 'Different rhythms'}</span>
          <p className="type-footnote text-ink-2">{compat.sentence}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="type-overline text-ink-3">Why you match</span>
        {bars.map((b) => (
          <div key={b.q} className="flex items-center gap-3">
            <span className="w-20 shrink-0 type-footnote text-ink-2">{Q_LABEL[b.q]}</span>
            <ProgressBar value={b.similarity} aria-label={`${Q_LABEL[b.q]} similarity`} className="flex-1" />
            <span className="w-10 shrink-0 text-right type-caption tabular-nums text-ink-3">{Math.round(b.similarity * 100)}%</span>
          </div>
        ))}
      </div>
      {compat.both.length || compat.differs.length ? (
        <div className="flex flex-col gap-2">
          {compat.both.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="type-caption text-ink-3">You both:</span>
              {compat.both.map((t) => (
                <Chip key={t} variant="tag" size="sm">
                  {t}
                </Chip>
              ))}
            </div>
          ) : null}
          {compat.differs.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="type-caption text-ink-3">Differs:</span>
              {compat.differs.map((t) => (
                <Badge key={t} variant="outline" tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

const DetailSkeleton: FC = () => (
  <div className="flex flex-col gap-4">
    <Skeleton w="100%" h="auto" className="aspect-[4/5] rounded-none" />
    <div className="flex flex-col gap-4 px-4">
      <div className="flex items-center gap-3">
        <Skeleton w={40} h={40} circle />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton w="40%" h={18} />
          <Skeleton w="60%" h={12} />
        </div>
      </div>
      <Skeleton w="100%" h={140} className="rounded-xl" />
      <SkeletonText lines={3} />
    </div>
  </div>
);

export const DetailPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const navigate = useNavigate();
  useScreenView('roommate_detail');
  const q = useRoommate(id);
  const save = useSaveToggle();
  const messaging = useMessageRoommate();
  const [menu, setMenu] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const d = q.data;
  const isSelf = d ? d.user.id === me.id : false;
  const href = id ? routes.roommate(id) : routes.roommates();

  const header = (
    <PageHeader
      mode="compact"
      back
      title={d ? d.firstName : 'Roommate'}
      actions={d && !isSelf ? <IconButton icon={Ellipsis} aria-label="More options" onClick={() => setMenu(true)} /> : undefined}
    />
  );

  let body;
  if (q.isLoading) {
    body = <DetailSkeleton />;
  } else if (q.isError || !d) {
    body =
      isApiError(q.error) && q.error.status === 404 ? (
        <EmptyState icon={Users} title="This roommate post is no longer available." action={{ label: 'Browse roommates', onClick: () => navigate(routes.roommates()) }} />
      ) : (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      );
  } else {
    const meta = [d.classLabel, d.major].filter(Boolean).join(' · ');
    const photos: MediaImage[] = d.photos;
    body = (
      <div className="flex flex-col gap-5 pb-4">
        <CoverBox
          coverUrl={d.coverUrl}
          user={d.user}
          alt={`${d.firstName}'s roommate post`}
          overlay={
            photos.length > 0 ? (
              <button type="button" className="absolute inset-0" aria-label="Open photos" onClick={() => setLightbox(0)} />
            ) : undefined
          }
        />

        <div className="flex flex-col gap-5 px-4">
          <div className="flex items-start gap-3">
            <UserAvatar user={d.user} size="md" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="type-overline text-accent-ink">{d.archetype}</span>
              <span className="truncate type-title-2">{d.firstName}</span>
              {meta ? <span className="truncate type-footnote text-ink-2">{meta}</span> : null}
            </div>
            <ModeBadge mode={d.mode} className="shrink-0" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display type-title-2 tabular-nums">
                {formatPrice(d.budget, me.currency)}
                <span className="type-footnote text-ink-3">/mo</span>
              </span>
              <span className="type-body text-ink-2">Move-in {formatMoveIn(d.moveIn)}</span>
              {d.leaseMonths ? <span className="type-body text-ink-2">· {d.leaseMonths}-month lease</span> : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.neighborhoods.map((n) => (
                <Chip key={n} variant="tag" size="sm">
                  {n}
                </Chip>
              ))}
              <Badge variant="outline" tone="neutral">
                {LIVING_WITH_LABEL[d.livingWith]}
              </Badge>
              {d.lowPriceFlag ? (
                <Badge variant="soft" tone="warning">
                  Price is unusually low
                </Badge>
              ) : null}
              {d.isNewAccount ? (
                <Badge variant="outline" tone="neutral">
                  New account
                </Badge>
              ) : null}
            </div>
          </div>

          {!isSelf ? <MatchSection d={d} /> : null}

          {d.about ? (
            <Section title="About">
              <p className="whitespace-pre-line type-body text-ink-2">{d.about}</p>
            </Section>
          ) : null}

          <Section title="How they live">
            <div className="grid grid-cols-2 gap-2">
              {ROOMMATE_QUESTIONS.map((qk) => (
                <div key={qk} className="flex flex-col rounded-lg border border-line bg-surface-1 px-3 py-2.5">
                  <span className="type-caption text-ink-3">{Q_LABEL[qk]}</span>
                  <span className="type-label">{QUESTION_DEFS[qk].options[d.answers[qk]]}</span>
                </div>
              ))}
            </div>
          </Section>

          {d.mode === 'have' && d.place ? (
            <Section title="The place">
              <Card variant="flat" className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <div className="flex flex-col">
                  <span className="type-caption text-ink-3">Rent</span>
                  <span className="type-label tabular-nums">{formatPrice(d.place.rent, me.currency)}/mo</span>
                </div>
                <div className="flex flex-col">
                  <span className="type-caption text-ink-3">Room</span>
                  <span className="type-label">{d.place.roomType === 'private' ? 'Private' : 'Shared'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="type-caption text-ink-3">Beds · baths</span>
                  <span className="type-label tabular-nums">
                    {d.place.beds} · {d.place.baths}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="type-caption text-ink-3">Included</span>
                  <span className="type-label">{[d.place.furnished ? 'Furnished' : null, d.place.utilitiesIncluded ? 'Utilities' : null].filter(Boolean).join(' · ') || 'Unfurnished'}</span>
                </div>
              </Card>
            </Section>
          ) : null}

          {photos.length > 1 ? (
            <Section title="Photos">
              <div className="scroll-x -mx-4 flex gap-2 px-4">
                {photos.map((p, i) => (
                  <MediaBox key={p.url} src={p.url} alt={p.alt ?? `Photo ${i + 1}`} aspect="1:1" rounded="md" className="w-28 shrink-0" onClick={() => setLightbox(i)} />
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <SafetyCard title={ROOMMATE_SAFETY.title} points={[...ROOMMATE_SAFETY.points]} storageKey="uv:roommates:safety-card" tone="info" />

        {photos.length > 0 ? (
          <Lightbox open={lightbox !== null} onOpenChange={(o) => !o && setLightbox(null)} images={photos} index={lightbox ?? 0} onIndexChange={setLightbox} />
        ) : null}

        {!isSelf ? (
          <OverflowMenu
            open={menu}
            onOpenChange={setMenu}
            share={{ card: { kind: 'roommate', id: d.id }, url: absoluteUrl(href), title: `${d.firstName} · ${ROOMMATE_MODE_LABEL[d.mode]}` }}
            report={{ entityType: 'roommate_listing', entityId: d.id, author: d.user, onReported: () => navigate(routes.roommates(), { replace: true }) }}
            blockUser={d.user}
          />
        ) : null}
      </div>
    );
  }

  const footer = d ? (
    <div className="flex items-center gap-2 px-4 py-3">
      {isSelf ? (
        <>
          <span className="flex-1 type-footnote text-ink-3">This is how others see your post.</span>
          <Button variant="secondary" leftIcon={Pencil} onClick={() => navigate(`${routes.roommatesMeEdit()}?intent=post`)}>
            Edit
          </Button>
        </>
      ) : (
        <>
          <Button fullWidth leftIcon={MessageCircle} onClick={() => messaging.start(d)}>
            Message {d.firstName}
          </Button>
          <IconButton
            icon={Bookmark}
            aria-label={d.saved ? 'Remove from saved' : 'Save'}
            aria-pressed={d.saved}
            variant="filled"
            size="lg"
            active={d.saved}
            activeTone="accent"
            onClick={() => save.mutate({ id: d.id, saved: !d.saved })}
          />
        </>
      )}
    </div>
  ) : undefined;

  return (
    <Screen header={header} footer={footer}>
      {body}
      {messaging.sheet}
    </Screen>
  );
};
