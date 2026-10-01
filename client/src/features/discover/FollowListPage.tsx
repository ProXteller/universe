/**
 * Followers / Following (design §7.3, product §2.5): compact header with Tabs, a search field, `UserRow`s with
 * inline follow buttons ("Follow back" when applicable). Foundation endpoint #24.
 */
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserRoundX, Users } from 'lucide-react';
import { EmptyState, ErrorState, InfiniteSentinel, Input, PageHeader, Screen, Tabs } from '@/ui';
import { UserRow } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { isApiError } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useFollowList, useProfile } from './api';
import { UserRowSkeleton } from './suggestions';

export type FollowDir = 'followers' | 'following';

const TABS = [
  { value: 'followers', label: 'Followers' },
  { value: 'following', label: 'Following' },
] as const;

export const FollowListPage: FC<{ handle: string; dir: FollowDir }> = ({ handle, dir }) => {
  const me = useMe();
  const navigate = useNavigate();
  const profile = useProfile(handle);
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const user = profile.user;
  const list = useFollowList(user && !user.viewer.isBlockedByMe ? user.id : null, dir, term);
  useScreenView(`profile_${dir}`);

  const isSelf = !!user && (user.viewer.isSelf || user.id === me.id);
  const onTab = (v: FollowDir) => navigate(v === 'followers' ? routes.followers(handle) : routes.following(handle), { replace: true });

  const emptyState = (() => {
    if (term) return <EmptyState icon={Search} title={`No one matches "${term}".`} compact className="pt-6" />;
    if (dir === 'followers') {
      return isSelf ? (
        <EmptyState icon={Users} title="No followers yet." description="Post a reel or an Orbit post to get discovered." compact className="pt-6" />
      ) : (
        <EmptyState icon={Users} title="No followers yet." compact className="pt-6" />
      );
    }
    return isSelf ? (
      <EmptyState
        icon={Users}
        title="You're not following anyone yet."
        action={{ label: 'Find people', onClick: () => navigate(routes.discover()) }}
        compact
        className="pt-6"
      />
    ) : (
      <EmptyState icon={Users} title="Not following anyone yet." compact className="pt-6" />
    );
  })();

  const gone = profile.isError && isApiError(profile.error) && profile.error.status === 404;
  const blocked = !!user && user.viewer.isBlockedByMe;

  return (
    <Screen
      header={
        <PageHeader
          title={user ? user.displayName : 'Profile'}
          subtitle={user ? `@${user.handle}` : undefined}
          back
          below={
            <div className="flex flex-col gap-2">
              <Tabs value={dir} onChange={onTab} tabs={TABS} aria-label="Followers or following" />
              <Input
                variant="search"
                leftIcon={Search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onClear={() => setQ('')}
                placeholder={dir === 'followers' ? 'Search followers' : 'Search following'}
                aria-label={dir === 'followers' ? 'Search followers' : 'Search following'}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          }
        />
      }
    >
      {gone || blocked ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState icon={UserRoundX} title="This profile isn't available." action={{ label: 'Back', onClick: () => navigate(-1) }} />
        </div>
      ) : profile.isError ? (
        <ErrorState title="Couldn't load this profile" error={profile.error} onRetry={() => void profile.refetch()} />
      ) : profile.isLoading || list.isLoading ? (
        <div aria-hidden aria-busy className="flex flex-col pt-1">
          {Array.from({ length: 8 }, (_, i) => (
            <UserRowSkeleton key={i} />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState title={`Couldn't load ${dir}`} error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        emptyState
      ) : (
        <div className="flex flex-col pb-4 pt-1" role="list">
          {list.items.map((u) => (
            <div key={u.id} role="listitem">
              <UserRow user={u} reason={u.viewer.isFollowedBy && !u.viewer.isFollowing && !u.viewer.isSelf ? 'Follows you' : undefined} />
            </div>
          ))}
          <InfiniteSentinel {...list.sentinelProps} skeleton={<UserRowSkeleton />} endLabel={null} />
        </div>
      )}
    </Screen>
  );
};
