/**
 * Browse — ranked campus posts (best match by default), filters (persisted in `uv:roommates:filters`, echoed as
 * removable chips), sort, the "answer 8 questions" banner while the viewer has no answers, `?mode=have` deep link.
 */
import { useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Users } from 'lucide-react';
import { ROOMMATE_FILTERS_STORAGE_KEY, type RoommateFilters, type RoommateSort } from '@shared/roommates';
import { Chip, EmptyState, ErrorState, IconButton, InfiniteSentinel, PageHeader, Screen, SegmentedControl } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { useLocalStorage } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { removeInfiniteItem } from '@/lib/query';
import { useMe } from '@/lib/session';
import { roommateKeys, useBrowse, useMyProfile, useNeighborhoods, useSaveToggle } from './api';
import { FilterSheet } from './FilterSheet';
import { activeFilterCount, filterChips, resetFilters, sanitizeFilters, SORT_OPTIONS } from './filters';
import { MatchBanner, RoommateCardSkeleton, RoommateCardView, useMessageRoommate } from './parts';
import { RoommatesTabs } from './tabs';

export const BrowsePage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = useLocalStorage<RoommateFilters>(ROOMMATE_FILTERS_STORAGE_KEY, {});
  const filters = useMemo(() => sanitizeFilters(stored), [stored]);
  const [sheet, setSheet] = useState(false);

  // `/roommates?mode=have` (from Apartments) pre-filters once, then the param is consumed.
  useEffect(() => {
    const mode = params.get('mode');
    if (mode === 'have' || mode === 'need') {
      setStored((f) => ({ ...sanitizeFilters(f), mode }));
      const next = new URLSearchParams(params);
      next.delete('mode');
      setParams(next, { replace: true });
    }
  }, [params, setParams, setStored]);

  const sort: RoommateSort = filters.sort ?? 'best';
  useScreenView('roommates_browse', { sort, filters: activeFilterCount(filters) });

  const mine = useMyProfile();
  const hasAnswers = Boolean(mine.data?.profile);
  const list = useBrowse(filters);
  const hoods = useNeighborhoods();
  const save = useSaveToggle();
  const messaging = useMessageRoommate();

  const chips = filterChips(filters, me.currency);
  const count = activeFilterCount(filters);
  const canPost = me.isAdult === true;

  const header = (
    <PageHeader
      title="Roommates"
      subtitle={me.university.shortName}
      mode="large"
      actions={<IconButton icon={SlidersHorizontal} aria-label={count ? `Filters, ${count} active` : 'Filters'} badge={count || undefined} onClick={() => setSheet(true)} />}
      below={
        <div className="flex flex-col gap-2 bg-canvas pb-2">
          <RoommatesTabs value="browse" />
          <div className="px-4">
            <SegmentedControl<RoommateSort> value={sort} onChange={(v) => setStored({ ...filters, sort: v })} options={SORT_OPTIONS} size="sm" fullWidth aria-label="Sort" />
          </div>
          {chips.length ? (
            <div className="scroll-x flex gap-2 px-4">
              {chips.map((c) => (
                <Chip key={c.key} variant="removable" size="sm" onRemove={() => setStored(c.remove(filters))}>
                  {c.label}
                </Chip>
              ))}
              <Chip variant="filter" size="sm" onClick={() => setStored(resetFilters(filters))}>
                Clear all
              </Chip>
            </div>
          ) : null}
        </div>
      }
    />
  );

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-4 px-4">
        {Array.from({ length: 3 }, (_, i) => (
          <RoommateCardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body =
      count > 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No matches with these filters."
          description="Try widening your budget or move-in date."
          action={{ label: 'Reset filters', onClick: () => setStored(resetFilters(filters)) }}
        />
      ) : (
        <EmptyState
          icon={Users}
          title={`No roommate posts at ${me.university.name} yet.`}
          description="Post yours and you're the first thing people see."
          action={{
            label: canPost ? 'Create my post' : 'Set up my profile',
            onClick: () => navigate(canPost ? `${routes.roommatesMeEdit()}?intent=post` : routes.roommatesMe()),
          }}
        />
      );
  } else {
    body = (
      <div className="flex flex-col gap-4 px-4">
        {list.items.map((card) => (
          <RoommateCardView
            key={card.id}
            card={card}
            onToggleSave={(c) => save.mutate({ id: c.id, saved: !c.saved })}
            onMessage={(c) => messaging.start(c)}
            onReported={(id) => removeInfiniteItem([...roommateKeys.lists()], id)}
          />
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RoommateCardSkeleton />} endLabel={list.items.length > 3 ? "That's everyone at your campus right now" : null} />
      </div>
    );
  }

  return (
    <Screen nav header={header} className="gap-4 pt-2">
      {!hasAnswers && !mine.isLoading ? <MatchBanner className="mx-4" /> : null}
      {body}
      <FilterSheet open={sheet} onOpenChange={setSheet} value={filters} onApply={(f) => setStored({ ...f, sort })} neighborhoods={hoods.data ?? []} currency={me.currency} />
      {messaging.sheet}
    </Screen>
  );
};
