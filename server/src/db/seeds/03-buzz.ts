/**
 * `buzz` seed (SPEC §5.3 / §7.5). Deterministic (`kit.rng` only), both scales, every counter equals its rows.
 *
 *  full: 60 prompts · 180 threads (110 hero) · ~900 replies · ~4,500 votes · 12 polls · 2 auto-hidden · 1 collapsed
 *  lite: 60 prompts ·  30 threads (20 hero)  · ~120 replies ·   ~400 votes ·  4 polls · 2 auto-hidden · 1 collapsed
 *  Maya: buzz_0001 (14 replies), buzz_0002 (poll closing in 3 days), buzz_0003; notifications buzz.reply (unread) +
 *        buzz.milestone (read). Fixtures (FINAL ids, authors = background users): buzz_0101 hidden, buzz_0102 active.
 *  Replies are written per thread (`TALK` + its topic `FAMILY`): no thread hears a line written for another topic.
 *
 * Buzz NEVER calls markPublicActivity. Text hygiene: no seeded handle / display name may appear in any Buzz text
 * (asserted below against kit.users.all — the firewall tests substring-match every seeded identity string).
 */
import crypto from 'node:crypto';
import type { Id } from '@shared/core';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { DAY, HOUR, MIN } from '../../lib/clock';
import { UNI } from './ids';

/* ───────────────────────────── text pools (product §5 tone: specific, funny, a little vulnerable, never naming anyone) ───────────────────────────── */

const PROMPTS = [
  'What is the most underrated spot on campus?', 'Confess a study habit that should not work but does.', 'What did you think college would be like vs. what it is?',
  'Best cheap meal within walking distance?', 'What class changed how you think?', 'One thing you wish you knew freshman year.',
  'Where do you go when you need to be alone for an hour?', 'What is the pettiest reason you dropped a class?', 'Describe your roommate situation in five words.',
  'What campus rule makes zero sense?', 'What is your unpopular opinion about the dining halls?', 'Which building is secretly the best to study in?',
  'What small thing made your week?', 'How are you actually doing today?', 'What is a hobby you picked up here and kept?',
  'What is the worst group project story you have?', 'Best place to cry on campus (asking for a friend)?', 'What is something you are proud of that nobody knows?',
  'Overheard something wild on campus lately?', 'What is your go-to late-night snack?', 'Which professor habit is oddly charming?',
  'What is the most chaotic thing that happened in one of your classes?', 'What would you tell your first-week self?', 'What is your walk-to-class soundtrack right now?',
  'What do you do between back-to-back classes?', 'What is the best free thing on campus?', 'What is your most irrational campus fear?',
  'How do you make friends after week 5?', 'What is a class you took for fun that was worth it?', 'What is your bus stop horror story?',
  'What is the best thing about living where you live?', 'Which vending machine is the most reliable?', 'What do you miss about home this week?',
  'What is the weirdest thing you have seen someone bring to a lecture?', 'What is your midterm-week coping mechanism?', 'Is it normal to feel behind? (asking honestly)',
  'What is a campus tradition you did not get at first but love now?', 'What would you change about registration?', 'What is your unpopular library opinion?',
  'What is the nicest thing a stranger did for you on campus?', 'Best place to watch a sunset near campus?', 'What is your go-to order at the closest coffee spot?',
  'What are you looking forward to this semester?', 'What is your biggest campus pet peeve?', 'What is the most useful thing in your backpack?',
  'What is a small win from this week?', 'What is a skill you learned purely from being broke?', 'What was your best campus job?',
  'What would make the gym less terrifying?', 'What is your favorite corner of the union?', 'What is a myth about your major?',
  'What is the best way to survive an 8am?', 'Where do you actually get work done?', 'What is your rainy-day campus routine?',
  'What advice would you give an exchange student?', 'What is your worst laundry-room story?', 'What is something you changed your mind about this year?',
  'What do you wish there were more of on campus?', 'How do you deal with homesickness?', 'What is your favorite campus sound?',
];

/** Hero-campus roots (UT Austin places). */
const HERO_ROOTS = [
  'Registration opens at 8:00. The site crashes at 8:00. Every semester. It\'s tradition at this point.',
  'PCL 5th floor at 2am has a specific kind of silence that is really just collective despair.',
  'Saw the albino squirrel before my ochem exam. Got a 58. The squirrel is a fraud.',
  'To whoever turned in my wallet at the Gregory front desk with the cash still in it: you restored about 40% of my faith in people.',
  'Is it normal to not have a friend group yet? It\'s week 5 and everyone seems to have their people.',
  'Career fair tip: the big-name lines are 90 minutes. The mid-size companies next to them are hiring the same roles and will actually talk to you.',
  'The parking permit costs more than my first car.',
  'GDC atrium at 9am is a coworking space. GDC atrium at 9pm is a support group.',
  'Overheard on Speedway: "I can\'t fail, I already told my mom I got an A."',
  'The Jester elevator has feelings and today they are negative.',
  'Kinsolving breakfast tacos are the only reason I am a morning person.',
  'The 803 bus arrived early today. I did not board. I was too shocked.',
  'Somebody in Welch is microwaving fish at 8am and I need to know why.',
  'Turtle pond at sunset is free therapy and nobody talks about it.',
  'Week 6 update: I have learned nothing and I have never been more tired.',
  'The Union basement bowling alley is the most underrated date spot on campus. Fight me.',
  'Guy in my discussion section brought a full rotisserie chicken. No plate. Respect.',
  'Wifi in PCL drops every time it matters. I think it can sense a deadline.',
  'My roommate labels his eggs individually. Individually. With a Sharpie.',
  'Homesick today. Not sad exactly. Just want my mom\'s kitchen for ten minutes.',
  'Gregory at 5pm is not a gym, it is a queue with weights in it.',
  'If you sat in the second row of my stats lecture and laughed at the joke about confidence intervals, marry me.',
  'The library printers work perfectly for everyone except the person who is running late.',
  'Internship anxiety hours: everybody around me has an offer and I have a color-coded spreadsheet of rejections.',
  'PSA: the water fountain by the GDC stairwell is colder than the others. That is the post.',
  'Took a nap in the Union and woke up to a guitar circle. Would recommend.',
  'The line for the taco truck on Speedway is longer than the line at the health center. Priorities are correct.',
  'First time in the Welch basement. It is a different climate down there.',
  'Roommate friction of the week: he thinks the AC should be at 78. In Austin. In September.',
  'Someone left encouraging sticky notes in the PCL bathroom stalls and I read every single one.',
  'Bus driver on the 640 waited for me while I sprinted a full block. Legend.',
  'Question for seniors: does it get better or do you just get better at pretending?',
  'The stadium lights are on and I have three problem sets due. Both of these things are true.',
  'Lab partner said "we\'ll figure it out" for the third week in a row. We have not figured it out.',
  'Grad student confession: I have been "about to submit" for 11 days.',
  'The Union Starbucks line moves faster if you order something boring. Science.',
  'A duck chased me near the turtle pond and honestly it was the most attention I have gotten all week.',
  'Exchange student here. Everyone says "y\'all" so nicely that I have started saying it and I cannot stop.',
  'PCL 6th floor windows at golden hour make the reading room look like a movie. Then you remember the reading.',
  'Overheard in Jester: "I\'m not procrastinating, I\'m letting the ideas marinate."',
  'Shoutout to whoever plays piano in the Union lobby on Thursdays. You make the whole building nicer.',
  'Intramural soccer update: we lost 7-0 and had the most fun on the field. That is the whole sport.',
  'I finally used the campus counseling center and the only regret is that I waited a year.',
  'The Speedway wind tunnel took my quiz paper and I watched it fly toward the tower like a farewell.',
  'How is the vending machine in Burdine always out of everything except one flavor of gum?',
  'Told my advisor I want to switch majors. She said "finally." Rude but fair.',
  'The GDC has a room that is always 12 degrees colder than the rest. I go there to feel something.',
  'My 8am professor brings her dog on Fridays. Attendance on Fridays is 100%.',
  'Dining hall verdict: the pasta bar is carried entirely by the garlic bread.',
  'Someone in my dorm practices trumpet at 11pm and honestly they are getting better.',
  'Gregory pool at 7am: three people and total peace. The secret is out now.',
  'Does anyone else feel like the tower is watching them study? Just me? Fine.',
  'To the person who returned my AirPods at the Union desk: I hope your exams go great forever.',
  'Career fair recap: talked to 14 recruiters, got 14 pens, 0 interviews, 1 free tote. Net positive.',
  'The 2am fire drill in Jester was character building. My character is now tired.',
  'Small win: went to office hours for the first time and the professor remembered my name.',
  'The campus ducks have better work-life balance than any of us.',
  'Riverside living update: the commute is long but the rent lets me eat real food.',
  'I have started rating the study rooms in PCL like restaurants. Room 3.208: 4 stars, one flickering light.',
  'Overheard at Kinsolving: "I have a 4.0 in vibes."',
  'Somebody moved my laundry to the top of the dryer and folded it. Who are you. Thank you.',
  'Freshman here. Is it a rite of passage to get lost in Welch or am I just bad at buildings?',
  'The line at the health center flu shot clinic was so long they started handing out stickers. I got two.',
  'My lab TA explains things like she is defusing a bomb and I am grateful for the care.',
  'Study spot review: the Union 4th floor lounge. Quiet, plugs, one couch that eats people.',
  'First cold front of the semester and every person on Speedway is in a hoodie like it is 40 degrees. It is 68.',
  'Nobody warned me that the walk from Jester to the engineering buildings counts as cardio.',
  'The astronomy department does free telescope nights and I saw Saturn. Actual Saturn. Go.',
  'When the professor says "this won\'t be on the exam" I stop listening and it has never once been true.',
  'Someone left a whole birthday cake in the GDC kitchen with a note that said "share." We shared.',
  'Wholesome: an older student in my section stayed after to help three of us with recursion. No reason. Just kind.',
  'The Union coffee is bad and I will die defending it.',
  'Turns out the campus barber is $12 and excellent. The secret dies with this post.',
  'My roommate and I have a shared calendar now and our friendship has never been stronger.',
  'Realized halfway through lecture that I have been in the wrong class for two weeks. Stayed. It was interesting.',
  'Three exams in one week is not a schedule, it is a stress test of the human body.',
  'If you drop something on the PCL stairs it becomes public property. Those are the rules.',
  'The lady at the Jester cereal station knows my order and honestly that is love.',
  'Guy on the bus was reading a physical newspaper and I felt like I was watching history.',
  'Best kept secret: the courtyard behind the art building at lunchtime. Empty. Sunny. Mine.',
  'Just got my first A on a chem exam after two Cs. Posting here because I have nobody to tell yet.',
  'Overheard on the 801: "I didn\'t know we could just email professors."',
  'The Speedway squirrels have zero fear and I think they run this campus.',
  'Weekend plan: sleep, laundry, sleep, tell people I studied.',
  'Whoever chalked "you are doing great" on the walkway near Welch: I needed that more than you know.',
  'I miss my dog more than I miss my family and I feel guilty about it.',
  'Pickup soccer on the intramural fields on Thursday nights is the most welcoming thing on this campus.',
  'Coffee at the Union, nap at PCL, cry at Jester. The campus triathlon.',
  'Told myself I would go to every lecture this semester. It is week 7. Attendance: spiritual.',
  'The engineering courtyard has a ping pong table now and productivity has left the building.',
  'Every group project has one person who "will send it tonight" and it is never tonight.',
  'Someone plays the cello in the stairwell of the music building and I have started taking the stairs on purpose.',
  'Small campus confession: I wave at the same stranger every morning and I do not know his name and I never will.',
  'New account here. Is Buzz always this nice or did I catch it on a good day?',
  'Rent went up $150 in West Campus and my landlord called it a "market adjustment." I called it a lot of things.',
  'The tutoring center saved my calc grade. Free. Nobody uses it. Use it.',
  'You have not lived until you have watched a raccoon open a Gregory trash can with intent.',
  'Fall registration advice: the professor matters more than the time slot. Trust me. 8am with a great teacher beats 2pm with a monotone.',
  'I will never get used to how fast the sun sets now. Left lecture in daylight, walked out of the library into night.',
  'Whoever runs the printer on PCL 2 deserves a raise. It has never once jammed on me.',
  'Dining hall hot take: the soft serve machine being broken is a feature, not a bug.',
  'Study group of four turned into a friend group of four and I did not see it coming.',
  'Chem building smells like ambition and burnt something.',
  'Watching people try to parallel park on the street by the dorms is my new hobby.',
  'It is okay to eat alone in the dining hall. Posting this for me as much as anyone.',
  'My favorite tradition is the collective groan when the lecture hall projector takes 90 seconds to warm up.',
  'Finally learned all the bus routes and I feel like I own the city.',
  'The most Austin thing that has happened to me: a guy on a unicycle passed me on the drag while eating a breakfast taco.',
];

/** Generic roots (any campus). */
const GENERIC_ROOTS = [
  'The library heater has two settings: off and sauna.',
  'First snow of the year and the campus has forgotten how to walk.',
  'Group project rule: whoever suggests "let\'s just meet in person" is the real leader.',
  'The dining hall changed the fries recipe and I am not okay.',
  'Any tips for surviving a 3-hour night lecture? Asking for my eyelids.',
  'Someone in the study lounge is eating an apple so loudly that I have memorized the rhythm.',
  'Found a quiet floor in the library that nobody uses. I will not say which one.',
  'Got a "we regret to inform you" email at 6am. Recruiters, why 6am.',
  'Overheard in the union: "I have a midterm in an hour and I am choosing peace."',
  'The campus gym at 7am is just grad students and one guy who is way too awake.',
  'Realized I have been pronouncing my professor\'s name wrong for a month. Nobody corrected me. Nobody.',
  'First week living off campus: I own a pan now. I feel powerful.',
  'The shuttle came early and left early and I am still processing the betrayal.',
  'Lecture hall seats are designed for people with no knees.',
  'Is it weird to go to campus events alone? I keep talking myself out of it.',
  'The best study snack is whatever is on sale at the campus store. Today it was a whole bag of pretzels.',
  'Cold front came in and the engineering building is now a fridge with wifi.',
  'Wholesome moment: a stranger held the door for me for a full 20 seconds while I crossed the plaza in the rain.',
  'Registration tip: refresh less, it does not help, it just hurts.',
  'International student here. The amount of free pizza at events is not normal and I love it.',
  'Late-night study spot hunting: the union closes too early, the library is too loud, my room has a bed in it.',
  'Grad school update: I have an office, a desk, and no idea what I am doing.',
  'Just handed in a paper I wrote in one sitting. My hands are shaking and the paper is fine.',
  'The bus was so full today that I made eye contact with someone\'s sandwich.',
  'Roommate leaves the light on when she sleeps. I have started wearing an eye mask like a Victorian ghost.',
  'Somebody hung a "free hugs" sign in the quad and I stood there for a minute considering it.',
  'Exam season observation: the campus cats know exactly who needs them.',
  'How do people have time for clubs AND classes AND sleep? Pick two, right?',
  'Career center review: they fixed my resume in 20 minutes and I have been coasting on it since.',
  'It rained sideways today and my umbrella turned inside out in front of the entire lecture hall.',
  'Told my parents I am "figuring things out" for the third semester in a row.',
  'Small win: the vending machine gave me two of the thing I paid for.',
  'The quad at night is genuinely peaceful and I need everyone to keep not knowing that.',
  'Study room booking system has a 3-second window between "available" and "gone." I have lost every time.',
  'Honestly just proud of myself for going to class today.',
  'Overheard by the bike racks: "my bike lock costs more than my bike."',
  'Financial aid office hold music is a genre now.',
  'Professor cancelled class via an email sent 4 minutes before it started. I was already sitting in the room.',
  'The union has a piano and today someone played the intro to a song and stopped. We all waited. Nothing.',
  'Cooked a real dinner for the first time in weeks and it tasted like being an adult.',
  'Campus wifi outage during the online quiz. The quiz did not care.',
  'Do other people also plan their whole day around when the library gets sun?',
  'Someone left a thermos of hot chocolate in the study lounge with a "help yourself" note. Campus is good sometimes.',
  'Gym crowding index: leg day is impossible, cardio is fine, the stretching area is a social club.',
  'Best purchase this year: a $6 doorstop so my roommate stops slamming the door.',
  'First-gen student. Nobody in my family gets what a midterm is and I have stopped explaining. It is fine. It is not fine.',
  'I think the dining hall knows when we have exams because the good stuff appears exactly then.',
  'Homesickness hits hardest on Sundays. Anyone else?',
  'The stairs in the science building are the reason I have calves now.',
  'Class got moved to a room with windows and everyone\'s mood improved by 40%.',
  'Group chat for a class of 200 has 200 people and one person who answers questions. Bless them.',
  'Tried the campus climbing wall for the first time. My forearms have filed a complaint.',
  'Real question: is it okay to email a professor just to say the lecture was great?',
  'The library cafe raised prices again. The muffin is now an investment.',
  'Advice needed: how do you tell a roommate their music is not for everyone?',
  'Found a bench by the river that nobody sits on. Sat on it. Fixed my whole week.',
  'Handed in my thesis proposal and celebrated with a nap of unusual length.',
  'The best part of this campus is the people who leave chargers plugged in for strangers. The worst part is the people who take them.',
  'Went to a club meeting alone, left with two numbers and a free t-shirt. Do it.',
  'Rain plus construction plus a 10-minute passing period equals me arriving to class as a puddle.',
  'The bus driver on the morning route says "welcome aboard" every single stop and it is the most consistent thing in my life.',
  'Study playlist review: lo-fi works until it doesn\'t, then it is brown noise or nothing.',
  'Somebody in my building bakes cookies on Sunday nights and leaves them on the stairwell landing. We do not know who. We do not ask.',
  'Overheard at the crosswalk: "I have three assignments due and a personality to maintain."',
  'Tip for new students: the second week of the semester is the best time to drop a class without a wave of guilt.',
  'Lecture hall temperature is a plot to keep us awake and it is not working.',
  'Someone did a crossword in the margins of the library desk and left it half done. I finished it. Felt like a handshake.',
  'It is week 9 and I finally know where all my classes are.',
  'The campus store sells umbrellas for $30 and they last one storm. This is a business model.',
  'Quiet confession: I like early classes. I like the empty campus. I like the good coffee before the line.',
];

