/**
 * Static data of the core seed world (SPEC §7). Foundation-owned; consumed only by `00-core.ts`.
 * Nobody here is a real person, professor, business or Greek chapter.
 */
import type { OrgCategory } from '@shared/core';
import { UNI } from './ids';

export type CampusKey = keyof typeof UNI;
export type Standing = 'FR' | 'SO' | 'JR' | 'SR' | 'GR';

export interface CampusDef {
  key: CampusKey;
  name: string;
  shortName: string;
  domain: string;
  extraDomains?: string[];
  city: string;
  cc: string;
  /** Background users at `full` / `lite` scale. */
  bg: { full: number; lite: number };
  /** First `bg_NNNN` number of this campus' block (ids are stable across scales). */
  bgStart: number;
}

export const CAMPUSES: CampusDef[] = [
  { key: 'utexas', name: 'The University of Texas at Austin', shortName: 'UT Austin', domain: 'utexas.edu', city: 'Austin', cc: 'US', bg: { full: 139, lite: 40 }, bgStart: 1 },
  { key: 'umich', name: 'University of Michigan', shortName: 'UMich', domain: 'umich.edu', city: 'Ann Arbor', cc: 'US', bg: { full: 30, lite: 5 }, bgStart: 201 },
  { key: 'stanford', name: 'Stanford University', shortName: 'Stanford', domain: 'stanford.edu', city: 'Stanford', cc: 'US', bg: { full: 30, lite: 5 }, bgStart: 301 },
  { key: 'nyu', name: 'New York University', shortName: 'NYU', domain: 'nyu.edu', city: 'New York', cc: 'US', bg: { full: 27, lite: 5 }, bgStart: 401 },
  { key: 'utoronto', name: 'University of Toronto', shortName: 'U of T', domain: 'utoronto.ca', city: 'Toronto', cc: 'CA', bg: { full: 3, lite: 0 }, bgStart: 501 },
  { key: 'ethz', name: 'ETH Zürich', shortName: 'ETH', domain: 'ethz.ch', city: 'Zürich', cc: 'CH', bg: { full: 4, lite: 1 }, bgStart: 601 },
  { key: 'tum', name: 'Technical University of Munich', shortName: 'TUM', domain: 'tum.de', extraDomains: ['mytum.de'], city: 'Munich', cc: 'DE', bg: { full: 4, lite: 1 }, bgStart: 701 },
  { key: 'oxford', name: 'University of Oxford', shortName: 'Oxford', domain: 'ox.ac.uk', city: 'Oxford', cc: 'GB', bg: { full: 4, lite: 1 }, bgStart: 801 },
  { key: 'nus', name: 'National University of Singapore', shortName: 'NUS', domain: 'u.nus.edu', extraDomains: ['nus.edu.sg'], city: 'Singapore', cc: 'SG', bg: { full: 4, lite: 1 }, bgStart: 901 },
  { key: 'iitb', name: 'Indian Institute of Technology Bombay', shortName: 'IIT Bombay', domain: 'iitb.ac.in', city: 'Mumbai', cc: 'IN', bg: { full: 4, lite: 1 }, bgStart: 1001 },
  { key: 'unimelb', name: 'University of Melbourne', shortName: 'Melbourne', domain: 'student.unimelb.edu.au', extraDomains: ['unimelb.edu.au'], city: 'Melbourne', cc: 'AU', bg: { full: 4, lite: 1 }, bgStart: 1101 },
];

/** UT Austin campus places (§7.1). Every other seeded campus gets the generic rows. */
export const UT_PLACES = {
  meetup: ['PCL lobby', 'Texas Union front desk', 'GDC atrium', 'Gregory Gym entrance', 'UTPD safe-exchange zone'],
  neighborhood: ['West Campus', 'North Campus', 'Hyde Park', 'Riverside', 'On campus'],
  venue: ['PCL', 'Texas Union', 'GDC', 'McCombs', 'Intramural Fields', 'Welch Hall'],
} as const;

