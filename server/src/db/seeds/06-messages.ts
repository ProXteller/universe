/**
 * `messages` seed (SPEC §5.6 / §7.5). Everything goes through `kit.convo.*` (silent: no notifications, no ws).
 *
 * Maya: 6 DMs (sofiaram, arjunp, hannahkim, noahg, jordan_builds, priya_n — 8–25 messages each, 2 left unread),
 * 2 groups ("CS 429 project team", "Apartment hunt"), 2 requests (graceade plain; owenpark plain with a B-OFFPLATFORM
 * banner) and ONE `message.request` notification (unread) — §7.5 "messages 1 (1)".
 * Plus ~10 conversations among other personas. Listing / roommate / course conversations belong to market /
 * roommates / campus. Deterministic: `kit.rng` only; identical at `lite` and `full` (personas exist at both).
 */
import type { Id, RecipientBanner } from '@shared/core';
import type { SeedKit, SeedUser } from '../../lib/seedKit';

type Line = readonly [who: string, text: string];

interface DmSpec {
  peer: string;
  /** Minutes ago of the FIRST line. */
  startAgoMin: number;
  lines: readonly Line[];
  /** Maya has not opened this chat since the peer's last messages. */
  unreadForMaya?: boolean;
}

const M = 'mayachen';

/* ───────────────────────────── Maya's DMs ───────────────────────────── */

const MAYA_DMS: readonly DmSpec[] = [
  {
    peer: 'sofiaram',
    startAgoMin: 3 * 60 + 40,
    unreadForMaya: true,
    lines: [
      ['sofiaram', 'ok the tour at the Nueces place is tomorrow at 4, can you still make it?'],
      [M, 'yes! meeting at the GDC atrium at 3:30 and walking over?'],
      ['sofiaram', 'perfect. Priya said she might come too'],
      [M, 'the more eyes the better, that listing had zero photos of the bathroom which is suspicious'],
      ['sofiaram', 'lol that is exactly why we are going'],
      ['sofiaram', 'also the group said $1,450 for a 3br but the site says $1,520 now'],
      [M, 'ugh. ask if the lower number still stands before we go'],
      ['sofiaram', 'emailed them'],
      [M, 'how was clinical this morning btw'],
      ['sofiaram', 'up at 5am again. i have seen things.'],
      ['sofiaram', 'anyway they replied: $1,450 holds if we sign by Friday'],
      ['sofiaram', 'so we should talk tonight in the group'],
    ],
  },
  {
    peer: 'arjunp',
    startAgoMin: 2 * 24 * 60 + 90,
    lines: [
      ['arjunp', 'do you still have the intro to algorithms textbook from last spring?'],
      [M, 'the CLRS brick? yes, it is holding up my monitor'],
      ['arjunp', 'ha. my cousin is taking 331 and refuses to pay $140 for it'],
      [M, 'i will sell it for 40 and she can have the monitor stand back'],
      ['arjunp', 'deal, i will pass it on'],
      ['arjunp', 'also are you going to the McCombs career expo thursday?'],
      [M, 'thinking about it. is it only finance people'],
      ['arjunp', 'no, half the booths are tech. bring copies of your resume'],
      [M, 'ok you convinced me. see you there'],
      ['arjunp', 'sweet'],
    ],
  },
  {
    peer: 'hannahkim',
    startAgoMin: 26 * 60,
    lines: [
      ['hannahkim', 'PCL study session tonight, room 2.320 at 7. i booked it for three hours'],
      [M, 'coming. can we do 429 stuff for the first hour'],
      ['hannahkim', 'yes, andre said he would bring the whiteboard markers this time'],
      [M, 'famous last words'],
      ['hannahkim', 'lmao'],
      ['hannahkim', 'the cache simulator part is due sunday right'],
      [M, 'sunday 11:59. the write-up is due with it'],
      ['hannahkim', 'ok good, i thought it was saturday and nearly had a heart attack'],
      [M, 'you would have been fine, you always are'],
      ['hannahkim', 'flattery accepted'],
      ['hannahkim', 'bringing snacks, any allergies in the group'],
      [M, 'mei is vegetarian, otherwise no'],
      ['hannahkim', 'noted, see you at 7'],
      [M, 'see you'],
    ],
  },
  {
    peer: 'noahg',
    startAgoMin: 8 * 60 + 15,
    unreadForMaya: true,
    lines: [
      ['noahg', 'the reel from the tower lighting came out so clean, thanks for holding the light'],
      [M, 'my arms are still sore but worth it'],
      ['noahg', 'i owe you a coffee'],
      [M, 'i will collect. when is the next shoot'],
      ['noahg', 'saturday at sunrise on the south lawn if the weather holds'],
      [M, 'sunrise. ok. text me the night before so i actually wake up'],
      ['noahg', 'will do'],
      ['noahg', 'also can you send me that timelapse app you mentioned'],
      ['noahg', 'the one that does the hyperlapse smoothing'],
    ],
  },
  {
    peer: 'jordan_builds',
    startAgoMin: 5 * 24 * 60 + 30,
    lines: [
      ['jordan_builds', 'battery pack rebuild is done. we test on the track sunday at 8'],
      [M, 'finally! is it ok if i come film for the orbit post'],
      ['jordan_builds', 'please do, we need footage for the sponsor deck'],
      [M, 'ok. what should i not touch'],
      ['jordan_builds', 'anything orange'],
      [M, 'noted'],
      ['jordan_builds', 'the new telemetry board is reading 3% high on the pack voltage, trying to figure out why'],
      [M, 'reference voltage drift? the old board did the same thing in the heat'],
      ['jordan_builds', 'that was my guess too. swapping the regulator tonight'],
      [M, 'let me know if it fixes it'],
      ['jordan_builds', 'swap worked. reading dead on now'],
      [M, 'nice'],
      ['jordan_builds', 'we hit 61 mph on the back straight'],
      [M, 'WHAT'],
      ['jordan_builds', 'new team record. the driver was screaming'],
      [M, 'i want to see the footage'],
      ['jordan_builds', 'sending after we check the pack temps'],
      ['jordan_builds', 'temps fine, uploading now'],
      [M, 'post it on the team page and i will reshare'],
      ['jordan_builds', 'on it'],
    ],
  },
  {
    peer: 'priya_n',
    startAgoMin: 9 * 24 * 60,
    lines: [
      ['priya_n', 'hey! sofia said you might be looking for a place next semester too'],
      [M, 'yeah, ideally west campus, under 800 each'],
      ['priya_n', 'same. i have a room opening up in june if the timing works'],
      [M, 'june could work. is it the hyde park place'],
      ['priya_n', 'yes, the one with the porch. quiet street'],
      [M, 'ok that sounds great, let me talk to sofia'],
      ['priya_n', 'no rush. also do you know anyone selling a desk chair, mine finally died'],
      [M, 'lucas was selling one on market, i will send you the listing'],
    ],
  },
];

