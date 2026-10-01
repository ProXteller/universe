> **SUPERSEDED WHERE THEY DISAGREE:** `docs/SPEC.md` (esp. §2.3 deltas and rule R7 "no dead controls") and `docs/DECISIONS.md` override this document. Never build a control, route or endpoint from this file that SPEC does not declare.

# UniVerse — Product Blueprint

> Subordinate to `docs/CONSTITUTION.md`. Where this file says **(architect to confirm)**, `docs/SPEC.md`
> decides. The app name always renders through `APP_NAME`; "UniVerse" below is its current value.
> Copy placeholders are in `{braces}`. No emoji in UI copy except Buzz aliases and message reactions.

## 0. Thesis and the rules that follow from it

What the history says:

- **Early Facebook** won on three things at once: `.edu` exclusivity, real identity, and campus-by-campus
  density. A half-full campus beat a thinly spread country.
- **Yik Yak** proved anonymous + local is the most engaging text format a campus has ever had, then died
  twice over: first from unmoderated harassment, then from removing anonymity (forced handles). Lesson:
  moderate from day one, and never soften the anonymity promise.
- **Fizz / Sidechat** fixed Yik Yak with `.edu` verification and treating moderation as product. Fizz's
  early de-anonymization vulnerability is why author ids never leave our server and unmasking is audited.
- **GroupMe** owns campuses by default because every class needs a chat and joining is one link. Nobody
  loves it; it is simply where the class already is. Course chats + share links are our wedge into that.
- **Facebook Marketplace** wins on liquidity, real-profile trust, and chat that carries the listing with it.
  Campus-only + verified students + context cards is a strictly better version for a student.

Rules every slice must follow (each is testable):

1. **Density over breadth.** Every feed defaults to the user's campus.
   **Cold-start rule:** if a campus-scoped Reels or Buzz feed returns 0 items, the pane auto-switches to
   Global and shows a dismissible banner: "{university} is just getting started — showing Global."
   with a [Post the first one] action. Market, Roommates and Events never go global (they require meeting
   in person); they show their empty state with a create CTA instead.
2. **Two identities, never blended.** Anonymous surfaces look incognito; public surfaces show the avatar.
   The create button itself changes style per Home tab (see 2.0).
3. **Utility is the retention floor.** Course chats, Marketplace and Roommates must be fully useful with
   zero followers and zero posts.
4. **Notifications only for human actions aimed at you, or things you subscribed to.** No "we miss you",
   no "someone viewed your profile", no fabricated activity.
5. **Numbers are real.** Every count on screen derives from rows in the DB — including seed data.

---

## 1. Onboarding (slice: `auth`)

Six screens. One primary action per screen. A 3-step progress indicator appears only after verification
(Profile 1/3, Guidelines 2/3, Follow 3/3). Back is always available; state survives refresh (zustand +
server truth). Any deep link (`?next=/market/abc`) and any invite (`?invite=CODE`) is preserved through
the whole flow and honoured at the end **(architect to confirm: foundation router + `invited_by` column)**.

### 1.1 Welcome

| Element | Copy / behaviour |
|---|---|
| Visual | Wordmark (`uni` regular + `verse` bold) over slow orbit rings; three floating preview cards (a reel, a buzz, a listing) drifting on the rings. Static under `prefers-reduced-motion`. |
| Headline | "Your whole campus. One app." |
| Sub | "Reels, anonymous Buzz, roommates, marketplace and class chats — for verified students only." |
| Primary button | "Continue with university email" |
| Text link | "How verification works" → bottom sheet: "We email a 6-digit code to your university address. No passwords. We never post for you and we never contact anyone on your behalf." |
| Invite pill (only with valid `?invite=`) | Inviter avatar + "{firstName} invited you · {university}" |
| Footer | "By continuing you agree to the Terms and Privacy Policy." Links to static pages under Settings → About **(architect to confirm; if those pages are not built, drop this line — no dead links)**. |

### 1.2 University email

| Element | Copy / behaviour |
|---|---|
| Title | "What's your university email?" |
| Sub | "We'll send a 6-digit code. No password, ever." |
| Field | Label "University email", placeholder "you@university.edu", `type=email`, `autocomplete=email`, autofocus. |
| Live campus chip | On a recognised domain, a chip springs in under the field: check icon + "{university}". Needs a foundation domain-lookup endpoint **(architect to confirm)**; fallback is showing the campus name on the next screen. |
| New-campus chip | Unknown but valid academic domain: "New campus — you'll be the first from {domain}." |
| Primary button | "Send code" (disabled until the address parses) |
| Help link | "My school email isn't accepted" → sheet: "We accept .edu, .edu.xx and .ac.xx addresses plus a list of known university domains worldwide. Personal and alumni addresses aren't supported yet." |
| Error: personal provider | "That's a personal email. UniVerse is students-only, so we need your university address." |
| Error: disposable | "Temporary inboxes can't be verified. Use your university email." |
| Error: malformed | "Something's off with that address. Check it and try again." |
| Error: rate limited | "Too many tries. Give it a minute, then try again." |

### 1.3 Code

| Element | Copy / behaviour |
|---|---|
| Title | "Check your inbox" |
| Sub | "We sent a 6-digit code to {email}." + link "Change email" |
| Input | Six boxes, `inputmode=numeric`, `autocomplete=one-time-code`, auto-advance, backspace walks back, paste anywhere fills all six, auto-submits on the sixth digit. Wrong code: boxes shake once and clear. |
| Resend | "Resend code in 0:{ss}" counting down from 30, then "Resend code". After resend: toast "New code sent." |
| Tip (appears after 20s) | "Nothing yet? University spam filters are aggressive — check Junk or Quarantine." |
| Error: wrong | "That code doesn't match. {n} tries left." |
| Error: expired | "That code expired. Tap Resend for a fresh one." |
| Error: locked | "Too many wrong codes. Request a new one to keep going." |
| Dev inbox (non-production only) | Toast: "Dev inbox — your code is {devCode}" with a [Fill] action. |
| Returning user | Skips 1.4–1.6, goes to `next` or Home. Toast: "Welcome back, {firstName}." |

### 1.4 Public profile

