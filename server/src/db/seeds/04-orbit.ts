/**
 * Orbit seed (SPEC §5.4 / §7.5): ~90 posts at `full` (25 at `lite`), ~55 at the hero campus, 40 % with 1–4 photos
 * (generated nebula SVGs), 8 polls (3 at lite), a third from orgs; Maya's 5 posts are `post_0001…post_0005`.
 * Likes / comments come from the author's followers — except the "campus reach" pass (DECISIONS D8): the newest posts
 * of two hero-campus students Maya does NOT follow also get likes from across the campus, so her Orbit shows campus
 * highlights. Every counter equals its rows; `markPublicActivity` is called with the row's `created_at`; Maya gets ONE
 * `post.like` (read, collapsed likers) + ONE `post.comment` (unread).
 * Deterministic: `kit.rng` only.
 */
import type { EpochMs, Id, MediaImage } from '@shared/core';
import { markPublicActivity } from '../../lib/users';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { HERO_UNI, STAFF, U } from './ids';

interface PostSpec {
  text: string;
  /** Glyph for the generated cover; a post with a glyph MAY get photos. */
  glyph?: string;
  poll?: string[];
}

/* ───────────────────────────── copy ───────────────────────────── */

const MAYA_POSTS: PostSpec[] = [
  { text: 'Finally got the CS 429 pipeline sim to pass every test case. 3 a.m. GDC energy is real.', glyph: 'code' },
  { text: 'Study group for the algorithms midterm forming — PCL 4th floor, Thursday 7 pm. Bring snacks, bring questions.' },
  { text: 'Which library for finals week?', poll: ['PCL (chaos, but 24h)', 'Welch (quiet, no outlets)', 'The Union basement', 'Home. Bed. Sleep.'] },
  { text: 'Sunset over the tower tonight. Sometimes this campus just shows off.', glyph: 'sun' },
  { text: 'Selling my TI-84 now that the stats class is done — listed it in Market. Also: who else is doing the hackathon this weekend?' },
];

