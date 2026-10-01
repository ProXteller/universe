/**
 * `market` seed (SPEC §5.8 / §7.5). Deterministic (`kit.rng` only), both scales, counters equal rows.
 *  - Hero campus: 60 listings at full (20 at lite) with FINAL ids `lst_0001…` — Maya owns `lst_0001` (TI-84 Plus CE),
 *    `lst_0002` (IKEA desk lamp) and the sold `lst_0003`; `lst_0061` is the held Rx-stimulant Wanted fixture (always seeded).
 *  - ~10 listings per medium campus at full (3 at lite).
 *  - Maya saved 5; listing chat ethan_ng → Maya about lst_0001 with a pending $40 offer (Chats); request chloedub → Maya
 *    about lst_0002 with one text + a pending $12 offer (Requests, first); notifications `market.offer` (unread) and
 *    `market.price_drop` (read).
 */
import type { Id } from '@shared/core';
import type { ListingCategory, ListingCondition, ListingType } from '@shared/market';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { DAY, HOUR } from '../../lib/clock';
import { U, UNI } from './ids';

interface Item {
  title: string;
  type: ListingType;
  category: ListingCategory;
  price?: number;
  tradeFor?: string;
  condition?: ListingCondition;
  course?: string;
  desc: string;
  /** Persona handle; otherwise a background user of the campus. */
  seller?: string;
  /** Closed listing: days since it was marked sold / returned. */
  closedDaysAgo?: number;
  closedState?: 'sold' | 'returned';
  locationText?: string;
  occurredOn?: string;
  /** No photos (typical for Wanted). */
  noPhotos?: boolean;
}

