/**
 * Analytics (SPEC §4.4.1 `lib/analytics.ts`). Batched 5 s / 20 events / `pagehide` via `sendBeacon`.
 * Posts with a RAW `fetch` / `sendBeacon` — never `lib/api.ts` — so the global 401/403 handlers cannot fire.
 * Never throws, never retries. Works signed-out for `PRE_AUTH_ANALYTICS_EVENTS` (#33 stores nothing else).
 */
import { useEffect, useRef } from 'react';
import { API_BASE, PRE_AUTH_ANALYTICS_EVENTS } from '@shared/core';
import type { AnalyticsEventName, AnalyticsProps, TrackEventInput, TrackRequest } from '@shared/core';
import { useSessionStore } from '@/stores/session';

const ENDPOINT = `${API_BASE}/analytics/track`;
const FLUSH_MS = 5000;
const FLUSH_AT = 20;
const MAX_PER_REQUEST = 50;

let queue: TrackEventInput[] = [];
let timer: number | null = null;
let listenersInstalled = false;

function signedIn(): boolean {
  const s = useSessionStore.getState();
  return s.me !== null && s.status !== 'anon';
}

function send(events: TrackEventInput[], beacon: boolean): void {
  if (events.length === 0) return;
  const body: TrackRequest = { events };
  const json = JSON.stringify(body);
  try {
    if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never throws */
  }
}

function flush(beacon = false): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    const chunk = queue.slice(0, MAX_PER_REQUEST);
    queue = queue.slice(MAX_PER_REQUEST);
    send(chunk, beacon);
  }
}

function installListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

/** Queue an event. Signed-out callers only get the pre-auth names through (everything else is dropped here). */
export function track(name: AnalyticsEventName, props?: AnalyticsProps): void {
  try {
    if (!signedIn() && !PRE_AUTH_ANALYTICS_EVENTS.includes(name)) return;
    installListeners();
    queue.push({ name, props, ts: Date.now() });
    if (queue.length >= FLUSH_AT) {
      flush();
      return;
    }
    if (timer === null) timer = window.setTimeout(() => flush(), FLUSH_MS);
  } catch {
    /* never throws */
  }
}

/** Foundation-internal: flush now (logout, tests). */
export function flushAnalytics(): void {
  flush();
}

/** `screen_view` once per mount / screen change. */
export function useScreenView(screen: string, props?: AnalyticsProps): void {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    track('screen_view', { screen, ...(latest.current ?? {}) });
  }, [screen]);
}

export type DwellBucket = '<5s' | '5-15s' | '15-60s' | '60s+';

export function dwellBucket(ms: number): DwellBucket {
  if (ms < 5000) return '<5s';
  if (ms < 15_000) return '5-15s';
  if (ms < 60_000) return '15-60s';
  return '60s+';
}

/** Fires `name` on unmount with `dwellBucket` (time the component was mounted, hidden time excluded). */
export function useDwell(name: AnalyticsEventName, props?: AnalyticsProps): void {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let visibleSince = document.visibilityState === 'hidden' ? null : Date.now();
    let total = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince !== null) total += Date.now() - visibleSince;
        visibleSince = null;
      } else if (visibleSince === null) {
        visibleSince = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (visibleSince !== null) total += Date.now() - visibleSince;
      track(name, { ...(latest.current ?? {}), dwellMs: total, dwellBucket: dwellBucket(total) });
    };
  }, [name]);
}
