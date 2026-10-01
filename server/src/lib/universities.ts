/**
 * University email gate (Constitution §6, SPEC §4.2.15).
 *
 * Accept: bundled dataset (suffix match) · generic academic patterns `*.edu`, `*.edu.<cc>`, `*.ac.<cc>` ·
 * allow-list of well-known non-pattern domains. Reject personal / disposable providers with friendly copy.
 * Unknown-but-valid academic domains auto-create a campus. Exact `STAFF_EMAILS` addresses bypass the domain
 * check (still OTP) and, when their domain is not academic, attach to the hidden campus `uni_team`.
 */
import type { DomainLookupResponse, Id, UniversityRef } from '@shared/core';
import { CURRENCY_BY_COUNTRY, DEFAULT_CURRENCY } from '@shared/core';
import { config } from '../config';
import { db, newId, onDbReady, prep, tx, json } from '../db/index';
import { now } from './clock';
import { ACADEMIC_ALLOW_LIST } from './data/academicAllowList';
import { DISPOSABLE_DOMAINS } from './data/disposableDomains';
import { PERSONAL_DOMAINS } from './data/personalDomains';
import { UNIVERSITIES, type UniversityDatum } from './data/universities';

export interface UniversityRow {
  id: Id;
  name: string;
  short_name: string;
  domain: string;
  extra_domains_json: string;
  country_code: string;
  city: string | null;
  is_auto_created: number;
  is_hidden: number;
  created_at: number;
}

export const TEAM_UNIVERSITY_ID = 'uni_team';
const TEAM_UNIVERSITY = { name: 'UniVerse Team', shortName: 'Team', domain: 'team.universe.invalid' } as const;

export const GENERIC_MEETUPS = ['Main library lobby', 'Student union front desk', 'Campus police safe-exchange zone'] as const;
export const GENERIC_NEIGHBORHOODS = ['On campus', 'Near campus'] as const;

/** Friendly copy (product §1.2, verbatim where product defines it). */
export const EMAIL_COPY = {
  personal: "That's a personal email. UniVerse is students-only, so we need your university address.",
  disposable: "Temporary inboxes can't be verified. Use your university email.",
  malformed: "Something's off with that address. Check it and try again.",
  notAcademic:
    "That doesn't look like a university address. We accept .edu, .edu.xx and .ac.xx addresses plus a list of known university domains worldwide.",
  alumni: "Alumni addresses aren't supported yet. Use your current university address.",
  newCampus: (domain: string): string => `New campus — you'll be the first from ${domain}.`,
} as const;

/* ───────────────────────────── parsing ───────────────────────────── */

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LOCAL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Full address → `{ local, domain }`; bare domain → `{ local: null, domain }`; malformed → null. */
function parseEmailOrDomain(input: string): { local: string | null; domain: string } | null {
  const s = normalizeEmail(input);
  if (!s) return null;
  const at = s.lastIndexOf('@');
  if (at === -1) return DOMAIN_RE.test(s) ? { local: null, domain: s } : null;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (!DOMAIN_RE.test(domain)) return null;
  return { local, domain };
}

export function isValidEmail(email: string): boolean {
  const p = parseEmailOrDomain(email);
  return !!p && p.local !== null;
}

/** `a.b.c.edu` → ['a.b.c.edu', 'b.c.edu', 'c.edu'] (never the bare TLD). */
function suffixes(domain: string): string[] {
  const labels = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  return out;
}

function inSet(domain: string, set: ReadonlySet<string>): boolean {
  return suffixes(domain).some((s) => set.has(s));
}

/** Registrable academic domain for a pattern match, or null: `cs.foo.edu` → `foo.edu`; `x.foo.ac.uk` → `foo.ac.uk`. */
function academicPatternDomain(domain: string): string | null {
  const labels = domain.split('.');
  const n = labels.length;
  if (n >= 2 && labels[n - 1] === 'edu') return labels.slice(n - 2).join('.');
  if (n >= 3 && /^[a-z]{2}$/.test(labels[n - 1]!) && (labels[n - 2] === 'edu' || labels[n - 2] === 'ac')) {
    return labels.slice(n - 3).join('.');
  }
  return null;
}

function allowListDomain(domain: string): string | null {
  return suffixes(domain).find((s) => ACADEMIC_ALLOW_LIST.has(s)) ?? null;
}

export function isAcademicDomain(domain: string): boolean {
  return academicPatternDomain(domain) !== null || allowListDomain(domain) !== null || datasetMatch(domain) !== null;
}

/* ───────────────────────────── dataset + DB indexes ───────────────────────────── */

const datasetByDomain = new Map<string, UniversityDatum>();
for (const u of UNIVERSITIES) {
  datasetByDomain.set(u.domain, u);
  for (const d of u.extraDomains) datasetByDomain.set(d, u);
}