export interface PersonaDef {
  handle: string;
  name: string;
  campus: CampusKey;
  major: string;
  standing: Standing;
  bio: string;
  pronouns?: string;
  interests: string[];
  /** Days since sign-up (30–400), unless `ageHours` is set. */
  ageDays?: number;
  ageHours?: number;
  isAdult?: boolean;
}

/** §7.2 — order is FINAL (campus_rank follows it). */
export const PERSONAS: PersonaDef[] = [
  { handle: 'mayachen', name: 'Maya Chen', campus: 'utexas', major: 'Computer Science', standing: 'JR', bio: 'CS junior. Hack Night regular, PCL 4th floor resident, boba-powered.', pronouns: 'she/her', interests: ['Hackathons', 'Climbing', 'Boba', 'Film photography'], ageDays: 386 },
  { handle: 'jordan_builds', name: 'Jordan Okafor', campus: 'utexas', major: 'Mechanical Engineering', standing: 'SR', bio: 'Solar Car mechanical lead. If it has bearings, I have opinions.', pronouns: 'he/him', interests: ['Solar car', 'CAD', 'Welding', 'F1'], ageDays: 392 },
  { handle: 'sofiaram', name: 'Sofia Ramirez', campus: 'utexas', major: 'Nursing', standing: 'SO', bio: 'Nursing sophomore. Up at 5:30 for clinicals, asleep by 10. Looking for a calm place near campus.', pronouns: 'she/her', interests: ['Running', 'Meal prep', 'Plants'], ageDays: 301 },
  { handle: 'arjunp', name: 'Arjun Patel', campus: 'utexas', major: 'Finance', standing: 'JR', bio: 'McCombs junior. Selling last semester’s textbooks so I can buy this semester’s.', pronouns: 'he/him', interests: ['Investing club', 'Cricket', 'Podcasts'], ageDays: 344 },
  { handle: 'priya_n', name: 'Priya Natarajan', campus: 'utexas', major: 'MS Data Science', standing: 'GR', bio: 'Data science grad student. Have a 2-bed in Hyde Park, need a roommate and a couch.', pronouns: 'she/her', interests: ['Bouldering', 'Carnatic music', 'Kaggle'], ageDays: 212 },
  { handle: 'tbrooks', name: 'Tyler Brooks', campus: 'utexas', major: 'Undeclared (Business)', standing: 'FR', bio: 'Freshman. Reviewing every dining hall so you don’t have to. IM flag football.', pronouns: 'he/him', interests: ['Intramurals', 'Dorm cooking', 'Longhorn football'], ageDays: 41 },
  { handle: 'aaliyah_w', name: 'Aaliyah Washington', campus: 'utexas', major: 'Journalism', standing: 'SR', bio: 'Photojournalist for The Campus Daily. I shoot campus the way it actually looks.', pronouns: 'she/her', interests: ['Photography', 'Longform', 'Thrifting', 'Live music'], ageDays: 398 },
  { handle: 'lucas_oli', name: 'Lucas Oliveira', campus: 'utexas', major: 'Architecture (exchange)', standing: 'JR', bio: 'Exchange student from São Paulo. Here until May — selling my bike and desk before I fly home.', pronouns: 'he/him', interests: ['Sketching', 'Cycling', 'Futsal'], ageDays: 96 },
  { handle: 'hannahkim', name: 'Hannah Kim', campus: 'utexas', major: 'Biology', standing: 'JR', bio: 'Pre-med-ish. I run the Sunday study sessions in Welch. Bring flashcards.', pronouns: 'she/her', interests: ['Study groups', 'Volunteering', 'K-dramas'], ageDays: 330 },
  { handle: 'noahg', name: 'Noah Goldberg', campus: 'utexas', major: 'Radio-TV-Film', standing: 'JR', bio: 'RTF junior. One-minute films about this campus. Film Society projectionist.', pronouns: 'he/him', interests: ['Filmmaking', 'Editing', 'Vinyl'], ageDays: 371 },
  { handle: 'emmalq', name: 'Emma Lindqvist', campus: 'utexas', major: 'Chemistry PhD', standing: 'GR', bio: 'Chemistry PhD, 3rd year. Quiet, tidy, mostly in the lab. Moving labs, selling things.', pronouns: 'she/her', interests: ['Baking', 'Trail running', 'Crosswords'], ageDays: 263 },
  { handle: 'diegoh', name: 'Diego Hernandez', campus: 'utexas', major: 'Kinesiology', standing: 'JR', bio: 'Pickup soccer at the Intramural Fields, Tuesdays and Thursdays. All levels, just show up.', pronouns: 'he/him', interests: ['Soccer', 'Strength training', 'Tacos'], ageDays: 288 },
  { handle: 'zoemtz', name: 'Zoe Martinez', campus: 'utexas', major: 'Psychology', standing: 'SO', bio: 'Psych sophomore, West Campus hopeful. Clean, friendly, has a very polite cat-free lifestyle.', pronouns: 'she/her', interests: ['Pilates', 'True crime', 'Thrifting'], ageDays: 247 },
  { handle: 'ethan_ng', name: 'Ethan Nguyen', campus: 'utexas', major: 'Electrical & Computer Engineering', standing: 'SR', bio: 'ECE senior. Will haggle for calculators. Embedded systems and late-night pho.', pronouns: 'he/him', interests: ['Embedded', 'Keyboards', 'Badminton'], ageDays: 377 },
  { handle: 'oliviab', name: 'Olivia Bennett', campus: 'utexas', major: 'Marketing', standing: 'JR', bio: 'Marketing junior, Student Events Board volunteer. I know what’s happening this weekend.', pronouns: 'she/her', interests: ['Event planning', 'Design', 'Concerts'], ageDays: 322 },
  { handle: 'marcusj', name: 'Marcus Johnson', campus: 'utexas', major: 'Economics', standing: 'SR', bio: 'Econ senior graduating in May. Everything in my apartment is for sale, eventually.', pronouns: 'he/him', interests: ['Basketball', 'Fantasy football', 'Grilling'], ageDays: 365 },
  { handle: 'bellarossi', name: 'Isabella Rossi', campus: 'utexas', major: 'Studio Art', standing: 'SO', bio: 'Studio art sophomore. Oil, charcoal, and whatever I find near the ART building dumpster.', pronouns: 'she/her', interests: ['Painting', 'Printmaking', 'Museums'], ageDays: 198 },
  { handle: 'calebt', name: 'Caleb Thompson', campus: 'utexas', major: 'Civil Engineering', standing: 'JR', bio: 'Civil engineering. Night owl, plays guitar with headphones on. Looking for a place for spring.', pronouns: 'he/him', interests: ['Guitar', 'Gaming', 'Disc golf'], ageDays: 176 },
  { handle: 'fatima_as', name: 'Fatima Al-Sayed', campus: 'utexas', major: 'Public Health', standing: 'JR', bio: 'Public health junior. Campus pantry volunteer lead — come pack boxes with us.', pronouns: 'she/her', interests: ['Volunteering', 'Food justice', 'Hiking'], ageDays: 309 },
  { handle: 'ryanoc', name: "Ryan O'Connor", campus: 'utexas', major: 'Government', standing: 'SO', bio: 'Government sophomore. Debates too much, apparently.', pronouns: 'he/him', interests: ['Debate', 'Politics', 'Golf'], ageDays: 154 },
  { handle: 'meitanaka', name: 'Mei Tanaka', campus: 'utexas', major: 'Mathematics', standing: 'SR', bio: 'Math senior and M 408D tutor. I can make series convergence make sense, promise.', pronouns: 'she/her', interests: ['Tutoring', 'Origami', 'Chess'], ageDays: 351 },
  { handle: 'andresilva', name: 'Andre Silva', campus: 'utexas', major: 'Computer Science', standing: 'SO', bio: 'CS sophomore. Hack Night, CS 429 survivor-in-progress, mechanical keyboard evangelist.', pronouns: 'he/him', interests: ['Hackathons', 'Rust', 'Skateboarding'], ageDays: 233 },
  { handle: 'graceade', name: 'Grace Adeyemi', campus: 'utexas', major: 'Neuroscience', standing: 'FR', bio: 'Freshman, neuroscience. Just got here!', pronouns: 'she/her', interests: ['Choir', 'Anime'], ageDays: 2, isAdult: false },
  { handle: 'bencarter', name: 'Ben Carter', campus: 'utexas', major: 'Accounting', standing: 'SR', bio: 'Accounting senior. Busy season is coming. Coffee recommendations welcome.', pronouns: 'he/him', interests: ['Coffee', 'Golf', 'Trivia'], ageDays: 340 },
  { handle: 'laylah', name: 'Layla Haddad', campus: 'utexas', major: 'Architecture', standing: 'SO', bio: 'Architecture sophomore with a small dog named Pita. Studio until 2am most nights.', pronouns: 'she/her', interests: ['Model making', 'Dogs', 'Ceramics'], ageDays: 205 },
  { handle: 'owenpark', name: 'Owen Park', campus: 'utexas', major: 'Physics', standing: 'JR', bio: 'Physics junior. Astronomy club telescope nights on the RLM roof.', pronouns: 'he/him', interests: ['Astronomy', 'Cycling', 'Board games'], ageDays: 187 },
  { handle: 'chloedub', name: 'Chloe Dubois', campus: 'utexas', major: 'Linguistics (exchange)', standing: 'JR', bio: 'Exchange student from Lyon. Looking for a desk lamp, a rice cooker and good tacos.', pronouns: 'she/her', interests: ['Languages', 'Cooking', 'Cinema'], ageDays: 58 },
  { handle: 'samirk', name: 'Samir Khan', campus: 'utexas', major: 'MS Information Studies', standing: 'GR', bio: 'iSchool grad student. Have a room open in North Campus from January.', pronouns: 'he/him', interests: ['UX research', 'Cricket', 'Cooking'], ageDays: 143 },
  { handle: 'ninakow', name: 'Nina Kowalski', campus: 'umich', major: 'Industrial Engineering', standing: 'JR', bio: 'IOE junior at Michigan. Optimising my walk to North Campus one bus at a time.', pronouns: 'she/her', interests: ['Operations', 'Volleyball', 'Pierogi'], ageDays: 274 },
  { handle: 'devonw', name: 'Devon Wright', campus: 'umich', major: 'Sport Management', standing: 'SO', bio: 'Sport management. Big House every Saturday.', pronouns: 'he/him', interests: ['Football', 'Sneakers', 'Podcasts'], ageDays: 165 },
  { handle: 'aisharahman', name: 'Aisha Rahman', campus: 'umich', major: 'Public Policy', standing: 'SR', bio: 'Ford School senior. Housing policy nerd.', pronouns: 'she/her', interests: ['Policy', 'Debate', 'Tea'], ageDays: 310 },
  { handle: 'leofischer', name: 'Leo Fischer', campus: 'umich', major: 'Computer Science', standing: 'FR', bio: 'New here. CS, maybe.', pronouns: 'he/him', interests: ['Gaming'], ageHours: 10 },
  { handle: 'kaiyama', name: 'Kai Yamamoto', campus: 'stanford', major: 'Symbolic Systems', standing: 'JR', bio: 'SymSys junior. Short films about long bike rides.', pronouns: 'he/him', interests: ['Filmmaking', 'Cycling', 'Philosophy of mind'], ageDays: 296 },
  { handle: 'elenap', name: 'Elena Petrova', campus: 'stanford', major: 'Bioengineering', standing: 'SR', bio: 'BioE senior. Wet lab by day, dry humour by night.', pronouns: 'she/her', interests: ['Synthetic biology', 'Figure skating'], ageDays: 333 },
  { handle: 'jamaled', name: 'Jamal Edwards', campus: 'stanford', major: 'Product Design', standing: 'SO', bio: 'Product design. I prototype in cardboard first.', pronouns: 'he/him', interests: ['Design', 'Woodworking', 'Basketball'], ageDays: 171 },
  { handle: 'tessam', name: 'Tessa Moreau', campus: 'stanford', major: 'Earth Systems', standing: 'GR', bio: 'Earth Systems coterm. Kelp forests and carbon budgets.', pronouns: 'she/her', interests: ['Diving', 'Climate', 'Sourdough'], ageDays: 229 },
  { handle: 'rafacruz', name: 'Rafael Cruz', campus: 'nyu', major: 'Film & TV', standing: 'JR', bio: 'Tisch film junior. The city is the set.', pronouns: 'he/him', interests: ['Cinematography', 'Street photography', 'Salsa'], ageDays: 318 },
  { handle: 'hanasato', name: 'Hana Sato', campus: 'nyu', major: 'Media, Culture & Communication', standing: 'SO', bio: 'MCC sophomore. Zines, playlists, too many tabs.', pronouns: 'she/her', interests: ['Zines', 'Music', 'Thrifting'], ageDays: 182 },
  { handle: 'imaniclarke', name: 'Imani Clarke', campus: 'nyu', major: 'Drama', standing: 'SR', bio: 'Tisch drama senior. Currently in rehearsal, always.', pronouns: 'she/her', interests: ['Theatre', 'Poetry', 'Yoga'], ageDays: 355 },
  { handle: 'liamtrem', name: 'Liam Tremblay', campus: 'utoronto', major: 'Engineering Science', standing: 'JR', bio: 'EngSci at U of T. Robarts is a lifestyle.', pronouns: 'he/him', interests: ['Robotics', 'Hockey', 'Coffee'], ageDays: 259 },
];

