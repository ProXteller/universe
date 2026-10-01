/**
 * `roommates` seed (SPEC §5.7 / §7.5). Deterministic (`kit.rng` only), both scales, idempotent under db:reset.
 *
 *  - Maya's profile complete + published, `published_at` / `confirmed_at` ≤ 14 d (no 13th notification).
 *  - ~35 published hero-campus posts at full (12 at lite), incl. the personas of §7.2; compat vs Maya spans ~38–97 %
 *    (≥ 3 profiles ≥ 90 %, ≥ 4 < 50 %, ≥ 1 capped by her smoking dealbreaker: calebt).
 *  - One background user has an UNPUBLISHED match-preferences row (never listed).
 *  - Maya saved 3; one roommate DM Maya ↔ zoemtz with a context card (`kit.convo.dm`, silent).
 */
import type { EpochMs, Id, MediaImage } from '@shared/core';
import type { LivingWith, RoommateAnswers, RoommateGender, RoommateMode, RoommatePlace } from '@shared/roommates';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { archetypeOf } from '../../services/roommates/compat';
import { HERO_UNI, U } from './ids';

type Answers = RoommateAnswers;

interface Spec {
  handle: string;
  mode: RoommateMode;
  answers: Answers;
  dealbreakSmoking?: boolean;
  dealbreakPets?: boolean;
  budget: number;
  /** Months from now (1–12). */
  moveInMonths: number;
  lease?: number | null;
  hoods: string[];
  livingWith?: LivingWith;
  gender?: RoommateGender | null;
  about: string;
  place?: RoommatePlace;
  photos?: number;
  /** Only at full scale. */
  fullOnly?: boolean;
}

const A = (sleep: number, clean: number, noise: number, guests: number, hosting: number, smoking: number, pets: number, sharing: number): Answers =>
  ({ sleep, clean, noise, guests, hosting, smoking, pets, sharing }) as Answers;

/** Maya: around midnight, pretty tidy, quiet weeknights, occasional guests, rare parties, smoke-free, pet-friendly, asks first. */
export const MAYA_ANSWERS: Answers = A(1, 2, 1, 1, 1, 0, 1, 1);

const HOODS = ['West Campus', 'North Campus', 'Hyde Park', 'Riverside', 'On campus'];

/* Persona posts. Answers are written relative to Maya's so the §7.5 compat spread is exact:
   Δ1 on a 20-pt question costs 6.7, on 15 → 5, on 10 → 3.3, on 5 → 1.7; Δ2 doubles, Δ3 triples. */