function datasetMatch(domain: string): UniversityDatum | null {
  for (const s of suffixes(domain)) {
    const hit = datasetByDomain.get(s);
    if (hit) return hit;
  }
  return null;
}

let dbDomains: Map<string, UniversityRow> | null = null;
const rowCache = new Map<Id, UniversityRow>();

/** Call after writing `universities` with direct SQL (seeds). Also runs after every migrate / resetDb. */
export function invalidateUniversityCache(): void {
  dbDomains = null;
  rowCache.clear();
}
const invalidate = invalidateUniversityCache;
onDbReady(invalidate);

function dbIndex(): Map<string, UniversityRow> {
  if (dbDomains) return dbDomains;
  const map = new Map<string, UniversityRow>();
  const rows = prep('SELECT * FROM universities').all() as UniversityRow[];
  for (const r of rows) {
    map.set(r.domain.toLowerCase(), r);
    for (const d of json<string[]>(r.extra_domains_json, [])) map.set(String(d).toLowerCase(), r);
  }
  dbDomains = map;
  return map;
}

function dbMatch(domain: string, exactOnly = false): UniversityRow | null {
  const idx = dbIndex();
  for (const s of exactOnly ? [domain] : suffixes(domain)) {
    const hit = idx.get(s);
    if (hit && !hit.is_hidden) return hit;
  }
  return null;
}

export function getUniversityRow(id: Id): UniversityRow | null {
  const cached = rowCache.get(id);
  if (cached) return cached;
  const row = prep('SELECT * FROM universities WHERE id = ?').get(id) as UniversityRow | undefined;
  if (row) rowCache.set(id, row);
  return row ?? null;
}

const refOf = (r: { id: Id; name: string; short_name: string }): UniversityRef => ({
  id: r.id,
  name: r.name,
  shortName: r.short_name,
});

export function currencyFor(countryCode: string | null | undefined): string {
  return (countryCode && CURRENCY_BY_COUNTRY[countryCode.toUpperCase()]) || DEFAULT_CURRENCY;
}

/* ───────────────────────────── classification ───────────────────────────── */

type Classified =
  | { status: 'invalid'; domain: string; message: string }
  | { status: 'personal' | 'disposable'; domain: string; message: string }
  | { status: 'known'; domain: string; row: UniversityRow | null; datum: UniversityDatum | null; team: boolean }
  | { status: 'new'; domain: string; registrable: string };

function isStaffEmail(email: string | null): boolean {
  return !!email && config.staffEmails.has(email);
}

function hasAlumniLabel(domain: string): boolean {
  return domain.split('.').some((l) => l === 'alumni' || l === 'alum' || l === 'alumnae' || l === 'alumnus');
}

function classify(input: string): Classified {
  const parsed = parseEmailOrDomain(input);
  if (!parsed) return { status: 'invalid', domain: '', message: EMAIL_COPY.malformed };
  const { local, domain } = parsed;
  const email = local === null ? null : `${local}@${domain}`;
  const staff = isStaffEmail(email);

  if (!staff) {
    if (inSet(domain, DISPOSABLE_DOMAINS)) return { status: 'disposable', domain, message: EMAIL_COPY.disposable };
    if (inSet(domain, PERSONAL_DOMAINS)) return { status: 'personal', domain, message: EMAIL_COPY.personal };
  }

  // An exactly-listed domain wins over the alumni rule (e.g. Copenhagen students really use alumni.ku.dk).
  const exactRow = dbMatch(domain, true);
  const exactDatum = datasetByDomain.get(domain) ?? null;
  if (exactRow || exactDatum) return { status: 'known', domain, row: exactRow, datum: exactDatum, team: false };

  if (!staff && hasAlumniLabel(domain)) return { status: 'invalid', domain, message: EMAIL_COPY.alumni };

  const row = dbMatch(domain);
  if (row) return { status: 'known', domain, row, datum: null, team: false };
  const datum = datasetMatch(domain);
  if (datum) {
    // The dataset campus may already exist in the DB under its primary domain.
    return { status: 'known', domain, row: dbMatch(datum.domain, true), datum, team: false };
  }

  const registrable = allowListDomain(domain) ?? academicPatternDomain(domain);
  if (registrable) return { status: 'new', domain, registrable };

  if (staff) return { status: 'known', domain, row: null, datum: null, team: true };
  return { status: 'invalid', domain, message: EMAIL_COPY.notAcademic };
}

/** Always answers (never throws). `emailOrDomain` may be a full address or a bare domain. */
export function lookupDomain(emailOrDomain: string): DomainLookupResponse {
  const c = classify(emailOrDomain);
  switch (c.status) {
    case 'invalid':
    case 'personal':
    case 'disposable':
      return { status: c.status, domain: c.domain, university: null, message: c.message };
    case 'new':
      return { status: 'new', domain: c.domain, university: null, message: EMAIL_COPY.newCampus(c.registrable) };
    case 'known': {
      const university: UniversityRef = c.row
        ? refOf(c.row)
        : c.datum
          ? { id: `uni_${c.datum.key}`, name: c.datum.name, shortName: c.datum.shortName }
          : { id: TEAM_UNIVERSITY_ID, name: TEAM_UNIVERSITY.name, shortName: TEAM_UNIVERSITY.shortName };
      return { status: 'known', domain: c.domain, university, message: null };
    }
  }
}