/* The first 20 rows are the lite set: Maya's three, ≥ 2 trade, ≥ 2 free, ≥ 2 wanted, lost + found, textbooks, 2 sold. */
const HERO: Item[] = [
  { title: 'TI-84 Plus CE', type: 'sell', category: 'electronics', price: 45, condition: 'good', seller: 'mayachen', desc: 'Graphing calculator from my calc sequence. Works perfectly, comes with the charging cable. Done with M 408D so it needs a new home.' },
  { title: 'IKEA desk lamp', type: 'sell', category: 'furniture', price: 15, condition: 'like_new', seller: 'mayachen', desc: 'White IKEA lamp, bulb included. Moving to a room with better light. Pickup at GDC or PCL.' },
  { title: 'Twin XL mattress topper', type: 'sell', category: 'dorm_kitchen', price: 25, condition: 'good', seller: 'mayachen', closedDaysAgo: 3, desc: '3-inch memory foam, twin XL. Washed the cover. Made the dorm mattress survivable.' },
  { title: 'Campbell Biology 12e', type: 'sell', category: 'textbooks', price: 35, condition: 'good', course: 'BIO 311C', seller: 'arjunp', desc: 'Hardcover, some highlighting in the first chapters. Exactly the edition the syllabus asks for.' },
  { title: 'Mini fridge with freezer', type: 'sell', category: 'dorm_kitchen', price: 60, condition: 'good', desc: 'Moving out of West Campus Dec 15, need this gone. 3.2 cu ft, freezer actually freezes. You pick up.' },
  { title: 'Hybrid bike + U-lock', type: 'sell', category: 'bikes_scooters', price: 120, condition: 'good', seller: 'lucas_oli', desc: 'Trek hybrid, 21 speed, new brake pads this semester. Kryptonite U-lock included. Exchange student, leaving in December.' },
  { title: 'Desk lamp for a fan', type: 'trade', category: 'furniture', tradeFor: 'a desk fan', condition: 'good', desc: 'Adjustable LED desk lamp with three brightness settings. My room gets hot and I would rather have a fan.' },
  { title: 'Futon, must go by Friday', type: 'free', category: 'furniture', condition: 'fair', seller: 'emmalq', desc: 'Black futon frame + mattress. Lab move, no space. Free if you can carry it down two flights of stairs.' },
  { title: 'CH 301 lab goggles', type: 'wanted', category: 'other', seller: 'chloedub', noPhotos: true, desc: 'Need a pair of the splash goggles for CH 301 lab. Will pay a few dollars or trade snacks.' },
  { title: 'Set of keys with a blue carabiner', type: 'found', category: 'other', locationText: 'Near Welch Hall, by the bike racks', occurredOn: 'today', desc: 'Found a set of keys with a blue carabiner and a small flashlight near Welch. Message me and describe the keychain.' },
  { title: 'Hoodie for a sweatshirt', type: 'trade', category: 'clothing', tradeFor: 'a size M crewneck', condition: 'like_new', desc: 'Grey UT hoodie, size M, worn twice. Would rather have a crewneck.' },
  { title: 'Rosetta Stone of Linear Algebra (M 341)', type: 'sell', category: 'textbooks', price: 20, condition: 'fair', course: 'M 408D', seller: 'meitanaka', desc: 'Lay, Linear Algebra and Its Applications. Cover is bent but everything is readable.' },
  { title: 'Lost: black North Face wallet', type: 'lost', category: 'other', locationText: 'Between PCL and the Union', occurredOn: 'yesterday', noPhotos: true, desc: 'Lost my black wallet somewhere between PCL and the Union last night. Has my student ID inside. Reward for the return, no questions.' },
  { title: '24" monitor with HDMI cable', type: 'sell', category: 'electronics', price: 70, condition: 'like_new', seller: 'jordan_builds', desc: 'Dell 24 inch 1080p. Bought it for the solar car sim, replaced with a bigger one. HDMI cable included.' },
  { title: 'Standing desk converter', type: 'free', category: 'furniture', condition: 'good', desc: 'Sit-stand converter that sits on top of a normal desk. Heavy. Free to whoever can pick it up in Hyde Park this week.' },
  { title: 'Longhorns football tickets (2)', type: 'sell', category: 'tickets', price: 90, condition: 'new', seller: 'marcusj', desc: 'Two student section tickets for the home game on the 4th. Transfer through the app.' },
  { title: 'Looking for a used road bike', type: 'wanted', category: 'bikes_scooters', seller: 'priya_n', noPhotos: true, desc: 'Something reliable for the West Campus to GDC commute. Under $150 ideally. Send me what you have.' },
  { title: 'Organic Chemistry (Klein) 4e', type: 'sell', category: 'textbooks', price: 40, condition: 'good', course: 'CH 301', seller: 'hannahkim', desc: 'Klein Organic Chemistry with the solutions manual. No writing inside.' },
  { title: 'IKEA desk, light scratches', type: 'sell', category: 'furniture', price: 40, condition: 'good', seller: 'lucas_oli', closedDaysAgo: 2, desc: 'LINNMON top with ADILS legs. A couple of scratches on the top. Comes apart in 5 minutes.' },
  { title: 'Air fryer, barely used', type: 'sell', category: 'dorm_kitchen', price: 30, condition: 'like_new', desc: 'Small 2 qt air fryer. Used it maybe 5 times. Apartment kitchen has an oven now.' },
  /* full scale continues */
  { title: 'Government 310L reader', type: 'sell', category: 'textbooks', price: 15, condition: 'fair', course: 'GOV 310L', desc: 'Course reader from last spring. Notes in the margins that honestly helped on the exams.' },
  { title: 'Mankiw Principles of Economics', type: 'sell', category: 'textbooks', price: 30, condition: 'good', course: 'ECO 304K', seller: 'arjunp', desc: 'Eighth edition, exact one the class uses. Access code already used, book is fine.' },
  { title: 'University Physics vol. 1', type: 'sell', category: 'textbooks', price: 28, condition: 'good', course: 'PHY 303K', desc: 'Young and Freedman. Some chapters have pencil notes, easily erased.' },
  { title: 'Financial Accounting textbook', type: 'sell', category: 'textbooks', price: 45, condition: 'like_new', course: 'ACC 311', seller: 'bencarter', desc: 'Basically new, I used the online version all semester.' },
  { title: 'Rhetoric 306 course packet', type: 'free', category: 'textbooks', course: 'RHE 306', desc: 'Free to whoever needs it. Pick up at the Union front desk area.' },
  { title: 'Intro to Statistics (SDS 320E)', type: 'sell', category: 'textbooks', price: 25, condition: 'good', course: 'SDS 320E', desc: 'OpenIntro print copy plus my formula sheet stuck in the back.' },
  { title: 'Psychology 301 textbook', type: 'sell', category: 'textbooks', price: 20, condition: 'fair', course: 'PSY 301', seller: 'zoemtz', desc: 'Loose binding but complete. Great class, terrible book smell, fair price.' },
  { title: 'Data Structures book (CS 314)', type: 'sell', category: 'textbooks', price: 30, condition: 'good', course: 'CS 314', seller: 'andresilva', desc: 'Weiss, Data Structures in Java. Read the first half, skimmed the second, passed.' },
  { title: 'Computer Architecture (CS 429)', type: 'trade', category: 'textbooks', tradeFor: 'an operating systems textbook', condition: 'good', course: 'CS 429', desc: 'Bryant and O Hallaron. Would swap for the OS book since that is my next class.' },
  { title: 'Calculus early transcendentals', type: 'sell', category: 'textbooks', price: 35, condition: 'good', course: 'M 408D', desc: 'Stewart 8e. Survived two semesters of calc, now it can survive yours.' },
  { title: 'Bluetooth speaker', type: 'sell', category: 'electronics', price: 25, condition: 'good', seller: 'tbrooks', desc: 'JBL Flip 5, battery still lasts a full day at the pool. Small scuff on one end.' },
  { title: 'Mechanical keyboard, brown switches', type: 'sell', category: 'electronics', price: 55, condition: 'like_new', seller: 'andresilva', desc: 'Keychron K2 with brown switches. Bought a split keyboard for my wrists, this one is like new.' },
  { title: 'iPad 9th gen with case', type: 'sell', category: 'electronics', price: 180, condition: 'good', desc: '64 GB wifi, takes notes fine with the pencil (not included). Battery holds a full day of lectures.' },
  { title: 'Wireless earbuds', type: 'sell', category: 'electronics', price: 40, condition: 'good', closedDaysAgo: 5, desc: 'Galaxy Buds, cleaned, all three tip sizes. Upgraded to over-ears.' },
  { title: 'USB-C hub', type: 'sell', category: 'electronics', price: 12, condition: 'like_new', desc: '7-in-1 hub, HDMI plus two USB-A plus card readers. No longer need it with the new laptop.' },
  { title: 'Portable monitor 15.6"', type: 'sell', category: 'electronics', price: 85, condition: 'like_new', closedDaysAgo: 12, desc: 'Great second screen for the library. Comes with the folding cover.' },
  { title: 'Desk chair, mesh back', type: 'sell', category: 'furniture', price: 35, condition: 'good', seller: 'emmalq', desc: 'Lab move sale part 2. Adjustable height, wheels roll fine on carpet and tile.' },
  { title: 'Bookshelf, 5 shelves', type: 'sell', category: 'furniture', price: 30, condition: 'fair', seller: 'marcusj', desc: 'Tall white bookshelf, one shelf has a chip. Holds a lot of textbooks and a plant.' },
  { title: 'Floor lamp', type: 'free', category: 'furniture', condition: 'fair', desc: 'Works, slightly wobbly base. Free, Riverside pickup.' },
  { title: 'Bar stools (2)', type: 'sell', category: 'furniture', price: 40, condition: 'good', closedDaysAgo: 20, desc: 'Two black bar stools, counter height. Sold as a pair.' },
  { title: 'Mini fridge for a microwave', type: 'trade', category: 'dorm_kitchen', tradeFor: 'a microwave', condition: 'good', desc: 'Small dorm fridge, works great, but I already have one and no microwave.' },
  { title: 'Rice cooker', type: 'sell', category: 'dorm_kitchen', price: 15, condition: 'good', seller: 'priya_n', desc: 'Small 3-cup rice cooker. Has made a truly heroic amount of rice.' },
  { title: 'Kitchen starter box', type: 'free', category: 'dorm_kitchen', desc: 'Plates, four mugs, a pan and a colander. Take all of it, please.' },
  { title: 'Electric kettle', type: 'sell', category: 'dorm_kitchen', price: 10, condition: 'good', closedDaysAgo: 30, desc: '1.7 L kettle with auto shutoff.' },
  { title: 'Winter coat, size S', type: 'sell', category: 'clothing', price: 35, condition: 'like_new', seller: 'sofiaram', desc: 'Warm puffer, size small. Bought for a trip up north, Austin does not need this.' },
  { title: 'Running shoes, size 10', type: 'sell', category: 'clothing', price: 30, condition: 'good', seller: 'diegoh', desc: 'Nike Pegasus, about 100 miles on them. Wrong size for me.' },
  { title: 'Rain jacket', type: 'sell', category: 'clothing', price: 20, condition: 'good', closedDaysAgo: 4, desc: 'Packable rain jacket, size M.' },
  { title: 'Concert tickets, Moody Center', type: 'sell', category: 'tickets', price: 65, condition: 'new', seller: 'marcusj', desc: 'Two tickets, section 112. Can no longer make it. Face value.' },
  { title: 'Volleyball game ticket', type: 'sell', category: 'tickets', price: 10, condition: 'new', closedDaysAgo: 9, desc: 'One ticket for Friday, student section.' },
  { title: 'Formal event ticket', type: 'sell', category: 'tickets', price: 30, condition: 'new', desc: 'One ticket to the fall formal on the 19th. Plans changed.' },
  { title: 'Electric scooter', type: 'sell', category: 'bikes_scooters', price: 190, condition: 'good', desc: 'Segway Ninebot, 15 mile range. New tires in August. Charger included.' },
  { title: 'Cruiser bike', type: 'sell', category: 'bikes_scooters', price: 80, condition: 'fair', closedDaysAgo: 1, desc: 'Single speed cruiser, basket on the front. Needs a new bell, otherwise rides fine.' },
  { title: 'Skateboard for a longboard', type: 'trade', category: 'bikes_scooters', tradeFor: 'a longboard', condition: 'good', desc: 'Regular skateboard, decent trucks. Want something better for getting to class.' },
  { title: 'Bike helmet', type: 'free', category: 'bikes_scooters', condition: 'good', desc: 'Adult medium helmet, no crashes. Free, wear it.' },
  { title: 'Looking for a mini fridge', type: 'wanted', category: 'dorm_kitchen', noPhotos: true, desc: 'Moving into Jester next month and need a small fridge. Around $40.' },
  { title: 'Wanted: monitor arm', type: 'wanted', category: 'electronics', noPhotos: true, desc: 'Single monitor arm that clamps to a desk. Will pick up anywhere on campus.' },
  { title: 'Need a Calc 1 textbook', type: 'wanted', category: 'textbooks', noPhotos: true, seller: 'graceade', desc: 'Looking for the Stewart calculus book for M 408C. Any condition is fine.' },
  { title: 'Lost: grey Hydro Flask with stickers', type: 'lost', category: 'other', locationText: 'GDC atrium', occurredOn: 'yesterday', noPhotos: true, desc: 'Left my grey Hydro Flask in the GDC atrium after a study group. Covered in stickers, one says "compile once cry twice".' },
  { title: 'Found: AirPods case near Gregory', type: 'found', category: 'electronics', locationText: 'Gregory Gym entrance', occurredOn: 'today', desc: 'Found an AirPods case (no pods inside) by the Gregory entrance. Tell me what is engraved on it.' },
  { title: 'String lights', type: 'sell', category: 'other', price: 8, condition: 'good', desc: '33 ft of warm white string lights with the remote.' },
];