const POLLS: { text: string; options: string[]; hero?: boolean }[] = [
  { text: 'Best late-night study spot?', options: ['PCL', 'The Union', 'GDC atrium', 'My bed, lying to myself'], hero: true },
  { text: 'Which dining hall breakfast is actually the best?', options: ['Jester', 'Kinsolving', 'Off-campus tacos'], hero: true },
  { text: 'Best bus route for a nap?', options: ['801', '803', '640', 'I walk and suffer'], hero: true },
  { text: 'How many hours did you sleep last night?', options: ['Under 4', '4 to 6', '6 to 8', 'A healthy amount, weirdly'] },
  { text: 'Are you going to the game this weekend?', options: ['Yes, painted', 'Yes, quietly', 'No, studying', 'No, sleeping'] },
  { text: 'Coffee or energy drink before an 8am?', options: ['Coffee', 'Energy drink', 'Both', 'Neither, I am a monster'] },
  { text: 'Where do you do your best work?', options: ['Library', 'Dorm', 'Coffee shop', 'Outside'] },
  { text: 'Would you retake your worst class with a better professor?', options: ['Instantly', 'Maybe', 'Never'] },
  { text: 'Group project preference?', options: ['Pick my own group', 'Random assignment', 'No group projects ever'] },
  { text: 'How far into the semester do you feel behind?', options: ['Week 1', 'Week 4', 'Week 8', 'I was never ahead'] },
  { text: 'Best way to spend a free afternoon?', options: ['Nap', 'Gym', 'Friends', 'Errands I have avoided'] },
  { text: 'Which is worse: an 8am class or a 7pm class?', options: ['8am', '7pm', 'Both are crimes'] },
];

/**
 * Replies are written PER THREAD (polish P4): every root is answered by exactly one `TALK` entry (matched by a distinctive
 * substring of its text; the seed throws if a root matches none or several), so a thread only ever hears lines written for
 * it (`say`). Busier threads continue with `FAMILY` lines — related anecdotes that fit every root of that topic family —
 * and reactions from `FILLER` / `NESTED`, picked by the entry's tone, which fit ANY post of that tone and never name a
 * topic, place or detail of their own.
 */
type Tone = 'funny' | 'kind' | 'warm' | 'tip' | 'ask';
type Family =
  | 'class' | 'food' | 'transit' | 'study' | 'home' | 'weather' | 'buildings' | 'kindness' | 'nature' | 'spots' | 'career' | 'grad'
  | 'struggle' | 'wins' | 'music' | 'social' | 'admin' | 'gym' | 'overheard' | 'campus' | 'poll';
interface Talk { on: string[]; tone: Tone; fam: Family; say: string[] }

