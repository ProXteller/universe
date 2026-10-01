/**
 * Minimal logger + request logger (SPEC §4.2.15, §3.2 #7).
 * - `log.info` is silent in tests; warn/error always print.
 * - The request logger records ONLY method + route template + status + duration. It never logs query strings,
 *   bodies, cookies or concrete ids for `/api/buzz/**` and `/api/admin/**` (anonymity firewall).
 */
import type { NextFunction, Request, Response } from 'express';
import { now } from './clock';

const env = process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';

function fmt(args: unknown[]): unknown[] {
  return args.map((a) => (a instanceof Error ? describeError(a) : a));
}

/** Name + message (+ stack outside production). Never rows, never bodies. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const head = `${err.name}${typeof code === 'string' ? `(${code})` : ''}: ${err.message}`;
    return env === 'production' || !err.stack ? head : `${head}\n${err.stack.split('\n').slice(1, 8).join('\n')}`;
  }
  return String(err);
}

export const log = {
  info(...args: unknown[]): void {
    if (env === 'test') return;
    console.log('[info]', ...fmt(args));
  },
  warn(...args: unknown[]): void {
    console.warn('[warn]', ...fmt(args));
  },
  error(...args: unknown[]): void {
    console.error('[error]', ...fmt(args));
  },
};

const SENSITIVE_PREFIXES = ['/api/buzz', '/api/admin'];

/**
 * What the request line shows. Under a sensitive prefix only the prefix + `/*` (never a thread / queue id);
 * elsewhere the concrete path without its query string. (`req.route` / `req.baseUrl` are already unwound by the
 * time `finish` fires, so the template is reconstructed from the prefix table instead.)
 */
function routeTemplate(req: Request): string {
  const path = (req.originalUrl || req.url || '').split('?')[0] ?? '';
  const sensitive = SENSITIVE_PREFIXES.find((p) => path === p || path.startsWith(`${p}/`));
  return sensitive ? `${sensitive}/*` : path;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (env === 'test') return next();
  const started = now();
  res.on('finish', () => {
    const path = (req.originalUrl || '').split('?')[0] ?? '';
    if (!path.startsWith('/api')) return;
    log.info(`${req.method} ${routeTemplate(req)} ${res.statusCode} ${now() - started}ms`);
  });
  next();
}
