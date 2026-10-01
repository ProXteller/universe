/**
 * Campus events (SPEC §5.9): rows → `EventCard` / `EventDetail`, the campus-only upcoming list with filters, detail,
 * create / edit / cancel, RSVPs (+ capacity, host notification), attendees, per-user hosted lists and the lazy
 * one-hour reminder generator. Every public read ANDs in `sqlNotBlocked` + `sqlAuthorVisible` + `sqlNotReported`;
 * hosts also see their own held / hidden / removed rows. No import-time DB access (R4).
 */
import type { AuthorNotice, ContentStatus, EpochMs, Id, Paginated, UserListItem, UserSummary } from '@shared/core';
import type { EventCard, EventDetail, EventFilter, RsvpState, UpdateEventRequest, UpsertEventRequest } from '@shared/campus';
import { EVENT_COVER_PRESETS, EVENT_COVER_URL_PREFIX, EVENT_LARGE_CAPACITY } from '@shared/campus';
import { db, inClause, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { DAY, HOUR, MIN, now } from '../../lib/clock';
import { assertVisibleUser, isBlockedBetween, isFollowing, sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, encodeCursor, keysetWhere } from '../../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite, NO_NOTICE, toAuthorNotice } from '../../lib/moderation/index';
import { notify } from '../../lib/notify';
import { assertAccountAge, enforceRateLimit } from '../../lib/rateLimit';
import { assertOwnUpload } from '../../lib/uploads';
import { markPublicActivity, unmarkPublicActivity, userListItemsByIds, userSummariesByIds, type AuthedUser } from '../../lib/users';

/* ───────────────────────────── rows ───────────────────────────── */

export interface EventRow {
  id: Id;
  host_id: Id;
  university_id: Id;
  title: string;
  description: string;
  category: EventCard['category'];
  starts_at: EpochMs;
  ends_at: EpochMs;
  location_name: string;
  address: string | null;
  address_private: number;
  cover_url: string;
  free_food: number;
  capacity: number | null;
  status: ContentStatus;
  auto_hide_immune: number;
  cancelled_at: EpochMs | null;
  going_count: number;
  interested_count: number;
  created_at: EpochMs;
  updated_at: EpochMs;
}

interface RsvpRow {
  event_id: Id;
  user_id: Id;
  state: RsvpState;
  reminded_at: EpochMs | null;
  created_at: EpochMs;
}

export const EVENT_NOT_FOUND = "This event isn't available";
export const REMINDER_WINDOW_MS = 60 * MIN;
const FRIENDS_GOING_MAX = 3;
const PRESET_URLS: ReadonlySet<string> = new Set(EVENT_COVER_PRESETS.map((p) => `${EVENT_COVER_URL_PREFIX}${p}.svg`));

export function getEventRow(id: Id): EventRow | null {
  return (prep('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined) ?? null;
}

export function isPresetCover(url: string): boolean {
  return PRESET_URLS.has(url);
}

/** Local-midnight bounds of the day containing `at` (server clock; campuses have no stored timezone). */
export function dayBounds(at: EpochMs): { start: EpochMs; end: EpochMs } {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return { start, end: start + DAY };
}

/* ───────────────────────────── visibility ───────────────────────────── */

/**
 * WHERE fragment every public read of `events e` ANDs in for `viewerId`: active rows from visible, unblocked,
 * unreported hosts — plus the viewer's own non-deleted rows (held / hidden / removed with a status chip).
 */
export function visibleEventsWhere(viewerId: Id): { sql: string; params: (string | number)[] } {
  const nb = sqlNotBlocked(viewerId, 'e.host_id');
  const nr = sqlNotReported(viewerId, 'event', 'e.id');
  return {
    sql: `(e.status = 'active' OR (e.host_id = ? AND e.status != 'deleted')) AND ${nb.sql} AND ${sqlAuthorVisible('e.host_id')} AND ${nr.sql}`,
    params: [viewerId, ...nb.params, ...nr.params],
  };
}

/** The event as `viewer` may see it, else the generic 404. */
export function loadVisibleEvent(viewer: AuthedUser, id: Id): EventRow {
  const vis = visibleEventsWhere(viewer.id);
  // Events are campus-only (SPEC §5.9, safety §7.7): detail / RSVP / attendees / the private-address reveal all go through
  // here, so an off-campus viewer gets the generic 404 (the host keeps access to their own event).
  const row = db
    .prepare(`SELECT e.* FROM events e WHERE e.id = ? AND (e.university_id = ? OR e.host_id = ?) AND ${vis.sql}`)
    .get(id, viewer.universityId, viewer.id, ...vis.params) as EventRow | undefined;
  if (!row) throw ApiError.notFound(EVENT_NOT_FOUND);
  return row;
}

/* ───────────────────────────── serializers ───────────────────────────── */

function tombstone(id: Id): UserSummary {
  return {
    id, handle: 'deleted', displayName: 'Deleted account', avatarUrl: '/api/avatars/deleted.svg?t=student', accountType: 'student',
    isVerified: false, universityId: '', universityShortName: '',
  };
}

function myRsvps(eventIds: Id[], viewerId: Id): Map<Id, RsvpState> {
  const out = new Map<Id, RsvpState>();
  for (let i = 0; i < eventIds.length; i += 400) {
    const inc = inClause(eventIds.slice(i, i + 400));
    for (const r of db.prepare(`SELECT event_id, state FROM event_rsvps WHERE user_id = ? AND event_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { event_id: Id; state: RsvpState }[]) {
      out.set(r.event_id, r.state);
    }
  }
  return out;
}

/** ≤ 3 active accounts the viewer follows who are going, per event (follow edges never survive a block). */
function friendsGoingFor(eventIds: Id[], viewerId: Id): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (let i = 0; i < eventIds.length; i += 400) {
    const inc = inClause(eventIds.slice(i, i + 400));
    const rows = db
      .prepare(
        `SELECT r.event_id, r.user_id FROM event_rsvps r
           JOIN follows f ON f.follower_id = ? AND f.followee_id = r.user_id
           JOIN users u ON u.id = r.user_id AND u.status = 'active'
          WHERE r.state = 'going' AND r.event_id IN ${inc.sql}
          ORDER BY r.created_at ASC, r.user_id ASC`,
      )
      .all(viewerId, ...inc.params) as { event_id: Id; user_id: Id }[];
    for (const r of rows) {
      const list = out.get(r.event_id) ?? [];
      if (list.length < FRIENDS_GOING_MAX) list.push(r.user_id);
      out.set(r.event_id, list);
    }
  }
  return out;
}

/** Batch serializer: one users lookup + one RSVP lookup + one friends lookup for the whole page. */
export function serializeEventCards(rows: EventRow[], viewerId: Id): EventCard[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const mine = myRsvps(ids, viewerId);
  const friends = friendsGoingFor(ids, viewerId);
  const userIds = [...rows.map((r) => r.host_id), ...[...friends.values()].flat()];
  const users = userSummariesByIds(userIds);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    locationName: row.location_name,
    coverUrl: row.cover_url,
    freeFood: row.free_food === 1,
    host: users.get(row.host_id) ?? tombstone(row.host_id),
    goingCount: row.going_count,
    friendsGoing: (friends.get(row.id) ?? []).map((id) => users.get(id)).filter((u): u is UserSummary => !!u),
    myRsvp: mine.get(row.id) ?? null,
    cancelled: row.cancelled_at !== null,
  }));
}

export function serializeEventCard(row: EventRow, viewerId: Id): EventCard {
  return serializeEventCards([row], viewerId)[0]!;
}

export function serializeEventDetail(row: EventRow, viewer: AuthedUser): EventDetail {
  const card = serializeEventCard(row, viewer.id);
  const isHost = row.host_id === viewer.id;
  const addressVisible = row.address_private === 0 || isHost || card.myRsvp === 'going';
  return {
    ...card,
    description: row.description,
    address: addressVisible ? row.address : null,
    addressPrivate: row.address_private === 1,
    capacity: row.capacity,
    isFull: row.capacity !== null && row.going_count >= row.capacity,
    interestedCount: row.interested_count,
    viewer: { isHost, isFollowingHost: !isHost && isFollowing(viewer.id, row.host_id) },
    status: row.status,
    createdAt: row.created_at,
  };
}

/* ───────────────────────────── lists ───────────────────────────── */

function filterWhere(filter: EventFilter | undefined, at: EpochMs): { sql: string; params: (string | number)[] } {
  switch (filter) {
    case 'today':
      return { sql: 'e.starts_at < ?', params: [dayBounds(at).end] };
    case 'week':
      return { sql: 'e.starts_at < ?', params: [at + 7 * DAY] };
    case 'free_food':
      return { sql: 'e.free_food = 1', params: [] };
    case 'academic':
    case 'social':
    case 'sports':
    case 'career':
    case 'arts':
      return { sql: 'e.category = ?', params: [filter] };
    default:
      return { sql: '1 = 1', params: [] };
  }
}

/** Upcoming (not ended, not cancelled), campus-only, `starts_at ASC`; `hostId` narrows to one host. */
export function listEvents(
  viewer: AuthedUser,
  opts: { filter?: EventFilter; hostId?: Id; cursor?: string; limit: number },
): Paginated<EventCard> {
  const at = now();
  const vis = visibleEventsWhere(viewer.id);
  const f = filterWhere(opts.filter, at);
  const ks = keysetWhere('e.starts_at', 'e.id', decodeCursor(opts.cursor), 'asc');
  const params: (string | number)[] = [viewer.universityId, at, ...vis.params, ...f.params, ...ks.params];
  let hostSql = '';
  if (opts.hostId) {
    assertVisibleUser(viewer.id, opts.hostId);
    hostSql = ' AND e.host_id = ?';
    params.push(opts.hostId);
  }
  params.push(opts.limit + 1);
  const rows = db
    .prepare(
      `SELECT e.* FROM events e
        WHERE e.university_id = ? AND e.ends_at > ? AND e.cancelled_at IS NULL AND ${vis.sql} AND ${f.sql} AND ${ks.sql}${hostSql}
        ORDER BY e.starts_at ASC, e.id ASC LIMIT ?`,
    )
    .all(...params) as EventRow[];
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: serializeEventCards(page, viewer.id),
    nextCursor: rows.length > opts.limit && last ? encodeCursor({ k: last.starts_at, id: last.id }) : null,
  };
}

/**
 * Hub helpers: today's events (incl. in progress; first 20 as cards) and the next ones after today. `todayCount` /
 * `freeFoodToday` are counted over the whole day, not the 20-card page (SPEC §1 rule 5: every count derives from rows).
 */
export function hubEvents(viewer: AuthedUser): { today: EventRow[]; upcoming: EventRow[]; todayCount: number; freeFoodToday: number } {
  const at = now();
  const { end } = dayBounds(at);
  const vis = visibleEventsWhere(viewer.id);
  const base = `FROM events e WHERE e.university_id = ? AND e.ends_at > ? AND e.cancelled_at IS NULL AND ${vis.sql}`;
  const today = db
    .prepare(`SELECT e.* ${base} AND e.starts_at < ? ORDER BY e.starts_at ASC, e.id ASC LIMIT 20`)
    .all(viewer.universityId, at, ...vis.params, end) as EventRow[];
  const counts = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(e.free_food), 0) AS food ${base} AND e.starts_at < ?`)
    .get(viewer.universityId, at, ...vis.params, end) as { n: number; food: number };
  const upcoming = db
    .prepare(`SELECT e.* ${base} AND e.starts_at >= ? ORDER BY e.starts_at ASC, e.id ASC LIMIT 6`)
    .all(viewer.universityId, at, ...vis.params, end) as EventRow[];
  return { today, upcoming, todayCount: counts.n, freeFoodToday: counts.food };
}

/** Hosted by `userId`: upcoming first (`starts_at ASC`), then past (`starts_at DESC`); cancelled rows included. Offset cursor. */
export function listUserEvents(viewer: AuthedUser, userId: Id, page: { cursor?: string; limit: number }): Paginated<EventCard> {
  assertVisibleUser(viewer.id, userId);
  if (isBlockedBetween(viewer.id, userId)) return { items: [], nextCursor: null };
  const at = now();
  const cur = decodeCursor(page.cursor);
  const offset = cur && typeof cur.k === 'number' && cur.k >= 0 ? Math.floor(cur.k) : 0;
  const vis = visibleEventsWhere(viewer.id);
  const rows = db
    .prepare(
      `SELECT e.* FROM events e WHERE e.host_id = ? AND (e.university_id = ? OR e.host_id = ?) AND ${vis.sql}
        ORDER BY CASE WHEN e.ends_at > ? THEN 0 ELSE 1 END ASC,
                 CASE WHEN e.ends_at > ? THEN e.starts_at ELSE -e.starts_at END ASC, e.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, viewer.universityId, viewer.id, ...vis.params, at, at, page.limit + 1, offset) as EventRow[];
  const slice = rows.slice(0, page.limit);
  return {
    items: serializeEventCards(slice, viewer.id),
    nextCursor: rows.length > page.limit ? encodeCursor({ k: offset + page.limit, id: 'offset' }) : null,
  };
}

/* ───────────────────────────── create / update / cancel ───────────────────────────── */

function assertTimes(startsAt: EpochMs, endsAt: EpochMs, at: EpochMs): void {
  if (endsAt <= startsAt) throw new ApiError(400, 'validation_failed', 'The event has to end after it starts.');
  if (endsAt <= at) throw new ApiError(400, 'validation_failed', 'Pick a time in the future.');
  if (endsAt - startsAt > 14 * DAY) throw new ApiError(400, 'validation_failed', 'Events can last up to 14 days.');
}

function assertCover(user: AuthedUser, coverUrl: string): string {
  if (isPresetCover(coverUrl)) return coverUrl;
  return assertOwnUpload(user, coverUrl, 'image').url;
}

function assertCapacity(user: AuthedUser, capacity: number | null | undefined): void {
  if (capacity !== null && capacity !== undefined && capacity > EVENT_LARGE_CAPACITY) {
    assertAccountAge(user, 7 * DAY, `New accounts can host events for up to ${EVENT_LARGE_CAPACITY} people. Larger events open up after a week.`);
  }
}

export function createEvent(user: AuthedUser, body: UpsertEventRequest): { event: EventDetail; moderation: AuthorNotice } {
  const at = now();
  assertTimes(body.startsAt, body.endsAt, at);
  assertCapacity(user, body.capacity);
  const coverUrl = assertCover(user, body.coverUrl);
  enforceRateLimit(user, 'event_create');
  const description = (body.description ?? '').trim();
  const locationName = body.locationName.trim();
  const address = body.address?.trim() || null;
  // Every UGC text field goes through the engine (Constitution §4): the venue and street address are rendered on every
  // public card, so they are moderated with the title / description (street addresses are allowed on the `event` surface).
  const mod = moderateWrite(
    [
      { text: body.title, field: 'title' },
      { text: description, field: 'body' },
      { text: locationName, field: 'name' },
      { text: address, field: 'body' },
    ],
    modCtx(user, 'event'),
    blockedTarget(user, 'event'),
  );
  const status = mod.persistStatus ?? 'active';
  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO events (id, host_id, university_id, title, description, category, starts_at, ends_at, location_name, address, address_private,
         cover_url, free_food, capacity, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, user.id, user.universityId, body.title.trim(), description, body.category, body.startsAt, body.endsAt, locationName,
      address, body.addressPrivate ? 1 : 0, coverUrl, body.freeFood ? 1 : 0, body.capacity ?? null, status, at, at,
    );
    commitModeration(mod, { ...blockedTarget(user, 'event'), entityId: id });
    if (status === 'active') markPublicActivity(user.id, 'event', id, at);
  });
  trackEvent('event_create', { userId: user.id, universityId: user.universityId }, { category: body.category, freeFood: !!body.freeFood });
  return { event: serializeEventDetail(getEventRow(id)!, user), moderation: toAuthorNotice(mod) };
}

function rsvpUserIds(eventId: Id, states: RsvpState[] = ['going', 'interested']): Id[] {
  const inc = inClause(states);
  return (db.prepare(`SELECT user_id FROM event_rsvps WHERE event_id = ? AND state IN ${inc.sql}`).all(eventId, ...inc.params) as { user_id: Id }[]).map((r) => r.user_id);
}

function loadOwnEvent(user: AuthedUser, id: Id): EventRow {
  const row = getEventRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound(EVENT_NOT_FOUND);
  if (row.host_id !== user.id) throw ApiError.forbidden('Only the host can change this event.');
  return row;
}

export function updateEvent(user: AuthedUser, id: Id, patch: UpdateEventRequest): { event: EventDetail; moderation: AuthorNotice } {
  const row = loadOwnEvent(user, id);
  if (row.cancelled_at !== null) throw ApiError.conflict('This event was cancelled.');
  const at = now();
  const next = {
    title: patch.title !== undefined ? patch.title.trim() : row.title,
    description: patch.description !== undefined ? patch.description.trim() : row.description,
    category: patch.category ?? row.category,
    startsAt: patch.startsAt ?? row.starts_at,
    endsAt: patch.endsAt ?? row.ends_at,
    locationName: patch.locationName !== undefined ? patch.locationName.trim() : row.location_name,
    address: patch.address !== undefined ? (patch.address?.trim() || null) : row.address,
    addressPrivate: patch.addressPrivate !== undefined ? patch.addressPrivate : row.address_private === 1,
    coverUrl: patch.coverUrl !== undefined ? patch.coverUrl : row.cover_url,
    freeFood: patch.freeFood !== undefined ? patch.freeFood : row.free_food === 1,
    capacity: patch.capacity !== undefined ? patch.capacity : row.capacity,
  };
  if (patch.startsAt !== undefined || patch.endsAt !== undefined) assertTimes(next.startsAt, next.endsAt, at);
  if (patch.capacity !== undefined) assertCapacity(user, next.capacity);
  if (patch.coverUrl !== undefined && patch.coverUrl !== row.cover_url) next.coverUrl = assertCover(user, patch.coverUrl);

  // Only changed text is re-moderated (unchanged text would trip the duplicate detector; FOUNDATION-NOTES).
  const textFields: { text: string; field: 'title' | 'body' | 'name' }[] = [];
  if (next.title !== row.title) textFields.push({ text: next.title, field: 'title' });
  if (next.description !== row.description) textFields.push({ text: next.description, field: 'body' });
  if (next.locationName !== row.location_name) textFields.push({ text: next.locationName, field: 'name' });
  if (next.address !== null && next.address !== row.address) textFields.push({ text: next.address, field: 'body' });
  const mod = textFields.length > 0 ? moderateWrite(textFields, modCtx(user, 'event'), blockedTarget(user, 'event')) : null;
  const staffLocked = row.status === 'hidden' || row.status === 'removed';
  const status: ContentStatus = mod && !staffLocked ? (mod.persistStatus ?? 'active') : row.status;
  const timeOrPlaceChanged =
    next.startsAt !== row.starts_at || next.endsAt !== row.ends_at || next.locationName !== row.location_name || next.address !== row.address;

  tx(() => {
    prep(
      `UPDATE events SET title = ?, description = ?, category = ?, starts_at = ?, ends_at = ?, location_name = ?, address = ?, address_private = ?,
         cover_url = ?, free_food = ?, capacity = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).run(
      next.title, next.description, next.category, next.startsAt, next.endsAt, next.locationName, next.address, next.addressPrivate ? 1 : 0,
      next.coverUrl, next.freeFood ? 1 : 0, next.capacity ?? null, status, at, id,
    );
    if (mod) commitModeration(mod, { ...blockedTarget(user, 'event'), entityId: id });
    if (status === 'active' && row.status !== 'active') markPublicActivity(user.id, 'event', id, row.created_at);
    else if (status !== 'active' && row.status === 'active') unmarkPublicActivity('event', id);
    if (timeOrPlaceChanged && status === 'active') {
      for (const uid of rsvpUserIds(id)) {
        notify({
          userId: uid, type: 'event.updated', actorId: user.id, href: `/campus/events/${id}`,
          target: { entityType: 'event', entityId: id }, data: { title: next.title }, thumbnailUrl: next.coverUrl,
        });
      }
    }
  });
  return { event: serializeEventDetail(getEventRow(id)!, user), moderation: mod ? toAuthorNotice(mod) : NO_NOTICE };
}

export function cancelEvent(user: AuthedUser, id: Id): EventDetail {
  const row = loadOwnEvent(user, id);
  if (row.cancelled_at === null) {
    const at = now();
    tx(() => {
      prep('UPDATE events SET cancelled_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
      unmarkPublicActivity('event', id);
      for (const uid of rsvpUserIds(id)) {
        notify({
          userId: uid, type: 'event.cancelled', actorId: user.id, href: `/campus/events/${id}`,
          target: { entityType: 'event', entityId: id }, data: { title: row.title }, thumbnailUrl: row.cover_url,
        });
      }
    });
  }
  return serializeEventDetail(getEventRow(id)!, user);
}

/* ───────────────────────────── RSVP ───────────────────────────── */

export function setRsvp(user: AuthedUser, id: Id, state: RsvpState | null): EventCard {
  const row = loadVisibleEvent(user, id);
  const at = now();
  if (row.cancelled_at !== null) throw ApiError.conflict('This event was cancelled.');
  if (row.ends_at <= at) throw ApiError.conflict('This event has ended.');
  if (row.status !== 'active') throw ApiError.conflict("This event isn't open for RSVPs yet.");
  let firstGoing = false;
  tx(() => {
    const existing = prep('SELECT * FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(id, user.id) as RsvpRow | undefined;
    const prev = existing?.state ?? null;
    if (prev === state) return;
    if (state === 'going' && row.capacity !== null && row.going_count >= row.capacity) throw ApiError.conflict('This event is full.');
    if (prev === 'going') prep('UPDATE events SET going_count = MAX(going_count - 1, 0) WHERE id = ?').run(id);
    if (prev === 'interested') prep('UPDATE events SET interested_count = MAX(interested_count - 1, 0) WHERE id = ?').run(id);
    if (state === null) {
      prep('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(id, user.id);
      return;
    }
    if (existing) prep('UPDATE event_rsvps SET state = ?, created_at = ? WHERE event_id = ? AND user_id = ?').run(state, at, id, user.id);
    else prep('INSERT INTO event_rsvps (event_id, user_id, state, created_at) VALUES (?,?,?,?)').run(id, user.id, state, at);
    if (state === 'going') {
      prep('UPDATE events SET going_count = going_count + 1 WHERE id = ?').run(id);
      // "first `going`" (SPEC §5.9): the host hears about each attendee once, however often they un-RSVP and come back.
      firstGoing = prep('INSERT OR IGNORE INTO event_rsvp_pings (event_id, user_id, created_at) VALUES (?,?,?)').run(id, user.id, at).changes === 1;
    } else {
      prep('UPDATE events SET interested_count = interested_count + 1 WHERE id = ?').run(id);
    }
  });
  if (firstGoing) {
    notify({
      userId: row.host_id, type: 'event.rsvp', actorId: user.id, href: `/campus/events/${id}`,
      target: { entityType: 'event', entityId: id }, data: { title: row.title, state: 'going' }, thumbnailUrl: row.cover_url, collapse: true,
    });
  }
  trackEvent('event_rsvp', { userId: user.id, universityId: user.universityId }, { state: state ?? 'none', category: row.category });
  return serializeEventCard(getEventRow(id)!, user.id);
}

/** Follows first, then RSVP order; blocked + non-active users removed. Offset cursor. */
export function listAttendees(viewer: AuthedUser, id: Id, state: RsvpState, page: { cursor?: string; limit: number }): Paginated<UserListItem> {
  loadVisibleEvent(viewer, id);
  const cur = decodeCursor(page.cursor);
  const offset = cur && typeof cur.k === 'number' && cur.k >= 0 ? Math.floor(cur.k) : 0;
  const rows = db
    .prepare(
      `SELECT r.user_id FROM event_rsvps r
        WHERE r.event_id = ? AND r.state = ?
        ORDER BY CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = r.user_id) THEN 0 ELSE 1 END ASC,
                 r.created_at ASC, r.user_id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(id, state, viewer.id, page.limit + 1, offset) as { user_id: Id }[];
  const ids = rows.slice(0, page.limit).map((r) => r.user_id);
  return {
    items: userListItemsByIds(ids, viewer.id),
    nextCursor: rows.length > page.limit ? encodeCursor({ k: offset + page.limit, id: 'offset' }) : null,
  };
}

/* ───────────────────────────── reminders (notification hook) ───────────────────────────── */

/** `going` RSVPs starting within the next hour with `reminded_at IS NULL` → one `event.reminder` each. Idempotent. */
export function generateEventReminders(userId: Id): void {
  const at = now();
  const due = db
    .prepare(
      `SELECT r.event_id, e.title, e.starts_at FROM event_rsvps r JOIN events e ON e.id = r.event_id
        WHERE r.user_id = ? AND r.state = 'going' AND r.reminded_at IS NULL AND e.cancelled_at IS NULL AND e.status = 'active'
          AND e.starts_at > ? AND e.starts_at - ? <= ?`,
    )
    .all(userId, at, at, REMINDER_WINDOW_MS) as { event_id: Id; title: string; starts_at: EpochMs }[];
  for (const d of due) {
    const res = prep('UPDATE event_rsvps SET reminded_at = ? WHERE event_id = ? AND user_id = ? AND reminded_at IS NULL').run(at, d.event_id, userId);
    if (res.changes === 0) continue;
    notify({
      userId, type: 'event.reminder', actorId: null, href: `/campus/events/${d.event_id}`,
      target: { entityType: 'event', entityId: d.event_id }, data: { title: d.title, startsAt: d.starts_at }, collapse: false,
    });
  }
}

/* ───────────────────────────── misc ───────────────────────────── */

/** Human date for cards (server locale; campuses carry no timezone). */
export function formatEventWhen(startsAt: EpochMs): string {
  const d = new Date(startsAt);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function hoursUntil(startsAt: EpochMs, at: EpochMs = now()): number {
  return (startsAt - at) / HOUR;
}