const TALK: Talk[] = [
  /* ── hero campus ── */
  { on: ['The site crashes at 8:00'], tone: 'funny', fam: 'admin', say: [
    'I had four tabs open and all four crashed in different ways. Impressive, honestly.', 'The loading wheel at 8:01 is the most stressful animation ever made.',
    'Got into every class except the one I actually needed. Classic.', 'At this point the crash should be listed in the academic calendar.',
    'My time slot was 8:00 and I got in at 8:26. Waitlisted for everything.', 'Somebody please fund a second server. I will donate five dollars.',
  ] },
  { on: ['PCL 5th floor at 2am'], tone: 'funny', fam: 'study', say: [
    'The 2am PCL crowd has a nod. You know the nod.', 'Collective despair but make it quiet. Accurate.', 'I was there last night. The guy with the blanket is a legend.',
    'The silence is loud enough to hear someone give up on a problem set.', 'Fifth floor at 2am is where I learned what a vending machine dinner is.',
  ] },
  { on: ['albino squirrel'], tone: 'funny', fam: 'nature', say: [
    'You saw it AFTER you studied. It only works if you have not studied. Everyone knows this.', 'A friend saw it the morning of her calc final and got a 97. It picks favorites.',
    'A 58 in ochem is a pass in spirit.', 'You have to see it on the way TO campus, not on the way to the exam. Rookie mistake.',
    'The squirrel knows what it did.', 'Filing a formal complaint with the squirrel on your behalf.',
  ] },
  { on: ['turned in my wallet'], tone: 'kind', fam: 'kindness', say: [
    'Whoever did this, you are the reason I still carry cash.', 'The Gregory desk staff deserve a thank-you too. They held my keys for a week once.',
    'Only 40%? They gave back the cash. Give them at least 60.', 'This is the stuff that makes a big campus feel small.', 'Paying it forward next time I find something. Promise.',
  ] },
  { on: ['big-name lines are 90 minutes'], tone: 'tip', fam: 'career', say: [
    'Can confirm. Talked to a mid-size company for 15 minutes and got an interview out of it.', 'Also bring printed resumes even if they say online only. Two recruiters took mine.',
    'The big-name line is mostly people waiting for a free water bottle.', 'Saving this for the spring fair.',
    'Pro move: go in the last hour. Recruiters are tired and actually chatty.', 'This is the most useful thing I have read on here all semester.',
  ] },
  { on: ['parking permit'], tone: 'funny', fam: 'transit', say: [
    'My car is worth less than the ticket I got last week.', 'The permit gets you the right to look for a spot. Not a spot.',
    'Biking is free until it rains. Then it costs your dignity.', 'At least your car runs. Mine lives in the garage like a pet.', 'Parking is the most expensive class I am taking.',
  ] },
  { on: ['GDC atrium at 9am'], tone: 'funny', fam: 'study', say: [
    'The 9pm shift has snacks though. Morally superior.', 'I have been part of both groups in the same day.', 'Someone at 9pm last night said "it compiles" and we all clapped.',
    'The atrium at midnight is one person quietly debugging and humming.', 'Support group is right. We share chargers and error messages.',
  ] },
  { on: ['already told my mom'], tone: 'funny', fam: 'overheard', say: [
    'The most powerful motivator in academia.', 'Manifestation through consequences. Respect.', 'I hope they got the A. For the mom.',
    'Honestly a solid study strategy.', 'Nothing focuses the mind like a promise already made to your mom.',
  ] },
  { on: ['Jester elevator'], tone: 'funny', fam: 'buildings', say: [
    'It skipped my floor twice this morning. Personal.', 'You have to press the button gently. It can tell.', 'Took the stairs out of respect for its mood.',
    'It opened, looked at me, and closed again. I felt judged.', 'The elevator and I are both having a week.',
  ] },
  { on: ['Kinsolving breakfast tacos'], tone: 'funny', fam: 'food', say: [
    'Potato, egg and cheese. It is not a debate.', 'I set my alarm based on when the tacos run out.', 'The salsa at the end of the line is the real secret.',
    'Same. I am not a morning person, I am a taco person.', 'They ran out at 9:40 last Tuesday and I have not recovered.',
  ] },
  { on: ['The 803 bus arrived early'], tone: 'funny', fam: 'transit', say: [
    'An early bus is a trap. Everybody knows this.', 'You did the right thing. Never board a bus that breaks the rules.',
    'Screenshot the arrival time next time. Nobody will believe you otherwise.', 'Same bus was 20 minutes late for me. The universe balances.',
    'This is the week everything changes. First the bus, then who knows.',
  ] },
  { on: ['microwaving fish'], tone: 'funny', fam: 'food', say: [
    'Every building has one. Welch just has the most committed one.', 'At 8am is the part that really gets me.', 'Could smell it from the second floor. Can confirm.',
    'Honestly it might be a power move.', 'I respect the protein goals. I do not respect the timing.',
  ] },
  { on: ['Turtle pond at sunset'], tone: 'kind', fam: 'spots', say: [
    'The turtles stacked on the rock are the most calming thing on campus.', 'Go on a weekday. Weekends have tour groups.',
    'I spent my whole homesick era sitting there. It helped.', 'Bring a snack but do not feed the turtles. They have a diet plan.', 'Adding this to my list for the next bad day.',
  ] },
  { on: ['Week 6 update'], tone: 'funny', fam: 'class', say: [
    'Week 6 is the long hallway of the semester. It ends, I promise.', 'Tired is a personality now.', 'You learned something. You learned you are tired. That counts.',
    'Fall break is coming. Hold on.', 'Same. Caught myself reading the same slide four times today.',
  ] },
  { on: ['bowling alley'], tone: 'funny', fam: 'spots', say: [
    'Went there on a first date and bowled a 41. We are still together.', 'The rental shoes are the real test of a relationship.',
    'Cheap, loud, and nobody cares if you are bad. Perfect.', 'I did not know this existed and I am a junior.', 'No need to fight. You are right.',
  ] },
  { on: ['rotisserie chicken'], tone: 'funny', fam: 'class', say: [
    'No plate is the part that makes it art.', 'Did he share? I need to know if he shared.', 'Protein is protein. He came prepared for a long discussion.',
    'This is my new benchmark for confidence.', 'I have questions and I am afraid of the answers.',
  ] },
  { on: ['Wifi in PCL drops'], tone: 'funny', fam: 'study', say: [
    'It dropped the second I clicked submit last week. The spinner still haunts me.', 'The corner by the windows holds on longer. Do not tell anyone.',
    'The wifi has deadline radar. The only thing in PCL that is always on time.', 'Hotspot from your phone and pray.', 'I now save every thirty seconds out of fear.',
  ] },
  { on: ['labels his eggs'], tone: 'funny', fam: 'home', say: [
    'Honestly? Organized king.', 'Does he number them or name them?', 'This is a man who has had eggs stolen before.',
    'Respect. My roommate eats my eggs and calls them "communal."', 'Check whether the Sharpie has a label too.',
  ] },
  { on: ['Homesick today'], tone: 'warm', fam: 'struggle', say: [
    'Call her and ask for the recipe. Cooking it here helps more than you would think.', 'Ten minutes in my mom\'s kitchen would fix a whole semester for me too.',
    'Homesick is just love with nowhere to go. It passes, it comes back, and that is okay.', 'The international grocery on the drag has things that taste like home. Worth the trip.',
    'Same today. We should start a homesick lunch table.',
  ] },
  { on: ['Gregory at 5pm'], tone: 'funny', fam: 'gym', say: [
    'Go at 2pm or 9pm. Anything in between is a line.', 'I waited for a bench so long I did my workout in my head.',
    'Someone was on a phone call on the only free squat rack. For 20 minutes.', 'The morning crowd is small and polite. Worth the alarm.',
    'Gregory at 5pm is a social club with dumbbells.',
  ] },
  { on: ['confidence intervals'], tone: 'funny', fam: 'class', say: [
    'I was there. It was a great joke. Not the person you are looking for, but I laughed too.', 'Statistically speaking, they are reading this.',
    'This is the most statistics thing to ever happen on Buzz.', 'The odds are low but not zero.', 'Sit in the second row again and report back.',
  ] },
  { on: ['The library printers work perfectly'], tone: 'funny', fam: 'study', say: [
    'The printer can sense panic. It feeds on it.', 'Printed my paper in three colors because the black toner quit at 8:58.',
    'Always print the night before. Learned that the hard way twice.', '"Paper jam" is a lie it tells when it wants you to suffer.',
    'I once had to email my essay to the professor from the printer line.',
  ] },
  { on: ['Internship anxiety hours'], tone: 'warm', fam: 'career', say: [
    'I had 43 rejections before my offer last year. The spreadsheet is part of it.', 'A spreadsheet of rejections means you applied. That is the hard part.',
    'Everybody posts the offer. Nobody posts the 30 no\'s before it.', 'The career center does mock interviews. They helped me turn things around.',
    'Rooting for you. The yes only has to happen once.',
  ] },
  { on: ['water fountain by the GDC stairwell'], tone: 'tip', fam: 'buildings', say: [
    'This is the kind of PSA I want more of.', 'I thought I was imagining it. Thank you for confirming.', 'Refilled my bottle there today because of this post. Can confirm.',
    'The one on the third floor is warm and sad.', 'Important infrastructure update.',
  ] },
  { on: ['woke up to a guitar circle'], tone: 'funny', fam: 'music', say: [
    'Best alarm clock on campus.', 'Did they play anything good or was it the same four chords?', 'I would like to be woken up by a guitar circle every day, please.',
    'The Union couches were made for this exact moment.', 'I once woke up there to a chess tournament. Less relaxing.',
  ] },
  { on: ['taco truck on Speedway'], tone: 'funny', fam: 'food', say: [
    'Correct priorities. Tacos are preventative care.', 'Worth it for the green salsa alone.', 'The taco line moves fast. The health center line does not.',
    'Went to both today. The tacos helped more.', 'Order the migas. Trust me.',
  ] },
  { on: ['Welch basement'], tone: 'funny', fam: 'buildings', say: [
    'Bring a jacket, water and a sense of adventure.', 'The basement has weather. I saw a cloud once.', 'Humid in the hallway, freezing in the rooms. Somehow both.',
    'You get used to it after a semester. You also lose your sense of direction.', 'Welcome. You are one of us now.',
  ] },
  { on: ['AC should be at 78'], tone: 'funny', fam: 'home', say: [
    '78 in September is a crime in this state.', 'Compromise at 74 and buy him a blanket.', 'My roommate and I settled this with a fan on each side of the room.',
    'This is grounds for a roommate agreement amendment.', 'He is going to discover sweating at night very soon.',
  ] },
  { on: ['encouraging sticky notes'], tone: 'kind', fam: 'kindness', say: [
    'I read every one too. The one that said "drink water" got me.', 'I read all the sticky notes too. Someone is out there being kind on purpose.',
    'I added one yesterday. Keep the chain going.', 'The most wholesome thing that happens in PCL.', 'Took a picture of one and it is my lock screen now.',
  ] },
  { on: ['Bus driver on the 640'], tone: 'kind', fam: 'transit', say: [
    'The bus waiting for you is the plot twist of the year.', 'Some of the drivers are genuinely the best people on campus.', 'Legend behavior. Hope you waved.',
    'Had the same thing happen in the rain once and I almost cried.', 'You can tell the transit office. They pass compliments on to the drivers.',
  ] },
  { on: ['Question for seniors'], tone: 'warm', fam: 'struggle', say: [
    'It does get better. Also you get better at pretending. But the pretending part gets smaller every year.', 'Senior here. Better, mostly because you stop comparing yourself to everyone.',
    'Fourth year. Not easy, but better.', 'You find your people and your routine, and the hard days get shorter.',
    'It got better for me the moment I asked for help instead of pretending.',
  ] },
  { on: ['The stadium lights are on'], tone: 'funny', fam: 'class', say: [
    'Open the window and do the problem sets to the crowd noise.', 'One problem set per quarter. It is a strategy.',
    'You can hear the band from the library. Motivation or torture, hard to say.', 'Go for the second half. Problem sets do not have halftime.',
    'Both things being true is the whole college experience.',
  ] },
  { on: ['Lab partner said'], tone: 'funny', fam: 'class', say: [
    'Week four they will still say it. Start figuring it out without them.', 'Email the TA now. Future you will be glad you did.',
    '"We\'ll figure it out" is a lifestyle, not a plan.', 'I was that lab partner once. I am sorry to my lab partner.', 'Plot twist: you are the one figuring it out.',
  ] },
  { on: ['about to submit'], tone: 'funny', fam: 'grad', say: [
    'Grad student here. Eleven days is rookie numbers.', 'Submit it. The reviewers will find what they find.', 'The last 2% of a paper takes 98% of the time.',
    'Just one more figure. I know. I know.', 'Sending strength from another grad office.',
  ] },
  { on: ['order something boring'], tone: 'tip', fam: 'food', say: [
    'Drip coffee people have been winning this whole time.', 'The five-modification order is why the line is long. It was me. I am sorry.',
    'Tested this today. It works.', 'Order a plain latte and watch everyone else wait.', 'This is the most useful science on campus.',
  ] },
  { on: ['A duck chased me'], tone: 'funny', fam: 'nature', say: [
    'The ducks run that pond. You were on their turf.', 'Attention is attention. Take it.', 'One chased me too. I think it was the same duck.',
    'Did you have food? They only chase people with snacks.', 'This is the funniest thing I have read all week.',
  ] },
  { on: ['I have started saying it'], tone: 'funny', fam: 'social', say: [
    'Exchange student solidarity, the y\'all is inevitable.', 'It is the most useful word in English. Welcome.', 'Give it a month and you will say "fixin\' to" too.',
    'My exchange friend went home and now her whole family says it.', 'It is inclusive and efficient. You are doing great.',
  ] },
  { on: ['golden hour'], tone: 'kind', fam: 'spots', say: [
    'It is so pretty that I forget I have 90 pages to read.', 'Best view on campus and it is in the library. Nobody believes me.',
    'I time my study breaks to catch that light.', 'Then the sun goes down and the reading is still there. Accurate.', 'Took a photo there last week and it looks like a film still.',
  ] },
  { on: ['letting the ideas marinate'], tone: 'funny', fam: 'overheard', say: [
    'Stealing this for my next extension request.', 'My ideas have been marinating since August.', 'Honestly? Sometimes it works.',
    'Procrastination with a cooking metaphor. I love it.', 'The marinade is anxiety.',
  ] },
  { on: ['plays piano in the Union lobby'], tone: 'kind', fam: 'music', say: [
    'I would also like to know the name of the piano person.', 'Thursday afternoons are better because of them.',
    'Last week they played a movie theme and a whole table started humming along.', 'I schedule my lunch around it now.', 'I hope they see this post. They make everybody\'s day.',
  ] },
  { on: ['we lost 7-0'], tone: 'funny', fam: 'social', say: [
    '7-0 and the most fun. That is exactly how intramurals should be.', 'We lost 9-1 last season and celebrated the one goal like a trophy.',
    'Scoreboards are for varsity. Intramurals are for vibes.', 'The team name matters more than the score. What is yours?', 'Hope you all got food after.',
  ] },
  { on: ['campus counseling center'], tone: 'warm', fam: 'struggle', say: [
    'Go to the counseling center. Seriously. It helped me too.', 'Same. I waited too long too. Glad you went.',
    'Thank you for posting this. It makes it easier for the next person to go.', 'The first appointment is the hardest part. You did it.',
    'Seconding. Their drop-in hours helped me a lot during midterms.',
  ] },
  { on: ['Speedway wind tunnel'], tone: 'funny', fam: 'weather', say: [
    'The wind on Speedway has taken so much from me.', 'It flew toward the tower like it was going to office hours.',
    'Did you get it back? Please say you got it back.', 'The wind graded it. It did not like it.', 'Speedway wind has taken my hat, my notes and my hope.',
  ] },
  { on: ['vending machine in Burdine'], tone: 'funny', fam: 'food', say: [
    'The gum is a decoy. The restock guy knows.', 'It is always the cinnamon one. Nobody wants the cinnamon one.',
    'The machine by the second floor stairs has chips sometimes. Sometimes.', 'I have bought that gum out of pure desperation.', 'That machine is a monument to hope.',
  ] },
  { on: ['want to switch majors'], tone: 'funny', fam: 'admin', say: [
    'You should absolutely switch majors if that is what your gut says.', 'Your advisor has been waiting for you to figure it out.',
    'Rude but fair is the best kind of advisor.', 'Switched in my second year and never looked back.', 'What are you switching to? Tell us.', 'That "finally" is love.',
  ] },
  { on: ['12 degrees colder', 'The library heater has two settings', 'fridge with wifi', 'Lecture hall temperature'], tone: 'funny', fam: 'buildings', say: [
    'Every building on this campus has its own climate zone.', 'I keep a hoodie in my bag in every season because of this.',
    'Facilities thinks we are either lizards or penguins. No in-between.', 'The thermostat is decorative. I am sure of it.',
    'Layering is the most important skill I have learned in college.', 'Emailed facilities about this once. They said it was "within range." Whose range.',
    'I would pay extra for a building that is just room temperature.',
  ] },
  { on: ['brings her dog on Fridays'], tone: 'funny', fam: 'class', say: [
    'What kind of dog? This is important.', 'Attendance policy of the century.', 'Please tell me the dog has a name tag with the course number.',
    'I would take an 8am for a dog. Honestly.', 'The dog should get an honorary degree.',
  ] },
  { on: ['pasta bar is carried'], tone: 'funny', fam: 'food', say: [
    'Respectfully, the garlic bread carries.', 'Put pasta between two garlic bread slices. Changed my life.', 'The pasta is fine. The garlic bread is a religion.',
    'The marinara on Tuesdays is actually good. Only Tuesdays.', 'Nobody is at the pasta bar for the pasta.',
  ] },
  { on: ['practices trumpet at 11pm'], tone: 'funny', fam: 'music', say: [
    'The stairwell trumpet is improving, I can confirm from two floors down.', 'Supportive neighbor energy. I love this.',
    'Give it until finals and they will be playing full songs.', 'Honestly 11pm is a respectful time for a trumpet.', 'Request a song. See what happens.',
  ] },
  { on: ['Gregory pool at 7am'], tone: 'tip', fam: 'gym', say: [
    'The secret was nice while it lasted.', 'Went this morning. Can confirm. Three people and one very serious swimmer.',
    'The 7am pool is the calmest place on this campus.', 'Do they have kickboards? Asking as a beginner.', 'Tried this once and it changed my whole day.',
  ] },
  { on: ['tower is watching them study'], tone: 'funny', fam: 'study', say: [
    'It lights up orange when it approves.', 'Not just you. It watches me through every PCL window.', 'The tower knows your GPA.',
    'I close my blinds so it cannot see me procrastinate.', 'It is judging your posture.',
  ] },
  { on: ['returned my AirPods'], tone: 'kind', fam: 'kindness', say: [
    'I hope whoever returned your stuff has the best week.', 'Honest people are everywhere on this campus. Love to see it.',
    'The Union desk lost and found is a drawer of legends.', 'Lost mine last year and someone returned them too. This place is good.',
    'Always check the Union desk first. It has saved me twice.',
  ] },
  { on: ['talked to 14 recruiters'], tone: 'funny', fam: 'career', say: [
    'The tote bag economy is real.', 'The free tote is honestly a great return on investment.', 'I have enough career fair pens to last until graduation.',
    '14 conversations is 14 more than last year. Progress.', 'Follow up with emails to the good ones. That is where it clicked for me.',
  ] },
  { on: ['2am fire drill'], tone: 'funny', fam: 'home', say: [
    'This unlocked a memory of the last fire drill. I was in a towel.', 'Standing outside at 2am with 300 strangers in pajamas. Bonding.',
    'Somebody brought their laptop out and kept typing. Legend.', 'My character is also tired. And cold.', 'Was it a drill or someone\'s popcorn? Last time it was popcorn.',
  ] },
  { on: ['the professor remembered my name'], tone: 'warm', fam: 'wins', say: [
    'Office hours are the cheat code nobody uses.', 'Go back next week. It gets easier every time.',
    'Professors love it when people show up. Most of the time they are just sitting there alone.', 'Small wins are still wins. This is a big one.',
    'My first office hours visit turned into a research position. Keep going back.',
  ] },
  { on: ['The campus ducks'], tone: 'funny', fam: 'nature', say: [
    'The ducks are unionized, I am sure of it.', 'They nap whenever they want. Goals.', 'Ducks do not have midterms. It shows.',
    'I aspire to float through my week that calmly.', 'They also get free bread. Unfair.',
  ] },
  { on: ['Riverside living update'], tone: 'tip', fam: 'home', say: [
    'Same trade-off. Long bus, full fridge.', 'The ride is a good time to catch up on readings. Or naps.', 'Real food over a short walk every time.',
    'How long is the commute? Thinking about it for next year.', 'Rent savings are worth more than a short walk to class.',
  ] },
  { on: ['rating the study rooms in PCL'], tone: 'funny', fam: 'study', say: [
    'I would like to subscribe to your study room reviews.', 'Same room, same flickering light. It has a name now.', 'Please review 3.212. I need an honest opinion.',
    'Four stars with a flickering light is generous.', 'I have started rating study rooms too. We should compare notes.',
  ] },
  { on: ['4.0 in vibes'], tone: 'funny', fam: 'overheard', say: [
    'Vibes are the only class I am acing.', 'Honestly the hardest class to get an A in.', 'Put it on the resume.',
    'This is going on a poster in my room.', 'The only GPA that matters.',
  ] },
  { on: ['moved my laundry'], tone: 'kind', fam: 'kindness', say: [
    'This person is a hero and must be protected.', 'Folded it? Folded it. That is love.', 'Someone folded mine once and I still think about it.',
    'This is the bar now. Everyone meet it.', 'Laundry room angels are real.',
  ] },
  { on: ['get lost in Welch'], tone: 'funny', fam: 'buildings', say: [
    'Everyone gets lost in Welch. Even seniors. Even professors.', 'Rite of passage. Welcome.', 'The room numbers do not follow any known logic.',
    'Took me until spring to find the second floor bathroom.', 'Follow someone who looks confident. They are also lost, but confidently.',
  ] },
  { on: ['flu shot clinic'], tone: 'funny', fam: 'campus', say: [
    'The stickers were the best part of the flu shot.', 'Two stickers is a flex.', 'Went yesterday. Shorter line. Stickers remained.',
    'Getting a flu shot is self-care. The stickers are a bonus.', 'Did they have the dinosaur ones? I need the dinosaur ones.',
  ] },
  { on: ['defusing a bomb'], tone: 'kind', fam: 'class', say: [
    'Careful TAs are the unsung heroes of every lab course.', 'Tell her. TAs almost never hear this.', 'Honestly, for chem lab that is the right energy.',
    'My lab TA just says "don\'t" and walks away.', 'A TA who cares changes the whole class.',
  ] },
  { on: ['one couch that eats people'], tone: 'funny', fam: 'study', say: [
    'I have been eaten by that couch. Lost an hour.', 'The couch is a trap for naps. A beautiful trap.', 'Five stars for the plugs alone.',
    'Went there after this post. The couch got me.', 'Quiet and plugs? Best study spot review on here.',
  ] },
  { on: ['First cold front'], tone: 'funny', fam: 'weather', say: [
    'The fact that it was 68 degrees is the funniest part.', 'I wore a scarf. I am not proud.', 'This is our winter. Let us have it.',
    'Saw boots and shorts together on Speedway today.', 'Pumpkin spice at 68 degrees is a lifestyle.',
  ] },
  { on: ['counts as cardio', 'calves now'], tone: 'funny', fam: 'transit', say: [
    'My step count this semester is embarrassing for my gym membership.', 'Campus is a fitness program with tuition attached.',
    'Leave five minutes earlier and you still arrive out of breath.', 'Nobody warned me either. My legs have adapted.',
    'The walk between classes is my only workout and I am okay with it.',
  ] },
  { on: ['free telescope nights'], tone: 'kind', fam: 'social', say: [
    'Yes to telescope night. Saw Jupiter, cried a little.', 'The rings look fake in the best way.', 'When is the next one? I am going.',
    'Free, outdoors and Saturn. Best event on campus.', 'The astronomy grad students are so happy to show you things. Go.',
  ] },
  { on: ['this won\'t be on the exam'], tone: 'funny', fam: 'class', say: [
    'Never trust "this won\'t be on the exam."', 'The most dangerous sentence in academia.', 'Write down everything after that sentence. It will be on the exam.',
    'Mine said it about one slide and it was worth 15 points.', 'This is how they test who is still listening.',
  ] },
  { on: ['birthday cake in the GDC kitchen'], tone: 'kind', fam: 'kindness', say: [
    'The cake sharing is peak campus culture.', 'Happy birthday to whoever it was. Thank you for the cake.', 'Walked by and got a slice. Chocolate. Excellent.',
    'The GDC kitchen has the best free food energy.', '"Share" is the most beautiful word in that building.',
  ] },
  { on: ['help three of us with recursion'], tone: 'kind', fam: 'class', say: [
    'People like this are the reason I stayed in CS.', 'Recursion finally clicked for me when someone did this too. Kindness compounds.',
    'Tell them thank you if you see them again. That stuff matters.', 'Staying after to help is a whole personality and I want it.',
    'This is what a study group should feel like.', 'Paying this forward next time someone looks lost in section.',
  ] },
  { on: ['The Union coffee is bad'], tone: 'funny', fam: 'food', say: [
    'Counterpoint: the coffee is fine and you are just tired.', 'It is bad and it is ours.', 'Loyalty to bad coffee is peak college.',
    'It tastes like studying. That is the point.', 'I switched and I miss it. Somehow.',
  ] },
  { on: ['campus barber'], tone: 'tip', fam: 'spots', say: [
    'Can confirm. Best fade I have had in years.', 'Where exactly? Asking for my head.', 'Went after this post. Worth it.',
    'The secret is out now and the wait is going to be long.', '$12 and a good conversation. Better than most places.',
  ] },
  { on: ['shared calendar'], tone: 'kind', fam: 'home', say: [
    'This is the most mature roommate thing I have heard.', 'We started a chore chart and it saved us too.', 'Communication really is the whole thing.',
    'Color coded? Please say color coded.', 'Roommate goals. Genuinely.',
  ] },
  { on: ['wrong class for two weeks'], tone: 'funny', fam: 'class', say: [
    'Replying from the wrong lecture, can confirm it is interesting.', 'Honestly, fate.', 'Are you going to add it now?',
    'The real class misses you.', 'This is how people end up with a minor.',
  ] },
  { on: ['Three exams in one week'], tone: 'warm', fam: 'struggle', say: [
    'Sending strength for the three-exam week.', 'Sleep is part of studying. Do not skip it.', 'Been there. You will surprise yourself with what you can get through.',
    'Plan one reward for after the last exam. It helps.', 'Solidarity. Mine are Tuesday, Wednesday, Thursday.',
  ] },
  { on: ['drop something on the PCL stairs'], tone: 'funny', fam: 'campus', say: [
    'Lost a pen there in August. It belongs to the stairs now.', 'The stairs giveth and the stairs taketh away.', 'Those are the rules. Everyone knows the rules.',
    'Once watched an apple roll down a whole flight. Nobody stopped it.', 'Finders keepers is the official PCL policy.',
  ] },
  { on: ['cereal station'], tone: 'kind', fam: 'food', say: [
    'Dining staff who remember you are the best part of campus.', 'Tell her thank you. She will remember that too.', 'That is love and nobody can tell you otherwise.',
    'The dining staff deserve so much more credit.', 'What is the order? I am curious.',
  ] },
  { on: ['physical newspaper'], tone: 'funny', fam: 'transit', say: [
    'Was he folding it the fancy way? That is the real skill.', 'He was probably doing the crossword. Respect.', 'Honestly a vibe. No notifications.',
    'I bet he gets the news before any of us.', 'Felt like I should take a photo for a museum.',
  ] },
  { on: ['courtyard behind the art building'], tone: 'tip', fam: 'spots', say: [
    'Please do not tell more people. I also go there.', 'Went today. Can confirm. Sunny. Quiet.', 'The art students sometimes leave sculptures out there. Bonus.',
    'Secret spots are the best part of a big campus.', 'You have ruined it. And I thank you.',
  ] },
  { on: ['first A on a chem exam'], tone: 'warm', fam: 'wins', say: [
    'Congrats on the A. That is huge.', 'From two Cs to an A is a comeback story. Tell everyone.', 'You can tell us. We are proud of you.',
    'Screenshot the grade. Look at it on bad days.', 'This is what hard work looks like. Well done.',
  ] },
  { on: ['just email professors'], tone: 'funny', fam: 'overheard', say: [
    'This is your sign. Email them.', 'The best discovery of college. They actually answer.', 'Someone tell them about office hours next.',
    'I learned this in my second year and it changed everything.', 'The 801 always has the best overheard.',
  ] },
  { on: ['Speedway squirrels'], tone: 'funny', fam: 'nature', say: [
    'One took a chip right out of my hand last week.', 'They run this campus and we just pay tuition.', 'I have seen one chase a dog.',
    'Well fed and fearless. A dangerous combination.', 'Saw one eating a whole bagel. Whole.',
  ] },
  { on: ['Weekend plan'], tone: 'funny', fam: 'campus', say: [
    'This is the ideal weekend and I respect it.', 'The "tell people I studied" step is the most important one.', 'Add a nap between laundry and sleep.',
    'Solid plan. No notes.', 'Same plan. Also the same lie.',
  ] },
  { on: ['chalked'], tone: 'kind', fam: 'kindness', say: [
    'Walked past it this morning and smiled.', 'Chalk messages are the best thing about this campus.', 'Whoever it was, it helped me too.',
    'I needed to read this today. Thank you.', 'Someone should chalk more of these outside the exam halls.',
  ] },
  { on: ['I miss my dog'], tone: 'warm', fam: 'struggle', say: [
    'I miss my dog too. It is normal. Call home and ask for a photo.', 'Your family understands. They probably miss you through the dog.',
    'Honestly, pets are family.', 'The dog misses you too. You should see the videos my mom sends.', 'There is a therapy dog day before finals. Go.',
  ] },
  { on: ['Pickup soccer'], tone: 'kind', fam: 'social', say: [
    'I will be at pickup soccer Thursday. Wear a color I can find.', 'Come to the pickup game, nobody is good and everyone is nice.',
    'Went for the first time last week. Everyone was so welcoming.', 'Best way to make friends without having to talk too much.', 'Do I need cleats or are sneakers fine?',
  ] },
  { on: ['The campus triathlon'], tone: 'funny', fam: 'campus', say: [
    'Not you doing the campus triathlon on a Tuesday.', 'I have medaled in all three events this week.', 'Training for the finals-week ironman.',
    'The Jester leg is the hardest.', 'There is a fourth event: stare at the ceiling. I am a champion.',
  ] },
  { on: ['Attendance: spiritual'], tone: 'funny', fam: 'class', say: [
    'Adding "spiritual attendance" to my vocabulary.', 'The lectures are recorded. The guilt is live.', 'Spiritually present is still present.',
    'Week 7 is when spiritual attendance begins. Tradition.', 'My attendance is also on a spiritual journey.',
  ] },
  { on: ['ping pong table'], tone: 'funny', fam: 'campus', say: [
    'Productivity is gone but morale is at an all-time high.', 'I played one game and missed a lab.', 'Is there a sign-up sheet or is it just vibes?',
    'There is a grad student who has never lost. Watch out.', 'Best facilities upgrade in years.',
  ] },
  { on: ['will send it tonight'], tone: 'funny', fam: 'class', say: [
    'Our group had the same person. It was me. I am sorry.', 'It is always "tonight." Never "at 7pm."', 'Set a deadline 24 hours before the real one. Trust me.',
    'And then it arrives at 3am with a comment that says "lmk."', 'The universal group project experience.',
  ] },
  { on: ['plays the cello'], tone: 'kind', fam: 'music', say: [
    'The cello stairwell is real and it is beautiful.', 'I take the long way just to walk past it.', 'The acoustics in there make everything sound like a movie.',
    'Taking the stairs on purpose is the most romantic thing I have read this week.', 'Whoever it is, please never stop.',
  ] },
  { on: ['wave at the same stranger'], tone: 'kind', fam: 'kindness', say: [
    'This is exactly why I wave at strangers now.', 'This is the best kind of friendship. No pressure.',
    'One day you will meet him at a party and it will be amazing.', 'Morning wave friends are elite.', 'Plot twist: he posts the same thing about you.',
  ] },
  { on: ['Is Buzz always this nice'], tone: 'kind', fam: 'social', say: [
    'Mostly! Welcome. It is a good corner of the internet.', 'Welcome. Stay kind and it stays kind.', 'You caught it on a normal day. It is usually like this.',
    'Welcome to the good part of the app.', 'Read the replies on the vulnerable posts. That is when you really see it.',
  ] },
  { on: ['market adjustment'], tone: 'tip', fam: 'home', say: [
    'The rent thing is a crime and we should talk about it more.', 'Mine went up $200 and they called it "amenity improvements." The amenity is a new doormat.',
    'The student legal services office reviews leases for free. Worth a visit before you renew.', 'Riverside and a bus pass look better every year.',
    '"Market adjustment" is a very polite way to say it.',
  ] },
  { on: ['tutoring center'], tone: 'tip', fam: 'class', say: [
    'Can confirm. Saved my physics grade last year.', 'Go early in the week. Thursdays get busy.', 'Free help is the most underrated thing on campus.',
    'Going this week because of this post.', 'The tutors are students too, so they get it.',
  ] },
  { on: ['raccoon'], tone: 'funny', fam: 'nature', say: [
    'The raccoons have better focus than me.', '"With intent" is the key phrase here.', 'I saw one carrying a whole slice of pizza. Proudly.',
    'The raccoons are the real night shift.', 'Did it get what it wanted? I need to know.',
  ] },
  { on: ['the professor matters more than the time slot'], tone: 'tip', fam: 'admin', say: [
    'Hard agree. My best class was at 8am.', 'Find an old syllabus if you can. It says a lot about the class.', 'The time slot is temporary. A bad professor is all semester.',
    'Saving this for registration.', 'Ask older students in your major. They always know.',
  ] },
  { on: ['how fast the sun sets'], tone: 'funny', fam: 'weather', say: [
    'Nobody warned me about the sunset thing either.', 'Walking out of the library into the dark hits different.', 'Take a walk at lunch. It helps with the dark afternoons.',
    'My brain thinks it is 10pm at 6.', 'The only good part is the sunset colors on the walk home.',
  ] },
  { on: ['the printer on PCL 2'], tone: 'funny', fam: 'study', say: [
    'The PCL 2 printer is the most reliable thing in my life.', 'Please do not jinx it.', 'The one on the first floor could learn a lot.',
    'Printing my thesis there because of this post.', 'Whoever maintains it: thank you.',
  ] },
  { on: ['soft serve machine'], tone: 'funny', fam: 'food', say: [
    'The machine works one day a week and that day is sacred.', 'A bug that protects our health. Deep.', 'I have seen it working once. I thought I was dreaming.',
    'Broken soft serve is a campus tradition at this point.', 'Hot take accepted.',
  ] },
  { on: ['Study group of four'], tone: 'kind', fam: 'social', say: [
    'This is how the best friendships start.', 'Studying together is the fastest way to know someone. Suffering bonds.',
    'Same thing happened to me in stats. We still get dinner every week.', 'I love this for you.', 'This is your sign to invite your lab group to lunch.',
  ] },
  { on: ['smells like ambition'], tone: 'funny', fam: 'buildings', say: [
    'The burnt something is ambition.', 'I can smell it from across the courtyard.', 'That smell is someone\'s grade.',
    'Chem building is a candle scent waiting to happen.', 'Somebody is always burning something in there.',
  ] },
  { on: ['parallel park'], tone: 'funny', fam: 'campus', say: [
    'Watched someone take 11 tries yesterday. I stayed for all 11.', 'The applause when someone nails it first try is well deserved.',
    'Better than anything on TV right now.', 'I bring snacks to the window. It is a whole event.', 'Parallel parking is my biggest fear here.',
  ] },
  { on: ['okay to eat alone'], tone: 'warm', fam: 'struggle', say: [
    'You are not the only one eating alone. Wave next time.', 'Eating alone with a podcast is peaceful. It is fine.', 'Thank you for posting this. I needed it.',
    'Half the dining hall is eating alone. Nobody is looking.', 'Used to hate it. Now it is my favorite part of the day.',
  ] },
  { on: ['projector takes 90 seconds'], tone: 'funny', fam: 'class', say: [
    'The projector groan is a shared cultural experience.', 'Petition to make the projector warm-up a moment of silence.', 'My professor sings to fill the silence. Every time.',
    'We all wait. We all groan. We are united.', 'Honestly the best part of lecture.',
  ] },
  { on: ['learned all the bus routes'], tone: 'funny', fam: 'transit', say: [
    'Learned the routes in year 3. You are ahead.', 'Congrats. You are now the friend everyone asks.', 'Knowing the routes is a superpower.',
    'Now learn the schedules. That is the real test.', 'You own the city now. Enjoy it.',
  ] },
  { on: ['unicycle'], tone: 'funny', fam: 'campus', say: [
    'The unicycle taco guy is a local legend.', 'I saw him too. He did not drop a single bite.', 'Peak Austin. Nothing will top it.',
    'This is the most Austin sentence ever written.', 'I believe this 100%.',
  ] },

  /* ── any campus ── */
  { on: ['First snow of the year'], tone: 'funny', fam: 'weather', say: [
    'Watched three people slip in the same spot. Gracefully.', 'Penguin walk season is here.', 'The steps by the library are a skating rink.',
    'Everyone is either taking photos or falling. Sometimes both.', 'The first snow always feels like a holiday.',
  ] },
  { on: ['let\'s just meet in person'], tone: 'funny', fam: 'class', say: [
    'Hard agree. The in-person meeting is where things finally get done.', 'The leader also books the room. That is how you know.',
    'Group chats are where projects go to disappear.', 'I was that person once. Everybody thanked me.', 'Two hours in a room beats two weeks of texts.',
  ] },
  { on: ['changed the fries recipe'], tone: 'funny', fam: 'food', say: [
    'I noticed too. The old fries had a soul.', 'Start a petition. I will sign.', 'The new ones are fine. Fine is not enough.',
    'Fries are a core part of my schedule.', 'Mourning with you.',
  ] },
  { on: ['3-hour night lecture'], tone: 'ask', fam: 'class', say: [
    'Snacks. Water. Sit near the front so you feel watched.', 'Take notes by hand. It keeps your brain awake.', 'Stand up during the break even if you do not feel like it.',
    'Caffeine at the break, not at the start.', 'Ask one question. It keeps you engaged for the next hour.',
  ] },
  { on: ['eating an apple so loudly'], tone: 'funny', fam: 'study', say: [
    'The loudest fruit.', 'At least it is healthy. Loud but healthy.', 'I once heard someone eat carrots for 40 minutes straight.',
    'The rhythm is actually kind of relaxing if you let it.', 'Noise cancelling headphones exist for this exact reason.',
  ] },
  { on: ['Found a quiet floor in the library'], tone: 'funny', fam: 'study', say: [
    'Confirmed: the quiet floor exists. I will also not say which.', 'Please do not say. We need it.', 'I think I know which one. My lips are sealed.',
    'Is it the one with the carpet? No, do not answer.', 'The code of the quiet floor is respected.',
  ] },
  { on: ['we regret to inform you'], tone: 'warm', fam: 'career', say: [
    'The 6am rejection is a special kind of cruel.', 'They must schedule them the night before. Still rude.', 'Sorry. That one stings. The next one could be a yes.',
    'Every no is one step closer. I know it sounds fake but it is true.', 'Take today off from applying. Start fresh tomorrow.',
  ] },
  { on: ['I am choosing peace'], tone: 'funny', fam: 'overheard', say: [
    'I also choose peace. My grade chooses otherwise.', 'This is the energy I need.', 'An hour is plenty of time for peace.',
    'Honestly, the right choice sometimes.', 'Peace over panic. Love it.',
  ] },
  { on: ['one guy who is way too awake'], tone: 'funny', fam: 'gym', say: [
    'The guy who is too awake is always there. Always.', 'Grad students at 7am are the most peaceful gym crowd.', 'I was the too-awake guy for a week. Then I stopped.',
    'Best time to get a bench.', 'He says good morning to everyone. It is nice, actually.',
  ] },
  { on: ['pronouncing my professor\'s name wrong'], tone: 'funny', fam: 'class', say: [
    'Nobody corrected you because they were all saying it wrong too.', 'Just keep saying it wrong with confidence.', 'Ask. They appreciate it more than you think.',
    'Did this for a whole semester once. Found out at the final.', 'The cringe is temporary. The knowledge is forever.',
  ] },
  { on: ['I own a pan now'], tone: 'funny', fam: 'home', say: [
    'A pan is the beginning of everything.', 'Next step: a second pan. Then you are unstoppable.', 'Eggs, pasta, rice. That is the whole curriculum.',
    'Congratulations on your first real kitchen item.', 'Wait until you buy a spatula. Life-changing.',
  ] },
  { on: ['The shuttle came early'], tone: 'funny', fam: 'transit', say: [
    'An early shuttle is somehow worse than a late one.', 'The betrayal is valid.', 'The shuttle schedule is more of a suggestion.',
    'This happened to me yesterday. I stood there in disbelief.', 'The shuttle has its own plans. We are just passengers.',
  ] },
  { on: ['people with no knees'], tone: 'funny', fam: 'class', say: [
    'The fold-out desks were designed for a phone, not a laptop.', 'I sit on the aisle every time for this reason.', 'Tall people have been suffering in silence.',
    'My knees and the seat in front of me are in a relationship now.', 'And the seat hinge squeaks every time you move. Great combo.',
  ] },
  { on: ['go to campus events alone'], tone: 'warm', fam: 'social', say: [
    'Not weird at all. Most people there came alone too.', 'Went to one alone last month and left with a friend. Do it.', 'This is your sign to go to the next one alone.',
    'Nobody notices who came alone. Everyone is busy worrying about themselves.', 'Go for 20 minutes. If you hate it, leave. No harm done.',
  ] },
  { on: ['best study snack'], tone: 'funny', fam: 'food', say: [
    'Pretzels are the perfect study snack. Crunchy, salty, cheap.', 'Whatever is on sale is the correct study philosophy.',
    'Last week it was gummy bears. My grades reflected it.', 'A whole bag? Ambitious.', 'The campus store sale shelf is where dreams come true.',
  ] },
  { on: ['held the door for me'], tone: 'kind', fam: 'kindness', say: [
    'This is why I love this campus.', 'Twenty seconds in the rain is a real sacrifice.', 'Small kindness, big day.',
    'Holding a door that long is elite behavior.', 'I hope they got a dry seat in class.',
  ] },
  { on: ['Registration tip: refresh less'], tone: 'tip', fam: 'admin', say: [
    'I refreshed 200 times. Got the same waitlist.', 'The refresh button has never helped me and I keep trusting it.',
    'Set an alarm, load the page, breathe. That is all you can do.', 'Honestly the refreshing is emotional support.',
    'Waitlists move more than you think in week one. Do not panic.',
  ] },
  { on: ['free pizza at events'], tone: 'kind', fam: 'social', say: [
    'International student solidarity. The pizza is how they get us.', 'Free pizza is the backbone of campus life.',
    'Wait until you discover the free bagels on Friday mornings.', 'Honestly how most of us survive the week.', 'Welcome! Follow the pizza and you will find your people.',
  ] },
  { on: ['Late-night study spot hunting'], tone: 'ask', fam: 'study', say: [
    'The 24-hour lounge in the student center is underrated.', 'Try the engineering building. Open late and nobody bothers you.',
    '"My room has a bed in it" is the most relatable problem.', 'Some coffee shops near campus stay open late on weekdays. Worth a try.',
    'Bring headphones to the library. It helps with the noise.',
  ] },
  { on: ['I have an office, a desk, and no idea'], tone: 'funny', fam: 'grad', say: [
    'That is grad school. Nobody knows. We just keep going.', 'Congrats on the desk. The idea comes later.', 'Fifth-year grad student here. Still no idea. Still fine.',
    'Put a plant on the desk. It helps.', 'The office makes it real.',
  ] },
  { on: ['wrote in one sitting'], tone: 'funny', fam: 'class', say: [
    'The shaking is the caffeine. The paper is probably great.', 'One-sitting papers are either brilliant or chaos. Usually both.', 'Proud of you. Now drink water.',
    'Did this too. Got a B plus. You are fine.', 'The shaking hands to fine paper pipeline is real.',
  ] },
  { on: ['eye contact with someone\'s sandwich'], tone: 'funny', fam: 'transit', say: [
    'I have been that sandwich.', 'The sandwich looked back.', 'Rush hour bus is a full contact sport.',
    'Please tell me it was a good sandwich.', 'The morning bus is a lesson in personal space.',
  ] },
  { on: ['Victorian ghost'], tone: 'funny', fam: 'home', say: [
    'The Victorian ghost look is actually very in.', 'Get a bed canopy. Changed my life.', 'Talk to her. Maybe she does not know it bothers you.',
    'My roommate sleeps with the TV on. Solidarity.', 'Eye masks are the best $5 I ever spent.',
  ] },
  { on: ['free hugs'], tone: 'kind', fam: 'kindness', say: [
    'Did you get the hug? Please say you got the hug.', 'I got one. It was a very good hug.', 'The free hugs person is doing important work.',
    'Next time go for it. Nobody regrets a hug.', 'The most wholesome thing that has happened on the quad.',
  ] },
  { on: ['the campus cats'], tone: 'kind', fam: 'nature', say: [
    'The campus cats are doing important work.', 'The orange one near the library sits with anyone who looks stressed.', 'Cats are the real counseling service.',
    'I have been adopted by one of them. I do not know its name.', 'Somebody leaves water out for them. Bless that person.',
  ] },
  { on: ['Pick two, right?'], tone: 'funny', fam: 'social', say: [
    'Pick two and rotate weekly.', 'Sleep is the first to go. Always.', 'I picked clubs and classes. My sleep filed a complaint.',
    'Honestly, pick two and do them well.', 'The people who do all three are hiding something.',
  ] },
  { on: ['Career center review'], tone: 'tip', fam: 'career', say: [
    'Can confirm. They are so good and nobody uses them.', 'They also do mock interviews. Go.', 'Going this week because of this post.',
    'The career center saved my internship search.', 'Book early. They fill up before career fair season.',
  ] },
  { on: ['It rained sideways'], tone: 'funny', fam: 'weather', say: [
    'The most embarrassing and relatable thing.', 'Saw someone lose an umbrella to the wind today. Might have been you.', 'Umbrellas are useless against sideways rain.',
    'Rain jacket is the only answer.', 'You made someone laugh today. That is a gift.',
  ] },
  { on: ['figuring things out'], tone: 'warm', fam: 'struggle', say: [
    'You will figure it out. Or you will not and it will still be fine.', '"Figuring things out" is a real answer. Nobody has it all figured out.',
    'Said the same thing for two years. Now I have a plan. It happens.', 'Your parents probably said the same thing to theirs.', 'You are allowed to not know yet.',
  ] },
  { on: ['the vending machine gave me two'], tone: 'funny', fam: 'food', say: [
    'The vending machine giving you two things is the universe apologizing.', 'This is a sign. Make a wish.', 'Share the second one. Good karma.',
    'The best thing that can happen on a Tuesday.', 'I have been waiting for this my whole life.',
  ] },
  { on: ['The quad at night'], tone: 'kind', fam: 'spots', say: [
    'Keep it secret. Keep it safe.', 'Best place to think. Quiet and pretty.', 'I walk through it every night on the way back just for that.',
    'Nobody else knows. Keep it that way.', 'The lamps make it look like a painting.',
  ] },
  { on: ['Study room booking system'], tone: 'funny', fam: 'study', say: [
    'Set an alarm for midnight. That is when new slots open.', 'I have lost every time too. We should form a support group.', 'The booking system is faster than any human.',
    'I once booked a room at 3am out of spite.', 'The people who get the rooms are not human.',
  ] },
  { on: ['proud of myself for going to class'], tone: 'warm', fam: 'wins', say: [
    'Genuinely proud of you for going to class.', 'Showing up is the hardest part. You did it.', 'Some days that is the whole win, and that is enough.',
    'Proud of you too. Keep going.', 'Going to class on a hard day counts double.',
  ] },
  { on: ['my bike lock costs more'], tone: 'funny', fam: 'overheard', say: [
    'The smartest financial decision on campus.', 'Same. My bike is a $40 garage sale find. The lock is $80.', 'Honestly, the correct ratio.',
    'Bike thieves are the real threat. Lock accordingly.', 'The lock is the real investment.',
  ] },
  { on: ['hold music'], tone: 'funny', fam: 'admin', say: [
    'I could hum it for you right now.', 'The hold music is going on my wedding playlist.', 'Call right when they open. Shorter wait.',
    'I have spent more time with that music than with my friends.', 'The hold music has a bridge now. It has evolved.',
  ] },
  { on: ['4 minutes before it started'], tone: 'funny', fam: 'class', say: [
    'At least you were on time for once. Nobody will ever know.', 'The walk back to your dorm is a special kind of shame.',
    'This is why I check email before I leave my room.', 'Four minutes is actually generous notice for some professors.', 'Take the free hour and go get coffee.',
  ] },
  { on: ['played the intro to a song and stopped'], tone: 'funny', fam: 'music', say: [
    'I am still waiting for the chorus.', 'They left us on a cliffhanger. Rude.', 'Maybe they will finish it next week. We wait.',
    'The silence after was so loud.', 'The most dramatic thing that has ever happened in the union.',
  ] },
  { on: ['Cooked a real dinner'], tone: 'kind', fam: 'home', say: [
    'The best kind of adulting.', 'What did you make? I need ideas.', 'Cooking for yourself is self-care.',
    'Proud of you. Now do the dishes.', 'A real dinner hits different after weeks of cereal.',
  ] },
  { on: ['wifi outage during the online quiz'], tone: 'funny', fam: 'study', say: [
    'Email the professor right now with a screenshot. They usually understand.', '"The quiz did not care" is the saddest line on here.',
    'The campus wifi picks the worst possible times.', 'Take online quizzes on a wired connection if you can.', 'Lost a whole quiz to this last year. Sending strength.',
  ] },
  { on: ['when the library gets sun'], tone: 'funny', fam: 'study', say: [
    'The library sun schedule is a whole science.', 'Yes. Morning sun on the east side, afternoon on the west.', 'Sunlight and a desk is all I need.',
    'Glad I am not the only one.', 'I follow the sun from table to table like a cat.',
  ] },
  { on: ['thermos of hot chocolate'], tone: 'kind', fam: 'kindness', say: [
    'Campus is good sometimes. This is one of those times.', 'Whoever did this, thank you.', 'I had a cup. It was perfect.',
    'Leaving something like this next week. Paying it forward.', 'The nicest thing I have read today.',
  ] },
  { on: ['Gym crowding index'], tone: 'funny', fam: 'gym', say: [
    'The stretching area is where the gossip happens.', 'Leg day is impossible because everyone skipped it last week.',
    'Accurate. I have made two friends in the stretching area.', 'Please do a weekly update.', 'Cardio is fine because nobody wants to do cardio.',
  ] },
  { on: ['$6 doorstop'], tone: 'funny', fam: 'home', say: [
    'Noted. Investing in a doorstop.', 'Best $6 you will ever spend.', 'Did your roommate notice?',
    'My roommate slams cabinets. Is there a cabinet stop?', 'Simple solutions are the best solutions.',
  ] },
  { on: ['First-gen student'], tone: 'warm', fam: 'struggle', say: [
    'First-gen here too. You are not alone in this.', 'There is a first-gen student group on campus. It helped me a lot.',
    'It is okay that it is not fine. You are doing something nobody in your family has done.', 'Your family might not get the details, but they are proud. Trust that.',
    'You belong here. That is not a small thing.',
  ] },
  { on: ['the good stuff appears exactly then'], tone: 'funny', fam: 'food', say: [
    'Mac and cheese during finals week is not a coincidence.', 'The dining hall is watching our calendars.', 'A conspiracy and I support it.',
    'They also bring out the good cookies on Sundays.', 'Honestly a smart move. Morale matters.',
  ] },
  { on: ['Homesickness hits hardest on Sundays'], tone: 'warm', fam: 'struggle', say: [
    'Big same on the Sunday homesickness.', 'Sunday dinner at home is what I miss most.', 'Call home on Sundays. It helps a little.',
    'Make your own Sunday tradition here. It helps more than you would think.', 'You are not alone. Sunday nights are rough.',
  ] },
  { on: ['room with windows'], tone: 'funny', fam: 'class', say: [
    'Windows are a basic human right.', '40% is a conservative estimate.', 'I would pay extra tuition for a room with windows.',
    'The basement classrooms need to hear this.', 'Natural light is the best study aid.',
  ] },
  { on: ['one person who answers questions'], tone: 'funny', fam: 'class', say: [
    'Group chats of 200 are just one person\'s unpaid job.', 'Bless that person. They carry the whole class.', 'I am the one asking the questions. Sorry.',
    'They deserve an honorary TA position.', 'The group chat hero is real.',
  ] },
  { on: ['campus climbing wall'], tone: 'funny', fam: 'gym', say: [
    'Forearm pump is the rite of passage. You will be back.', 'Week two it gets easier. Promise.', 'Chalk up, take breaks, and do not grip so hard.',
    'The people at the wall are so friendly.', 'Your forearms will thank you eventually.',
  ] },
  { on: ['email a professor just to say'], tone: 'ask', fam: 'class', say: [
    'You should email them. Professors love that. Genuinely.', 'Did it once and the professor replied with a whole paragraph. Made both our days.',
    'Absolutely. They rarely hear positive feedback.', 'Do it. Nobody has ever regretted sending a kind email.', 'Thank you for the reminder to email my professor.',
  ] },
  { on: ['The muffin is now an investment'], tone: 'funny', fam: 'food', say: [
    'Okay but the muffin is worth it.', 'The muffin is a retirement plan now.', 'I bring muffins from home now. Just as good, less painful.',
    'Prices up, muffin size down. I see what they are doing.', 'The muffin economy is out of control.',
  ] },
  { on: ['their music is not for everyone'], tone: 'ask', fam: 'home', say: [
    'Headphones as a gift. Very subtle.', 'Say it like a joke first. Then say it for real.', 'Set quiet hours together. Makes it feel less personal.',
    'Honesty is best. Just be kind about it.', 'Ask what they are listening to first. People soften when you are curious.',
  ] },
  { on: ['bench by the river'], tone: 'kind', fam: 'spots', say: [
    'Try the bench by the river. Changed my week too.', 'I found that bench too. Keep it secret.', 'River benches are the best free therapy.',
    'Going there tomorrow because of this.', 'Nothing like water to calm you down.',
  ] },
  { on: ['thesis proposal'], tone: 'warm', fam: 'grad', say: [
    'Congrats! The nap was well deserved.', 'The nap of unusual length is a proud academic tradition.', 'Huge. Enjoy it.',
    'Proposal done is a massive milestone.', 'Sending celebration vibes.',
  ] },
  { on: ['leave chargers plugged in for strangers'], tone: 'kind', fam: 'kindness', say: [
    'Leaving a charger is the ultimate kindness.', 'The people who take them are a menace.', 'I leave an old one plugged in on purpose. For the chain.',
    'Someone took mine last week. I hope their battery never charges past 20%.', 'Honor system in the library. Most people are good.',
  ] },
  { on: ['Went to a club meeting alone'], tone: 'kind', fam: 'social', say: [
    'This is your sign to go to the club meeting alone.', 'The free t-shirt is the real win.', 'Going alone is scary but it always works out.',
    'Two numbers and a shirt is a great return.', 'Doing this next week. Wish me luck.',
  ] },
  { on: ['arriving to class as a puddle'], tone: 'funny', fam: 'weather', say: [
    'Construction on the main walkway is a personal attack.', 'I show up to class looking like I swam there.', 'Rain boots are the most underrated campus item.',
    'Ten minutes is not enough time even when it is sunny.', 'Solidarity from another puddle.',
  ] },
  { on: ['welcome aboard'], tone: 'kind', fam: 'transit', say: [
    'The best bus driver on campus.', 'I look forward to "welcome aboard" every morning.', 'Consistency like that is rare. Treasure it.',
    'Thank them. They probably do not hear it enough.', 'The kind of person who makes a place feel like home.',
  ] },
  { on: ['Study playlist review'], tone: 'funny', fam: 'study', say: [
    'Brown noise changed my life. Seriously.', 'Movie soundtracks are the next level. Try them.', 'Lo-fi works until the same song plays for the third time.',
    'Rain sounds for reading, brown noise for math.', 'Video game soundtracks are made for focus.',
  ] },
  { on: ['bakes cookies on Sunday nights'], tone: 'kind', fam: 'kindness', say: [
    'The Sunday cookie person deserves a statue.', 'Do not ask. Just accept the cookies.', 'Please say they are chocolate chip.',
    'This is the kind of mystery I support.', 'Leave a thank-you note on the landing. They will see it.',
  ] },
  { on: ['a personality to maintain'], tone: 'funny', fam: 'overheard', say: [
    'The personality is the hardest assignment.', 'The realest overheard of the year.', 'Honestly, priorities.',
    'I have zero assignments and still struggle to maintain mine.', 'Put this on a shirt.',
  ] },
  { on: ['best time to drop a class'], tone: 'tip', fam: 'admin', say: [
    'Dropping a class is not failure, it is scheduling.', 'Wish I had known this last year.', 'Check the refund deadline too. It is usually the same week.',
    'Talk to your advisor first. They might have a better option.', 'Good tip. Also check whether it affects financial aid.',
  ] },
  { on: ['crossword in the margins'], tone: 'kind', fam: 'kindness', say: [
    '"Felt like a handshake" is the best way to describe this.', 'Leave one for the next person. Keep the chain going.', 'The library desks have so much history.',
    'The kind of connection that only happens in libraries.', 'I am going to start leaving half-done crosswords now.',
  ] },
  { on: ['finally know where all my classes are'], tone: 'funny', fam: 'buildings', say: [
    'Proud of you. It took me a year.', 'Just in time for next semester to move all of them.', 'Honestly a milestone. Celebrate.',
    'The campus map lies. You did this on instinct.', 'Week 9 and I found a new building yesterday.',
  ] },
  { on: ['umbrellas for $30'], tone: 'funny', fam: 'weather', say: [
    'It is a business model and it works on me every time.', 'The cheap one from the grocery store somehow lasts longer.', 'Rain jacket. Never look back.',
    'The umbrella graveyard by the library trash cans says it all.', 'One storm is generous. Mine lasted one gust.',
  ] },
  { on: ['I like early classes'], tone: 'funny', fam: 'class', say: [
    'Early class people unite. The empty campus is the best campus.', 'The good coffee before the line is the real reason.', 'I respect this but cannot relate.',
    'Honestly, 8am people have the most peaceful mornings.', 'The most controversial post on here.',
  ] },

  /* ── polls (the question is the root text) ── */
  { on: ['Which dining hall breakfast is actually the best?'], tone: 'funny', fam: 'poll', say: [
    'Kinsolving on taco days. Not close.', 'Voted off-campus tacos and I stand by it.', 'Jester has the cereal station though. Underrated.',
    'The results of this poll are going to start fights.', 'Whichever one is still open when I finally wake up.',
  ] },
  { on: ['Best bus route for a nap?'], tone: 'funny', fam: 'poll', say: [
    'The 801 at 2pm is basically a cradle.', 'Voted "I walk and suffer." Accurate every day.', 'Fell asleep on the 640 once and woke up at the end of the line.',
    'The 803 is too bumpy. Respectfully.', 'Set an alarm before you nap on any of them. Learned that the hard way.',
  ] },
  { on: ['How many hours did you sleep last night?'], tone: 'funny', fam: 'poll', say: [
    'Voted 4 to 6 and I am pretending that is fine.', 'The "healthy amount" voters, what is your secret?', 'Under 4, but I had a great reason. I did not.',
    'This poll is a wellness check in disguise.', 'Going to bed early tonight because of this poll.',
  ] },
  { on: ['Are you going to the game this weekend?'], tone: 'funny', fam: 'poll', say: [
    'Yes, painted. Already bought the face paint.', 'Voted "No, studying." Will absolutely be watching from the library.', '"Yes, quietly" is my entire personality.',
    'No, sleeping. No regrets.', 'Whoever wins, the tailgate food is the real prize.',
  ] },
  { on: ['Coffee or energy drink before an 8am?'], tone: 'funny', fam: 'poll', say: [
    'Both, and I am not okay.', 'The "neither" voters are built different.', 'Coffee. It is a ritual, not a drink.',
    'Energy drink people, show yourselves.', 'Tea is not an option and I feel left out.',
  ] },
  { on: ['Where do you do your best work?'], tone: 'funny', fam: 'poll', say: [
    'Library for focus, coffee shop for vibes.', 'Outside, until the wind takes my notes.', 'Dorm is a trap. The bed calls.',
    'Coffee shop noise is the perfect level of distraction.', 'Honestly depends on the week.',
  ] },
  { on: ['Would you retake your worst class with a better professor?'], tone: 'funny', fam: 'poll', say: [
    'Instantly. The professor is 80% of the class.', 'Never. Some memories should stay buried.', 'Maybe, if it was online.',
    'A good professor could make me like anything.', 'Voted maybe because I am a coward.',
  ] },
  { on: ['Group project preference?'], tone: 'funny', fam: 'poll', say: [
    'No group projects ever. Obviously.', 'Random assignment is how I met my best friend. Also my nemesis.', 'Picking your own group ruins friendships. Ask me how I know.',
    'Random assignment keeps everyone honest.', 'Whatever you pick, someone is still going to "send it tonight."',
  ] },
  { on: ['How far into the semester do you feel behind?'], tone: 'funny', fam: 'poll', say: [
    '"I was never ahead" is winning and I feel seen.', 'Week 1. The syllabus alone made me feel behind.',
    'Everyone feels behind. Nobody says it. Thank you for asking.', 'Week 4, specifically a Tuesday.', 'This poll made me feel less alone.',
  ] },
  { on: ['Best way to spend a free afternoon?'], tone: 'funny', fam: 'poll', say: [
    'Nap. Always nap.', '"Errands I have avoided" is the adult answer and I hate it.', 'Friends, then nap. Best combo.',
    'The gym voters are the most disciplined people on campus.', 'What is a free afternoon?',
  ] },
  { on: ['Which is worse: an 8am class or a 7pm class?'], tone: 'funny', fam: 'poll', say: [
    'Both are crimes. Obviously.', '7pm is worse. It eats your whole evening.', '8am. My brain is not online yet.',
    'Night class people are the most tired people alive.', 'I have both this semester. Send help.',
  ] },

  /* ── templated overflow roots (only when the text pools run out) ── */
  { on: ['edition: it'], tone: 'funny', fam: 'food', say: [
    'Discuss? There is nothing to discuss. You are right.', 'Hard disagree but I respect the passion.', 'This take is going to start a fight in my group chat.',
    'I have thought about this more than my midterm.', 'Counterpoint: no.',
  ] },
  { on: ['Overheard near '], tone: 'funny', fam: 'overheard', say: [
    'The overheard posts are the best posts.', 'I think I was standing right next to this person.', 'Context, please. I need context.',
    'Somebody find this person and give them a show.', 'Campus conversations out of context are my favorite genre.',
  ] },
];

