/**
 * Campus seed (SPEC §5.9 / §7.5): 20 events at `full` (8 at `lite`), 16 at the hero campus, all within the next 14 days,
 * 2 today, 5 with free food, 14 org-hosted, RSVPs 4–240 from background users; Maya has 3 RSVPs — one starts in ~50 min
 * (the reminder demo: the `event.reminder` notification is seeded UNREAD and that RSVP's `reminded_at` is set, always
 * together, so the lazy hook can never add a duplicate). 25 hero course chats (8 at lite) with product §5 codes,
 * 8–310 members, ≥ 15 messages each (last < 48 h), created silently with `kit.convo.course` + `kit.convo.join`;
 * Maya is in CS 429, M 408D, SDS 320E, GOV 310L. `campus_milestones` rows match the seeded member counts.
 * Deterministic: `kit.rng` only. Every counter equals its rows; `markPublicActivity` per event.
 */
import type { EpochMs, Id } from '@shared/core';
import { COURSE_CHAT_WELCOME, EVENT_COVER_URL_PREFIX, LAUNCH_GOALS, type EventCategory, type EventCoverPreset } from '@shared/campus';
import { DAY, HOUR, MIN } from '../../lib/clock';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { markPublicActivity } from '../../lib/users';
import { currentTerm } from '../../services/campus/courses';
import { HERO_UNI, U, UNI } from './ids';

interface EventSpec {
  title: string;
  description: string;
  category: EventCategory;
  host: string;
  campus: Id;
  location: string;
  address?: string;
  addressPrivate?: boolean;
  /** Start offset from seed time. */
  inHours: number;
  durationH: number;
  freeFood?: boolean;
  cover: EventCoverPreset;
  capacity?: number;
  /** Included at `lite`. */
  lite?: boolean;
  /** Target going + interested at `full` (4–240). */
  rsvps: number;
}

