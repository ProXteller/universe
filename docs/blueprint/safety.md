> **SUPERSEDED WHERE THEY DISAGREE:** `docs/SPEC.md` (esp. §2.3 deltas and rule R7 "no dead controls") and `docs/DECISIONS.md` override this document. Never build a control, route or endpoint from this file that SPEC does not declare.

# UniVerse — Trust & Safety Blueprint (binding requirements)

> Authority: `docs/CONSTITUTION.md` wins over this file; this file wins over slice-level choices on any
> safety, moderation, or anonymity question. Keywords MUST / MUST NOT / SHOULD / MAY are used in the
> RFC 2119 sense. File placement of code follows `docs/SPEC.md`; the *contracts and behaviors* below are fixed.

Contents: 1 Community Guidelines · 2 Moderation pipeline on write · 3 Community signals · 4 Sanctions ladder ·
5 Buzz anonymity threat model · 6 Admin/moderator tooling · 7 Safety on public surfaces · 8 Env vars, required
tests, known gaps.

Design principles (apply everywhere):

- **P1 Rules stand alone.** The deterministic rule engine is the product. The AI second pass is an optional escalator.
- **P2 No shadow states.** An author can always see the true status of their own content and account. We never shadowban.
- **P3 Least identity.** Every staff screen, log line, event, and payload carries the minimum identity needed. For Buzz that is *none* unless an admin unmasks with a written reason.
- **P4 Differential safety.** A feature MUST NOT let a user learn who wrote a buzz by comparing two views (before/after a block, two accounts, two timestamps). When in doubt, the public graph has zero effect on Buzz.
- **P5 Support before punishment** for self-harm; **zero tolerance** for credible threats, sexualization of minors, and doxxing.

---

## 1. Community Guidelines (final user-facing text)

`GUIDELINES_VERSION = '2026-09-01'`. Acceptance is stored per user as `(user_id, version, accepted_at)`.
Onboarding shows the short version + "I agree". Buzz has its own gate (section 1.1 text + "Got it") that MUST
be passed before the first Buzz read or write, and again whenever the version changes. The full text below is
rendered on the Community Guidelines page (admin slice) and each block/removal message deep-links to its
anchor (`#harassment`, `#threats`, `#hate`, `#sexual`, `#drugs`, `#self-harm`, `#private-info`,
`#impersonation`, `#spam`, `#academic`). The text between the rulers is final copy.

---

### UniVerse Community Guidelines

**The short version:** be the person you'd want in your group project. Say what you think, not who to hurt.
Disagree with ideas, leave people alone. If someone is in danger, tell us.

These rules apply everywhere on UniVerse: Reels, Buzz, Orbit, Messages, Roommates, Marketplace, events, and
your profile.

#### 1.1 Buzz is anonymous to other students — not to the safety team {#buzz-anonymity}

**What other students see.** A random alias like "Anon Comet". You get a new alias in every thread, so nobody
can connect your buzzes to each other, to your profile, or to you. Buzz never shows up on your profile, in
search, or in anyone's Orbit.

**What we keep.** Behind the scenes, every buzz is linked to the account that posted it. We keep that link
for one reason: safety.

**Who can see it.**
- Moderators review reported buzzes **without** seeing who wrote them.
- A very small number of admins can reveal the account behind a buzz, and only for something serious: a
  credible threat, a risk to someone's life, child safety, severe or repeated harassment, or a valid legal
  request. They must write down why. Every reveal is permanently logged and reviewed.

**What that means for you.**
- Anonymous is not consequence-free. Breaking the rules on Buzz counts against your whole account, and you can
  be muted, suspended, or banned for it.
- If someone's safety is at risk, or the law requires it, we may share information with emergency services,
  campus safety, or law enforcement.
- We never show your Buzz identity to other students or advertisers. We don't hand it to a university, an
  employer, or anyone else just because they ask.
- Don't try to unmask other people. Guessing out loud who wrote a buzz is treated as doxxing.

#### 1.2 Harassment & bullying {#harassment}

Everyone here is a real student on a real campus.

- **Not OK:** targeting a person or small group with insults, pile-ons, rumors, or humiliation; rating or
  ranking people's looks or bodies; posting about someone again and again after they've asked you to stop;
  encouraging others to go after someone; telling anyone to hurt or kill themselves.
- **OK:** criticizing ideas, classes, policies, teams, and public decisions, even sharply. Venting about a
  situation without pointing at a person.

#### 1.3 Threats & violence {#threats}

- **Not OK:** threatening to hurt a person, a group, or a place, including "jokes" about attacks on campus.
  Praising or promoting attacks. Instructions for weapons or explosives.
- **OK:** figures of speech ("that exam killed me"), news, and discussion of violence as a topic.

We treat threats as real. Credible threats are escalated to emergency services and campus safety, and the
account is suspended immediately. **If you see one, report it, and call your local emergency number if danger
is immediate.**

#### 1.4 Hate {#hate}

- **Not OK:** slurs, dehumanizing language, or calls for exclusion or violence against people because of race,
  ethnicity, nationality, religion, caste, gender, gender identity, sexual orientation, disability, serious
  illness, or immigration status. Hate symbols. Denying well-documented atrocities.
- **OK:** talking about identity, faith, politics, and your own experience, including hard conversations held
  in good faith. Quoting a slur to report or discuss it is reviewed in context.

#### 1.5 Sexual content & minors {#sexual}

- **Not OK:** pornography or explicit sexual content; unsolicited sexual messages or images; sharing or
  threatening to share someone's intimate images; selling sexual content or services; sexual comments about
  identifiable people.
- **Zero tolerance:** anything that sexualizes someone under 18. We remove it, ban the account, preserve the
  evidence, and report it to the authorities as the law requires. Some students are under 18. Act like it.
- **OK:** conversations about dating, relationships, consent, and sexual health.

#### 1.6 Drugs & illegal sales {#drugs}

- **Not OK:** buying, selling, trading, or sourcing drugs, prescription medication, vapes or alcohol for
  underage students, weapons, fake IDs, or stolen goods, anywhere on UniVerse, including Messages. Asking
  "who's got a plug" counts.
- **OK:** talking about drug policy, harm reduction, recovery, and your own experiences.

#### 1.7 Self-harm & suicide {#self-harm}

If you're struggling, you can say so here. You won't be punished for it. When a post sounds like someone is
going through it, we show support options and a trained member of our safety team may take a look to make
sure you're OK.

- **Not OK:** encouraging anyone to hurt themselves, sharing methods, or mocking someone who is struggling.
- **OK:** saying you're not OK. Checking in on each other. Sharing what helped you.

**Right now, if you need it:** in the US and Canada call or text **988**. In the UK and Ireland call
Samaritans at **116 123**. In Australia call Lifeline at **13 11 14**. In India call Tele-MANAS at **14416**.
Anywhere else, find a free local line at **findahelpline.com**. Your campus counseling center is there for
exactly this. If you or someone else is in immediate danger, call your local emergency number.

Worried about someone's buzz? Report it with "I'm worried about this person". It goes to the front of our queue.

#### 1.8 Private info & doxxing {#private-info}

- **Not OK:** posting anyone's phone number, email, address, room number, class schedule, license plate, ID
  numbers, private photos, or screenshots of private chats without consent. Naming a real person alongside an
  accusation on Buzz. Guessing or revealing who is behind an anonymous buzz.
- **OK:** sharing **your own** contact details in a private message. Naming public figures and officials in
  their public role. If something serious happened to you, report it to us, to campus services, or to the
  police. An anonymous call-out can't be verified and can hurt the wrong person.

#### 1.9 Impersonation {#impersonation}

- **Not OK:** pretending to be another student, a professor, a university office, a club you don't run, or
  UniVerse staff. Misleading handles, names, or photos. On Buzz, claiming to be a specific real person.
- **OK:** parody and fan accounts that say so clearly in the name and bio. UniVerse staff never post
  anonymously on Buzz and will never ask for your login code.

#### 1.10 Spam & scams {#spam}

- **Not OK:** repetitive or mass posts and messages; fake listings; asking for deposits on things that don't
  exist; phishing for login codes; pyramid schemes and "easy money" offers; fake giveaways; buying or selling
  accounts; vote or report manipulation.
- **OK:** promoting your club, event, or small business from your public profile, in moderation.

#### 1.11 Academic dishonesty {#academic}

- **Not OK:** buying, selling, or requesting exam answers, test banks, or graded work; paying or offering to
  take a test or write an assignment for someone; sharing answers while an exam is live.
- **OK:** study groups, tutoring, sharing your own notes, talking about how hard the midterm was.

#### 1.12 Messages, Marketplace, and Roommates

- Messages are private between the people in them. Automated safety checks run on all messages, and messages
  you report are reviewed by our safety team.
- Keep deals in the app, meet in public places on campus, and never pay a deposit for something you haven't
  seen. Full tips live on every listing.
- Listings must be real, legal, and yours to offer. Roommate listings can't exclude people based on the
  characteristics in section 1.4.

#### 1.13 What happens when rules are broken {#enforcement}

Most first mistakes get a **warning**. After that: **content removal**, a **timed mute** (you can read but not
post), **suspension**, and finally a **permanent ban**. Serious harm skips the ladder. We always tell you what
was actioned and which rule it broke, and you can **appeal once** within 14 days. Appeals are reviewed by a
different person.

#### 1.14 Reporting & blocking

Use **Report** on anything that breaks these rules. Reports are confidential; the person you report never
learns it was you. Use **Block** on any profile to cut contact completely. Abusing reports to silence people
is itself a violation.

*We update these guidelines as the community grows and will ask you to review important changes.*

---

## 2. Moderation pipeline on write

### 2.0 Overview

```
handler ── moderateText(text, ctx) ──► normalize ─► detectors (terms · combos · PII · spam) ─► policy(surface, account) ─► ModerationResult
   │ action = block ─► 422 content_blocked (nothing persisted)      ─┐
   │ action = flag  ─► persist with status 'held' or 'active'        ├─► commitModeration(result, target)
   │ action = allow ─► persist with status 'active'                 ─┘      ├─ moderation_events row (always for flag/block; never for plain allow)
   ▼                                                                         ├─ mod_queue item (flag, or block with escalate = true)
 response (+ support resources when result.support != null)                  └─ enqueue optional AI second pass (only if env key present)
```

- `moderateText` is **synchronous, pure, deterministic, offline**, and MUST NOT throw. Budget: < 5 ms for 5,000 chars.
- Every UGC write in every slice MUST call it once per text field (title and body are separate calls with the
  same `surface`, different `field`). The strictest result wins for the write.
- Term lists and rule packs live in server-only data files. They MUST NOT be placed in `shared/`, shipped in the
  client bundle, echoed in API responses, or logged with the matched term outside `moderation_events`.
- Text length caps are enforced by zod before moderation (Buzz 500, reply 500, post 2,000, comment 500,
  message 2,000, listing title 80 / body 1,500, bio 160, report note 500).

### 2.1 Canonical content status (all UGC tables)

Every UGC table MUST have `status TEXT NOT NULL DEFAULT 'active'` with exactly these values:

| status | meaning | visible to others | visible to author |
|---|---|---|---|
| `active` | normal | yes | yes |
| `held` | pre-publication review (rule `flag` + `visibility: 'held'`) | no | yes, with chip "In review" |
| `hidden` | auto-hidden by community signals or AI second pass, awaiting a human | no (thread placeholders stay, see 3.2) | yes, with chip "Hidden pending review" |
| `removed` | removed by staff | placeholder "[removed by moderators]" where a thread needs it, else gone | yes, with reason and appeal link |
| `deleted` | deleted by author | placeholder "[deleted]" where a thread needs it, else gone | no |

Rows are never hard-deleted while a report, sanction, or appeal references them (minimum retention 180 days).

### 2.2 Text normalization

`normalize(text)` produces four **views**. Detectors declare which view they read. Offsets in `matches[].span`
always refer to `original` (the normalizer keeps an index map).

| step | operation | detail |
|---|---|---|
| N1 | Unicode NFKC | folds fullwidth, math-alphanumeric, enclosed and superscript letters to ASCII |
| N2 | strip invisibles | remove U+00AD, U+034F, U+061C, U+115F–1160, U+17B4–17B5, U+180B–180E, U+200B–200F, U+202A–202E, U+2060–2064, U+206A–206F, U+FE00–FE0F, U+FEFF, U+E0100–E01EF; count removed → `signals.invisibleChars` |
| N3 | strip diacritics | NFD, remove `\p{M}`, recompose (kills Zalgo and accent evasion) |
| N4 | lowercase | `toLowerCase()` (locale-independent) |
| N5 | homoglyph fold | Cyrillic/Greek/Armenian look-alikes → Latin via a static map (minimum: а→a е→e о→o р→p с→c х→x у→y і→i ј→j ѕ→s ԁ→d һ→h ո→n ս→u α→a ε→e ι→i κ→k ν→v ο→o ρ→p τ→t υ→u χ→x). Only applied inside tokens that already contain Latin letters or are ≤ 12 chars of mixed script; pure non-Latin words are left alone (multilingual students are not evaders). Count folds → `signals.homoglyphs` |
| N6 | whitespace collapse | all Unicode whitespace runs → single space, trim |
| → | **`canonical`** = N1–N6 | digits and punctuation preserved. **PII detectors read this view.** |
| N7 | leet fold | `0→o 1→i 3→e 4→a 5→s 7→t 8→b 9→g @→a $→s !→i +→t (→c |→i €→e £→l ¥→y`. Applied only to tokens containing at least one letter (so phone numbers and prices survive). A second candidate with `1→l` is also generated for term matching |
| N8 | repeat collapse | runs of ≥ 3 identical chars → 2 (`fuuuuck`→`fuuck`); term matcher also tries the 1-char collapse |
| → | **`folded`** = N1–N8 | word-boundary term and combo matching reads this view |
| N9 | separator squash | sequences of ≥ 3 single-character tokens split by space or `. - _ * / \ ,` are joined (`k i l l`, `k.i.l.l`→`kill`) |
| → | **`spaced`** = N1–N9 | catches spaced-out evasion with word boundaries intact |
| N10 | full squash | remove every non-alphanumeric char |
| → | **`squashed`** = N1–N10 | read **only** by the `severe` term list (slurs, CSAM terms, "kys" family) with an allow-list guard against the Scunthorpe problem (`assassin`, `classic`, `cockpit`, `grape`, `therapist`, place names…) |

Evasion signal: `signals.evasion = invisibleChars ≥ 3 || homoglyphs ≥ 2 || N9 joined ≥ 1 sequence`. Evasion alone
never blocks or flags. If any category matched **and** `evasion` is true, that match's severity is raised by one
level (cap `critical`), because deliberate obfuscation shows intent.

Emoji tokens: a small map converts signal emoji to tokens for combo rules only
(`🔫→[gun] 🔪→[knife] 💣→[bomb] 💊→[pill] 🍃🌿→[weed] ❄️⛄→[snow] 🍄→[shroom] 🔌→[plug] 🍆🍑💦→[sexual]`).
An emoji alone never triggers anything.

### 2.3 Detector kinds

1. **Term** — list lookup with word boundaries on `folded` + `spaced` (or `squashed` for the severe list).
2. **Combo** — all of N slots must hit within a window of 12 tokens. This is how context is encoded, e.g.
   threat = `{first-person intent: "i will|i'm gonna|imma|about to|watch me|going to"}` + `{violence verb}` +
   `{target: you|named person|role|place: campus, library, dorm, lecture, class, school}`.
   Drug sale = `{offer/seek: selling|got|dm me for|hmu for|who has|plug|looking for}` + `{substance or [pill]/[weed]/[snow]}`.
3. **Guard** — a phrase list that cancels a combo/term match in the same sentence (hyperbole and idiom:
   "killing me", "kill for a", "killed it", "dead tired", "shoot my shot", "bomb exam", "drug policy",
   "harm reduction", "narcan"). Guards never cancel `critical` severe-list matches.
4. **Regex/PII** — section 2.6.
5. **Behavioral** — duplicates, link count, caps ratio, mention count (section 2.7).

Each rule is data: `{ id, category, subcode, severity, kind, view, surfaces?: ModerationSurface[], guards?: string[] }`.
Rule ids are stable strings (`thr.intent_target.v1`) so precision can be tracked per rule (section 6.7).

### 2.4 Category taxonomy

| category | subcodes (non-exhaustive, stable ids) |
|---|---|
| `threat_violence` | `threat_person`, `threat_place` (campus/mass-harm), `incitement`, `weapons_instructions`, `glorification` |
| `harassment_bullying` | `targeted_insult`, `pile_on_call`, `rate_people`, `sexual_remark_person`, `unwanted_contact`, `kys` (telling someone to self-harm) |
| `hate` | `slur`, `dehumanization`, `exclusion_call`, `hate_symbol`, `atrocity_denial`, `discriminatory_listing` |
| `sexual_minors` | `csam_term`, `minor_sexualization`, `grooming_pattern` |
| `sexual_explicit` | `explicit_text`, `solicitation`, `nude_trading`, `ncii_threat` (non-consensual intimate imagery), `sextortion` |
| `drugs_illegal_sales` | `drug_sale`, `drug_sourcing`, `rx_sale`, `alcohol_nicotine_minor`, `weapon_sale`, `fake_id`, `stolen_goods` |
| `self_harm` | `ideation` (first person), `method_instructions`, `encouragement` (routes to `harassment_bullying/kys` policy), `concern_other` |
| `pii_doxxing` | `phone`, `email`, `street_address`, `room_number`, `id_number`, `license_plate`, `social_handle_third_party`, `unmask_attempt` |
| `named_accusation` | `full_name_accusation`, `role_name_accusation` ("Prof. Lastname …") |
| `impersonation` | `staff_claim`, `real_person_claim`, `reserved_handle`, `official_claim` |
| `spam_scam` | `duplicate`, `link_flood`, `mention_flood`, `caps_flood`, `payment_scam`, `deposit_scam`, `code_phish`, `mlm`, `account_sale`, `off_platform_push` |
| `academic_dishonesty` | `exam_sale`, `contract_cheating`, `live_exam_answers`, `test_bank` |
| `profanity` | `general` — **always ALLOW**; only a signal (students swear) |

### 2.5 Severity and the outcome matrix

Severity: `none(0) · low(1) · medium(2) · high(3) · critical(4)`.

| severity | meaning | strike points if confirmed by staff |
|---|---|---|
| low | rude, borderline, low-risk spam | 1 |
| medium | clear violation, limited harm | 2 |
| high | targeted harm, PII exposure, illegal sales | 3 |
| critical | threat to life/safety, minors, sextortion | suspension-level, ladder skipped (section 4.3) |

Actions: **ALLOW**, **FLAG** (persist; `visibility` = `visible` or `held`; queue item created), **BLOCK** (422,
nothing persisted; when `escalate = true` a queue item containing the blocked text is still created so the
safety team can act on a threat or a person at risk).

Surface groups: **ANON** = `buzz`, `buzz_reply`, `buzz_poll` · **PUBLIC** = `orbit_post`, `comment`,
`reel_caption`, `event`, `profile`, `group_name` · **COMMERCE** = `market_listing`, `roommate_listing` ·
**PRIVATE** = `message`, `group_message` · **STAFF** = `report_note`, `appeal`.

| category / subcode | ANON | PUBLIC | COMMERCE | PRIVATE |
|---|---|---|---|---|
| threat_violence · threat_place, threat_person (critical/high) | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate |
| threat_violence · incitement, weapons_instructions | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate | BLOCK |
| threat_violence · glorification, ambiguous (medium) | FLAG held | FLAG visible | FLAG visible | ALLOW |
| harassment · kys | BLOCK | BLOCK | BLOCK | BLOCK |
| harassment · targeted_insult, pile_on_call, rate_people, sexual_remark_person (high) | BLOCK | BLOCK | BLOCK | ALLOW (reportable) |
| harassment · medium/low | FLAG visible | FLAG visible | FLAG visible | ALLOW |
| hate · slur, dehumanization, exclusion_call, hate_symbol | BLOCK | BLOCK | BLOCK | BLOCK (slur directed at "you"), else ALLOW |
| hate · atrocity_denial, quoted/reclaimed/ambiguous | FLAG held | FLAG visible | FLAG visible | ALLOW |
| hate · discriminatory_listing | n/a | n/a | BLOCK | n/a |
| sexual_minors · any | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate |
| sexual_explicit · ncii_threat, sextortion | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate | BLOCK + escalate |
| sexual_explicit · solicitation, nude_trading | BLOCK | BLOCK | BLOCK | FLAG* (no queue; banner) |
| sexual_explicit · explicit_text | FLAG held | BLOCK | BLOCK | ALLOW |
| drugs_illegal_sales · any sale/sourcing/fake_id/weapon_sale | BLOCK | BLOCK | BLOCK | BLOCK |
| drugs discussion without sale combo | ALLOW | ALLOW | FLAG visible | ALLOW |
| self_harm · ideation, concern_other | **ALLOW + support + priority FLAG visible** | same | same | ALLOW + support (no queue) |
| self_harm · method_instructions | BLOCK + support + escalate | same | same | BLOCK + support |
| pii_doxxing · phone, email, street_address, room_number, id_number, license_plate | BLOCK | BLOCK (`event`: street_address ALLOW; `profile`: email ALLOW) | BLOCK | ALLOW |
| pii_doxxing · unmask_attempt ("anon comet is <name>") | BLOCK | n/a | n/a | ALLOW |
| pii_doxxing · social_handle_third_party | FLAG held | ALLOW | ALLOW | ALLOW |
| named_accusation · any | **FLAG held** (high) / BLOCK when paired with a sexual or criminal allegation term | FLAG visible | n/a | ALLOW |
| impersonation · staff_claim | BLOCK | BLOCK | BLOCK | FLAG* (banner "UniVerse staff never ask for codes") |
| impersonation · reserved_handle (surface `handle`/`profile`) | n/a | BLOCK | n/a | n/a |
| impersonation · real_person_claim | FLAG held | FLAG visible | n/a | ALLOW |
| spam_scam · duplicate, link_flood, mention_flood | BLOCK | BLOCK | BLOCK | BLOCK (duplicate to ≥ 5 recipients) |
| spam_scam · payment_scam, deposit_scam, code_phish, off_platform_push | BLOCK | FLAG visible | FLAG held | FLAG* (deliver + safety banner to recipient) |
| spam_scam · mlm, account_sale | FLAG visible | FLAG visible | BLOCK | ALLOW |
| academic_dishonesty · exam_sale, test_bank, contract_cheating | FLAG held | FLAG visible | BLOCK | ALLOW |
| academic_dishonesty · live_exam_answers | FLAG held | FLAG visible | n/a | ALLOW |
| profanity | ALLOW | ALLOW (`profile`/`handle`/`group_name`: BLOCK severe list only) | ALLOW | ALLOW |

