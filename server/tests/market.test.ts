/**
 * `market` slice tests (SPEC §5.8) — isolation mode only (`createTestApp({ slices: ['market'] })`).
 * Covers: price / tradeFor rules (table-driven), filters / sort / search / course, campus isolation, moderation
 * (Rx-stimulant Wanted → 422, tradeFor moderated, held fixture visibility, notice hygiene), muted 403 on every create
 * route, save + price-drop fan-out, views once per day, sold → `conversation.updated`, 7-day sold window + 30-day
 * expiry (clock), relist, the stranger offer flow (text → offer inside a pending request, 409 on a second offer,
 * seller accept → both active), block both ways, card resolver statuses, adapter + lifecycle, summary, seed invariants.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Listing, ListingCard, MyListingCard, UpsertListingRequest } from '@shared/market';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import { DAY, HOUR, now, setNow } from '../src/lib/clock';
import { getContentAdapter, resolveCard, runUserLifecycleHooks } from '../src/lib/content';
import { getMembership, sendMessage, setOfferStatus } from '../src/lib/conversations';
import { applySanction } from '../src/lib/moderation/staff';
import { badgesFor } from '../src/lib/notify';
import { getAuthedUser } from '../src/lib/users';
import { resolveFields } from '../src/services/market/listings';

const PHOTO = { url: '/seed-media/generated/market/test-tile.svg', width: 960, height: 960 };
/** A quiet campus with no seeded listings: clean-room browse counts. */
const QUIET = 'uni_utoronto';

let seq = 0;
/** Unique title + description per call so the duplicate detector never holds a test write. */
function body(over: Partial<UpsertListingRequest> = {}): UpsertListingRequest {
  seq += 1;
  return {
    type: 'sell',
    category: 'electronics',
    title: `Test item ${seq}`,
    description: `Perfectly ordinary item number ${seq}, pickup on campus after class.`,
    price: 40,
    condition: 'good',
    meetupSpot: 'Library lobby',
    photos: [PHOTO],
    ...over,
  };
}

const FORBIDDEN_NOTICE_KEYS = ['matches', 'ruleId', 'signals', 'engine'];
function assertNoticeHygiene(b: unknown): void {
  const text = JSON.stringify(b);
  for (const k of FORBIDDEN_NOTICE_KEYS) expect(text.includes(`"${k}"`)).toBe(false);
}

/* ───────────────────────────── pure rules ───────────────────────────── */

describe('resolveFields — price / tradeFor rule for all six types', () => {
  it.each([
    ['sell needs a price', { type: 'sell', category: 'other' }, /price/i],
    ['sell price must be > 0', { type: 'sell', category: 'other', price: 0 }, /price/i],
    ['trade needs tradeFor', { type: 'trade', category: 'other' }, /trade/i],
    ['trade price, when given, must be > 0', { type: 'trade', category: 'other', tradeFor: 'a fan', price: 0 }, /above zero/i],
    ['free has no price', { type: 'free', category: 'other', price: 5 }, /no price/i],
    ['wanted has no price', { type: 'wanted', category: 'other', price: 5 }, /no price/i],
    ['lost has no price', { type: 'lost', category: 'other', price: 5 }, /no price/i],
    ['found has no price', { type: 'found', category: 'other', price: 5 }, /no price/i],
    ['free has no tradeFor', { type: 'free', category: 'other', tradeFor: 'x' }, /trade/i],
    ['wanted has no tradeFor', { type: 'wanted', category: 'other', tradeFor: 'x' }, /trade/i],
    ['bad course code', { type: 'sell', category: 'textbooks', price: 10, courseCode: 'not a code' }, /course code/i],
    ['bad date', { type: 'lost', category: 'other', occurredOn: '9/21/2026' }, /date/i],
  ] as const)('%s → 400', (_label, input, re) => {
    expect(() => resolveFields(input as Parameters<typeof resolveFields>[0])).toThrow(re);
  });

  it.each([
    ['sell', { type: 'sell', category: 'other', price: 40, tradeFor: 'ignored' }, { price: 40, tradeFor: null }],
    ['trade (no price)', { type: 'trade', category: 'other', tradeFor: '  a desk fan ' }, { price: null, tradeFor: 'a desk fan' }],
    ['trade or price', { type: 'trade', category: 'other', tradeFor: 'a desk fan', price: 20 }, { price: 20, tradeFor: 'a desk fan' }],
    ['free', { type: 'free', category: 'other', price: null }, { price: null, tradeFor: null }],
    ['wanted', { type: 'wanted', category: 'other' }, { price: null, tradeFor: null }],
    ['lost', { type: 'lost', category: 'other' }, { price: null, tradeFor: null }],
    ['found', { type: 'found', category: 'other' }, { price: null, tradeFor: null }],
  ] as const)('%s → ok', (_label, input, expected) => {
    const out = resolveFields(input as Parameters<typeof resolveFields>[0]);
    expect(out.price).toBe(expected.price);
    expect(out.tradeFor).toBe(expected.tradeFor);
  });

  it('course code only on textbooks and normalised; place + date only on lost / found; condition dropped for wanted / lost / found', () => {
    expect(resolveFields({ type: 'sell', category: 'textbooks', price: 10, courseCode: 'cs314' }).courseCode).toBe('CS 314');
    expect(resolveFields({ type: 'sell', category: 'electronics', price: 10, courseCode: 'cs314' }).courseCode).toBeNull();
    const lost = resolveFields({ type: 'lost', category: 'other', locationText: ' PCL ', occurredOn: '2026-09-20', condition: 'good' });
    expect(lost).toMatchObject({ locationText: 'PCL', occurredOn: '2026-09-20', condition: null });
    const sell = resolveFields({ type: 'sell', category: 'other', price: 3, locationText: 'PCL', occurredOn: '2026-09-20', condition: 'fair' });
    expect(sell).toMatchObject({ locationText: null, occurredOn: null, condition: 'fair' });
    expect(resolveFields({ type: 'wanted', category: 'other', condition: 'good' }).condition).toBeNull();
  });
});

