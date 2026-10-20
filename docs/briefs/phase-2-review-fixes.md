# Phase 2 review fixes

You are the implementer (see `AGENTS.md`).
Phase 2 is committed on branch `phase-2-ui` (PR #3).
This list merges the independent code review and the reviewer's browser review.
Fix everything below, then re-verify.

## A. Live backend connection (issue #4) - HIGH

1. After a successful open, a dropped socket is invisible: `onclose` in `src/integrations/WebSocketAgentBackend.ts` only nulls the socket and rejects pending acks, so the store keeps `backend.connected: true` and `error: null`.
   Add a connection-status subscription to the backend, mirror it into the store in `connectBackend` (`connected: false`, an error message), and show it in the top bar and Settings.
   Reconnect with capped exponential backoff (for example 0.5 s doubling to 10 s) while the client is still mounted; stop on dispose. A fresh snapshot from the server replaces local state.
2. Auto-start is lost in websocket mode because `sceneReady` flips before the socket opens. Run `autoStartIfReady` only once connected (and keep it a no-op for the live backend if the server is already running).
3. Connect race under StrictMode: each attempt's settle handlers may only clear `this.connecting` when `this.connecting === attempt`. `disconnect()` must detach `onopen/onmessage/onerror/onclose` from the old socket so a closing socket cannot deliver snapshots afterwards.
4. Bounds on untrusted input: reject messages over 1 MB before `JSON.parse`; cap array lengths (agents <= 16, tasks <= 500, subtasks/findings/history <= 100 each, path points <= 256, links <= 64); require unique agent ids. Over-limit messages are dropped with one `console.warn`.
5. The task dialog footer must say "Live backend" wording instead of "Simulation mode" when the backend is not simulated.
6. Headless checks with a fake WebSocket: drop after open -> status listener reports disconnected and pending acks reject; reconnect succeeds after backoff; oversized and duplicate-agent snapshots are rejected; a stale attempt cannot clear a newer `connecting`.

## B. Keyboard and React - MEDIUM / LOW

7. Space shortcut hijacks focused controls (reproduced: focus the Reset button, press Space -> the simulation pauses instead of the button activating). In `AppShell.tsx`, skip the global shortcuts when the event target is inside `button, a, [role=radio], [role=tab], [role=dialog], input, textarea, select, [contenteditable]`.
8. `SidePanel.tsx` subscribes to the whole `events` array and runs `feedEvents(events)` on every tab. Use a selector that returns only what the visible tab needs (a number for the Activity badge).
9. Relative times go stale while paused because `clock` is not part of the mirror signature. Push the mirror when the clock advanced by at least 1 s since the last push (still throttled), or render relative times from a 1 s ticker, whichever is simpler and keeps pitfall 7 intact.
10. Reset confirm: after Cancel or Confirm, return focus to the Reset button.
11. Task dialog: guard the async submit with a mounted/open ref so a late ack cannot close a re-opened dialog or move the camera.
12. Add `aria-live="polite"` to the activity feed list (Overview "Latest activity" and the Activity tab), announcing only newly added rows.

## C. Visual - reviewer browser pass

13. Task cards un-tick on rework: in iteration 2 the card list showed 4/6 done although all 6 were done after iteration 1. Subtask `done` must be monotonic: rework never unchecks a card (engine `tickSubtasks`; add a headless check). Make sure the demo finish clock in `npm test` stays identical.
14. Side panel is about 478 px wide at a 1440 px viewport. Spec 7.2 says 380-400 px on desktop; clamp it.
15. The "STATUS" metric label sits a few px lower than "AGENTS / ACTIVE / PENDING / COMPLETED" on desktop and mobile. Align all five labels and values on the same baselines.
16. The running status dot shows an offset outline ring next to "Running" (visible on mobile). Make `.pulse-dot` a centered dot whose pulse ring is concentric and animated, and static under reduced motion.
17. Activity rows for system events show a tiny grey dot where the avatar is, next to the severity dot, which reads as a double bullet. Give system rows a proper system avatar the same size as agent avatars.
18. At wide viewports the top bar metrics float far from the title (screenshot 01 puts them right after the title). Keep the metrics group directly after the title and push only the controls to the right.

## D. File size

19. `scripts/simulate.ts` is 1112 lines (limit 800). Split it into cohesive test modules under `scripts/tests/` (engine, workflow, backend, store) run by `scripts/simulate.ts`, keeping the single `npm test` entry and the check-mark output.
20. `src/integrations/WebSocketAgentBackend.ts` is 787 lines. Move the message parsing and validation into `src/integrations/wsProtocol.ts` so the transport class stays focused.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- The unpaused demo still completes at the same clock as before.
- Open the app with `npm run dev`, check items 7, 10, 13-18 in the browser at 1440x900 and 390x844, and report what you saw.

Do not touch anything outside this list and do not commit.
Print a short report per item.