`FLAG*` in PRIVATE = **private flag**: the message is delivered, `result.recipientBanner` is set, a
`moderation_events` row is written, but **no queue item is created** and staff cannot read it unless a
participant reports the conversation. Private messages enter the staff queue only by (a) a participant's report
or (b) a `BLOCK + escalate` outcome, in which case only the single blocked message is attached.

STAFF surfaces (`report_note`, `appeal`) always resolve to ALLOW (people must be able to quote abuse); signals
are still recorded.

Account modifiers applied by the policy step:

- `ctx.accountAgeMs < 24h` ("brand new"): every FLAG `visible` on ANON becomes FLAG `held`; any URL on ANON,
  PUBLIC, or COMMERCE → BLOCK (`spam_scam/link_flood`, message M-LINK-NEW).
- `ctx.activeStrikePoints ≥ 5`: every FLAG `visible` becomes FLAG `held` on all non-private surfaces.
- `ctx.role` of `moderator|admin` gets no exemption.

### 2.6 PII detectors (read the `canonical` view; digits intact)

| id | detects | method (binding behavior, regexes are reference implementations) | false-positive guards |
|---|---|---|---|
| `pii.phone` | phone numbers | (a) strip everything but digits and leading `+` from candidate runs matched by `/(?:\+?\d[\s().\-–·]*){7,15}/`; accept when digit count is 10 (NANP: area code and exchange must not start with 0/1), 11 starting with `1`, or 8–15 with a leading `+`. (b) spelled/obfuscated digits: map `zero|oh|one|two|…|nine` and the leet letters `o→0, l/i→1` to digits inside a run of ≥ 7 digit-like tokens, then re-test (a) | reject when the run is a price (`$`, `usd`, `obo` adjacent), a year range, a course code (`[a-z]{2,4}\s?\d{3,4}`), a date/time, or a student-count; reject exactly 5- and 9-digit runs (ZIP, ZIP+4) |
| `pii.email` | email addresses | `/[a-z0-9._%+\-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9\-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z0-9\-]+)+/` and the TLD must be in a bundled TLD list | the ` at `/` dot ` spelled forms require **both** an at-form and a dot-form to be present |
| `pii.street_address` | street addresses | `/\b\d{1,5}[a-z]?\s+(?:[nsew]\.?\s+)?(?:[a-z0-9'.]+\s+){1,4}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|ter|terrace|pkwy|parkway|cir|circle|hwy|highway)\b\.?(?:\s*(?:apt|unit|suite|ste|#)\s*[a-z0-9\-]+)?/` | ordinal-only matches ("1st place", "2nd way") rejected; surface `event` exempt |
| `pii.room_number` | dorm/room locations | combo: `{dorm|hall|residence|room|rm|suite|floor|apt}` + `{\d{2,4}[a-z]?}` within 4 tokens **and** a second-/third-person reference (`he|she|they|her|his|their|lives|stays|find (him|her|them)`) within 12 tokens | first-person ("my room 204 is freezing") → ALLOW on PUBLIC, FLAG held on ANON |
| `pii.id_number` | SSN-like, student-ID-like | `/\b\d{3}[- ]\d{2}[- ]\d{4}\b/`; `{student id|sid|uid|id number|ssn}` + 6–10 digit run within 4 tokens | none |
| `pii.license_plate` | plates | `{plate|license|licence|tag}` + `/\b[a-z0-9]{2,4}[\s\-]?[a-z0-9]{2,4}\b/` containing at least one digit and one letter, within 4 tokens | none |
| `pii.full_name` | probable full names | `original` view: two or three consecutive capitalized tokens where the first is in the bundled given-name list (≥ 5,000 international given names) **or** is preceded by a title `prof|professor|dr|dean|coach|ra|ta|mr|ms|mrs|mx`; the last token is not in the stop-list (campus buildings, universities, cities, brands, teams, course names, public figures list) | result is a *signal* only; a name by itself is ALLOW |
| `pii.named_accusation` | full name + accusation | `pii.full_name` hit **and**, within the same sentence or ±20 tokens, a hit in the accusation lexicon: `{cheated, cheats, stole, thief, liar, creep, stalker, stalks, predator, abuser, abused, assaulted, raped, rapist, harassed, groped, racist, dealer, sells, has (an )?std, is gay/closeted (outing), slept with, hooked up with, pregnant, got expelled, plagiarized}` | severity high → FLAG held on ANON; when the lexicon hit is in the sexual/criminal subset → BLOCK on ANON (message M-NAMED) |
| `pii.unmask_attempt` | guessing an anon author | `{anon \w+|op|this (poster|person)|whoever (wrote|posted)}` + `{is|=|aka|it'?s|must be|sounds like}` + `pii.full_name` or an `@handle` | ANON only → BLOCK |

Additional binding rules:

- On ANON surfaces `@handle` tokens are **never linkified and never notify**. They are counted by `pii.full_name`
  logic as a name signal (an `@handle` + accusation lexicon = `named_accusation`).
- PII block messages MAY say *which kind* of PII was seen (it helps honest users). All other block messages
  name only the guideline category, never the matched term or rule id.
- PRIVATE surfaces never block PII (people exchange numbers in DMs). On the **first message of a message
  request**, a phone/email hit sets `recipientBanner` = B-OFFPLATFORM.

### 2.7 Behavioral detectors

| id | trigger | outcome |
|---|---|---|
| `spam.duplicate` | same `folded` text hash by the same user on the same surface group within 10 min (PRIVATE: same text to ≥ 5 distinct conversations in 10 min) | BLOCK |
| `spam.link_flood` | > 2 URLs in one text, or any URL shortener domain from the bundled list on ANON/COMMERCE | BLOCK |
| `spam.mention_flood` | > 5 `@handle` tokens | BLOCK |
| `spam.caps_flood` | length ≥ 40, letters ≥ 70 % uppercase | signal only (+1 severity to any other match) |
| `spam.new_link` | any URL while account age < 24 h on ANON/PUBLIC/COMMERCE | BLOCK |

The duplicate detector needs recent-write state, so `ctx.recentHashes` is supplied by the foundation helper that
wraps `moderateText` (`moderateWrite`, below); `moderateText` itself stays pure.

### 2.8 The contract (TypeScript, binding)

Types live in `shared/src/core.ts` (types only, no npm imports). The implementation is foundation code under
`server/src/lib/moderation/**`. The admin slice upgrades detection **only** by registering rule packs through
`registerRulePack()`; it never edits foundation files.

```ts
// ───────────────────────── shared/src/core.ts (types only) ─────────────────────────
export type ModerationSurface =
  | 'buzz' | 'buzz_reply' | 'buzz_poll'
  | 'orbit_post' | 'comment' | 'reel_caption' | 'event' | 'profile' | 'handle' | 'group_name'
  | 'market_listing' | 'roommate_listing'
  | 'message' | 'group_message'
  | 'report_note' | 'appeal';

export type ModerationCategory =
  | 'threat_violence' | 'harassment_bullying' | 'hate'
  | 'sexual_minors' | 'sexual_explicit'
  | 'drugs_illegal_sales' | 'self_harm'
  | 'pii_doxxing' | 'named_accusation' | 'impersonation'
  | 'spam_scam' | 'academic_dishonesty' | 'profanity';

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ModerationAction = 'allow' | 'flag' | 'block';
export type ContentStatus = 'active' | 'held' | 'hidden' | 'removed' | 'deleted';

export interface ModerationContext {
  surface: ModerationSurface;
  /** Which field of the entity this text is (for queue display). Default 'body'. */
  field?: 'title' | 'body' | 'option' | 'name' | 'bio' | 'handle';
  /** Author. Used for account modifiers and events only; never copied into the result. */
  userId: string;
  role: 'user' | 'moderator' | 'admin';
  accountType: 'student' | 'org';
  accountAgeMs: number;
  activeStrikePoints: number;
  universityId: string;
  /** ISO 3166-1 alpha-2 of the author's university; selects crisis resources. */
  countryCode?: string;
  /** PRIVATE surfaces: true when this is the first message of a not-yet-accepted request. */
  isMessageRequest?: boolean;
  /** Supplied by moderateWrite(); folded-text hashes of this user's writes in the last 10 min. */
  recentHashes?: readonly string[];
}

export interface ModerationMatch {
  ruleId: string;                       // stable, e.g. 'thr.intent_target.v1'
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  /** [start, end) offsets into the ORIGINAL text. Staff-only; never sent to the author. */
  span: [number, number];
  view: 'canonical' | 'folded' | 'spaced' | 'squashed' | 'original';
}

export interface SupportResources {
  kind: 'self_harm';
  headline: string;                     // copy S-HEAD (section 2.10)
  body: string;                         // copy S-BODY
  lines: Array<{ label: string; detail: string; href: string }>; // tel:, sms:, https: (user-initiated only)
  emergencyNote: string;
}

export interface ModerationResult {
  action: ModerationAction;
  /** For 'flag': whether the content goes live immediately or waits for review. 'visible' for allow. */
  visibility: 'visible' | 'held';
  /** Status the caller MUST persist with: allow→'active', flag→'active'|'held'. Undefined for block. */
  persistStatus?: Extract<ContentStatus, 'active' | 'held'>;
  /** Highest-severity category, or null when nothing matched. */
  category: ModerationCategory | null;
  subcode: string | null;
  severity: ModerationSeverity;
  /** All matches, highest severity first. Staff-only. MUST NOT be serialized to non-staff clients. */
  matches: ModerationMatch[];
  /** True → a queue item is created even when action is 'block' (threats, minors, self-harm methods). */
  escalate: boolean;
  /** Queue priority when a queue item will be created. */
  priority: 'p0' | 'p1' | 'p2' | 'p3' | null;
  /** PRIVATE surfaces: no queue item; staff cannot read unless a participant reports. */
  privateFlag: boolean;
  /** Author-facing copy id + text (section 2.10). Null for allow without support. */
  userMessage: { id: string; title: string; body: string; guidelineAnchor: string | null } | null;
  /** Shown to the AUTHOR regardless of action when self-harm signals are present. */
  support: SupportResources | null;
  /** PRIVATE surfaces: safety banner id to attach for the RECIPIENT (e.g. 'B-SCAM'). */
  recipientBanner: 'B-SCAM' | 'B-OFFPLATFORM' | 'B-STAFF-IMPERSONATION' | 'B-SEXUAL' | null;
  signals: {
    evasion: boolean; invisibleChars: number; homoglyphs: number;
    urls: number; mentions: number; capsRatio: number; hasFullName: boolean;
  };
  engine: { version: string; rulePacks: string[]; elapsedMs: number };
}

// ───────────────────────── server/src/lib/moderation (foundation) ─────────────────────────
/** Pure, synchronous, offline, never throws. On internal error returns action 'flag', visibility 'held',
 *  category null, priority 'p2' (fail-closed to human review, never fail-open). */
export function moderateText(text: string, ctx: ModerationContext): ModerationResult;

export interface ModerationTarget {
  entityType: 'buzz' | 'buzz_reply' | 'orbit_post' | 'comment' | 'reel' | 'message' | 'market_listing'
            | 'roommate_listing' | 'event' | 'profile' | 'conversation';
  /** null when action is 'block' (nothing was persisted). */
  entityId: string | null;
  authorId: string;
  universityId: string;
  /** Required when entityId is null and result.escalate is true: the blocked text is stored on the queue item. */
  blockedText?: string;
}

/** Writes moderation_events (flag/block), creates the mod_queue item when (flag && !privateFlag) || escalate,
 *  and enqueues the optional second pass. Synchronous DB work; the second pass itself is fire-and-forget. */
export function commitModeration(result: ModerationResult, target: ModerationTarget): void;

/** Convenience used by slices: loads recentHashes, calls moderateText for each field, merges to the strictest
 *  result, throws ApiError(422,'content_blocked') on block (after commitModeration for escalations). */
export function moderateWrite(
  fields: Array<{ text: string; field?: ModerationContext['field'] }>,
  ctx: Omit<ModerationContext, 'field' | 'recentHashes'>,
  blockedTarget: Omit<ModerationTarget, 'entityId'>,
): ModerationResult;

export interface RulePack { id: string; version: string; rules: ModerationRule[]; }   // ModerationRule: section 2.3
export function registerRulePack(pack: RulePack): void;   // idempotent by id; later version replaces earlier
```

