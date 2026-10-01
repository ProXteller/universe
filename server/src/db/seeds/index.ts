/**
 * Seed registry (SPEC §4.2.2 / §4.6): all twelve seeds in NN order, each behind a DYNAMIC `import()` so a half-written
 * seed in one slice can never break another slice's tests. `runSeeds()` (db/index.ts) runs one transaction per seed.
 */
import type { SeedKit } from '../../lib/seedKit';

export interface SeedModule {
  default: (kit: SeedKit) => void;
}

export interface SeedEntry {
  /** File stem, e.g. '00-core', '08-market'. */
  name: string;
  load: () => Promise<SeedModule>;
}

export const SEEDS: readonly SeedEntry[] = [
  { name: '00-core', load: () => import('./00-core') },
  { name: '01-auth', load: () => import('./01-auth') },
  { name: '02-reels', load: () => import('./02-reels') },
  { name: '03-buzz', load: () => import('./03-buzz') },
  { name: '04-orbit', load: () => import('./04-orbit') },
  { name: '05-discover', load: () => import('./05-discover') },
  { name: '06-messages', load: () => import('./06-messages') },
  { name: '07-roommates', load: () => import('./07-roommates') },
  { name: '08-market', load: () => import('./08-market') },
  { name: '09-campus', load: () => import('./09-campus') },
  { name: '10-apartments', load: () => import('./10-apartments') },
  { name: '11-admin', load: () => import('./11-admin') },
];
