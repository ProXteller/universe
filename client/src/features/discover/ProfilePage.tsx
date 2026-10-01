/**
 * Public profile (design §7.3 / SPEC §5.5 `ProfileRoutes`): banner derived from the id, avatar, name, @handle,
 * chips (Founding member / New account / Unverified org), campus · major · year, bio, real counts, mutual line,
 * Follow + Message + overflow (Copy link, Share, Report `profile`, Block); tabs Reels · Posts · About (orgs: +
 * Events) rendering the other slices' components; own profile swaps actions for Edit + Share + gear.
 * A profile NEVER shows Buzz activity — nothing in the payload could.
 */
import { useMemo, useState, type FC, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, CalendarDays, Ellipsis, ImagePlus, Link2, MessageCircle, Settings, Share, UserRoundX } from 'lucide-react';
import type { PublicUser, UserSummary } from '@shared/core';
import { Badge, Button, CampusBadge, EmptyState, ErrorState, IconButton, PageHeader, Screen, Skeleton, SkeletonText, Tabs, VerifiedBadge } from '@/ui';
import { OverflowMenu, UserAvatar } from '@/components';
import { FollowButton } from '@/components';
import { errorMessage, isApiError } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { openDm } from '@/lib/dm';
import { classLabel, formatCount, formatDate } from '@/lib/format';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { absoluteUrl, copyLink, openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { useProfile, useUnblock } from './api';
import { bannerStyle } from './banner';
import { EmbeddedEventsList, EmbeddedPostsList, EmbeddedReelsGrid } from './crossSlice';

type ProfileTab = 'reels' | 'posts' | 'events' | 'about';

const BAND = 'min-h-[calc(120px+var(--safe-top))]';

function toSummary(u: PublicUser): UserSummary {
  return {
    id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl, accountType: u.accountType,
    isVerified: u.isVerified, universityId: u.universityId, universityShortName: u.universityShortName,
  };
}

/* ------------------------------------------------------------------ pieces */

function Band({ id }: { id: string }) {
  return <div aria-hidden style={bannerStyle(id)} className={cn('w-full', BAND)} />;
}

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const inner = (
    <>
      <span className="type-headline tabular-nums text-ink">{formatCount(value)}</span>
      <span className="type-caption text-ink-3">{label}</span>
    </>
  );
  const cls = 'flex min-h-11 flex-1 flex-col items-center justify-center rounded-md';
  return to ? (
    <Link to={to} className={cn(cls, 'press hover:bg-surface-1')}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function MutualLine({ user }: { user: PublicUser }) {
  const { mutualCount, mutualSample } = user.viewer;
  if (mutualCount === 0 || mutualSample.length === 0) return null;
  const names = mutualSample.slice(0, 2).map((m) => `@${m.handle}`);
  const rest = mutualCount - names.length;
  const text =
    rest > 0
      ? `Followed by ${names.join(' and ')} and ${rest} ${rest === 1 ? 'other' : 'others'} you follow`
      : `Followed by ${names.join(' and ')}`;
  return (
    <Link to={routes.followers(user.handle)} className="press flex items-center gap-2 rounded-sm type-footnote text-ink-3">
      <span className="flex -space-x-1.5">
        {mutualSample.slice(0, 3).map((m) => (
          <UserAvatar key={m.id} user={m} size="xs" link={false} className="ring-2 ring-canvas" />
        ))}
      </span>
      <span className="min-w-0 truncate">{text}</span>
    </Link>
  );
}

function Chips({ user }: { user: PublicUser }) {
  const chips: ReactNode[] = [];
  if (user.isFoundingMember) chips.push(<Badge key="founding" variant="soft" tone="gold">Founding member</Badge>);
  if (user.isNewAccount) chips.push(<Badge key="new" variant="soft" tone="info">New account</Badge>);
  if (user.accountType === 'org' && !user.isVerified) chips.push(<Badge key="unverified" variant="outline" tone="neutral">Unverified org</Badge>);
  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1.5">{chips}</div>;
}

function subtitleOf(user: PublicUser): string {
  if (user.accountType === 'org') return user.orgCategory ?? 'Student org';
  const parts = [user.major, classLabel(user.classYear, user.classKind)].filter((p): p is string => !!p);
  return parts.join(' · ');
}

/** Org starter card (T2, product §4 "Org onboarding") — own org profile only. */
function OrgStarterCard({ user }: { user: PublicUser }) {
  const url = absoluteUrl(routes.profile(user.handle));
  const rows: { icon: typeof ImagePlus; label: string; onClick(): void; to?: string }[] = [
    { icon: ImagePlus, label: 'Add a logo', to: routes.editProfile(), onClick: () => undefined },
    { icon: CalendarDays, label: 'Post your first event', to: routes.eventNew(), onClick: () => undefined },
    { icon: Link2, label: 'Share your follow link', onClick: () => void copyLink(url) },
  ];
  const navigate = useNavigate();
  return (
    <section aria-label="Get your org started" className="rounded-lg border border-accent-line bg-hero-soft p-4">
      <p className="type-overline text-accent-ink">Get started</p>
      <h2 className="mt-0.5 type-title-3 text-ink">Bring your members here</h2>
      <p className="type-footnote text-ink-3">Orgs grow when their events do. Three quick steps:</p>
      <ul className="mt-3 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label}>
            <button
              type="button"
              onClick={() => (r.to ? navigate(r.to) : r.onClick())}
              className="press flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left type-label-sm text-ink hover:bg-surface-2"
            >
              <r.icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-ink" />
              <span className="flex-1 truncate">{r.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AboutTab({ user }: { user: PublicUser }) {
  const rows: { label: string; value: string }[] = [];
  rows.push({ label: 'Campus', value: user.university.name });
  if (user.accountType === 'org') rows.push({ label: 'Category', value: user.orgCategory ?? 'Student org' });
  if (user.major) rows.push({ label: 'Major', value: user.major });
  const year = classLabel(user.classYear, user.classKind);
  if (year) rows.push({ label: 'Year', value: year });
  if (user.pronouns) rows.push({ label: 'Pronouns', value: user.pronouns });
  rows.push({ label: 'Joined', value: formatDate(user.createdAt) });
  return (
    <div role="tabpanel" className="flex flex-col gap-5 px-4 py-4">
      {user.bio ? <p className="whitespace-pre-wrap type-body text-ink">{user.bio}</p> : null}
      <dl className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line bg-surface-1">
        {rows.map((r) => (
          <div key={r.label} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2">
            <dt className="shrink-0 type-footnote text-ink-3">{r.label}</dt>
            <dd className="min-w-0 truncate text-right type-label-sm text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {user.interests.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="type-overline text-ink-3">Interests</p>
          <div className="flex flex-wrap gap-1.5">
            {user.interests.map((i) => (
              <Badge key={i} variant="soft" tone="neutral">
                {i}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-hidden aria-busy className="flex flex-col">
      <Skeleton className={cn('w-full rounded-none', BAND)} />
      <div className="-mt-10 flex flex-col gap-3 px-4">
        <Skeleton w={80} h={80} circle className="ring-4 ring-canvas" />
        <div className="flex flex-col gap-2">
          <Skeleton w="55%" h={22} />
          <Skeleton w="30%" h={14} />
          <Skeleton w="45%" h={14} />
        </div>
        <SkeletonText lines={2} />
        <div className="flex gap-2">
          <Skeleton w="33%" h={44} className="rounded-md" />
          <Skeleton w="33%" h={44} className="rounded-md" />
          <Skeleton w="33%" h={44} className="rounded-md" />
        </div>
        <div className="flex gap-2">
          <Skeleton w="50%" h={44} className="rounded-full" />
          <Skeleton w="50%" h={44} className="rounded-full" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export const ProfilePage: FC<{ handle: string }> = ({ handle }) => {
  const me = useMe();
  const navigate = useNavigate();
  const { user, isLoading, isError, error, refetch } = useProfile(handle);
  const unblock = useUnblock();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('reels');
  useScreenView('profile', { self: user ? user.viewer.isSelf : null });

  const isSelf = !!user && (user.viewer.isSelf || user.id === me.id);
  const isOrg = user?.accountType === 'org';
  const tabs = useMemo(() => {
    const list: { value: ProfileTab; label: string; count?: number }[] = [
      { value: 'reels', label: 'Reels', count: user && user.reelCount > 0 ? user.reelCount : undefined },
      { value: 'posts', label: 'Posts', count: user && user.postCount > 0 ? user.postCount : undefined },
    ];
    if (isOrg) list.push({ value: 'events', label: 'Events' });
    list.push({ value: 'about', label: 'About' });
    return list;
  }, [user, isOrg]);

  const share = user
    ? { card: { kind: 'profile' as const, id: user.id }, url: routes.profile(user.handle), title: `${user.displayName} on UniVerse`, text: `@${user.handle}` }
    : null;

  const header = (
    <PageHeader
      title={user?.displayName ?? 'Profile'}
      subtitle={user ? `@${user.handle}` : undefined}
      back
      transparent
      actions={
        user && !user.viewer.isBlockedByMe ? (
          isSelf ? (
            <IconButton icon={Settings} aria-label="Settings" variant="glass" to={routes.settings()} />
          ) : (
            <IconButton icon={Ellipsis} aria-label="More" variant="glass" onClick={() => setMenuOpen(true)} />
          )
        ) : null
      }
    />
  );

  if (isLoading) {
    return (
      <Screen header={<PageHeader title="Profile" back transparent />}>
        <ProfileSkeleton />
      </Screen>
    );
  }

  if (isError || !user) {
    const gone = isApiError(error) && error.status === 404;
    return (
      <Screen header={<PageHeader title="Profile" back />}>
        <div className="flex flex-1 items-center justify-center px-4">
          {gone ? (
            <EmptyState icon={UserRoundX} title="This profile isn't available." action={{ label: 'Back', onClick: () => navigate(-1) }} />
          ) : (
            <ErrorState title="Couldn't load this profile" error={error} onRetry={() => void refetch()} />
          )}
        </div>
      </Screen>
    );
  }

  const summary = toSummary(user);

  if (user.viewer.isBlockedByMe) {
    return (
      <Screen header={header}>
        <Band id={user.id} />
        <div className="-mt-10 flex flex-col gap-3 px-4 pb-6">
          <UserAvatar user={user} size="xl" link={false} className="ring-4 ring-canvas" />
          <div>
            <h1 className="flex items-center gap-1.5 type-title-2 text-ink">{user.displayName}</h1>
            <p className="type-footnote text-ink-3">@{user.handle}</p>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-1 p-4">
            <Ban size={20} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="type-label text-ink">You blocked this account</p>
              <p className="type-footnote text-ink-3">They can't message you or see your posts. Unblocking won't restore follows.</p>
            </div>
          </div>
          <Button
            variant="secondary"
            loading={unblock.isPending}
            onClick={() =>
              unblock.mutate(user, {
                onSuccess: () => toast.success(`Unblocked @${user.handle}`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Unblock
          </Button>
        </div>
      </Screen>
    );
  }

  const subtitle = subtitleOf(user);

  return (
    <Screen header={header}>
      <Band id={user.id} />
      <div className="-mt-10 flex flex-col gap-3 px-4">
        <div className="flex items-end justify-between gap-3">
          <UserAvatar user={user} size="xl" link={false} className="ring-4 ring-canvas" />
          {isSelf ? (
            <div className="flex items-center gap-2 pb-1">
              <IconButton icon={Share} aria-label="Share profile" variant="filled" onClick={() => share && openShare(share)} />
              <Button variant="secondary" size="md" to={routes.editProfile()}>
                Edit profile
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="flex min-w-0 items-center gap-1.5 type-title-2 text-ink">
            <span className="truncate">{user.displayName}</span>
            {user.isVerified ? <VerifiedBadge size={18} /> : null}
          </h1>
          <p className="type-footnote text-ink-3">@{user.handle}</p>
          <Chips user={user} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-footnote text-ink-2">
            <CampusBadge name={user.university.shortName} />
            {subtitle ? <span className="min-w-0 truncate">{subtitle}</span> : null}
          </div>
        </div>
        {user.bio ? <p className="whitespace-pre-wrap type-body text-ink">{user.bio}</p> : null}

        <div className="flex rounded-lg border border-line bg-surface-1 p-1" aria-label="Profile stats">
          <Stat label="Posts" value={user.postCount} />
          <Stat label="Followers" value={user.followerCount} to={routes.followers(user.handle)} />
          <Stat label="Following" value={user.followingCount} to={routes.following(user.handle)} />
        </div>

        {!isSelf ? <MutualLine user={user} /> : null}

        {!isSelf ? (
          <div className="flex items-center gap-2">
            <FollowButton
              userId={user.id}
              initialFollowing={user.viewer.isFollowing}
              followsMe={user.viewer.isFollowedBy}
              size="md"
              className="min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              size="md"
              leftIcon={MessageCircle}
              className="min-w-0 flex-1"
              onClick={() => void openDm({ userId: user.id })}
            >
              Message
            </Button>
          </div>
        ) : null}

        {isSelf && isOrg ? <OrgStarterCard user={user} /> : null}
      </div>

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={tabs} sticky aria-label="Profile sections" />
        {tab === 'reels' ? <EmbeddedReelsGrid userId={user.id} handle={user.handle} isSelf={isSelf} /> : null}
        {tab === 'posts' ? <EmbeddedPostsList userId={user.id} handle={user.handle} isSelf={isSelf} /> : null}
        {tab === 'events' ? <EmbeddedEventsList userId={user.id} handle={user.handle} isSelf={isSelf} /> : null}
        {tab === 'about' ? <AboutTab user={user} /> : null}
      </div>

      {!isSelf && share ? (
        <OverflowMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={`@${user.handle}`}
          share={share}
          report={{ entityType: 'profile', entityId: user.id, author: summary }}
          blockUser={summary}
        />
      ) : null}
    </Screen>
  );
};