Required call sequence in every slice write handler:

```ts
const mod = moderateWrite([{ text: body.title, field: 'title' }, { text: body.text }], ctx, blockedTarget); // throws on block
const row = insert({ ...body, status: mod.persistStatus });        // 'active' | 'held'
commitModeration(mod, { ...blockedTarget, entityId: row.id });
res.status(201).json({ ...serialize(row, req.user), moderation: toAuthorNotice(mod) });
```

`toAuthorNotice(mod)` (foundation) returns **only** `{ status, userMessage, support }`. The fields `matches`,
`signals`, `engine`, `priority`, `escalate`, and `privateFlag` MUST NOT reach a non-staff client.

Block response (HTTP 422):

```json
{ "error": { "code": "content_blocked", "message": "<userMessage.body>",
  "details": { "messageId": "M-THREAT", "title": "…", "category": "threat_violence",
               "guidelineAnchor": "#threats", "support": null } } }
```

Edits re-run the full pipeline. An edit that would be blocked leaves the previous version untouched.

### 2.9 Optional AI second pass (escalator only)

- Active **only** when `MODERATION_AI_API_KEY` is set. Optional: `MODERATION_AI_PROVIDER` (default `anthropic`),
  `MODERATION_AI_MODEL`, `MODERATION_AI_TIMEOUT_MS` (default 4000). With the key absent,
  `getSecondPassClassifier()` returns `null`, nothing is enqueued, and no network call can occur. Tests MUST run
  with the key unset and MUST assert zero outbound requests.
- Runs **after** the write, asynchronously, via `fetch`. It never delays or fails a user request.
- Scope: ANON, PUBLIC, COMMERCE surfaces with rule outcome `allow` or `flag`. **PRIVATE surfaces are never sent**
  to a third party unless a participant reported that conversation. `block` outcomes are not sent.
- Payload: the text and the surface group only. MUST NOT include user id, handle, email, university, entity id,
  IP, or timestamps. Correlation uses a random per-job nonce held in memory.
- Powers: it can only **escalate**. `allow→flag` (queue item, source `ai`), or `active→hidden` pending review when
  `confidence ≥ 0.90` **and** its category maps to severity ≥ high. It can never approve, restore, un-block,
  remove, or sanction. Every AI escalation is reviewed by a human; AI-hidden items are P1.
- Resilience: 2 retries with jitter, then drop. Circuit breaker opens after 5 consecutive failures for 5 min.
  In-memory queue capped at 500 jobs, oldest dropped. Failures are counted in metrics and otherwise silent.

```ts
export interface SecondPassInput  { text: string; surfaceGroup: 'anon' | 'public' | 'commerce' | 'private_reported';
                                    firstPass: { category: ModerationCategory | null; severity: ModerationSeverity } }
export interface SecondPassVerdict { category: ModerationCategory | null; severity: ModerationSeverity;
                                    confidence: number; /* 0..1 */ rationale: string; /* ≤ 280 chars, staff-only */ }
export interface SecondPassClassifier {
  readonly name: string;
  classify(input: SecondPassInput, signal: AbortSignal): Promise<SecondPassVerdict>;
}
export function getSecondPassClassifier(): SecondPassClassifier | null;   // null ⇔ env key absent
```

### 2.10 User-facing copy per outcome (final)

Tone: plain, never accusatory, never reveals the matched word. Every block sheet has two buttons: **Edit** and
**Read the guidelines** (deep link).

| id | when | title | body |
|---|---|---|---|
| — | allow | (none) | (none) |
| M-HELD | flag + held | "In review" | "Your post is with our safety team before it goes live. This usually takes under a day. You don't need to do anything." |
| — | flag + visible | (none) | (none; the content is live and its status is unchanged, so there is nothing to disclose. The author is notified the moment the status changes.) |
| M-THREAT | block threat_violence | "This can't be posted" | "It reads as a threat or a call to violence. We take those seriously even as jokes. If someone is in danger, call your local emergency number." |
| M-HARASS | block harassment_bullying | "Let's not go after people" | "This looks like it targets a person. Criticize ideas and situations, not individuals." |
| M-KYS | block harassment/kys | "This can't be posted" | "Telling someone to hurt themselves is never OK here." |
| M-HATE | block hate | "This can't be posted" | "It includes language that attacks people for who they are." |
| M-MINORS | block sexual_minors | "This can't be posted" | "Content that sexualizes anyone under 18 is banned and reported to the authorities." |
| M-SEXUAL | block sexual_explicit | "Keep it PG-13" | "Explicit sexual content and solicitation aren't allowed on UniVerse." |
| M-DRUGS | block drugs_illegal_sales | "No buying or selling this here" | "Posts that buy, sell, or source drugs, prescription meds, weapons, fake IDs, or alcohol and vapes for underage students aren't allowed. Talking about these topics is fine." |
| M-PII | block pii_doxxing | "Private info spotted" | "This looks like it includes {a phone number / an email address / a street address / a room number / an ID number / a license plate}. For everyone's safety, keep personal details out of public posts. You can share your own details in a private message." |
| M-UNMASK | block pii/unmask_attempt | "Don't unmask people" | "Guessing or revealing who is behind an anonymous buzz isn't allowed." |
| M-NAMED | block or hold named_accusation | "Naming people isn't allowed here" | "Buzz can't verify accusations, and a wrong one can wreck someone's life. If something happened to you, report it to us or to campus services and we'll help you find the right place." (Block sheet adds a third button: **Get help reporting**.) |
| M-IMPERSONATION | block impersonation | "This can't be posted" | "It claims to come from UniVerse staff or an official source. Staff never post anonymously and never ask for login codes." |
| M-HANDLE | block reserved_handle | "That name is reserved" | "Pick a name that doesn't look like an official account." |
| M-SPAM | block spam_scam | "Looks like spam" | "This matches patterns we see in spam and scams. If that's wrong, reword it and try again." |
| M-DUP | block duplicate | "You already posted this" | "Posting the same thing repeatedly isn't allowed." |
| M-LINK-NEW | block new_link | "Links unlock after 24 hours" | "New accounts can't post links yet. This keeps spam bots out." |
| M-ACADEMIC | block academic_dishonesty | "This can't be listed" | "Selling or requesting exam answers, test banks, or someone to do your coursework isn't allowed." |
| M-LISTING-DISCRIM | block hate/discriminatory_listing | "Listings must be open to everyone" | "Roommate and marketplace listings can't exclude people based on protected characteristics." |
| M-GENERIC | engine error (fail-closed hold) | "In review" | same as M-HELD |
| S-HEAD / S-BODY | `support != null` (self_harm ideation) | "It sounds like things are heavy right now" | "You're not in trouble and your post went through. If you want to talk to someone, these are free and confidential." + lines for `ctx.countryCode` (US/CA 988 call or text; GB/IE Samaritans 116 123; AU Lifeline 13 11 14; IN Tele-MANAS 14416; default findahelpline.com) + campus counseling + emergencyNote "If you're in immediate danger, call your local emergency number." Buttons: **Call / Text**, **More options**, **I'm OK, thanks**. |
| S-METHOD | block self_harm/method_instructions | "We can't post this, but we're here" | S-BODY without the first sentence, plus the same lines. |

Self-harm handling is binding: ideation is **never** blocked, **never** earns a strike, the support sheet is
shown once per post (dismissible, never nagging), viewers of the post see a quiet "Support resources" link under
it, and the item enters the queue at **P0** with the label `wellbeing` so a trained staff member looks at it.
Recipient banners (PRIVATE): B-SCAM "Be careful. Never pay deposits or share codes for something you haven't
seen. Keep deals in the app." · B-OFFPLATFORM "This person shared contact details in their first message. Scammers
often try to move chats off the app." · B-STAFF-IMPERSONATION "UniVerse staff will never message you for a code." ·
B-SEXUAL "You can block and report unwanted sexual messages. Tap here."

---

## 3. Community signals

### 3.1 Report reasons (shared constant `REPORT_REASONS`, this order, these ids)

| id | label in the sheet | default priority | maps to category |
|---|---|---|---|
| `self_harm` | "I'm worried about this person" | P0 | self_harm |
| `threat` | "Threat or violence" | P0 | threat_violence |
| `minor_safety` | "Involves a minor" | P0 | sexual_minors |
| `doxxing` | "Shares private info" | P1 | pii_doxxing / named_accusation |
| `harassment` | "Harassment or bullying" | P1 | harassment_bullying |
| `hate` | "Hate" | P1 | hate |
| `sexual` | "Sexual content or unwanted advances" | P1 | sexual_explicit |
| `drugs_illegal` | "Drugs or illegal sales" | P2 | drugs_illegal_sales |
| `impersonation` | "Pretending to be someone" | P2 | impersonation |
| `spam_scam` | "Spam or scam" | P2 | spam_scam |
| `academic_dishonesty` | "Cheating or academic dishonesty" | P3 | academic_dishonesty |
| `other` | "Something else" (note required, ≥ 10 chars) | P3 | — |

Report rules:

- Payload: `{ entityType, entityId, reason, note?: string (≤ 500) }`. The note passes `moderateText` with
  surface `report_note` (always allow).
- One report per `(reporter, entity)`. A repeat returns the first report with HTTP 200 (idempotent, no error).
- Reporting immediately hides the item **for the reporter** (client + server filter) and shows
  "Thanks. Our safety team will take a look. You won't see this again." plus **Block** when the author is public.
- The reported user is **never** told who reported, how many reported, or that a report exists. Reporter identity
  is visible to admins only; moderators see `reporterTrust: 'high' | 'normal' | 'low'`.
