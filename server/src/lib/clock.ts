/**
 * The ONLY place in server code that reads the wall clock (SPEC §4 intro / §4.2.2).
 * Everything else calls `now()`, so tests can move time with `setNow()`.
 */
import type { EpochMs } from '@shared/core';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

let fixedNow: EpochMs | null = null;

export function now(): EpochMs {
  return fixedNow ?? Date.now();
}

/** Tests only. `null` returns to the real clock. */
export function setNow(ms: EpochMs | null): void {
  fixedNow = ms;
}