/* ───────────────────────────── Maya's groups ───────────────────────────── */

interface GroupSpec {
  title: string;
  owner: string;
  members: readonly string[];
  startAgoMin: number;
  lines: readonly Line[];
}

const MAYA_GROUPS: readonly GroupSpec[] = [
  {
    title: 'CS 429 project team',
    owner: M,
    members: ['hannahkim', 'andresilva', 'meitanaka'],
    startAgoMin: 30 * 60,
    lines: [
      [M, 'made this so we stop losing the plan in the course chat'],
      ['andresilva', 'good call'],
      ['meitanaka', 'so: cache simulator + write-up due sunday. who has what'],
      [M, 'i will take the replacement policy code, andre does the trace parser?'],
      ['andresilva', 'yep. i have most of the parser from lab 3 anyway'],
      ['hannahkim', 'i can do the write-up and the graphs if someone sends me the numbers by saturday'],
      ['meitanaka', 'i will do the test traces and the associativity sweep'],
      [M, 'perfect, that covers everything'],
      ['andresilva', 'parser pushed. it handles the weird L2 lines now'],
      ['meitanaka', 'running the sweep tonight'],
      ['hannahkim', 'study room booked for 7 tonight, PCL 2.320'],
      [M, 'see everyone there'],
      ['meitanaka', 'sweep results are in the shared folder, LRU wins by a mile'],
      ['andresilva', 'as expected'],
    ],
  },
  {
    title: 'Apartment hunt',
    owner: 'sofiaram',
    members: [M, 'priya_n', 'laylah'],
    startAgoMin: 7 * 24 * 60,
    lines: [
      ['sofiaram', 'ok apartment people. budget check: under 800 each, west campus or hyde park?'],
      [M, 'under 800, and i would go as far as north campus'],
      ['laylah', 'same but i have a cat so pet policy matters'],
      ['priya_n', 'hyde park place is cat friendly fyi'],
      ['sofiaram', 'noting that'],
      ['laylah', 'found one on Nueces, 3br, $1,450, tour available this week'],
      [M, 'photos look ok but zero of the bathroom'],
      ['sofiaram', 'i will book the tour'],
      ['priya_n', 'i can come if it is after 3'],
      ['sofiaram', 'tomorrow at 4. meet at GDC 3:30'],
      ['laylah', 'in'],
      [M, 'in'],
    ],
  },
];

