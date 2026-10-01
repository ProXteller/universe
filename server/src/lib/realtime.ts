/**
 * Realtime (ws) fan-out (SPEC §4.2.8).                                  LANE S-M2b owns this file.
 *
 * `attachRealtime(server)`: WebSocket upgrade on `WS_PATH` (`/ws`), authenticated with the `uv_session` cookie
 * (same `resolveSession` as HTTP; only `active` accounts may connect), 30 s ping/pong heartbeat, `hello` on connect.
 * Foundation handles the client events itself:
 *   - `ping` (keeps the socket alive),
 *   - `typing.set` (relayed to the conversation's ACTIVE members, never inside an unaccepted DM request, never
 *     across a block),
 *   - `conversation.focus` (remembered per socket),
 *   - `presence.subscribe` (answered only for accepted-DM partners with `showPresence`; `lastActiveAt` bucketed 5 min;
 *     subscribers are pushed `presence` when a partner connects / disconnects).
 * Every event delivered to a user is ALSO passed to the test tap (`setRealtimeTap`, installed by lib/testing.ts).
 */
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { EpochMs, Id, MemberState, WsClientEvent, WsServerEvent } from '@shared/core';
import { SESSION_COOKIE, WS_PATH } from '@shared/core';
import { prep } from '../db/index';
import { MIN, now } from './clock';
import { log } from './logger';
import { resolveSession } from './sessions';
import { getUserRow, settingsOf } from './users';

type Tap = (userId: Id, event: WsServerEvent) => void;
let tap: Tap | null = null;

/** Tests only (lib/testing.ts): observe every event addressed to a user. `null` removes the tap. */
export function setRealtimeTap(fn: Tap | null): void {
  tap = fn;
}

export const HEARTBEAT_MS = 30_000;
const PRESENCE_BUCKET_MS = 5 * MIN;
const MAX_PRESENCE_SUBS = 100;
const MAX_MESSAGE_BYTES = 16 * 1024;

interface SocketState {
  userId: Id;
  alive: boolean;
  focusedConversationId: Id | null;
  /** userIds this socket asked presence for. */
  presenceSubs: Set<Id>;
}

const sockets = new Map<Id, Set<WebSocket>>();
const states = new WeakMap<WebSocket, SocketState>();
/** target userId → sockets that subscribed to its presence. */
const presenceWatchers = new Map<Id, Set<WebSocket>>();

/* ───────────────────────────── cookie / auth ───────────────────────────── */

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function authenticateUpgrade(req: http.IncomingMessage): Id | null {
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  const resolved = resolveSession(token);
  if (!resolved) return null;
  if (resolved.user.status !== 'active') return null;
  return resolved.user.id;
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    /* already gone */
  }
  socket.destroy();
}

/* ───────────────────────────── registry ───────────────────────────── */

function register(ws: WebSocket, userId: Id): SocketState {
  const state: SocketState = { userId, alive: true, focusedConversationId: null, presenceSubs: new Set() };
  states.set(ws, state);
  let set = sockets.get(userId);
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  set.add(ws);
  return state;
}

function unregister(ws: WebSocket): void {
  const state = states.get(ws);
  if (!state) return;
  const set = sockets.get(state.userId);
  set?.delete(ws);
  if (set && set.size === 0) sockets.delete(state.userId);
  for (const target of state.presenceSubs) {
    const watchers = presenceWatchers.get(target);
    watchers?.delete(ws);
    if (watchers && watchers.size === 0) presenceWatchers.delete(target);
  }
  states.delete(ws);
}

function send(ws: WebSocket, e: WsServerEvent): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(e));
  } catch (err) {
    log.error('ws send failed', err);
  }
}

/* ───────────────────────────── presence ───────────────────────────── */

export function isOnline(userId: Id): boolean {
  const set = sockets.get(userId);
  return !!set && set.size > 0;
}

/** Presence bucket for a user: online = has ≥ 1 open socket; `lastActiveAt` floored to 5 min (users.last_active_at). */
export function presenceOf(userId: Id): { online: boolean; lastActiveAt: EpochMs | null } {
  const row = prep('SELECT last_active_at FROM users WHERE id = ?').get(userId) as { last_active_at: EpochMs | null } | undefined;
  const last = row?.last_active_at ?? null;
  return { online: isOnline(userId), lastActiveAt: last === null ? null : Math.floor(last / PRESENCE_BUCKET_MS) * PRESENCE_BUCKET_MS };
}