/* ───────────────────────────── API ───────────────────────────── */

describe('market API', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ slices: ['market'], seed: 'all' });
  });
  afterEach(() => setNow(null));

  const create = async (userId: string, over: Partial<UpsertListingRequest> = {}): Promise<Listing> => {
    const res = await ctx.as(userId).post('/api/market/listings').send(body(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Listing;
  };
  const browse = async (userId: string, query = ''): Promise<ListingCard[]> => {
    const res = await ctx.as(userId).get(`/api/market/listings${query ? `?${query}` : ''}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as ListingCard[];
  };

  it('401 without a session; validation 400 on body, query and params', async () => {
    expect((await ctx.anon().get('/api/market/listings')).status).toBe(401);
    expect((await ctx.anon().post('/api/market/listings').send(body())).status).toBe(401);
    expect((await ctx.anon().get('/api/market/summary')).status).toBe(401);
    const maya = ctx.as('mayachen');
    const bad = await maya.post('/api/market/listings').send({ type: 'sell', category: 'nope', title: '', photos: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    expect((await maya.get('/api/market/listings?sort=cheapest')).status).toBe(400);
    expect((await maya.get('/api/market/listings?type=barter')).status).toBe(400);
    expect((await maya.get('/api/market/mine?state=archived')).status).toBe(400);
    expect((await maya.post('/api/market/listings/lst_0001/sold').send({ state: 'gone' })).status).toBe(400);
    expect((await maya.post('/api/market/listings/lst_0004/offers').send({ amount: -5 })).status).toBe(400);
    const tooManyPhotos = await maya.post('/api/market/listings').send(body({ photos: Array.from({ length: 7 }, () => PHOTO) }));
    expect(tooManyPhotos.status).toBe(400);
  });

  it('seed (§7.5): Maya has 2 active + 1 sold, 5 saved, the ethan_ng chat with a pending $40 offer and the chloedub request', async () => {
    const maya = ctx.as('mayachen');
    const active = (await maya.get('/api/market/mine?state=active')).body.items as MyListingCard[];
    expect(active.map((l) => l.id).sort()).toEqual(['lst_0001', 'lst_0002']);
    for (const l of active) {
      expect(l.stats).toBeTruthy();
      expect(typeof l.stats.views).toBe('number');
      expect(l.status).toBe('active');
    }
    const closed = (await maya.get('/api/market/mine?state=closed')).body.items as MyListingCard[];
    expect(closed.map((l) => l.id)).toEqual(['lst_0003']);
    expect(closed[0]!.state).toBe('sold');
    const saved = (await maya.get('/api/market/saved')).body.items as ListingCard[];
    expect(saved).toHaveLength(5);
    for (const s of saved) expect(s.saved).toBe(true);

    const ti84 = (await maya.get('/api/market/listings/lst_0001')).body as Listing;
    expect(ti84.title).toBe('TI-84 Plus CE');
    expect(ti84.price).toBe(45);
    expect(ti84.viewer.isSelf).toBe(true);
    expect(ti84.stats!.chats).toBe(1);
    const lamp = (await maya.get('/api/market/listings/lst_0002')).body as Listing;
    expect(lamp.price).toBe(15);
    expect(lamp.stats!.chats).toBe(1);

    // pending offers: $40 from ethan_ng (Chats: Maya follows him), $12 from chloedub (Requests)
    const offers = ctx.db
      .prepare("SELECT sender_id, offer_amount, offer_listing_id FROM messages WHERE kind = 'offer' AND offer_status = 'pending' ORDER BY offer_amount DESC")
      .all() as { sender_id: string; offer_amount: number; offer_listing_id: string }[];
    expect(offers).toEqual([
      { sender_id: 'u_ethan_ng', offer_amount: 40, offer_listing_id: 'lst_0001' },
      { sender_id: 'u_chloedub', offer_amount: 12, offer_listing_id: 'lst_0002' },
    ]);
    const chloeConv = ctx.db.prepare("SELECT id FROM conversations WHERE context_kind = 'listing' AND context_id = 'lst_0002'").get() as { id: string };
    expect(getMembership(chloeConv.id, 'u_mayachen')!.state).toBe('request');
    const ethanConv = ctx.db.prepare("SELECT id FROM conversations WHERE context_kind = 'listing' AND context_id = 'lst_0001'").get() as { id: string };
    expect(getMembership(ethanConv.id, 'u_mayachen')!.state).toBe('active');
    expect(badgesFor('u_mayachen').requests).toBe(1);

    // notifications: market.offer (unread, from ethan_ng) + market.price_drop (read)
    const notes = ctx.db
      .prepare("SELECT type, actor_id, read_at FROM notifications WHERE user_id = 'u_mayachen' AND type LIKE 'market.%' ORDER BY type")
      .all() as { type: string; actor_id: string | null; read_at: number | null }[];
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ type: 'market.offer', actor_id: 'u_ethan_ng', read_at: null });
    expect(notes[1]!.type).toBe('market.price_drop');
    expect(notes[1]!.read_at).not.toBeNull();

    // counters equal rows
    const drift = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM market_listings l WHERE l.save_count != (SELECT COUNT(*) FROM market_saves s WHERE s.listing_id = l.id)
           OR l.view_count != (SELECT COUNT(*) FROM market_views v WHERE v.listing_id = l.id)`,
      )
      .get() as { n: number };
    expect(drift.n).toBe(0);
    // ≥ 4 trade listings carry trade_for (full); ≥ 2 at lite
    const trades = ctx.db.prepare("SELECT COUNT(*) AS n FROM market_listings WHERE type = 'trade' AND trade_for IS NOT NULL").get() as { n: number };
    expect(trades.n).toBeGreaterThanOrEqual(2);
  });

  it('seed: the held Rx-stimulant Wanted fixture lst_0061 is visible only to its author', async () => {
    const row = ctx.db.prepare('SELECT seller_id, status, type FROM market_listings WHERE id = ?').get('lst_0061') as { seller_id: string; status: string; type: string };
    expect(row.status).toBe('held');
    expect(row.type).toBe('wanted');
    const own = await ctx.as(row.seller_id).get('/api/market/listings/lst_0061');
    expect(own.status).toBe(200);
    expect(own.body.status).toBe('held');
    const mine = (await ctx.as(row.seller_id).get('/api/market/mine?state=active')).body.items as MyListingCard[];
    expect(mine.find((l) => l.id === 'lst_0061')?.status).toBe('held');
    const other = await ctx.as('mayachen').get('/api/market/listings/lst_0061');
    expect(other.status).toBe(404);
    expect(other.body.error.message).toBe('This listing is no longer available.');
    const all = await browse('mayachen', 'limit=50&type=wanted');
    expect(all.some((l) => l.id === 'lst_0061')).toBe(false);
  });

  it('browse: filters, sort, search, course code; campus isolation', async () => {
    const all = await browse('mayachen', 'limit=50');
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.some((l) => l.id === 'lst_0001')).toBe(true);
    // never another campus
    const heroIds = new Set(all.map((l) => l.id));
    const foreign = ctx.db.prepare("SELECT id FROM market_listings WHERE university_id != 'uni_utexas'").all() as { id: string }[];
    expect(foreign.length).toBeGreaterThan(0);
    for (const f of foreign) expect(heroIds.has(f.id)).toBe(false);
    // held / hidden rows never in browse
    expect(all.some((l) => l.id === 'lst_0061')).toBe(false);
    // newest first by default
    const created = all.map((l) => l.createdAt);
    expect(created).toEqual([...created].sort((a, b) => b - a));

    const trade = await browse('mayachen', 'type=trade&limit=50');
    expect(trade.length).toBeGreaterThanOrEqual(2);
    for (const t of trade) {
      expect(t.type).toBe('trade');
      expect(t.tradeFor).toBeTruthy();
    }
    const books = await browse('mayachen', 'category=textbooks&limit=50');
    expect(books.length).toBeGreaterThanOrEqual(3);
    for (const b of books) expect(b.category).toBe('textbooks');
    const priced = await browse('mayachen', 'min=30&max=60&limit=50');
    expect(priced.length).toBeGreaterThan(0);
    for (const p of priced) {
      expect(p.price).not.toBeNull();
      expect(p.price!).toBeGreaterThanOrEqual(30);
      expect(p.price!).toBeLessThanOrEqual(60);
    }
    const likeNew = await browse('mayachen', 'condition=like_new&limit=50');
    expect(likeNew.length).toBeGreaterThan(0);
    const recent = await browse('mayachen', 'within=24h&limit=50');
    expect(recent.some((l) => l.id === 'lst_0001')).toBe(true);
    for (const r of recent) expect(now() - r.createdAt).toBeLessThanOrEqual(DAY);
    const asc = await browse('mayachen', 'sort=price_asc&limit=50');
    const ascPrices = asc.map((l) => l.price ?? 0);
    expect(ascPrices).toEqual([...ascPrices].sort((a, b) => a - b));
    const desc = await browse('mayachen', 'sort=price_desc&limit=50');
    const descPrices = desc.map((l) => l.price ?? 0);
    expect(descPrices).toEqual([...descPrices].sort((a, b) => b - a));
    const lamp = await browse('mayachen', 'q=lamp&limit=50');
    expect(lamp.some((l) => l.id === 'lst_0002')).toBe(true);
    for (const l of lamp) expect(l.title.toLowerCase().includes('lamp') || (l.courseCode ?? '').toLowerCase().includes('lamp')).toBe(true);
    const bio = await browse('mayachen', 'course=bio311c&limit=50');
    expect(bio.map((l) => l.id)).toContain('lst_0004');
    for (const b of bio) expect(b.courseCode).toBe('BIO 311C');
    expect(await browse('mayachen', 'course=%3F%3F&limit=50')).toEqual([]);

    // pagination: keyset cursor walks the whole campus without gaps or repeats
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await ctx.as('mayachen').get(`/api/market/listings?limit=6${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...(res.body.items as ListingCard[]).map((l) => l.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(all.map((l) => l.id).sort());

    // another campus sees only its own rows
    const umich = await browse('ninakow', 'limit=50');
    expect(umich.length).toBeGreaterThan(0);
    for (const u of umich) expect(heroIds.has(u.id)).toBe(false);
    expect((await ctx.as('ninakow').get('/api/market/listings/lst_0001')).status).toBe(404);
  });

  it('price / tradeFor rules through the API for all six types (table-driven)', async () => {
    const u = ctx.createUser({ universityId: QUIET });
    const cases: { over: Partial<UpsertListingRequest>; status: number; price?: number | null; tradeFor?: string | null }[] = [
      { over: { type: 'sell', price: 40 }, status: 201, price: 40, tradeFor: null },
      { over: { type: 'sell', price: null }, status: 400 },
      { over: { type: 'sell', price: 0 }, status: 400 },
      { over: { type: 'trade', price: null, tradeFor: 'a desk fan' }, status: 201, price: null, tradeFor: 'a desk fan' },
      { over: { type: 'trade', price: 25, tradeFor: 'a desk fan' }, status: 201, price: 25, tradeFor: 'a desk fan' },
      { over: { type: 'trade', price: null, tradeFor: '' }, status: 400 },
      { over: { type: 'trade', price: null, tradeFor: 'x'.repeat(81) }, status: 400 },
      { over: { type: 'free', price: null }, status: 201, price: null, tradeFor: null },
      { over: { type: 'free', price: 5 }, status: 400 },
      { over: { type: 'wanted', price: null, photos: [] }, status: 201, price: null, tradeFor: null },
      { over: { type: 'wanted', price: null, tradeFor: 'x' }, status: 400 },
      { over: { type: 'lost', price: null, locationText: 'GDC atrium', occurredOn: '2026-09-20' }, status: 201, price: null, tradeFor: null },
      { over: { type: 'lost', price: 5 }, status: 400 },
      { over: { type: 'found', price: null, locationText: 'Union' }, status: 201, price: null, tradeFor: null },
      { over: { type: 'found', price: null, tradeFor: 'a coffee' }, status: 400 },
    ];
    for (const c of cases) {
      const res = await ctx.as(u.id).post('/api/market/listings').send(body(c.over));
      expect(res.status, `${JSON.stringify(c.over)} → ${JSON.stringify(res.body)}`).toBe(c.status);
      if (c.status === 201) {
        expect(res.body.price).toBe(c.price);
        expect(res.body.tradeFor).toBe(c.tradeFor);
        expect(res.body.moderation.status).toBe('active');
        assertNoticeHygiene(res.body);
      } else {
        expect(res.body.error.code).toBe('validation_failed');
      }
    }
    // course code: textbooks only, normalised; invalid → 400
    const book = await create(u.id, { category: 'textbooks', courseCode: 'cs314' });
    expect(book.courseCode).toBe('CS 314');
    const notBook = await create(u.id, { category: 'furniture', courseCode: 'cs314' });
    expect(notBook.courseCode).toBeNull();
    const badCode = await ctx.as(u.id).post('/api/market/listings').send(body({ category: 'textbooks', courseCode: 'hello world' }));
    expect(badCode.status).toBe(400);
    // a trade card renders "for {tradeFor}"
    const tradeCard = resolveCard({ kind: 'listing', id: (await create(u.id, { type: 'trade', price: null, tradeFor: 'a longboard' })).id }, u.id);
    expect(tradeCard.subtitle).toBe('for a longboard');
    expect(tradeCard.badge).toBe('TRADE');
  });

  it('moderation: Rx-stimulant Wanted → 422 content_blocked with notice hygiene; tradeFor is moderated too', async () => {
    const u = ctx.createUser({ universityId: QUIET });
    const res = await ctx.as(u.id).post('/api/market/listings').send(
      body({ type: 'wanted', price: null, photos: [], category: 'other', title: 'Looking for Adderall for finals week', description: 'Anyone have a few spare study pills? Will pay cash, dm me.' }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('content_blocked');
    expect(res.body.error.details.category).toBe('drugs_illegal_sales');
    assertNoticeHygiene(res.body);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ?').get(u.id) as { n: number }).n).toBe(0);

    const trade = await ctx.as(u.id).post('/api/market/listings').send(
      body({ type: 'trade', price: null, category: 'other', title: 'Old headphones', description: 'Work fine, a bit scuffed.', tradeFor: 'a few spare adderall' }),
    );
    expect(trade.status).toBe(422);
    expect(trade.body.error.code).toBe('content_blocked');
    assertNoticeHygiene(trade.body);

    // an edit re-moderates only the changed text: patching the description to a prohibited offer is blocked
    const ok = await create(u.id);
    const patched = await ctx.as(u.id).patch(`/api/market/listings/${ok.id}`).send({ description: 'also have a few spare adderall for finals, cash only' });
    expect(patched.status).toBe(422);
    const unchanged = await ctx.as(u.id).patch(`/api/market/listings/${ok.id}`).send({ price: 35 });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.price).toBe(35);
    expect(unchanged.body.moderation.status).toBe('active');
  });

  it('moderation: an author edit never lifts a held listing (only the changed text is re-checked; the held text stays unpublished)', async () => {
    const u = ctx.createUser({ universityId: QUIET });
    const other = ctx.createUser({ universityId: QUIET });
    // deposit_scam on the commerce surface → FLAG held (safety §2.6 table), not a block: the row exists as `held`
    const res = await ctx.as(u.id).post('/api/market/listings').send(
      body({ description: 'Great condition. Venmo the deposit to hold it and I will bring it to campus next week.' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('held');
    expect(res.body.moderation.status).toBe('held');
    assertNoticeHygiene(res.body);
    const id = res.body.id as string;
    expect((await ctx.as(other.id).get(`/api/market/listings/${id}`)).status).toBe(404);
    const queued = () =>
      (ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_type = 'market_listing' AND entity_id = ? AND status = 'open'").get(id) as { n: number }).n;
    expect(queued()).toBe(1);

    // a clean title-only patch: the held description is untouched (never re-run) → the row must stay held
    const patched = await ctx.as(u.id).patch(`/api/market/listings/${id}`).send({ title: 'Clean retitled item' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.title).toBe('Clean retitled item');
    expect(patched.body.status).toBe('held');
    expect(patched.body.moderation.status).toBe('held');
    assertNoticeHygiene(patched.body);
    expect((ctx.db.prepare('SELECT status FROM market_listings WHERE id = ?').get(id) as { status: string }).status).toBe('held');
    expect((await ctx.as(other.id).get(`/api/market/listings/${id}`)).status).toBe(404);
    expect((await browse(other.id, 'limit=50')).some((l) => l.id === id)).toBe(false);
    expect(queued()).toBe(1);

    // a non-text patch does not lift it either, and the author is told it is still in review
    const price = await ctx.as(u.id).patch(`/api/market/listings/${id}`).send({ price: 30 });
    expect(price.status).toBe(200);
    expect(price.body.price).toBe(30);
    expect(price.body.status).toBe('held');
    expect(price.body.moderation.status).toBe('held');
    expect((await ctx.as(other.id).get(`/api/market/listings/${id}`)).status).toBe(404);
  });

  it('muted user → 403 muted on POST /listings, PATCH /listings/:id and POST /listings/:id/relist', async () => {
    const u = ctx.createUser({ universityId: QUIET });
    const admin = ctx.createUser({ role: 'admin' });
    const own = await create(u.id);
    const sold = await ctx.as(u.id).post(`/api/market/listings/${own.id}/sold`).send({ state: 'sold' });
    expect(sold.status).toBe(200);
    applySanction({ userId: u.id, kind: 'mute', durationMs: 24 * HOUR, category: 'harassment_bullying', actor: admin, delayed: false });
    const post = await ctx.as(u.id).post('/api/market/listings').send(body());
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('muted');
    const patch = await ctx.as(u.id).patch(`/api/market/listings/${own.id}`).send({ title: 'renamed' });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('muted');
    const relist = await ctx.as(u.id).post(`/api/market/listings/${own.id}/relist`);
    expect(relist.status).toBe(403);
    expect(relist.body.error.code).toBe('muted');
  });

  it('create → detail (seller card, trust chips, viewer state); owner stats; views counted once per viewer per day, never the owner', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const viewer = ctx.createUser({ universityId: QUIET });
    const created = await create(seller.id, { title: 'Desk chair, mesh back', price: 35, category: 'furniture' });
    expect(created.state).toBe('active');
    expect(created.expiresAt - created.createdAt).toBe(30 * DAY);
    expect(created.photos).toEqual([PHOTO]);
    expect(created.coverUrl).toBe(PHOTO.url);
    expect(created.seller.id).toBe(seller.id);
    expect(created.sellerTrust.isNewAccount).toBe(false);
    expect(created.sellerTrust.activeListings).toBe(1);
    expect(created.viewer).toEqual({ isSelf: true, hasConversation: false, conversationId: null, requestPending: false, hasPendingOffer: false });
    expect(created.stats).toEqual({ views: 0, saves: 0, chats: 0 });

    const first = (await ctx.as(viewer.id).get(`/api/market/listings/${created.id}`)).body as Listing;
    expect(first.stats).toBeNull();
    expect(first.viewer.isSelf).toBe(false);
    expect(first.saved).toBe(false);
    await ctx.as(viewer.id).get(`/api/market/listings/${created.id}`);
    await ctx.as(seller.id).get(`/api/market/listings/${created.id}`);
    let own = (await ctx.as(seller.id).get(`/api/market/listings/${created.id}`)).body as Listing;
    expect(own.stats!.views).toBe(1);
    setNow(now() + DAY + HOUR);
    await ctx.as(viewer.id).get(`/api/market/listings/${created.id}`);
    own = (await ctx.as(seller.id).get(`/api/market/listings/${created.id}`)).body as Listing;
    expect(own.stats!.views).toBe(2);
    setNow(null);
    // a brand-new seller shows the "New account" chip
    const fresh = ctx.createUser({ universityId: QUIET, createdAt: now() - 2 * DAY });
    const freshListing = await create(fresh.id);
    expect(freshListing.sellerTrust.isNewAccount).toBe(true);
    // unknown id → the generic copy
    const gone = await ctx.as(viewer.id).get('/api/market/listings/nope');
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toBe('This listing is no longer available.');
  });

  it('save / unsave, saved list, price-drop fan-out to savers (not on increases, never the seller)', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const saver = ctx.createUser({ universityId: QUIET });
    const other = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { price: 100 });
    const own = await ctx.as(seller.id).put(`/api/market/listings/${l.id}/save`);
    expect(own.status).toBe(400);
    const saved = await ctx.as(saver.id).put(`/api/market/listings/${l.id}/save`);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ saved: true, saveCount: 1 });
    expect((await ctx.as(saver.id).put(`/api/market/listings/${l.id}/save`)).body.saveCount).toBe(1);
    const list = (await ctx.as(saver.id).get('/api/market/saved')).body.items as ListingCard[];
    expect(list.map((x) => x.id)).toEqual([l.id]);
    expect(list[0]!.saved).toBe(true);
    expect(((await ctx.as(saver.id).get(`/api/market/listings/${l.id}`)).body as Listing).saved).toBe(true);
    expect(((await ctx.as(seller.id).get(`/api/market/listings/${l.id}`)).body as Listing).stats!.saves).toBe(1);

    const up = await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ price: 120 });
    expect(up.status).toBe(200);
    const notesFor = (uid: string) =>
      ctx.db.prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'market.price_drop'").all(uid) as { data_json: string }[];
    expect(notesFor(saver.id)).toHaveLength(0);
    const down = await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ price: 80 });
    expect(down.status).toBe(200);
    expect(down.body.price).toBe(80);
    const notes = notesFor(saver.id);
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0]!.data_json)).toMatchObject({ oldPrice: 120, newPrice: 80, title: l.title });
    expect(notesFor(other.id)).toHaveLength(0);
    expect(notesFor(seller.id)).toHaveLength(0);
    expect(ctx.wsEventsFor(saver.id).some((e) => e.type === 'notification' && e.notification.type === 'market.price_drop')).toBe(true);

    const un = await ctx.as(saver.id).delete(`/api/market/listings/${l.id}/save`);
    expect(un.body).toEqual({ saved: false, saveCount: 0 });
    expect((await ctx.as(saver.id).get('/api/market/saved')).body.items).toEqual([]);
  });

  it('sold: leaves browse after 7 days, `conversation.updated` for open chats, returned for lost/found, relist; expiry after 30 days (clock)', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const buyer = ctx.createUser({ universityId: QUIET, follows: [] });
    const l = await create(seller.id, { price: 60 });
    const dm = await ctx.as(buyer.id).post('/api/dm').send({ userId: seller.id, context: { kind: 'listing', id: l.id } });
    expect(dm.status).toBe(200);
    const convId = dm.body.conversationId as string;

    const notOwner = await ctx.as(buyer.id).post(`/api/market/listings/${l.id}/sold`).send({ state: 'sold' });
    expect(notOwner.status).toBe(404);
    const sold = await ctx.as(seller.id).post(`/api/market/listings/${l.id}/sold`).send({ state: 'sold' });
    expect(sold.status).toBe(200);
    expect(sold.body.state).toBe('sold');
    expect(ctx.wsEventsFor(buyer.id).some((e) => e.type === 'conversation.updated' && e.conversationId === convId)).toBe(true);
    expect((await ctx.as(seller.id).post(`/api/market/listings/${l.id}/sold`).send({ state: 'sold' })).status).toBe(409);
    expect(resolveCard({ kind: 'listing', id: l.id }, buyer.id).status).toBe('sold');
    expect(resolveCard({ kind: 'listing', id: l.id }, buyer.id).badge).toBe('Sold');
    // sold stays in browse (ribbon) for 7 days, in "closed" for the owner
    const still = await browse(buyer.id, 'limit=50');
    expect(still.find((x) => x.id === l.id)?.state).toBe('sold');
    expect(((await ctx.as(seller.id).get('/api/market/mine?state=closed')).body.items as ListingCard[]).map((x) => x.id)).toContain(l.id);
    expect(((await ctx.as(seller.id).get('/api/market/mine?state=active')).body.items as ListingCard[]).map((x) => x.id)).not.toContain(l.id);
    // no new conversations / offers about a sold listing
    const offer = await ctx.as(buyer.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 50 });
    expect(offer.status).toBe(400);
    setNow(now() + 8 * DAY);
    expect((await browse(buyer.id, 'limit=50')).some((x) => x.id === l.id)).toBe(false);
    setNow(null);

    // relist → live again, fresh 30 days
    const relist = await ctx.as(seller.id).post(`/api/market/listings/${l.id}/relist`);
    expect(relist.status).toBe(200);
    expect(relist.body.state).toBe('active');
    expect((await browse(buyer.id, 'limit=50')).find((x) => x.id === l.id)?.state).toBe('active');
    expect((await ctx.as(seller.id).post(`/api/market/listings/${l.id}/relist`)).status).toBe(409);
    expect(ctx.wsEventsFor(buyer.id).filter((e) => e.type === 'conversation.updated' && e.conversationId === convId).length).toBeGreaterThanOrEqual(2);

    // lost / found close as "returned"
    const found = await create(seller.id, { type: 'found', price: null, category: 'other', locationText: 'Gym entrance' });
    const returned = await ctx.as(seller.id).post(`/api/market/listings/${found.id}/sold`).send({ state: 'returned' });
    expect(returned.body.state).toBe('returned');
    expect(resolveCard({ kind: 'listing', id: found.id }, buyer.id).status).toBe('returned');

    // 30-day expiry: gone from browse, "closed" for the owner as expired, card unavailable; relist revives it
    const fresh = await create(seller.id, { price: 10 });
    setNow(now() + 31 * DAY);
    expect((await browse(buyer.id, 'limit=50')).some((x) => x.id === fresh.id)).toBe(false);
    const closed = (await ctx.as(seller.id).get('/api/market/mine?state=closed')).body.items as ListingCard[];
    expect(closed.find((x) => x.id === fresh.id)?.state).toBe('expired');
    expect(resolveCard({ kind: 'listing', id: fresh.id }, buyer.id).status).toBe('unavailable');
    expect((await ctx.as(buyer.id).post(`/api/market/listings/${fresh.id}/offers`).send({ amount: 5 })).status).toBe(400);
    const revived = await ctx.as(seller.id).post(`/api/market/listings/${fresh.id}/relist`);
    expect(revived.status).toBe(200);
    expect(revived.body.state).toBe('active');
    expect((await browse(buyer.id, 'limit=50')).some((x) => x.id === fresh.id)).toBe(true);
    setNow(null);
  });

  it('offers: a stranger messages then offers inside a pending request; second offer 409; seller accept → both active', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const buyer = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { price: 100 });
    const dm = await ctx.as(buyer.id).post('/api/dm').send({ userId: seller.id, context: { kind: 'listing', id: l.id } });
    expect(dm.status).toBe(200);
    const convId = dm.body.conversationId as string;
    expect(getMembership(convId, seller.id)!.state).toBe('request');

    // one text until accepted (the messages route would run moderateWrite first; the lib enforces the cap)
    sendMessage({ conversationId: convId, sender: buyer, kind: 'text', text: 'Is this still available?' });
    expect(() => sendMessage({ conversationId: convId, sender: buyer, kind: 'text', text: 'Hello again?' })).toThrow(/accept your request/i);

    let detail = (await ctx.as(buyer.id).get(`/api/market/listings/${l.id}`)).body as Listing;
    expect(detail.viewer).toMatchObject({ hasConversation: true, conversationId: convId, requestPending: true, hasPendingOffer: false });

    // the offer is exempt from the cap
    const offer = await ctx.as(buyer.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 80 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    expect(offer.body.conversationId).toBe(convId);
    const msg = ctx.db.prepare('SELECT kind, offer_status, offer_amount, offer_listing_id, sender_id FROM messages WHERE id = ?').get(offer.body.messageId) as Record<string, unknown>;
    expect(msg).toEqual({ kind: 'offer', offer_status: 'pending', offer_amount: 80, offer_listing_id: l.id, sender_id: buyer.id });
    const note = ctx.db.prepare("SELECT actor_id, href, data_json FROM notifications WHERE user_id = ? AND type = 'market.offer'").get(seller.id) as { actor_id: string; href: string; data_json: string };
    expect(note.actor_id).toBe(buyer.id);
    expect(note.href).toBe(`/messages/${convId}`);
    expect(JSON.parse(note.data_json)).toMatchObject({ amount: 80, title: l.title, listingId: l.id });
    detail = (await ctx.as(buyer.id).get(`/api/market/listings/${l.id}`)).body as Listing;
    expect(detail.viewer.hasPendingOffer).toBe(true);
    expect(detail.viewer.requestPending).toBe(true);

    const second = await ctx.as(buyer.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 85 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');

    // the seller accepts from Requests → the request is accepted for both sides
    setOfferStatus(offer.body.messageId, seller, 'accept');
    expect(getMembership(convId, seller.id)!.state).toBe('active');
    expect(getMembership(convId, buyer.id)!.state).toBe('active');
    detail = (await ctx.as(buyer.id).get(`/api/market/listings/${l.id}`)).body as Listing;
    expect(detail.viewer).toMatchObject({ hasConversation: true, conversationId: convId, requestPending: false, hasPendingOffer: false });
    expect(((await ctx.as(seller.id).get(`/api/market/listings/${l.id}`)).body as Listing).stats!.chats).toBe(1);

    // a second offer after the first settled is fine again
    expect((await ctx.as(buyer.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 90 })).status).toBe(201);
  });

  it('offers: own listing 400; only `sell` listings; unknown listing 404; a follower lands straight in Chats', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { price: 50 });
    const own = await ctx.as(seller.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 40 });
    expect(own.status).toBe(400);
    const free = await create(seller.id, { type: 'free', price: null });
    const friend = ctx.createUser({ universityId: QUIET });
    // seller follows the buyer → no request state
    ctx.db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(seller.id, friend.id, now());
    expect((await ctx.as(friend.id).post(`/api/market/listings/${free.id}/offers`).send({ amount: 5 })).status).toBe(400);
    expect((await ctx.as(friend.id).post('/api/market/listings/nope/offers').send({ amount: 5 })).status).toBe(404);
    const ok = await ctx.as(friend.id).post(`/api/market/listings/${l.id}/offers`).send({ amount: 45 });
    expect(ok.status).toBe(201);
    expect(getMembership(ok.body.conversationId, seller.id)!.state).toBe('active');
    const detail = (await ctx.as(friend.id).get(`/api/market/listings/${l.id}`)).body as Listing;
    expect(detail.viewer).toMatchObject({ requestPending: false, hasPendingOffer: true, conversationId: ok.body.conversationId });
  });

  it('block hides listings both ways (browse, detail, card resolver)', async () => {
    const a = ctx.createUser({ universityId: QUIET });
    const b = ctx.createUser({ universityId: QUIET });
    const la = await create(a.id);
    const lb = await create(b.id);
    expect((await browse(a.id, 'limit=50')).some((x) => x.id === lb.id)).toBe(true);
    const blocked = await ctx.as(a.id).post(`/api/users/${b.id}/block`);
    expect(blocked.status).toBe(200);
    expect((await browse(a.id, 'limit=50')).some((x) => x.id === lb.id)).toBe(false);
    expect((await browse(b.id, 'limit=50')).some((x) => x.id === la.id)).toBe(false);
    expect((await ctx.as(a.id).get(`/api/market/listings/${lb.id}`)).status).toBe(404);
    expect((await ctx.as(b.id).get(`/api/market/listings/${la.id}`)).status).toBe(404);
    expect(resolveCard({ kind: 'listing', id: lb.id }, a.id).status).toBe('unavailable');
    expect(resolveCard({ kind: 'listing', id: la.id }, b.id).status).toBe('unavailable');
    expect((await ctx.as(b.id).post(`/api/market/listings/${la.id}/offers`).send({ amount: 5 })).status).toBe(404);
    // a viewer who reported a listing no longer sees it
    const c = ctx.createUser({ universityId: QUIET });
    const report = await ctx.as(c.id).post('/api/reports').send({ entityType: 'market_listing', entityId: la.id, reason: 'spam_scam', subReason: 'scam_fake' });
    expect(report.status).toBe(200);
    expect((await browse(c.id, 'limit=50')).some((x) => x.id === la.id)).toBe(false);
    expect((await ctx.as(c.id).get(`/api/market/listings/${la.id}`)).status).toBe(404);
  });

  it('card resolver: available / sold / returned / unavailable (expired, deleted, hidden), price, badge, meetupSpot, ownerId', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const viewer = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { price: 45, meetupSpot: 'Library lobby', category: 'electronics' });
    let card = resolveCard({ kind: 'listing', id: l.id }, viewer.id);
    expect(card).toMatchObject({ kind: 'listing', id: l.id, title: l.title, status: 'available', price: 45, badge: null, ownerId: seller.id, meetupSpot: 'Library lobby', href: `/market/${l.id}`, imageUrl: PHOTO.url });
    expect(card.currency).toBe('CAD');
    const free = await create(seller.id, { type: 'free', price: null });
    expect(resolveCard({ kind: 'listing', id: free.id }, viewer.id).badge).toBe('FREE');
    const wanted = await create(seller.id, { type: 'wanted', price: null, photos: [] });
    expect(resolveCard({ kind: 'listing', id: wanted.id }, viewer.id)).toMatchObject({ badge: 'WANTED', imageUrl: null });
    const lost = await create(seller.id, { type: 'lost', price: null });
    expect(resolveCard({ kind: 'listing', id: lost.id }, viewer.id).badge).toBe('LOST');
    const found = await create(seller.id, { type: 'found', price: null });
    expect(resolveCard({ kind: 'listing', id: found.id }, viewer.id).badge).toBe('FOUND');
    // hidden by staff → unavailable for everyone but still loadable for staff through the adapter
    const adapter = getContentAdapter('market_listing')!;
    adapter.setStatus(l.id, 'hidden');
    card = resolveCard({ kind: 'listing', id: l.id }, viewer.id);
    expect(card.status).toBe('unavailable');
    expect((await ctx.as(viewer.id).get(`/api/market/listings/${l.id}`)).status).toBe(404);
    expect(((await ctx.as(seller.id).get(`/api/market/listings/${l.id}`)).body as Listing).status).toBe('hidden');
    adapter.setStatus(l.id, 'active');
    expect(resolveCard({ kind: 'listing', id: l.id }, viewer.id).status).toBe('available');
    // deleted → unavailable, title "No longer available"
    expect((await ctx.as(viewer.id).delete(`/api/market/listings/${l.id}`)).status).toBe(404);
    expect((await ctx.as(seller.id).delete(`/api/market/listings/${l.id}`)).status).toBe(204);
    card = resolveCard({ kind: 'listing', id: l.id }, viewer.id);
    expect(card.status).toBe('unavailable');
    expect(card.title).toBe('No longer available');
    expect((await ctx.as(seller.id).get(`/api/market/listings/${l.id}`)).status).toBe(404);
    expect(((await ctx.as(seller.id).get('/api/market/mine?state=active')).body.items as ListingCard[]).some((x) => x.id === l.id)).toBe(false);
  });

  it('content adapter + lifecycle hook: load snapshot, removed clears notifications, banned seller → listings removed', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const saver = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { price: 100, type: 'sell', title: 'Adapter fixture', description: 'Snapshot me.' });
    const adapter = getContentAdapter('market_listing')!;
    const snap = adapter.load(l.id)!;
    expect(snap).toMatchObject({ entityType: 'market_listing', entityId: l.id, authorId: seller.id, universityId: QUIET, status: 'active', surface: 'market_listing', anon: false, label: 'listing', href: `/market/${l.id}` });
    expect(snap.fields).toEqual([{ field: 'title', text: 'Adapter fixture' }, { field: 'body', text: 'Snapshot me.' }]);
    expect(snap.media).toEqual([{ url: PHOTO.url, kind: 'image' }]);
    expect(adapter.load('nope')).toBeNull();

    await ctx.as(saver.id).put(`/api/market/listings/${l.id}/save`);
    await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ price: 50 });
    const before = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'market.price_drop'").get(saver.id) as { n: number };
    expect(before.n).toBe(1);
    adapter.setStatus(l.id, 'removed');
    const after = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'market.price_drop'").get(saver.id) as { n: number };
    expect(after.n).toBe(0);
    expect(adapter.load(l.id)!.status).toBe('removed');
    expect(((await ctx.as(seller.id).get(`/api/market/listings/${l.id}`)).body as Listing).status).toBe('removed');

    const other = await create(seller.id);
    runUserLifecycleHooks('onBanned', seller.id);
    expect(adapter.load(other.id)!.status).toBe('removed');
    expect((await ctx.as(saver.id).get(`/api/market/listings/${other.id}`)).status).toBe(404);
  });

  it('summary counts the viewer campus only; my listings tabs; delete is owner-only', async () => {
    const u = ctx.createUser({ universityId: 'uni_ethz' });
    const v = ctx.createUser({ universityId: 'uni_ethz' });
    const before = (await ctx.as(u.id).get('/api/market/summary')).body as { newListings24h: number; activeListings: number };
    const l = await create(u.id);
    await create(u.id, { type: 'free', price: null });
    const after = (await ctx.as(v.id).get('/api/market/summary')).body as { newListings24h: number; activeListings: number };
    expect(after.activeListings).toBe(before.activeListings + 2);
    expect(after.newListings24h).toBe(before.newListings24h + 2);
    const mayaSummary = (await ctx.as('mayachen').get('/api/market/summary')).body as { activeListings: number };
    expect(mayaSummary.activeListings).toBeGreaterThan(after.activeListings);
    const mine = (await ctx.as(u.id).get('/api/market/mine')).body.items as MyListingCard[];
    expect(mine).toHaveLength(2);
    expect(mine[0]!.stats).toEqual({ views: 0, saves: 0, chats: 0 });
    expect((await ctx.as(v.id).delete(`/api/market/listings/${l.id}`)).status).toBe(404);
    expect((await ctx.as(u.id).delete(`/api/market/listings/${l.id}`)).status).toBe(204);
    expect((await ctx.as(u.id).delete(`/api/market/listings/${l.id}`)).status).toBe(404);
    expect(((await ctx.as(v.id).get('/api/market/summary')).body as { activeListings: number }).activeListings).toBe(before.activeListings + 1);
  });

  it('edit: photos re-validated, type switch re-runs the rule, meetup spot and course code editable, touchContext fires', async () => {
    const seller = ctx.createUser({ universityId: QUIET });
    const buyer = ctx.createUser({ universityId: QUIET });
    const l = await create(seller.id, { category: 'textbooks', price: 30 });
    const dm = await ctx.as(buyer.id).post('/api/dm').send({ userId: seller.id, context: { kind: 'listing', id: l.id } });
    const convId = dm.body.conversationId as string;
    const badPhoto = await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ photos: [{ url: '/uploads/not-mine.jpg', width: 1, height: 1 }] });
    expect(badPhoto.status).toBe(404);
    const toTrade = await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ type: 'trade' });
    expect(toTrade.status).toBe(400);
    const ok = await ctx.as(seller.id).patch(`/api/market/listings/${l.id}`).send({ type: 'trade', tradeFor: 'an OS textbook', courseCode: 'cs 429', meetupSpot: 'Union desk', photos: [] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ type: 'trade', tradeFor: 'an OS textbook', price: 30, courseCode: 'CS 429', meetupSpot: 'Union desk', photos: [], coverUrl: null });
    expect(ctx.wsEventsFor(buyer.id).some((e) => e.type === 'conversation.updated' && e.conversationId === convId)).toBe(true);
    expect(resolveCard({ kind: 'listing', id: l.id }, buyer.id).subtitle).toBe('for an OS textbook');
    const notOwner = await ctx.as(buyer.id).patch(`/api/market/listings/${l.id}`).send({ title: 'hijack' });
    expect(notOwner.status).toBe(404);
    expect(getAuthedUser(seller.id)).not.toBeNull();
  });
});