/* ───────────────────────────── other personas ───────────────────────────── */

const OTHER_DMS: readonly DmSpec[] = [
  {
    peer: 'tbrooks',
    startAgoMin: 4 * 60,
    lines: [
      ['jordan_builds', 'you still coming to the shop tonight? we need hands for the fairing'],
      ['tbrooks', 'yes, after intramurals. 8ish'],
      ['jordan_builds', 'bring gloves this time'],
      ['tbrooks', 'i learned my lesson'],
    ],
  },
  {
    peer: 'bellarossi',
    startAgoMin: 20 * 60,
    lines: [
      ['aaliyah_w', 'the print of your mural piece is in the daily office, come grab it whenever'],
      ['bellarossi', 'omg thank you. tomorrow afternoon ok?'],
      ['aaliyah_w', 'anytime after 1'],
      ['bellarossi', 'perfect'],
      ['aaliyah_w', 'also we want to run a feature on the art building show, you in?'],
      ['bellarossi', 'yes yes yes'],
    ],
  },
  {
    peer: 'diegoh',
    startAgoMin: 2 * 24 * 60,
    lines: [
      ['hannahkim', 'is pickup still thursday at the intramural fields'],
      ['diegoh', 'yes, 6pm, field 3'],
      ['hannahkim', 'cool, bringing two people from my lab'],
      ['diegoh', 'the more the better, we were short last week'],
      ['hannahkim', 'do they need cleats'],
      ['diegoh', 'turf shoes are fine'],
    ],
  },
  {
    peer: 'andresilva',
    startAgoMin: 3 * 24 * 60,
    lines: [
      ['meitanaka', 'your parser is choking on the trace with the blank line at the end'],
      ['andresilva', 'ah. skipping empty lines now, pushed'],
      ['meitanaka', 'works. thanks'],
      ['andresilva', 'also want to do hack night friday? they have a hardware table this time'],
      ['meitanaka', 'sure, i will bring the oscilloscope'],
    ],
  },
  {
    peer: 'fatima_as',
    startAgoMin: 6 * 24 * 60,
    lines: [
      ['oliviab', 'can the events board co-host the pantry drive? we can cover the flyers'],
      ['fatima_as', 'that would be amazing, we need help with pickup too'],
      ['oliviab', 'i can get two volunteers with a car'],
      ['fatima_as', 'you are a lifesaver. saturday 10am at the union?'],
      ['oliviab', 'locked in'],
    ],
  },
  {
    peer: 'lucas_oli',
    startAgoMin: 8 * 24 * 60,
    lines: [
      ['marcusj', 'is the bike still available? the blue one'],
      ['lucas_oli', 'it is! i can meet at the safe-exchange zone by UTPD'],
      ['marcusj', 'tomorrow at noon?'],
      ['lucas_oli', 'works. bring a lock, it does not come with one'],
      ['marcusj', 'will do'],
    ],
  },
  {
    peer: 'calebt',
    startAgoMin: 11 * 24 * 60,
    lines: [
      ['emmalq', 'hi, i saw your roommate post. i am a night owl too but not a smoker, would that be a problem?'],
      ['calebt', 'not a problem at all, i only smoke on the balcony'],
      ['emmalq', 'ok good to know. what is the move-in date'],
      ['calebt', 'august 15'],
    ],
  },
  {
    peer: 'devonw',
    startAgoMin: 30 * 60,
    lines: [
      ['ninakow', 'did you get tickets for the game saturday'],
      ['devonw', 'student section, row 12'],
      ['ninakow', 'jealous. save me a spot if anyone bails'],
      ['devonw', 'will do'],
    ],
  },
  {
    peer: 'elenap',
    startAgoMin: 2 * 24 * 60 + 200,
    lines: [
      ['kaiyama', 'the symbolic systems mixer got moved to Tresidder, 6pm'],
      ['elenap', 'thanks for the heads up, i was going to show up at the wrong building'],
      ['kaiyama', 'you and half the list'],
      ['elenap', 'see you there'],
    ],
  },
  {
    peer: 'hanasato',
    startAgoMin: 4 * 24 * 60,
    lines: [
      ['rafacruz', 'need a boom operator for the short on sunday, are you free?'],
      ['hanasato', 'free after noon. is it the washington square one?'],
      ['rafacruz', 'yes, call time 1pm at the arch'],
      ['hanasato', 'in. i will bring the windscreen'],
      ['rafacruz', 'legend'],
    ],
  },
];