- Reporting a DM conversation attaches the reported message plus up to 10 preceding messages. The sheet says so:
  "The last few messages in this chat will be shared with our safety team."
- Reporter trust: `low` when ≥ 3 reports were dismissed in the last 30 days and the reporter's confirmed rate is
  below 20 %. `high` when ≥ 5 confirmed and confirmed rate ≥ 70 %. `low` reporters count 0 toward thresholds; `high`
  reporters count 2 (capped so one `high` reporter alone can never hide anything).
- The reporter gets one in-app notification when the case closes: "We reviewed your report and took action" or
  "We reviewed your report and didn't find a violation. You can still block or hide." No detail about the action.

### 3.2 Auto-hide thresholds

Eligible reporter/voter = account age ≥ 24 h, no active mute/suspension, trust ≠ low, not the author, and (for
public authors) not blocked-by/blocking the author at the time of the report.

**Report-based (status → `hidden`, queue priority raised one level, never below P1):**

| surface | weighted distinct eligible reporters to hide |
|---|---|
| Buzz, Buzz reply, comments | **3** |
| Orbit post, Reel, event | **5** |
| Market listing, roommate listing | **4** (or **2** when all are reason `spam_scam`) |
| Any surface, reasons `threat`, `minor_safety`, `doxxing` | **2** |
| Any surface where the rule engine already flagged the item | threshold minus 1 (minimum 2) |
| Reason `self_harm` | **never auto-hides**; goes to P0 |
| Messages, conversations, profiles | **never auto-hide**; profile with ≥ 5 reporters in 7 days → P1 |

**Score-based (Buzz only; score = upvotes − downvotes from eligible voters):**

| condition | effect |
|---|---|
| score ≤ −5 and ≥ 8 eligible votes | **collapsed**: stays `active`, rendered folded as "Hidden by the community · Tap to view", excluded from Hot and Top, no queue item. Exposed as `collapsed: true` by the serializer |
| score ≤ −10 and ≥ 12 eligible votes | status → `hidden`, queue item source `community_score`, P2 |
| score recovers above the threshold | collapse lifts automatically; `hidden` never lifts without a human |

Anti-abuse: thresholds are evaluated inside the same transaction as the report/vote. A hidden root buzz keeps
its thread reachable by participants as "[hidden pending review]"; replies stay readable. Staff `approve` sets
`status='active'` and **immunizes** the item against further report-based auto-hide (`auto_hide_immune = 1`);
further reports still queue. Author is notified in-app: "Your post is hidden while our team reviews reports. We'll
let you know the result." (N-HIDDEN), then "Your post is back up." or the removal notice.

Queue priority targets (shown in metrics as SLA): P0 1 h · P1 12 h · P2 24 h · P3 72 h.

### 3.3 Rate limits (per user; sliding windows; stored server-side, not only `express-rate-limit` by IP)

"New" = account age < 72 h. Org accounts use the established column ×2 for posts/events only.

| surface / action | established | new account |
|---|---|---|
| Buzz root posts (incl. polls) | 6 / hour, 20 / day | 2 / hour, 5 / day |
| Buzz replies | 30 / hour, 150 / day | 10 / hour, 30 / day |
| Buzz votes | 120 / hour | 60 / hour |
| Orbit posts | 10 / hour, 30 / day | 3 / hour, 10 / day |
| Comments (Reels + Orbit) | 40 / hour | 15 / hour |
| Reel uploads | 5 / hour, 15 / day | 2 / day |
| Messages sent | 60 / min, 600 / hour | 30 / min, 200 / hour |
| New message requests (first contact with a non-follower) | 15 / day | 5 / day |
| Group chats created | 5 / day | 1 / day |
| Market listings created | 10 / day, 30 active | 2 / day, 5 active |
| Roommate listing | 1 active; 10 edits / day | same |
| Events created | 5 / day | 1 / day |
| Follows | 100 / hour, 400 / day | 30 / hour, 100 / day |
| Reports | 20 / day | 10 / day |
| Blocks | 50 / day | 50 / day |
| Appeals | 1 per sanction | 1 per sanction |
| Search queries | 60 / min | 30 / min |
| Profile edits (name/handle/bio) | 5 / day; handle change 1 / 14 days | same |
| Unmask (admin) | 10 / day per admin | — |

Response: HTTP 429 `{ error: { code: 'rate_limited', message: "You're going fast. Try again in {n} minutes.",
details: { retryAfterSec } } }`. IP-level `express-rate-limit` stays on as a coarse outer layer (auth endpoints
per the Constitution; 300 req/min per IP elsewhere).

### 3.4 New-account restrictions

| age | restriction |
|---|---|
| any | Guidelines accepted at onboarding; Buzz gate accepted before first Buzz read/write |
| < 24 h | no URLs on ANON/PUBLIC/COMMERCE; Buzz FLAG visible → held; votes and reports do not count toward auto-hide; cannot create polls; cannot create group chats; images in DMs disabled toward non-followers |
| < 72 h | the reduced rate limits in 3.3 |
| < 7 days | "New account" chip shown on Marketplace/Roommates listings, on message requests, and on the profile header; cannot host events with capacity > 50 |
| after a suspension ends | treated as `< 72 h` for 72 h |

---

## 4. Sanctions ladder

### 4.1 Steps

| step | name | who can apply | effect |
|---|---|---|---|
| 0 | **Warning** | moderator, admin | no restriction; blocking modal must be acknowledged before the next write |
| 1 | **Content removal** | moderator, admin | item `status='removed'`; strike points recorded per severity (2.5) |
| 2 | **Timed mute**: 24 h → 72 h → 7 d | moderator (all three), admin | can read everything, vote/like, report, block, save, RSVP, and reply inside already-accepted DM conversations. **Cannot** create buzzes, replies, posts, comments, reels, listings, events, polls, group chats, or new message requests, and cannot edit profile text. Scope `all` (default) or `buzz_only` |
| 3 | **Suspension**: 7 d → 30 d | admin only (moderator can `escalate`) | all sessions revoked; login lands on the suspension screen; profile and listings return the generic "This account isn't available"; content stays up unless individually removed |
| 4 | **Ban** (permanent) | admin only, second admin must confirm within the tool | as suspension, permanently; `sha256(lowercased email)` added to `banned_emails` so the address cannot re-register; listings and roommate profile removed |

### 4.2 Strike points and automatic suggestion

Active strike points = sum of points from confirmed violations that have not expired (low/medium: 90 days,
high: 180 days, critical: never). The tool **suggests**; a human confirms. Suggestion table:

| active points after this violation | suggested step |
|---|---|
| 1–2 | warning (first ever) or removal only |
| 3–4 | mute 24 h |
| 5–6 | mute 72 h |
| 7–8 | mute 7 d |
| 9–11 | suspension 7 d (escalate to admin) |
| 12–14 | suspension 30 d (escalate to admin) |
| ≥ 15 | ban review (admin) |

### 4.3 Ladder skips (zero tolerance)

- Credible threat to a person or place; sexualization of a minor; sextortion/NCII threat; doxxing with evident
  intent to harm; ban evasion → **immediate suspension pending admin review** (system applies a 7-day suspension the
  moment a moderator confirms; an admin decides ban vs. reinstatement). Child-safety cases follow 6.5.
- Self-harm ideation → **never** a sanction.
- Buzz violations sanction the **account**, applied blind: the moderator acts on "the author of this item" and
  the server resolves the account without revealing it (section 6).

### 4.4 What the affected user sees (final copy)

All notices are in-app (Notifications center + blocking modal on next open). Push/lock-screen text is always the
generic "You have an update from the UniVerse safety team." Every notice contains: what was actioned (their own
content quoted back, truncated to 140 chars), the guideline section, the consequence, the end time in their
local timezone, and the appeal link.

| event | copy |
|---|---|
| Warning | "**Heads up.** Your {post} broke our guideline on {category}. No restrictions this time. Further violations can limit your account." [Read the guideline] [Got it] |
| Removal | "**We removed your {post}.** It broke our guideline on {category}. This counts as a strike on your account." [See details] [Appeal] |
| Mute | "**You're muted until {date, time}.** You can still read, vote, and reply in your existing chats, but you can't post. Reason: {category}." [See details] [Appeal]. While muted every composer is replaced by a disabled bar: "Muted until {date} · Details". Write APIs return 403 `{ code: 'muted', details: { until, scope } }` |
| Suspension | Full-screen after login: "**Your account is suspended until {date}.** Reason: {category}. You can appeal once." [Appeal] [Read the guidelines] [Log out]. APIs return 403 `{ code: 'suspended', details: { until } }`; the restricted session may call only `GET /api/me/sanctions`, `POST /api/appeals`, `POST /api/auth/logout` |
| Ban | Same screen: "**Your account has been permanently banned** for {category}. You can appeal once within 14 days." |
| Appeal received | "We got your appeal. A different member of the team will review it, usually within 3 days." |
| Appeal upheld | "We reviewed your appeal and the decision stands." (final) |
| Appeal granted | "We got this one wrong. Your {post} is restored and the strike is removed. Sorry about that." |

For Buzz content the notice MUST be delivered only to the author's own notification feed and MUST NOT create any
record visible on the public profile. Mutes are invisible to everyone else. Suspended and banned profiles are
indistinguishable from blocked or nonexistent profiles to other users (no reason, no dates).

### 4.5 Appeals

- One appeal per sanction or removal, within 14 days, ≤ 1,000 chars, surface `appeal` (always allow).
- Assigned to a staff member **other than** the one who actioned; the server enforces `reviewer_id != actor_id`.
  Appeals against suspensions and bans are admin-only.
- Outcomes: `upheld`, `reversed` (content restored, points removed, mute/suspension lifted immediately),
  `reduced` (shorter duration or lower severity). Target: 72 h. Every outcome writes an audit row and notifies the user.
- Reversals feed rule precision metrics (6.7) against the `ruleId`s on the original item.

---

## 5. Buzz anonymity threat model

Adversaries: (A1) a curious student with the app and devtools; (A2) two or more colluding accounts comparing
views; (A3) someone with brief physical access to a victim's unlocked phone or a shared computer; (A4) a student
moderator; (A5) anyone who obtains logs, analytics exports, or a DB backup **without** the alias secret;
(A6) a target of criticism trying to identify their critic by timing and writing style. Out of scope: a fully
compromised server with secrets; lawful process.

### 5.1 Alias derivation (exact)

```
secret     = env BUZZ_ALIAS_SECRET (≥ 32 random bytes, base64). Production: REQUIRED, boot fails without it.
             Dev/test: if unset, generate once and persist to server/data/.buzz-alias-secret (git-ignored).
threadId   = id of the ROOT buzz of the thread (for a root buzz, its own id). Replies at any depth use the root id.
digest     = HMAC-SHA256(secret, threadId + ':' + userId)            // UTF-8, exactly this message, no prefix
nounIndex  = digest.readUInt16BE(0) % 64
colorIndex = digest.readUInt16BE(2) % 12
alias      = { emoji: ALIAS_NOUNS[nounIndex].emoji,
               label: 'Anon ' + ALIAS_NOUNS[nounIndex].noun,        // e.g. "Anon Comet"
               color: ALIAS_COLORS[colorIndex] }                     // hex string
```