const MEDIUM: Item[] = [
  { title: 'TI-Nspire CX', type: 'sell', category: 'electronics', price: 60, condition: 'good', desc: 'Graphing calculator, charger included. Done with the calc sequence.' },
  { title: 'Intro Biology textbook', type: 'sell', category: 'textbooks', price: 30, condition: 'good', desc: 'Current edition, light highlighting in the first three chapters.' },
  { title: 'Desk and chair set', type: 'sell', category: 'furniture', price: 50, condition: 'fair', desc: 'Sturdy desk with a matching chair. Moving out at the end of the term.' },
  { title: 'Mini fridge', type: 'sell', category: 'dorm_kitchen', price: 45, condition: 'good', desc: 'Dorm fridge, works great. Pickup only.' },
  { title: 'Winter boots, size 8', type: 'sell', category: 'clothing', price: 40, condition: 'like_new', desc: 'Waterproof boots, worn one winter.' },
  { title: 'Hockey tickets (2)', type: 'sell', category: 'tickets', price: 30, condition: 'new', desc: 'Two tickets for Saturday, student section.' },
  { title: 'Commuter bike', type: 'sell', category: 'bikes_scooters', price: 110, condition: 'good', desc: 'Reliable commuter with fenders and a rack. Lock included.' },
  { title: 'Floor lamp', type: 'free', category: 'furniture', condition: 'good', desc: 'Free floor lamp, you pick up.' },
  { title: 'Looking for a used monitor', type: 'wanted', category: 'electronics', noPhotos: true, desc: 'Any 24 inch monitor with HDMI. Under $60.' },
  { title: 'Textbook for a coffee', type: 'trade', category: 'textbooks', tradeFor: 'a coffee and a study session', condition: 'good', desc: 'Old psychology textbook, will trade for a coffee and help with my stats homework.' },
];

