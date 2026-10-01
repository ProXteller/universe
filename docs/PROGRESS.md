# UniVerse — progress & next steps

_Last updated: 2026-09-23_

## Stage

**Feature-complete v1 prototype. Runs locally and has been tested, but is not deployed yet.** Every page in the
original brief is built and working. Security has been reviewed by six independent adversarial reviewers, and the full
test suite passes. What's left is getting it to real users: hosting, a real email sender, app-store packaging, and
trying it with actual students.

## What's built

| Area | Status |
|---|---|
| University-email sign-up (6-digit code, no passwords) | ✅ Personal and disposable emails refused; unknown colleges auto-created |
| Onboarding (email → code → profile → guidelines → follow suggestions) | ✅ |
| Home: **Reels · Buzz · Orbit**, swipeable like TikTok | ✅ |
| Reels (≤60 s, enforced by the server) — upload, likes, comments, share | ✅ 12 seeded demo videos |
| Buzz (anonymous posts, threads, polls, votes; per-thread aliases) | ✅ Moderated; the team can act without seeing identity |
| Orbit (only people/orgs you follow; posts, photos, polls) | ✅ |
| Discover (search, people you may know, active creators, orgs, profiles) | ✅ Public profiles only, never Buzz |
| Messages (DMs, groups, course chats, real-time, read receipts, requests) | ✅ |
| Roommates (post a listing, or just filter and see match %) | ✅ |
| Marketplace (sell / trade / free / wanted / lost & found, offers in chat) | ✅ |
| Apartments (coming soon + Get notified + engagement tracking) | ✅ Funnel shown in admin analytics |
| Campus hub (events, free-food tag, course chats, launch meter, invites) | ✅ Extra, beyond the brief |
| Notifications, Settings, Terms, Privacy, Community Guidelines | ✅ |
| Trust & Safety console (queue, blind author view, audited unmask, sanctions, appeals, analytics) | ✅ |

**Size:** about 28k lines of server code, 33k of client code, 15k of tests (35 files, 1,072 tests), and 6k of design and
spec docs.

## How it was verified
- The full server test suite passes, including `server/tests/hardening/**`. Those tests are the evidence left by
  reviewers who tried to unmask anonymous authors and break authorization; they found 45 real issues, all fixed.
- Both typechecks and the production build pass.
- Every screen was walked through by hand at phone size, as a student and as an admin.

## Next steps (suggested order)
1. **Try it yourself** and list what you'd change (names, colours, copy, anything that feels off).
2. **Hosting:** deploy the API plus SQLite on a persistent disk (Fly.io, Railway or Render), and the client as a static
   site. See README → "Going to production".
3. **Email:** create a Resend account and set `RESEND_API_KEY` and `MAIL_FROM`, so sign-in codes reach real inboxes.
4. **Staff:** set `STAFF_EMAILS` so you and your moderators can reach `/admin` in production.
5. **Pilot at one campus:** recruit 20–50 students and a few orgs before a wider launch; the launch meter and invite
   links exist for this.
6. **App stores:** wrap the web app with Capacitor for iOS and Android.
7. **Later, if you want:** push notifications, move from SQLite to Postgres when usage requires it, code-split the main JS
   bundle (656 kB, which is fine for now), and build the real Apartments listings.

## Decisions on record
- Web app first (installable PWA) and ready for app-store wrapping, rather than native code from day one.
- "UniVerse" and "Orbit" are working names; `APP_NAME` in `shared/src/core.ts` renames the app in one place.
- Your own buzzes keep the "You · Anon X" marker, so you can find and delete them.
- Admins can unmask a Buzz author only for threats or self-harm risk, with a written reason. Every unmask is
  permanently logged and alerts the other admins. Moderators never see identities.

## If the dev database breaks
"database disk image is malformed" means the dev database is corrupt. It only holds generated demo data, so stop the
server, then:

```bash
rm -f server/data/universe.db* && npm run db:reset
```
