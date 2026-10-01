/**
 * /buzz/search — search buzzes by keyword (title + body), in Campus or Global, newest or top first. Results are
 * ordinary BuzzCards (same anonymity rules as the feed: aliases only). The query lives in the Buzz store for the
 * session, so "back" from a thread lands on the same results; nothing is written to localStorage (safety L4).
 */
import { useEffect, useRef, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import type { FeedScope } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { Buzz, BuzzSort } from '@shared/buzz';
import { Chip, EmptyState, ErrorState, Input, InfiniteSentinel, PageHeader, Screen, SegmentedControl, Surface } from '@/ui';
import { CampusScopeToggle } from '@/components';
import { isApiError } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useBuzzSearch } from './api';
import { BuzzCard, BuzzCardSkeleton } from './BuzzCard';
import { BuzzGatePanel, useBuzzGate } from './gate';
import { ensureBuzzStoreReset, useBuzzStore } from './store';

const SORTS: { value: BuzzSort; label: string }[] = [
  { value: 'new', label: 'Newest' },
  { value: 'top', label: 'Top' },
];

const SUGGESTIONS = ['dining', 'food', 'parking', 'housing', 'roommate', 'professor', 'library', 'gym', 'bus', 'wifi'];

export const SearchPage: FC = () => {
  const navigate = useNavigate();
  const { accepted } = useBuzzGate();
  useEffect(() => {
    ensureBuzzStoreReset();
  }, []);
  const back = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate(routes.home('buzz'), { replace: true });
  };
  return (
    <Surface mode="incognito" className="absolute inset-0">
      {accepted ? (
        <SearchScreen onBack={back} />
      ) : (
        <Screen header={<PageHeader title="Search Buzz" mode="compact" back={back} />}>
          <BuzzGatePanel variant="page" onDismiss={back} className="pt-4" />
        </Screen>
      )}
    </Surface>
  );
};

const SearchScreen: FC<{ onBack(): void }> = ({ onBack }) => {
  const me = useMe();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const search = useBuzzStore((s) => s.search);
  const setSearch = useBuzzStore((s) => s.setSearch);
  const q = useDebounced(search.q, 300);
  const results = useBuzzSearch(q, search.scope, search.sort);
  const ready = q.trim().length >= 2;
  const gateError = isApiError(results.error, 'buzz_gate_required');
  const where = search.scope === 'campus' ? me.university.shortName : 'Global';

  useEffect(() => {
    if (!search.q) window.setTimeout(() => inputRef.current?.focus(), 60);
    // focus only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      scrollRef={scrollRef}
      header={
        <PageHeader
          title="Search Buzz"
          mode="compact"
          back={onBack}
          below={
            <div className="flex flex-col gap-2 px-4 pb-2">
              <Input
                ref={inputRef}
                variant="search"
                type="search"
                enterKeyHint="search"
                aria-label="Search buzzes"
                placeholder={`Search ${where} buzz`}
                maxLength={LIMITS.buzzSearch}
                value={search.q}
                onChange={(e) => setSearch({ q: e.target.value })}
                onClear={() => setSearch({ q: '' })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') inputRef.current?.blur();
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <SegmentedControl<BuzzSort> aria-label="Sort results" size="sm" value={search.sort} onChange={(sort) => setSearch({ sort })} options={SORTS} />
                <CampusScopeToggle value={search.scope} onChange={(scope: FeedScope) => setSearch({ scope })} size="sm" />
              </div>
            </div>
          }
        />
      }
    >
      {!ready ? (
        <div className="flex flex-col gap-3 px-4 pt-4">
          <p className="type-footnote text-ink-3">Find buzzes about anything: type a word or two. Try one of these:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} variant="filter" size="sm" onClick={() => setSearch({ q: s })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      ) : results.isLoading ? (
        <div className="flex flex-col gap-3 px-4 pt-3" aria-busy>
          <BuzzCardSkeleton />
          <BuzzCardSkeleton />
        </div>
      ) : results.isError && !gateError ? (
        <ErrorState title="Search didn't load. That's on us." error={results.error} onRetry={() => void results.refetch()} className="px-4 pt-6" />
      ) : results.items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`No ${where} buzzes match "${q.trim()}".`}
          description={search.scope === 'campus' ? 'Try another word, or look in Global.' : 'Try another word, or look on your campus.'}
          action={{ label: search.scope === 'campus' ? 'Search Global' : `Search ${me.university.shortName}`, onClick: () => setSearch({ scope: search.scope === 'campus' ? 'global' : 'campus' }) }}
          compact
          className="pt-6"
        />
      ) : (
        <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
          {results.items.map((b: Buzz) => (
            <BuzzCard key={b.id} buzz={b} />
          ))}
          <InfiniteSentinel {...results.sentinelProps} rootRef={scrollRef} skeleton={<BuzzCardSkeleton />} endLabel="That's every match" />
        </div>
      )}
    </Screen>
  );
};