const STUDENT_POSTS: PostSpec[] = [
  { text: 'Solar car chassis passed the flex test today. Two months of welding, one very good afternoon.', glyph: 'trophy' },
  { text: 'Anyone else find that the 8 a.m. lab is actually the best one? No line for equipment, nobody talking.' },
  { text: 'Got the clinical rotation placement I wanted. Shaking a little. Thank you to everyone who read my essays.' },
  { text: 'Career fair recap: bring more resumes than you think, talk to the small booths, the big ones barely look up.', glyph: 'briefcase' },
  { text: 'First intramural win of the season. We are 1–0 and already planning the parade.', glyph: 'ball' },
  { text: 'Golden hour on the drag. Shot on my phone, no edits.', glyph: 'camera' },
  { text: 'Moved into the new studio. Desk by the window, bike in the hallway, rent I can almost afford.', glyph: 'home' },
  { text: 'If you are taking BIO 311C this term, the Tuesday office hours are empty and the TA is incredibly patient.' },
  { text: 'Short film screening went well. Twelve people showed up, three of them were not my roommates.', glyph: 'film' },
  { text: 'Lab move day. Everything labelled, nothing broken, one centrifuge lighter.', glyph: 'flask' },
  { text: 'Pickup soccer at the intramural fields, Sunday 5 pm. All levels. We need a goalie who is not me.', glyph: 'ball' },
  { text: 'Psych research participants needed: 20 minutes, a coffee voucher, and my eternal gratitude.' },
  { text: 'Built a tiny Arduino plant monitor over the weekend. It texts me when the basil is thirsty.', glyph: 'leaf' },
  { text: 'Events board volunteers: we are planning the spring concert lineup and taking suggestions until Friday.', glyph: 'music' },
  { text: 'Two tickets to Saturday’s game that I can’t use. Listed in Market, priced to move.' },
  { text: 'Charcoal study of the fountain courtyard. Still learning how to draw water.', glyph: 'palette' },
  { text: 'Concrete cylinders cured perfectly this time. Civil engineering is 90 percent waiting.', glyph: 'flask' },
  { text: 'Food pantry shifts open this week — an hour makes a real difference. DM me for the sign-up link.', glyph: 'heart' },
  { text: 'The M 408D problem set this week is fair. That is all I will say.' },
  { text: 'Hack night was chaotic in the best way. We shipped a bus tracker that works about 70 percent of the time.', glyph: 'code' },
  { text: 'Neuro seminar today made me want to switch labs. Again.' },
  { text: 'Accounting interview tomorrow. If you see me pacing outside McCombs, say hi or do not, both are fine.' },
  { text: 'Pet-friendly apartment hunting is a nightmare. My dog and I remain hopeful.', glyph: 'home' },
  { text: 'Physics demo day: the Tesla coil worked, the room smelled like ozone, everyone was delighted.', glyph: 'sparkle' },
  { text: 'Exchange semester halfway done. Still not used to the sunsets here.', glyph: 'sun' },
  { text: 'Information Studies capstone: building a search tool for the campus archive. Recruiting testers.', glyph: 'book' },
  { text: 'First week of the new term and the coffee line already wraps around the building.', glyph: 'coffee' },
  { text: 'Wrote my first real Rust program tonight. The compiler and I are becoming friends.', glyph: 'code' },
  { text: 'Public policy debate club meets Wednesday. Topic: campus transit funding. Come argue with us.' },
  { text: 'Robotics test run on the quad. The arm works, the wheels have opinions.', glyph: 'sparkle' },
  { text: 'Symbolic systems reading group starting up. Two chapters a week, one very good bakery.', glyph: 'book' },
  { text: 'Bioengineering lab tour for prospective students was a hit. Someone asked if we grow the mice ourselves.' },
  { text: 'Product design critique tomorrow. Bringing three prototypes and zero confidence.', glyph: 'palette' },
  { text: 'Field trip to the coast for earth systems. Sand in every pocket, data in every notebook.', glyph: 'mountain' },
  { text: 'Shot a scene in the subway at 2 a.m. New York gives you locations for free if you are willing to lose sleep.', glyph: 'film' },
  { text: 'Media studies panel on campus journalism was surprisingly heated. In a good way.' },
  { text: 'Opening night for the spring play is Friday. I know the lines. I think I know the lines.', glyph: 'star' },
  { text: 'Engineering science problem sets keep me humble. Also awake.' },
  { text: 'Anyone selling a mini fridge? The dorm one sounds like a small aircraft.' },
  { text: 'Long run along the river this morning. Legs are done, brain is finally quiet.', glyph: 'mountain' },
  { text: 'Tutoring slots for calculus are open again. Free, on campus, no judgement about the problem set.' },
  { text: 'Stat on the whiteboard today: 73 percent of the class has never used the library printers. Fix that.' },
  { text: 'Two weeks until the design showcase. Prototypes are printing, nerves are printing faster.', glyph: 'sparkle' },
  { text: 'Went to the climbing wall for the first time. Fell a lot. Going back Thursday.', glyph: 'mountain' },
  { text: 'Study playlist recommendations? Instrumental only, no lyrics, no lo-fi rain sounds.', glyph: 'music' },
  { text: 'Poll for my dorm floor: what do we do about the shared kitchen?', poll: ['Cleaning rota', 'Labels on everything', 'Give up, order in'] },
  { text: 'Which campus coffee is actually the best?', poll: ['Union café', 'The cart by the library', 'Vending machine, respectfully', 'Bring your own'] },
  { text: 'Best place to study on a Saturday?', poll: ['Library 24h floor', 'Coffee shop', 'Empty classroom'] },
];