const ART_KEY: Record<ListingCategory, string> = {
  textbooks: 'textbooks', furniture: 'furniture', electronics: 'electronics', dorm_kitchen: 'kitchen', clothing: 'clothing',
  bikes_scooters: 'bikes', tickets: 'tickets', other: 'other',
};
const VARIANTS = 4;

export default function seed(kit: SeedKit): void {
  const db = kit.db;
  const lite = kit.scale === 'lite';
  const maya = kit.users.get(U.mayachen);
  const artCache = new Map<string, string>();

  const photoFor = (category: ListingCategory, variant: number): string => {
    const key = `${ART_KEY[category]}-v${variant}`;
    let url = artCache.get(key);
    if (!url) {
      url = kit.art.writeSeedSvg(`market/${key}.svg`, kit.art.productTileSvg({ category: ART_KEY[category], variant }));
      artCache.set(key, url);
    }
    return url;
  };
  const meetupsOf = (universityId: Id): string[] =>
    (db.prepare("SELECT name FROM campus_places WHERE university_id = ? AND kind = 'meetup' ORDER BY sort, name").all(universityId) as { name: string }[]).map((r) => r.name);

  const insertListing = db.prepare(
    `INSERT INTO market_listings (id, seller_id, university_id, type, category, title, description, price, trade_for, condition, course_code,
       meetup_spot, location_text, occurred_on, photos_json, status, state, closed_at, expires_at, low_price_flag, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertSave = db.prepare('INSERT OR IGNORE INTO market_saves (user_id, listing_id, saved_price, created_at) VALUES (?,?,?,?)');
  const insertView = db.prepare('INSERT OR IGNORE INTO market_views (listing_id, user_id, day) VALUES (?,?,?)');

  const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
  const dateOf = (word: string | undefined, createdAt: number): string | null => {
    if (!word) return null;
    if (word === 'today') return dayOf(createdAt);
    if (word === 'yesterday') return dayOf(createdAt - DAY);
    return word;
  };

  interface Placed {
    id: Id;
    seller: SeedUser;
    universityId: Id;
    price: number | null;
    createdAt: number;
    title: string;
    category: ListingCategory;
    type: ListingType;
    closed: boolean;
    status: 'active' | 'held';
  }
  const placed: Placed[] = [];
  let n = 0;

  const place = (item: Item, universityId: Id, sellerPool: SeedUser[], meetups: string[], i: number, total: number, opts: { id?: Id; status?: 'active' | 'held'; createdAt?: number } = {}): Placed => {
    n += 1;
    const id = opts.id ?? kit.id('lst', n);
    const seller = item.seller ? kit.users.get(item.seller) : kit.pick(sellerPool);
    const createdAt = opts.createdAt ?? kit.spread(i, total);
    const closed = item.closedDaysAgo !== undefined;
    const closedAt = closed ? Math.max(createdAt + HOUR, kit.now - item.closedDaysAgo! * DAY) : null;
    const photos = item.noPhotos
      ? []
      : Array.from({ length: item.type === 'wanted' ? 0 : kit.int(1, 3) }, () => ({ url: photoFor(item.category, kit.int(0, VARIANTS - 1)), width: 960, height: 960 }));
    const meetup = item.type === 'lost' || item.type === 'found' ? null : meetups.length ? kit.pick(meetups) : null;
    const price = item.price ?? null;
    const status = opts.status ?? 'active';
    insertListing.run(
      id, seller.id, universityId, item.type, item.category, item.title, item.desc, price, item.tradeFor ?? null, item.condition ?? null,
      item.course ?? null, meetup, item.locationText ?? null, dateOf(item.occurredOn, createdAt), JSON.stringify(photos), status,
      closed ? (item.closedState ?? (item.type === 'lost' || item.type === 'found' ? 'returned' : 'sold')) : 'active', closedAt,
      createdAt + 30 * DAY, 0, createdAt, closedAt ?? createdAt,
    );
    kit.track('listing_create', seller, { type: item.type, category: item.category }, createdAt);
    const p: Placed = { id, seller, universityId, price, createdAt, title: item.title, category: item.category, type: item.type, closed, status };
    placed.push(p);
    return p;
  };

  /* ───────── hero campus ───────── */
  const heroPool = kit.users.bg(UNI.utexas);
  const heroMeetups = meetupsOf(UNI.utexas);
  const heroItems = lite ? HERO.slice(0, 20) : HERO;
  heroItems.forEach((item, i) => {
    // Maya's two active listings are recent so they sit near the top of Browse and her My listings tab.
    const createdAt = i === 0 ? kit.ago({ h: 5 }) : i === 1 ? kit.ago({ d: 1, h: 3 }) : i === 2 ? kit.ago({ d: 9 }) : undefined;
    place(item, UNI.utexas, heroPool, heroMeetups, i, heroItems.length, createdAt !== undefined ? { createdAt } : {});
  });

  // Moderation fixture (FINAL id): a Wanted listing seeking a prescription stimulant, held for review. Seeds write SQL
  // directly, so the engine's 422 does not apply; the admin seed builds its queue rows through the adapter.
  const fixtureSeller = kit.pick(heroPool.filter((u) => u.id !== maya.id));
  n = 60;
  place(
    {
      title: 'Looking for Adderall for finals week', type: 'wanted', category: 'other', noPhotos: true,
      desc: 'Anyone have a few spare study pills? Will pay cash, dm me.', seller: fixtureSeller.handle,
    },
    UNI.utexas, heroPool, heroMeetups, 0, 1, { id: kit.id('lst', 61), status: 'held', createdAt: kit.ago({ h: 20 }) },
  );

  /* ───────── medium campuses ───────── */
  for (const uni of [UNI.umich, UNI.stanford, UNI.nyu]) {
    const pool = [...kit.users.bg(uni), ...kit.users.personas.filter((u) => u.universityId === uni)];
    if (pool.length === 0) continue;
    const meetups = meetupsOf(uni);
    const items = lite ? MEDIUM.slice(0, 3) : MEDIUM;
    items.forEach((item, i) => place(item, uni, pool, meetups, i, items.length));
  }

  /* ───────── saves (Maya 5 + background), views ───────── */
  const heroPlaced = placed.filter((p) => p.universityId === UNI.utexas && p.status === 'active');
  const mayaSaves = ['lst_0004', 'lst_0006', 'lst_0008', 'lst_0012', 'lst_0016'];
  const byId = new Map(placed.map((p) => [p.id, p]));
  for (const id of mayaSaves) {
    const p = byId.get(id);
    if (!p || p.seller.id === maya.id) continue;
    insertSave.run(maya.id, id, p.price, kit.int(p.createdAt + HOUR, kit.now - HOUR));
  }
  for (const p of placed) {
    if (p.status !== 'active') continue;
    const pool = kit.users.bg(p.universityId).filter((u) => u.id !== p.seller.id);
    if (pool.length === 0) continue;
    const savers = kit.sample(pool, kit.int(0, Math.min(4, pool.length)));
    for (const s of savers) insertSave.run(s.id, p.id, p.price, kit.int(p.createdAt + HOUR, Math.max(p.createdAt + 2 * HOUR, kit.now - HOUR)));
    const viewers = kit.sample(pool, kit.int(2, Math.min(18, pool.length)));
    for (const v of viewers) insertView.run(p.id, v.id, dayOf(kit.int(p.createdAt, kit.now)));
  }
  // Maya looked at a few listings too.
  for (const id of mayaSaves) if (byId.has(id)) insertView.run(id, maya.id, dayOf(kit.ago({ h: kit.int(2, 40) })));

  db.exec(
    `UPDATE market_listings SET
       save_count = (SELECT COUNT(*) FROM market_saves s WHERE s.listing_id = market_listings.id),
       view_count = (SELECT COUNT(*) FROM market_views v WHERE v.listing_id = market_listings.id)`,
  );

  /* ───────── Maya's listing chats (§7.5) ───────── */
  const ethan = kit.users.get(U.ethan_ng);
  const chloe = kit.users.get(U.chloedub);
  const ti84 = byId.get('lst_0001')!;
  const lamp = byId.get('lst_0002')!;

  // ethan_ng → Maya about lst_0001 (Maya follows him → Chats), one text + a pending $40 offer.
  const ethanChat = kit.convo.dm(ethan.id, maya.id, { context: { kind: 'listing', id: ti84.id } });
  const t1 = kit.ago({ h: 3, m: 10 });
  kit.convo.say(ethanChat, ethan.id, 'Hey Maya! Is the TI-84 still available? I need one for M 408D.', t1);
  kit.convo.say(ethanChat, maya.id, 'It is! Still works like new, comes with the cable.', t1 + 6 * 60_000);
  kit.convo.say(ethanChat, ethan.id, 'Would you take $40 for it? I can meet at PCL whenever.', t1 + 14 * 60_000);
  const offerAt = t1 + 15 * 60_000;
  kit.convo.say(ethanChat, ethan.id, '', offerAt, { kind: 'offer', offer: { listingId: ti84.id, amount: 40 } });
  kit.notify({
    userId: maya.id, type: 'market.offer', actorId: ethan.id, href: `/messages/${ethanChat}`,
    target: { entityType: 'conversation', entityId: ethanChat }, data: { amount: 40, title: ti84.title, listingId: ti84.id },
    collapse: false, createdAt: offerAt, read: false,
  });

  // chloedub → Maya about lst_0002: a stranger (Maya does not follow her) → sits first in Requests. Silent: no notification row.
  const chloeChat = kit.convo.dm(chloe.id, maya.id, { context: { kind: 'listing', id: lamp.id }, peerState: 'request' });
  const t2 = kit.ago({ h: 1, m: 25 });
  kit.convo.say(chloeChat, chloe.id, 'Is the lamp still available?', t2);
  kit.convo.say(chloeChat, chloe.id, '', t2 + 2 * 60_000, { kind: 'offer', offer: { listingId: lamp.id, amount: 12 } });

  // A price drop on one of Maya's saved listings (read).
  const dropped = byId.get('lst_0006');
  if (dropped && dropped.price !== null) {
    const oldPrice = dropped.price + 20;
    db.prepare('UPDATE market_saves SET saved_price = ? WHERE user_id = ? AND listing_id = ?').run(dropped.price, maya.id, dropped.id);
    kit.notify({
      userId: maya.id, type: 'market.price_drop', actorId: dropped.seller.id, href: `/market/${dropped.id}`,
      target: { entityType: 'market_listing', entityId: dropped.id }, data: { title: dropped.title, oldPrice, newPrice: dropped.price },
      collapse: true, createdAt: kit.ago({ d: 2, h: 4 }), read: true,
    });
  }

  // Maya browsed the market a few times (analytics).
  for (const p of heroPlaced.slice(3, 8)) kit.track('listing_view', maya, { type: p.type, category: p.category }, kit.ago({ h: kit.int(1, 60) }));
}