const PERSONAS: Spec[] = [
  // ≥ 90 % (three)
  { handle: 'zoemtz', mode: 'need', answers: A(1, 2, 1, 1, 0, 0, 1, 1), budget: 850, moveInMonths: 10, lease: 12, hoods: ['West Campus', 'North Campus'],
    about: 'Psych sophomore, mostly at PCL or the gym. Quiet weeknights, brunch on weekends. Looking for a 2-bed near West Campus for August.' },          // 98
  { handle: 'andresilva', mode: 'need', answers: A(1, 2, 1, 2, 1, 0, 1, 1), budget: 800, moveInMonths: 10, lease: 12, hoods: ['North Campus', 'Hyde Park'],
    about: 'CS sophomore. Hack Night regular, keeps the kitchen clean, headphones on after 10. Would love a place with fast wifi.' },                  // 97
  { handle: 'hannahkim', mode: 'need', answers: A(1, 2, 0, 1, 1, 0, 1, 1), budget: 950, moveInMonths: 9, lease: 12, hoods: ['Hyde Park', 'North Campus'],
    about: 'Bio junior, study sessions most evenings so I like it quiet. Early lab days. Tidy, no drama, plants welcome.' },                         // 95
  // 80s
  { handle: 'sofiaram', mode: 'need', answers: A(0, 3, 1, 1, 0, 0, 1, 1), budget: 750, moveInMonths: 10, lease: 12, hoods: ['Riverside', 'West Campus'],
    about: 'Nursing sophomore with 6 am clinicals, so I am asleep by 10:30. Spotless kitchen person. Need a place by August, budget is tight.' },      // 85
  { handle: 'meitanaka', mode: 'need', answers: A(1, 3, 0, 0, 0, 0, 0, 1), budget: 900, moveInMonths: 8, lease: 12, hoods: ['North Campus'],
    about: 'Math senior, tutoring in the evenings. Very tidy and very quiet — if that sounds like your speed, say hi.', fullOnly: true },              // 80
  // has-a-place posts
  { handle: 'priya_n', mode: 'have', answers: A(1, 2, 1, 1, 0, 0, 0, 2), budget: 1100, moveInMonths: 2, lease: 12, hoods: ['North Campus'],
    about: 'MS Data Science, international. I have a furnished 2-bed 2-bath near North Campus and my roommate graduates in December. Private room, your share is 1100 with water included.',
    place: { rent: 1100, roomType: 'private', beds: 2, baths: 2, furnished: true, utilitiesIncluded: false }, photos: 3 },                            // 91
  { handle: 'samirk', mode: 'have', answers: A(2, 2, 2, 2, 1, 0, 1, 2), budget: 700, moveInMonths: 1, lease: 6, hoods: ['Riverside'],
    about: 'Grad student, room opening up in a 3-bed in Riverside on the bus line. Chill house, we cook together sometimes. Six-month lease is fine.',
    place: { rent: 700, roomType: 'private', beds: 3, baths: 2, furnished: false, utilitiesIncluded: true }, photos: 2 },                            // 80
  { handle: 'marcusj', mode: 'have', answers: A(2, 1, 2, 2, 2, 0, 1, 2), budget: 650, moveInMonths: 3, lease: 12, hoods: ['West Campus'],
    about: 'Econ senior. Big West Campus apartment, one room free in January. We host a game night about once a month. Shared bathroom.',
    place: { rent: 650, roomType: 'shared', beds: 4, baths: 2, furnished: true, utilitiesIncluded: false }, photos: 2, fullOnly: true },              // 68
  // quiet / mid
  { handle: 'emmalq', mode: 'need', answers: A(0, 2, 0, 0, 0, 0, 1, 0), budget: 1000, moveInMonths: 6, lease: 12, hoods: ['Hyde Park', 'North Campus'],
    about: 'Chemistry PhD, TA. I keep a quiet household and early hours. Looking for one calm roommate in Hyde Park.' },                             // 80
  { handle: 'lucas_oli', mode: 'need', answers: A(2, 1, 2, 2, 1, 0, 1, 2), budget: 800, moveInMonths: 11, lease: 6, hoods: ['West Campus', 'On campus'],
    about: 'Architecture exchange student, here for two semesters. Easygoing, cook a lot, bike everywhere. Short lease preferred.', fullOnly: true }, // 77
  // < 50 % (four) + capped
  { handle: 'tbrooks', mode: 'need', answers: A(3, 0, 3, 3, 3, 0, 2, 3), budget: 700, moveInMonths: 10, lease: 12, hoods: ['West Campus'],
    about: 'Freshman, business (probably). Intramurals, late nights, always down to have people over. Looking for a fun house in West Campus.' },      // 47
  { handle: 'diegoh', mode: 'need', answers: A(3, 0, 3, 3, 2, 1, 3, 3), budget: 650, moveInMonths: 10, lease: 12, hoods: ['Riverside', 'West Campus'],
    about: 'Kinesiology junior, pickup soccer most evenings, I have a very friendly dog named Pancho. Loud, messy, happy.' },                          // 40
  { handle: 'laylah', mode: 'need', answers: A(3, 0, 3, 3, 2, 0, 3, 2), budget: 900, moveInMonths: 9, lease: 12, hoods: ['Hyde Park'],
    about: 'Architecture sophomore with a cat (Mochi). Studio nights run late. Looking for a pet-friendly 2-bed in Hyde Park.' },                      // 47
  { handle: 'oliviab', mode: 'need', answers: A(3, 0, 3, 3, 3, 1, 2, 3), budget: 850, moveInMonths: 8, lease: 12, hoods: ['West Campus'],
    about: 'Marketing junior, events board volunteer, social battery never dies. Want roommates who like a full apartment.', fullOnly: true },         // 38
  { handle: 'calebt', mode: 'need', answers: A(3, 1, 2, 2, 2, 3, 1, 2), budget: 800, moveInMonths: 10, lease: 12, hoods: ['Riverside'],
    about: 'Civil engineering junior, night owl. I smoke on the balcony, never inside. Looking for a laid-back place near the bus line.' },           // capped 35
  { handle: 'ethan_ng', mode: 'need', answers: A(2, 2, 2, 1, 1, 0, 1, 1), budget: 950, moveInMonths: 10, lease: 12, hoods: ['North Campus', 'Hyde Park'],
    about: 'ECE senior, project nights in the lab. Tidy enough, some music at home, otherwise low key.', fullOnly: true },                             // 85
  { handle: 'fatima_as', mode: 'need', answers: A(0, 2, 1, 1, 0, 0, 0, 1), budget: 700, moveInMonths: 10, lease: 12, hoods: ['On campus', 'North Campus'],
    about: 'Public Health junior, pantry volunteer, early riser. No pets please (allergies). Budget-conscious, happy to share groceries.', fullOnly: true }, // 88
];

