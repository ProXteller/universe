/**
 * Discover search (design §7.3 / product §2.5): 250 ms debounce with row skeletons, Top · People · Orgs,
 * campus results first then "Other campuses", matched text highlighted, local recents (removable, clearable).
 * ONE server list ordered campus-first; the client only splits it on `sameCampus` for the two headers.
 */
import { useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, Search, SearchX, X } from 'lucide-react';
import type { DiscoverSearchType, SearchHit } from '@shared/discover';
import { Button, EmptyState, ErrorState, IconButton, InfiniteSentinel, Input, PageHeader, Screen, Tabs, VerifiedBadge } from '@/ui';
import { FollowButton, UserAvatar } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useDiscoverSearch } from './api';
import { Highlight } from './Highlight';
import { useRecentSearches } from './recents';
import { UserRowSkeleton } from './suggestions';

const TABS = [
  { value: 'all', label: 'Top' },
  { value: 'people', label: 'People' },
  { value: 'orgs', label: 'Orgs' },
] as const satisfies readonly { value: DiscoverSearchType; label: string }[];

/** Server validates `q: z.string().max(80)` — applied to the field AND to `?q=` / recents via `normalize`. */
const MAX_QUERY = 80;

function normalize(q: string): string {
  return q.trim().replace(/^@/, '').replace(/\s+/g, ' ').slice(0, MAX_QUERY);
}

/** Same geometry as `UserRow` (design §7.3 "results = UserRows") with the matched text highlighted. */
function HitRow({ hit, q, onOpen }: { hit: SearchHit; q: string; onOpen(hit: SearchHit): void }) {
  const { user, matched } = hit;
  const me = useMe();
  const isSelf = user.viewer.isSelf || user.id === me.id;
  return (
    <div className="flex min-h-16 w-full items-center gap-3 px-4 py-2">
      <UserAvatar user={user} size="md" link={false} />
      <button
        type="button"
        onClick={() => onOpen(hit)}
        className="press flex min-w-0 flex-1 flex-col items-start rounded-sm text-left"
        aria-label={`${user.displayName}, @${user.handle}`}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          <Highlight text={user.displayName} query={matched === 'name' ? q : ''} className="truncate type-label text-ink" />
          {user.isVerified ? <VerifiedBadge size={14} /> : null}
        </span>
        <span className="max-w-full truncate type-footnote text-ink-3">
          @<Highlight text={user.handle} query={matched === 'handle' ? q : ''} /> · {user.universityShortName}
        </span>
        {user.major ? (
          <span className="max-w-full truncate type-caption text-ink-4">
            <Highlight text={user.major} query={matched === 'major' ? q : ''} />
          </span>
        ) : null}
      </button>
      {isSelf ? null : (
        <div className="shrink-0">
          <FollowButton userId={user.id} initialFollowing={user.viewer.isFollowing} followsMe={user.viewer.isFollowedBy} size="sm" />
        </div>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden aria-busy className="flex flex-col pt-1">
      {Array.from({ length: 6 }, (_, i) => (
        <UserRowSkeleton key={i} />
      ))}
    </div>
  );
}

function GroupHeader({ children }: { children: string }) {
  return <p className="px-4 pt-3 pb-1 type-overline text-ink-3">{children}</p>;
}

export const SearchPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [type, setType] = useState<DiscoverSearchType>('all');
  const debounced = useDebounced(q, 250);
  const term = normalize(debounced);
  const pending = normalize(q) !== term;
  const recents = useRecentSearches();
  const list = useDiscoverSearch(term, type);
  useScreenView('discover_search');

  // Keep `?q=` in the URL so a refresh / share lands on the same search (replace, never push).
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (current === q) return;
    setParams(q ? { q } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const groups = useMemo(() => {
    const campus: SearchHit[] = [];
    const other: SearchHit[] = [];
    for (const h of list.items) (h.sameCampus ? campus : other).push(h);
    return { campus, other };
  }, [list.items]);

  const open = (hit: SearchHit) => {
    recents.add(term);
    navigate(routes.profile(hit.user.handle));
  };

  const idle = term.length === 0 && !pending;
  const showSkeleton = term.length > 0 && (pending || list.isLoading);

  return (
    <Screen
      header={
        <PageHeader
          title="Search"
          back
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate(routes.discover())}>
              Cancel
            </Button>
          }
          below={
            <div className="flex flex-col gap-2">
              <Input
                variant="search"
                leftIcon={Search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onClear={() => setQ('')}
                placeholder="Name, @handle or major"
                maxLength={MAX_QUERY}
                aria-label="Search people and orgs"
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    recents.add(normalize(q));
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <Tabs value={type} onChange={setType} tabs={TABS} aria-label="Search scope" />
            </div>
          }
        />
      }
    >
      {idle ? (
        <div className="flex flex-col pt-1">
          {recents.recents.length > 0 ? (
            <>
              <div className="flex min-h-11 items-center justify-between px-4">
                <p className="type-overline text-ink-3">Recent</p>
                <Button variant="ghost" size="sm" onClick={recents.clear} className="-mr-2">
                  Clear all
                </Button>
              </div>
              <ul className="flex flex-col">
                {recents.recents.map((r) => (
                  <li key={r} className="flex min-h-12 items-center gap-3 pl-4 pr-2">
                    <Clock size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-4" />
                    <button type="button" onClick={() => setQ(r)} className="press min-w-0 flex-1 truncate rounded-sm py-2 text-left type-body text-ink">
                      {r}
                    </button>
                    <IconButton icon={X} size="sm" aria-label={`Remove ${r} from recent searches`} onClick={() => recents.remove(r)} className="text-ink-3" />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="px-4 pt-6 text-center type-footnote text-ink-3">Search by name, @handle or major. Your campus comes first.</p>
          )}
        </div>
      ) : showSkeleton ? (
        <ResultsSkeleton />
      ) : list.isError ? (
        <ErrorState title="Couldn't search" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState icon={SearchX} title={`No one matches "${term}".`} description="Try a name, @handle or major." compact className="pt-6" />
      ) : (
        <div className="flex flex-col pb-4">
          {groups.campus.length > 0 ? (
            <section aria-label={me.university.shortName}>
              <GroupHeader>{me.university.shortName}</GroupHeader>
              {groups.campus.map((h) => (
                <HitRow key={h.user.id} hit={h} q={term} onOpen={open} />
              ))}
            </section>
          ) : null}
          {groups.other.length > 0 ? (
            <section aria-label="Other campuses">
              <GroupHeader>Other campuses</GroupHeader>
              {groups.other.map((h) => (
                <HitRow key={h.user.id} hit={h} q={term} onOpen={open} />
              ))}
            </section>
          ) : null}
          <InfiniteSentinel {...list.sentinelProps} skeleton={<UserRowSkeleton />} endLabel={null} />
        </div>
      )}
    </Screen>
  );
};
