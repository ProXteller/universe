/**
 * Quiet-hours suppression (SPEC §4.2.7 / §1.3 foundation T2).                LANE S-M3 owns this file.
 *
 * `notify()` writes the row regardless; inside the recipient's quiet hours it publishes only `{ type:'badges' }`
 * over ws (no toast at 3 am). The predicate is installed into lib/notify.ts through `setQuietHoursCheck`.
 *
 * Local time: the app stores no timezone, so the viewer's local minute-of-day is approximated from their campus
 * country (`universities.country_code` → a representative UTC offset; the US defaults to Central, where the hero
 * campus is). Good enough for a 23:00–08:00 window; a real timezone column can replace `utcOffsetMinutesFor` later.
 *
 * Disabled when `config.env === 'test'` unless `QUIET_HOURS=on` (same convention as rate limits, §4.2.9), so test
 * runs are not time-of-day dependent.
 */
import type { EpochMs, Id, UserSettings } from '@shared/core';
import { config } from '../config';
import { MIN } from './clock';
import { setQuietHoursCheck } from './notify';
import { getUniversityRow } from './universities';
import { getUserRow, settingsOf } from './users';

const DAY_MIN = 24 * 60;

/** Representative UTC offsets (minutes) per country; unknown → 0. */
const OFFSET_BY_COUNTRY: Readonly<Record<string, number>> = {
  US: -360, CA: -300, MX: -360, BR: -180, AR: -180, CL: -240, CO: -300,
  GB: 0, IE: 0, PT: 0, DE: 60, FR: 60, ES: 60, IT: 60, NL: 60, BE: 60, AT: 60, CH: 60, SE: 60, NO: 60, DK: 60, PL: 60, CZ: 60,
  FI: 120, GR: 120, IL: 120, EG: 120, ZA: 120, TR: 180, SA: 180, KE: 180, AE: 240, PK: 300, IN: 330, BD: 360,
  TH: 420, VN: 420, ID: 420, MY: 480, SG: 480, PH: 480, CN: 480, HK: 480, TW: 480, KR: 540, JP: 540, AU: 600, NZ: 720,
  NG: 60, GH: 0,
};

export function utcOffsetMinutesFor(countryCode: string | null | undefined): number {
  if (!countryCode) return 0;
  return OFFSET_BY_COUNTRY[countryCode.toUpperCase()] ?? 0;
}

/** Minute of the local day (0–1439) for an instant at the given UTC offset. */
export function localMinuteOfDay(at: EpochMs, offsetMinutes: number): number {
  const shifted = Math.floor(at / MIN) + offsetMinutes;
  return ((shifted % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/** True when `localMin` falls inside [start, end) — the window may wrap midnight (23:00 → 08:00). */
export function isWithinWindow(startMin: number, endMin: number, localMin: number): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return localMin >= startMin && localMin < endMin;
  return localMin >= startMin || localMin < endMin;
}

export function isInQuietHours(quiet: UserSettings['quietHours'], countryCode: string | null | undefined, at: EpochMs): boolean {
  if (!quiet.enabled) return false;
  return isWithinWindow(quiet.startMin, quiet.endMin, localMinuteOfDay(at, utcOffsetMinutesFor(countryCode)));
}

/** The predicate `notify()` consults: the recipient's settings + campus country. Unknown users → false. */
export function isInQuietHoursFor(userId: Id, at: EpochMs): boolean {
  const row = getUserRow(userId);
  if (!row) return false;
  const uni = getUniversityRow(row.university_id);
  return isInQuietHours(settingsOf(row).quietHours, uni?.country_code ?? null, at);
}

export function quietHoursEnforced(): boolean {
  return config.env !== 'test' || process.env.QUIET_HOURS === 'on';
}

let installed = false;

/** Installs the predicate into lib/notify.ts once (idempotent). Called from `createApp`. */
export function installQuietHours(): void {
  if (installed) return;
  installed = true;
  setQuietHoursCheck((userId, at) => quietHoursEnforced() && isInQuietHoursFor(userId, at));
}

/** Tests: drop the installed predicate (notify falls back to "never"). */
export function uninstallQuietHours(): void {
  installed = false;
  setQuietHoursCheck(null);
}
