# UniVerse

The campus super-app. Sign-up requires a university email address.

- **Home**: three swipeable tabs.
  - **Reels**: vertical videos, 60 seconds max.
  - **Buzz**: anonymous posts and threads, moderated by the team. Campus and Global are separate feeds; search,
    titles, photos and one video per buzz.
  - **Orbit**: posts from the people and orgs you follow (any campus), plus popular and official posts from your own
    campus, labelled so you know why they're there.
- **Discover**: search and people you may know. Only real public profiles appear here, never Buzz.
- **Messages**: DMs, groups and course chats, in real time.
- **Roommates**: post that you're looking, or just set filters and see your match %.
- **Marketplace**: buy, sell, trade, free, wanted, lost & found.
- **Apartments**: a coming-soon page with a Get notified button, plus engagement tracking.
- Also: a Campus hub (events, course chats, launch meter), Notifications, Settings, and a Trust & Safety console for staff.

## Run it

Requires Node 22.

```bash
npm install && npm --prefix server install && npm --prefix client install
```

```bash
npm run db:reset
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on :4000 and Vite proxies to it.

No email provider is configured in development. Sign-in codes are printed in the API console, and the code screen also
has a **Fill** button.

| Account | Email | What you'll see |
|---|---|---|
| Demo student | `maya.chen@utexas.edu` | A full campus world: feeds, 7 unread notifications, DMs with a pending offer, roommate matches |
| Admin | `admin@utexas.edu` | `/admin`: moderation queue, blind author standing, unmask with reason, audit log, analytics |
| Moderator | `mod@utexas.edu` | The same queue, but no unmask button (the endpoint returns 404) |

Any `*.edu`, `*.ac.<cc>` or `*.edu.<cc>` address works for a new sign-up. An unknown college is created automatically.
Gmail, Outlook and disposable-email addresses are refused.

## Use it on your phone (same Wi-Fi)

```bash
npm run dev:phone
```

The terminal prints a `Network:` address, for example `http://192.168.1.222:5173`. Open that address in Safari or
Chrome on a phone connected to the same Wi-Fi. To get an app icon, tap Share → **Add to Home Screen**; the app then
opens full-screen with no browser bars.

- The Mac must be awake and running `npm run dev:phone`. If the Mac's network address changes, the terminal prints the new one.
- Anyone on the same Wi-Fi can reach it, so use it on your home network, not on public Wi-Fi.
- To use it away from home, it needs to be hosted (see "Going to production").

## Check it

```bash
npm run typecheck
```

```bash
npm test
```

`npm test` runs the server suite: 35 files and more than 1,000 tests. That includes `server/tests/hardening/**`, where
attackers tried to unmask Buzz authors and break authorization. Every finding they made is now a passing regression test.

## How Buzz anonymity works

- Buzz rows store the author **for moderation only**. Only one serializer turns a Buzz row into JSON, and it outputs a
  per-thread alias ("Anon Eclipse") derived from an HMAC of the thread and the user. The same person gets a different
  alias in every thread.
- Timestamps are floored to the minute, cursors are encrypted, and campus names are hidden for campuses under 50 users.
  Buzz notifications never include who acted.
- Moderators act on content through a **blind** author record: counts only, and no identifier of any kind.
- Only an **admin** can unmask, through one endpoint. It requires a reason code, a written reason and typing UNMASK.
  Every unmask writes a permanent audit row and alerts the other admins.

## Going to production

**Free hosting, step by step:** see [`deploy/README.md`](deploy/README.md). One paste creates an Azure for Students
server (no credit card) that serves the app over HTTPS, keeps the data, backs it up nightly and redeploys itself on
every `git push`.

Set these environment variables for the server:

| Variable | Why |
|---|---|
| `NODE_ENV=production` | Turns off the dev inbox and requires real secrets |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends the sign-in codes. Without them, sign-up returns 503 instead of silently failing |
| `STAFF_EMAILS` | `you@yourco.com:admin,mod@yourco.com:moderator`. These exact addresses can sign in without a university email, so your team can moderate |
| `BUZZ_ALIAS_SECRET`, `CURSOR_SECRET` | Long random strings. Keep them stable; rotating the alias secret changes every alias |
| `DB_PATH` | Where the SQLite file lives (put it on a persistent disk) |
| `UPLOADS_DIR` | Where uploaded photos and videos are stored (same persistent disk; default `server/uploads`) |
| `TRUST_PROXY` | Set this when running behind a load balancer, so rate limits see real client IPs |
| `MODERATION_AI_API_KEY` (optional) | Enables a second-pass AI classifier on top of the built-in rule engine. It can only escalate, never allow |

The client is a static build (`npm run build` produces `client/dist`). It is an installable PWA and is ready to wrap
for the App Store / Play Store with Capacitor.

## Layout

```
docs/        CONSTITUTION.md (locked decisions) · SPEC.md (contracts) · DECISIONS.md · blueprint/
shared/src/  types shared by client and server
server/      Express + SQLite + WebSocket API; one router per feature (routes/<feature>.ts)
client/      Vite + React 19 + Tailwind v4; one folder per feature (src/features/<feature>/)
tools/       reel-studio (generated the 12 seed videos), manifest.mjs, build workflows and reports
```