const BG_ABOUT = [
  'Second-year, mostly on campus during the day. Looking for someone respectful of quiet hours and shared spaces.',
  'Transfer student new to Austin. I cook, I clean up after myself, I keep to myself on weeknights.',
  'Grad student with a regular schedule. Prefer a calm apartment near a bus line.',
  'Junior, part-time job on weekends. Easygoing about most things except dishes in the sink.',
  'Senior finishing up. Need a place for one more year, ideally walking distance to campus.',
  'Sophomore, gym in the mornings, library in the evenings. Tidy and low drama.',
  'Looking for a roommate who is okay with the occasional study group at the kitchen table.',
  'International student, first year in the US. Friendly, organised, love trying new food spots.',
];

/** Deterministic answer set for a background user at a chosen "distance" band from Maya (spreads the ranking). */
function bgAnswers(kit: SeedKit, band: 0 | 1 | 2 | 3): Answers {
  const out: Answers = { ...MAYA_ANSWERS };
  const keys = Object.keys(out) as (keyof Answers)[];
  const shifts = band === 0 ? 1 : band === 1 ? 2 : band === 2 ? 4 : 6;
  for (let i = 0; i < shifts; i++) {
    const q = kit.pick(keys);
    const delta = kit.chance(0.5) ? 1 : -1;
    const next = Math.max(0, Math.min(3, out[q] + delta * (band >= 2 && kit.chance(0.5) ? 2 : 1)));
    out[q] = next as Answers[keyof Answers];
  }
  return out;
}

function moveIn(kit: SeedKit, monthsFromNow: number): string {
  const d = new Date(kit.now);
  const m = d.getUTCMonth() + monthsFromNow;
  const y = d.getUTCFullYear() + Math.floor(m / 12);
  const mm = (m % 12) + 1;
  return `${y}-${String(mm).padStart(2, '0')}`;
}

function photosFor(kit: SeedKit, id: Id, n: number): MediaImage[] {
  const out: MediaImage[] = [];
  for (let k = 0; k < n; k++) {
    const url = kit.art.writeSeedSvg(`roommates/${id}-${k + 1}.svg`, kit.art.nebulaSvg({ seed: `${id}:${k}`, aspect: '4:5', glyph: k === 0 ? 'home' : undefined }));
    out.push({ url, width: 1080, height: 1350, alt: k === 0 ? 'Living room' : 'Bedroom' });
  }
  return out;
}

