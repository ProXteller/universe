/**
 * Browse filters: persisted in `uv:roommates:filters` (SPEC §5.7), echoed as removable chips, `?mode=have` deep link.
 * Pure helpers + the month formatting twins of the server (`shared` holds only the month names).
 */
import { MONTH_LONG, MONTH_SHORT, MOVE_IN_REGEX, ROOMMATE_LIMITS, ROOMMATE_MODE_LABEL, type RoommateFilters, type RoommateSort } from '@shared/roommates';
import { formatPrice } from '@/lib/format';

export const SORT_OPTIONS: readonly { value: RoommateSort; label: string }[] = [
  { value: 'best', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'budget', label: 'Budget' },
];

export const LIVING_WITH_LABEL = { anyone: 'Anyone', same_gender: 'Same gender only' } as const;

/** 'YYYY-MM' → 'Aug 2026'. */
export function formatMoveIn(moveIn: string | null | undefined): string {
  if (!moveIn) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(moveIn);
  if (!m) return moveIn;
  return `${MONTH_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** 'YYYY-MM' → 'August'. */
export function moveInMonthName(moveIn: string | null | undefined): string | null {
  if (!moveIn) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(moveIn);
  if (!m) return null;
  return MONTH_LONG[Number(m[2]) - 1] ?? null;
}

/** The next `n` months as Select options, starting with the current month. */
export function upcomingMonths(n = 14, from: Date = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

export function isMoveIn(v: unknown): v is string {
  return typeof v === 'string' && MOVE_IN_REGEX.test(v);
}

/** Drops unknown keys / bad values from whatever was in localStorage. */
export function sanitizeFilters(raw: unknown): RoommateFilters {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: RoommateFilters = {};
  if (r.mode === 'need' || r.mode === 'have') out.mode = r.mode;
  if (typeof r.budgetMin === 'number' && Number.isFinite(r.budgetMin)) out.budgetMin = Math.round(r.budgetMin);
  if (typeof r.budgetMax === 'number' && Number.isFinite(r.budgetMax)) out.budgetMax = Math.round(r.budgetMax);
  if (isMoveIn(r.moveIn)) out.moveIn = r.moveIn;
  if (typeof r.leaseMonths === 'number' && r.leaseMonths >= ROOMMATE_LIMITS.leaseMin && r.leaseMonths <= ROOMMATE_LIMITS.leaseMax) out.leaseMonths = r.leaseMonths;
  if (Array.isArray(r.neighborhoods)) {
    const hoods = r.neighborhoods.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, ROOMMATE_LIMITS.neighborhoodsMax);
    if (hoods.length) out.neighborhoods = hoods;
  }
  if (r.livingWith === 'anyone' || r.livingWith === 'same_gender') out.livingWith = r.livingWith;
  if (r.sort === 'best' || r.sort === 'newest' || r.sort === 'budget') out.sort = r.sort;
  return out;
}

/** Everything except `sort` counts as an active filter. */
export function activeFilterCount(f: RoommateFilters): number {
  let n = 0;
  if (f.mode) n++;
  if (f.budgetMin !== undefined || f.budgetMax !== undefined) n++;
  if (f.moveIn) n++;
  if (f.leaseMonths !== undefined) n++;
  if (f.neighborhoods?.length) n++;
  if (f.livingWith) n++;
  return n;
}

export interface FilterChip {
  key: keyof RoommateFilters | `hood:${string}`;
  label: string;
  /** Returns the filters with this chip removed. */
  remove(f: RoommateFilters): RoommateFilters;
}

export function filterChips(f: RoommateFilters, currency: string): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.mode) chips.push({ key: 'mode', label: ROOMMATE_MODE_LABEL[f.mode], remove: ({ mode: _m, ...rest }) => rest });
  if (f.budgetMin !== undefined || f.budgetMax !== undefined) {
    const lo = f.budgetMin !== undefined ? formatPrice(f.budgetMin, currency) : null;
    const hi = f.budgetMax !== undefined ? formatPrice(f.budgetMax, currency) : null;
    const label = lo && hi ? `${lo}–${hi}` : lo ? `From ${lo}` : `Up to ${hi}`;
    chips.push({ key: 'budgetMin', label, remove: ({ budgetMin: _a, budgetMax: _b, ...rest }) => rest });
  }
  if (f.moveIn) chips.push({ key: 'moveIn', label: `By ${formatMoveIn(f.moveIn)}`, remove: ({ moveIn: _m, ...rest }) => rest });
  if (f.leaseMonths !== undefined) chips.push({ key: 'leaseMonths', label: `${f.leaseMonths}-month lease`, remove: ({ leaseMonths: _l, ...rest }) => rest });
  for (const h of f.neighborhoods ?? []) {
    chips.push({
      key: `hood:${h}`,
      label: h,
      remove: (cur) => {
        const left = (cur.neighborhoods ?? []).filter((x) => x !== h);
        const { neighborhoods: _n, ...rest } = cur;
        return left.length ? { ...rest, neighborhoods: left } : rest;
      },
    });
  }
  if (f.livingWith) chips.push({ key: 'livingWith', label: LIVING_WITH_LABEL[f.livingWith], remove: ({ livingWith: _w, ...rest }) => rest });
  return chips;
}

/** Keeps only the sort. */
export function resetFilters(f: RoommateFilters): RoommateFilters {
  return f.sort ? { sort: f.sort } : {};
}