/** Quotes for the templated "Overheard near …" overflow root (contain no `TALK.on` key). */
const OVERHEARD = [
  'I studied so hard I forgot what I studied.', 'My GPA and my sleep schedule are in a long-distance relationship.', 'I am not lost, I am exploring the building.',
  'Is it a nap if it lasts four hours?', 'I will start the reading after this snack.', 'The syllabus says optional and my professor says otherwise.',
];

/** Related anecdotes / opinions that fit EVERY root of the family (general campus, so they hold at any university). */
const FAMILY: Record<Family, string[]> = {
  class: [
    'Every lecture has one person who asks a question at 10:49 when class ends at 10:50.', 'Recorded lectures at 1.5x speed are how I survive this semester.',
    'Professors who post the slides before class are heroes. No notes.', 'Sat in a random seat on day one and now it is my seat until graduation.',
    'The front row people are a different species and I respect them.', 'My professor said "quick question" once and it took 20 minutes.',
    'Once a professor knows your name you can never skip again. That is the deal.', 'Half of college is figuring out which classes actually take attendance.',
    'TA office hours are the most underrated hour of the week.', 'Somebody always packs up five minutes early and the whole room panics.',
  ],
  food: [
    'The dining hall cookie is the best thing on campus and I will not be taking questions.', 'Cereal for dinner three times this week and I have never felt more free.',
    'Meal swipe math is the only math I am good at.', 'The best food on campus is anything in a common room with a "free" sign on it.',
    'Grocery runs with friends are the most underrated social activity.', 'I judge every food spot near campus by its hot sauce selection.',
    'Coffee is a food group during midterms. I checked.', 'Somebody should make a map of every free snack on campus.',
    'Late-night food runs are where the real friendships are made.',
  ],
  transit: [
    'Every getting-to-class story on here is either a miracle or a tragedy.', 'I have a favorite seat on the bus and I get irrationally upset when it is taken.',
    'The transit app says 2 minutes for 15 minutes straight. Every day.', 'Walking is the only transport I fully trust.',
    'Rush hour on campus is its own kind of cardio.', 'I have a whole friendship built on nodding at the same person on the morning bus.',
    'The day I learned there is an express route, my life changed.', 'Bikes, buses, scooters, feet. None of them get you to class on time in the rain.',
  ],
  study: [
    'Everyone has a study spot they would never reveal. Mine is safe.', 'I study better in a room where other people are also suffering quietly.',
    'The library at 9am and the library at 9pm are two different planets.', 'I have a ranking of every outlet on campus. It is a sickness.',
    'Headphones in, no music playing. The universal do-not-disturb sign.', 'Somebody always saves a table with one notebook for three hours. The audacity.',
    'Study breaks that last longer than the study session are my specialty.', 'The library has a smell and I find it calming.',
    'Bring a sweater to any study spot. Every building has an opinion about temperature.',
  ],
  home: [
    'Roommate agreements are the most important document I have signed in college.', 'Living with people teaches you more than any class.',
    'My roommate and I communicate entirely through sticky notes on the fridge now.', 'Every dorm has a mystery smell and a mystery noise. Ours has both.',
    'The first apartment is where you learn what a utility bill is.', 'Good roommates are worth more than a good location.',
    'I did not know how many opinions I had about dishes until I had a roommate.', 'The group chat with my roommates is 90% "who left this here."',
  ],
  weather: [
    'The weather here has three settings and none of them match the forecast.', 'I check the weather app every morning and it lies to me every morning.',
    'Dressing for a day that starts cold and ends hot is a skill they should teach.', 'Bad weather days are when you find out who owns a real jacket.',
    'The group chat turns into a weather report on days like this.', 'Nothing unites a campus like everyone complaining about the same weather.',
    'I keep a spare pair of socks in my bag. You learn.', 'The walk to class is a different adventure every season.',
  ],
  buildings: [
    'Every building on campus was designed by someone who hated maps.', 'Half the buildings here have a floor that only exists if you take the right staircase.',
    'The older buildings have character. The character is mostly noises.', 'I have a favorite bathroom on campus and I will cross a whole building for it.',
    'Room numbers here follow a system nobody has ever explained.', 'Somebody should give a tour of just the weird parts of campus buildings.',
    'The newer buildings are nice but they have no stories yet.', 'I still find hallways I have never seen and I am a senior.',
  ],
  kindness: [
    'This campus has so many quietly kind people. You just have to notice.', 'A stranger once gave me their umbrella and walked off in the rain. I think about it weekly.',
    'Small kind things are contagious. Someone does one and the whole day shifts.', 'Someone paid for my coffee last month for no reason. I have paid it forward twice since.',
    'I keep a list of nice things strangers have done for me here. It is getting long.', 'The kindest people on campus are usually the ones nobody notices.',
    'Posts like this make me want to go do something nice for someone.', 'Lost my student ID once and it was at the front desk within an hour. People are good.',
  ],
  nature: [
    'The campus animals are more confident than I will ever be.', 'I keep a running list of campus animal encounters. This one is going on it.',
    'Someone should make a campus wildlife field guide. I would buy it.', 'The animals here know our class schedules better than we do.',
    'Every campus animal has a personality and a fan club.', 'I stop for every animal on my walk to class. It makes me late. Worth it.',
    'Campus wildlife sightings are the best genre of post on here.',
  ],
  spots: [
    'Every campus has a secret spot and you only find it by wandering.', 'My favorite spot changes every semester and I love that.',
    'Found a quiet corner by accident freshman year and I still go there.', 'Wandering campus with no plan is the most underrated activity.',
    'The best spots are the ones that are empty exactly when you need them.', 'Somebody should make a map of the good places on campus. Then burn it.',
    'Sunset spots, nap spots, think spots. Everyone needs all three.', 'Went looking for this after reading the post. Found it. I understand now.',
  ],
  career: [
    'Recruiting season on campus is its own weather system.', 'Nobody talks about how tiring it is to be "on" for recruiters all day.',
    'My resume has been rewritten so many times it has a version history.', 'Every offer I know of came from a conversation, not an application portal.',
    'Recruiting season online is a stressful place. Take breaks from it.', 'Internship hunting is a numbers game and the numbers are rude.',
    'Everyone\'s timeline is different. People with offers in September are not the norm.', 'The career center is the most underused free thing here.',
  ],
  grad: [
    'Grad school is 10% research and 90% emailing people about research.', 'Every grad student has a folder called "final_final_v3." Every single one.',
    'The grad office coffee machine has seen things.', 'My advisor says "almost there" the way weather apps say "light rain."',
    'Grad students supporting other grad students is the whole ecosystem.', 'Undergrad me thought grad students had it figured out. Grad me is laughing.',
    'Milestones in grad school are small and rare. Celebrate every one.', 'The best part of grad school is the people in the office next door.',
  ],
  struggle: [
    'What helped me most was one small routine I could count on every day.', 'Hard weeks end. I know it does not feel like it, but they do.',
    'Going for a walk without my phone fixed more bad days than I expected.', 'You are allowed to find this hard. It is hard.',
    'Telling one person how you actually feel changes more than you would think.', 'I wrote down one good thing a day for a month. It helped more than I want to admit.',
    'Everyone here is carrying something. You are not the only one.', 'Be as patient with yourself as you would be with a friend.',
    'Eat something, drink some water, sleep. Then decide how bad it is.', 'The counseling center has group sessions too. They helped me more than I expected.',
  ],
  wins: [
    'Celebrate the small stuff. It adds up to the big stuff.', 'Write this down somewhere. Future you will want to remember it.',
    'I love a win post. More of these, please.', 'Wins like this are what carry you through the rest of the semester.',
    'Telling people about your wins is not bragging. It is sharing.', 'Treat yourself tonight. You earned it.', 'The progress nobody sees is still progress.',
    'This is the kind of post I want to see when I am having a bad week.',
  ],
  music: [
    'Campus music moments are the best unplanned part of any day.', 'Live music in a random hallway beats any playlist.',
    'I love that people here just play instruments in public. Brave and good.', 'The acoustics in old buildings make everyone sound professional.',
    'Music students practicing in odd places is my favorite campus soundtrack.', 'I would pay for a playlist of every song I have heard someone play on campus.',
    'Hearing someone practice the same part over and over and finally nail it is so satisfying.',
  ],
  social: [
    'Friendships here start in the weirdest places.', 'Showing up twice matters more than being interesting once.',
    'The people I met by accident are my closest friends now.', 'Every club says "no experience needed" and for once they mean it.',
    'Saying yes to random plans freshman year was the best thing I did.', 'Campus is huge but it gets small fast once you find your people.',
    'Activities where nobody is good at the thing are the best way to meet people.', 'Met my roommate for next year at an event I almost skipped.',
  ],
  admin: [
    'University systems are held together by one very tired server and hope.', 'Every office on campus has a different form for the same thing.',
    'The advising office is more helpful than people think. Book early.', 'Reading the academic calendar is a skill nobody teaches you.',
    'I have spent more hours on university portals than in some of my classes.', 'The deadline is always one day earlier than you think. Always.',
    'Every semester I promise to do the admin stuff early. Every semester I do not.',
  ],
  gym: [
    'The gym is less scary once you go at the same time three days in a row.', 'The best workout is the one you actually go to. That is my excuse and it works.',
    'Bringing a friend to the gym doubles the motivation and halves the workout.', 'Everyone at the gym is too focused on themselves to judge you. Truly.',
    'The rec has classes most people do not know about. The yoga one is great.', 'The gym playlist is always two years old and I kind of love it.',
    'Wipe down your equipment and the gym gods will smile on you.',
  ],
  overheard: [
    'Campus overheard is my favorite genre.', 'The things people say on the way to class could fill a book.',
    'Yesterday someone near me said "I have peaked" at 9am. Same energy.', 'I would read a whole book of campus overheards.',
    'Out of context, this campus is incredible.', 'Every overheard post makes me eavesdrop more. I am sorry.', 'Context is overrated. This is perfect as is.',
  ],
  campus: [
    'The weird little moments are what I will remember about this place.', 'Every day on this campus something happens that I have to tell someone about.',
    'Campus life is 40% classes and 60% moments like this.', 'Adding this to the list of campus experiences nobody puts in the brochure.',
    'You could not make up half the things that happen here.', 'I love how this campus has its own little rituals.', 'Years here and it still surprises me.',
  ],
  poll: [
    'Voted, and now I need to see where this ends up.', 'Refreshing this poll way more than I should.', 'The results of this one are going to be controversial.',
    'Changed my mind three times before voting.', 'Polls like this are the best part of Buzz.', 'Voted before reading all the options. No regrets.',
    'The option I picked is clearly correct. Everyone else is wrong.', 'Sending this poll to my friends to settle an argument.',
  ],
};

