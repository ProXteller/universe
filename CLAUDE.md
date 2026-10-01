# UniVerse — notes for Claude

Start with `docs/PROGRESS.md` (current state and next steps) and `README.md` (how to run it). The authority
chain for product and technical decisions is `docs/CONSTITUTION.md` > `docs/DECISIONS.md` > `docs/SPEC.md`.
`docs/FOUNDATION-NOTES.md` records where the foundation code deviates from SPEC; the code wins.

## Commands
- `npm run dev` runs the API on :4000 and Vite on :5173. The root script pins `PORT=4000` because preview tools inject `PORT`.
- `npm run db:reset` rebuilds the disposable dev DB at `server/data/universe.db`.
- `npm run typecheck`, and `npm test` (server vitest). On this 8 GB machine, run vitest with
  `--poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1`.
- Demo accounts: `maya.chen@utexas.edu` (student) and `admin@utexas.edu` (admin). The dev sign-in code is printed in the API log.

## Rules that must not regress
- **Buzz anonymity firewall** (Constitution §5):
  - Buzz rows leave the server only through `server/src/services/buzz/serialize.ts`: a per-thread alias, minute-floored times, and sealed cursors.
  - Moderators get blind author standing only.
  - Unmasking is admin-only, goes through one endpoint, requires a reason, and is audited.
  - `server/tests/hardening/**` guards all of this; never weaken those tests.
- All user text goes through `moderateText` / `moderateWrite` when it is written.
- Server code never calls `Date.now()` (use `server/src/lib/clock.ts`) and never touches the DB at import time.
- Client code uses UI-kit tokens only: no raw hex, no `position: fixed`, no `100vh`, no spinners, and `formatPrice` instead of a literal "$".
- Feature code lives in `client/src/features/<slice>/`, `server/src/routes/<slice>.ts` and `server/src/services/<slice>/`.
  Shared building blocks live in `client/src/{ui,components,lib,app}` and `server/src/lib`.

## Production
- Hosting: `deploy/README.md` (Azure for Students VM). The server redeploys itself from GitHub `main` every 2 minutes,
  with rollback if a build or start fails. Pushing to `main` = shipping.
- Live data is in `/var/lib/universe` on the server (DB + uploads). Schema changes must be additive (new tables /
  columns via an `onDbReady` upgrade, as in `server/src/services/buzz/schema.ts`); never drop or rename.
- Server tooling lives in `deploy/vm/`; after editing it run `node deploy/make-cloud-init.mjs`.