export interface OrgDef {
  handle: string;
  name: string;
  campus: CampusKey;
  category: OrgCategory;
  verified: boolean;
  /** Target follower count at `full` scale (§7.3); scales with the user count at `lite`. */
  followers: number;
  bio: string;
  ageDays: number;
}

/** §7.3 — order is FINAL. */
export const ORGS: OrgDef[] = [
  { handle: 'wic_ut', name: 'Women in Computing', campus: 'utexas', category: 'Academic', verified: true, followers: 150, bio: 'Community for women and non-binary students in computing at UT. Mentorship, workshops, company nights.', ageDays: 395 },
  { handle: 'solarcar', name: 'Solar Car Team', campus: 'utexas', category: 'Academic', verified: false, followers: 90, bio: 'We design, build and race solar-powered cars. Shop nights Mon/Wed, no experience needed.', ageDays: 380 },
  { handle: 'events_board', name: 'Student Events Board', campus: 'utexas', category: 'Student government', verified: true, followers: 210, bio: 'The official student-run events calendar. Free concerts, movie nights, and everything in between.', ageDays: 399 },
  { handle: 'campusdaily', name: 'The Campus Daily', campus: 'utexas', category: 'Arts & Media', verified: true, followers: 180, bio: 'Independent student newsroom. Tips: find a staffer on campus — we do not take them here.', ageDays: 397 },
  { handle: 'clubsoccer', name: 'Club Soccer', campus: 'utexas', category: 'Sports & Rec', verified: false, followers: 70, bio: 'Competitive club soccer. Tryouts each semester, open scrimmages on Fridays.', ageDays: 300 },
  { handle: 'climbing_club', name: 'Climbing Club', campus: 'utexas', category: 'Sports & Rec', verified: false, followers: 40, bio: 'Gregory Gym wall on weekdays, Greenbelt on weekends. Gear library for members.', ageDays: 250 },
  { handle: 'isa_ut', name: 'Indian Students Association', campus: 'utexas', category: 'Cultural', verified: false, followers: 110, bio: 'Garba, Holi, Diwali and chai socials. Everyone is welcome.', ageDays: 370 },
  { handle: 'premed_society', name: 'Pre-Med Society', campus: 'utexas', category: 'Professional', verified: false, followers: 95, bio: 'MCAT study groups, shadowing info sessions, application workshops.', ageDays: 340 },
  { handle: 'filmsociety', name: 'Film Society', campus: 'utexas', category: 'Arts & Media', verified: false, followers: 60, bio: 'Weekly 35mm and digital screenings. Members vote on the lineup.', ageDays: 280 },
  { handle: 'hacknight', name: 'Hack Night', campus: 'utexas', category: 'Academic', verified: false, followers: 120, bio: 'Thursdays, 7pm, GDC. Bring a laptop and a half-finished idea. Pizza provided.', ageDays: 360 },
  { handle: 'umich_robotics', name: 'Robotics Society', campus: 'umich', category: 'Academic', verified: false, followers: 25, bio: 'Michigan student robotics. Build season never really ends.', ageDays: 290 },
  { handle: 'acappella_su', name: 'A Cappella Collective', campus: 'stanford', category: 'Arts & Media', verified: false, followers: 20, bio: 'Six groups, one stage. Auditions every fall.', ageDays: 270 },
];