const OTHER_GROUPS: readonly GroupSpec[] = [
  {
    title: 'Pickup soccer Thursdays',
    owner: 'diegoh',
    members: ['tbrooks', 'marcusj', 'andresilva', 'hannahkim'],
    startAgoMin: 26 * 60,
    lines: [
      ['diegoh', 'thursday 6pm, field 3, same as always'],
      ['tbrooks', 'in'],
      ['marcusj', 'in, bringing a ball'],
      ['andresilva', 'might be 15 late, lab runs over'],
      ['hannahkim', 'bringing two from my lab'],
      ['diegoh', 'perfect, that is 12 with the regulars'],
    ],
  },
];

/* ───────────────────────────── Maya's requests ───────────────────────────── */

interface RequestSpec {
  from: string;
  agoMin: number;
  text: string;
  banner?: RecipientBanner;
  /** The ONE `message.request` notification of §7.5. */
  notify?: boolean;
}

const MAYA_REQUESTS: readonly RequestSpec[] = [
  {
    from: 'graceade',
    agoMin: 22 * 60,
    text: "hi Maya! i'm a freshman and saw you're a CS junior. could i ask you a couple of questions about registering for 314? the advisor queue is three weeks long",
    notify: true,
  },
  {
    from: 'owenpark',
    agoMin: 3 * 24 * 60 + 45,
    text: "hey, saw your post about the physics study group. text me at 512-555-0142 and I'll add you to the group off here",
    banner: 'B-OFFPLATFORM',
  },
];

/* ───────────────────────────── seed ───────────────────────────── */

export default function seed(kit: SeedKit): void {
  const maya = kit.users.get(M);

  /** Sends `lines` in order, a deterministic few minutes apart; returns the last timestamp. */
  function play(conversationId: Id, startAgoMin: number, lines: readonly Line[]): number {
    let at = kit.ago({ m: startAgoMin });
    for (const [who, text] of lines) {
      kit.convo.say(conversationId, kit.users.get(who).id, text, at);
      at += kit.int(1, 9) * 60_000;
    }
    return at;
  }

  /** The two parties of a DM spec: whoever speaks first opens it; `peer` (or Maya) is the other side. */
  function parties(spec: DmSpec, fallback: SeedUser): { opener: SeedUser; other: SeedUser } {
    const first = kit.users.get(spec.lines[0]![0]);
    const peer = kit.users.get(spec.peer);
    return { opener: first, other: first.id === peer.id ? fallback : peer };
  }

  // Maya's DMs
  for (const spec of MAYA_DMS) {
    const peer = kit.users.get(spec.peer);
    const { opener, other } = parties(spec, maya);
    const id = kit.convo.dm(opener.id, other.id);
    play(id, spec.startAgoMin, spec.lines);
    kit.convo.readAll(id, peer.id);
    if (!spec.unreadForMaya) kit.convo.readAll(id, maya.id);
  }

  // Maya's groups (everyone but Maya has read everything; Maya read hers too)
  for (const spec of MAYA_GROUPS) {
    const owner = kit.users.get(spec.owner);
    const members = spec.members.map((h) => kit.users.get(h).id);
    const id = kit.convo.group(spec.title, owner.id, members);
    play(id, spec.startAgoMin, spec.lines);
    for (const uid of [owner.id, ...members]) kit.convo.readAll(id, uid);
  }

  // Maya's requests: the sender is 'active', Maya is 'request'; nothing is read on Maya's side
  for (const spec of MAYA_REQUESTS) {
    const from = kit.users.get(spec.from);
    const id = kit.convo.dm(from.id, maya.id, { peerState: 'request' });
    const at = kit.ago({ m: spec.agoMin });
    kit.convo.say(id, from.id, spec.text, at, spec.banner ? { banner: spec.banner } : undefined);
    kit.convo.readAll(id, from.id);
    if (spec.notify) {
      kit.notify({
        userId: maya.id, type: 'message.request', actorId: from.id, href: `/messages/${id}`,
        target: { entityType: 'conversation', entityId: id }, data: { hasContext: false }, collapse: false,
        createdAt: at, read: false,
      });
    }
  }

  // Other personas (every OTHER_DMS spec opens with the non-peer party, so `fallback` is never reached)
  for (const spec of OTHER_DMS) {
    const { opener, other } = parties(spec, maya);
    const id = kit.convo.dm(opener.id, other.id);
    play(id, spec.startAgoMin, spec.lines);
    kit.convo.readAll(id, opener.id);
    kit.convo.readAll(id, other.id);
  }
  for (const spec of OTHER_GROUPS) {
    const owner = kit.users.get(spec.owner);
    const members = spec.members.map((h) => kit.users.get(h).id);
    const id = kit.convo.group(spec.title, owner.id, members);
    play(id, spec.startAgoMin, spec.lines);
    for (const uid of [owner.id, ...members]) kit.convo.readAll(id, uid);
  }
}