/* ───────────────────────────── creation ───────────────────────────── */

function titleCase(label: string): string {
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w.length <= 4 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

function guessCountry(domain: string): string {
  const tld = domain.split('.').pop() ?? '';
  if (tld === 'edu') return 'US';
  if (tld === 'uk') return 'GB';
  return /^[a-z]{2}$/.test(tld) ? tld.toUpperCase() : 'US';
}

/** Generic campus places every non-seeded campus starts with (SPEC §4.1). */
export function insertGenericPlaces(universityId: Id): void {
  const ins = prep('INSERT INTO campus_places (id, university_id, kind, name, sort) VALUES (?,?,?,?,?)');
  GENERIC_MEETUPS.forEach((name, i) => ins.run(newId(), universityId, 'meetup', name, i));
  GENERIC_NEIGHBORHOODS.forEach((name, i) => ins.run(newId(), universityId, 'neighborhood', name, i));
}

function insertUniversity(u: {
  id: Id; name: string; shortName: string; domain: string; extraDomains?: string[]; countryCode: string;
  city: string | null; isAutoCreated: boolean; isHidden?: boolean; places?: boolean;
}): UniversityRow {
  return tx(() => {
    prep(
      `INSERT INTO universities (id, name, short_name, domain, extra_domains_json, country_code, city, is_auto_created, is_hidden, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      u.id, u.name, u.shortName, u.domain, JSON.stringify(u.extraDomains ?? []), u.countryCode, u.city,
      u.isAutoCreated ? 1 : 0, u.isHidden ? 1 : 0, now(),
    );
    if (u.places !== false) insertGenericPlaces(u.id);
    invalidate();
    return db.prepare('SELECT * FROM universities WHERE id = ?').get(u.id) as UniversityRow;
  });
}

/** Hidden staff-bootstrap campus, created lazily (SPEC §4.1 / §4.2.15). */
export function ensureTeamUniversity(): UniversityRow {
  const existing = getUniversityRow(TEAM_UNIVERSITY_ID);
  if (existing) return existing;
  return insertUniversity({
    id: TEAM_UNIVERSITY_ID, name: TEAM_UNIVERSITY.name, shortName: TEAM_UNIVERSITY.shortName,
    domain: TEAM_UNIVERSITY.domain, countryCode: 'US', city: null, isAutoCreated: false, isHidden: true, places: false,
  });
}

/**
 * Resolves (and, when needed, creates) the campus for an address that already PASSED the gate.
 * Throws when the address is not acceptable — callers check `lookupDomain()` first.
 */
export function resolveUniversityForEmail(email: string): { university: UniversityRow; isNew: boolean } {
  const c = classify(email);
  if (c.status === 'known') {
    if (c.row) return { university: c.row, isNew: false };
    if (c.datum) {
      const d = c.datum;
      const row = insertUniversity({
        id: `uni_${d.key}`, name: d.name, shortName: d.shortName, domain: d.domain, extraDomains: d.extraDomains,
        countryCode: d.countryCode, city: d.city, isAutoCreated: false,
      });
      return { university: row, isNew: false };
    }
    return { university: ensureTeamUniversity(), isNew: false };
  }
  if (c.status === 'new') {
    const existing = dbMatch(c.registrable, true);
    if (existing) return { university: existing, isNew: false };
    const label = c.registrable.split('.')[0] ?? c.registrable;
    const name = titleCase(label) || c.registrable;
    const row = insertUniversity({
      id: newId(), name, shortName: name, domain: c.registrable, countryCode: guessCountry(c.registrable),
      city: null, isAutoCreated: true,
    });
    return { university: row, isNew: true };
  }
  throw new Error(`resolveUniversityForEmail: address is not acceptable (${c.status})`);
}

/**
 * What `/auth/start` shows BEFORE the address is verified: nothing is created yet (a campus record is only
 * auto-created once the code proves control of the address), so a new campus gets a provisional ref.
 */
export function previewUniversityForEmail(email: string): UniversityRef & { isNew: boolean } {
  const c = classify(email);
  if (c.status === 'new') {
    const label = c.registrable.split('.')[0] ?? c.registrable;
    const name = titleCase(label) || c.registrable;
    return { id: 'uni_pending', name, shortName: name, isNew: true };
  }
  const looked = lookupDomain(email);
  if (looked.university) return { ...looked.university, isNew: false };
  throw new Error(`previewUniversityForEmail: address is not acceptable (${c.status})`);
}
