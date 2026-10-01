/**
 * `/market` (design §7.6 "Browse"): large header + Saved / My listings actions; search + category chips (+ Free / Wanted
 * shortcuts) + filter button under it; 2-column grid; FAB "Sell". Every filter lives in the URL (`?q`, `?course`,
 * `?type`, …) so back navigation and deep links (course chat → "Textbooks for CS 314") just work.
 */
import { useEffect, useRef, useState, type FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bookmark, Package, Plus, SearchX, SlidersHorizontal, Store } from 'lucide-react';
import type { ListingCategory, ListingCondition, ListingFilters, ListingSort, ListingType, ListingWithin } from '@shared/market';
import { LISTING_CATEGORIES, LISTING_CATEGORY_IDS, LISTING_CONDITIONS, LISTING_SORTS, LISTING_TYPES } from '@shared/market';
import { Chip, EmptyState, FAB, IconButton, Input, PageHeader, Screen } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useBrowse } from './api';
import { FilterSheet, countActiveFilters, type BrowseFilters } from './FilterSheet';
import { ListingGrid } from './ListingGrid';
import { MARKET_COPY } from './labels';

const WITHIN: readonly ListingWithin[] = ['24h', '7d', '30d'];
const SORTS: readonly ListingSort[] = LISTING_SORTS.map((s) => s.value);

function oneOf<T extends string>(v: string | null, list: readonly T[]): T | undefined {
  return v !== null && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}
function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

type ParamPatch = Record<string, string | number | null | undefined>;

export const BrowsePage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useScreenView('market_browse');

  const q = params.get('q') ?? '';
  const course = params.get('course') ?? '';
  const category = oneOf<ListingCategory>(params.get('category'), LISTING_CATEGORY_IDS);
  const sheet: BrowseFilters = {
    type: oneOf<ListingType>(params.get('type'), LISTING_TYPES),
    min: num(params.get('min')),
    max: num(params.get('max')),
    condition: oneOf<ListingCondition>(params.get('condition'), LISTING_CONDITIONS),
    within: oneOf<ListingWithin>(params.get('within'), WITHIN),
    sort: oneOf<ListingSort>(params.get('sort'), SORTS),
  };
  const filters: ListingFilters = { q, course, category, ...sheet };
  const activeCount = countActiveFilters(sheet) + (category ? 1 : 0) + (course ? 1 : 0);
  const anyNarrowing = activeCount > 0 || q.trim().length > 0;

  const setParams = (patch: ParamPatch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    setSearchParams(next, { replace: true });
  };
  const applySheet = (f: BrowseFilters) => setParams({ type: f.type, min: f.min, max: f.max, condition: f.condition, within: f.within, sort: f.sort });
  const resetAll = () => {
    setText('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // search: local text → 250 ms debounce → URL
  const [text, setText] = useState(q);
  const debounced = useDebounced(text, 250);
  useEffect(() => {
    if (debounced.trim() !== q) setParams({ q: debounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    // external navigation (e.g. a "Textbooks for CS 314" link) resets the box
    setText((t) => (t.trim() === q ? t : q));
  }, [q]);

  const list = useBrowse(filters);

  const header = (
    <PageHeader
      title="Marketplace"
      mode="large"
      actions={
        <>
          <IconButton icon={Bookmark} aria-label="Saved listings" to={routes.marketSaved()} />
          <IconButton icon={Package} aria-label="My listings" to={routes.marketMine()} />
        </>
      }
      below={
        <div className="flex flex-col gap-2 pb-2">
          <div className="flex items-center gap-2 px-4">
            <Input
              variant="search"
              aria-label="Search listings"
              placeholder={`Search ${me.university.shortName} listings`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onClear={() => setText('')}
              className="min-w-0 flex-1"
            />
            <IconButton
              icon={SlidersHorizontal}
              aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
              variant={countActiveFilters(sheet) ? 'accent' : 'filled'}
              badge={countActiveFilters(sheet) ? 'dot' : undefined}
              onClick={() => setFiltersOpen(true)}
            />
          </div>
          <div role="group" aria-label="Category" className="scroll-x flex snap-x gap-2 px-4">
            <Chip size="sm" variant="filter" selected={!category} onClick={() => setParams({ category: undefined })}>
              All
            </Chip>
            {LISTING_CATEGORIES.map((c) => (
              <Chip key={c.id} size="sm" variant="filter" selected={category === c.id} onClick={() => setParams({ category: category === c.id ? undefined : c.id })}>
                {c.label}
              </Chip>
            ))}
            <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-line" />
            <Chip size="sm" variant="filter" selected={sheet.type === 'free'} onClick={() => setParams({ type: sheet.type === 'free' ? undefined : 'free' })}>
              Free
            </Chip>
            <Chip size="sm" variant="filter" selected={sheet.type === 'wanted'} onClick={() => setParams({ type: sheet.type === 'wanted' ? undefined : 'wanted' })}>
              Wanted
            </Chip>
          </div>
          {course ? (
            <div className="flex px-4">
              <Chip size="sm" variant="removable" onRemove={() => setParams({ course: undefined })}>
                Textbooks for {course.toUpperCase()}
              </Chip>
            </div>
          ) : null}
        </div>
      }
    />
  );

  const empty = anyNarrowing ? (
    <EmptyState
      icon={SearchX}
      title="No listings match"
      description={MARKET_COPY.noMatches}
      action={{ label: q.trim() ? `Post a Wanted for “${q.trim()}”` : 'Post a Wanted', onClick: () => navigate(routes.listingNew({ type: 'wanted', title: q.trim() || undefined })) }}
      secondary={{ label: 'Reset', onClick: resetAll }}
    />
  ) : (
    <EmptyState
      icon={Store}
      title="Nothing listed yet"
      description={MARKET_COPY.campusEmpty(me.university.name)}
      action={{ label: 'List an item', onClick: () => navigate(routes.listingNew()) }}
    />
  );

  return (
    <Screen nav header={header} scrollRef={scrollRef}>
      <ListingGrid
        items={list.items}
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        sentinelProps={list.sentinelProps}
        empty={empty}
      />
      <FAB icon={Plus} label="Sell" extended onClick={() => navigate(routes.listingNew())} hideOnScroll={scrollRef} />
      <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} value={sheet} onApply={applySheet} />
    </Screen>
  );
};