`ALIAS_NOUNS` (64, fixed order, index 0 first):
☄️ Comet · 🌟 Nova · 🌌 Nebula · 🌙 Moon · 🪐 Saturn · 🚀 Rocket · 🛰️ Satellite · 🌠 Meteor · ☀️ Sol · 🌍 Terra ·
🔭 Scope · 👽 Alien · 🛸 Saucer · 🌑 Eclipse · ⭐ Star · ✨ Spark · 🌀 Vortex · ⚡ Bolt · 🔥 Ember · ❄️ Frost ·
🌊 Tide · 🌪️ Cyclone · 🌈 Prism · ☁️ Cloud · 🦊 Fox · 🦉 Owl · 🐺 Wolf · 🦅 Falcon · 🐙 Kraken · 🐬 Dolphin ·
🦋 Moth · 🐝 Bee · 🦎 Gecko · 🐢 Turtle · 🦈 Shark · 🐼 Panda · 🦁 Lion · 🐯 Tiger · 🐻 Bear · 🦌 Stag ·
🦜 Parrot · 🦩 Flamingo · 🦔 Hedgehog · 🦦 Otter · 🌵 Cactus · 🍄 Mushroom · 🌻 Sunflower · 🍀 Clover · 🌲 Pine · 🍁 Maple ·
🌸 Blossom · 🥑 Avocado · 🍋 Lemon · 🍉 Melon · 🥨 Pretzel · 🍩 Donut · 🧊 Cube · 💎 Gem · 🎲 Dice · 🧭 Compass ·
🎧 Headphones · 🪁 Kite · 🔮 Oracle · 🗝️ Key

`ALIAS_COLORS` (12, fixed order): `#7C9BFF #5EEAD4 #F472B6 #FBBF24 #A78BFA #34D399 #FB7185 #38BDF8 #F97316 #A3E635 #E879F9 #94A3B8`

Rules:

1. The alias is computed **at serialization time** and is **never stored** in any table, cache, log, or event.
2. Collision handling (768 combinations): when the thread serializer sees two *different* authors with the same
   `(nounIndex, colorIndex)` in one thread, authors are ordered by the `created_at` of their first post in that
   thread (ties by buzz id) and the 2nd, 3rd… get a label suffix: "Anon Comet 2". Rows are soft-deleted only, so
   the order is stable. Feed cards (root only) never need this.
3. `isOp = row.author_id === root.author_id`. `isMine = row.author_id === viewer.id`. Both are booleans computed
   in the serializer; the ids themselves never leave it.
4. No alias key, hash prefix, or other participant token is emitted. Clients group a participant's replies by
   `emoji + label + color`.
5. The secret is used **only** for aliases. It MUST NOT be reused for sessions, cursors, or staff pseudonyms, never
   logged, never in `shared/`, never in the client bundle. Rotation changes every alias, so it is rotated only
   on suspected compromise (documented runbook, audit row `alias_secret_rotated`).
6. Poll votes and up/down votes are stored with `user_id` (one-vote enforcement) and exposed only as counts plus
   the viewer's own `myVote` / `myChoice`.

### 5.2 Leak vectors and mitigations

| # | vector | how identity could leak | binding mitigation |
|---|---|---|---|
| L1 | **Ids** | `author_id`, sequential ids, or per-author counters in JSON; ids that embed time or user | Single serializer per Buzz entity with an explicit **allow-list** of output fields (build the object field by field; never spread a DB row). Ids are `nanoid(14)`. Forbidden keys anywhere in a Buzz response: `authorId`, `author_id`, `userId`, `user_id`, `handle`, `name`, `displayName`, `avatar`, `avatarUrl`, `email`, `universityEmail`, `profile`. The Constitution 5.6 test walks every Buzz endpoint response recursively for these keys **and** for every seeded user's id/handle/name/email as substrings |
| L2 | **Timestamps** | exact `createdAt` ms correlated with the same user's public post, DM, "active now" dot, or a classmate watching them type (A6) | Buzz serializer emits `createdAt` **floored to the minute**; ordering uses the true value inside the opaque cursor only. No `updatedAt`/"edited at" time (only `edited: true`). Presence/last-active on public surfaces is bucketed to 5 min, is driven by any authenticated request uniformly (Buzz routes neither more nor less), is visible only to accepted DM partners, and can be turned off |
| L3 | **Alias reuse** | same alias across threads links a user's buzzes; alias stored and later joined | Per-thread HMAC (5.1); never stored; no cross-thread token; no "more from this anon"; no anon follower/karma display tied to an alias. Buzz karma, if shown, is visible only to its owner in Settings |
| L4 | **`isMine` on shared or borrowed devices** (A3) | "You" badges and a "My buzzes" list reveal authorship to whoever holds the device | `isMine` is session-scoped. Logout MUST call `queryClient.clear()`, wipe zustand Buzz state and the composer draft. Buzz responses carry `Cache-Control: no-store` and `Vary: Cookie`; the service worker MUST NOT cache `/api/buzz/**`; no Buzz data in localStorage/IndexedDB. "My buzzes" lives under Settings → Privacy, not on Home. Share sheets / copy-link / screenshots-as-cards never include `isMine` styling. Idle sessions on non-installed browsers expire after 14 days |
| L5 | **Notification text** | "@maya replied to your buzz"; lock-screen preview showing you own a buzz; actor id in the payload | Buzz notification rows are written with `actor_id = NULL` (so a serializer bug cannot leak). In-app copy: "Someone replied to your buzz", "Your buzz is getting attention", "Your poll closed". No alias, no actor avatar (Buzz glyph only). Push/lock-screen: "New activity on Buzz" with no snippet. Moderation notices: see 4.4 |
| L6 | **Search & Discover** | Buzz text indexed next to profiles; `from:` filters; suggestions built from Buzz interactions | Buzz is excluded from Discover indexing, suggestions, "people you may know", and any recommendation feature input. Buzz-internal search (if built) is full-text over body only; no author, alias, or "mine" operators. Voting on or replying to the same buzz MUST NOT feed the social graph |
| L7 | **Pagination cursors** | base64 cursor containing `author_id`, or a "my buzzes" cursor embedding the user id | Cursor = base64url of `{ k: sortKey, id: buzzId }` plus an HMAC tag with a *separate* `CURSOR_SECRET`. Never contains user data. The viewer is always taken from the session. Invalid cursor → 400 `invalid_cursor` with no detail |
| L8 | **Error messages & status codes** | "You can't vote on your own buzz" shown for someone else's view; 403 vs 404 differences revealing ownership; block-related errors on Buzz | Ownership-dependent errors are returned only to the owner and are generic for everyone else (404 `not_found`). Edit/delete of a buzz you don't own → 404, identical body and timing class to a nonexistent id. Public blocks have **no effect** on Buzz (see L14), so no block error can exist there |
| L9 | **Image EXIF / media metadata** | GPS, device model, owner name in uploaded files | **Buzz v1 is text + polls only: no image, video, or file attachments, and no link previews.** For all other surfaces see 7.6 |
| L10 | **Admin screens** (A4) | moderator queue showing author name; "same author" lists; reporter names | Two serializers: `serializeQueueItem(item, viewerRole)`. For anon entity types it emits **no** author fields for *any* role. Moderators get only the blind *author standing summary* (6.2). Identity appears only in the response of the unmask endpoint (6.5). Moderators never see reporter identity. Items authored or reported by the viewing staff member are excluded from their queue |
| L11 | **Logs** (A5) | access logs pairing `userId` with `/api/buzz/:id`; request bodies; error stacks with rows | For paths under `/api/buzz` and `/api/admin/**/buzz` the request logger records method, route **template**, status, duration only: no user id, no session id, no entity id, no body, no IP. Error logs MUST NOT include DB rows or request bodies. `moderation_events` (DB, not logs) is the only place author ↔ buzz linkage exists besides the Buzz tables |
| L12 | **Analytics events** | `buzz_posted { userId, buzzId }` | Buzz analytics events MUST NOT contain `userId` together with any Buzz entity id. Unique-user counts use `HMAC(dailySalt, userId)` where the salt lives in memory and is discarded every 24 h. Events carry campus id and minute-floored time only |
| L13 | **Realtime (ws)** | broadcast payload with `isMine` computed for the author, or an author field | Buzz ws events carry ids only: `{ type: 'buzz.thread_updated', threadId }`. Clients refetch through the serializer. No typing indicators or presence on Buzz |
| L14 | **Block/mute oracle** (A1, A2) | blocking @maya makes some buzzes vanish → those are Maya's | Public-graph blocks, follows, and mutes MUST NOT alter any Buzz response. Buzz offers only: **Hide this buzz**, **Hide this anon in this thread** (keyed on thread + author server-side, so it cannot link across threads), and **Report**. There is no cross-thread anon block |
| L15 | **Mentions & links to profiles** | `@handle` in a buzz linking/notifying a profile, used to bait a reply from the target | Not linkified, no notification, counts as a name signal (2.6). There is **no way to DM a Buzz author** and no "reveal to OP" feature |
| L16 | **Sanction correlation** | awful buzz removed at 14:02 and @sam's profile shows "suspended" at 14:02 | Mutes are invisible. Suspended/banned profiles show the same generic state as blocked/nonexistent. Removed buzzes show "[removed by moderators]" with no sanction info. Suspension for Buzz violations takes effect at a random delay of 5–30 min unless the category is P0 |
| L17 | **Vote/poll side channels** | voter lists; exact counts changing by one as a known person taps | No voter lists. Poll results are hidden until the viewer votes or the poll closes. No per-vote realtime event (L13) |
| L18 | **Small-population inference** | campus with 40 users: "only one CS senior here" | Campus-scoped Buzz shows no campus-population counts. When a campus has < 50 verified users, the campus feed displays a one-time note "Small campus: be mindful that details can identify you" and the composer hint repeats it |
| L19 | **Writing style / self-disclosure** | users dox themselves | Composer hint in incognito styling: "You're anonymous. Details about you can still give you away." PII detectors block first-person phone/email on ANON too |
| L20 | **Data export / account deletion** | export file left on a shared device | The user's data export excludes Buzz by default; including it requires a fresh OTP confirmation. On account deletion, `author_id` on Buzz rows is set to a tombstone user after the 180-day safety retention window |
| L21 | **DB backups / support tooling** | ad-hoc SQL by staff | No generic SQL console in the admin UI. Any admin endpoint that joins Buzz rows to `users` other than unmask MUST NOT exist |
| L22 | **Client bundle** | alias lists + secret or derivation in `shared/` enabling offline brute force | Derivation is server-only. (The noun/color lists are not secret; the HMAC key is.) |

### 5.3 Composer and surface separation (restating Constitution 5.4 as testable requirements)

- The Buzz composer uses incognito styling, a mask glyph instead of the avatar, and the text "You're anonymous".
  Public composers show the avatar and "Posting as @handle". A composer MUST NOT be reusable across modes by a prop
  default; the mode is a required prop.
- Cross-posting a buzz to a public surface is not offered. Sharing a buzz produces a link/card with body text
  and alias only.
- Staff accounts browsing Buzz in the normal app get the normal serializer. Staff powers exist only under `/api/admin`.

