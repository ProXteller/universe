/**
 * `market` slice — listing rows, queries, serializers and writes (SPEC §5.8). Campus-only.
 * Every public read ANDs in `sqlNotBlocked` + `sqlAuthorVisible` + `sqlNotReported`; authors see their own
 * held / hidden / removed rows. No import-time DB access (R4): statements go through `prep()` inside functions.
 */
import type { AuthorNotice, ContentStatus, EpochMs, Id, MarketSummary, MediaImage, Paginated } from '@shared/core';
import { LIMITS } from '@shared/core';
import type {
  Listing, ListingCard, ListingCategory, ListingCondition, ListingFilters, ListingSort, ListingState, ListingStats, ListingType,
  ListingViewer, MyListingCard, MyListingsState, OfferResponse, SaveResponse, SellerTrust, UpsertListingRequest,
} from '@shared/market';
import { CLOSED_VISIBLE_DAYS, LISTING_GONE_COPY, LISTING_TTL_DAYS, LOW_PRICE_CATEGORIES } from '@shared/market';
import { db, inClause, json, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { DAY, now } from '../../lib/clock';
import { conversationCountForContext, openDm, sendMessage, touchContext } from '../../lib/conversations';
import { normalizeCourseCode } from '../../lib/courseCode';
import { isBlockedBetween, reportedIdsFor, sqlAuthorVisible, sqlNotBlocked, sqlNotReported } from '../../lib/graph';
import { ApiError, decodeCursor, keysetWhere, paginate, type CursorValue } from '../../lib/http';
import {
  blockedTarget, commitModeration, enqueueSystemFlag, modCtx, moderateWrite, NO_NOTICE, toAuthorNotice,
} from '../../lib/moderation/index';
import { notify, removeNotificationsFor } from '../../lib/notify';
import { enforceActiveCap, enforceRateLimit } from '../../lib/rateLimit';
import { assertOwnImages } from '../../lib/uploads';
import { getUserRow, toUserSummary, type AuthedUser, type UserRow } from '../../lib/users';

/* ───────────────────────────── rows ───────────────────────────── */

export interface ListingRow {
  id: Id;
  seller_id: Id;
  university_id: Id;
  type: ListingType;
  category: ListingCategory;
  title: string;
  description: string;
  price: number | null;
  trade_for: string | null;
  condition: ListingCondition | null;
  course_code: string | null;
  meetup_spot: string | null;
  location_text: string | null;
  occurred_on: string | null;
  photos_json: string;
  status: ContentStatus;
  auto_hide_immune: number;
  state: 'active' | 'sold' | 'returned';
  closed_at: EpochMs | null;
  expires_at: EpochMs;
  low_price_flag: number;
  view_count: number;
  save_count: number;
  created_at: EpochMs;
  updated_at: EpochMs;
}

export const NEW_ACCOUNT_CHIP_MS = 7 * DAY;
const TTL_MS = LISTING_TTL_DAYS * DAY;
const CLOSED_VISIBLE_MS = CLOSED_VISIBLE_DAYS * DAY;
const LOW_PRICE_MIN_COMPARABLES = 10;
const LOW_PRICE_RATIO = 0.3;

export function getListingRow(id: Id): ListingRow | null {
  return (prep('SELECT * FROM market_listings WHERE id = ?').get(id) as ListingRow | undefined) ?? null;
}

export function stateOf(row: Pick<ListingRow, 'state' | 'expires_at'>, at: EpochMs = now()): ListingState {
  if (row.state === 'active' && row.expires_at <= at) return 'expired';
  return row.state;
}

export function photosOf(row: Pick<ListingRow, 'photos_json'>): MediaImage[] {
  return json<MediaImage[]>(row.photos_json, []);
}

export function coverOf(row: Pick<ListingRow, 'photos_json'>): string | null {
  return photosOf(row)[0]?.url ?? null;
}

/** SQL fragment: rows Browse may show — live listings, plus sold / returned ones for 7 days (SPEC §5.8). `?` = now twice. */
const SQL_BROWSABLE = "((l.state = 'active' AND l.expires_at > ?) OR (l.state IN ('sold','returned') AND l.closed_at IS NOT NULL AND l.closed_at > ?))";

/** Public visibility for a viewer who is not the seller: active status, not blocked, seller active, not reported. */
function publicWhere(viewerId: Id): { sql: string; params: (string | number)[] } {
  const nb = sqlNotBlocked(viewerId, 'l.seller_id');
  const nr = sqlNotReported(viewerId, 'market_listing', 'l.id');
  return {
    sql: `l.status = 'active' AND ${nb.sql} AND ${sqlAuthorVisible('l.seller_id')} AND ${nr.sql}`,
    params: [...nb.params, ...nr.params],
  };
}

/* ───────────────────────────── class label (server twin of client lib/format.ts) ───────────────────────────── */

function currentAcademicYear(at: EpochMs): number {
  const d = new Date(at);
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export function classLabelOf(row: Pick<UserRow, 'class_year' | 'class_kind'>, at: EpochMs = now()): string | null {
  if (row.class_kind === 'grad') return 'Grad';
  if (row.class_year === null) return null;
  if (row.class_kind === 'undergrad') {
    const away = row.class_year - currentAcademicYear(at);
    if (away === 0) return 'Senior';
    if (away === 1) return 'Junior';
    if (away === 2) return 'Sophomore';
    if (away === 3) return 'Freshman';
  }
  return `Class of ${row.class_year}`;
}

/* ───────────────────────────── serializers ───────────────────────────── */

function savedSetFor(viewerId: Id, ids: Id[]): Set<Id> {
  if (ids.length === 0) return new Set();
  const inc = inClause(ids);
  const rows = db.prepare(`SELECT listing_id AS id FROM market_saves WHERE user_id = ? AND listing_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { id: Id }[];
  return new Set(rows.map((r) => r.id));
}

export function toListingCard(row: ListingRow, saved: boolean, at: EpochMs = now(), viewerId: Id | null = null): ListingCard {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title: row.title,
    price: row.price,
    tradeFor: row.trade_for,
    coverUrl: coverOf(row),
    meetupSpot: row.meetup_spot,
    courseCode: row.course_code,
    state: stateOf(row, at),
    saved,
    isOwn: viewerId !== null && row.seller_id === viewerId,
    lowPriceFlag: row.low_price_flag === 1,
    createdAt: row.created_at,
  };
}

export function statsOf(row: ListingRow): ListingStats {
  return { views: row.view_count, saves: row.save_count, chats: conversationCountForContext('listing', row.id) };
}

/** Chat counts for a whole page of listings in one query (R2 permits the read on `conversations`); missing id → 0. */
function chatCountsFor(ids: Id[]): Map<Id, number> {
  if (ids.length === 0) return new Map();
  const inc = inClause(ids);
  const rows = db
    .prepare(`SELECT context_id AS id, COUNT(*) AS n FROM conversations WHERE context_kind = 'listing' AND context_id IN ${inc.sql} GROUP BY context_id`)
    .all(...inc.params) as { id: Id; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}

function sellerTrustOf(seller: UserRow, at: EpochMs): SellerTrust {
  const active = prep(
    "SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND status = 'active' AND state = 'active' AND expires_at > ?",
  ).get(seller.id, at) as { n: number };
  const completed = prep("SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND state = 'sold' AND status != 'deleted'").get(seller.id) as { n: number };
  return {
    memberSince: seller.created_at,
    isNewAccount: at - seller.created_at < NEW_ACCOUNT_CHIP_MS,
    activeListings: active.n,
    completedListings: completed.n,
    classLabel: classLabelOf(seller, at),
  };
}

function dmKeyOf(a: Id, b: Id): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Raw SELECTs on the core conversation tables (R2 allows reads): the viewer ↔ seller DM, request + pending-offer state. */
function viewerStateOf(row: ListingRow, viewerId: Id): ListingViewer {
  if (viewerId === row.seller_id) {
    return { isSelf: true, hasConversation: false, conversationId: null, requestPending: false, hasPendingOffer: false };
  }
  const conv = prep('SELECT id FROM conversations WHERE dm_key = ?').get(dmKeyOf(viewerId, row.seller_id)) as { id: Id } | undefined;
  if (!conv) return { isSelf: false, hasConversation: false, conversationId: null, requestPending: false, hasPendingOffer: false };
  const mine = prep('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conv.id, viewerId) as { state: string } | undefined;
  const theirs = prep('SELECT state FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conv.id, row.seller_id) as { state: string } | undefined;
  const canOpen = !!mine && (mine.state === 'active' || mine.state === 'request');
  if (!canOpen) return { isSelf: false, hasConversation: false, conversationId: null, requestPending: false, hasPendingOffer: false };
  const pendingOffer = prep(
    "SELECT 1 FROM messages WHERE conversation_id = ? AND sender_id = ? AND kind = 'offer' AND offer_status = 'pending' AND offer_listing_id = ? LIMIT 1",
  ).get(conv.id, viewerId, row.id);
  return {
    isSelf: false,
    hasConversation: true,
    conversationId: conv.id,
    requestPending: mine.state === 'active' && theirs?.state === 'request',
    hasPendingOffer: pendingOffer !== undefined,
  };
}

export function toListing(row: ListingRow, viewer: AuthedUser): Listing {
  const at = now();
  const seller = getUserRow(row.seller_id);
  if (!seller) throw ApiError.notFound(LISTING_GONE_COPY);
  const isSelf = viewer.id === row.seller_id;
  const saved = !isSelf && prep('SELECT 1 FROM market_saves WHERE user_id = ? AND listing_id = ?').get(viewer.id, row.id) !== undefined;
  return {
    ...toListingCard(row, saved, at, viewer.id),
    description: row.description,
    condition: row.condition,
    photos: photosOf(row),
    locationText: row.location_text,
    occurredOn: row.occurred_on,
    seller: toUserSummary(seller),
    sellerTrust: sellerTrustOf(seller, at),
    viewer: viewerStateOf(row, viewer.id),
    stats: isSelf ? statsOf(row) : null,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/* ───────────────────────────── browse ───────────────────────────── */

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function sortKey(sort: ListingSort): { col: string; dir: 'asc' | 'desc' } {
  switch (sort) {
    case 'price_asc':
      return { col: 'COALESCE(l.price, 0)', dir: 'asc' };
    case 'price_desc':
      return { col: 'COALESCE(l.price, 0)', dir: 'desc' };
    default:
      return { col: 'l.created_at', dir: 'desc' };
  }
}

function keyOf(sort: ListingSort): (r: ListingRow) => CursorValue {
  if (sort === 'newest') return (r) => ({ k: r.created_at, id: r.id });
  return (r) => ({ k: r.price ?? 0, id: r.id });
}

export function listListings(viewer: AuthedUser, f: ListingFilters, page: { cursor?: string; limit: number }): Paginated<ListingCard> {
  const at = now();
  const cur = decodeCursor(page.cursor);
  const sort: ListingSort = f.sort ?? 'newest';
  const { col, dir } = sortKey(sort);
  const ks = keysetWhere(col, 'l.id', cur, dir);
  const pub = publicWhere(viewer.id);
  const where: string[] = ['l.university_id = ?', pub.sql, SQL_BROWSABLE, ks.sql];
  const params: (string | number)[] = [viewer.universityId, ...pub.params, at, at - CLOSED_VISIBLE_MS, ...ks.params];

  if (f.q && f.q.trim()) {
    const q = `%${escapeLike(f.q.trim().toLowerCase())}%`;
    where.push("(LOWER(l.title) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(l.course_code, '')) LIKE ? ESCAPE '\\')");
    params.push(q, q);
  }
  if (f.category) {
    where.push('l.category = ?');
    params.push(f.category);
  }
  if (f.type) {
    where.push('l.type = ?');
    params.push(f.type);
  }
  if (typeof f.min === 'number') {
    where.push('l.price IS NOT NULL AND l.price >= ?');
    params.push(f.min);
  }
  if (typeof f.max === 'number') {
    where.push('(l.price IS NULL OR l.price <= ?)');
    params.push(f.max);
  }
  if (f.condition) {
    where.push('l.condition = ?');
    params.push(f.condition);
  }
  if (f.within) {
    const span = f.within === '24h' ? DAY : f.within === '7d' ? 7 * DAY : 30 * DAY;
    where.push('l.created_at >= ?');
    params.push(at - span);
  }
  if (f.course) {
    const code = normalizeCourseCode(f.course);
    if (!code) return { items: [], nextCursor: null };
    where.push('l.course_code = ?');
    params.push(code);
  }

  const rows = db
    .prepare(`SELECT l.* FROM market_listings l WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir.toUpperCase()}, l.id ${dir.toUpperCase()} LIMIT ?`)
    .all(...params, page.limit + 1) as ListingRow[];
  const saved = savedSetFor(viewer.id, rows.map((r) => r.id));
  return paginate(rows, page.limit, keyOf(sort), (r) => toListingCard(r, saved.has(r.id), at, viewer.id));
}

export function listSaved(viewer: AuthedUser, page: { cursor?: string; limit: number }): Paginated<ListingCard> {
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('s.created_at', 'l.id', cur, 'desc');
  const pub = publicWhere(viewer.id);
  const rows = db
    .prepare(
      `SELECT l.*, s.created_at AS saved_at FROM market_saves s JOIN market_listings l ON l.id = s.listing_id
        WHERE s.user_id = ? AND ${pub.sql} AND ${ks.sql}
        ORDER BY s.created_at DESC, l.id DESC LIMIT ?`,
    )
    .all(viewer.id, ...pub.params, ...ks.params, page.limit + 1) as (ListingRow & { saved_at: EpochMs })[];
  const at = now();
  return paginate(rows, page.limit, (r) => ({ k: r.saved_at, id: r.id }), (r) => toListingCard(r, true, at, viewer.id));
}

export function listMine(viewer: AuthedUser, state: MyListingsState, page: { cursor?: string; limit: number }): Paginated<MyListingCard> {
  const at = now();
  const cur = decodeCursor(page.cursor);
  const ks = keysetWhere('l.created_at', 'l.id', cur, 'desc');
  const stateSql = state === 'active' ? "l.state = 'active' AND l.expires_at > ?" : "(l.state IN ('sold','returned') OR l.expires_at <= ?)";
  const rows = db
    .prepare(
      `SELECT l.* FROM market_listings l WHERE l.seller_id = ? AND l.status != 'deleted' AND ${stateSql} AND ${ks.sql}
        ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
    )
    .all(viewer.id, at, ...ks.params, page.limit + 1) as ListingRow[];
  const chats = chatCountsFor(rows.map((r) => r.id));
  return paginate(rows, page.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => ({
    ...toListingCard(r, false, at, viewer.id),
    stats: { views: r.view_count, saves: r.save_count, chats: chats.get(r.id) ?? 0 },
    status: r.status,
  }));
}

/* ───────────────────────────── detail ───────────────────────────── */

/**
 * The row a viewer may open: the owner sees any non-deleted status; everyone else needs `active`, same campus, no
 * block either way, an active seller and no report of their own. Anything else is the generic 404.
 */
export function getVisibleListing(id: Id, viewer: AuthedUser): ListingRow {
  const row = getListingRow(id);
  if (!row || row.status === 'deleted') throw ApiError.notFound(LISTING_GONE_COPY);
  if (row.seller_id === viewer.id) return row;
  if (row.status !== 'active') throw ApiError.notFound(LISTING_GONE_COPY);
  if (row.university_id !== viewer.universityId) throw ApiError.notFound(LISTING_GONE_COPY);
  if (isBlockedBetween(viewer.id, row.seller_id)) throw ApiError.notFound(LISTING_GONE_COPY);
  const seller = getUserRow(row.seller_id);
  if (!seller || seller.status !== 'active') throw ApiError.notFound(LISTING_GONE_COPY);
  if (reportedIdsFor(viewer.id, 'market_listing').has(row.id)) throw ApiError.notFound(LISTING_GONE_COPY);
  return row;
}

function dayOf(at: EpochMs): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** One view per viewer per UTC day; the owner never counts. */
export function recordView(row: ListingRow, viewer: AuthedUser): void {
  if (row.seller_id === viewer.id) return;
  const at = now();
  const res = prep('INSERT OR IGNORE INTO market_views (listing_id, user_id, day) VALUES (?,?,?)').run(row.id, viewer.id, dayOf(at));
  if (res.changes > 0) {
    prep('UPDATE market_listings SET view_count = view_count + 1 WHERE id = ?').run(row.id);
    row.view_count += 1;
  }
  trackEvent('listing_view', { userId: viewer.id, universityId: viewer.universityId }, { type: row.type, category: row.category });
}

/* ───────────────────────────── validation rules ───────────────────────────── */

interface ResolvedFields {
  price: number | null;
  tradeFor: string | null;
  courseCode: string | null;
  condition: ListingCondition | null;
  locationText: string | null;
  occurredOn: string | null;
}

function fail(message: string): ApiError {
  return new ApiError(400, 'validation_failed', message);
}

/**
 * Price / tradeFor rule for all six types (SPEC §5.8): `sell` → price required (> 0), tradeFor null · `trade` → tradeFor
 * required (1–80), price optional ("or {price}") · `free` / `wanted` / `lost` / `found` → both null. Course code only on
 * textbooks; lost / found may carry a place + date; the other types drop them.
 */
export function resolveFields(input: {
  type: ListingType; category: ListingCategory; price?: number | null; tradeFor?: string | null; condition?: ListingCondition | null;
  courseCode?: string | null; locationText?: string | null; occurredOn?: string | null;
}): ResolvedFields {
  const price = typeof input.price === 'number' ? Math.round(input.price) : null;
  const tradeFor = typeof input.tradeFor === 'string' && input.tradeFor.trim() ? input.tradeFor.trim() : null;
  let out: Pick<ResolvedFields, 'price' | 'tradeFor'>;
  switch (input.type) {
    case 'sell':
      if (price === null || price <= 0) throw fail('Add a price to sell this.');
      out = { price, tradeFor: null };
      break;
    case 'trade':
      if (!tradeFor) throw fail('Say what you want to trade for.');
      if (tradeFor.length > LIMITS.listingTradeFor) throw fail(`Keep "trade for" under ${LIMITS.listingTradeFor} characters.`);
      if (price !== null && price <= 0) throw fail('A trade price must be above zero, or leave it out.');
      out = { price, tradeFor };
      break;
    default:
      if (price !== null && price > 0) throw fail(`A ${input.type} listing has no price.`);
      if (tradeFor) throw fail(`Only trade listings say what they trade for.`);
      out = { price: null, tradeFor: null };
  }
  let courseCode: string | null = null;
  if (input.category === 'textbooks' && typeof input.courseCode === 'string' && input.courseCode.trim()) {
    courseCode = normalizeCourseCode(input.courseCode);
    if (!courseCode) throw fail('That course code doesn’t look right (try "CS 314").');
  }
  const lostFound = input.type === 'lost' || input.type === 'found';
  const locationText = lostFound && typeof input.locationText === 'string' && input.locationText.trim() ? input.locationText.trim() : null;
  let occurredOn: string | null = null;
  if (lostFound && typeof input.occurredOn === 'string' && input.occurredOn.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn.trim())) throw fail('Use a date like 2026-09-21.');
    occurredOn = input.occurredOn.trim();
  }
  const condition = input.type === 'wanted' || lostFound ? null : (input.condition ?? null);
  return { ...out, courseCode, condition, locationText, occurredOn };
}