/** Top-level reactions that fit ANY post of the tone (no topic, place or detail of their own). */
const FILLER: Record<Tone, string[]> = {
  funny: [
    'This is the realest thing on here today.', 'Screenshotting this for my roommate.', 'Laughed out loud in the library and got shushed. Worth it.',
    'Not me nodding at my phone in public.', 'Who else is reading this instead of studying. Hi.', 'This is the kind of post that makes me open the app.',
    'Sending this to the group chat immediately.', 'The accuracy of this post is unsettling.', 'Somebody pin this.', 'Posts like this are why I check Buzz between classes.',
    'The replies on this one are sending me.', 'Put this on the campus tour.', 'Reading this in lecture and trying very hard not to laugh.', 'Top post of the week, no contest.',
    'Okay but this is so specific and so true.', 'I need a follow-up post on this. Please.', 'Take my upvote and go.', 'I have nothing to add, I just wanted to be part of this.',
    'This belongs in the campus newspaper.', 'Read this out loud and my roommate cackled.', 'I am going to be thinking about this all day.', 'This post has main character energy.',
    'The way I snorted.', 'This is peak campus content.', 'Saving this for when someone asks what this school is actually like.', 'Buzz is undefeated today.',
    'Okay this made my morning.', 'Felt this in my bones.', 'Real.', 'I say this with love: same.', 'Not the post I expected today, but the one I needed.',
    'My roommate asked why I was laughing. I could not explain it.', 'Every campus needs a post like this.', 'Buzz, never change.', 'Adding this to my favorite posts.',
    'I have read this four times now.', 'Filing this under campus lore.', 'Five stars. No notes.', 'Genuinely the best thing I have read all day.',
    'I felt this one physically.', 'Thank you for your service to this app.',
  ],
  kind: [
    'This is why I love this campus.', 'Wholesome campus content, we love to see it.', 'This made my whole day.', 'Okay, I am smiling at my phone in the library.',
    'Posts like this are why I stay on Buzz.', 'Campus is good sometimes.', 'Needed something nice today. Thank you for posting.', 'Adding this to my list of reasons to stay optimistic.',
    'This is the content I am here for.', 'Love this so much.', 'Saving this for a bad day.', 'More of this on Buzz, please.', 'Small things like this make a big campus feel small.',
    'Sending this to my mom so she knows it is nice here.', 'This is so sweet.', 'Best thing I have read on here this week.', 'Reading this made my walk to class better.',
    'Heart fully warmed.', 'Buzz at its best.', 'Okay, this is lovely.', 'I did not expect a post to make me this happy today.', 'Love that this exists.',
    'Needed this energy today.', 'This is the kind of thing I want to remember about college.', 'Grinning at my screen like a fool.', 'Pure good news. Thank you.',
    'This is the campus I signed up for.', 'Making this my lock screen, emotionally.', 'I love the people who make posts like this possible.', 'Somebody pin this.',
  ],
  warm: [
    'Thank you for posting this.', 'Needed to read this today.', 'Saving this thread for a hard day.', 'This thread is making me feel less alone.', 'Sending good energy your way.',
    'Rooting for you, whoever you are.', 'The replies on this one are so kind.', 'Buzz at its best, honestly.', 'I think a lot of us needed this one.',
    'Commenting so this reaches more people.', 'Be gentle with yourself this week.', 'Glad you said this out loud.', 'This is the kind of honesty that helps other people.',
    'Hope your week gets lighter from here.', 'This means more to people than you know.', 'Sending a virtual coffee.', 'Hope today is a little easier.',
    'Proud of how people show up in threads like this.', 'Reading every reply here and feeling better.', 'Whoever needs to hear it: you are doing better than you think.',
    'You are allowed to be proud and tired at the same time.', 'Taking care of yourself counts as progress.', 'Adding you to my mental list of people who get it.',
    'Wishing you a gentle week.', 'Every reply here is right.', 'This campus is kinder than it looks, and threads like this prove it.', 'Checking in on you, stranger.',
    'We are all a little tired. Be kind to yourself today.', 'I needed this thread more than I knew.', 'Thank you for being honest. It helps.',
  ],
  tip: [
    'Saving this.', 'Okay this is actually useful.', 'Somebody pin this.', 'Bookmarking this for next semester.', 'Hard agree.', 'Came here to say this exact thing.',
    'Sending this to every freshman I know.', 'This should be in the orientation packet.', 'The most useful thing I have read on here this week.', 'Taking notes.',
    'Real advice, finally.', 'Screenshotting for later.', 'Seconding everything here.', 'Wish I had read this in August.', 'This thread is better than the official website.',
    'Buzz really is the best campus guide.', 'Following this thread for more tips.', 'Adding this to my notes app.', 'Everyone should read this.',
    'The comments here are full of good info too.', 'Thank you for the public service.', 'Okay, I am convinced.', 'Good looking out.', 'Bookmarking this for finals week.',
    'Posts like this are why I check Buzz.', 'Underrated post.', 'This is the kind of post that makes me open the app.', 'Useful and free. My favorite combination.',
  ],
  ask: [
    'Following for answers.', 'Same question. Commenting to see the replies.', 'Good question. I have wondered this too.', 'The replies here are gold.', 'Watching this thread.',
    'Saving this for the answers.', 'Commenting so I can come back to this.', 'Everyone in the replies is so helpful. Love this app.', 'Asking the real questions.',
    'Needed this thread.', 'Following because I need this too.', 'The answers here are better than the official advice.', 'Thank you for asking this so I did not have to.',
    'Bookmarked.', 'Great thread.', 'Reading every reply here.', 'Late to this but the replies already said it all.', 'This thread should be pinned for new students.',
  ],
};