| Element | Copy / behaviour |
|---|---|
| Title | "Set up your public profile" |
| Sub | "This is the real you — on Reels, Orbit, Messages, Marketplace and Roommates. Buzz stays anonymous and is never linked to it." |
| Avatar | DiceBear avatar pre-generated from the handle. Buttons: "Shuffle", "Upload photo". |
| Name | Label "Name", placeholder "Your name", 2–40 chars. Pre-filled from the email local part when it looks like `first.last`. |
| Handle | Label "Handle", `@` prefix, 3–20 chars, letters/numbers/underscores. Live availability with 300ms debounce. Pre-suggested. Available: check icon + "@{handle} is yours". Taken: "@{handle} is taken. Try @{alt1} or @{alt2}." (tappable alternatives). Invalid: "Use 3–20 letters, numbers or underscores." |
| Class year | Chips computed from today's date: the four current undergrad classes, then "Grad", "Other". |
| Major | Typeahead over a bundled list (~120 majors); free text allowed. Placeholder "Start typing — e.g. Mechanical Engineering". |
| Bio (optional) | Placeholder "One line about you", 120 chars, counter. |
| Org switch | Text toggle under the form: "Setting up a club or organization instead?" → swaps Class year/Major for "Organization name" and Category chips (Academic, Cultural, Sports & Rec, Arts & Media, Service, Professional, Greek life, Student government, Other). Sets account type `org`. |
| Primary button | "Continue" |

### 1.5 Community Guidelines acceptance

| Element | Copy / behaviour |
|---|---|
| Title | "A few ground rules" |
| Sub | "UniVerse works because students trust it. Agree to these and you're in." |
| Rule 1 | **Be decent.** "No harassment, bullying, hate or pile-ons. Go after ideas, not people." |
| Rule 2 | **No threats.** "Threats against people or places are removed and escalated." |
| Rule 3 | **Don't name and shame.** "No private info, no calling out individuals in Buzz, no photos of people without consent." |
| Rule 4 | **Keep it legal.** "No drugs, weapons, fake IDs, alcohol sales or cheating services." |
| Rule 5 | **Anonymous to students, accountable to the rules.** "Buzz hides who you are from everyone on campus. Our safety team can act on posts that break these rules, and serious violations lead to bans." |
| Link | "Read the full guidelines" → Community Guidelines page (`admin` slice) in a sheet. |
| Primary button | "I agree" — records `guidelinesAcceptedAt` and the guidelines version; a version bump re-prompts once. |

This is the app-wide acceptance. The Buzz **guidelines gate** (2.3) is a separate, shorter interstitial
shown the first time someone opens the anonymous composer.

### 1.6 Follow suggestions

