# Phase 4 final fixes

You are the implementer (see `AGENTS.md`).
Phase 4 and its review fixes are committed on branch `phase-4-agents` (HEAD `8a07ec9`, PR #7, CI green).
The last review passed with no CRITICAL or HIGH findings; fix the items below on the same branch.
Keep your context small: read only the files you change and use `sed -n` / `grep` for large files.

## A. MEDIUM - must fix

1. `CommLinks.tsx` `advanceClock`: `Math.max` never pulls back an interpolated clock that runs ahead of the backend by less than 1 s.
   If the backend advances slower than wall time times speed, the local clock drifts ahead until it crosses the 1 s threshold and then snaps back, so packets lead the robots and jump.
   After a reset that moves the clock back by less than 1 s, links whose `startedAt` is ahead of the stale clock appear late.
   Re-sync smoothly in both directions: on each snapshot, pull the local clock toward the snapshot clock (for example a damped correction of the error, never stepping backward by more than a frame's worth while running), and snap on a reset, on a demo restart, when not running, or when the error is large (about 0.25 s).
   Add a pure helper for this and headless checks in `scripts/tests/agents.ts`: backend slower than wall time does not drift past a small bound, a backward reset smaller than 1 s re-syncs within a few frames, pause snaps.
2. Functions over about 60 lines in files touched by phase 4: `scripts/tests/agents.ts` (`runGaitSuite` about 131 lines, `runRigSuite` about 111, `runAnimatorSuite` about 101) and `AgentLabelsOverlay.tsx` (the component about 175 lines, its effect about 105, the tick about 66).
   Split them into focused functions (for example sub-suites per concern, and `measureBubbles`, `readAnchors`, `writeBubbles` helpers for the overlay) without changing behaviour.

## B. LOW - fix

3. Nothing checks that `AgentCharacter.tsx` passes `legLength(rig)` to the animator; a revert there would not be caught.
   Move the "rig to animator input" step into a small pure function (for example `animatorInputsFor(rig)` in `agentRigs.ts`) used by `AgentCharacter.tsx`, and test it per role.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build in headless Chromium with real CDP input, reusing `.opencode-logs/phase4-fixes/cdp.mjs`, `interaction-test.mjs` and `demo-run.mjs`: interaction test 0 failures, demo at 1x and 4x completes in order (Orion, Piper, Iris, Kai, Quinn fail, Kai, Quinn pass, Rex, Orion), a comm arc screenshot in `.opencode-logs/phase4-final-fixes/` with packets moving smoothly from sender to receiver, console clean except fiber's `THREE.Clock` deprecation.
- Do not commit.
