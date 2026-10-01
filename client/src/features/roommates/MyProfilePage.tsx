/**
 * My profile — first run shows two explicit, equal choices ("Post that I'm looking" / "Just browse & match"); afterwards
 * the state is plain: "Not posted — only you can see this. [Post it]" vs "Posted · visible at {university} [Pause] [Unpublish]",
 * paused copy, the "Still looking?" confirmation after 30 days, held / hidden / removed chips, edit + delete.
 */
import { useState, type FC, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Eye, Home, Pause, Play, Sparkles, Trash2, type LucideIcon } from 'lucide-react';
import { ROOMMATE_MODE_LABEL, type MyRoommateProfile } from '@shared/roommates';
import { Badge, Button, Card, Chip, Dialog, ErrorState, ListRow, PageHeader, Screen, Skeleton } from '@/ui';
import { MediaBox, UserAvatar } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useDeleteProfile, useMyProfile, useProfileAction } from './api';
import { formatMoveIn } from './filters';
import { ModeBadge } from './parts';
import { RoommatesTabs } from './tabs';

const editHref = (intent: 'post' | 'match', step?: string): string => `${routes.roommatesMeEdit()}?intent=${intent}${step ? `&step=${step}` : ''}`;

/* ------------------------------------------------------------------ first run */

const ChoiceCard: FC<{ icon: LucideIcon; title: string; description: string; onClick(): void }> = ({ icon: Icon, title, description, onClick }) => (
  <Card variant="raised" interactive onClick={onClick} aria-label={title} className="flex items-center gap-3">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </span>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="type-title-3">{title}</span>
      <span className="type-footnote text-ink-2">{description}</span>
    </div>
    <ChevronRight size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-4" />
  </Card>
);

const FirstRun: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const canPost = me.isAdult === true;
  return (
    <div className="flex flex-col gap-5 px-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <h2 className="type-title-2">Find someone you can actually live with.</h2>
        <p className="type-body text-ink-2">Tell us how you live — about 2 minutes — and we'll rank everyone at {me.university.name} by compatibility.</p>
      </div>
      <div className="flex flex-col gap-3">
        {canPost ? (
          <ChoiceCard
            icon={Home}
            title="Post that I'm looking"
            description={`Publish a post at ${me.university.shortName}. It links to your public profile @${me.handle}.`}
            onClick={() => navigate(editHref('post'))}
          />
        ) : null}
        <ChoiceCard
          icon={Sparkles}
          title="Just browse & match"
          description="Answer 8 questions and see your match % with everyone. Nothing is posted — only you can see your answers."
          onClick={() => navigate(editHref('match'))}
        />
      </div>
      {!canPost ? <p className="type-footnote text-ink-3">You need to be 18 or older to publish a roommate post. You can still browse and match.</p> : null}
    </div>
  );
};

/* ------------------------------------------------------------------ existing profile */

const StatusCard: FC<{ title: ReactNode; description?: ReactNode; actions: ReactNode; tone?: 'hero' | 'raised' }> = ({ title, description, actions, tone = 'hero' }) => (
  <Card variant={tone} className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <span className="type-title-3">{title}</span>
      {description ? <span className="type-footnote text-ink-2">{description}</span> : null}
    </div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </Card>
);