---

## 6. Admin / moderator tooling

All endpoints under `/api/admin/**`, guarded by `requireRole('moderator' | 'admin')`. The admin UI is reachable
only for those roles (Settings → Trust & Safety); non-staff get 404, not 403. Every mutating endpoint writes an
audit row in the same transaction as the mutation.

### 6.1 Role matrix

| capability | moderator | admin |
|---|---|---|
| View queues, item detail, context | yes (blind for anon surfaces) | yes (blind until unmask) |
| Approve / restore, remove, dismiss reports, lock thread | yes | yes |
| Warn, mute ≤ 7 d (applied to "author of this item") | yes | yes |
| Escalate to admin | yes | — |
| Suspend, ban (ban needs second admin confirm), lift sanctions | no | yes |
| Review appeals | mutes/removals not actioned by them | all, not actioned by them |
| See reporter identity | no | yes |
| **Unmask Buzz author** | **never** | yes, with reason |
| Same-author item list for anon surfaces | count only | list, only after unmask on that case |
| Child-safety escalation handling (6.5) | can flag; loses access to the item afterwards | yes |
| Audit log | own actions | all |
| Metrics | yes | yes |
| Manage rule packs on/off, thresholds | no | yes |
| Grant/revoke moderator role | no | yes |

Conflict of interest: a staff member MUST NOT see or action items they authored, reported, or are a DM
participant in. The server filters them out of that person's queue and rejects direct access with 404.

### 6.2 Queue views

Data model (admin slice schema): `mod_queue(id, entity_type, entity_id, surface, university_id, source,
category, severity, priority, status, claimed_by, claimed_at, report_count, reporter_weight, blocked_text,
rule_ids JSON, ai_verdict JSON, created_at, first_action_at, closed_at, resolution)`. One open queue item per
entity; new reports/flags merge into it and may raise priority.

- `source`: `rule_flag | rule_block_escalation | ai_flag | user_report | community_score | appeal | system`.
- `status`: `open | claimed | escalated | closed`. `resolution`: `approved | removed | dismissed | sanctioned | escalated_external`.

Views (tabs with counts, all filterable by surface, category, campus, source, age; sort by priority then oldest):

1. **Priority inbox** — all open items, P0 pinned on top with an SLA countdown.
2. **Wellbeing** — `self_harm` items (P0), distinct styling, its own playbook panel (check-in resources,
   escalation contacts).
3. **Held for review** — items with content `status='held'` (nobody can see them yet; oldest first).
4. **Auto-hidden** — hidden by reports / score / AI.
5. **Reports** — open user reports grouped by entity.
6. **Escalated** — admin only.
7. **Appeals**.
8. **Mine** — claimed by me. **Closed** — last 30 days, searchable by queue id.

Claiming: opening an item for action claims it for 10 min (auto-release). Another staff member sees "Being
reviewed" and cannot action it.

### 6.3 Item detail

