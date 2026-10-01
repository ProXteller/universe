/**
 * Core seed (SPEC §7): universities + campus places, 40 personas, 12 orgs, 3 staff, background users, follows,
 * Maya's two `follow.new` notifications. Deterministic (kit.rng, PRNG seed 20260921); works at `full` and `lite`.
 * Every denormalised counter equals its rows. Never seeds real people, professors, businesses or Greek chapters.
 */
import crypto from 'node:crypto';
import { GUIDELINES_VERSION, MAJORS } from '@shared/core';
import { DAY, HOUR, MIN } from '../../lib/clock';
import { refreshSeedUsers, type SeedKit } from '../../lib/seedKit';
import { GENERIC_MEETUPS, GENERIC_NEIGHBORHOODS, invalidateUniversityCache } from '../../lib/universities';
import {
  BG_BIOS, BG_INTERESTS, CAMPUSES, EXPLICIT_FOLLOWS, FIRST_NAMES, LAST_NAMES, MAYA_BG_FOLLOWERS, MAYA_EXTRA_FOLLOWERS,
  MAYA_FOLLOWS_ORGS, MAYA_FOLLOWS_PERSONAS, MAYA_INVITED_BG, ORGS, PERSONAS, STAFF_MEMBERS, UT_PLACES,
  type CampusDef, type CampusKey, type Standing,
} from './core-data';
import { bgId, MAYA_INVITE_CODE, ORG, STAFF, U, UNI } from './ids';

interface NewUser {
  id: string;
  email: string;
  handle: string;
  name: string;
  campus: CampusKey;
  accountType: 'student' | 'org';
  role: 'user' | 'moderator' | 'admin';
  bio: string;
  major: string | null;
  classYear: number | null;
  classKind: 'undergrad' | 'grad' | null;
  pronouns: string | null;
  interests: string[];
  orgCategory: string | null;
  verified: boolean;
  isAdult: boolean;
  createdAt: number;
  invitedBy: string | null;
  inviteCode: string;
  kind: 'persona' | 'org' | 'staff' | 'bg';
}

const ACADEMIC_YEAR_ROLLOVER_MONTH = 7; // August (0-based): seniors graduate the following calendar year

function emailLocal(name: string): string {
  const parts = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z]/g, ''))
    .filter(Boolean);
  return parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : (parts[0] ?? 'student');
}

function inviteCodeFor(id: string): string {
  const hex = crypto.createHash('sha1').update(`invite:${id}`).digest('hex');
  return BigInt(`0x${hex.slice(0, 14)}`).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
}