const EVENTS: EventSpec[] = [
  { title: 'Hack Night: build something in 3 hours', description: 'Teams form at the door, demos at the end. Bring a laptop and an idea, or borrow one of ours. Pizza arrives at hour two.', category: 'academic', host: 'hacknight', campus: UNI.utexas, location: 'GDC 2.216', address: '2317 Speedway, Austin, TX', inHours: 50 / 60, durationH: 3, freeFood: true, cover: 'academic', lite: true, rsvps: 118 },
  { title: 'First-Gen coffee hour', description: 'Coffee, pastries and people who get it. First-generation students and anyone who wants to support them.', category: 'social', host: 'events_board', campus: UNI.utexas, location: 'Texas Union, Sinclair Suite', inHours: 3, durationH: 1.5, freeFood: true, cover: 'food', lite: true, rsvps: 46 },
  { title: 'Pickup soccer, all levels', description: 'Two fields, rolling subs, nobody keeps score for long. Cleats optional, water mandatory.', category: 'sports', host: 'diegoh', campus: UNI.utexas, location: 'Intramural Fields', inHours: 27, durationH: 2, cover: 'sports', lite: true, rsvps: 31 },
  { title: 'BIO 311C exam 2 study session', description: 'Working through the practice set together. Bring your notes on cell signalling; we will fill the whiteboard.', category: 'academic', host: 'hannahkim', campus: UNI.utexas, location: 'PCL group room 2.402', inHours: 46, durationH: 2.5, cover: 'academic', lite: true, rsvps: 22 },
  { title: 'Resume reviews with Consulting Group', description: 'Fifteen-minute slots with student consultants who have been through recruiting. Bring a printed copy and a target role.', category: 'career', host: 'events_board', campus: UNI.utexas, location: 'McCombs, CBA 4.330', inHours: 3 * 24 + 4, durationH: 3, cover: 'career', lite: true, rsvps: 74 },
  { title: 'Film Society: outdoor screening', description: 'A restored 35 mm print on the lawn. Blankets, popcorn and a short discussion after the credits.', category: 'arts', host: 'filmsociety', campus: UNI.utexas, location: 'South Mall lawn', inHours: 4 * 24 + 6, durationH: 3, freeFood: true, cover: 'arts', lite: true, rsvps: 137 },
  { title: 'Food pantry restock volunteers', description: 'Sorting, shelving and a little lifting. An hour of your Saturday keeps the pantry open all week.', category: 'social', host: 'fatima_as', campus: UNI.utexas, location: 'UT Outpost', inHours: 5 * 24 + 2, durationH: 2, cover: 'outdoors', rsvps: 19 },
  { title: 'Women in Computing: intro to systems design', description: 'A hands-on walkthrough of how to reason about a system in an interview and in real life. All majors welcome.', category: 'academic', host: 'wic_ut', campus: UNI.utexas, location: 'GDC atrium', inHours: 6 * 24 + 5, durationH: 1.5, cover: 'academic', capacity: 60, rsvps: 58 },
  { title: 'Climbing Club belay clinic', description: 'Learn to belay and get certified for the wall. Twelve spots, shoes and harnesses provided.', category: 'sports', host: 'climbing_club', campus: UNI.utexas, location: 'Gregory Gym climbing wall', inHours: 7 * 24 + 3, durationH: 2, cover: 'outdoors', capacity: 12, rsvps: 16 },
  { title: 'Solar Car shop open house', description: 'Meet the team, see the chassis, learn how to join. No engineering background required.', category: 'academic', host: 'solarcar', campus: UNI.utexas, location: 'ETC garage', inHours: 8 * 24 + 6, durationH: 2, cover: 'career', rsvps: 40 },
  { title: 'ISA Garba night', description: 'Live dhol, a dance floor and dinner. Come early to learn the steps; everyone is welcome.', category: 'social', host: 'isa_ut', campus: UNI.utexas, location: 'Texas Union ballroom', inHours: 9 * 24 + 7, durationH: 4, freeFood: true, cover: 'music', rsvps: 212 },
  { title: 'Pre-Med Society MCAT strategy panel', description: 'Four students who scored well on what actually moved their score. Questions welcome.', category: 'academic', host: 'premed_society', campus: UNI.utexas, location: 'Welch 2.224', inHours: 10 * 24 + 5, durationH: 1.5, cover: 'academic', rsvps: 63 },
  { title: 'Campus Daily: pitch meeting', description: 'Bring a story idea, leave with an assignment. Writers, photographers and editors welcome.', category: 'career', host: 'campusdaily', campus: UNI.utexas, location: 'HSM 3.302', inHours: 11 * 24 + 5, durationH: 1, cover: 'career', rsvps: 27 },
  { title: 'Hack Night: lightning talks', description: 'Eight talks, five minutes each, on the strangest thing you built this month. Snacks throughout.', category: 'academic', host: 'hacknight', campus: UNI.utexas, location: 'GDC 2.216', inHours: 12 * 24 + 5, durationH: 2, freeFood: true, cover: 'academic', rsvps: 89 },
  { title: 'Study jam before midterms', description: 'Quiet rooms, tutors on call and coffee until late. Come for an hour or stay for five.', category: 'academic', host: 'events_board', campus: UNI.utexas, location: 'PCL 4th floor', inHours: 13 * 24 + 4, durationH: 5, cover: 'academic', rsvps: 151 },
  { title: 'Sunset run by the river', description: 'An easy 5K on the trail, conversational pace, tacos after for whoever wants them. Meet at the trailhead by the boathouse.', category: 'sports', host: 'tbrooks', campus: UNI.utexas, location: 'Lady Bird Lake trailhead', inHours: 13 * 24 + 8, durationH: 1.5, cover: 'outdoors', rsvps: 14 },
  { title: 'Robotics Society demo day', description: 'The arm works, the wheels have opinions. Come see both and sign up for a build team.', category: 'academic', host: 'umich_robotics', campus: UNI.umich, location: 'Duderstadt Center atrium', inHours: 2 * 24 + 4, durationH: 2, cover: 'academic', lite: true, rsvps: 24 },
  { title: 'A cappella fall auditions', description: 'One prepared piece, sixteen bars, no accompaniment. Sign up for a slot at the door.', category: 'arts', host: 'acappella_su', campus: UNI.stanford, location: 'Braun Music Center', inHours: 4 * 24 + 3, durationH: 3, cover: 'music', lite: true, rsvps: 18 },
  { title: 'Career fair prep workshop', description: 'What to say in ninety seconds, what to wear, and which booths to skip. Run by students who recruited last year.', category: 'career', host: 'devonw', campus: UNI.umich, location: 'Michigan Union, Anderson Room', inHours: 6 * 24 + 6, durationH: 1.5, cover: 'career', rsvps: 12 },
  { title: 'NYU film night: student shorts', description: 'Six shorts from the spring production class, filmmakers in the room for questions.', category: 'arts', host: 'rafacruz', campus: UNI.nyu, location: 'Cantor Film Center', inHours: 8 * 24 + 7, durationH: 2, cover: 'arts', rsvps: 9 },
];