const ProfileSummary: FC<{ profile: MyRoommateProfile }> = ({ profile: p }) => {
  const me = useMe();
  const navigate = useNavigate();
  const action = useProfileAction();
  const del = useDeleteProfile();
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canPost = me.isAdult === true;
  const busy = action.isPending;

  const run = (a: 'pause' | 'resume' | 'confirm' | 'unpublish', done: string): void => {
    action.mutate(a, {
      onSuccess: () => toast.success(done),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const visible = p.published && !p.paused && p.status === 'active';
  const dealbreakers = [p.dealbreakSmoking ? 'No smokers' : null, p.dealbreakPets ? 'No pets' : null].filter(Boolean).join(' · ') || 'None';

  let status: ReactNode;
  if (!p.published) {
    status = (
      <StatusCard
        title="Not posted — only you can see this."
        description="Your answers rank Browse by match %. Post when you're ready to be found."
        actions={
          <>
            {canPost ? (
              <Button size="sm" onClick={() => navigate(editHref('post'))}>
                Post it
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => navigate(editHref('match'))}>
              Edit answers
            </Button>
          </>
        }
      />
    );
  } else if (p.paused) {
    status = (
      <StatusCard
        title="Your post is paused."
        description="Nobody can see it until you resume."
        tone="raised"
        actions={
          <>
            <Button size="sm" leftIcon={Play} loading={busy} onClick={() => run('resume', 'Your post is visible again')}>
              Resume
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmUnpublish(true)}>
              Unpublish
            </Button>
          </>
        }
      />
    );
  } else {
    status = (
      <StatusCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>Posted · visible at {me.university.name}</span>
            <ContentStatusChip status={p.status} />
          </span>
        }
        description={
          p.status === 'active'
            ? 'People at your campus can find you in Browse and message you with your post pinned.'
            : p.status === 'held'
              ? 'Your post is with our safety team before it goes live. This usually takes under a day.'
              : 'Your post is not visible right now. Check your account status for details.'
        }
        actions={
          <>
            <Button size="sm" variant="secondary" leftIcon={Pause} loading={busy} onClick={() => run('pause', 'Post paused')}>
              Pause
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmUnpublish(true)}>
              Unpublish
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      {status}

      {p.published && p.needsConfirmation && !p.paused ? (
        <StatusCard
          title="Still looking for a roommate?"
          description="Confirm to keep your post visible. Posts pause on their own after 60 days without a confirmation."
          tone="raised"
          actions={
            <>
              <Button size="sm" loading={busy} onClick={() => run('confirm', 'Thanks — your post stays visible')}>
                Yes, still looking
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('pause', 'Post paused')}>
                Pause it
              </Button>
            </>
          }
        />
      ) : null}

      {p.published ? (
        <Card variant="raised" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {p.coverUrl ? <MediaBox src={p.coverUrl} alt="Your cover photo" aspect="1:1" rounded="md" className="w-14 shrink-0" /> : <UserAvatar user={p.user} size="lg" link={false} />}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="type-overline text-accent-ink">{p.archetype}</span>
              <span className="truncate type-title-3">{p.firstName}</span>
              <span className="truncate type-footnote text-ink-2">
                {p.budget !== null ? `${formatPrice(p.budget, me.currency)}/mo` : '—'}
                {p.moveIn ? ` · Move-in ${formatMoveIn(p.moveIn)}` : ''}
              </span>
            </div>
            {p.mode ? <ModeBadge mode={p.mode} className="shrink-0" /> : null}
          </div>
          {p.lowPriceFlag ? (
            <Badge variant="soft" tone="warning" className="self-start">
              Price is unusually low — under review
            </Badge>
          ) : null}
          {visible ? (
            <Button variant="ghost" size="sm" leftIcon={Eye} onClick={() => navigate(routes.roommate(p.id))} className="self-start">
              View as others see it
            </Button>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
        <ListRow
          title="How you live"
          subtitle={
            <span className="flex flex-wrap gap-1.5 pt-1">
              <span className="type-footnote text-ink-2">{p.archetype}</span>
              {p.tags.map((t) => (
                <Chip key={t} variant="tag" size="sm">
                  {t}
                </Chip>
              ))}
            </span>
          }
          trailing="chevron"
          onClick={() => navigate(editHref(p.published ? 'post' : 'match', 'questions'))}
        />
        <ListRow title="Dealbreakers" subtitle={dealbreakers} trailing="chevron" onClick={() => navigate(editHref(p.published ? 'post' : 'match', 'dealbreakers'))} />
        {p.published ? (
          <>
            <ListRow
              title="Basics"
              subtitle={[p.mode ? ROOMMATE_MODE_LABEL[p.mode] : null, p.budget !== null ? `${formatPrice(p.budget, me.currency)}/mo` : null, p.moveIn ? formatMoveIn(p.moveIn) : null, p.neighborhoods.join(', ') || null]
                .filter(Boolean)
                .join(' · ')}
              trailing="chevron"
              onClick={() => navigate(editHref('post', 'basics'))}
            />
            {p.mode === 'have' ? <ListRow title="Your place" subtitle={p.place ? `${formatPrice(p.place.rent, me.currency)}/mo · ${p.place.roomType === 'private' ? 'Private room' : 'Shared room'} · ${p.photos.length} photos` : 'Add details'} trailing="chevron" onClick={() => navigate(editHref('post', 'place'))} /> : null}
            <ListRow title="About you" subtitle={p.about ? p.about : 'Nothing yet'} trailing="chevron" onClick={() => navigate(editHref('post', 'about'))} />
          </>
        ) : null}
      </div>

      <Button variant="danger-ghost" leftIcon={Trash2} onClick={() => setConfirmDelete(true)} className="self-start">
        Delete roommate profile
      </Button>

      <Dialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Unpublish your post?"
        description="Your post disappears from Browse. Your answers and filters are kept, so you can post again anytime."
        confirmLabel="Unpublish"
        cancelLabel="Keep it up"
        onConfirm={async () => {
          await new Promise<void>((resolve) =>
            action.mutate('unpublish', {
              onSuccess: () => toast.success('Post unpublished'),
              onError: (e) => toast.error(errorMessage(e)),
              onSettled: () => resolve(),
            }),
          );
        }}
      />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your roommate profile?"
        description="Your answers, post and saved matches are removed. This can't be undone."
        tone="danger"
        icon={Trash2}
        confirmLabel="Delete"
        onConfirm={async () => {
          await new Promise<void>((resolve) =>
            del.mutate(undefined, {
              onSuccess: () => toast.success('Roommate profile deleted'),
              onError: (e) => toast.error(errorMessage(e)),
              onSettled: () => resolve(),
            }),
          );
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ page */

export const MyProfilePage: FC = () => {
  const me = useMe();
  useScreenView('roommates_me');
  const q = useMyProfile();

  const header = (
    <PageHeader
      title="Roommates"
      subtitle={me.university.shortName}
      mode="large"
      below={
        <div className="bg-canvas pb-2">
          <RoommatesTabs value="me" />
        </div>
      }
    />
  );

  let body;
  if (q.isLoading) {
    body = (
      <div className="flex flex-col gap-4 px-4 pt-2">
        <Skeleton w="100%" h={112} className="rounded-xl" />
        <Skeleton w="100%" h={220} className="rounded-xl" />
      </div>
    );
  } else if (q.isError) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  } else if (!q.data?.profile) {
    body = <FirstRun />;
  } else {
    body = <ProfileSummary profile={q.data.profile} />;
  }

  return (
    <Screen nav header={header}>
      {body}
    </Screen>
  );
};