const ORG_POSTS: PostSpec[] = [
  { text: 'Kickoff meeting this Thursday at 6 pm in GDC 2.216. New members welcome — no experience needed, snacks guaranteed.', glyph: 'users' },
  { text: 'Chassis v3 rolled out of the shop today. Race season starts in eight weeks.', glyph: 'trophy' },
  { text: 'Spring concert lineup drops Friday. Follow this account so you do not miss the ticket window.', glyph: 'music' },
  { text: 'This week’s edition is out: parking changes, the new dining hall menu, and a profile of the campus beekeepers.', glyph: 'book' },
  { text: 'Tryouts Saturday morning at the intramural fields. Bring cleats, water and a signed waiver.', glyph: 'ball' },
  { text: 'Belay certification class is full. Second session added next Tuesday — grab a spot before it goes.', glyph: 'mountain' },
  { text: 'Diwali night photos are up. Thank you to the 400 of you who came, danced and ate everything.', glyph: 'sparkle' },
  { text: 'MCAT study group schedule for the semester is posted. Sundays, 2 pm, second-floor study rooms.', glyph: 'book' },
  { text: 'Screening this Wednesday: a restored 35 mm print, free popcorn, discussion after.', glyph: 'film' },
  { text: 'Hack night is back. Theme this month: campus utilities. Teams form at 7, demos at 11.', glyph: 'code' },
  { text: 'Mentorship pairings are out — check your inbox and reach out to your mentor this week.', glyph: 'heart' },
  { text: 'Our robot placed third at regionals. Not bad for a chassis held together with hope and zip ties.', glyph: 'trophy' },
  { text: 'Auditions for the spring showcase: sign up by Friday, bring one prepared piece.', glyph: 'mic' },
  { text: 'Volunteer day this Saturday at the community garden. Gloves provided, tomatoes optional.', glyph: 'leaf' },
  { text: 'Guest talk on Thursday: alumni engineers on what the first year of work is really like.', glyph: 'briefcase' },
  { text: 'Weekly pickup games move indoors starting next week — the rec center court, same time.', glyph: 'ball' },
  { text: 'Photo contest winners announced. First place goes to a picture of a very patient squirrel.', glyph: 'camera' },
  { text: 'Study jam before finals: quiet rooms, free coffee, tutors on call. Sunday through Thursday.', glyph: 'coffee' },
  { text: 'Members: dues are waived this semester for anyone on financial aid. Just tell us.', glyph: 'heart' },
  { text: 'Poll: what should our next workshop cover?', poll: ['Intro to Git', 'Resume review', 'Interview prep', 'Side projects'] },
  { text: 'Which night works best for the general meeting?', poll: ['Tuesday', 'Wednesday', 'Thursday'] },
  { text: 'Our biggest event of the year is coming. Which theme wins?', poll: ['Retro arcade', 'Night market', 'Outdoor cinema'] },
  { text: 'Newsletter sign-ups passed 2,000 this week. Thank you for reading.', glyph: 'star' },
  { text: 'Match report: 3–1 on the road. Photos and highlights later tonight.', glyph: 'ball' },
  { text: 'Boulder problems reset tonight. Come find the new purple route and complain about it with us.', glyph: 'mountain' },
];

const COMMENTS: string[] = [
  'This is great, congrats!', 'Saving this for later.', 'Count me in.', 'Where exactly is this?', 'Needed to hear this today.',
  'Same energy over here.', 'Can confirm, the TA is a saint.', 'Love this photo.', 'What time does it start?', 'Following for updates.',
  'Ok this is actually impressive.', 'Please post the link!', 'I will be there.', 'Big if true.', 'The last option is the only option.',
  'Rooting for you.', 'Did not know this existed, thank you.', 'Send me the details?', 'Third floor is better and quieter.',
  'Ha, the parade is a must.', 'How long did that take?', 'Adding this to my calendar.', 'This made my day.', 'Good luck tomorrow!',
];

const REPLIES: string[] = [
  'Thanks! It took a while.', 'Yes — DMing you.', 'Starts at 7, details in the post.', 'Right by the fountain.', 'Appreciate it!',
  'Haha exactly.', 'Will do.', 'Same, honestly.', 'Ha, thank you.', 'We should go together.',
];

const ASPECTS = ['4:5', '1:1', '16:9'] as const;
const ASPECT_SIZE: Record<(typeof ASPECTS)[number], [number, number]> = { '4:5': [960, 1200], '1:1': [960, 960], '16:9': [1280, 720] };

/* ───────────────────────────── seed ───────────────────────────── */