interface CourseSpec {
  code: string;
  title: string;
  createdBy: string;
  members: number;
  lite?: boolean;
}

const COURSES: CourseSpec[] = [
  { code: 'CS 429', title: 'Computer Organization and Architecture', createdBy: 'andresilva', members: 142, lite: true },
  { code: 'M 408D', title: 'Sequences, Series, and Multivariable Calculus', createdBy: 'meitanaka', members: 96, lite: true },
  { code: 'SDS 320E', title: 'Elements of Statistics', createdBy: 'priya_n', members: 61, lite: true },
  { code: 'GOV 310L', title: 'American Government', createdBy: 'ryanoc', members: 210, lite: true },
  { code: 'CS 314', title: 'Data Structures', createdBy: 'andresilva', members: 178, lite: true },
  { code: 'BIO 311C', title: 'Introductory Biology I', createdBy: 'hannahkim', members: 310, lite: true },
  { code: 'CH 301', title: 'Principles of Chemistry I', createdBy: 'emmalq', members: 240, lite: true },
  { code: 'PSY 301', title: 'Introduction to Psychology', createdBy: 'zoemtz', members: 133, lite: true },
  { code: 'CS 312', title: 'Introduction to Programming', createdBy: 'andresilva', members: 88 },
  { code: 'M 408C', title: 'Differential and Integral Calculus', createdBy: 'meitanaka', members: 120 },
  { code: 'ECO 304K', title: 'Introduction to Microeconomics', createdBy: 'marcusj', members: 74 },
  { code: 'PHY 303K', title: 'Engineering Physics I', createdBy: 'owenpark', members: 57 },
  { code: 'ACC 311', title: 'Fundamentals of Financial Accounting', createdBy: 'bencarter', members: 45 },
  { code: 'RHE 306', title: 'Rhetoric and Writing', createdBy: 'aaliyah_w', members: 38 },
  { code: 'UGS 303', title: 'Signature Course: Ideas of the Twentieth Century', createdBy: 'tbrooks', members: 29 },
  { code: 'E E 302', title: 'Introduction to Electrical Engineering', createdBy: 'ethan_ng', members: 66 },
  { code: 'CS 331', title: 'Algorithms and Complexity', createdBy: 'andresilva', members: 52 },
  { code: 'CS 439', title: 'Principles of Computer Systems', createdBy: 'jordan_builds', members: 41 },
  { code: 'M 340L', title: 'Matrices and Matrix Calculations', createdBy: 'meitanaka', members: 35 },
  { code: 'CH 302', title: 'Principles of Chemistry II', createdBy: 'emmalq', members: 27 },
  { code: 'BIO 206L', title: 'Introductory Laboratory Experience in Biology', createdBy: 'hannahkim', members: 23 },
  { code: 'HIS 315K', title: 'The United States, 1492–1865', createdBy: 'oliviab', members: 19 },
  { code: 'ECO 420K', title: 'Microeconomic Theory', createdBy: 'marcusj', members: 14 },
  { code: 'ARC 308', title: 'Architecture and Society', createdBy: 'laylah', members: 11 },
  { code: 'FIN 357', title: 'Business Finance', createdBy: 'arjunp', members: 8 },
];

const MAYA_COURSES = ['CS 429', 'M 408D', 'SDS 320E', 'GOV 310L'];
/** Maya reads these; the other two keep unread dots on the hub rail. */
const MAYA_READ = ['CS 429', 'SDS 320E'];

const CHAT_LINES = [
  'is the quiz open note?',
  'anyone have the room for the review session?',
  'section moved to 3pm fyi',
  'forming a study group for exam 2, PCL Thursday?',
  'did anyone catch what the last slide said about the deadline',
  'office hours are empty on tuesdays, highly recommend',
  'the practice set answers are posted in the course site now',
  'reminder that the problem set is due at 11:59 not midnight',
  'is attendance taken in the friday discussion?',
  'who else got the email about the room change',
  'the textbook is on reserve at PCL if anyone needs it',
  'lecture recording is up, audio cuts out around minute 40',
  'what chapter are we on for tomorrow',
  'anyone want to split the cost of the lab manual',
  'study group in the GDC atrium at 6, come find us',
  'the TA said the curve is decided after the final',
  'is the exam cumulative?',
  'lost a blue water bottle in the lecture hall, if anyone saw it',
  'the reading for next week is shorter than it looks',
  'friendly reminder: help, not answers. keep it clean in here',
  'does anyone have last year\'s syllabus for comparison',
  'the extra credit quiz closes tonight',
  'who is going to the review session tomorrow',
  'the professor posted a clarification on problem 3',
  'anyone know if we can use a calculator on the midterm',
];

