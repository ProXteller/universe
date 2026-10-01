/**
 * Browse filter sheet (product §2.8): type, price min / max, condition, posted within, sort. Draft state lives in the
 * sheet until "Show listings"; Reset clears everything.
 */
import { useEffect, useState, type FC } from 'react';
import type { ListingCondition, ListingSort, ListingType, ListingWithin } from '@shared/market';
import { LISTING_CONDITIONS, LISTING_CONDITION_LABELS, LISTING_SORTS, LISTING_TYPES, LISTING_TYPE_LABELS } from '@shared/market';
import { Button, ChipGroup, Input, Sheet } from '@/ui';
import { currencySymbol } from '@/lib/format';

export interface BrowseFilters {
  type?: ListingType;
  min?: number;
  max?: number;
  condition?: ListingCondition;
  within?: ListingWithin;
  sort?: ListingSort;
}

export function countActiveFilters(f: BrowseFilters): number {
  let n = 0;
  if (f.type) n += 1;
  if (typeof f.min === 'number' || typeof f.max === 'number') n += 1;
  if (f.condition) n += 1;
  if (f.within) n += 1;
  if (f.sort && f.sort !== 'newest') n += 1;
  return n;
}

export interface FilterSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  value: BrowseFilters;
  onApply(next: BrowseFilters): void;
}

type TypeChoice = ListingType | 'all';
type ConditionChoice = ListingCondition | 'any';
type WithinChoice = ListingWithin | 'any';

const TYPE_OPTIONS: readonly { value: TypeChoice; label: string }[] = [{ value: 'all', label: 'All' }, ...LISTING_TYPES.map((t) => ({ value: t, label: LISTING_TYPE_LABELS[t] }))];
const CONDITION_OPTIONS: readonly { value: ConditionChoice; label: string }[] = [{ value: 'any', label: 'Any' }, ...LISTING_CONDITIONS.map((c) => ({ value: c, label: LISTING_CONDITION_LABELS[c] }))];
const WITHIN_OPTIONS: readonly { value: WithinChoice; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];
const SORT_OPTIONS: readonly { value: ListingSort; label: string }[] = LISTING_SORTS;

function toNumber(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

export const FilterSheet: FC<FilterSheetProps> = ({ open, onOpenChange, value, onApply }) => {
  const [draft, setDraft] = useState<BrowseFilters>(value);
  const [min, setMin] = useState(value.min?.toString() ?? '');
  const [max, setMax] = useState(value.max?.toString() ?? '');
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setMin(value.min?.toString() ?? '');
    setMax(value.max?.toString() ?? '');
  }, [open, value]);

  const symbol = currencySymbol();
  const minN = toNumber(min);
  const maxN = toNumber(max);
  const rangeError = minN !== undefined && maxN !== undefined && minN > maxN ? 'Min is above max.' : undefined;

  const apply = () => {
    onApply({ ...draft, min: minN, max: maxN });
    onOpenChange(false);
  };
  const reset = () => {
    setDraft({});
    setMin('');
    setMax('');
    onApply({});
    onOpenChange(false);
  };

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3">
      <Button variant="ghost" onClick={reset}>
        Reset
      </Button>
      <Button variant="primary" fullWidth onClick={apply} disabled={Boolean(rangeError)} className="flex-1">
        Show listings
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filters" detents={['auto']} footer={footer}>
      <div className="flex flex-col gap-5 px-4 pb-4">
        <Section label="Type">
          <ChipGroup<TypeChoice>
            aria-label="Listing type"
            options={TYPE_OPTIONS}
            value={draft.type ?? 'all'}
            onChange={(v: TypeChoice) => setDraft((d) => ({ ...d, type: v === 'all' ? undefined : v }))}
            scroll="wrap"
            size="sm"
          />
        </Section>
        <Section label="Price">
          <div className="flex items-start gap-3">
            <Input aria-label="Minimum price" placeholder="Min" prefix={symbol} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} className="flex-1" />
            <Input aria-label="Maximum price" placeholder="Max" prefix={symbol} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} error={rangeError} className="flex-1" />
          </div>
        </Section>
        <Section label="Condition">
          <ChipGroup<ConditionChoice>
            aria-label="Condition"
            options={CONDITION_OPTIONS}
            value={draft.condition ?? 'any'}
            onChange={(v: ConditionChoice) => setDraft((d) => ({ ...d, condition: v === 'any' ? undefined : v }))}
            scroll="wrap"
            size="sm"
          />
        </Section>
        <Section label="Posted">
          <ChipGroup<WithinChoice>
            aria-label="Posted within"
            options={WITHIN_OPTIONS}
            value={draft.within ?? 'any'}
            onChange={(v: WithinChoice) => setDraft((d) => ({ ...d, within: v === 'any' ? undefined : v }))}
            scroll="wrap"
            size="sm"
          />
        </Section>
        <Section label="Sort">
          <ChipGroup<ListingSort>
            aria-label="Sort"
            options={SORT_OPTIONS}
            value={draft.sort ?? 'newest'}
            onChange={(v: ListingSort) => setDraft((d) => ({ ...d, sort: v === 'newest' ? undefined : v }))}
            scroll="wrap"
            size="sm"
          />
        </Section>
      </div>
    </Sheet>
  );
};

const Section: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="flex flex-col gap-2">
    <h3 className="type-overline text-ink-3">{label}</h3>
    {children}
  </section>
);
