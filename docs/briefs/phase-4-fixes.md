# Phase 4 fixes

You are the implementer (see `AGENTS.md`).
Phase 4 (`docs/briefs/phase-4.md`) is built but not committed; the working tree on branch `phase-4-agents` holds your previous run.
The independent code review returned FAIL (one HIGH), and the reviewer's browser pass found visual problems.
Fix everything below in place, then re-verify.
Re-read the three.js skill files listed in `AGENTS.md` before you change 3D code.

## A. HIGH - must fix

1. Esc does not release follow mode.
   `AppShell.tsx` (around lines 120-128) returns early when the key event target is inside a `button`, and the `escape` case (around line 154) sits after that guard.
   Follow is turned on with the Follow button in `AgentDetails.tsx`, and focus stays on that button, so the next Esc is dropped.
   Handle `Escape` before the focused-control guard (it never conflicts with a button): release follow (and keep the existing Esc behaviour for selection), then return.

## B. MEDIUM - must fix

2. Follow is released by any pointer-down or wheel, not only by a drag (spec 6.6, pitfall 9).
   `CameraController.tsx` releases follow in OrbitControls `onStart`, which three r186 fires on every mouse down and every wheel tick, so a plain click on the followed robot or a zoom ends follow.
   Release follow from the shared 5 px gesture tracker (`pointerGesture.ts`) once a drag is detected. Keep `onStart` only for cancelling an active camera goal. Zooming while following must keep following.
3. Camera requests made while following are undone after they settle.
   A preset, or a focus on a different agent, flies the camera there, then the follow branch pulls it back to the followed agent with the preset's offset.
   Clear `followAgentId` when a preset or a focus on another agent is requested (in the request handling or in `requestCamera`). Keep follow only when the focus is for the agent being followed.
4. Legs lean with the torso and feet lift off the floor while walking.
   Legs, feet and hip joints are children of the leaning body matrix, so any lean swings the feet back and up (error slump about 12 cm, working lean about 8 cm).
   While walking, the rigid legs lift each foot about 8 cm at full stride and `bodyLift` peaks at the same moment, so both feet are about 10 cm off the floor at every stride peak; at 4x the speed ratio cap makes the feet slide.
   Build a pelvis matrix (root plus vertical bob, no lean) and attach legs, feet and hip joints to it; apply lean only to torso, arms and head.
   While walking, lower the pelvis by `hipHeight * (1 - cos(swing))` instead of raising it, so the planted foot stays on the floor.
   Make stride length follow ground speed at every sim speed so feet do not slide.
5. Allocations inside `useFrame`.
   `Color.set(string)` parses the string every call: `AgentCharacter.tsx` (`scratchColor.set(profile.color)` 6x per frame, `"#000000"`) and `CommLinks.tsx` (`"#000000"` up to 12x per frame).
   Precompute one `THREE.Color` per profile at module scope and use `setRGB(0, 0, 0)` for black. Also reuse `scratchColor` in the setup loop instead of `new THREE.Color("#ffffff")` per iteration.
6. Speech bubbles trail the robots by one frame.
   The overlay's `requestAnimationFrame` loop starts before fiber's loop, so it always reads the anchors written in the previous frame and lags during orbit and follow.
   Drive the DOM update with fiber's `addAfterEffect` (exported by `@react-three/fiber`) so it runs after the anchors are written in the same frame. Still one per-frame loop, still no React re-render per frame.
7. Comm links with a WebSocket backend: expired links stay drawn and links beyond the cap are dropped.
   Skip links where `clock < startedAt` or `clock >= endsAt`, and fill the slots from the newest links (the protocol allows up to 64; the mock peaks at 2).
8. `AgentCharacter.tsx` is 1025 lines (limit 800) and its `useFrame` is about 350 lines.
   Split it: the accessory layout (`roleAccessories`, `buildAccessoryLayout`) into a pure module, a `writeRobotMatrices(agentIndex, pose, rig)` function, and `writeRings` / `writeLabelAnchor` functions.
   Precompute the static accessory local matrices once instead of calling `trs()` on about 70 slots every frame.

## C. Browser review - visual (must fix, compare against `01-overview-sprint.jpg` and `02-demo-qa-fails.jpg` yourself)

9. Robots are too small.
   At the overview preset a robot is only as tall as a desk monitor; in the reference the head clearly rises above the monitors and a robot is about 0.65x a desk's width tall on screen (ours is about 0.4x).
   The top of the head is about 1.45 m today while the label anchor is at 1.88-1.99 m, so bubbles float well above the heads.
   Make the robots read like the reference: head top around 1.75-1.85 m after the rig scale (keep the per-role scale range 0.96-1.12 and the distinct silhouettes), and keep the label anchor just above the head (about 0.1-0.15 m clearance).
   Update the rig sanity checks in `scripts/tests/agents.ts` accordingly.
10. Robots stand inside the desk chairs.
    With a robot selected at its desk (for example Quinn at the QA Lab), the chair back overlaps the robot torso, and the working pose puts the hands through the chair back while the keyboard stays out of reach.
    Rearrange the desk so a standing robot at its station point faces the desk with nothing between it and the keyboard: for example drop the chair or move it aside, and place the station point so the typing hands land on the keyboard. Check it from the Research and Development presets and with a robot selected.
11. Robots stand on the collaboration stools.
    The destination rings at the collaboration table sit right under the stools, so robots end up inside them.
    Place the stools between the ring slots of `worldLayout.ts` (or just outside them) so every slot is free floor; robots must never intersect furniture at any ring slot (collab table, lounge, hub, planning board). Check every shared location during the demo and the sprint.

## D. LOW - fix

12. Comm packets move in steps and jump: `CommLinks.tsx` reads the snapshot clock directly (30 Hz) and `(progress + k / 3) % 1` makes packets jump from receiver back to sender mid-link.
    Advance a locally interpolated clock (delta times speed while running, re-synced on each snapshot) and launch the packets staggered without wrapping.
13. Selecting an agent from a panel does not focus the camera (`AgentsPanel.tsx`, `OverviewPanel.tsx`, `StationDetails.tsx` only call `selectAgent`). Spec 6.6: selecting an agent requests a focus at distance 7.5. Make every agent selection path do the same as the 3D click.
14. `labelAnchors.ts` `getLabelAnchor` duplicates `labelAnchorFor`; keep one.
15. The `PanelProfiler` wrapper in `AppShell.tsx` is always mounted; render it only when the `?debug` probe is on.
16. The success/error pulse advances by sim delta, so a pause freezes a bright ring and its duration shrinks with sim speed. Use the animator's 0.15x frozen scale and a real-time duration.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- Real browser (headless Chromium with real CDP mouse and key input) at 1440x900 and 390x844:
  - Run the demo at 1x and 4x to the end; the sequence Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion must be visible.
  - Follow: click Follow, press Esc with focus still on the button -> follow released; click the followed robot -> still following; wheel-zoom -> still following; drag > 5 px -> released; preset while following -> follow cleared and the preset stays.
  - Screenshots in `.opencode-logs/phase4-fixes/`: overview mid-demo, QA failure moment, comm arc in flight, a robot working at its desk from the Development preset, robots at the collaboration table, a selected robot with its bubble, `?quality=low`, mobile overview.
    Compare them with the reference screenshots and fix anything that still looks off (scale, furniture intersections, feet off the floor, bubble gap).
- Draw calls at overview with the demo running, high and low (high under 150).
- Console with StrictMode: no errors or warnings except fiber's `THREE.Clock` deprecation.
- Do not commit.
