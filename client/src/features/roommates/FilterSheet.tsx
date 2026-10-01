/**
 * Filter sheet = `RoommateFilters` only (§2.3: lifestyle chips are NOT filters, they drive the match %; no campus switch).
 * mode · budget range · move-in · lease · neighborhoods · living-with. Sort lives in the Browse header.
 */
import { useEffect, useState, type FC, type ReactNode } from 'react';
import { Home, Search } from 'lucide-react';
import { ROOMMATE_LIMITS, type LivingWith, type RoommateFilters, type RoommateMode } from '@shared/roommates';
import { Button, Chip, ChipGroup, RangeSlider, Select, Sheet } from '@/ui';
import { formatPrice } from '@/lib/format';
import { LIVING_WITH_LABEL, upcomingMonths } from './filters';

/** The slider covers the realistic campus range; the ends mean "no bound". */
export const BUDGET_RANGE: [number, number] = [200, 3000];
const BUDGET_STEP = 50;

const LEASE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'any', label: 'Any length' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
  { value: '18', label: '18 months' },
  { value: '24', label: '24 months' },
];

export interface FilterSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  value: RoommateFilters;
  onApply(next: RoommateFilters): void;
  neighborhoods: string[];
  currency: string;
}

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-3">
    <h3 className="type-overline text-ink-3">{title}</h3>
    {children}
  </section>
);

export const FilterSheet: FC<FilterSheetProps> = ({ open, onOpenChange, value, onApply, neighborhoods, currency }) => {
  const [draft, setDraft] = useState<RoommateFilters>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const budget: [number, number] = [draft.budgetMin ?? BUDGET_RANGE[0], draft.budgetMax ?? BUDGET_RANGE[1]];
  const months = upcomingMonths(18);
  const hoodOptions = Array.from(new Set([...neighborhoods, ...(draft.neighborhoods ?? [])])).map((n) => ({ value: n, label: n }));

  const setMode = (m: RoommateMode): void => setDraft((d) => (d.mode === m ? { ...d, mode: undefined } : { ...d, mode: m }));
  const setLiving = (w: LivingWith): void => setDraft((d) => (d.livingWith === w ? { ...d, livingWith: undefined } : { ...d, livingWith: w }));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      detents={['full']}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setDraft(value.sort ? { sort: value.sort } : {})}>
            Reset
          </Button>
          <Button
            fullWidth
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Show matches
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 px-4 pb-4">
        <Section title="Looking for">
          <div className="flex gap-2">
            <Chip variant="filter" leftIcon={Search} selected={draft.mode === 'need'} onClick={() => setMode('need')}>
              Needs a place
            </Chip>
            <Chip variant="filter" leftIcon={Home} selected={draft.mode === 'have'} onClick={() => setMode('have')}>
              Has a place
            </Chip>
          </div>
        </Section>

        <Section title="Monthly budget">
          <RangeSlider
            label="Budget (their share)"
            min={BUDGET_RANGE[0]}
            max={BUDGET_RANGE[1]}
            step={BUDGET_STEP}
            minGap={BUDGET_STEP * 2}
            value={budget}
            onChange={([lo, hi]) =>
              setDraft((d) => ({
                ...d,
                budgetMin: lo <= BUDGET_RANGE[0] ? undefined : lo,
                budgetMax: hi >= BUDGET_RANGE[1] ? undefined : hi,
              }))
            }
            format={(v) => (v >= BUDGET_RANGE[1] ? `${formatPrice(v, currency)}+` : formatPrice(v, currency))}
          />
        </Section>

        <Section title="Dates">
          <Select<string>
            label="Move-in by"
            value={draft.moveIn ?? 'any'}
            onChange={(v) => setDraft((d) => ({ ...d, moveIn: v === 'any' ? undefined : v }))}
            options={[{ value: 'any', label: 'Any month' }, ...months]}
            sheetTitle="Move-in by"
          />
          <Select<string>
            label="Lease length"
            value={draft.leaseMonths !== undefined ? String(draft.leaseMonths) : 'any'}
            onChange={(v) => setDraft((d) => ({ ...d, leaseMonths: v === 'any' ? undefined : Number(v) }))}
            options={LEASE_OPTIONS}
            sheetTitle="Lease length"
          />
        </Section>

        {hoodOptions.length ? (
          <Section title="Neighborhoods">
            <ChipGroup<string>
              options={hoodOptions}
              value={draft.neighborhoods ?? []}
              onChange={(v: string[]) => setDraft((d) => ({ ...d, neighborhoods: v.length ? v : undefined }))}
              multiple
              max={ROOMMATE_LIMITS.neighborhoodsMax}
              scroll="wrap"
              aria-label="Neighborhoods"
            />
          </Section>
        ) : null}

        <Section title="Comfortable living with">
          <div className="flex gap-2">
            {(['anyone', 'same_gender'] as const).map((w) => (
              <Chip key={w} variant="filter" selected={draft.livingWith === w} onClick={() => setLiving(w)}>
                {LIVING_WITH_LABEL[w]}
              </Chip>
            ))}
          </div>
        </Section>
      </div>
    </Sheet>
  );
};