export default function seed(kit: SeedKit): void {
  const db = kit.db;
  const ins = db.prepare(
    `INSERT INTO roommate_profiles (id, user_id, university_id, mode, budget, move_in, lease_months, neighborhoods_json, living_with, gender, about,
       photos_json, place_json, answers_json, dealbreak_smoking, dealbreak_pets, archetype, status, auto_hide_immune, paused, low_price_flag,
       published_at, confirmed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',0,0,0,?,?,?,?)`,
  );
  let n = 0;
  const idFor = (): Id => kit.id('rm', ++n);

  function insert(user: SeedUser, s: Omit<Spec, 'handle' | 'fullOnly'>, at: EpochMs, opts: { published: boolean; id?: Id }): Id {
    const id = opts.id ?? idFor();
    const photos = s.photos ? photosFor(kit, id, s.photos) : [];
    ins.run(
      id, user.id, user.universityId, s.mode, s.budget, moveIn(kit, s.moveInMonths), s.lease ?? null, JSON.stringify(s.hoods),
      s.livingWith ?? 'anyone', s.gender ?? null, s.about, JSON.stringify(photos), s.place ? JSON.stringify(s.place) : null,
      JSON.stringify(s.answers), s.dealbreakSmoking ? 1 : 0, s.dealbreakPets ? 1 : 0, archetypeOf(s.answers),
      opts.published ? at : null, opts.published ? at : null, at, at,
    );
    return id;
  }

  /* Maya — complete, published ≤ 14 d ago (§7.5: the still-looking hook must not fire). */
  const maya = kit.users.get(U.mayachen);
  const mayaAt = kit.ago({ d: 9, h: 3 });
  insert(
    maya,
    {
      mode: 'need', answers: MAYA_ANSWERS, dealbreakSmoking: true, dealbreakPets: false, budget: 900, moveInMonths: 10, lease: 12,
      hoods: ['West Campus', 'North Campus'], livingWith: 'anyone', gender: 'woman',
      about: 'CS junior, usually at GDC or the Union. Quiet on weeknights, happy to host a study group now and then. Looking for a 2-bed near West or North Campus for August.',
    },
    mayaAt,
    { published: true, id: kit.id('rm', 1) },
  );
  n = Math.max(n, 1);

  /* Personas (full: all 17; lite: the 11 that are not fullOnly → 12 posts with Maya's). */
  const personaSpecs = PERSONAS.filter((s) => kit.scale === 'full' || !s.fullOnly);
  const total = personaSpecs.length + (kit.scale === 'full' ? 20 : 0);
  let i = 0;
  const idByHandle = new Map<string, Id>();
  for (const s of personaSpecs) {
    const user = kit.users.get(s.handle);
    const at = kit.spread(i++, total);
    idByHandle.set(s.handle, insert(user, s, at, { published: true }));
  }

  /* Background users (full only): 20 published posts spread across the compat bands. */
  const bg = kit.users.bg(HERO_UNI);
  const used = new Set<Id>();
  if (kit.scale === 'full') {
    const pool = kit.sample(bg, Math.min(bg.length, 21));
    for (let k = 0; k < 20 && k < pool.length; k++) {
      const user = pool[k]!;
      used.add(user.id);
      const band = (k % 4) as 0 | 1 | 2 | 3;
      const mode: RoommateMode = k % 5 === 4 ? 'have' : 'need';
      const budget = 100 * kit.int(6, 14);
      const spec: Omit<Spec, 'handle'> = {
        mode, answers: bgAnswers(kit, band), budget, moveInMonths: kit.int(1, 11), lease: kit.pick([6, 9, 12, 12, null]),
        hoods: kit.sample(HOODS, kit.int(1, 2)), about: kit.pick(BG_ABOUT),
        dealbreakSmoking: kit.chance(0.35), dealbreakPets: kit.chance(0.15),
        ...(mode === 'have'
          ? { place: { rent: budget, roomType: kit.chance(0.7) ? 'private' : 'shared', beds: kit.int(2, 4), baths: kit.int(1, 2), furnished: kit.chance(0.5), utilitiesIncluded: kit.chance(0.4) } as RoommatePlace, photos: kit.int(1, 3) }
          : {}),
      };
      insert(user, spec, kit.spread(i++, total), { published: true });
    }
  }

  /* One background user with an UNPUBLISHED match-preferences row (both scales; never listed). */
  const browser = bg.find((u) => !used.has(u.id));
  if (browser) {
    insert(
      browser,
      { mode: 'need', answers: A(1, 2, 1, 1, 1, 0, 1, 1), budget: 800, moveInMonths: 10, hoods: [], about: '', dealbreakSmoking: false, dealbreakPets: false },
      kit.ago({ d: 3 }),
      { published: false },
    );
    // an unpublished row carries no basics (mode / budget / move_in are NULL while published_at IS NULL)
    db.prepare('UPDATE roommate_profiles SET mode = NULL, budget = NULL, move_in = NULL WHERE user_id = ?').run(browser.id);
  }

  /* Maya saved 3. */
  const saveStmt = db.prepare('INSERT OR IGNORE INTO roommate_saves (user_id, profile_id, created_at) VALUES (?,?,?)');
  const savedHandles = ['zoemtz', 'sofiaram', 'priya_n'];
  savedHandles.forEach((h, k) => {
    const pid = idByHandle.get(h);
    if (pid) saveStmt.run(maya.id, pid, kit.ago({ d: 2 + k, h: 5 }));
  });

  /* Roommate DM Maya ↔ zoemtz with the context card (silent; never a pair the messages seed uses). */
  const zoeProfile = idByHandle.get('zoemtz');
  if (zoeProfile) {
    const zoe = kit.users.get(U.zoemtz);
    const conv = kit.convo.dm(maya.id, zoe.id, { context: { kind: 'roommate', id: zoeProfile } });
    const t0 = kit.ago({ d: 2, h: 4 });
    kit.convo.say(conv, maya.id, "Hey Zoe — looks like we're both quiet-weeknight people looking near West Campus for August. Want to compare notes?", t0);
    kit.convo.say(conv, zoe.id, 'Yes! I was literally about to message you. Are you set on a 2-bed or open to a 3 with one more person?', t0 + 25 * 60_000);
    kit.convo.say(conv, maya.id, 'Open to a 3 if the third is also quiet. Want to video call this weekend?', t0 + 52 * 60_000);
    kit.convo.say(conv, zoe.id, 'Saturday afternoon works. I will send a couple of listings I saved.', t0 + 70 * 60_000);
    kit.convo.readAll(conv, maya.id);
    kit.convo.readAll(conv, zoe.id);
  }
}