function activeCountFor(userId: Id, at: EpochMs): number {
  return (prep("SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND status IN ('active','held') AND state = 'active' AND expires_at > ?").get(userId, at) as { n: number }).n;
}

/** Electronics / tickets / bikes priced under 30 % of the category's median active price (≥ 10 comparables). */
function isLowPrice(row: Pick<ListingRow, 'id' | 'university_id' | 'category' | 'price'>, at: EpochMs): boolean {
  if (row.price === null || row.price <= 0 || !LOW_PRICE_CATEGORIES.includes(row.category)) return false;
  const prices = (
    prep(
      `SELECT price FROM market_listings WHERE university_id = ? AND category = ? AND id != ? AND status = 'active' AND state = 'active'
         AND expires_at > ? AND price IS NOT NULL AND price > 0 ORDER BY price`,
    ).all(row.university_id, row.category, row.id, at) as { price: number }[]
  ).map((r) => r.price);
  if (prices.length < LOW_PRICE_MIN_COMPARABLES) return false;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 1 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
  return row.price < median * LOW_PRICE_RATIO;
}

function applyLowPriceFlag(row: ListingRow, seller: AuthedUser, at: EpochMs): void {
  const flag = isLowPrice(row, at);
  if (flag === (row.low_price_flag === 1)) return;
  prep('UPDATE market_listings SET low_price_flag = ? WHERE id = ?').run(flag ? 1 : 0, row.id);
  row.low_price_flag = flag ? 1 : 0;
  if (flag) {
    enqueueSystemFlag({
      entityType: 'market_listing', entityId: row.id, authorId: seller.id, universityId: row.university_id, surface: 'market_listing',
      source: 'system', priority: 'p3', category: 'spam_scam',
    });
  }
}

