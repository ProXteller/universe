/**
 * Formatting helpers (SPEC §4.4.1 `lib/format.ts`). Prices ALWAYS go through `formatPrice` — no hand-written "$".
 */
import { format, isSameDay, isSameYear, isTomorrow, isYesterday } from 'date-fns';
import { DEFAULT_CURRENCY } from '@shared/core';
import type { ClassKind, EpochMs } from '@shared/core';
import { getSessionMe } from '@/stores/session';

/* ------------------------------------------------------------------ numbers */

/** "999", "1.2K", "34K", "1.5M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${Math.round(abs)}`;
  if (abs < 10_000) return `${sign}${trimZero((abs / 1000).toFixed(1))}K`;
  if (abs < 1_000_000) return `${sign}${Math.round(abs / 1000)}K`;
  if (abs < 10_000_000) return `${sign}${trimZero((abs / 1_000_000).toFixed(1))}M`;
  return `${sign}${Math.round(abs / 1_000_000)}M`;
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
    } catch {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: DEFAULT_CURRENCY, maximumFractionDigits: 0 });
    }
    formatters.set(currency, f);
  }
  return f;
}

function viewerCurrency(): string {
  return getSessionMe()?.currency ?? DEFAULT_CURRENCY;
}

/** "$60", "£60", "CHF 60"; `null` → "Free". Currency defaults to the viewer's campus currency. */
export function formatPrice(n: number | null, currency?: string): string {
  if (n === null) return 'Free';
  return currencyFormatter(currency ?? viewerCurrency()).format(n);
}

/** The currency's symbol on its own ("$", "£", "CHF") — for `<Input prefix>`. */
export function currencySymbol(currency?: string): string {
  const f = currencyFormatter(currency ?? viewerCurrency());
  const part = f.formatToParts(0).find((p) => p.type === 'currency');
  return (part?.value ?? currency ?? viewerCurrency()).trim();
}

/* ------------------------------------------------------------------ time */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "now", "3m", "2h", "5d", "Mar 4" (adds the year when it differs). */
export function timeAgo(ts: EpochMs, now: EpochMs = Date.now()): string {
  const diff = now - ts;
  if (diff < MIN) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const d = new Date(ts);
  return isSameYear(d, new Date(now)) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
}

/** "Today · 3:45 PM", "Tomorrow · 7:00 PM", "Sat, Mar 4 · 3:45 PM". */
export function formatDayTime(ts: EpochMs, now: EpochMs = Date.now()): string {
  const d = new Date(ts);
  const time = format(d, 'h:mm a');
  const ref = new Date(now);
  if (isSameDay(d, ref)) return `Today · ${time}`;
  if (isTomorrow(d)) return `Tomorrow · ${time}`;
  if (isYesterday(d)) return `Yesterday · ${time}`;
  const day = isSameYear(d, ref) ? format(d, 'EEE, MMM d') : format(d, 'EEE, MMM d, yyyy');
  return `${day} · ${time}`;
}

/** "Mar 4, 2026" — dates without time (sanction end dates and the like). */
export function formatDate(ts: EpochMs): string {
  return format(new Date(ts), 'MMM d, yyyy');
}

/* ------------------------------------------------------------------ people */

export function firstName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || displayName;
}

/** Academic year that ends in the returned calendar year (a year starts in August). */
function currentAcademicYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

/** "Junior" / "Grad" / "Class of 2028" / "" when unknown. */
export function classLabel(classYear: number | null, classKind: ClassKind | null): string {
  if (classKind === 'grad') return 'Grad';
  if (classYear === null) return '';
  if (classKind === 'undergrad') {
    const away = classYear - currentAcademicYear();
    if (away === 0) return 'Senior';
    if (away === 1) return 'Junior';
    if (away === 2) return 'Sophomore';
    if (away === 3) return 'Freshman';
  }
  return `Class of ${classYear}`;
}

/* ------------------------------------------------------------------ course codes (client twin of server/src/lib/courseCode.ts) */

export const COURSE_CODE_REGEX = /^[A-Z]( ?[A-Z]){0,4} \d{2,4}[A-Z]?$/;

/** "cs314" → "CS 314" · "bio 311c" → "BIO 311C" · "E E 302" stays · anything else → null. */
export function normalizeCourseCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z](?: ?[A-Z]){0,4}) ?(\d{2,4}[A-Z]?)$/.exec(s);
  if (!m) return null;
  const code = `${m[1]} ${m[2]}`;
  return COURSE_CODE_REGEX.test(code) ? code : null;
}

/** "1:05" from milliseconds (reel durations, the 60 s refusal copy). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Plural helper: `plural(3, 'reply', 'replies')` → "3 replies". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
