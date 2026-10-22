# Phase 4 fixes, round 2

You are the implementer (see `AGENTS.md`).
Phase 4 (`docs/briefs/phase-4.md`) and the first fix list (`docs/briefs/phase-4-fixes.md`) are built in the working tree on branch `phase-4-agents`, not committed.
The previous run finished almost everything but its session ended during the final screenshots.
The reviewer re-ran the gates and a real-input browser pass: the interaction items (Esc, drag, wheel, preset, panel focus) all pass, the demo completes, draw calls peak at 120 in high, the console is clean.
What is left is below.
Do not redo work that already passes; keep every item of `phase-4-fixes.md` working.
Re-read `.claude/skills/threejs-animation/SKILL.md` and `threejs-materials/SKILL.md` before you change the animator or the arc material.

## A. HIGH - must fix

1. The walk cycle does a split at speed and its phase jumps.
   - `AgentAnimator.ts` `walkingPose` computes `phase = time * cadence * PI` with the ever-growing `elapsed`, so every frame-to-frame change of the measured speed shifts the phase by `elapsed * deltaCadence` (several radians after a minute), which makes the legs snap.
     Keep an integrated walk phase in the `AgentAnimator` instance (`walkPhase += cadence * PI * step` on every update) and pass it to the pose function instead of `time`.
   - The swing amplitude grows to 1.15 rad (about 66 degrees) with speed, so at 4x a walking robot does a split with its arms horizontal (seen in the 4x demo at the Collaboration preset).
     Cap the leg swing at about 0.5 rad and the arm swing at about 0.45 rad, and cap the step rate at about 4 steps per second.
     Below the caps the stride must match ground speed (no foot slide at 1x and 2x); above them (4x) the legs run at the cap and a little slide is accepted.
   - Add regression checks in `scripts/tests/agents.ts`: phase continuity over a speed ramp (no per-frame phase jump larger than `cadenceCap * PI * step` plus a small epsilon), amplitude never above the caps at any speed up to 4x the walk speed, and no slide at 1x walk speed.

## B. MEDIUM - must fix

2. The comm arc renders as a thick, blown-out white line.
   In `02-demo-qa-fails.jpg` and `01-overview-sprint.jpg` the arc is a thin line in the sender's colour with small glowing packet dots travelling along it.
   Ours is pure white (the colour is pushed past 1 or added on top of white and saturates through tone mapping) and much thicker; the packets are not visible.
   Make the arc read clearly in the sender's colour at every preset (a slight glow is fine, white is not), about the thickness of the reference (`assign` slightly thicker), and make the 2-3 packets visible as small bright dots in the same colour.
   Check it against the reference at the overview and Collaboration presets.
3. Follow mode tracks the simulation position, not the drawn robot.
   `CameraController.tsx` follows `agent.position` from the snapshot, while the robot is drawn at the separately damped `agentVisuals[id]` position, so the robot wobbles on screen during follow.
   Follow `agentVisuals[followId]` (x, z) instead.
4. Finish the split of item B.8.
   The `useFrame` in `AgentCharacter.tsx` is still about 200 lines and `writeRobotMatrices` in `robotRig.ts` about 155.
   Extract focused functions (for example `updateVisualMotion(visual, agent, delta)` for position, heading, speed and pulse, a ring-energy helper, and per-part writers for legs, torso, arms, head and accessories) so no function is over about 60 lines.
   Behaviour must not change.
5. Typing hands are too far apart.
   At the desk the hands sit outside the shoulders, wider than a keyboard.
   Bring them to about 0.3-0.35 m apart over the keyboard with the forearms pointing forward, and check it from the Development preset and with the robot selected (focus 7.5).

## C. LOW - fix

6. `sharedResources.ts`: `buildChair` and `geometries.chair` are unused since the chairs were removed; delete them.
7. `CommLinks.tsx` takes the newest links by array order; sort the candidate links by `startedAt` (descending) instead of relying on the backend's order, without allocating per frame (reuse a module-level index array).
8. `AppShell.tsx` `PANEL_RENDER_PROBE` is `false` during server rendering and may be `true` on the client; read the `?debug` probe in an effect or state so the first client render matches the server.
9. `npm run build` warns that Next.js ignored `/home/hii/package-lock.json` and asks for `turbopack.root`.
   Set `turbopack.root` in `next.config.ts` to the project directory so the build prints no warning.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input.
  The helper scripts in `.opencode-logs/phase4-fixes/` (`cdp.mjs`, `interaction-test.mjs`, `demo-run.mjs`) still work; reuse them.
  - Demo at 1x and at 4x to the end: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion.
  - Screenshots in `.opencode-logs/phase4-fixes-2/`: a walking robot at 1x and at 4x close up (Collaboration preset, mid-stride, legs must stay a natural stride with both feet near the floor), a comm arc in flight at overview and at the Collaboration preset, a robot typing at its desk with the robot selected, follow mode while the robot walks.
    Look at each one and compare it with the reference screenshots; fix what still looks off.
  - `interaction-test.mjs` passes (its last check must click the nav-rail Overview tab, `nav` with `aria-label="Primary"`, not the camera preset of the same name).
- Draw calls at overview with the demo running stay under 150 in high.
- Console with StrictMode: no errors or warnings except fiber's `THREE.Clock` deprecation.
- Keep your context small: read only the files you change, and use `sed -n`/`grep` for large files.
- Do not commit.