| Element | Copy / behaviour |
|---|---|
| Title | "Build your Orbit" |
| Sub | "Orbit only shows people and orgs you follow — no algorithm, no strangers. Pick a few to start." |
| Pinned row (invite only) | Inviter first, tagged "Invited you". |
| Section 1 | "Popular at {university}" — orgs by follower count. Section action: "Follow top 5". |
| Section 2 | "In {major}" (falls back to "Class of {year}") — students sharing major or year. |
| Section 3 | "Active on campus" — students with public reels or Orbit posts in the last 14 days. Never derived from Buzz. |
| Row | Avatar, name, @handle, honest reason line ("Org · 184 followers", "CS · 6 reels this month"), Follow toggle (optimistic, spring morph to "Following"). |
| Sticky button | 0 followed: "Skip for now" · 1–2: "Continue — follow {3−n} more for a better Orbit" · 3+: "Enter UniVerse". Never blocks. |
| New campus variant | Header: "You're the first from {university}. Here are people from other campuses while yours fills up." Card below: "Bring your campus with you" + [Copy invite link]. |
| Exit | 900ms transition: orbit rings expand into Home. First-ever session lands on **Reels** (the brief's lead surface); afterwards Home reopens on the last-used tab. One-time coach mark: "Swipe for Buzz and Orbit". |

---

## 2. Slices

### 2.0 Shell entry points (product recommendation, architect to confirm)

Bottom nav is locked to six items, so everything else hangs off the Home header:
left = **campus chip** (planet icon + university short name) → Campus hub; centre = Reels · Buzz · Orbit;
right = **bell** with unread badge → Notifications. Own profile = avatar button in the Discover header and
the Campus hub header; Settings = gear on own profile; Trust & Safety = a Settings row visible to
`moderator`/`admin` only.

Each Home pane renders its own create button, bottom-right above the nav. It is the firewall made visible:
Reels and Orbit show the user's **avatar with a plus badge**; Buzz shows a **mask icon on a dashed,
desaturated button**. Tapping the active Home tab scrolls to top and refetches.

### 2.1 `auth` — get a verified student from link to first follow in under 90 seconds

- **Stories:** sign up with my university email without a password · come back on a new device with just a
  code · arrive from a friend's link and end up on the thing they shared · register my club as an org.
- **Must-have:** everything in section 1; `?next=` and `?invite=` survive the flow; refresh mid-flow resumes
  at the right step; OTP paste and auto-submit; all errors inline under the field (never toasts).
- **Empty/edge states:** covered per screen in section 1.
- **Delighters:** (1) live campus chip as the domain is typed; (2) handle pre-suggestion with tappable
  alternatives, so most people never type one; (3) the rings-expand transition into Home.

### 2.2 `reels` — 60-second campus video that plays instantly

- **Stories:** swipe through campus video with sound and react without leaving the feed · post a ≤60s
  vertical video as my public self · see which campus a reel is from and switch Campus/Global · report a
  reel or block its author.
- **Must-have:**
  - Full-height CSS scroll-snap feed; exactly one video playing (IntersectionObserver ≥ 0.6); next video
    `preload=auto`, the one after `metadata`; players more than 2 away are unloaded.
  - First load autoplays muted with a "Tap for sound" pill; after one tap, sound stays on for the session.
  - Tap = pause/play with a fading glyph; double-tap = like; long-press or "more" = sheet (Not interested,
    Copy link, Report, Block @handle).
  - Right rail: author avatar with follow plus-badge, like, comment, share, more. Bottom-left: name,
    @handle, campus chip, caption (2 lines, tap to expand), relative time. Thin progress bar on the bottom edge.
  - Comments in a 70%-height sheet while the video keeps playing; composer placeholder "Comment as
    @{handle}"; like a comment; one level of replies.
  - Share sheet: row of recent chats (send as a card), Copy link, system share (`navigator.share` when present).
  - Upload: pick file → client reads `video.duration`; over 60s is refused: "Reels max out at 60 seconds.
    This one is {m:ss} — trim it and try again." Cover = first frame captured to canvas. Caption ≤150 chars.
    Header shows avatar + "Posting as @{handle}". Progress bar; the reel appears optimistically in the
    author's grid. Size cap with copy: "That file is {n} MB. The limit is {max} MB."
  - Missing media file → animated poster (constitution rule), all controls still work.
  - Exports: `UserReelsGrid` (3-col, view count overlay), `FollowingReelsRail` (new reels from follows; used atop Orbit).
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Campus feed empty | Cold-start rule (section 0) | [Post the first one] |
| End of feed | "You're all caught up. New reels land all day." | [Back to top] |
| No comments | "No comments yet. Say something nice." | focus composer |
| Own grid empty | "Your reels live here. Post your first — 60 seconds max." | [Post a reel] |
| Other's grid empty | "@{handle} hasn't posted any reels yet." | — |
| Following rail empty | Rail renders nothing. | — |
| Load error | "Couldn't load reels. Check your connection." | [Try again] |

- **Delighters:** (1) double-tap heart bursts at the touch point with a spring, plus `navigator.vibrate(10)`
  where supported; (2) scrubbable progress bar with a time bubble; (3) opening comments shrinks the video
  into the top third via a shared layout animation instead of covering it.

### 2.3 `buzz` — what campus is actually thinking, anonymous and kept civil

- **Stories:** read what my campus is talking about right now · post with total clarity that I'm anonymous
  and that rules still apply · reply in a thread as a stable alias · vote so good rises and bad sinks · run
  a poll · report anything · get told about replies without ever learning who anyone is.
- **Must-have:**
  - Sort: Hot (default) · New · Top (Today / Week / All). Scope: Campus (default) · Global.
    Hot = `(score + 2·replyCount) / (ageHours + 2)^1.5`.
  - Card: OP alias (emoji + colour + label), time, campus chip (Global scope only), text ≤500 chars, poll,
    vote column, reply count, share, more. **Text and polls only — no images** (identity leaks via photos,
    and image moderation is out of scope).
  - Votes: optimistic; tap again to undo; authors cannot vote on their own content.
  - Auto-hide at score ≤ −5: dropped from lists; in a thread it collapses to "Hidden by community votes" + [Show].
  - Thread: replies nested two levels, deeper replies flatten with an alias mention. OP badge on OP replies.
    Own content is marked "You · {alias}" so users learn their alias in that thread.
  - Composer: darker surface, dashed ring, mask icon, persistent banner — "You're anonymous. Other students
    can't see who you are. Community Guidelines still apply." Counter; poll toggle (2–4 options; 1, 3 or 7 days).
  - **Guidelines gate** (first composer open, stored server-side). Title "Before your first buzz". Bullets:
    "Nobody on campus can see who wrote a buzz." / "Don't name or target individuals." / "Threats,
    harassment and illegal sales get removed, and repeat offenders get banned." Button: "I understand".
  - `moderateText()` result — blocked: inline "This looks like it breaks the guidelines ({reason}). Edit it
    and try again."; flagged: posts normally and enters the queue silently.
  - More menu: Report (reason list), Hide this thread (local), Copy link, Delete (own only). No Block in
    Buzz — there is no stable identity to block.
  - "My buzzes": private list of own threads and replies, served only to the author.
  - Rate-limit copy: "You're posting fast. Try again in {n}s."
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Campus feed empty | Cold-start rule; and when the user stays on Campus: "It's quiet at {university}. Somebody has to say it first." | [Start the first buzz] · [See Global] |
| Top · Today empty | "Nothing has taken off today yet." | [Check New] |
| Thread without replies | "No replies yet. Reply and you'll get your own alias in this thread." | focus composer |
| My buzzes empty | "You haven't buzzed yet. Only you can ever see this list." | [Write a buzz] |
| Poll closed | "Poll closed · {n} votes" | — |
| Load error | "Buzz didn't load. That's on us." | [Retry] |

- **Delighters:** (1) cosmic aliases with character ("Anon Comet", "Anon Quasar") and a ring on OP;
  (2) private karma — "Your buzz karma: {n}" on My buzzes only, never on any public surface (Yik Yak's
  best-loved retention hook, minus the leaderboard); (3) poll bars animate in after voting, with total
  votes and time left; (4) the Daily Campus Prompt (section 3).

### 2.4 `orbit` — a chronological feed of only the people and orgs you chose

- **Stories:** see posts only from accounts I follow, newest first, with a real end · post text, photos or a
  poll as my public self · like, comment, share, report, block · read someone's posts on their profile.
- **Must-have:**
  - Strictly reverse-chronological; follows + own posts only; nothing injected. `FollowingReelsRail` on top.
  - Card: avatar, name, @handle, org badge, campus chip when the author is from another campus, time, text
    ≤1000, up to 4 photos (1/2/3/4 grid layouts, fixed aspect ratios so nothing shifts), poll, like /
    comment / share counts, more (Copy link, Report, Block).
  - Composer header: avatar + "Posting as @{handle}" + "Visible on your public profile". Photos ≤4 with
    remove buttons; poll (2–4 options).
  - Optimistic like; double-tap a photo to like; photo lightbox with swipe between photos; post detail
    with flat comments + one level of replies.
  - "New posts" pill when newer items exist (60s refetch or ws event); tap → scroll to top.
  - Export: `UserPostsList`.
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Following nobody | "Your Orbit is empty. It only shows people and orgs you follow — no algorithm, no strangers." | [Find people to follow] → Discover |
| Follows exist, no posts | "Nobody in your Orbit has posted yet. Start the conversation." | [Write a post] |
| End of feed | "You're all caught up." | — |
| Own posts list empty | "Nothing posted yet. Your public posts show up here." | [Write a post] |
| Other's posts list empty | "@{handle} hasn't posted yet." | — |
| No comments | "No comments yet." | focus composer |

- **Delighters:** (1) a "New since your last visit" divider plus a true caught-up end state — a feed that
  respects your time; (2) shared-element transition from photo grid to lightbox; (3) internal links to an
  event or listing render as a compact card rather than a raw URL.

### 2.5 `discover` — find real people and orgs; Buzz does not exist here

- **Stories:** search people and orgs by name, handle or major, my campus first · see suggestions that
  explain themselves · view a profile and follow/message · browse follower lists · edit my profile · block
  or report a profile.
- **Must-have:**
  - Search: 250ms debounce, People/Orgs filter, campus results first then "Other campuses", matched text
    highlighted, recent searches stored locally and clearable, blocked users never appear.
  - Suggestions, each with a visible reason: **People you may know** (same campus + major/year, mutual
    follows): "CS · 3 mutuals". **Active creators** (public reels/posts in last 14 days): "4 reels this
    week". **Popular orgs**: "184 followers at {university}". Dismiss (x) per card. Inputs come only from
    public tables.
  - Profile: deterministic aurora banner, avatar, name, @handle, campus · major · year (or org category),
    bio, counts, mutual line ("Followed by @arjun and 2 others you follow"), Follow / Message, tabs Reels |
    Posts (components from `reels` / `orbit`). More: Copy link, Report, Block.
  - Block sheet: "Block @{handle}? They won't be able to message you or see your posts. They won't be
    notified." [Block] [Cancel]
  - Follow lists with inline follow buttons; "Follow back" label when applicable.
  - Edit profile: avatar, name, handle, bio, major, year, pronouns (optional), up to 5 interest chips. No
    external links in v1 (spam surface).
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Idle | Suggestion sections + recent searches | — |
| No results | "No one matches "{q}". Try a name, @handle or major." | — |
| No suggestions (new campus) | "You're early. As more of {university} joins, people you may know show up here." | [Copy invite link] |
| Own followers empty | "No followers yet. Post a reel or an Orbit post to get discovered." | — |
| Own following empty | "You're not following anyone yet." | [Find people] |
| Blocked profile opened | "This profile isn't available." | [Back] |

- **Delighters:** (1) reason-tagged suggestions; (2) every profile gets a unique aurora banner derived from
  its id, and orgs get an orbit ring around the avatar; (3) follow button spring-morphs Follow → Following.

### 2.6 `messages` — fast, realtime, and aware of what you're talking about

- **Stories:** DM people I know; strangers land in Requests · group chats, including course chats joined
  from Campus · see typing, delivery and read state live · send photos · open a chat from a listing or
  roommate profile with the item pinned · mute, block, report.
- **Must-have:**
  - Inbox tabs: "Chats" | "Requests ({n})". Row: avatar(s), name, preview, time, unread count, mute icon,
    course chip on course chats. Client-side filter box.
  - **Request rule:** a first message from someone the recipient doesn't follow goes to Requests — except
    messages carrying a listing or roommate context card, which go to Chats labelled "About your listing" /
    "About your roommate post" (the recipient invited contact by posting). Requests can be read without
    sending a read receipt. Banner: "{name} isn't in your Orbit. They won't know you've seen this until
    you accept." [Accept] [Delete] [Block]
  - Conversation: grouped bubbles, day separators, optimistic send with temp id, failure row "Not
    delivered. Tap to retry.", typing dots (named in groups), "Seen {time}" in DMs and a read avatar stack
    in groups, image attach with preview and lightbox, message menu (Copy, React, Report, Delete for everyone on own).
  - Message kinds: text, image, context card, offer, system. Offer bubble: "Offer: ${amount}" with
    [Accept] [Decline] for the seller; accepting posts a system line and prompts the seller "Mark as sold?".
  - Context card pinned under the header, **live** (a sold listing shows "Sold"); tapping opens the source.
  - New message: people search (Discover API), multi-select creates a group. Group: name, members, add,
    leave, mute. Course chats can be left but not renamed.
  - WebSocket reconnect with backoff, slim "Reconnecting…" bar, refetch on reconnect.
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Inbox empty | "No messages yet. Say hi to someone from class — or join a course chat." | [New message] · [Browse course chats] |
| Requests empty | "No requests. Messages from people you don't follow show up here first." | — |
| New conversation | "This is the start of your chat with {name}." + quick-reply chips | — |
| Filter no match | "No chats match "{q}"." | — |
| Blocked / unavailable | "You can't message this person." | — |

- **Delighters:** (1) context-aware quick replies above the composer — listing: "Is this still
  available?", "Would you take ${price − 10%}?", "Can we meet at {meetupSpot}?"; roommate: "When's your
  move-in date?", "Which neighborhoods are you looking at?"; (2) six quick reactions (heart, laugh, wow,
  sad, fire, thumbs-up) with a spring pop, double-tap = heart; (3) a one-time inline safety tip on the first
  marketplace message: "Meet in a public spot on campus. Never pay before you've seen the item."

