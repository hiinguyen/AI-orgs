# Phase 4 review fixes

You are the implementer (see `AGENTS.md`).
Phase 4 is committed on branch `phase-4-agents` (commit `4aa33ea`, PR #7) and passed review with no CRITICAL or HIGH findings.
Fix the remaining findings below on the same branch, then re-verify.
Only touch the phase 4 files named here unless an item says otherwise.
Keep your context small: read only the files you change and use `sed -n` / `grep` for large files.

## A. MEDIUM - must fix

1. The gait uses the unscaled leg length.
   `AgentCharacter.tsx` passes `rig.hipHeight` to the animator, but the root matrix applies `rig.scale`, so the drawn leg is `hipHeight * scale`.
   For Orion (scale 1.12) the stride is 12 % short, so the feet slide at 1x, and at 2x the needed cadence is clipped.
   Pass `rig.hipHeight * rig.scale`, and if 2x needs more than the 8 steps/s cap for any rig, raise the cap just enough that every rig stays planted at 1x and 2x.
   Add a per-rig check in `scripts/tests/agents.ts`: for every role, stride times cadence equals the ground speed at 1x and 2x (no slide).
2. `AgentLabelsOverlay.tsx` reads `offsetWidth` / `offsetHeight` for each bubble inside the per-frame tick, interleaved with style writes, which forces a layout every frame.
   Cache each bubble's size (a `ResizeObserver`, or re-measure only when the bubble's text or visibility changes) and do all reads before all writes in the tick.
3. Three frame callbacks are over 60 lines: `CommLinks.tsx` (about 157), `PathTrail.tsx` (about 81) and `CameraController.tsx` (about 94).
   Extract focused functions (for example `selectLinks`, `writeRibbon`, `writePackets` in `CommLinks`, a trail writer in `PathTrail`, `followStep` and `goalStep` in `CameraController`) so no function is over about 60 lines.
   Behaviour must not change.

## B. LOW - fix

4. The walk swing amplitude steps from 0 to about 0.12 rad when the speed crosses 0.02 m/s (`walkAmplitude` in `AgentAnimator.ts`); ramp it smoothly from 0 over the first 0.1 m/s.
5. `CommLinks.tsx` builds its slot geometries and meshes at module scope and never disposes them; create them per mounted component (ref or `useMemo`) and dispose them in the effect cleanup, StrictMode-safe.
6. `CommLinks.tsx`: the interpolated clock can jump backward when a snapshot clock is slightly behind it; while running, re-sync with `Math.max`, and snap only on a large jump (reset, demo restart) or when not running.
7. `AppShell.tsx` `PanelProfiler` switches between a fragment and `<Profiler>` when the `?debug` probe flips after hydration, which remounts the side panel; always render the same element tree and gate only the `onRender` work.
8. Follow reads `agentVisuals` from the previous frame because the camera controller runs before the characters.
   Either keep it and add a one-line comment that the lag is one frame by design, or run the follow step after the characters write their visuals, without breaking the single OrbitControls update.
9. `scripts/tests/agents.ts` `runAgentsSuite` is about 400 lines; split it into per-topic suites (rigs, animator, gait, layout, labels) called from the same entry point.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input, reusing `.opencode-logs/phase4-fixes/cdp.mjs`, `interaction-test.mjs` and `demo-run.mjs`:
  - `interaction-test.mjs` passes with 0 failures.
  - Demo at 1x and 4x completes in order: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion.
  - Screenshots in `.opencode-logs/phase4-review-fixes/`: Orion walking close up at 1x (feet planted), a comm arc in flight, a selected robot with its bubble. Look at each one.
  - Peak draw calls at overview with the demo running stay under 150 in high.
  - Console with StrictMode: no errors or warnings except fiber's `THREE.Clock` deprecation.
- Do not commit.