export interface StaffDef {
  handle: string;
  name: string;
  email: string;
  role: 'admin' | 'moderator';
  major: string;
  standing: Standing;
  bio: string;
  ageDays: number;
}

/** §7.4 — hero campus; normal student profiles with roles. */
export const STAFF_MEMBERS: StaffDef[] = [
  { handle: 'dana_w', name: 'Dana Whitfield', email: 'admin@utexas.edu', role: 'admin', major: 'Information Systems', standing: 'GR', bio: 'Grad student. Trust & Safety at UniVerse.', ageDays: 400 },
  { handle: 'victor_o', name: 'Victor Osei', email: 'safety@utexas.edu', role: 'admin', major: 'Law', standing: 'GR', bio: 'Law student. Trust & Safety at UniVerse.', ageDays: 399 },
  { handle: 'rileyshaw', name: 'Riley Shaw', email: 'mod@utexas.edu', role: 'moderator', major: 'Sociology', standing: 'SR', bio: 'Sociology senior. Community moderator.', ageDays: 390 },
];

/** §7.5 — Maya follows exactly these 28 (9 orgs + 19 personas). */
export const MAYA_FOLLOWS_ORGS = ['wic_ut', 'solarcar', 'events_board', 'campusdaily', 'clubsoccer', 'isa_ut', 'premed_society', 'filmsociety', 'hacknight'] as const;
export const MAYA_FOLLOWS_PERSONAS = [
  'jordan_builds', 'sofiaram', 'arjunp', 'priya_n', 'tbrooks', 'aaliyah_w', 'lucas_oli', 'hannahkim', 'noahg', 'emmalq',
  'diegoh', 'zoemtz', 'ethan_ng', 'oliviab', 'marcusj', 'andresilva', 'ninakow', 'kaiyama', 'rafacruz',
] as const;
/** §7.5 — follow Maya without being followed back (the Follow-back demo). */
export const MAYA_EXTRA_FOLLOWERS = ['bencarter', 'owenpark', 'samirk'] as const;
/** §7.5 — 19 background followers (bg_0001 … bg_0019); bg_0001–bg_0004 joined from her invite link. */
export const MAYA_BG_FOLLOWERS = 19;
export const MAYA_INVITED_BG = 4;

