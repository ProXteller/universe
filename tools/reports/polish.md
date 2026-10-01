# Polish list — orchestrator's browser walkthrough (375×812, demo student + admin), 2026-09-23

Already fixed by the orchestrator (do not redo; do not revert):
- F1 `client/src/components/MediaBox.tsx` — cached images stayed at opacity-0 forever (reset effect raced the load
  event). Every listing/post photo looked like a blank tile. State is now keyed by src + ref callback checks `complete`.
- F2 `client/src/ui/Avatar.tsx` — caller-added cut-out rings (`ring-4 ring-canvas`) drew as squares because the
  non-button wrapper had no radius. `radius` now on the shared wrapper classes.

To do (each item: owner, evidence, expected result):

P1 [ux · anonymity] Moderation-result sheet ("This can't be posted") opened from the Buzz composer renders in the
   public Aurora style (violet Edit button). Design + SPEC: sheets opened from Buzz inherit the incognito surface.
   Cause: `components/ModerationHost.tsx` is mounted by `app/AppShell.tsx`, outside the Buzz `<Surface mode="incognito">`.
   Fix in foundation: the host must render in the surface mode of the caller — e.g. `lib/moderation.tsx` records the
   mode at call time (pass-through option or read the active surface from `stores/home`/route) and ModerationHost wraps
   its sheet in `<Surface mode=…>`. Verify the Buzz composer and Buzz reply bar both show a Phosphor (lime) sheet, and
   Orbit/Market composers still show Aurora.

P2 [ux] Admin "Unmask this author?" dialog is taller than an 812px viewport and its top (icon + title) is clipped.
   Dialogs must cap at the frame height and scroll their body (check `ui/Dialog.tsx` for a max-height + overflow rule;
   fix there so every tall dialog benefits).

P3 [copy] Reel upload composer banner subtitle reads "Reels post from your public profile, @mayac…" (repeats the
   handle, truncates). Use the same subtitle as Orbit: "Visible on your public profile". Owner: reels slice.

P4 [seed quality] Buzz seed replies are unrelated to their parent thread (e.g. "The stickers were the best part of the
   flu shot." under a post about a helpful classmate). Replies must be written per thread topic so threads read like real
   conversations. Owner: buzz seed (`server/src/db/seeds/03-buzz.ts`). Keep ids buzz_0101/buzz_0102 and every §7.5
   invariant and counter; the buzz + admin + integration tests must stay green.

P5 [ux] Messages inbox: course-chat titles collapse to "M 4…" / "GO…" because the "Course" badge squeezes the title.
   Course codes are short and are the identity of the row — the title must never truncate below the full code; shrink
   or drop the badge text (icon-only) instead. Owner: messages slice.

P6 [safety · product] An escalated, BLOCKED critical threat against a specific person ("the guy in 3rd floor jester,
   i'm gonna k1ll you tomorrow") cannot be unmasked: `server/src/services/admin/queue.ts:418` requires
   `row.entity_id !== null`, and blocked text never becomes an entity. A blocked credible threat is the textbook case
   where the safety team needs identity. Allow admin unmask on anon-origin queue items whose source is blocked text AND
   whose category is threats/violence or self-harm-risk (not spam etc.), through the SAME endpoint and gate (reason
   code, ≥30-char reason, typed UNMASK, audit row, admin alert, 5-min re-mask). Moderators still never see it. Add tests
   (admin can, moderator 404, audit row written, non-threat blocked item still not unmaskable). Owner: admin slice
   (+ whatever foundation staff helper stores the blocked-text author, read-only if it already exists).

## Notes added after the hardening pass (read before starting)
- Hardening fixed 45 findings and added server/tests/hardening/** (6 files). Every one of them must stay green — run
  the ones near your files, and the gate runs them all.
- P1: hardening already taught `openShare` an optional `mode` (Buzz passes 'incognito') and `ReportHost` re-stamps the
  caller's surface mode. Make the moderation-result host follow the SAME pattern rather than inventing a new one.
- P6: hardening sealed Buzz-origin sanction ids (`sx_…`, AES-GCM) and made the staff views blind in more places
  (`staffStandingFor` status, `blindAuthorStanding`, lift route). Read tests/hardening/buzz-staff-firewall.test.ts
  first; the new unmask path must not reopen any of those leaks (moderators must still get 404 and see nothing).
- Decided by the orchestrator, do NOT implement: hiding "You · Anon X" marks on one's own buzzes (stays per SPEC §5.3).