/** Replies to a reply (the parent may be any line above), per tone. */
const NESTED: Record<Tone, string[]> = {
  funny: [
    'Right? I thought it was just me.', 'Exactly this.', 'Seconding.', 'Okay you win the thread.', 'Came for the post, stayed for this reply.', 'Underrated reply.',
    'I laughed way too hard at this.', 'Stop, this is too accurate.', 'Not you calling us all out.', 'Saying this louder for the people in the back.',
    'You are so right and I hate it.', 'Honestly the correct take.', 'Okay but this is so real.', 'The accuracy.', 'Best reply here, easily.',
    'Nobody asked for this level of truth today.', 'Real. Painfully real.', 'Agreed, and I feel seen.', 'This reply made my walk to class better.',
    'Adding this reply to the group chat too.', 'Yes. This.', 'Wait, same.', 'Reading this reply twice because it is so good.', 'Plus one to this.',
    'Not me nodding at this reply too.', 'This reply deserves its own post.', 'This thread keeps getting better.', 'Okay, this reply got me.',
    'The replies are winning today.', 'I came here to say exactly this.',
  ],
  kind: [
    'Love this reply.', 'Seconding.', 'Exactly this.', 'Yes. This.', 'This reply is as sweet as the post.', 'Agreed completely.', 'The replies are as wholesome as the post.',
    'Best reply here.', 'Came for the post, stayed for this reply.', 'Plus one to this.', 'You are so right.', 'This whole thread is lovely.', 'Aw, this is great.',
    'Same here, honestly.', 'This made me smile.', 'Co-signing this reply.',
  ],
  warm: [
    'This is such a kind reply.', 'Seconding all of this.', 'Exactly what I wanted to say, but better.', 'Agreed, and I hope OP sees this one.',
    'This is good advice for everyone, honestly.', 'Yes. Please listen to this person.', 'Saving this reply for myself too.', 'I needed this reply as much as OP did.',
    'This is the kind of reply that keeps me on here.', 'Plus one. Speaking from experience.', 'Same experience here. It really does help.', 'This. All of this.',
    'Thank you for writing this out.', 'The kindness in this thread is unreal.', 'Agreed. Small steps count.', 'Co-signing every word.', 'Love this reply.',
    'This reply made me tear up a little.',
  ],
  tip: [
    'Seconding this.', 'Exactly this.', 'Best advice in the thread.', 'Can confirm this works.', 'Underrated reply.', 'Plus one to this.', 'Yes. This.', 'Good call.',
    'Did not know this. Thank you.', 'Taking notes on this reply.', 'Came here to say this.', 'This is the answer.', 'Agreed, from experience.',
    'Saving this reply specifically.', 'Adding this to my notes too.', 'Huge if true. Trying it this week.',
  ],
  ask: [
    'Seconding this.', 'Exactly this.', 'Best answer in the thread.', 'Can confirm this works.', 'Underrated reply.', 'Plus one to this.', 'This is the answer.',
    'Agreed, from experience.', 'Did not know this. Thank you.', 'Taking notes on this reply.', 'Came here to say this.', 'Saving this reply specifically.',
    'Good call.', 'Trying this. Will report back.', 'This is the one.',
  ],
};