function blockedBetween(a: Id, b: Id): boolean {
  if (a === b) return false;
  return prep('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a) !== undefined;
}

/** `viewer` may see `target`'s presence: an accepted DM exists (both 'active'), no block, and target shows presence. */
export function canSeePresence(viewerId: Id, targetId: Id): boolean {
  if (viewerId === targetId) return false;
  if (blockedBetween(viewerId, targetId)) return false;
  const target = getUserRow(targetId);
  if (!target || target.status !== 'active' || !settingsOf(target).showPresence) return false;
  const key = viewerId < targetId ? `${viewerId}:${targetId}` : `${targetId}:${viewerId}`;
  const dm = prep(
    `SELECT 1 FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ? AND a.state = 'active'
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ? AND b.state = 'active'
      WHERE c.kind = 'dm' AND c.dm_key = ?`,
  ).get(viewerId, targetId, key);
  return dm !== undefined;
}

function presenceEvent(userId: Id): WsServerEvent {
  const p = presenceOf(userId);
  return { type: 'presence', userId, online: p.online, lastActiveAt: p.lastActiveAt };
}

function broadcastPresence(userId: Id): void {
  const watchers = presenceWatchers.get(userId);
  if (!watchers || watchers.size === 0) return;
  const e = presenceEvent(userId);
  for (const ws of watchers) {
    const st = states.get(ws);
    if (!st) continue;
    if (!canSeePresence(st.userId, userId)) continue;
    send(ws, e);
  }
}

/* ───────────────────────────── client events ───────────────────────────── */

function memberStates(conversationId: Id): { user_id: Id; state: MemberState }[] {
  return prep('SELECT user_id, state FROM conversation_members WHERE conversation_id = ?').all(conversationId) as { user_id: Id; state: MemberState }[];
}

function handleTyping(state: SocketState, conversationId: Id, isTyping: boolean): void {
  const conv = prep('SELECT kind FROM conversations WHERE id = ?').get(conversationId) as { kind: string } | undefined;
  if (!conv) return;
  const members = memberStates(conversationId);
  const me = members.find((m) => m.user_id === state.userId);
  if (!me || me.state !== 'active') return;
  // never inside an unaccepted DM request
  if (conv.kind === 'dm' && members.some((m) => m.state === 'request')) return;
  const sender = getUserRow(state.userId);
  if (!sender) return;
  const e: WsServerEvent = { type: 'typing', conversationId, userId: state.userId, displayName: sender.display_name, isTyping };
  for (const m of members) {
    if (m.user_id === state.userId || m.state !== 'active') continue;
    if (blockedBetween(state.userId, m.user_id)) continue; // never across a block
    publishToUser(m.user_id, e);
  }
}

function handlePresenceSubscribe(ws: WebSocket, state: SocketState, userIds: unknown): void {
  if (!Array.isArray(userIds)) return;
  const ids = [...new Set(userIds.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64))].slice(0, MAX_PRESENCE_SUBS);
  for (const target of ids) {
    if (!canSeePresence(state.userId, target)) continue;
    state.presenceSubs.add(target);
    let watchers = presenceWatchers.get(target);
    if (!watchers) {
      watchers = new Set();
      presenceWatchers.set(target, watchers);
    }
    watchers.add(ws);
    send(ws, presenceEvent(target));
  }
}

function handleClientEvent(ws: WebSocket, state: SocketState, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') return;
  const e = raw as WsClientEvent;
  switch (e.type) {
    case 'ping':
      state.alive = true;
      return;
    case 'typing.set':
      if (typeof e.conversationId === 'string' && typeof e.isTyping === 'boolean') handleTyping(state, e.conversationId, e.isTyping);
      return;
    case 'conversation.focus':
      state.focusedConversationId = typeof e.conversationId === 'string' ? e.conversationId : null;
      return;
    case 'presence.subscribe':
      handlePresenceSubscribe(ws, state, e.userIds);
      return;
    default:
      return;
  }
}

/** The conversation a user's socket(s) currently show, if any (first socket wins). */
export function focusedConversationOf(userId: Id): Id | null {
  for (const ws of sockets.get(userId) ?? []) {
    const st = states.get(ws);
    if (st?.focusedConversationId) return st.focusedConversationId;
  }
  return null;
}

/* ───────────────────────────── attach ───────────────────────────── */

/** Path `WS_PATH`, cookie auth, 30 s heartbeat. Safe to call once per http.Server. */
export function attachRealtime(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return; // not ours (Vite proxies only /ws here, but be explicit)
    let userId: Id | null = null;
    try {
      userId = authenticateUpgrade(req);
    } catch (err) {
      log.error('ws upgrade auth failed', err);
    }
    if (!userId) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    const uid = userId;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, uid);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, userId: Id) => {
    const wasOnline = isOnline(userId);
    const state = register(ws, userId);
    ws.on('pong', () => {
      state.alive = true;
    });
    ws.on('message', (data) => {
      state.alive = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        handleClientEvent(ws, state, parsed);
      } catch (err) {
        log.error('ws client event failed', err);
      }
    });
    ws.on('close', () => {
      unregister(ws);
      if (!isOnline(userId)) broadcastPresence(userId);
    });
    ws.on('error', (err) => {
      log.warn('ws socket error', err);
    });
    send(ws, { type: 'hello', userId, serverTime: now() });
    if (!wasOnline) broadcastPresence(userId);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const state = states.get(ws);
      if (!state) continue;
      if (!state.alive) {
        ws.terminate();
        continue;
      }
      state.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        /* ignore */
      }
    }
    wss.close();
  });
}

/* ───────────────────────────── publishing ───────────────────────────── */

export function publishToUser(userId: Id, e: WsServerEvent): void {
  try {
    tap?.(userId, e);
  } catch {
    /* a test tap must never break a request */
  }
  const set = sockets.get(userId);
  if (!set) return;
  for (const ws of set) send(ws, e);
}

export function publishToUsers(ids: Id[], e: WsServerEvent): void {
  for (const id of new Set(ids)) publishToUser(id, e);
}

export function publishToConversation(
  conversationId: Id,
  e: WsServerEvent,
  opts: { exceptUserId?: Id; onlyStates?: MemberState[] } = {},
): void {
  const wanted = new Set<MemberState>(opts.onlyStates ?? ['active']);
  for (const m of memberStates(conversationId)) {
    if (!wanted.has(m.state) || m.user_id === opts.exceptUserId) continue;
    publishToUser(m.user_id, e);
  }
}

/** Tells every socket of the user why, then closes them (logout / sanction / deletion). */
export function revokeUserSockets(userId: Id, reason: 'logout' | 'suspended' | 'banned' | 'deleted'): void {
  publishToUser(userId, { type: 'session.revoked', reason });
  for (const ws of [...(sockets.get(userId) ?? [])]) {
    try {
      ws.close(4001, reason);
    } catch {
      ws.terminate();
    }
  }
}

/** Tests: number of open sockets for a user (0 when none). */
export function socketCountFor(userId: Id): number {
  return sockets.get(userId)?.size ?? 0;
}