export default function seed(kit: SeedKit): void {
  const { db } = kit;
  const full = kit.scale === 'full';
  const TOTAL = full ? 90 : 25;
  const POLLS = full ? 8 : 3;
  const maya = kit.users.get(U.mayachen);
  const staffIds = new Set<string>(Object.values(STAFF));
  const tooNew = new Set<string>([U.graceade, U.leofischer]);

  const heroStudents = kit.users.personas.filter((u) => u.universityId === HERO_UNI && u.id !== maya.id && !staffIds.has(u.id) && !tooNew.has(u.id));
  const otherStudents = kit.users.personas.filter((u) => u.universityId !== HERO_UNI && !tooNew.has(u.id));
  const heroOrgs = kit.users.orgs.filter((u) => u.universityId === HERO_UNI);
  const otherOrgs = kit.users.orgs.filter((u) => u.universityId !== HERO_UNI);

  const insPost = db.prepare(
    `INSERT INTO orbit_posts (id, author_id, university_id, text, images_json, has_poll, status, auto_hide_immune, like_count, comment_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'active',0,0,0,?,?)`,
  );
  const insOpt = db.prepare('INSERT INTO orbit_poll_options (id, post_id, idx, text, vote_count) VALUES (?,?,?,?,0)');
  const insVote = db.prepare('INSERT OR IGNORE INTO orbit_poll_votes (post_id, user_id, option_id, created_at) VALUES (?,?,?,?)');
  const bumpOpt = db.prepare('UPDATE orbit_poll_options SET vote_count = vote_count + 1 WHERE id = ?');
  const insLike = db.prepare('INSERT OR IGNORE INTO orbit_likes (post_id, user_id, created_at) VALUES (?,?,?)');
  const insComment = db.prepare(
    "INSERT INTO orbit_comments (id, post_id, author_id, parent_id, text, status, auto_hide_immune, reply_count, created_at) VALUES (?,?,?,?,?,'active',0,0,?)",
  );
  const setCounts = db.prepare('UPDATE orbit_posts SET like_count = ?, comment_count = ? WHERE id = ?');
  const setReplyCount = db.prepare('UPDATE orbit_comments SET reply_count = ? WHERE id = ?');
  const followersStmt = db.prepare('SELECT follower_id AS id FROM follows WHERE followee_id = ? ORDER BY follower_id');
  const followersOf = (userId: Id): Id[] => (followersStmt.all(userId) as { id: Id }[]).map((r) => r.id);

  // ── author plan: Maya 5, a third orgs, ~55 hero at full; polls land on fixed slots so the count is exact
  const studentPlain = kit.sample(STUDENT_POSTS.filter((s) => !s.poll), STUDENT_POSTS.length);
  const studentPolls = kit.sample(STUDENT_POSTS.filter((s) => !!s.poll), STUDENT_POSTS.length);
  const orgPlain = kit.sample(ORG_POSTS.filter((s) => !s.poll), ORG_POSTS.length);
  const orgPolls = kit.sample(ORG_POSTS.filter((s) => !!s.poll), ORG_POSTS.length);
  const mayaSlots = new Set(full ? [1, 6, 14, 27, 44] : [1, 4, 8, 13, 19]);
  const pollSlots = new Set(full ? [2, 9, 16, 24, 33, 41, 52] : [3, 11]); // + Maya's poll = POLLS
  let studentIdx = 0;
  let orgIdx = 0;
  let studentPollIdx = 0;
  let orgPollIdx = 0;
  const heroTarget = full ? 55 : 17;
  let heroCount = 5;

  interface Planned {
    id: Id;
    author: SeedUser;
    spec: PostSpec;
    createdAt: EpochMs;
    images: MediaImage[];
  }
  const planned: Planned[] = [];
  let mayaN = 0;
  let otherN = 5;

  const nextSpec = (org: boolean, poll: boolean): PostSpec => {
    if (poll) {
      if (org) return orgPolls[orgPollIdx++ % orgPolls.length]!;
      return studentPolls[studentPollIdx++ % studentPolls.length]!;
    }
    if (org) return orgPlain[orgIdx++ % orgPlain.length]!;
    return studentPlain[studentIdx++ % studentPlain.length]!;
  };

  for (let i = 0; i < TOTAL; i++) {
    const createdAt = kit.spread(i, TOTAL);
    let author: SeedUser;
    let spec: PostSpec;
    let id: Id;
    if (mayaSlots.has(i)) {
      author = maya;
      spec = MAYA_POSTS[mayaN]!;
      mayaN += 1;
      id = kit.id('post', mayaN);
    } else {
      otherN += 1;
      id = kit.id('post', otherN);
      const wantOrg = kit.chance(0.3);
      const wantHero = heroCount < heroTarget ? kit.chance(0.78) : kit.chance(0.2);
      if (wantOrg) {
        const pool = wantHero || otherOrgs.length === 0 ? heroOrgs : otherOrgs;
        author = kit.pick(pool);
      } else {
        const pool = wantHero || otherStudents.length === 0 ? heroStudents : otherStudents;
        author = kit.pick(pool);
      }
      spec = nextSpec(wantOrg, pollSlots.has(i));
      if (author.universityId === HERO_UNI) heroCount += 1;
    }
    // posts never predate the author's account
    const at = Math.max(createdAt, author.createdAt + 3_600_000);
    const images: MediaImage[] = [];
    if (spec.glyph && !spec.poll && kit.chance(0.62)) {
      const n = kit.int(1, 4);
      const aspect = n === 1 ? kit.pick(ASPECTS) : n === 3 ? '1:1' : kit.pick(['4:5', '1:1'] as const);
      for (let k = 0; k < n; k++) {
        const svg = kit.art.nebulaSvg({ seed: `${id}-${k}`, aspect, glyph: k === 0 ? spec.glyph : undefined });
        const url = kit.art.writeSeedSvg(`orbit/${id}-${k + 1}.svg`, svg);
        const [w, h] = ASPECT_SIZE[aspect];
        images.push({ url, width: w, height: h });
      }
    }
    planned.push({ id, author, spec, createdAt: at, images });
  }

  const pollCount = planned.filter((p) => !!p.spec.poll).length;
  if (pollCount !== POLLS) throw new Error(`04-orbit: planned ${pollCount} polls, expected ${POLLS}`);

  // ── rows
  let mayaLikeNotified = false;
  let mayaCommentNotified = false;
  let commentSeq = 0;

  for (const p of planned) {
    const hasPoll = !!p.spec.poll;
    insPost.run(p.id, p.author.id, p.author.universityId, p.spec.text, JSON.stringify(p.images), hasPoll ? 1 : 0, p.createdAt, p.createdAt);
    markPublicActivity(p.author.id, 'post', p.id, p.createdAt);

    const followers = followersOf(p.author.id).filter((f) => !tooNew.has(f));
    const between = (from: EpochMs): EpochMs => Math.round(from + kit.rng() * Math.max(60_000, kit.now - from));

    // poll options + votes
    if (hasPoll) {
      const optionIds: Id[] = [];
      p.spec.poll!.forEach((text, idx) => {
        const oid = `${p.id}_o${idx + 1}`;
        insOpt.run(oid, p.id, idx, text);
        optionIds.push(oid);
      });
      const voters = kit.sample(followers, Math.min(followers.length, kit.int(3, full ? 40 : 12)));
      const weights = optionIds.map(() => 0.4 + kit.rng());
      for (const v of voters) {
        // weighted pick keeps the results lopsided instead of flat
        let r = kit.rng() * weights.reduce((a, b) => a + b, 0);
        let chosen = optionIds[0]!;
        for (let k = 0; k < optionIds.length; k++) {
          r -= weights[k]!;
          if (r <= 0) {
            chosen = optionIds[k]!;
            break;
          }
        }
        if (insVote.run(p.id, v, chosen, between(p.createdAt)).changes) bumpOpt.run(chosen);
      }
    }

    // likes: power-law share of the author's followers
    const share = Math.pow(kit.rng(), 2) * 0.7;
    let likerCount = Math.min(followers.length, Math.floor(followers.length * share), 80);
    if (p.author.id === maya.id && p.id === 'post_0001') likerCount = Math.max(likerCount, Math.min(followers.length, 13));
    const likers = kit.sample(followers, likerCount);
    let likeRows = 0;
    let latestLike = p.createdAt;
    for (const l of likers) {
      const at = between(p.createdAt);
      if (insLike.run(p.id, l, at).changes) {
        likeRows += 1;
        latestLike = Math.max(latestLike, at);
      }
    }

    // comments (+ one level of replies)
    let commentRows = 0;
    const wantComments = p.id === 'post_0002' || kit.chance(0.55);
    if (wantComments && followers.length > 0) {
      const n = Math.min(followers.length, p.id === 'post_0002' ? kit.int(2, 4) : kit.int(1, 5));
      const commenters = kit.sample(followers, n);
      for (const c of commenters) {
        commentSeq += 1;
        const cid = kit.id('pcmt', commentSeq);
        const at = between(p.createdAt);
        const text = kit.pick(COMMENTS);
        insComment.run(cid, p.id, c, null, text, at);
        commentRows += 1;
        let replies = 0;
        if (kit.chance(0.3)) {
          // the author replies, or another follower does
          const replier = kit.chance(0.6) ? p.author.id : kit.pick(followers);
          if (replier !== c) {
            commentSeq += 1;
            const rid = kit.id('pcmt', commentSeq);
            insComment.run(rid, p.id, replier, cid, kit.pick(REPLIES), between(at));
            replies += 1;
            commentRows += 1;
          }
        }
        if (replies > 0) setReplyCount.run(replies, cid);
        if (p.id === 'post_0002' && !mayaCommentNotified) {
          mayaCommentNotified = true;
          kit.notify({
            userId: maya.id, type: 'post.comment', actorId: c, href: `/post/${p.id}`,
            target: { entityType: 'orbit_post', entityId: p.id }, data: { snippet: text, commentId: cid },
            createdAt: at, read: false,
          });
        }
      }
    }
    setCounts.run(likeRows, commentRows, p.id);

    if (p.id === 'post_0001' && likers.length > 0 && !mayaLikeNotified) {
      mayaLikeNotified = true;
      kit.notify({
        userId: maya.id, type: 'post.like', actorId: likers[likers.length - 1]!, actorIds: likers, href: `/post/${p.id}`,
        target: { entityType: 'orbit_post', entityId: p.id }, thumbnailUrl: p.images[0]?.url ?? null,
        data: { snippet: p.spec.text.slice(0, 80) }, createdAt: latestLike, read: true,
      });
    }
  }

  // ── campus reach (DECISIONS D8). Maya follows most of the hero campus's active posters, so the newest posts of two
  // hero students she does NOT follow pick up likes from across the campus (not only from the author's followers) and
  // reach her Orbit as "Popular at UT Austin". No rng draw here: every later seed keeps its random stream.
  const REACH_LIKES = full ? 24 : 12;
  const mayaFollows = new Set(kit.follows(maya.id));
  const campusLikers = kit.users.all
    .filter((u) => u.universityId === HERO_UNI && u.accountType === 'student' && u.id !== maya.id && !staffIds.has(u.id) && !tooNew.has(u.id))
    .map((u) => u.id)
    .sort();
  const reach = planned
    .filter((p) => p.author.universityId === HERO_UNI && p.author.accountType === 'student' && p.author.id !== maya.id && !mayaFollows.has(p.author.id) && !p.spec.poll)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .filter((p, i, list) => list.findIndex((q) => q.author.id === p.author.id) === i) // newest post per author
    .slice(0, 2);
  const recountLikes = db.prepare('UPDATE orbit_posts SET like_count = (SELECT COUNT(*) FROM orbit_likes WHERE post_id = ?) WHERE id = ?');
  for (const p of reach) {
    let added = 0;
    for (const liker of campusLikers) {
      if (added >= REACH_LIKES) break;
      if (liker === p.author.id) continue;
      if (insLike.run(p.id, liker, Math.min(kit.now, p.createdAt + (added + 1) * 7 * 60_000)).changes) added += 1;
    }
    recountLikes.run(p.id, p.id);
  }

  // Maya last opened Orbit two days ago → the "New since your last visit" divider has something to divide.
  db.prepare('INSERT OR REPLACE INTO orbit_visits (user_id, last_seen_at) VALUES (?, ?)').run(maya.id, kit.ago({ d: 2 }));

  // sanity: every denormalised counter equals its rows (fails loudly in db:reset / tests)
  const drift = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orbit_posts p
        WHERE p.like_count != (SELECT COUNT(*) FROM orbit_likes l WHERE l.post_id = p.id)
           OR p.comment_count != (SELECT COUNT(*) FROM orbit_comments c WHERE c.post_id = p.id AND c.status = 'active')`,
    )
    .get() as { n: number };
  if (drift.n > 0) throw new Error(`04-orbit: ${drift.n} post(s) with counter drift`);
}
