/**
 * Realtime client (SPEC §4.4.1 `lib/realtime.ts`). One socket per signed-in session on `WS_PATH` (cookie auth).
 * Backoff 1 → 2 → 4 → … → 30 s. On every reconnect the reserved keys `['messages']` and `['notifications']`
 * are invalidated (§4.4.5) and `onReconnect` listeners run. Foundation consumes `notification`, `badges` and
 * `session.revoked` itself; everything else is for `useRealtime`.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { WS_PATH } from '@shared/core';
import type { Badges, WsClientEvent, WsEventOf, WsEventType, WsServerEvent } from '@shared/core';
import { useSessionStore } from '@/stores/session';
import { queryClient } from './query';
import { clearClientSession, refreshMe, registerWsCloser } from './session';
import { navigateTo } from './navigation';
import { routes } from './links';
import { toast } from './toast';

export type WsStatus = 'connecting' | 'open' | 'reconnecting';

type Handler = (e: WsServerEvent) => void;

const handlers = new Map<WsEventType, Set<Handler>>();
const reconnectListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();

let socket: WebSocket | null = null;
let status: WsStatus = 'connecting';
let wanted = false;
let attempt = 0;
let hadOpen = false;
let retryTimer: number | null = null;
let pingTimer: number | null = null;

function setStatus(next: WsStatus): void {
  if (status === next) return;
  status = next;
  statusListeners.forEach((fn) => fn());
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${WS_PATH}`;
}

function clearTimers(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (pingTimer !== null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
}

function dispatch(event: WsServerEvent): void {
  consumeFoundationEvent(event);
  const set = handlers.get(event.type);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      if (import.meta.env.DEV) console.error('realtime handler failed', err);
    }
  });
}

function setBadges(badges: Badges): void {
  queryClient.setQueryData(['badges'], badges);
}

function consumeFoundationEvent(event: WsServerEvent): void {
  switch (event.type) {
    case 'badges':
      setBadges(event.badges);
      break;
    case 'notification':
      setBadges(event.badges);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (event.notification.type === 'mod.warning') void queryClient.invalidateQueries({ queryKey: ['me', 'sanctions'] });
      break;
    case 'session.revoked':
      disconnect();
      if (event.reason === 'suspended' || event.reason === 'banned') {
        useSessionStore.getState().markRestricted(event.reason);
        // Re-read `/me` (allowed while restricted, endpoint #9) so the SanctionGate has `activeSanction`
        // (reason, `until`) — nothing observes `['me']` with useQuery, so an invalidation would be a no-op.
        void refreshMe();
        return;
      }
      clearClientSession();
      toast.info(event.reason === 'deleted' ? 'This account was deleted.' : 'You were signed out.');
      navigateTo(routes.welcome(), { replace: true });
      break;
    default:
      break;
  }
}

function scheduleRetry(): void {
  if (!wanted || retryTimer !== null) return;
  const delay = Math.min(30_000, 1000 * 2 ** attempt);
  attempt += 1;
  setStatus(hadOpen ? 'reconnecting' : 'connecting');
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    open();
  }, delay);
}

function open(): void {
  if (!wanted || socket) return;
  if (typeof WebSocket === 'undefined') return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    const reconnected = hadOpen;
    hadOpen = true;
    attempt = 0;
    setStatus('open');
    pingTimer = window.setInterval(() => sendWs({ type: 'ping' }), 25_000);
    if (reconnected) {
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['badges'] });
      reconnectListeners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    }
  };
  ws.onmessage = (msg) => {
    if (socket !== ws) return;
    let data: unknown;
    try {
      data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
    } catch {
      return;
    }
    if (typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string') {
      dispatch(data as WsServerEvent);
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    scheduleRetry();
  };
  ws.onerror = () => {
    /* onclose follows */
  };
}

function disconnect(): void {
  wanted = false;
  clearTimers();
  const ws = socket;
  socket = null;
  if (ws) {
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  hadOpen = false;
  attempt = 0;
  setStatus('connecting');
}

/** Foundation-internal: keep the socket alive exactly while the session is `'ready'`. Mounted once by AppShell. */
export function useRealtimeConnection(): void {
  const sessionStatus = useSessionStore((s) => s.status);
  const epoch = useSessionStore((s) => s.sessionEpoch);
  useEffect(() => {
    if (sessionStatus !== 'ready') {
      if (wanted) disconnect();
      return;
    }
    wanted = true;
    registerWsCloser(disconnect);
    open();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wanted && !socket && retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
        open();
      }
    };
    const onOnline = () => onVisible();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      registerWsCloser(null);
      disconnect();
    };
  }, [sessionStatus, epoch]);
}

/* ------------------------------------------------------------------ public API */

export function useRealtime<T extends WsEventType>(type: T, handler: (e: WsEventOf<T>) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const fn: Handler = (e) => latest.current(e as WsEventOf<T>);
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }, [type]);
}

/** Drops silently when the socket is not open (typing / focus / presence are all best-effort). */
export function sendWs(e: WsClientEvent): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(e));
  } catch {
    /* ignore */
  }
}

function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

export function useWsStatus(): WsStatus {
  return useSyncExternalStore(subscribeStatus, () => status, () => 'connecting' as WsStatus);
}

export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => {
    reconnectListeners.delete(fn);
  };
}