### 2.7 `roommates` — rank everyone on campus by how well you'd actually live together

- **Stories:** describe how I live in under two minutes · say whether I have a place or need one · browse
  people ranked by compatibility and see why · filter by budget, dates, area · save quietly · message with
  context · pause my listing once I'm sorted. Campus-only.
- **Must-have:**
  - Tabs: Browse | Saved | My profile. Browsing without a profile works, but match % shows "—" under a
    banner: "Answer 8 quick questions to see your match %." [Start]
  - Basics: mode ("I need a place" / "I have a place"), monthly budget (your share), move-in month, lease
    length, neighborhoods (campus presets + custom), optional "Comfortable living with: Anyone / Same
    gender only". Has-a-place adds rent, private/shared room, beds/baths, furnished, utilities included, ≤6 photos.
  - Questionnaire, one card each, one tap each: sleep schedule · cleanliness · noise at home · guests ·
    smoking/vaping · pets · hosting/parties · sharing food and stuff. Two dealbreaker toggles (smoking, pets).
  - Compatibility = weighted similarity `1 − |a − b| / range`; weights: cleanliness 20, sleep 20, noise 15,
    guests 15, smoking 15, pets 10, sharing 5. A dealbreaker conflict caps the result at 35%. The detail
    view explains itself: "You both: early birds, very tidy, quiet weeknights. Differs: guests."
  - Card: avatar, name, year · major, mode chip, budget, move-in, areas, animated compat ring, three
    lifestyle tags, Save, Message. Sort: Best match (default), Newest, Budget.
  - Filters: mode, budget dual slider, move-in month, lease length, neighborhoods, living-with preference.
  - Pause/resume listing; after 30 days a gentle "Still looking?" prompt. Report and Block on card and detail.
  - Message opens a conversation with the roommate context card.
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| No profile (My profile) | "Find someone you can actually live with. Tell us how you live — about 2 minutes — and we'll rank everyone at {university} by compatibility." | [Start] |
| No results with filters | "No matches with these filters. Try widening your budget or move-in date." | [Reset filters] |
| Campus empty | "No roommate posts at {university} yet. Post yours and you're the first thing people see." | [Create my post] |
| Saved empty | "Save people you'd want to live with. They won't be notified." | [Browse] |
| Listing paused | "Your post is paused. Nobody can see it until you resume." | [Resume] |

- **Delighters:** (1) compat ring with a per-dimension "why you match" breakdown; (2) the questionnaire
  ends with an archetype label ("Tidy Night Owl") shown on your card; (3) Message pre-fills an opener from
  shared traits: "Hey {firstName} — looks like we're both early birds looking near {area} for {month}."

### 2.8 `market` — sell a mini fridge in one minute to someone you can verify

- **Stories:** browse what's for sale on my campus · list in under a minute · save things and hear about
  price drops · message the seller or make an offer · mark sold · manage my listings · know how to trade
  safely. **Campus-only, no global scope** (shipping is where scams live).