MUST show: the content (original text, with matched spans highlighted and rule ids/subcodes listed); field and
surface; content status; context (Buzz: root + parent chain + 3 siblings each side, all via the blind serializer;
comments: parent post; messages: only the reported window); reports (reason, note, reporterTrust, time); engine
result (category, severity, signals, evasion); AI verdict + rationale when present; item history (every prior
action with actor role, not actor name for moderators viewing others' actions); and the **author panel**:

- Public surfaces: the public profile (already public), account age, active strike points, sanction history.
- Anon surfaces (**blind author standing summary**, no identifier of any kind): account age bucket
  (`<24h | <7d | <30d | 30d+`), active strike points, counts of prior confirmed violations by category, current
  sanction state, count of other open queue items by the same author. Values are bucketed (`0, 1, 2, 3–5, 6+`)
  so the summary cannot serve as a fingerprint.

The detail payload for anon entity types MUST pass the same forbidden-key test as L1, for both staff roles.

### 6.4 Actions

Every action requires a `category` (guideline) and, except approve/dismiss, a `note` (≥ 10 chars, staff-only).

| action | effect |
|---|---|
| `approve` | content → `active`, `auto_hide_immune=1`, reports closed as not-violating (affects reporter trust), queue closed |
| `remove` | content → `removed`, strike points per severity, author notified (4.4), reporters notified, queue closed |
| `remove_and_warn` / `remove_and_mute{24h,72h,7d}` | as remove + sanction on "author of this item"; tool pre-selects the suggestion from 4.2 |
| `warn_only` | content stays; warning issued |
| `dismiss_reports` | closes reports without touching content; optional "bad-faith report" mark (−trust) |
| `lock_thread` (Buzz root) | no new replies; banner "Replies are locked by moderators" |
| `escalate` | to admin queue with required note; item leaves moderator queues |
| `escalate_external` (admin) | marks that emergency services/campus safety/NCMEC-type authority was contacted; stores reference number; legal hold on the content |
| `suspend{7d,30d}`, `ban`, `lift_sanction` (admin) | per section 4; `ban` needs `confirmedBy` second admin id ≠ actor |
| `restore` | reverses a removal (appeal or mistake): content → `active`, points removed, author notified |

**Bulk actions:** multi-select up to 50 items in a list view → `approve`, `remove` (same category + note), or
`dismiss_reports`. Not available for P0, Wellbeing, Escalated, or Appeals, and never for sanctions (sanctions are
per item). Each item gets its own audit row sharing a `batchId`; the response reports per-item success/failure.
Spam wave helper: "Select all with identical folded text" inside one campus.

### 6.5 Unmask with reason (admin only)

`POST /api/admin/buzz/:entityType/:id/unmask` with body
`{ reasonCode: 'credible_threat' | 'self_harm_emergency' | 'child_safety' | 'severe_repeat_harassment' | 'legal_request' | 'ban_evasion', reason: string (≥ 30 chars), caseRef?: string }`.

- `requireRole('admin')`; moderators get 404. Requires an open or closed queue item for that entity (no unmasking
  arbitrary buzzes from the feed).
- The audit row (`action='buzz_unmask'`, target, reasonCode, reason, queue id) is inserted **before** the
  identity is read, in one transaction; if the insert fails the endpoint fails.
- Response: `{ user: { id, handle, displayName, email, universityId }, unmaskId }` with `Cache-Control: no-store`.
  The client MUST NOT cache it (`gcTime: 0`), MUST render it in a dismissible panel, and MUST NOT render it on
  any list view.
- Every unmask notifies **all other admins** in-app ("An admin unmasked a Buzz author · reason code · view audit
  entry"). Limit 10/day per admin (3.3). A monthly unmask report is a required metric (6.7).
- The unmasked user is not notified at the time (safety cases), but the fact is included in their data export.
- Child-safety cases: on `escalate` with category `sexual_minors` the content is put under legal hold (never
  hard-deleted, excluded from all non-admin reads including moderator item detail), the account is suspended, and
  only admins can open the item thereafter.

### 6.6 Audit log

Table `audit_log(id, actor_id, actor_role, action, target_type, target_id, queue_id, batch_id, reason_code,
reason, metadata JSON, created_at)`.

- **Append-only**, enforced in the DB: `CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT
  RAISE(ABORT,'audit_log is append-only'); END;` and the same for DELETE. No API can edit or delete rows.
- Logged actions (minimum): every action in 6.4, `buzz_unmask`, appeal outcomes, role grants/revocations, rule
  pack toggles, threshold changes, guidelines version change, alias secret rotation, data-export of a user by
  staff, viewing a reported DM window (`dm_context_viewed`), viewing reporter identity (`reporter_viewed`).
- `metadata` MUST NOT contain Buzz author identity except on `buzz_unmask` rows, where it contains the unmasked
  user id. Audit list views hide that field behind the same admin-only gate.
- UI: filter by actor, action, target, date; export CSV (admin). Moderators see only their own rows.

### 6.7 Metrics (dashboard, all filterable by campus and date range)

Queue: open by priority; oldest open age; median and p90 time-to-first-action per priority vs. SLA; closed per
day per staff member. Quality: per-`ruleId` precision (`removed / (removed + approved)` for items it flagged),
block volume per rule, appeal overturn rate overall and per rule, auto-hide reversal rate (report-based and
score-based separately), reporter accuracy distribution, AI second-pass agreement rate and escalation count
(when enabled), engine p95 latency. Community health: reports per 1,000 posts by surface and category, top
categories per campus, held-content backlog, wellbeing items per week, repeat-offender rate (accounts with ≥ 2
confirmed violations in 90 days), active mutes/suspensions/bans. Accountability: unmask count by reason code and
admin; ladder-skip count; bulk action count. None of these charts may break down Buzz data by user. (The
Apartments engagement funnel required by the Constitution lives in the same dashboard shell but is specified by
the analytics blueprint, not here.)

---

## 7. Safety on public surfaces

### 7.1 Blocking semantics

Blocking is available on every public profile and from every public UGC item's menu (Block, Report, or both in
one sheet). It is **silent** (the blocked user is never notified), **symmetric in effect**, and immediate.
Foundation exposes `isBlockedBetween(a, b)` and `blockedIdsFor(userId)` (both directions); every public slice
MUST apply it in its list queries (SQL filter, not client filter) and detail endpoints.

| surface | effect when A blocks B (applies both ways unless stated) |
|---|---|
| Follow graph | both follow edges are deleted; neither can follow the other; pending follow requests removed |
| Profile | B opening A's profile gets 404 `not_found`, body and copy identical to a nonexistent or suspended account ("This account isn't available"). A can still open B's profile to unblock; it shows "You blocked this account" and no content |
| Orbit, Reels, comments | neither sees the other's posts, reels, comments, likes, or appearances in like/follower lists; comment counts are not adjusted (avoids a counting oracle); B cannot mention A (mention renders as plain text, no notification) |
| Discover / search / suggestions | neither appears in the other's results, suggestions, or "people you may know"; mutual-friend counts exclude blocked users |
| Direct messages | the 1:1 conversation disappears from A's inbox (kept server-side for reports). B still sees it; B's sends fail with 403 `cannot_message` "You can't message this account." (same copy as when A's settings disallow messages, so a block is not distinguishable from a privacy setting). No read receipts, typing, or presence either way. New requests impossible |
| Group chats / course chats | both stay. Each sees the other's messages collapsed as "Message from someone you blocked · Tap to view" (A's view) / rendered normally for third parties. Neither can add the other to a group. A is offered "Leave group" when blocking someone who shares one |
| Marketplace / Roommates / Events | listings, roommate cards, matches, offers, and hosted events are mutually hidden; saved items from the other vanish; B cannot RSVP-list-see A; existing listing conversations follow the DM rule |
| Notifications | existing notifications from B are removed from A's feed; none are created going forward |
| Reports | blocking never cancels or replaces a report; the sheet offers both |
| **Buzz** | **no effect at all, by design (5.2 L14).** Buzz has Hide buzz, Hide this anon in this thread, Report |

Other rules: block list in Settings → Privacy with Unblock; unblocking does not restore follows; max 1,000
blocks; the official UniVerse safety account and staff acting in the admin tool cannot be blocked from sending
safety notices. Org accounts can be blocked like anyone else.

### 7.2 Message requests

- A first message from someone the recipient **does not follow** lands in **Requests**, not the inbox, and
  triggers at most a quiet badge (no push).
- Until accepted: the sender may send **one** message (plus a listing/roommate context card); no images (any
  attachment is withheld with "Accept to view photos"), links are rendered as plain text, no read receipts, no
  typing indicator, no presence, no calls-to-action in previews.
- The request card shows: sender profile, campus, mutual follows count, "New account" chip (< 7 days),
  the context card if any, the recipient banner from moderation (B-SCAM / B-OFFPLATFORM / B-SEXUAL) when set.
- Actions: **Accept**, **Delete** (silent), **Block**, **Report**. The sender only ever sees "Request sent".
  A deleted request stays deleted; the same sender cannot send another for 30 days.
- Settings → Privacy → "Who can message me": `everyone` (default, via requests) · `my campus` · `people I follow`.
  Disallowed senders get the same 403 `cannot_message` copy as 7.1.
- Rate limits per 3.3. A sender whose requests are reported by ≥ 3 distinct recipients in 7 days is
  auto-restricted from new requests (system mute scope `requests`) and queued at P1.
- Group invites from non-followers also arrive as requests. Nobody can be added to a group > 10 members without
  accepting.

### 7.3 Messages safety baseline

Rule engine per the PRIVATE column (2.5). Report from inside any conversation or on any message. Image
attachments pass 7.6. The first time a user receives a B-SCAM or B-SEXUAL banner, the banner includes one-tap
**Block & report**. Staff can read DM content only via a participant's report window or a block-escalation
item, and each view writes `dm_context_viewed` to the audit log.

### 7.4 Marketplace: scam warnings and safe-meetup guidance

Prohibited listings (BLOCK at write via rule packs, COMMERCE column): drugs, prescription meds, alcohol,
nicotine/vapes, weapons and weapon parts, fake IDs, stolen or recalled goods, adult content or services, exam
materials and coursework services, accounts and login credentials, student ID cards, live animals, human remains
or bodily fluids, counterfeit goods, financial instruments, "get paid to" schemes.

Required safety UI (market slice; copy is final):

1. **Safety card on every listing detail** (collapsible, open by default on the viewer's first three listings):
   "**Stay safe** · Meet in a public spot on campus: the library lobby, student union, or a campus safe-exchange
   zone. · Go in daylight and bring a friend if you can. · Check the item before you pay. · Pay in person. Never
   send deposits, gift cards, or codes. · Keep the conversation in UniVerse so we can help if something goes wrong."
2. **First-contact interstitial** the first time a buyer messages about any listing (once per account, then a
   one-line reminder per new seller): same five points + "Got it".
3. **Inline scam banner** (B-SCAM) in the conversation when either side's message matches
   `payment_scam | deposit_scam | code_phish | off_platform_push` patterns: pay-first language, "cashier's
   check", "my cousin/agent will pick up", overpayment + refund, Zelle/Venmo/CashApp "friends and family" before
   meeting, gift cards, crypto, "verification code", "text me at", shipping-only for local goods.
4. **Seller trust chips**: "New account" (< 7 days), campus name, member-since month, count of completed
   (marked-sold) listings. No star ratings in v1 (rating systems become harassment vectors).
5. **Price sanity flag**: listings in Electronics, Tickets, or Bikes/Scooters priced under 30 % of the
   category's median active price (min. 10 comparables) → FLAG visible, source `system`, P3, and the listing
   shows "Price is unusually low. Take extra care."
6. **Meetup helper** in listing chats: "Suggest a safe spot" inserts a campus-public-place chip (from the campus
   hub's places list). Exact home addresses typed in listing chats show B-OFFPLATFORM-style hint "Consider
   meeting somewhere public instead."
7. Report reasons on listings add the sub-choices: "Scam or fake listing", "Prohibited item", "Already sold /
   misleading". ≥ 2 distinct `spam_scam` reporters hides a listing (3.2).
8. Sold/expired listings stop accepting new conversations. Listings expire after 30 days.

### 7.5 Roommates listing safety

- **Location granularity:** neighborhood, distance-to-campus, or a building name only. `pii.street_address` and
  `pii.room_number` BLOCK on `roommate_listing`. The map, if any, shows an approximate circle (≥ 400 m radius,
  center jittered once and stored).
- **No discriminatory free text:** statements excluding people on the characteristics in Guidelines 1.4
  (`hate/discriminatory_listing`) BLOCK with M-LISTING-DISCRIM. Lifestyle preferences (sleep, cleanliness,
  guests, smoking, pets) and the structured "comfortable sharing with" gender field for shared rooms/units are
  allowed and are the only matching inputs.
- **Profile exposure:** roommate cards show first name, year, major, lifestyle answers, budget range, move-in
  window. Not shown: last name until the conversation is accepted, age (only `18+` confirmation; under-18
  students cannot publish a roommate listing), phone, email, exact address, class schedule.
- **Contact:** through Messages with a roommate context card; it arrives as a message request (7.2) unless the
  recipient already follows the sender.
- **Scam patterns** (COMMERCE + PRIVATE rule packs): deposit or application fee before a viewing, "I'm out of the
  country / my agent will show it", wire or crypto rent, rent far below campus median (< 50 % with ≥ 10
  comparables → FLAG visible P3 + "Price is unusually low" chip), requests for SSN/passport/bank login.
- **Safety card on every roommate listing and at first contact** (final copy): "**Before you commit** · Video call
  first, then meet in a public place. · Tour the actual unit and confirm the lease with the landlord or housing
  office. · Never pay a deposit before you've seen the place and a written agreement. · Don't share your SSN,
  passport, or bank login in chat. · Tell a friend where you're going. · Trust your gut and report anything off."
- Photos pass 7.6; the upload hint says "Avoid photos that show house numbers, mail, or documents."
- Listings auto-pause after 60 days without confirmation ("Still looking?").

### 7.6 Uploaded media (all non-Buzz surfaces)

- Client re-encodes every image through a canvas (max 2048 px, JPEG/WebP) before upload, which drops all metadata.
- Server (foundation upload helper) MUST additionally strip metadata and MUST NOT trust the client: JPEG → drop
  APP1–APP15 and COM segments (keep APP0 and ICC in APP2); PNG → drop `eXIf, tEXt, zTXt, iTXt, tIME`; WebP → drop
  `EXIF` and `XMP ` chunks and clear the VP8X flags. Files that fail to parse are rejected (415). Verify magic
  bytes against the declared MIME type; allow-list: `image/jpeg, image/png, image/webp, video/mp4, video/webm`.
- Stored filename is `nanoid(21)` + extension. Original filenames are discarded and never logged. Uploads are
  served with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, and no directory listing.
- Reels video container metadata (e.g. MP4 `udta`/location atoms) cannot be stripped with the locked stack.
  Requirement: the upload screen states "Videos may include location data from your camera. Turn off location
  tagging in your camera settings." Tracked as known gap G2.
- There is no automated image/video classifier in v1. Images rely on reports, new-account limits (3.4),
  withheld images in message requests (7.2), and the lower report thresholds for P0 reasons. Known gap G1.

### 7.7 Minors, orgs, and events

- The onboarding profile step collects one yes/no answer, "I'm 18 or older" (`users.is_adult`, never shown
  publicly, editable once via Settings). Accounts with `is_adult = 0`: cannot publish roommate listings, receive
  message requests **only from their own campus**, never appear in "people you may know" for other campuses, and
  any report involving them with reason `sexual` is raised to P0.
- Org accounts claiming to be an official university unit carry an "Unverified" label until an admin verifies
  them. Reserved-handle rules (2.5) apply. Impersonation reports on orgs are P1.
- Events: public venues may include a street address; private residences must use "Address shared with RSVPs"
  (the address field is delivered only to accepted RSVPs). Event descriptions offering alcohol to under-21/18
  per local law or "girls free"-type targeting → FLAG visible.

---

## 8. Env vars, required tests, known gaps

### 8.1 Environment variables

| var | required | purpose |
|---|---|---|
| `BUZZ_ALIAS_SECRET` | production: yes (boot fails) | alias HMAC key (5.1) |
| `CURSOR_SECRET` | production: yes | cursor tag (L7); MUST differ from the alias secret |
| `MODERATION_AI_API_KEY` | no | presence enables the second pass (2.9) |
| `MODERATION_AI_PROVIDER`, `MODERATION_AI_MODEL`, `MODERATION_AI_TIMEOUT_MS` | no | second-pass tuning |

### 8.2 Required automated tests (minimum; vitest + supertest, no network)

1. **Firewall (Constitution 5.6):** every Buzz endpoint (feeds hot/new/top × campus/global, thread, reply, vote,
   poll, mine, report, notifications of Buzz kinds, ws payloads) → response bodies contain no forbidden key (L1) and
   no seeded user's id/handle/name/email substring. Same assertion on `/api/admin` queue list + item detail for
   anon entities as **moderator and admin** (pre-unmask).
2. **Alias:** same user + same thread → identical alias; same user + different threads → digests differ; alias
   absent from every DB table; collision suffix deterministic.
3. **Timestamps:** Buzz `createdAt % 60000 === 0`.
4. **Block oracle:** blocking a seeded user changes no byte of any Buzz feed/thread response for the blocker.
5. **Unmask:** moderator → 404; admin without reason → 400; admin with reason → 200 **and** an audit row exists;
   audit UPDATE/DELETE raise.
6. **Engine table tests:** for each category, ≥ 5 should-block/flag and ≥ 5 should-allow fixtures including
   leetspeak, spacing, homoglyph, zero-width, and idiom guards ("this exam is killing me" → allow;
   "k i l l" + target → block). PII fixtures for phone (formatted, spelled-out, `+` international), email
   (`(at)`/`dot`), street address, named accusation; prices, course codes, and ZIPs must **not** match.
7. **Self-harm:** ideation → `action='allow'`, `support != null`, queue item P0 `wellbeing`, zero strike points.
8. **Second pass:** with the env key unset `getSecondPassClassifier()` is `null` and no `fetch` is invoked; with a
   stub classifier it can escalate but cannot approve/unblock.
9. **Auto-hide:** 3 eligible reporters hide a buzz; 3 brand-new accounts do not; `self_harm` reason never hides;
   approved item is immune.
10. **Sanctions:** muted user → 403 `muted` on every write route listed in 4.1 and 200 on reads; suspended session
    can reach only the three allowed endpoints; appeal reviewer ≠ actor.
11. **Author notice hygiene:** no non-staff response contains `matches`, `ruleId`, `signals`, or `engine`.
12. **Blocking:** blocked profile → 404 identical to nonexistent; DM send → 403 `cannot_message`; search excludes.

### 8.3 Known gaps (accepted for v1, must be listed in the admin "Limitations" panel)

- **G1** No automated image/video content classification (stack has no vision component). Mitigated by 7.6.
- **G2** Video container metadata is not stripped server-side.
- **G3** Rule engine is English-first. Other languages rely on reports and the optional second pass. Rule packs
  are structured per-locale so lists can be added without code changes.
- **G4** Stylometry (L19) cannot be technically prevented; mitigated by education only.
- **G5** A compromised server with `BUZZ_ALIAS_SECRET` and DB access defeats anonymity by definition; `author_id`
  is stored by Constitutional requirement. Mitigation is operational: secret management, least-privilege DB
  access, audit of admin actions.

