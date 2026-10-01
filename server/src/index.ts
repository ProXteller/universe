/**
 * Boot (SPEC §4.2.2): tables already exist (db/index.ts migrated at module load) → seed when `users` is empty and
 * env ≠ production → production checks (§4.2.1) → listen + attach ws.
 *
 * Shared between lanes (DECISIONS D1): surgical Edit only, re-Read right before editing, never overwrite.
 */
import http from 'node:http';
import { config } from './config';
import { db, runSeeds } from './db/index';
import { createApp } from './app';
import { log } from './lib/logger';
import { mailProviderConfigured } from './lib/mailer';
import { attachRealtime } from './lib/realtime';
import { ensureEventCovers } from './lib/seedArt';
import apiRouter from './routes/index';

async function main(): Promise<void> {
  ensureEventCovers();

  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0 && config.env !== 'production') {
    log.info(`empty database → running seeds (SEED_SCALE=${config.seedScale})`);
    await runSeeds();
  }

  if (config.env === 'production') {
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;
    if (admins === 0 && config.staffEmails.size === 0) log.error('Buzz is unmonitored: set STAFF_EMAILS');
    if (!mailProviderConfigured()) log.error('sign-up is disabled: set RESEND_API_KEY');
  }

  const app = createApp(apiRouter);
  const server = http.createServer(app);
  attachRealtime(server);

  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  log.info(`UniVerse API listening on http://localhost:${config.port} (${config.env})`);

  const shutdown = (): void => {
    log.info('shutting down');
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('boot failed', err);
  process.exit(1);
});