- **Must-have:**
  - 2-column grid: 4:5 photo, price badge (or FREE / TRADE / WANTED chip), title, time · meetup spot, save heart.
  - Category chips: All, Textbooks, Furniture, Electronics, Dorm & Kitchen, Clothing, Bikes & Scooters,
    Tickets, Other; shortcut chips Free and Wanted. Filter sheet: type, price min/max, condition (New /
    Like new / Good / Fair), posted within. Sort: Newest, Price low–high, Price high–low. Search by title.
  - Detail: photo carousel, price, title, condition, category, description, meetup spot, seller card
    (avatar, name, year, member since, active listings; tap → profile), [Message seller], [Make offer]
    (amount input with −10% / −20% chips), Save, Share, Report. Collapsible safety tips: "Meet in public on
    campus · Inspect before you pay · No deposits, no shipping · Never share verification codes."
  - Create: photos first (≤6, "Make cover"), title ≤80, price (hidden for free/wanted), type, category,
    condition, description ≤1000, meetup spot (campus presets + custom). Header: avatar + "Posting as
    @{handle}". Prohibited-item check on top of `moderateText()`: "This looks like a prohibited item
    ({reason}). See what can't be listed."
  - Sold: ribbon, greyed, leaves browse after 7 days. My listings: Active | Sold; Edit, Mark sold, Delete;
    per-listing views, saves and chats.
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Campus empty | "Nothing listed at {university} yet. Got a mini fridge collecting dust? List it in about a minute." | [List an item] |
| No matches | "No listings match. Try fewer filters — or post a Wanted and let sellers come to you." | [Post a Wanted] · [Reset] |
| Saved empty | "Tap the heart on anything you like. We'll tell you if the price drops." | [Browse] |
| My listings empty | "You haven't listed anything yet." | [List an item] |
| Listing removed | "This listing is no longer available." | [Back to Marketplace] |

- **Delighters:** (1) price-drop notifications to everyone who saved the item; (2) structured offer bubble
  with Accept/Decline that flows into "Mark as sold?"; (3) campus meetup-spot presets ("Main library lobby",
  "Student union front desk", "Campus police safe-exchange zone") shown on cards and reused as a chat quick
  reply; (4) a search with no results offers one tap: "Post a Wanted for "{q}"".

### 2.9 `campus` — what's happening at my school today, and where my classes talk

- **Stories:** one screen for today on campus · find events, RSVP, see which friends are going · host an
  event as a student or org · find my course's chat by code and join in one tap · start the chat if it
  doesn't exist · jump anywhere in the app.
- **Must-have:**
  - Hub: header "{university}" + member count + launch meter (section 4) · "Today" strip · "Your courses"
    rail with unread dots · "Upcoming" list · quick links (Roommates, Marketplace, Apartments, Guidelines, Invite friends).
  - Events: filter chips Today, This week, Free food, Academic, Social, Sports, Career, Arts. Card: date
    block, title, host, place, time, going count, avatars of people you follow who are going.
  - Event detail: cover (category art or upload), host row with Follow, time range, location, description,
    RSVP segmented control (Going / Interested) optimistic, attendee list (follows first), Share, Add to
    calendar (client-generated `.ics`), Report. Hosts can edit and cancel; cancel notifies RSVPs.
  - Create event: title, category, start/end, location, description, cover (8 presets or upload), free-food
    toggle, optional capacity. Org-hosted events carry the org badge.
  - One-hour reminder to "Going" users; generating due reminders lazily on notification fetch is fine (keep processes light).
  - Course chats: search by code or title; row shows code, title, term, member count, last active. Join →
    added to the group conversation → lands in it. Create: code (normalised, e.g. "cs314" → "CS 314"),
    title, term auto-filled. Dedupe on (university, code, term): "{code} already has a chat with {n}
    classmates. Join it instead?" First system message: "Course chats are for help, not answers. Sharing
    exam or graded-assignment answers breaks the guidelines."
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| No events | "Nothing on the calendar at {university} yet. Hosting a study session, pickup game or club meeting? Put it up." | [Create event] |
| Free-food filter empty | "No free food right now. We're as disappointed as you are." | [Clear filter] |
| No joined courses | "Add your classes to find your people." | [Find my courses] |
| Course search no result | "No chat for "{q}" yet. Start it — classmates who search will find yours." | [Create {q} chat] |
| No RSVPs | "No RSVPs yet. Be the first." | — |
| Event cancelled | "This event was cancelled by the host." | — |

- **Delighters:** (1) Free-food filter (section 3); (2) "friends going" avatar stack on event cards;
  (3) add-to-calendar plus the one-hour reminder; (4) the "Today" strip reads like a sentence: "Today: 3
  events · 1 with free food · 14 new listings" (counts from existing list endpoints).

### 2.10 `apartments` — coming-soon page that measures demand, plus Notifications and Settings

- **Stories:** understand what Apartments will be and get on the list in one tap · tell the team what I
  need in three taps · (team) measure views, CTA taps and survey completion by campus · see everything that
  happened to me in one place · control notifications, privacy, blocks and my account.
- **Must-have — Apartments:**
  - Hero: "Apartments — coming soon" over a skyline-in-orbit illustration. Three promises, no more:
    "Listings near campus, sorted by walk time to class." / "Building reviews from verified students." /
    "Sublets and lease takeovers, students only."
  - CTA "Get notified" → morphs to check + "You're on the list" with a quiet "Leave the list" link. Count
    line: "{n} students at {university} are waiting." when n ≥ 10, else "Be one of the first at {university}."
  - Inline micro-survey after the CTA, skippable, three taps: Q1 "When do you need a place?" (This semester
    / Next semester / Next fall / Just browsing) · Q2 "Max monthly budget, your share?" (Under $600 /
    $600–900 / $900–1,300 / $1,300+) · Q3 "What matters most? Pick up to two." (Price / Walk to campus /
    Flexible lease / Safety / In-unit laundry). End: "Thanks. This helps decide which campuses launch first."
  - Events tracked: `page_view` (once per session, plus dwell bucket on leave), `cta_click`, `cta_undo`,
    `survey_start`, `survey_answer` (per question), `survey_complete`, `share_click`, `roommates_crosslink_click`,
    each with user, university and timestamp. Read by `admin` analytics.
  - Useful today: "Need a place now? See roommates who already have a room" → Roommates filtered to has-a-place.
- **Must-have — Notifications:** groups Today / This week / Earlier; filter chips All, Replies, Follows,
  Marketplace, Events; row = type icon, text, time, unread dot, thumbnail; tap deep-links and marks read;
  "Mark all read"; same-type same-target within an hour collapses ("{name} and 12 others liked your reel").
  Copy by type: "{name} started following you" [Follow back] · "{name} commented: "{snippet}"" · "Someone
  replied to your buzz" (mask icon; never an identity) · "Your buzz passed {n} upvotes" · "{name} sent you
  a message request" · "{name} offered ${amount} for {title}" · "Price drop: {title} is now ${new} (was
  ${old})" · "Starts in 1 hour: {event}" · "Cancelled: {event}" · "Thanks — we reviewed your report and
  took action." · "Your {thing} was removed for breaking the guidelines: {rule}." [See guidelines]
