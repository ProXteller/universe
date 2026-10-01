/**
 * Express app factory (Constitution §2/§4, SPEC §4.3). `createApp(apiRouter)` takes the API router so the test
 * harness can pass an isolation-mode router; `index.ts` passes the static `routes/index.ts`.
 *
 * Shared between lanes (DECISIONS D1): surgical Edit only, re-Read right before editing, never overwrite.
 */
import cookieParser from 'cookie-parser';
import express, { type Express, type Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config';
import { errorMiddleware, notFoundMiddleware } from './lib/http';
import { log, requestLogger } from './lib/logger';
import { installQuietHours } from './lib/quietHours';

const JSON_BODY_LIMIT = '1mb';

/**
 * Reverse-proxy hops whose `X-Forwarded-For` entries feed `req.ip` — the key of both IP limiters below.
 * Development / test: exactly one (the Vite proxy, Constitution §2). Production: `TRUST_PROXY` (a hop count; unset
 * or 0 = the API is reached directly and the header is ignored). Trusting a hop that does not exist would let any
 * client mint a fresh limiter bucket per request with a forged header, so production never assumes one.
 */
function trustProxyHops(): number {
  if (config.env !== 'production') return 1;
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) {
    log.warn('TRUST_PROXY is unset: X-Forwarded-For is ignored. Behind a reverse proxy set TRUST_PROXY=1 (hop count), or every client shares one rate-limit bucket.');
    return 0;
  }
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) throw new Error(`TRUST_PROXY must be a non-negative hop count, got "${raw}"`);
  return hops;
}

export function createApp(apiRouter: Router): Express {
  installQuietHours(); // notify(): only `{ type:'badges' }` over ws inside the recipient's quiet hours (S-M3, T2)
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops());
  app.set('etag', false);

  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA + Vite dev server own the CSP; the API only serves JSON / media
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(requestLogger);

  // IP-level limiter: auth routes 10/min, everything else 300/min (SPEC §4.3). Off in tests unless RATE_LIMITS=on.
  const limitersOn = config.env !== 'test' || process.env.RATE_LIMITS === 'on';
  if (limitersOn) {
    const json429 = { error: { code: 'rate_limited', message: "You're going fast. Try again in a minute." } };
    app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: json429 }));
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: json429 }));
  }

  // Static media: user uploads (nosniff, inline) and seed media.
  const staticOpts = {
    fallthrough: true,
    index: false,
    setHeaders: (res: express.Response) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      // defence in depth: a stored file can never run script or load anything, even if opened as a document
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    },
  };
  app.use('/uploads/tmp', notFoundMiddleware); // the uploads temp dir is never served
  app.use('/uploads', express.static(config.uploadsDir, { ...staticOpts, maxAge: '7d' }));
  app.use('/seed-media', express.static(config.seedMediaDir, { ...staticOpts, maxAge: '1d' }));

  app.use('/api', apiRouter);
  app.use('/api', notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
