/**
 * Campus-local formatting: event time ranges, date tiles, day-group labels. Prices never appear here (events are
 * free in v1); every price elsewhere goes through `formatPrice`.
 */
import { format, isSameDay, isSameYear, isTomorrow } from 'date-fns';
import type { EpochMs } from '@shared/core';

/** "Today · 7:00 – 9:00 PM" · "Tomorrow · 7:00 PM – 12:30 AM" · "Sat, Mar 4 · 7:00 – 9:00 PM". */
export function formatEventRange(startsAt: EpochMs, endsAt: EpochMs, now: EpochMs = Date.now()): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const ref = new Date(now);
  const day = isSameDay(s, ref) ? 'Today' : isTomorrow(s) ? 'Tomorrow' : isSameYear(s, ref) ? format(s, 'EEE, MMM d') : format(s, 'EEE, MMM d, yyyy');
  const sameMeridiem = format(s, 'a') === format(e, 'a') && isSameDay(s, e);
  const start = sameMeridiem ? format(s, 'h:mm') : format(s, 'h:mm a');
  const end = isSameDay(s, e) ? format(e, 'h:mm a') : `${format(e, 'EEE h:mm a')}`;
  return `${day} · ${start} – ${end}`;
}

/** "7:00 PM" for compact rows. */
export function formatStartTime(startsAt: EpochMs): string {
  return format(new Date(startsAt), 'h:mm a');
}

/** The 48px date tile: { month: 'MAR', day: '4' }. */
export function dateTile(ts: EpochMs): { month: string; day: string; weekday: string } {
  const d = new Date(ts);
  return { month: format(d, 'MMM').toUpperCase(), day: format(d, 'd'), weekday: format(d, 'EEE') };
}

/** Sticky day-group header: "Today" · "Tomorrow" · "Saturday, Mar 4". */
export function dayGroupLabel(ts: EpochMs, now: EpochMs = Date.now()): string {
  const d = new Date(ts);
  const ref = new Date(now);
  if (isSameDay(d, ref)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return isSameYear(d, ref) ? format(d, 'EEEE, MMM d') : format(d, 'EEEE, MMM d, yyyy');
}

/** Stable key for grouping by local calendar day. */
export function dayKey(ts: EpochMs): string {
  return format(new Date(ts), 'yyyy-MM-dd');
}

/** `<input type="datetime-local">` value ("2026-03-04T19:00") ↔ epoch ms, in the viewer's local time. */
export function toDateTimeLocal(ts: EpochMs): string {
  return format(new Date(ts), "yyyy-MM-dd'T'HH:mm");
}

export function fromDateTimeLocal(value: string): EpochMs | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Rounds up to the next half hour (default start of a new event). */
export function nextHalfHour(now: EpochMs = Date.now(), plusMinutes = 0): EpochMs {
  const step = 30 * 60_000;
  return Math.ceil((now + plusMinutes * 60_000) / step) * step;
}
