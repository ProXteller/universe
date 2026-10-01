/**
 * HARDENING — re-gate lens: test-harness transport (regression guard; every test here passes).
 *
 * The flake it guards: random requests in random files failed with `Parse Error: Expected HTTP/` (also stray 401s and
 * ETIMEDOUT), about 1 run in 5 even with the file run alone. Root cause: `supertest.agent(app)` makes supertest call
 * `app.listen(0)`, which binds the dual-stack WILDCARD (`::`), and then dials `127.0.0.1:<port>`. On macOS that wildcard
 * bind succeeds on a port ANOTHER process already holds on 127.0.0.1, and the more specific loopback listener answers
 * our request. `createTestApp` now binds its server to 127.0.0.1 explicitly, which the kernel refuses on an occupied port.
 * Request semantics are unchanged (superagent's one `Connection: close` connection per request).
 */
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { APP_NAME } from '@shared/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../../src/lib/testing';

function serverBehind(agent: unknown): http.Server {
  return (agent as { app: http.Server }).app;
}

describe('harness transport', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  it('[probe] every as() / anon() agent targets a server bound to 127.0.0.1, never the wildcard', () => {
    for (const agent of [ctx.anon(), ctx.as('u_mayachen')]) {
      const server = serverBehind(agent);
      expect(server).toBeInstanceOf(http.Server);
      const addr = server.address() as AddressInfo | null;
      expect(addr?.address).toBe('127.0.0.1');
    }
  });

  it('[probe] a port a foreign process holds on 127.0.0.1 is refused to the harness bind, and harness requests reach our app', async () => {
    // A foreign NON-HTTP loopback listener: exactly what produced `Parse Error: Expected HTTP/`.
    const foreign = net.createServer((s) => s.end('SSH-2.0-not-http\r\n'));
    await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve));
    const port = (foreign.address() as AddressInfo).port;
    try {
      // The bind the harness uses (explicit loopback) is refused on that port, so ephemeral allocation skips it.
      const probe = http.createServer();
      const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        probe.once('error', resolve);
        probe.listen(port, '127.0.0.1', () => resolve(null));
      });
      if (!err) probe.close();
      expect(err?.code).toBe('EADDRINUSE');

      // Many sequential requests (fresh agents, as tests do) all land on OUR app with a well-formed HTTP response.
      for (let i = 0; i < 50; i++) {
        const res = await (i % 2 ? ctx.anon() : ctx.as('u_mayachen')).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, name: APP_NAME });
      }
      expect(serverBehind(ctx.anon()).address()).not.toBeNull(); // supertest never closed the shared server
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});