const cover = (p: EventCoverPreset): string => `${EVENT_COVER_URL_PREFIX}${p}.svg`;

export default function seed(kit: SeedKit): void {
  const { db } = kit;
  const at = kit.now;
  const lite = kit.scale === 'lite';
  const maya = kit.users.get(U.mayachen);

  /* ───────────── events ───────────── */
  const insEvent = db.prepare(
    `INSERT OR IGNORE INTO events (id, host_id, university_id, title, description, category, starts_at, ends_at, location_name, address, address_private,
       cover_url, free_food, capacity, status, going_count, interested_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',0,0,?,?)`,
  );
  const insRsvp = db.prepare('INSERT OR IGNORE INTO event_rsvps (event_id, user_id, state, reminded_at, created_at) VALUES (?,?,?,?,?)');
  const fixCounters = db.prepare(
    `UPDATE events SET going_count = (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = events.id AND r.state = 'going'),
                       interested_count = (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = events.id AND r.state = 'interested')
      WHERE id = ?`,
  );

  const specs = EVENTS.filter((e) => !lite || e.lite);
  const mayaFollows = new Set(kit.follows(maya.id));
  const poolFor = new Map<Id, SeedUser[]>();
  const pool = (campus: Id): SeedUser[] => {
    let p = poolFor.get(campus);
    if (!p) {
      p = kit.users.all.filter((u) => u.universityId === campus && u.accountType === 'student' && u.id !== maya.id);
      poolFor.set(campus, p);
    }
    return p;
  };

  let reminderEvent: { id: Id; title: string; startsAt: EpochMs } | null = null;
  specs.forEach((spec, i) => {
    const n = i + 1;
    const id = kit.id('evt', n);
    const host = kit.users.get(spec.host);
    const startsAt = Math.round(at + spec.inHours * HOUR);
    const endsAt = Math.round(startsAt + spec.durationH * HOUR);
    const createdAt = at - kit.int(2, 12) * DAY - kit.int(0, 23) * HOUR - kit.int(0, 59) * MIN;
    insEvent.run(
      id, host.id, spec.campus, spec.title, spec.description, spec.category, startsAt, endsAt, spec.location, spec.address ?? null,
      spec.addressPrivate ? 1 : 0, cover(spec.cover), spec.freeFood ? 1 : 0, spec.capacity ?? null, createdAt, createdAt,
    );
    markPublicActivity(host.id, 'event', id, createdAt);
    kit.track('event_create', host, { category: spec.category, freeFood: !!spec.freeFood }, createdAt);

    // RSVPs: background users of the campus (+ personas Maya follows at the hero campus, so "friends going" has faces).
    const candidates = pool(spec.campus).filter((u) => u.id !== host.id);
    const target = Math.min(lite ? Math.max(4, Math.round(spec.rsvps / 4)) : spec.rsvps, candidates.length);
    const followed = candidates.filter((u) => mayaFollows.has(u.id));
    const friends = spec.campus === HERO_UNI ? kit.sample(followed, Math.min(followed.length, kit.int(2, 5))) : [];
    const rest = kit.sample(candidates.filter((u) => !friends.includes(u)), Math.max(0, target - friends.length));
    let going = 0;
    const cap = spec.capacity ?? Number.POSITIVE_INFINITY;
    for (const u of [...friends, ...rest]) {
      let state: 'going' | 'interested' = kit.chance(0.7) ? 'going' : 'interested';
      if (state === 'going' && going >= cap) state = 'interested';
      if (state === 'going') going += 1;
      insRsvp.run(id, u.id, state, null, Math.max(createdAt + MIN, at - kit.int(1, 10) * DAY + kit.int(0, 23) * HOUR));
    }
    fixCounters.run(id);
    if (n === 1) reminderEvent = { id, title: spec.title, startsAt };
  });

  /* Maya: 3 RSVPs — #1 going (reminder demo), #5 going, #8 interested (at lite: #2 interested). */
  const mayaGoingLater = kit.id('evt', 5);
  const mayaInterested = kit.id('evt', lite ? 2 : 8);
  if (reminderEvent) {
    const ev = reminderEvent as { id: Id; title: string; startsAt: EpochMs };
    const remindedAt = at - 10 * MIN;
    insRsvp.run(ev.id, maya.id, 'going', remindedAt, at - 3 * DAY);
    fixCounters.run(ev.id);
    // Notification + reminded_at ALWAYS together (§7.5): the lazy hook can never create a duplicate.
    kit.notify({
      userId: maya.id, type: 'event.reminder', actorId: null, href: `/campus/events/${ev.id}`,
      target: { entityType: 'event', entityId: ev.id }, data: { title: ev.title, startsAt: ev.startsAt }, collapse: false,
      createdAt: remindedAt, read: false,
    });
  }
  insRsvp.run(mayaGoingLater, maya.id, 'going', null, at - 2 * DAY - 5 * HOUR);
  fixCounters.run(mayaGoingLater);
  insRsvp.run(mayaInterested, maya.id, 'interested', null, at - 1 * DAY - 2 * HOUR);
  fixCounters.run(mayaInterested);

  /* ───────────── course chats (hero campus) ───────────── */
  const insCourse = db.prepare(
    'INSERT OR IGNORE INTO courses (id, university_id, code, title, term, conversation_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  const term = currentTerm(at);
  const heroStudents = kit.users.all.filter((u) => u.universityId === HERO_UNI && u.accountType === 'student' && u.id !== maya.id);
  const courseSpecs = COURSES.filter((c) => !lite || c.lite);
  courseSpecs.forEach((spec, i) => {
    const n = i + 1;
    const courseId = kit.id('course', n);
    const creator = kit.users.get(spec.createdBy);
    const createdAt = at - kit.int(20, 60) * DAY - kit.int(1, 20) * HOUR;
    const convId = kit.convo.course({
      id: kit.id('cconv', n), universityId: HERO_UNI, courseId, code: spec.code, title: spec.title, term, createdBy: creator.id, createdAt,
    });
    insCourse.run(courseId, HERO_UNI, spec.code, spec.title, term, convId, creator.id, createdAt);

    const isMayaCourse = MAYA_COURSES.includes(spec.code);
    const others = heroStudents.filter((u) => u.id !== creator.id);
    const target = Math.min(lite ? Math.max(8, Math.round(spec.members / 5)) : spec.members, others.length + 1);
    const members: SeedUser[] = [creator, ...kit.sample(others, Math.max(0, target - 1 - (isMayaCourse ? 1 : 0)))];
    if (isMayaCourse) members.push(maya);
    members.forEach((u, idx) => kit.convo.join(convId, u.id, createdAt + Math.min(idx, 40) * HOUR + kit.int(0, 55) * MIN));

    // ≥ 15 messages, oldest first, the last one < 48 h ago; a system welcome line opens every chat (product §2.9).
    kit.convo.say(convId, null, COURSE_CHAT_WELCOME, createdAt + MIN);
    const count = kit.int(15, 22);
    const span = Math.min(at - createdAt - 2 * HOUR, 12 * DAY);
    const lastAt = at - kit.int(1, 40) * HOUR;
    const lines = kit.sample(CHAT_LINES, Math.min(CHAT_LINES.length, count));
    for (let m = 0; m < count; m++) {
      const author = kit.pick(members.filter((u) => u.id !== maya.id));
      const when = m === count - 1 ? lastAt : Math.round(lastAt - span * ((count - 1 - m) / count) - kit.int(0, 50) * MIN);
      kit.convo.say(convId, author.id, lines[m % lines.length]!, Math.max(createdAt + 2 * MIN, when));
    }
    if (isMayaCourse && MAYA_READ.includes(spec.code)) kit.convo.readAll(convId, maya.id);
  });

  /* ───────────── launch milestones consistent with the seeded member counts ───────────── */
  const insMilestone = db.prepare('INSERT OR IGNORE INTO campus_milestones (university_id, goal, reached_at) VALUES (?,?,?)');
  const unis = db.prepare("SELECT id FROM universities WHERE is_hidden = 0").all() as { id: Id }[];
  for (const uni of unis) {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(uni.id) as { n: number }).n;
    LAUNCH_GOALS.forEach((goal, idx) => {
      if (count >= goal) insMilestone.run(uni.id, goal, at - (LAUNCH_GOALS.length - idx) * 21 * DAY - kit.int(0, 20) * DAY);
    });
  }
}