/** Replies on Maya's buzz_0001 (the "friend group" post): supportive, specific, product §5. */
const MAYA_THREAD_REPLIES = [
  'Took me until spring. Pick one club and keep showing up.',
  'Week 5 is early. Most "groups" you see are just people who happened to live on the same floor.',
  'Same boat. Want to be bad at intramurals together?',
  'I made my closest friends in a class I hated. Sit next to the person who also looks lost.',
  'Honestly the study rooms are where it happened for me. Book one, invite the people from your section.',
  'You are not behind. Half the people in those groups are also lonely, they just have someone to be lonely next to.',
  'Try the thing you are curious about, not the thing that looks popular.',
  'Go to a club meeting alone once. It is the hardest and best 45 minutes.',
  'This post is proof you are not the only one. Look at the replies.',
  'The pickup soccer crowd on Thursday nights takes anyone. Come.',
  'Second this. Showing up twice matters more than being interesting once.',
  'Sophomore now. I felt exactly this. It changed when I stopped waiting to be invited.',
  'You just made a whole thread of strangers feel less alone. That is a skill.',
  'Saving this thread for the next person who asks.',
];

/* ───────────────────────────── helpers ───────────────────────────── */

interface Post {
  id: Id;
  rootId: Id | null;
  parentId: Id | null;
  depth: number;
  authorId: Id;
  universityId: Id;
  text: string;
  promptId: Id | null;
  status: 'active' | 'hidden';
  createdAt: number;
}

interface Vote {
  postId: Id;
  userId: Id;
  value: 1 | -1;
  eligible: 0 | 1;
  createdAt: number;
}

const CAMPUS_WORDS = ['the union', 'the library', 'the rec', 'the quad', 'the dining hall', 'the science building', 'the bus loop', 'the coffee cart'];
const VERDICTS = ['is carried by one dish', 'peaked in week 2', 'is better than people say', 'is a personality test', 'needs a second exit', 'closes exactly when I need it'];

