/**
 * lib/realtime.ts (SPEC §4.2.8): a real WebSocket round trip on `/ws` — cookie-authenticated upgrade, `hello`,
 * publishToUser delivery, typing relay rules, presence answers, session revocation, isOnline. The server listens on
 * an ephemeral port and is closed in afterEach (nothing is left running).
 */
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { WsClientEvent, WsServerEvent } from '@shared/core';
import { SESSION_COOKIE, WS_PATH } from '@shared/core';
import { openDm, sendMessage } from '../../src/lib/conversations';
import { attachRealtime, canSeePresence, isOnline, presenceOf, publishToUser, revokeUserSockets, socketCountFor } from '../../src/lib/realtime';
import { createSession } from '../../src/lib/sessions';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

let ctx: TestCtx;
let server: http.Server;
let port = 0;
const open: WebSocket[] = [];

beforeEach(async () => {
  ctx = await createTestApp({ slices: [] });
  server = http.createServer(ctx.app);
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  for (const ws of open.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Client {
  ws: WebSocket;
  events: WsServerEvent[];
  next(type?: WsServerEvent['type'], timeoutMs?: number): Promise<WsServerEvent>;
  send(e: WsClientEvent): void;
  closed: Promise<{ code: number; reason: string }>;
}

function connect(userId: string, opts: { cookie?: string | null } = {}): Promise<Client> {
  const cookie = opts.cookie === undefined ? `${SESSION_COOKIE}=${createSession(userId, 'vitest-ws').token}` : opts.cookie;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, { headers: cookie ? { Cookie: cookie } : {} });
  open.push(ws);
  const events: WsServerEvent[] = [];
  const waiters: { type?: WsServerEvent['type']; resolve(e: WsServerEvent): void }[] = [];
  ws.on('message', (data) => {
    const e = JSON.parse(data.toString()) as WsServerEvent;
    events.push(e);
    const i = waiters.findIndex((w) => !w.type || w.type === e.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(e);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  const client: Client = {
    ws,
    events,
    next(type, timeoutMs = 2000) {
      const hit = events.find((e) => (!type || e.type === type) && !consumed.has(e));
      if (hit) {
        consumed.add(hit);
        return Promise.resolve(hit);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type ?? 'any event'}`)), timeoutMs);
        waiters.push({
          type,
          resolve: (e) => {
            clearTimeout(timer);
            consumed.add(e);
            resolve(e);
          },
        });
      });
    },
    send(e) {
      ws.send(JSON.stringify(e));
    },
    closed,
  };
  const consumed = new Set<WsServerEvent>();
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ws round trip', () => {
  it('authenticates the upgrade with the session cookie, says hello, delivers publishToUser to every socket of the user', async () => {
    const me = ctx.createUser();
    const c1 = await connect(me.id);
    const hello = await c1.next('hello');
    expect(hello).toEqual({ type: 'hello', userId: me.id, serverTime: expect.any(Number) });
    expect(isOnline(me.id)).toBe(true);
    const c2 = await connect(me.id);
    await c2.next('hello');
    expect(socketCountFor(me.id)).toBe(2);

    publishToUser(me.id, { type: 'orbit.new_post' });
    expect(await c1.next('orbit.new_post')).toEqual({ type: 'orbit.new_post' });
    expect(await c2.next('orbit.new_post')).toEqual({ type: 'orbit.new_post' });
    // the test tap still sees it (lib/testing.ts contract)
    expect(ctx.wsEventsFor(me.id).some((e) => e.type === 'orbit.new_post')).toBe(true);

    c1.ws.close();
    await c1.closed;
    await settle();
    expect(socketCountFor(me.id)).toBe(1);
    expect(isOnline(me.id)).toBe(true);
    c2.ws.close();
    await c2.closed;
    await settle();
    expect(isOnline(me.id)).toBe(false);
  });

  it('rejects upgrades without a valid session (401) and for non-active accounts', async () => {
    const me = ctx.createUser();
    await expect(connect(me.id, { cookie: null })).rejects.toThrow(/401/);
    await expect(connect(me.id, { cookie: `${SESSION_COOKIE}=not-a-token` })).rejects.toThrow(/401/);
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(me.id);
    await expect(connect(me.id)).rejects.toThrow(/401/);
    expect(isOnline(me.id)).toBe(false);
  });

  it('relays typing.set to accepted partners only — never inside a pending request, never across a block', async () => {
    const a = ctx.createUser({ displayName: 'Ava Stone' });
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const stranger = ctx.createUser();
    const dm = openDm(a, b.id).conversationId;
    const request = openDm(a, stranger.id).conversationId;
    const ca = await connect(a.id);
    const cb = await connect(b.id);
    const cs = await connect(stranger.id);
    await Promise.all([ca.next('hello'), cb.next('hello'), cs.next('hello')]);

    ca.send({ type: 'typing.set', conversationId: dm, isTyping: true });
    expect(await cb.next('typing')).toEqual({ type: 'typing', conversationId: dm, userId: a.id, displayName: 'Ava Stone', isTyping: true });
    ca.send({ type: 'typing.set', conversationId: request, isTyping: true });
    ca.send({ type: 'ping' });
    ca.send({ type: 'conversation.focus', conversationId: dm });
    await settle();
    expect(cs.events.filter((e) => e.type === 'typing')).toEqual([]);
    expect(ca.events.filter((e) => e.type === 'typing')).toEqual([]);

    // a message sent over HTTP-side code arrives live for the recipient
    sendMessage({ conversationId: dm, sender: a, kind: 'text', text: 'live!' });
    const live = await cb.next('message.new');
    expect(live).toMatchObject({ type: 'message.new', conversationId: dm, message: { text: 'live!', sender: { id: a.id } } });
    expect(await cb.next('badges')).toMatchObject({ type: 'badges', badges: { messages: 1 } });

    ctx.db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(b.id, a.id, 1);
    ca.send({ type: 'typing.set', conversationId: dm, isTyping: false });
    await settle();
    expect(cb.events.filter((e) => e.type === 'typing').length).toBe(1);
  });

  it('answers presence.subscribe only for accepted DM partners with showPresence, bucketed to 5 min', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const stranger = ctx.createUser();
    openDm(a, b.id);
    ctx.db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(1_800_000_123_456, b.id);
    expect(canSeePresence(a.id, b.id)).toBe(true);
    expect(canSeePresence(a.id, stranger.id)).toBe(false);
    expect(presenceOf(b.id)).toEqual({ online: false, lastActiveAt: 1_800_000_000_000 });

    const ca = await connect(a.id);
    await ca.next('hello');
    ca.send({ type: 'presence.subscribe', userIds: [b.id, stranger.id, a.id] });
    expect(await ca.next('presence')).toEqual({ type: 'presence', userId: b.id, online: false, lastActiveAt: 1_800_000_000_000 });
    const cb = await connect(b.id);
    await cb.next('hello');
    expect(await ca.next('presence')).toMatchObject({ type: 'presence', userId: b.id, online: true });
    await settle();
    expect(ca.events.filter((e) => e.type === 'presence' && e.userId !== b.id)).toEqual([]);

    ctx.db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify({ showPresence: false }), b.id);
    const ca2 = await connect(a.id);
    await ca2.next('hello');
    ca2.send({ type: 'presence.subscribe', userIds: [b.id] });
    await settle();
    expect(ca2.events.filter((e) => e.type === 'presence')).toEqual([]);
  });

  it('revokeUserSockets sends session.revoked and closes every socket of the user', async () => {
    const me = ctx.createUser();
    const c = await connect(me.id);
    await c.next('hello');
    revokeUserSockets(me.id, 'logout');
    expect(await c.next('session.revoked')).toEqual({ type: 'session.revoked', reason: 'logout' });
    const closed = await c.closed;
    expect(closed.code).toBe(4001);
    await settle();
    expect(isOnline(me.id)).toBe(false);
    // POST /auth/logout goes through the same path
    const again = await connect(me.id);
    await again.next('hello');
    const res = await ctx.as(me.id).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(await again.next('session.revoked')).toEqual({ type: 'session.revoked', reason: 'logout' });
    await again.closed;
  });

  it('ignores malformed frames and keeps serving', async () => {
    const me = ctx.createUser();
    const c = await connect(me.id);
    await c.next('hello');
    c.ws.send('not json');
    c.ws.send(JSON.stringify({ nope: 1 }));
    c.ws.send(JSON.stringify({ type: 'typing.set', conversationId: 42, isTyping: 'yes' }));
    c.ws.send(JSON.stringify({ type: 'presence.subscribe', userIds: 'x' }));
    await settle();
    publishToUser(me.id, { type: 'badges', badges: { notifications: 0, messages: 0, requests: 0 } });
    expect(await c.next('badges')).toMatchObject({ type: 'badges' });
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });
});