/* ───────────────────────────── create / update ───────────────────────────── */

export function createListing(seller: AuthedUser, body: UpsertListingRequest): Listing & { moderation: AuthorNotice } {
  const at = now();
  enforceRateLimit(seller, 'listing_create');
  enforceActiveCap(seller, 'listing', activeCountFor(seller.id, at));
  const fields = resolveFields(body);
  const photos = assertOwnImages(seller, body.photos ?? [], LIMITS.listingPhotos);
  const title = body.title.trim();
  const description = (body.description ?? '').trim();
  const meetupSpot = body.meetupSpot?.trim() || null;

  const mod = moderateWrite(
    [{ text: title, field: 'title' }, { text: description }, { text: fields.tradeFor, field: 'body' }],
    modCtx(seller, 'market_listing'),
    blockedTarget(seller, 'market_listing'),
  );
  const id = newId();
  tx(() => {
    prep(
      `INSERT INTO market_listings (id, seller_id, university_id, type, category, title, description, price, trade_for, condition, course_code,
         meetup_spot, location_text, occurred_on, photos_json, status, state, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`,
    ).run(
      id, seller.id, seller.universityId, body.type, body.category, title, description, fields.price, fields.tradeFor, fields.condition,
      fields.courseCode, meetupSpot, fields.locationText, fields.occurredOn, JSON.stringify(photos), mod.persistStatus ?? 'active', at + TTL_MS, at, at,
    );
    commitModeration(mod, { ...blockedTarget(seller, 'market_listing'), entityId: id });
  });
  const row = getListingRow(id)!;
  if (row.status === 'active') applyLowPriceFlag(row, seller, at);
  trackEvent('listing_create', { userId: seller.id, universityId: seller.universityId }, { type: row.type, category: row.category, hasPhotos: photos.length > 0 });
  return { ...toListing(row, seller), moderation: toAuthorNotice(mod) };
}