/** Guaranteed mutuals so "People you may know" has real reasons (§7.5: bellarossi, meitanaka, fatima_as …). */
export const EXPLICIT_FOLLOWS: [follower: string, followee: string][] = [
  ['aaliyah_w', 'bellarossi'], ['oliviab', 'bellarossi'], ['hannahkim', 'bellarossi'], ['noahg', 'bellarossi'],
  ['hannahkim', 'meitanaka'], ['andresilva', 'meitanaka'], ['arjunp', 'meitanaka'], ['ethan_ng', 'meitanaka'],
  ['sofiaram', 'fatima_as'], ['hannahkim', 'fatima_as'], ['diegoh', 'fatima_as'],
  ['jordan_builds', 'calebt'], ['zoemtz', 'laylah'], ['priya_n', 'samirk'],
];

/** Fixed background name lists (diverse, fictional combinations). */
export const FIRST_NAMES = [
  'Aiden', 'Amara', 'Andre', 'Anika', 'Ava', 'Beatriz', 'Blake', 'Brianna', 'Caleb', 'Camila', 'Carlos', 'Carmen', 'Chidi',
  'Chloe', 'Daniel', 'Darius', 'Deja', 'Dylan', 'Elena', 'Eli', 'Elijah', 'Emily', 'Esther', 'Farah', 'Felix', 'Gabriel',
  'Gianna', 'Hadiya', 'Hailey', 'Hassan', 'Henry', 'Imani', 'Isaac', 'Isla', 'Jada', 'Jamal', 'Jasmine', 'Javier', 'Jin',
  'Jonah', 'Julia', 'Kavya', 'Keisha', 'Kenji', 'Kiara', 'Leila', 'Levi', 'Lily', 'Logan', 'Lucia', 'Luis', 'Malik',
  'Mariam', 'Mateo', 'Maya', 'Mia', 'Miguel', 'Mina', 'Nadia', 'Naomi', 'Nathan', 'Nia', 'Nikhil', 'Noor', 'Omar', 'Paige',
  'Quinn', 'Rahul', 'Reese', 'Rohan', 'Rosa', 'Sana', 'Santiago', 'Sara', 'Sean', 'Simone', 'Tariq', 'Tessa', 'Thanh',
  'Valeria', 'Victor', 'Wei', 'Xavier', 'Yara', 'Yusuf', 'Zainab', 'Zane', 'Zuri',
] as const;