- **Must-have — Settings:** Account (email read-only, university, Edit profile) · Notifications (toggle per
  category, Quiet hours 11pm–8am) · Privacy & safety (Who can message me: Everyone at my campus / People I
  follow / No one new; Blocked users with Unblock; "How Buzz anonymity works" explainer) · Invite friends
  (link, copy, "{n} joined from your link") · About (Community Guidelines, Terms, Privacy, version) ·
  Sign out · Delete account (typed confirmation).
- **Empty / edge states:**

| State | Copy | Action |
|---|---|---|
| Notifications empty | "Nothing yet. Follows, replies and offers land here." | — |
| Filter empty | "No {filter} notifications." | [Show all] |
| Blocked list empty | "You haven't blocked anyone." | — |
| No invites yet | "Nobody has joined from your link yet." | [Copy link] |

- **Delighters:** (1) after each survey answer, show the real campus split ("42% at {university} said
  Price") — an immediate payback for answering; (2) waitlist count ticks up with a ring pulse when you join;
  (3) inline actions on notifications (Follow back).

### 2.11 `admin` — moderation as product: fast, blind where it must be, fully audited

- **Stories:** (moderator) clear a prioritised queue across all surfaces without ever seeing a Buzz
  author · (admin) apply the sanctions ladder · (admin) unmask a Buzz author only with a written reason,
  leaving an audit trail · (admin) read growth, safety and Apartments analytics · (everyone) read the
  guidelines in plain language.
- **Must-have:**
  - Queue tabs Open / Escalated / Resolved; filter by surface, reason, campus; priority = severity ×
    report count × age. Card-based (it lives inside the phone frame): content snapshot, surface chip,
    report reasons with counts, auto-flag label with matched rule, author block — public content shows the
    profile chip + prior strikes; Buzz shows "Anonymous author · {n} prior strikes" and nothing else.
  - Actions: Dismiss · Remove · Remove + warn · Escalate. Each takes a one-tap reason and writes the audit log.
  - Sanctions ladder: warn → 24h mute → 7-day suspension → ban. For Buzz, "Sanction author" applies blind.
  - Unmask (admin): reason category (Threat to safety / Legal request / Severe repeated abuse) + written
    reason ≥20 chars + type UNMASK to confirm. The identity shows for 5 minutes, then re-masks on screen.
  - Audit log: append-only; actor, action, target, reason, time; unmask rows highlighted.
  - DM reports: reporter opts in with "Include the last 10 messages so we can review this."
  - Engine categories: harassment, threats, hate, sexual content, drugs/illegal sales, doxxing/PII (phone,
    email, address patterns), spam/links, academic cheating, self-harm. Severity → allow / flag / block.
    Self-harm is never blocked: the author gets a supportive interstitial with campus counseling and the 988
    Suicide & Crisis Lifeline (US), and the item is flagged for priority review.
  - Analytics: signups by campus, DAU/WAU, activation rate (section 4), content per surface per day,
    reports per 1k items, median time-to-action, Apartments funnel (views → CTA → survey complete) by campus.
  - Community Guidelines page: rules with examples of what is and isn't OK, the ladder, and a plain
    explanation of who can see what in Buzz.
- **Empty / edge states:**

| State | Copy |
|---|---|
| Queue empty | "Queue clear. Nothing needs review right now." |
| Audit log empty | "No actions logged yet." |
| Analytics without data | "Not enough data yet. Charts appear after the first day of activity." |
| Non-staff opens `/admin` | "This area is for the Trust & Safety team." [Back to Home] |

- **Delighters:** (1) blind strike history — consistent enforcement on Buzz without identity; (2) a
  deliberately heavy unmask ritual with timed re-mask; (3) reporter feedback notification closes the loop,
  the cheapest trust-builder in the app.

---

## 3. Additions beyond the brief

Score = daily-use value (1–5) × cheapness (1–5, 5 = trivially cheap). Maximum five; each lives inside an existing slice.

| # | Addition | Owner | Value | Cheap | Score | What exactly |
|---|---|---|---|---|---|---|
| 1 | **Share-to-chat cards for everything** | `messages` (each slice calls the share sheet) | 5 | 4 | 20 | Generalise context cards to `{kind: reel, post, event, listing, roommate, buzz, profile; id, title, subtitle, imageUrl, href}`. DM sharing is the core internal loop of every modern social app. Buzz cards carry text snippet + "Buzz · {university}" only — never alias, `isOp` or `isMine`. |
| 2 | **Free-food flag + filter on events** | `campus` | 4 | 5 | 20 | One boolean, one chip, one badge. The most reliable reason a student opens an events tab. |
| 3 | **Daily Campus Prompt** | `buzz` | 4 | 4 | 16 | ~60 evergreen prompts in the buzz seed; one per campus per day chosen by `dayIndex % count`; pinned card atop Hot: "Today's prompt: {text}" + [Answer anonymously]. Answers are ordinary buzzes with a `prompt_id`. Cures blank-page paralysis and gives a quiet campus a daily pulse. |
| 4 | **Course-code tag on listings** | `market` (field + filter); `campus` renders a deep link only | 3 (5 in weeks 1–3 of term) | 5 | 15 | Optional `courseCode` on Textbooks listings, normalised like course chats. Each course chat header links "Textbooks for {code}" → `/market?course={code}`. No cross-slice API. |
| 5 | **Lost & Found listing type** | `market` | 3 | 5 | 15 | Two more type values (`lost`, `found`): no price, location + date fields, resolve action "Returned". Gets lost-ID posts out of Buzz, where they inevitably name people. Empty copy: "Nothing lost or found right now. That's a good thing." |

**Cut — tempting, and wrong for v1:**

- Anonymous DMs or anonymous replies on public posts — breaks the firewall; the classic harassment vector.
- Images or video in Buzz — identity leaks and image moderation.
- Stories / disappearing posts — splits an already thin content supply across a third public format.
- Dating, "crush" or hot-or-not mechanics — harassment and reputational risk.
- Professor or course ratings — naming individuals contradicts the guidelines; defamation load.
- In-app payments, escrow, shipping, global marketplace — compliance and scams; campus meetups remove the need.
- Ride-share board — safety liability without stronger identity checks.
- Contact-book upload, SMS invites, "{name} just joined" blasts, profile-view notifications — spam that burns trust.
- Public karma leaderboards and streaks — reward outrage; karma stays private.
- Reel editing suite (filters, music, duets) and hashtags/trending — licensing, big build, needs volume first.
- Live streaming, audio rooms, voice notes, video calls, message editing.
- Timetable import, GPA tools, campus map, dining menus — need per-university feeds; no runtime network.
- AI homework helper — academic-integrity risk, needs runtime network.
- Sublet / lease-takeover listings — that is Apartments v1; capture demand in the micro-survey now.
- QR posters — no QR dependency installed and hand-rolling one is waste; links only.
- Logged-out public previews — leak campus content; `?next=` does the job.
- Alumni accounts, multi-campus membership, moderation appeals flow, onboarding checklist gamification.

---

## 4. Growth loops (honest, non-spammy)

Hard rules: we never message anyone on a user's behalf; every share is a link the user sends themselves
(`navigator.share` or copy); no reward ladders for invites; every number shown is real.

| Loop | Mechanics | Guardrails | Owner |
|---|---|---|---|
| **Personal invite link** | `/i/{code}` → Welcome with the inviter pill → inviter pinned first in follow suggestions → inviter sees "{n} joined from your link". | Carries only the public profile. No contact import. No rewards beyond the count. | `auth` (welcome + pinned row) · `apartments` (Settings → Invite friends) · foundation (`invite_code`, `invited_by` — architect to confirm) |
| **Campus launch meter** | Campus hub header: "{count} of {goal} students · {university}" with a ring; goals ladder 25 / 100 / 500 / 1,000 / 2,500 / 5,000 (next above current; after that "5,000+ students"). First 100 members per campus get a permanent "Founding member" profile badge. One system notification per milestone: "{university} just passed {goal} students." [Share invite link] beside the meter. | Real counts only. Nothing is locked behind the meter — it frames an empty campus as a beginning, not a dead end. | `campus` (meter + endpoint) · `discover` (badge, needs `isFoundingMember` on the public user — architect to confirm) |
| **Course-chat link (the GroupMe wedge)** | Every course chat has "Invite classmates" → link text "Join {code} on UniVerse". Students paste it where the class already talks. New users arrive via `?next=`, verify, and land inside the chat. | The link reveals only course code and campus. Joining requires a verified email from that university. | `campus` |
| **Org onboarding** | Org account type in onboarding → org profile starter card ("Add a logo · Post your first event · Share your follow link") → events carry share links → RSVP needs an account → RSVP prompts "Follow {org}?". Orgs bring their members because it fills their events. | Org accounts start unverified; admins can grant a verified mark. No impersonation of official university offices. | `auth` (account type) · `discover` (org profile + starter card) · `campus` (events + RSVP follow prompt) · `admin` (verify) |
| **Listing / event share links** | Share → link → `?next=` through onboarding → lands on the item. Utility sells the signup. | No logged-out previews. | `market`, `campus`; `auth` preserves `next` |
| **DM share cards** | Addition #1. Every share is a reason for the recipient to open the app that was caused by a friend, not by us. | Buzz cards never imply authorship. | `messages` |
| **Apartments waitlist** | Real per-campus count plus survey split as social proof. | No "invite to move up the list". | `apartments` |

Notification hygiene, enforced in the notifications model: aggregate likes; max one milestone
notification per buzz per day; Quiet hours on by default; per-category toggles.

Activation metric (rendered in `admin` analytics): within the first session a new user does any of —
follows ≥3 accounts, joins ≥1 course chat, or votes/posts in Buzz. Track alongside D1/D7 retention,
invite acceptance rate, and "live campuses" (≥8 new buzzes/day).

---

## 5. Seed data — what a believable campus looks like

**Shape.** One deep **hero campus** holds about 60% of content; three medium campuses give Global scope
real texture; a long tail shows worldwide reach. A fresh signup from any other university sees a lively
Global feed via the cold-start rule rather than a dead app. SPEC.md names the hero campus; the
recommendation is a large public university with a big off-campus rental market (example used below:
**UT Austin, `utexas.edu`**) because Roommates, Marketplace and Apartments are most believable there. If
SPEC picks another, swap landmarks and course-code format and keep the proportions.

- Medium campuses: University of Michigan (`umich.edu`), Stanford (`stanford.edu`), NYU (`nyu.edu`).
- Long tail, 3–8 users each: University of Toronto (`utoronto.ca`), ETH Zürich (`ethz.ch`), TUM
  (`tum.de`), Oxford (`ox.ac.uk`), NUS (`u.nus.edu`), IIT Bombay (`iitb.ac.in`), University of Melbourne
  (`student.unimelb.edu.au`), plus ~12 more US schools.

**Volume** (all counts real; rows are cheap, media is SVG):

| Entity | Total | Hero campus | Notes |
|---|---|---|---|
| Users | ~600 | ~320 | ~40 full personas with bios and content; the rest are background students (name, major, year, avatar, follows, votes, likes, RSVPs) from a seeded PRNG. |
| Org accounts | 18 | 12 | 40–210 followers each. |
| Follows | ~9,000 | | Clustered by major/year/org so mutuals are meaningful. |
| Buzz threads / replies / votes | 180 / ~900 / ~4,500 | 110 threads | Power-law scores: three or four at 150–400, most 3–30, several at 0, two already auto-hidden. 12 polls. |
| Reels | 12 (one per seed file) | 8 | If more rows are needed, reuse files only across different campuses. |
| Orbit posts | ~90 | ~55 | About 40% with 1–4 photos, 8 polls, a third from orgs. |
| Market listings | ~60 | ~60 | Campus-only surface; add ~10 per medium campus. 8 sold, 6 free, 5 wanted, 4 lost/found, 12 textbooks with course codes. |
| Roommate posts | ~35 | ~35 | Compatibility against the demo user spans 38–96%; at least three ≥90% and four <50%. |
| Events | 20 | 16 | All in the next 14 days relative to seed time; 2 today; 5 with free food; 14 org-hosted. RSVPs 4–240. |
| Course chats | 25 | 25 | 8–310 members; ≥15 messages each; last message within 48h. |
| Apartments | ~260 waitlist rows, ~1,400 engagement events over 30 days | | Shaped so the funnel reads roughly 100% → 38% → 61% of CTA. |
| Moderation | 9 open queue items, 14 resolved, 20 audit rows (incl. 1 unmask with reason), 1 muted user | | |

**Time.** Every timestamp is relative to seed time: about 40% of content in the last 24h, 35% in the last
week, the rest older. Evergreen topics only — no holidays, no "finals week". Class years are computed from
the seed date. Use a fixed PRNG seed so tests stay deterministic.

**Demo user.** Maya Chen, `@mayachen`, Computer Science junior at the hero campus, signing in as
`maya.chen@{heroDomain}` via the Dev inbox toast. Her state must exercise every screen: follows 28, 41
followers, 2 reels, 5 Orbit posts, 3 of her own buzz threads (one with 14 replies), 6 DMs + 2 groups + 4
course chats + 2 message requests, one listing chat with a pending offer, one roommate chat, roommate
profile complete, 2 active listings + 1 sold, 5 saved listings, 3 RSVPs, on the Apartments waitlist with
the survey unanswered, 12 notifications (7 unread, including "Someone replied to your buzz"). Also seed
`admin@{heroDomain}` (admin) and `mod@{heroDomain}` (moderator). Persona ids should be fixed constants
exported by the core seed so slice seeds reference them without guessing (architect to confirm).

**Personas** (full profiles; class years computed at seed time):

| Name | Handle | Who | What they generate |
|---|---|---|---|
| Maya Chen | @mayachen | CS junior, demo user | see above |
| Jordan Okafor | @jordan_builds | Mech E senior, solar-car team lead | org events, build reels |
| Sofia Ramirez | @sofiaram | Nursing sophomore | roommate post: early bird, spotless, needs a place |
| Arjun Patel | @arjunp | Finance junior, consulting club | textbook listings, career-fair posts |
| Priya Natarajan | @priya_n | MS Data Science, international | has-a-place roommate post, furniture wanted |
| Tyler Brooks | @tbrooks | freshman, undeclared business | dorm-food reels, intramural events |
| Aaliyah Washington | @aaliyah_w | Journalism senior, campus paper | photo posts, highest follower count among students |
| Lucas Oliveira | @lucas_oli | Architecture exchange student | selling a bike and desk before leaving |
| Hannah Kim | @hannahkim | Biology junior, pre-med | study-session events, course-chat power user |
| Noah Goldberg | @noahg | Radio-TV-Film junior | the best reels on campus |
| Emma Lindqvist | @emmalq | Chemistry PhD, TA | quiet-household roommate post, lab-move furniture sale |
| Diego Hernandez | @diegoh | Kinesiology transfer, club soccer | pickup-game events, new-to-campus posts |

(Handles use letters, numbers and underscores only.)

**Orgs** — descriptive, fictional, never official university offices or real Greek chapters: Women in
Computing · Solar Car Team · Student Events Board · The Campus Daily · Club Soccer · Climbing Club · Indian
Students Association · Black Student Alliance · Pre-Med Society · Robotics Society · Film Society · Campus
Food Pantry Volunteers · A Cappella Collective · Consulting Group · Sustainability Coalition · Esports Club
· First-Gen Student Network · Hack Night.

**Buzz tone** — specific, funny, a little vulnerable, never naming anyone. Examples:

- "Registration opens at 8:00. The site crashes at 8:00. Every semester. It's tradition at this point."
- "PCL 5th floor at 2am has a specific kind of silence that is really just collective despair."
- "Saw the albino squirrel before my ochem exam. Got a 58. The squirrel is a fraud."
- "To whoever turned in my wallet at the Gregory front desk with the cash still in it: you restored about 40% of my faith in people."
- "Is it normal to not have a friend group yet? It's week 5 and everyone seems to have their people." (supportive replies: "Took me until spring. Pick one club and keep showing up.")
- "Career fair tip: the big-name lines are 90 minutes. The mid-size companies next to them are hiring the same roles and will actually talk to you."
- "The parking permit costs more than my first car."
- Poll: "Best late-night study spot?" — PCL / The Union / GDC atrium / My bed, lying to myself

Other topics: dining-hall verdicts, campus wifi outages, gym crowding, bus routes, roommate friction (mild),
homesickness, internship anxiety, wholesome shout-outs, "overheard on Speedway".
Queue items for `admin` are mild and already flagged/hidden: a buzz insulting an RA identified by first name
and floor (harassment/doxxing), a Wanted listing seeking a prescription stimulant (drugs), a link spammed
across three course chats (spam), a vague "don't come to {building} tomorrow" buzz in Escalated (threat).

**Listings** — real student prices, real student phrasing: Mini fridge with freezer, $60 · IKEA desk, light
scratches, $40 · TI-84 Plus CE, $45 · Campbell Biology 12e (BIO 311C), $35 · Hybrid bike + U-lock, $120 ·
24" monitor with HDMI cable, $70 · Futon, free, must pick up by Friday · Twin XL mattress topper, $25 ·
Trade: desk lamp for a fan · Wanted: CH 301 lab goggles · Found: set of keys with a blue carabiner near
Welch. Descriptions in a seller's voice ("Moving out of West Campus Dec 15, need this gone"). Photos are
locally generated SVG product illustrations on tinted gradients, at least 3 variants per category — never a grey box.

**Roommates** — budgets $650–$1,400; areas West Campus, North Campus, Hyde Park, Riverside, On campus;
move-in clustered on the next two term starts; a realistic mix (several night-owl/relaxed, a few
spotless/early-bird, one or two pet owners, a couple of smokers so dealbreakers fire).

**Events** — "Hack Night: build something in 3 hours" (free food, GDC) · "Resume reviews with Consulting
Group" (McCombs) · "Pickup soccer, all levels" (intramural fields) · "BIO 311C exam 2 study session" (PCL
group room) · "Film Society: outdoor screening" · "Food pantry restock volunteers" · "A cappella fall
auditions" · "First-Gen coffee hour" (free food).

