/**
 * roommate_profiles rows → API shapes + the visibility rule (SPEC §5.7, binding):
 * a profile is visible to anyone but its owner ONLY when `published_at IS NOT NULL` (and status 'active', not paused).
 * Every reader here (browse, saved, detail, card resolver, adapter) ANDs that in.
 */
import type { ClassKind, ContentStatus, EpochMs, Id, MediaImage } from '@shared/core';
import type {
  Compatibility, LivingWith, MyRoommateProfile, RoommateAnswers, RoommateCard, RoommateDetail, RoommateGender, RoommateMode,
  RoommatePlace,
} from '@shared/roommates';
import { json, prep } from '../../db/index';
import { DAY, now } from '../../lib/clock';
import { sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { getUserRow, NEW_ACCOUNT_CHIP_MS, toUserSummary, type UserRow } from '../../lib/users';
import { archetypeOf, computeCompatibility, isAnswers, tagsOf, type CompatParty } from './compat';

export const STILL_LOOKING_AFTER_MS = 30 * DAY;
export const AUTO_PAUSE_AFTER_MS = 60 * DAY;
/** Best-match ranking is computed in memory over the campus set; this is the safety cap of that set. */
export const CAMPUS_SET_CAP = 500;

export interface ProfileRow {
  id: Id;
  user_id: Id;
  university_id: Id;
  mode: RoommateMode | null;
  budget: number | null;
  move_in: string | null;
  lease_months: number | null;
  neighborhoods_json: string;
  living_with: LivingWith;
  gender: RoommateGender | null;
  about: string;
  photos_json: string;
  place_json: string | null;
  answers_json: string;
  dealbreak_smoking: number;
  dealbreak_pets: number;
  archetype: string;
  status: ContentStatus;
  auto_hide_immune: number;
  paused: number;
  low_price_flag: number;
  published_at: EpochMs | null;
  confirmed_at: EpochMs | null;
  created_at: EpochMs;
  updated_at: EpochMs;
}

/* ───────────────────────────── loaders ───────────────────────────── */

export function getProfileRow(id: Id): ProfileRow | null {
  return (prep('SELECT * FROM roommate_profiles WHERE id = ?').get(id) as ProfileRow | undefined) ?? null;
}

export function getProfileRowForUser(userId: Id): ProfileRow | null {
  return (prep('SELECT * FROM roommate_profiles WHERE user_id = ?').get(userId) as ProfileRow | undefined) ?? null;
}

export function isPublished(row: ProfileRow): boolean {
  return row.published_at !== null;
}

/** Visible to OTHER viewers: published + active + not paused. (Blocks / author status are SQL-side, see `visibleSql`.) */
export function isPubliclyVisible(row: ProfileRow): boolean {
  return isPublished(row) && row.status === 'active' && row.paused === 0;
}

/**
 * SQL fragment for the campus browse / saved lists: published, active, not paused, not self, same campus, no block either way,
 * author active, not reported by the viewer. `p` is the roommate_profiles alias.
 */
export function visibleSql(viewerId: Id, universityId: Id): { sql: string; params: unknown[] } {
  const nb = sqlNotBlocked(viewerId, 'p.user_id');
  const nr = sqlNotReported(viewerId, 'roommate_listing', 'p.id');
  return {
    sql: `p.published_at IS NOT NULL AND p.status = 'active' AND p.paused = 0 AND p.user_id != ? AND p.university_id = ?
          AND ${nb.sql} AND ${sqlAuthorVisible('p.user_id')} AND ${nr.sql}`,
    params: [viewerId, universityId, ...nb.params, ...nr.params],
  };
}

/* ───────────────────────────── field parsing ───────────────────────────── */

const DEFAULT_ANSWERS: RoommateAnswers = { sleep: 1, clean: 2, noise: 1, guests: 1, hosting: 1, smoking: 0, pets: 1, sharing: 1 };

export function answersOf(row: ProfileRow): RoommateAnswers {
  const parsed = json<unknown>(row.answers_json, null);
  return isAnswers(parsed) ? parsed : DEFAULT_ANSWERS;
}

export function partyOf(row: ProfileRow): CompatParty {
  return { answers: answersOf(row), dealbreakSmoking: row.dealbreak_smoking === 1, dealbreakPets: row.dealbreak_pets === 1 };
}

export function placeOf(row: ProfileRow): RoommatePlace | null {
  const p = json<Partial<RoommatePlace> | null>(row.place_json, null);
  if (!p || typeof p.rent !== 'number') return null;
  return {
    rent: p.rent,
    roomType: p.roomType === 'shared' ? 'shared' : 'private',
    beds: typeof p.beds === 'number' ? p.beds : 1,
    baths: typeof p.baths === 'number' ? p.baths : 1,
    furnished: !!p.furnished,
    utilitiesIncluded: !!p.utilitiesIncluded,
  };
}

export function photosOf(row: ProfileRow): MediaImage[] {
  const list = json<unknown>(row.photos_json, []);
  if (!Array.isArray(list)) return [];
  return list.filter((i): i is MediaImage => !!i && typeof i === 'object' && typeof (i as MediaImage).url === 'string');
}

export function neighborhoodsOf(row: ProfileRow): string[] {
  const list = json<unknown>(row.neighborhoods_json, []);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
}

export interface ProfileTextField {
  field: 'title' | 'body';
  text: string;
}

/**
 * Every user-typed text of a profile, in queue-display order: the neighborhoods (custom "Add an area" entries are free
 * text, shown on every public card) as one `title` field, `about` as `body`, then each distinct photo alt as `body`.
 * Empty fields are skipped. Both the PUT /me moderation and the content adapter snapshot are built from this, so what
 * staff see in the queue is exactly what was moderated.
 */
export function textFieldsOf(about: string, neighborhoods: string[], photos: MediaImage[]): ProfileTextField[] {
  const out: ProfileTextField[] = [];
  const hoods = neighborhoods.map((n) => n.trim()).filter(Boolean).join(', ');
  if (hoods) out.push({ field: 'title', text: hoods });
  if (about.trim()) out.push({ field: 'body', text: about.trim() });
  const alts = new Set<string>();
  for (const p of photos) {
    const alt = typeof p.alt === 'string' ? p.alt.trim() : '';
    if (alt && !alts.has(alt)) {
      alts.add(alt);
      out.push({ field: 'body', text: alt });
    }
  }
  return out;
}

export function textFieldsOfRow(row: ProfileRow): ProfileTextField[] {
  return textFieldsOf(row.about, neighborhoodsOf(row), photosOf(row));
}

export function firstNameOf(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || displayName;
}

/** Academic year that ends in the returned calendar year (a year starts in August). Twin of the client's `classLabel`. */
function currentAcademicYear(at: EpochMs): number {
  const d = new Date(at);
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export function classLabelOf(classYear: number | null, classKind: ClassKind | null): string | null {
  if (classKind === 'grad') return 'Grad';
  if (classYear === null) return null;
  if (classKind === 'undergrad') {
    const away = classYear - currentAcademicYear(now());
    if (away === 0) return 'Senior';
    if (away === 1) return 'Junior';
    if (away === 2) return 'Sophomore';
    if (away === 3) return 'Freshman';
  }
  return `Class of ${classYear}`;
}

export function lastConfirmedAt(row: ProfileRow): EpochMs | null {
  if (row.published_at === null) return null;
  return Math.max(row.published_at, row.confirmed_at ?? 0);
}

export function needsConfirmation(row: ProfileRow, at: EpochMs = now()): boolean {
  const last = lastConfirmedAt(row);
  return last !== null && row.paused === 0 && row.status === 'active' && at - last > STILL_LOOKING_AFTER_MS;
}

/* ───────────────────────────── serializers ───────────────────────────── */

export interface SerializeCtx {
  viewerId: Id;
  /** The viewer's own party (any row, published or not); null → `compat: null`. */
  viewerParty: CompatParty | null;
  savedIds: ReadonlySet<Id>;
  /** Pre-loaded author rows (optional). */
  users?: Map<Id, UserRow>;
}

export function viewerPartyFor(viewerId: Id): CompatParty | null {
  const row = getProfileRowForUser(viewerId);
  return row ? partyOf(row) : null;
}

export function savedIdsFor(viewerId: Id): Set<Id> {
  const rows = prep('SELECT profile_id AS id FROM roommate_saves WHERE user_id = ?').all(viewerId) as { id: Id }[];
  return new Set(rows.map((r) => r.id));
}

export function compatFor(ctx: Pick<SerializeCtx, 'viewerParty'>, row: ProfileRow): Compatibility | null {
  return ctx.viewerParty ? computeCompatibility(ctx.viewerParty, partyOf(row)) : null;
}

function authorOf(ctx: SerializeCtx, row: ProfileRow): UserRow | null {
  return ctx.users?.get(row.user_id) ?? getUserRow(row.user_id);
}

/** Card of a PUBLISHED row (the caller has applied the visibility rule). Returns null when the author is gone. */
export function toCard(row: ProfileRow, ctx: SerializeCtx): RoommateCard | null {
  const author = authorOf(ctx, row);
  if (!author) return null;
  const answers = answersOf(row);
  const photos = photosOf(row);
  return {
    id: row.id,
    user: toUserSummary(author),
    firstName: firstNameOf(author.display_name),
    classLabel: classLabelOf(author.class_year, author.class_kind),
    major: author.major,
    mode: row.mode ?? 'need',
    budget: row.budget ?? 0,
    moveIn: row.move_in ?? '',
    neighborhoods: neighborhoodsOf(row),
    tags: tagsOf(answers),
    archetype: row.archetype || archetypeOf(answers),
    coverUrl: photos[0]?.url ?? null,
    compat: row.user_id === ctx.viewerId ? null : compatFor(ctx, row),
    isNewAccount: now() - author.created_at < NEW_ACCOUNT_CHIP_MS,
    lowPriceFlag: row.low_price_flag === 1,
    saved: ctx.savedIds.has(row.id),
    createdAt: row.published_at ?? row.created_at,
  };
}

export function toDetail(row: ProfileRow, ctx: SerializeCtx): RoommateDetail | null {
  const card = toCard(row, ctx);
  if (!card) return null;
  return {
    ...card,
    about: row.about,
    photos: photosOf(row),
    leaseMonths: row.lease_months,
    livingWith: row.living_with,
    place: placeOf(row),
    answers: answersOf(row),
  };
}

/** The owner's own view: any status, any publish state. */
export function toMyProfile(row: ProfileRow): MyRoommateProfile {
  const author = getUserRow(row.user_id);
  const answers = answersOf(row);
  const photos = photosOf(row);
  const base: Omit<RoommateDetail, 'mode' | 'budget' | 'moveIn'> = {
    id: row.id,
    user: author ? toUserSummary(author) : { id: row.user_id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '', accountType: 'student', isVerified: false, universityId: row.university_id, universityShortName: '' },
    firstName: author ? firstNameOf(author.display_name) : '',
    classLabel: author ? classLabelOf(author.class_year, author.class_kind) : null,
    major: author?.major ?? null,
    neighborhoods: neighborhoodsOf(row),
    tags: tagsOf(answers),
    archetype: row.archetype || archetypeOf(answers),
    coverUrl: photos[0]?.url ?? null,
    compat: null,
    isNewAccount: author ? now() - author.created_at < NEW_ACCOUNT_CHIP_MS : false,
    lowPriceFlag: row.low_price_flag === 1,
    saved: false,
    createdAt: row.created_at,
    about: row.about,
    photos,
    leaseMonths: row.lease_months,
    livingWith: row.living_with,
    place: placeOf(row),
    answers,
  };
  return {
    ...base,
    mode: row.mode,
    budget: row.budget,
    moveIn: row.move_in,
    status: row.status,
    paused: row.paused === 1,
    published: row.published_at !== null,
    publishedAt: row.published_at,
    needsConfirmation: needsConfirmation(row),
    gender: row.gender,
    dealbreakSmoking: row.dealbreak_smoking === 1,
    dealbreakPets: row.dealbreak_pets === 1,
  };
}