export const LAST_NAMES = [
  'Abdi', 'Acosta', 'Adams', 'Agarwal', 'Ahmed', 'Alvarez', 'Anderson', 'Baker', 'Banerjee', 'Barnes', 'Bell', 'Brooks',
  'Castillo', 'Chang', 'Chavez', 'Choi', 'Coleman', 'Cruz', 'Das', 'Davis', 'Diaz', 'Douglas', 'Evans', 'Farouk',
  'Fernandez', 'Flores', 'Foster', 'Garcia', 'Gomez', 'Gupta', 'Hall', 'Harris', 'Hoang', 'Huang', 'Hussain', 'Ibrahim',
  'Iyer', 'Jackson', 'James', 'Jimenez', 'Kaur', 'Kelly', 'Khan', 'Kim', 'Kumar', 'Le', 'Lewis', 'Li', 'Lin', 'Lopez',
  'Martin', 'Mehta', 'Mendoza', 'Mitchell', 'Morales', 'Morgan', 'Murphy', 'Nair', 'Nakamura', 'Navarro', 'Okoye',
  'Ortiz', 'Owens', 'Pham', 'Price', 'Rao', 'Reed', 'Reyes', 'Rivera', 'Robinson', 'Romero', 'Sanchez', 'Shah', 'Sharma',
  'Singh', 'Soto', 'Stewart', 'Suzuki', 'Torres', 'Tran', 'Turner', 'Vargas', 'Walker', 'Wang', 'Ward', 'Watson',
  'Williams', 'Wu', 'Yang', 'Young', 'Zhang',
] as const;

export const BG_INTERESTS = [
  'Intramurals', 'Hiking', 'Coffee', 'Live music', 'Photography', 'Cooking', 'Gaming', 'Volunteering', 'Running', 'Thrifting',
  'Film', 'Climbing', 'Yoga', 'Basketball', 'Soccer', 'Board games', 'Podcasts', 'Anime', 'Dance', 'Startups', 'Reading',
  'Cycling', 'Painting', 'Tennis', 'Baking',
] as const;

export const BG_BIOS = [
  '', '', '', 'Here for the free food alerts.', 'Probably at the library.', 'Transfer student, still learning the bus routes.',
  'Looking for study buddies.', 'Coffee first.', 'Intramural champion (self-declared).', 'Ask me about my plants.',
  'Trying every taco place near campus.', 'Part-time barista, full-time student.', 'Club sports and problem sets.',
  'New in town — say hi.', 'Music, mostly.', 'Graduating soon, selling everything.',
] as const;