**Course chats** — hero-campus code format: CS 312, CS 314, CS 429, M 408C, M 408D, CH 301, BIO 311C,
GOV 310L, ECO 304K, PHY 303K, ACC 311, RHE 306, UGS 303, E E 302, SDS 320E, PSY 301 and ~9 more. Messages
read like class chats: "is the quiz open note?", "anyone have the room for the review session?", "section
moved to 3pm fyi", "forming a study group for exam 2, PCL Thursday?" — with a reminder about not sharing answers.

**Never seed:** real people, real professors, real businesses, real Greek chapters, slurs, graphic content, or
any counter that is not backed by rows.

---

## 6. Requests to the architect (touch foundation; everything else fits inside slices)

1. Preserve `?next=` and `?invite=` through onboarding; store `invite_code` / `invited_by` on users.
2. Domain → university lookup endpoint for the live campus chip (unauthenticated, rate-limited).
3. Generic share/context card kinds in `messages`, plus an exported share sheet other slices can open.
4. Home header entry points: campus chip (left), bell (right); avatar → own profile in the Discover header.
5. `isFoundingMember` on the public user serializer (rank ≤ 100 at their university).
6. Static Terms / Privacy pages under Settings → About (owner `apartments`), or drop the Welcome footer line.
7. Fixed persona ids exported from the core seed for slice seeds.
