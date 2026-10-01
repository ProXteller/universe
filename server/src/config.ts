/**
 * Server configuration (SPEC §4.2.1). Read once at module load.
 * Secrets: production requires env (boot fails); otherwise generated once and persisted under server/data/
 * (in test: random per process). STAFF_EMAILS = comma-separated `email:role` pairs; malformed entries fail boot.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Env = 'development' | 'test' | 'production';
export type StaffRole = 'moderator' | 'admin';

export interface Config {
  env: Env;
  port: number;
  dbPath: string;
  uploadsDir: string;
  seedMediaDir: string;
  buzzAliasSecret: string;
  cursorSecret: string;
  resendApiKey: string | null;
  mailFrom: string;
  moderationAi: { apiKey: string | null; provider: string; model: string | null; timeoutMs: number };
  seedScale: 'full' | 'lite';
  sessionTtlDays: 30;
  staffEmails: ReadonlyMap<string, StaffRole>;
}

/** Absolute path of `server/`. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** `server/data/` — dev DB + persisted dev secrets (git-ignored). */
export const DATA_DIR = path.join(SERVER_ROOT, 'data');

function readEnv(): Env {
  const v = process.env.NODE_ENV;
  return v === 'production' ? 'production' : v === 'test' ? 'test' : 'development';
}

function nonEmpty(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function loadSecrets(env: Env): { buzzAliasSecret: string; cursorSecret: string } {
  const fromEnv = { buzz: nonEmpty(process.env.BUZZ_ALIAS_SECRET), cursor: nonEmpty(process.env.CURSOR_SECRET) };
  if (env === 'production') {
    if (!fromEnv.buzz || !fromEnv.cursor) {
      throw new Error('BUZZ_ALIAS_SECRET and CURSOR_SECRET are required in production');
    }
    if (fromEnv.buzz === fromEnv.cursor) throw new Error('CURSOR_SECRET must differ from BUZZ_ALIAS_SECRET');
    return { buzzAliasSecret: fromEnv.buzz, cursorSecret: fromEnv.cursor };
  }
  const random = (): string => crypto.randomBytes(32).toString('hex');
  if (env === 'test') {
    return { buzzAliasSecret: fromEnv.buzz ?? random(), cursorSecret: fromEnv.cursor ?? random() };
  }
  // development: generate once, persist under server/data/secrets.json
  const file = path.join(DATA_DIR, 'secrets.json');
  let stored: { buzzAliasSecret?: string; cursorSecret?: string } = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof stored;
  } catch {
    stored = {};
  }
  const out = {
    buzzAliasSecret: fromEnv.buzz ?? stored.buzzAliasSecret ?? random(),
    cursorSecret: fromEnv.cursor ?? stored.cursorSecret ?? random(),
  };
  if (stored.buzzAliasSecret !== out.buzzAliasSecret || stored.cursorSecret !== out.cursorSecret) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
    } catch {
      /* read-only FS: keep the in-memory secrets for this process */
    }
  }
  return out;
}

/** Exported for tests. Throws on any malformed entry (boot fails). */
export function parseStaffEmails(raw: string | undefined): Map<string, StaffRole> {
  const out = new Map<string, StaffRole>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const m = /^([^\s@:,]+@[^\s@:,]+\.[^\s@:,]+):(admin|moderator)$/i.exec(entry);
    if (!m) throw new Error(`STAFF_EMAILS: malformed entry "${entry}" (expected email:admin|moderator)`);
    const email = m[1]!.toLowerCase();
    const role = m[2]!.toLowerCase() as StaffRole;
    // An address the email gate can never match would boot fine and leave the staff member locked out.
    if (!isGateValidEmail(email)) throw new Error(`STAFF_EMAILS: "${email}" is not an address the sign-in gate accepts`);
    const prev = out.get(email);
    if (prev && prev !== role) throw new Error(`STAFF_EMAILS: "${email}" is listed with conflicting roles (${prev}, ${role})`);
    out.set(email, role);
  }
  return out;
}

/**
 * Same address rules as `lib/universities.ts` parseEmailOrDomain (ASCII local part without leading / trailing / double
 * dots, LDH domain labels, alphabetic TLD, no trailing dot). Duplicated here because universities.ts imports config.
 */
const STAFF_DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const STAFF_LOCAL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
function isGateValidEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!STAFF_LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return STAFF_DOMAIN_RE.test(domain);
}

function build(): Config {
  const env = readEnv();
  const secrets = loadSecrets(env);
  const port = Number(process.env.PORT ?? 4000);
  const timeoutMs = Number(process.env.MODERATION_AI_TIMEOUT_MS ?? 4000);
  const scale = nonEmpty(process.env.SEED_SCALE);
  return {
    env,
    port: Number.isFinite(port) && port > 0 ? port : 4000,
    dbPath: nonEmpty(process.env.DB_PATH) ?? path.join(DATA_DIR, 'universe.db'),
    // production keeps uploads next to the database on the data disk (UPLOADS_DIR), never inside a release folder
    uploadsDir: nonEmpty(process.env.UPLOADS_DIR) ?? path.join(SERVER_ROOT, 'uploads'),
    seedMediaDir: path.join(SERVER_ROOT, 'seed-media'),
    buzzAliasSecret: secrets.buzzAliasSecret,
    cursorSecret: secrets.cursorSecret,
    resendApiKey: nonEmpty(process.env.RESEND_API_KEY),
    mailFrom: nonEmpty(process.env.MAIL_FROM) ?? 'UniVerse <no-reply@universe.invalid>',
    moderationAi: {
      apiKey: nonEmpty(process.env.MODERATION_AI_API_KEY),
      provider: nonEmpty(process.env.MODERATION_AI_PROVIDER) ?? 'anthropic',
      model: nonEmpty(process.env.MODERATION_AI_MODEL),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 4000,
    },
    seedScale: scale === 'full' || scale === 'lite' ? scale : env === 'test' ? 'lite' : 'full',
    sessionTtlDays: 30,
    staffEmails: parseStaffEmails(process.env.STAFF_EMAILS),
  };
}

/**
 * A plain object on purpose: tests flip `env` / `staffEmails` / `resendApiKey` through `overrideConfig()`
 * (lib/testing.ts) instead of re-importing the module graph.
 */
export const config: Config = build();