export default function seed(kit: SeedKit): void {
  const { db } = kit;
  const at = kit.now;
  const campusByKey = new Map<CampusKey, CampusDef>(CAMPUSES.map((c) => [c.key, c]));

  /* ───────────── universities + places ───────────── */
  const insUni = db.prepare(
    `INSERT OR IGNORE INTO universities (id, name, short_name, domain, extra_domains_json, country_code, city, is_auto_created, is_hidden, created_at)
     VALUES (?,?,?,?,?,?,?,0,0,?)`,
  );
  const insPlace = db.prepare('INSERT OR IGNORE INTO campus_places (id, university_id, kind, name, sort) VALUES (?,?,?,?,?)');
  for (const c of CAMPUSES) {
    const uniId = UNI[c.key];
    insUni.run(uniId, c.name, c.shortName, c.domain, JSON.stringify(c.extraDomains ?? []), c.cc, c.city, at - 420 * DAY);
    const places =
      c.key === 'utexas'
        ? UT_PLACES
        : { meetup: GENERIC_MEETUPS, neighborhood: GENERIC_NEIGHBORHOODS, venue: [] as readonly string[] };
    let n = 0;
    for (const kind of ['meetup', 'neighborhood', 'venue'] as const) {
      places[kind].forEach((name, i) => insPlace.run(`pl_${c.key}_${String(++n).padStart(2, '0')}`, uniId, kind, name, i));
    }
  }
  invalidateUniversityCache();

  /* ───────────── users ───────────── */
  const base = new Date(at);
  const seniorYear = base.getUTCFullYear() + (base.getUTCMonth() >= ACADEMIC_YEAR_ROLLOVER_MONTH ? 1 : 0);
  const classOf = (s: Standing): { year: number; kind: 'undergrad' | 'grad' } => {
    if (s === 'GR') return { year: seniorYear + 1, kind: 'grad' };
    return { year: seniorYear + { SR: 0, JR: 1, SO: 2, FR: 3 }[s], kind: 'undergrad' };
  };

  const users: NewUser[] = [];
  const takenHandles = new Set<string>();
  const takenEmails = new Set<string>();
  const push = (u: NewUser): void => {
    users.push(u);
    takenHandles.add(u.handle.toLowerCase());
    takenEmails.add(u.email.toLowerCase());
  };

  for (const p of PERSONAS) {
    const id = U[p.handle as keyof typeof U];
    const cls = classOf(p.standing);
    const domain = campusByKey.get(p.campus)!.domain;
    push({
      id, email: `${emailLocal(p.name)}@${domain}`, handle: p.handle, name: p.name, campus: p.campus, accountType: 'student',
      role: 'user', bio: p.bio, major: p.major, classYear: cls.year, classKind: cls.kind, pronouns: p.pronouns ?? null,
      interests: p.interests, orgCategory: null, verified: false, isAdult: p.isAdult ?? true,
      createdAt: p.ageHours !== undefined ? at - p.ageHours * HOUR : at - (p.ageDays ?? 120) * DAY - 37 * MIN,
      invitedBy: null, inviteCode: id === U.mayachen ? MAYA_INVITE_CODE : inviteCodeFor(id), kind: 'persona',
    });
  }
  for (const o of ORGS) {
    const id = ORG[o.handle as keyof typeof ORG];
    push({
      id, email: `${o.handle}@${campusByKey.get(o.campus)!.domain}`, handle: o.handle, name: o.name, campus: o.campus,
      accountType: 'org', role: 'user', bio: o.bio, major: null, classYear: null, classKind: null, pronouns: null,
      interests: [], orgCategory: o.category, verified: o.verified, isAdult: true, createdAt: at - o.ageDays * DAY - 11 * MIN,
      invitedBy: null, inviteCode: inviteCodeFor(id), kind: 'org',
    });
  }
  for (const s of STAFF_MEMBERS) {
    const id = STAFF[s.handle as keyof typeof STAFF];
    const cls = classOf(s.standing);
    push({
      id, email: s.email, handle: s.handle, name: s.name, campus: 'utexas', accountType: 'student', role: s.role, bio: s.bio,
      major: s.major, classYear: cls.year, classKind: cls.kind, pronouns: null, interests: [], orgCategory: null,
      verified: false, isAdult: true, createdAt: at - s.ageDays * DAY - 5 * MIN, invitedBy: null,
      inviteCode: inviteCodeFor(id), kind: 'staff',
    });
  }

  const standings: Standing[] = ['FR', 'FR', 'SO', 'SO', 'SO', 'JR', 'JR', 'JR', 'SR', 'SR', 'GR'];
  for (const c of CAMPUSES) {
    const count = c.bg[kit.scale];
    const domain = c.domain;
    for (let i = 0; i < count; i++) {
      const n = c.bgStart + i;
      const id = bgId(n);
      // Fixed number of rng draws per user (deterministic for a given scale).
      const first = kit.pick(FIRST_NAMES);
      const last = kit.pick(LAST_NAMES);
      const standing = kit.pick(standings);
      const major = kit.pick(MAJORS);
      const bio = kit.pick(BG_BIOS);
      const interests = kit.sample(BG_INTERESTS, kit.int(0, 3));
      const ageDays = kit.int(5, 330);
      const ageMin = kit.int(0, 1439);
      const name = `${first} ${last}`;

      let handle = `${first}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
      if (takenHandles.has(handle)) handle = `${handle.slice(0, 14)}${String(n % 100).padStart(2, '0')}`;
      if (takenHandles.has(handle)) handle = `${handle.slice(0, 12)}${n}`;
      let email = `${emailLocal(name)}@${domain}`;
      if (takenEmails.has(email)) email = `${emailLocal(name)}${n}@${domain}`;

      const invited = c.key === 'utexas' && i < MAYA_INVITED_BG;
      const cls = classOf(standing);
      push({
        id, email, handle, name, campus: c.key, accountType: 'student', role: 'user', bio, major, classYear: cls.year,
        classKind: cls.kind, pronouns: null, interests, orgCategory: null, verified: false, isAdult: true,
        createdAt: invited ? at - (12 + i * 9) * DAY - ageMin * MIN : at - ageDays * DAY - ageMin * MIN,
        invitedBy: invited ? U.mayachen : null, inviteCode: inviteCodeFor(id), kind: 'bg',
      });
    }
  }

  const insUser = db.prepare(
    `INSERT OR IGNORE INTO users (
       id, email, handle, display_name, avatar_url, avatar_seed, account_type, role, status, university_id, bio, major,
       class_year, class_kind, pronouns, interests_json, org_category, is_verified, is_adult, is_adult_edited, campus_rank,
       invite_code, invited_by, guidelines_version, guidelines_accepted_at, buzz_gate_version, buzz_gate_accepted_at,
       profile_completed_at, onboarding_completed_at, settings_json, last_active_at, created_at, updated_at)
     VALUES (?,?,?,?,NULL,?,?,?,'active',?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,'{}',?,?,?)`,
  );
  // invited_by references users(id): insert inviters first (personas come first in `users`, so plain order works).
  const rank = new Map<CampusKey, number>();
  const bucket = 5 * MIN;
  for (const u of users) {
    const r = (rank.get(u.campus) ?? 0) + 1;
    rank.set(u.campus, r);
    const onboardAt = u.createdAt + 4 * MIN;
    const activeAgo = u.kind === 'bg' ? kit.int(1, 10 * 24) * HOUR : kit.int(1, 40) * HOUR;
    const lastActive = Math.floor(Math.max(u.createdAt, at - activeAgo) / bucket) * bucket;
    insUser.run(
      u.id, u.email, u.handle, u.name, u.id, u.accountType, u.role, UNI[u.campus], u.bio, u.major, u.classYear, u.classKind,
      u.pronouns, JSON.stringify(u.interests), u.orgCategory, u.verified ? 1 : 0, u.isAdult ? 1 : 0, r, u.inviteCode,
      u.invitedBy, GUIDELINES_VERSION, onboardAt, GUIDELINES_VERSION, onboardAt + MIN, onboardAt, onboardAt + 2 * MIN,
      lastActive, u.createdAt, u.createdAt,
    );
  }
  refreshSeedUsers(kit);

  /* ───────────── follows ───────────── */
  const byId = new Map(users.map((u) => [u.id, u]));
  const edges = new Map<string, number>();
  const addEdge = (follower: string, followee: string, when?: number): void => {
    if (follower === followee) return;
    const key = `${follower}|${followee}`;
    if (edges.has(key)) return;
    const a = byId.get(follower);
    const b = byId.get(followee);
    if (!a || !b) return;
    const earliest = Math.max(a.createdAt, b.createdAt) + 10 * MIN;
    edges.set(key, when ?? Math.min(at - MIN, earliest + Math.floor(kit.rng() * Math.max(1, at - earliest))));
  };

  const maya = U.mayachen;
  const uid = (handle: string): string => U[handle as keyof typeof U];

  // Maya follows exactly 28; Maya has exactly 41 followers (§7.5). She is excluded from everything random below.
  for (const h of MAYA_FOLLOWS_ORGS) addEdge(maya, ORG[h]);
  for (const h of MAYA_FOLLOWS_PERSONAS) addEdge(maya, uid(h));
  for (const h of MAYA_FOLLOWS_PERSONAS) addEdge(uid(h), maya);
  // The Follow-back demo: they follow Maya, she does not follow them. samirk = unread follow.new, bencarter = read.
  const extraFollowedAt: Record<(typeof MAYA_EXTRA_FOLLOWERS)[number], number> = {
    samirk: at - 3 * HOUR, bencarter: at - 6 * DAY, owenpark: at - 19 * DAY,
  };
  for (const h of MAYA_EXTRA_FOLLOWERS) addEdge(uid(h), maya, extraFollowedAt[h]);
  for (let i = 0; i < MAYA_BG_FOLLOWERS; i++) addEdge(bgId(1 + i), maya);

  for (const [a, b] of EXPLICIT_FOLLOWS) addEdge(uid(a), uid(b));

  const students = users.filter((u) => u.accountType === 'student' && u.id !== maya);
  const fullStudentsAt = (campus: CampusKey): number =>
    PERSONAS.filter((p) => p.campus === campus).length + (campus === 'utexas' ? STAFF_MEMBERS.length : 0) + campusByKey.get(campus)!.bg.full;

  // students → orgs (clustered by campus)
  for (const o of ORGS) {
    const orgId = ORG[o.handle as keyof typeof ORG];
    const pSame = Math.min(0.93, o.followers / (fullStudentsAt(o.campus) * 1.09));
    const pOther = o.campus === 'utexas' ? Math.min(0.15, o.followers / 1500) : 0.01;
    for (const s of students) if (kit.chance(s.campus === o.campus ? pSame : pOther)) addEdge(s.id, orgId);
  }
  // orgs → a few sibling orgs on the same campus
  for (const o of ORGS) {
    for (const other of ORGS) {
      if (o.handle !== other.handle && o.campus === other.campus && kit.chance(0.3)) {
        addEdge(ORG[o.handle as keyof typeof ORG], ORG[other.handle as keyof typeof ORG]);
      }
    }
  }
  // students → students (campus + major clusters; a few prominent creators)
  const prominence: Record<string, number> = {
    [uid('aaliyah_w')]: 0.6, [uid('noahg')]: 0.4, [uid('jordan_builds')]: 0.28, [uid('oliviab')]: 0.24, [uid('diegoh')]: 0.2,
  };
  const globalCreators = new Set([uid('kaiyama'), uid('rafacruz'), uid('noahg'), uid('aaliyah_w')]);
  for (const a of students) {
    for (const b of students) {
      if (a.id === b.id) continue;
      let p: number;
      if (a.campus === b.campus) {
        p = prominence[b.id] ?? (b.kind === 'persona' ? 0.12 : b.kind === 'staff' ? 0.04 : 0.02);
        if (a.major && a.major === b.major) p += 0.1;
      } else {
        p = globalCreators.has(b.id) ? 0.08 : 0.004;
      }
      if (kit.chance(p)) addEdge(a.id, b.id);
    }
  }

  const insFollow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)');
  for (const [key, when] of edges) {
    const [follower, followee] = key.split('|') as [string, string];
    insFollow.run(follower, followee, when);
  }
  db.exec(`
    UPDATE users SET
      follower_count  = (SELECT COUNT(*) FROM follows f WHERE f.followee_id = users.id),
      following_count = (SELECT COUNT(*) FROM follows f WHERE f.follower_id = users.id)
  `);

  /* ───────────── Maya's core notifications: follow.new ×2 (1 unread) ───────────── */
  for (const [handle, when, read] of [['samirk', extraFollowedAt.samirk, false], ['bencarter', extraFollowedAt.bencarter, true]] as const) {
    kit.notify({
      userId: maya, type: 'follow.new', actorId: uid(handle), href: `/u/${handle}`,
      target: { entityType: 'user', entityId: uid(handle) }, collapse: false, createdAt: when, read,
    });
  }
}