export default function seed(kit: SeedKit): void {
  const full = kit.scale === 'full';
  const db = kit.db;

  /* ───────────── prompts ───────────── */
  const insPrompt = db.prepare('INSERT INTO buzz_prompts (id, idx, text) VALUES (?,?,?)');
  PROMPTS.forEach((text, i) => insPrompt.run(kit.id('bzp', i + 1), i, text));

  /* ───────────── authors per campus (students only, never orgs; Maya + fixtures explicit) ───────────── */
  const maya = kit.users.get('mayachen');
  const students = kit.users.all.filter((u) => u.accountType === 'student');
  const byCampus = (uni: Id): SeedUser[] => students.filter((u) => u.universityId === uni && u.id !== maya.id);
  const hero = byCampus(UNI.utexas);
  const bgHero = kit.users.bg(UNI.utexas);
  if (hero.length < 5 || bgHero.length < 2) throw new Error('buzz seed: core seed must run first');

  const posts: Post[] = [];
  const votes: Vote[] = [];
  const polls: { postId: Id; closesAt: number; options: string[] }[] = [];
  let threadN = 0;
  let replyN = 0;

  /**
   * Safety L1: seeded Buzz ids must not be sequential. A counter in GENERATION order clusters one author (all of a
   * persona's replies are minted together) and makes every thread enumerable, so non-final ids are a deterministic
   * nanoid-shaped digest of (prefix, n) — stable across runs, no kit.rng draw (downstream randomness is unchanged),
   * and their sort order carries no author or time information. Only the SPEC-final ids (§7.5) stay numbered.
   */
  const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const opaqueId = (prefix: string, n: number): Id => {
    const digest = crypto.createHash('sha256').update(`universe-seed:${prefix}:${n}`).digest();
    let out = '';
    for (let b = 0; b < 14; b++) out += ID_ALPHABET[digest[b]! & 63];
    return `${prefix}_${out}`;
  };

  const nextThreadId = (): Id => {
    threadN += 1;
    return opaqueId('buzz', threadN);
  };

  const addRoot = (o: { id?: Id; author: SeedUser; text: string; createdAt: number; promptId?: Id | null; status?: 'active' | 'hidden' }): Post => {
    const p: Post = {
      id: o.id ?? nextThreadId(), rootId: null, parentId: null, depth: 0, authorId: o.author.id, universityId: o.author.universityId,
      text: o.text, promptId: o.promptId ?? null, status: o.status ?? 'active', createdAt: o.createdAt,
    };
    posts.push(p);
    return p;
  };

  const addReply = (root: Post, parent: Post, author: SeedUser, text: string, createdAt: number): Post => {
    replyN += 1;
    const p: Post = {
      id: opaqueId('bzr', replyN), rootId: root.id, parentId: parent.id, depth: parent.depth + 1, authorId: author.id, universityId: root.universityId,
      text, promptId: null, status: 'active', createdAt: Math.max(createdAt, parent.createdAt + MIN, root.createdAt + MIN),
    };
    posts.push(p);
    return p;
  };

  const between = (from: number, to: number): number => Math.round(from + kit.rng() * Math.max(MIN, to - from));

  /* ───────────── Maya's three threads (FINAL ids) ───────────── */
  const t1At = kit.ago({ d: 2, h: 5 });
  const maya1 = addRoot({ id: 'buzz_0001', author: maya, text: HERO_ROOTS[4]!, createdAt: t1At });
  const maya2 = addRoot({ id: 'buzz_0002', author: maya, text: 'Best late-night study spot?', createdAt: kit.ago({ h: 20 }) });
  polls.push({ postId: maya2.id, closesAt: kit.now + 3 * DAY, options: POLLS[0]!.options });
  const maya3 = addRoot({ id: 'buzz_0003', author: maya, text: 'Small win: went to office hours for the first time and the professor remembered my name.', createdAt: kit.ago({ d: 6, h: 2 }) });
  threadN = 3;

  // 14 replies on buzz_0001 (two nested), from 12 distinct hero students
  const t1Repliers = kit.sample(hero, 12);
  let t1Cursor = t1At + 20 * MIN;
  const t1Replies: Post[] = [];
  MAYA_THREAD_REPLIES.forEach((text, i) => {
    const author = t1Repliers[i % t1Repliers.length]!;
    t1Cursor = between(t1Cursor, t1Cursor + 3 * HOUR);
    const parent = i === 10 ? t1Replies[9]! : i === 12 ? t1Replies[2]! : maya1;
    t1Replies.push(addReply(maya1, parent, author, text, t1Cursor));
  });
  // Maya replies in two other people's threads later (My buzzes → Replies)

  /* ───────────── fixtures (authors = background users, never personas) ───────────── */
  const fixtureAuthors = kit.sample(bgHero, 2);
  addRoot({
    id: 'buzz_0101', author: fixtureAuthors[0]!, status: 'hidden', createdAt: kit.ago({ d: 1, h: 9 }),
    text: 'The RA on the 7th floor of Jester West, Kyle, is a power-tripping loser who writes people up for breathing. Avoid his floor and make his life miserable.',
  });
  addRoot({
    id: 'buzz_0102', author: fixtureAuthors[1]!, status: 'active', createdAt: kit.ago({ h: 14 }),
    text: 'Don\'t come to the GDC tomorrow. Trust me on this one.',
  });

  /* ───────────── the rest of the world ───────────── */
  const plan: { uni: Id; n: number }[] = full
    ? [{ uni: UNI.utexas, n: 110 - 5 }, { uni: UNI.umich, n: 25 }, { uni: UNI.stanford, n: 22 }, { uni: UNI.nyu, n: 15 }, { uni: UNI.utoronto, n: 3 }, { uni: UNI.oxford, n: 3 }, { uni: UNI.nus, n: 2 }]
    : [{ uni: UNI.utexas, n: 20 - 5 }, { uni: UNI.umich, n: 4 }, { uni: UNI.stanford, n: 3 }, { uni: UNI.nyu, n: 3 }];
  const totalPlanned = plan.reduce((n, p) => n + p.n, 0);

  const heroPool = kit.sample(HERO_ROOTS.filter((t) => t !== HERO_ROOTS[4]), HERO_ROOTS.length);
  const genericPool = kit.sample(GENERIC_ROOTS, GENERIC_ROOTS.length);
  let heroIdx = 0;
  let genericIdx = 0;
  const usedTexts = new Set<string>([maya1.text, maya3.text]);
  const takeText = (isHero: boolean): string => {
    if (isHero && heroIdx < heroPool.length) return heroPool[heroIdx++]!;
    if (genericIdx < genericPool.length) return genericPool[genericIdx++]!;
    // templated overflow (deterministic)
    for (let guard = 0; guard < 50; guard++) {
      const t = `Dining hall verdict, ${kit.pick(CAMPUS_WORDS)} edition: it ${kit.pick(VERDICTS)}. Discuss.`;
      if (!usedTexts.has(t)) return t;
    }
    return `Overheard near ${kit.pick(CAMPUS_WORDS)}: "${kit.pick(OVERHEARD)}"`;
  };

  const roots: Post[] = [maya1, maya3];
  let i = 0;
  const pollBudget = full ? POLLS.length - 1 : 3; // + Maya's = 12 / 4
  const pollEvery = Math.max(2, Math.floor(totalPlanned / (pollBudget + 1)));
  let pollsMade = 0;
  const pollQueue = POLLS.slice(1);
  for (const { uni, n } of plan) {
    const authors = byCampus(uni);
    if (authors.length === 0) continue;
    const isHero = uni === UNI.utexas;
    for (let k = 0; k < n; k++) {
      const createdAt = kit.spread(i, totalPlanned);
      i += 1;
      const author = kit.pick(authors);
      const wantPoll = pollsMade < pollBudget && pollQueue.length > 0 && i % pollEvery === 1;
      if (wantPoll) {
        const pollIdx = pollQueue.findIndex((p) => !p.hero || isHero);
        const poll = pollIdx >= 0 ? pollQueue.splice(pollIdx, 1)[0] : undefined;
        if (poll) {
          const root = addRoot({ author, text: poll.text, createdAt });
          const days = kit.pick([1, 3, 7] as const);
          polls.push({ postId: root.id, closesAt: createdAt + days * DAY, options: poll.options });
          roots.push(root);
          pollsMade += 1;
          continue;
        }
      }
      let text = takeText(isHero);
      while (usedTexts.has(text)) text = takeText(isHero);
      usedTexts.add(text);
      const promptId = kit.chance(0.08) ? kit.id('bzp', kit.int(1, PROMPTS.length)) : null;
      roots.push(addRoot({ author, text, createdAt, promptId }));
    }
  }

  /* ───────────── replies (power-law-ish: a few busy threads, many quiet) ───────────── */
  const replyTarget = full ? 900 - MAYA_THREAD_REPLIES.length : 120 - MAYA_THREAD_REPLIES.length;
  const others = roots.filter((r) => r.id !== maya1.id);
  // heat weights: rank-based power law
  const ranked = kit.sample(others, others.length);
  const weights = ranked.map((_, idx) => 1 / Math.pow(idx + 1, 0.8));
  const wSum = weights.reduce((a, b) => a + b, 0);
  // Maya replies in three other hero threads (My buzzes → Replies, karma). Chosen up front — a pure filter, no rng draw — so
  // each of those threads can keep one of its own lines back for her.
  const heroThreads = ranked.filter((r) => r.universityId === UNI.utexas && r.authorId !== maya.id).slice(0, 3);
  const mayaThreads = new Set<Id>(heroThreads.map((r) => r.id));

  /**
   * Per-thread reply text (polish P4). Each thread draws, without repeats, from its own `TALK` lines, then its `FAMILY`
   * lines, mixed with tone-matched `FILLER` (top level) / `NESTED` (under a reply).
   * Line order is a per-thread sha256 shuffle and every call consumes exactly ONE `kit.rng()` draw — the same as the
   * `kit.pick` it replaced — so authors, nesting, timestamps and every vote downstream are unchanged; only the words differ.
   */
  const talkOf = (text: string): Talk => {
    const hits = TALK.filter((t) => t.on.some((k) => text.includes(k)));
    if (hits.length !== 1) throw new Error(`buzz seed: ${hits.length} reply sets match the root "${text}" (need exactly 1)`);
    return hits[0]!;
  };
  for (const root of others) talkOf(root.text); // fail fast: a new root text needs its own TALK entry
  const shuffled = (key: string, list: readonly string[]): string[] =>
    list
      .map((text, n) => ({ text, h: crypto.createHash('sha256').update(`universe-seed:${key}:${n}`).digest('hex') }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      .map((x) => x.text);
  interface ThreadTalk { talk: Talk; round: number; said: number; mine: string[]; say: string[]; fam: string[]; filler: string[]; nested: string[] }
  const threadTalks = new Map<Id, ThreadTalk>();
  const deal = (root: Post, t: ThreadTalk): void => {
    const key = `${root.id}:${t.round}`;
    t.say = shuffled(`${key}:say`, t.talk.say);
    t.fam = shuffled(`${key}:fam`, FAMILY[t.talk.fam]);
    t.filler = shuffled(`${key}:filler`, FILLER[t.talk.tone]);
    t.nested = shuffled(`${key}:nested`, NESTED[t.talk.tone]);
  };
  const threadTalk = (root: Post): ThreadTalk => {
    let t = threadTalks.get(root.id);
    if (!t) {
      t = { talk: talkOf(root.text), round: 0, said: 0, mine: [], say: [], fam: [], filler: [], nested: [] };
      deal(root, t);
      if (mayaThreads.has(root.id) && t.say.length > 1) t.mine.push(t.say.pop()!);
      threadTalks.set(root.id, t);
    }
    return t;
  };
  /** Topical lines come first (the thread page shows the oldest 20 replies), reactions are mixed in and take over the tail. */
  const replyText = (root: Post, parent: Post, roll: number, mine = false): string => {
    const t = threadTalk(root);
    const lean = (roll * 997) % 1; // a second, independent-enough uniform from the same draw
    const order = mine
      ? [t.mine, t.say, t.fam, t.filler]
      : parent.id !== root.id
        ? roll < 0.5 ? [t.nested, t.say, t.fam, t.filler] : [t.say, t.fam, t.nested, t.filler]
        : t.said < 2 || lean < 0.7 ? [t.say, t.fam, t.filler] : [t.filler, t.say, t.fam];
    for (const q of order) {
      const text = q.shift();
      if (text !== undefined) {
        t.said += 1;
        return text;
      }
    }
    // a very busy thread has used every line once: deal a fresh round of its own lines rather than borrow another thread's
    t.round += 1;
    deal(root, t);
    return replyText(root, parent, roll, mine);
  };

  let made = 0;
  const repliesOf = new Map<Id, Post[]>();
  ranked.forEach((root, idx) => {
    const share = Math.round((weights[idx]! / wSum) * replyTarget);
    const count = Math.min(60, share);
    const campusAuthors = byCampus(root.universityId).filter((u) => u.id !== root.authorId);
    if (campusAuthors.length === 0) return;
    const list: Post[] = [];
    let cursor = root.createdAt + 5 * MIN;
    for (let r = 0; r < count && made < replyTarget; r++) {
      const author = kit.pick(campusAuthors);
      let parent: Post = root;
      if (list.length > 0 && kit.chance(0.35)) {
        const candidates = list.filter((p) => p.depth <= 2);
        if (candidates.length > 0) parent = kit.pick(candidates);
      }
      cursor = between(Math.max(cursor, parent.createdAt + MIN), Math.min(kit.now - MIN, Math.max(cursor, parent.createdAt) + 6 * HOUR));
      const text = replyText(root, parent, kit.rng());
      list.push(addReply(root, parent, author, text, cursor));
      made += 1;
    }
    repliesOf.set(root.id, list);
  });
  for (const root of heroThreads) {
    const at = between(root.createdAt + 10 * MIN, Math.min(kit.now - MIN, root.createdAt + 8 * HOUR));
    addReply(root, root, maya, replyText(root, root, kit.rng(), true), at);
  }

  /* ───────────── votes: power-law scores; 2 auto-hidden, 1 collapsed; Maya's karma > 0 ───────────── */
  const isNewAccount = (u: SeedUser): boolean => kit.now - u.createdAt < 24 * HOUR;
  const voterPool = students;
  const voteTarget = full ? 4500 : 400;
  const rootRank = kit.sample(roots, roots.length);
  const heat = new Map<Id, number>();
  rootRank.forEach((r, idx) => heat.set(r.id, 1 / Math.pow(idx + 1, 0.75)));
  const heatSum = [...heat.values()].reduce((a, b) => a + b, 0);
  const allVotable = posts.filter((p) => p.id !== 'buzz_0101' && p.id !== 'buzz_0102');

  const castVotes = (post: Post, n: number, upRatio: number): void => {
    const voters = kit.sample(voterPool.filter((u) => u.id !== post.authorId), Math.min(n, voterPool.length - 1));
    for (const v of voters) {
      votes.push({
        postId: post.id, userId: v.id, value: kit.chance(upRatio) ? 1 : -1, eligible: isNewAccount(v) ? 0 : 1,
        createdAt: between(post.createdAt + MIN, Math.max(post.createdAt + 2 * MIN, kit.now - MIN)),
      });
    }
  };

  // roots: three or four at 150–400 (full) / 40–80 (lite), most 3–30, several at 0
  rootRank.forEach((root, idx) => {
    let n: number;
    if (idx < 4) n = full ? kit.int(150, 400) : kit.int(25, 50);
    else if (idx < 12) n = full ? kit.int(30, 90) : kit.int(8, 20);
    else if (kit.chance(0.08)) n = 0;
    else n = Math.max(0, Math.round(((heat.get(root.id)! / heatSum) * voteTarget) * 0.3) + kit.int(2, full ? 14 : 8));
    n = Math.min(n, voterPool.length - 1);
    castVotes(root, n, kit.chance(0.15) ? 0.62 : 0.9);
  });
  // Maya's threads: clearly positive (karma > 0); buzz_0001 passes 25 upvotes (milestone notification is read)
  const mayaPosts = new Set<Id>([maya1.id, maya2.id, maya3.id]);
  for (let k = votes.length - 1; k >= 0; k--) if (mayaPosts.has(votes[k]!.postId)) votes.splice(k, 1);
  castVotes(maya1, Math.min(34, voterPool.length - 1), 0.95);
  castVotes(maya2, Math.min(9, voterPool.length - 1), 0.9);
  castVotes(maya3, Math.min(17, voterPool.length - 1), 0.97);
  // replies: light
  for (const p of allVotable) {
    if (p.rootId === null) continue;
    if (kit.chance(0.25)) castVotes(p, kit.int(1, full ? 6 : 4), 0.85);
  }
  // 2 auto-hidden roots (score ≤ −10, ≥ 12 eligible) + 1 collapsed (≤ −5, ≥ 8), all by background users on the hero campus
  const bgRoots = roots.filter((r) => r.authorId.startsWith('bg_') && r.universityId === UNI.utexas && r.id !== maya1.id);
  const special = kit.sample(bgRoots, 3);
  const forceVotes = (post: Post, up: number, down: number): void => {
    for (let k = votes.length - 1; k >= 0; k--) if (votes[k]!.postId === post.id) votes.splice(k, 1);
    const voters = kit.sample(voterPool.filter((u) => u.id !== post.authorId && !isNewAccount(u)), up + down);
    voters.forEach((v, k) => votes.push({ postId: post.id, userId: v.id, value: k < up ? 1 : -1, eligible: 1, createdAt: between(post.createdAt + MIN, kit.now - MIN) }));
  };
  if (special[0]) {
    forceVotes(special[0], 2, 15);
    special[0].status = 'hidden';
  }
  if (special[1]) {
    forceVotes(special[1], 1, 13);
    special[1].status = 'hidden';
  }
  if (special[2]) forceVotes(special[2], 2, 9); // collapsed: score −7, 11 eligible → stays active, folded
  // the fixture buzz_0101 (hidden by staff, not by score) gets a few honest votes
  const fx = posts.find((p) => p.id === 'buzz_0101')!;
  castVotes(fx, 6, 0.3);
  castVotes(posts.find((p) => p.id === 'buzz_0102')!, 5, 0.4);

  /* ───────────── text hygiene (firewall): no seeded handle / display name inside any Buzz text ───────────── */
  const identities = kit.users.all.flatMap((u) => [u.handle, u.displayName]).filter((s) => s.length >= 3).map((s) => s.toLowerCase());
  const texts = [...posts.map((p) => p.text), ...polls.flatMap((p) => p.options), ...PROMPTS];
  for (const t of texts) {
    const lower = t.toLowerCase();
    const hit = identities.find((s) => lower.includes(s));
    if (hit) throw new Error(`buzz seed: text contains seeded identity "${hit}": ${t}`);
  }

  /* ───────────── write ───────────── */
  // Campus and Global are separate feeds. Other campuses' threads went to Global (that is how the hero campus sees them);
  // about a quarter of the hero campus's own threads did too. A digest of the id decides (no rng draw, stable across
  // runs); the SPEC-final ids (Maya's threads, fixtures) stay on campus.
  const FINAL_IDS = new Set<Id>(['buzz_0001', 'buzz_0002', 'buzz_0003', 'buzz_0101', 'buzz_0102']);
  const scopeOf = (p: Post): 'campus' | 'global' => {
    if (p.rootId !== null || FINAL_IDS.has(p.id)) return 'campus';
    if (p.universityId !== UNI.utexas) return 'global';
    return crypto.createHash('sha256').update(`universe-seed:scope:${p.id}`).digest()[0]! % 4 === 0 ? 'global' : 'campus';
  };
  const insPost = db.prepare(
    `INSERT INTO buzz_posts (id, root_id, parent_id, depth, author_id, university_id, text, scope, prompt_id, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const p of posts) insPost.run(p.id, p.rootId, p.parentId, p.depth, p.authorId, p.universityId, p.text, scopeOf(p), p.promptId, p.status, p.createdAt);

  const insVote = db.prepare('INSERT OR IGNORE INTO buzz_votes (post_id, user_id, value, eligible, created_at) VALUES (?,?,?,?,?)');
  for (const v of votes) insVote.run(v.postId, v.userId, v.value, v.eligible, v.createdAt);

  const insPoll = db.prepare('INSERT INTO buzz_polls (post_id, closes_at, closed_notified) VALUES (?,?,?)');
  const insOpt = db.prepare('INSERT INTO buzz_poll_options (id, post_id, idx, text, vote_count) VALUES (?,?,?,?,0)');
  const insPollVote = db.prepare('INSERT OR IGNORE INTO buzz_poll_votes (post_id, user_id, option_id, created_at) VALUES (?,?,?,?)');
  let optN = 0;
  for (const poll of polls) {
    const root = posts.find((p) => p.id === poll.postId)!;
    const closed = poll.closesAt <= kit.now;
    insPoll.run(poll.postId, poll.closesAt, closed ? 1 : 0); // every already-closed poll is closed_notified = 1 (§7.5)
    const optionIds = poll.options.map(() => kit.id('bzo', ++optN));
    poll.options.forEach((text, idx) => insOpt.run(optionIds[idx], poll.postId, idx, text));
    const nVoters = Math.min(kit.int(full ? 12 : 5, full ? 60 : 14), voterPool.length - 1);
    const voters = kit.sample(voterPool.filter((u) => u.id !== root.authorId), nVoters);
    const weightsOpt = optionIds.map(() => 0.3 + kit.rng());
    const wTotal = weightsOpt.reduce((a, b) => a + b, 0);
    for (const v of voters) {
      let r = kit.rng() * wTotal;
      let choice = optionIds[0]!;
      for (let k = 0; k < optionIds.length; k++) {
        r -= weightsOpt[k]!;
        if (r <= 0) {
          choice = optionIds[k]!;
          break;
        }
      }
      insPollVote.run(poll.postId, v.id, choice, between(root.createdAt + MIN, Math.min(poll.closesAt, kit.now) - MIN));
    }
  }

  /* ───────────── counters = rows ───────────── */
  db.exec(`
    UPDATE buzz_poll_options SET vote_count = (SELECT COUNT(*) FROM buzz_poll_votes v WHERE v.option_id = buzz_poll_options.id);
    UPDATE buzz_posts SET
      upvotes        = (SELECT COUNT(*) FROM buzz_votes v WHERE v.post_id = buzz_posts.id AND v.value = 1),
      downvotes      = (SELECT COUNT(*) FROM buzz_votes v WHERE v.post_id = buzz_posts.id AND v.value = -1),
      eligible_votes = (SELECT COUNT(*) FROM buzz_votes v WHERE v.post_id = buzz_posts.id AND v.eligible = 1),
      eligible_score = (SELECT COALESCE(SUM(v.value), 0) FROM buzz_votes v WHERE v.post_id = buzz_posts.id AND v.eligible = 1);
    UPDATE buzz_posts SET score = upvotes - downvotes;
    UPDATE buzz_posts SET reply_count = (SELECT COUNT(*) FROM buzz_posts r WHERE r.root_id = buzz_posts.id AND r.status = 'active') WHERE root_id IS NULL;
  `);

  // milestones already passed by seeded posts (so a later vote never re-announces them)
  const insMilestone = db.prepare('INSERT OR IGNORE INTO buzz_milestones (post_id, milestone, day) VALUES (?,?,?)');
  const rowsUp = db.prepare('SELECT id, upvotes, created_at FROM buzz_posts WHERE upvotes >= 10').all() as { id: Id; upvotes: number; created_at: number }[];
  for (const r of rowsUp) for (const m of [10, 25, 50, 100, 250]) if (r.upvotes >= m) insMilestone.run(r.id, m, Math.floor(r.created_at / DAY));

  /* ───────────── Maya's notifications: buzz.reply (unread) + buzz.milestone (read) ───────────── */
  const lastT1 = t1Replies[t1Replies.length - 1]!;
  kit.notifyAnonymous({
    userId: maya.id, type: 'buzz.reply', threadId: maya1.id, href: `/buzz/${maya1.id}`, data: { snippet: maya1.text.slice(0, 80) },
    createdAt: lastT1.createdAt, read: false,
  });
  kit.notifyAnonymous({
    userId: maya.id, type: 'buzz.milestone', threadId: maya1.id, href: `/buzz/${maya1.id}`, data: { upvotes: 25 },
    createdAt: t1At + 20 * HOUR, read: true,
  });

  // analytics: a light trail of anonymous feed views / posts (stored with user_id NULL)
  for (const root of roots.slice(0, full ? 60 : 12)) {
    kit.track('buzz_post', kit.users.get(root.authorId), { hasPoll: polls.some((p) => p.postId === root.id) }, root.createdAt);
  }
}