export function getOwnListing(id: Id, owner: AuthedUser): ListingRow {
  const row = getListingRow(id);
  if (!row || row.status === 'deleted' || row.seller_id !== owner.id) throw ApiError.notFound(LISTING_GONE_COPY);
  return row;
}

export function updateListing(owner: AuthedUser, id: Id, patch: Partial<UpsertListingRequest>): Listing & { moderation: AuthorNotice } {
  const row = getOwnListing(id, owner);
  enforceRateLimit(owner, 'listing_edit'); // each edit re-moderates + re-pins open chats; the create limit must not be bypassed
  const at = now();
  const merged = {
    type: patch.type ?? row.type,
    category: patch.category ?? row.category,
    price: patch.price !== undefined ? patch.price : row.price,
    tradeFor: patch.tradeFor !== undefined ? patch.tradeFor : row.trade_for,
    condition: patch.condition !== undefined ? patch.condition : row.condition,
    courseCode: patch.courseCode !== undefined ? patch.courseCode : row.course_code,
    locationText: patch.locationText !== undefined ? patch.locationText : row.location_text,
    occurredOn: patch.occurredOn !== undefined ? patch.occurredOn : row.occurred_on,
  };
  const fields = resolveFields(merged);
  const title = patch.title !== undefined ? patch.title.trim() : row.title;
  const description = patch.description !== undefined ? patch.description.trim() : row.description;
  const meetupSpot = patch.meetupSpot !== undefined ? patch.meetupSpot?.trim() || null : row.meetup_spot;
  const photos = patch.photos !== undefined ? assertOwnImages(owner, patch.photos, LIMITS.listingPhotos) : photosOf(row);

  // Only changed text is re-moderated (an unchanged field would trip the duplicate detector, FOUNDATION-NOTES M2a).
  const changed: { text: string | null; field?: 'title' | 'body' }[] = [];
  if (title !== row.title) changed.push({ text: title, field: 'title' });
  if (description !== row.description) changed.push({ text: description });
  if (fields.tradeFor !== row.trade_for) changed.push({ text: fields.tradeFor, field: 'body' });
  let notice: AuthorNotice = NO_NOTICE;
  let status: ContentStatus = row.status;
  const mod = changed.length ? moderateWrite(changed, modCtx(owner, 'market_listing'), blockedTarget(owner, 'market_listing')) : null;
  if (mod) {
    notice = toAuthorNotice(mod);
    // Only an `active` row takes the engine's verdict. `held` is staff-owned pre-publication review (safety §2.1 / §2.8):
    // an author edit re-checks the changed fields only, so it must never lift the hold — the unchanged text was never
    // re-run and the open queue item stays until staff acts. `hidden` / `removed` are staff-owned too.
    if (row.status === 'active') status = mod.persistStatus ?? 'active';
  }
  // A still-held row says so to its author (the client shows the "In review" toast instead of "Listing updated").
  if (status === 'held') notice = { ...notice, status: 'held' };

  const oldPrice = row.price;
  tx(() => {
    prep(
      `UPDATE market_listings SET type = ?, category = ?, title = ?, description = ?, price = ?, trade_for = ?, condition = ?, course_code = ?,
         meetup_spot = ?, location_text = ?, occurred_on = ?, photos_json = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).run(
      merged.type, merged.category, title, description, fields.price, fields.tradeFor, fields.condition, fields.courseCode, meetupSpot,
      fields.locationText, fields.occurredOn, JSON.stringify(photos), status, at, row.id,
    );
    if (mod) commitModeration(mod, { ...blockedTarget(owner, 'market_listing'), entityId: row.id });
  });
  const updated = getListingRow(row.id)!;
  if (updated.status === 'active') applyLowPriceFlag(updated, owner, at);
  if (oldPrice !== null && updated.price !== null && updated.price < oldPrice && updated.status === 'active') {
    notifyPriceDrop(updated, owner, oldPrice, updated.price);
  }
  touchContext('listing', row.id);
  return { ...toListing(updated, owner), moderation: notice };
}

/** `market.price_drop` to every saver (actor = seller; `notify` skips blocks / self / toggles). */
function notifyPriceDrop(row: ListingRow, seller: AuthedUser, oldPrice: number, newPrice: number): void {
  const savers = prep('SELECT user_id FROM market_saves WHERE listing_id = ? AND user_id != ?').all(row.id, seller.id) as { user_id: Id }[];
  for (const s of savers) {
    notify({
      userId: s.user_id, type: 'market.price_drop', actorId: seller.id, href: `/market/${row.id}`,
      target: { entityType: 'market_listing', entityId: row.id }, thumbnailUrl: coverOf(row),
      data: { title: row.title, oldPrice, newPrice }, collapse: true,
    });
  }
  prep('UPDATE market_saves SET saved_price = ? WHERE listing_id = ?').run(newPrice, row.id);
}

export function deleteListing(owner: AuthedUser, id: Id): void {
  const row = getOwnListing(id, owner);
  const at = now();
  tx(() => {
    prep("UPDATE market_listings SET status = 'deleted', updated_at = ? WHERE id = ?").run(at, row.id);
    removeNotificationsFor({ entityType: 'market_listing', entityId: row.id });
  });
  touchContext('listing', row.id);
}

/* ───────────────────────────── sold / relist ───────────────────────────── */

export function markClosed(owner: AuthedUser, id: Id, state: 'sold' | 'returned'): Listing {
  const row = getOwnListing(id, owner);
  if (row.state !== 'active') throw ApiError.conflict(`This listing is already marked ${row.state}.`);
  const at = now();
  prep('UPDATE market_listings SET state = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(state, at, at, row.id);
  trackEvent('listing_sold', { userId: owner.id, universityId: owner.universityId }, { type: row.type, category: row.category, state });
  touchContext('listing', row.id);
  return toListing(getListingRow(row.id)!, owner);
}

/** Sold / returned / expired → live again for another 30 days; counts as a fresh post (`created_at` = now). */
export function relist(owner: AuthedUser, id: Id): Listing {
  const row = getOwnListing(id, owner);
  const at = now();
  if (stateOf(row, at) === 'active') throw ApiError.conflict('This listing is already live.');
  enforceActiveCap(owner, 'listing', activeCountFor(owner.id, at));
  prep("UPDATE market_listings SET state = 'active', closed_at = NULL, expires_at = ?, created_at = ?, updated_at = ? WHERE id = ?").run(at + TTL_MS, at, at, row.id);
  touchContext('listing', row.id);
  return toListing(getListingRow(row.id)!, owner);
}

/* ───────────────────────────── saves ───────────────────────────── */

function saveCountOf(id: Id): number {
  return (prep('SELECT COUNT(*) AS n FROM market_saves WHERE listing_id = ?').get(id) as { n: number }).n;
}

export function saveListing(viewer: AuthedUser, id: Id): SaveResponse {
  const row = getVisibleListing(id, viewer);
  if (row.seller_id === viewer.id) throw ApiError.badRequest("You can't save your own listing.");
  const at = now();
  const res = prep('INSERT OR IGNORE INTO market_saves (user_id, listing_id, saved_price, created_at) VALUES (?,?,?,?)').run(viewer.id, row.id, row.price, at);
  const saveCount = saveCountOf(row.id);
  prep('UPDATE market_listings SET save_count = ? WHERE id = ?').run(saveCount, row.id);
  if (res.changes > 0) trackEvent('listing_save', { userId: viewer.id, universityId: viewer.universityId }, { category: row.category });
  return { saved: true, saveCount };
}

export function unsaveListing(viewer: AuthedUser, id: Id): SaveResponse {
  prep('DELETE FROM market_saves WHERE user_id = ? AND listing_id = ?').run(viewer.id, id);
  const saveCount = saveCountOf(id);
  prep('UPDATE market_listings SET save_count = ? WHERE id = ?').run(saveCount, id);
  return { saved: false, saveCount };
}

/* ───────────────────────────── offers ───────────────────────────── */

/**
 * Not own, `sell` + live only. `openDm` (context pinned; the seller lands in Requests when they do not follow the
 * buyer) → `sendMessage({ kind:'offer' })` (exempt from the one-message cap; a second pending offer → 409) →
 * `notify('market.offer')`.
 */
export function makeOffer(buyer: AuthedUser, id: Id, amount: number): OfferResponse {
  const row = getVisibleListing(id, buyer);
  if (row.seller_id === buyer.id) throw ApiError.badRequest("You can't make an offer on your own listing.");
  if (row.type !== 'sell') throw ApiError.badRequest('Offers are for items that are for sale.');
  if (stateOf(row) !== 'active') throw ApiError.badRequest(LISTING_GONE_COPY);
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value <= 0) throw fail('Enter an amount above zero.');
  // offer → withdraw → offer must not loop forever (each one is a message + a notification to the seller).
  enforceRateLimit(buyer, 'offer');
  const dm = openDm(buyer, row.seller_id, { kind: 'listing', id: row.id });
  const message = sendMessage({ conversationId: dm.conversationId, sender: buyer, kind: 'offer', offer: { listingId: row.id, amount: value } });
  notify({
    userId: row.seller_id, type: 'market.offer', actorId: buyer.id, href: `/messages/${dm.conversationId}`,
    target: { entityType: 'conversation', entityId: dm.conversationId }, thumbnailUrl: coverOf(row),
    // collapsed per conversation: repeat offers within the hour refresh one unread row instead of stacking new ones
    data: { amount: value, title: row.title, listingId: row.id }, collapse: true,
  });
  trackEvent('listing_offer', { userId: buyer.id, universityId: buyer.universityId }, { category: row.category, amount: value });
  return { conversationId: dm.conversationId, messageId: message.id };
}

/* ───────────────────────────── summary ───────────────────────────── */

export function marketSummary(viewer: AuthedUser): MarketSummary {
  const at = now();
  const fresh = prep(
    "SELECT COUNT(*) AS n FROM market_listings WHERE university_id = ? AND status = 'active' AND state = 'active' AND expires_at > ? AND created_at >= ?",
  ).get(viewer.universityId, at, at - DAY) as { n: number };
  const active = prep(
    "SELECT COUNT(*) AS n FROM market_listings WHERE university_id = ? AND status = 'active' AND state = 'active' AND expires_at > ?",
  ).get(viewer.universityId, at) as { n: number };
  return { newListings24h: fresh.n, activeListings: active.n };
}

/* ───────────────────────────── moderation / lifecycle helpers ───────────────────────────── */

/** Staff status change (adapter `setStatus`): keeps `removeNotificationsFor` on removal and re-pins open chats. */
export function setListingStatus(id: Id, status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>, opts?: { immune?: boolean }): void {
  const row = getListingRow(id);
  if (!row) return;
  const at = now();
  tx(() => {
    if (opts?.immune !== undefined) {
      prep('UPDATE market_listings SET status = ?, auto_hide_immune = ?, updated_at = ? WHERE id = ?').run(status, opts.immune ? 1 : 0, at, id);
    } else {
      prep('UPDATE market_listings SET status = ?, updated_at = ? WHERE id = ?').run(status, at, id);
    }
    if (status === 'removed') removeNotificationsFor({ entityType: 'market_listing', entityId: id });
  });
  touchContext('listing', id);
}

/** Banned / deleted seller → every listing `removed` (SPEC §5.8 lifecycle hook). */
export function removeListingsOf(userId: Id): void {
  const rows = prep("SELECT id FROM market_listings WHERE seller_id = ? AND status IN ('active','held','hidden')").all(userId) as { id: Id }[];
  for (const r of rows) setListingStatus(r.id, 'removed');
}
