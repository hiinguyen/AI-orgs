# Phase 3 review fixes

You are the implementer (see `AGENTS.md`).
Phase 3 is committed on branch `phase-3-world` (commit `8c18b76`).
This list merges the independent code review and the reviewer's browser review against `docs/spec/reference-screenshots/01-overview-sprint.jpg`.
Fix everything below, then re-verify.
Only touch phase 3 files (`src/world/`, `src/components/panels/StationDetails.tsx`, and the station bits of the store) unless an item says otherwise.
Re-read the three.js skill files listed in `AGENTS.md` before you change 3D code.

## A. Code review - MEDIUM

1. Half the skyline is invisible.
   In `OfficeEnvironment.tsx` towers go back to about z = -154, but the opaque, depth-writing sky plane sits at z = -78, so about 132 of 260 towers (high) and 36 of 120 (low) are hidden.
   Keep every tower row in front of the sky plane (for example 24-26 columns and `spacingZ` around 5-6 so the last row ends near z = -70), or move the sky plane back while keeping it inside the camera far plane (220) at the overview distance.
   The visible count must match spec 6.2 (~260 high, ~120 low).
2. Eight point lights are always on.
   `Lighting.tsx` has 1 hub, 6 desk and 1 collab point light in both quality paths.
   In `low`, drop the per-desk lights and keep hub + collab; the desk glow-pool sprites carry the look.
   In `high`, replace the 6 desk lights with 2-3 zone lights (research, development) unless the per-desk version is clearly needed to match the reference.
3. Empty-space click only clears the selection within 2 px.
   Fiber calls `onPointerMissed` only when its own delta <= 2, while desk clicks use the 5 px gesture, so the two disagree.
   Clear the selection from the DOM click path in `pointerGesture.ts` when the gesture was not a drag and no station handler consumed the click (for example a flag the R3F `onClick` sets).
   Do not rely on `onPointerMissed` for this.
   Spec 6.1 and pitfall 9: click only if movement <= 5 px.
4. OrbitControls is updated twice per frame.
   drei's `OrbitControls` already calls `controls.update()` in its own `useFrame`; the manual `controls.update()` in `CameraController.tsx` (around line 280) doubles the damping step.
   Remove it; if ordering matters, give the controller's `useFrame` a priority that runs before drei's and let drei do the single update.

## B. Browser review - visual (must fix, compare against the reference yourself)

5. The skyline reads as fine noise with vertical light streaks.
   The reference shows distinct tower blocks with large, clearly separated lit windows (roughly 3-5 % of the screen width per window column at overview).
   Make window cells much larger (or set the texture repeat per tower from its size so cells stay a constant world size), add dark gaps between towers, and remove the thin vertical streaks visible above the back wall.
6. The floor is near black with no visible tiles.
   The reference shows large-format tiles (about 1.5 m) with visible seams and a cool blue tint lit around the hub.
   Use about 1.5 m tiles with stronger seams, and raise floor albedo / hemisphere fill so the floor reads blue-grey, not black, without washing out the desks.
7. Selecting a station centers the desk in the whole canvas, not in the free area.
   At 1440x900 with the side panel open, the focused desk lands at x ~ 720 px while the free area (between nav rail and side panel) is centered at about x ~ 520 px, so the neighbouring desk slides under the panel.
   Focus moves (station and agent) must put the focus point at the center of the free area from `viewInsets`, same as the overview preset does.
   One way: shift the camera and target together sideways (and vertically) by the world offset that maps the canvas center to the free-area center at the goal distance.
8. Mobile 390x844: the front half of the office (collaboration table, lounge) is hidden behind the camera bar and bottom sheet.
   After the fit, the whole office floor from back wall to front edge must be inside the free area between the top bar and the camera bar, with the hub near its vertical center.
9. The camera only refits on window resize.
   Subscribe to `viewInsets` changes (store subscription) under the same "no user interaction and no explicit camera request" guard, and read the size from `useThree((s) => s.size)` instead of `window.inner*`.
   On mobile the bottom sheet height changes with the tab content, so this is visible.
10. The Mission Control wall is too small and too low-contrast to read at overview.
    In the reference it is a wide, clearly readable board (bar chart of the workflow phases plus the agent roster) spanning roughly a fifth of the back wall at overview.
    Make it larger and brighter (emissive), keep it static content for now.
    Do not print "SIMULATION MODE" or "Deterministic local simulation" on it unconditionally: either read `backend.simulated` from the store or leave the mode out.
    Build the roster from `AGENT_BY_ID` instead of hard-coded names and colors.

## C. Code review - LOW

11. Focus logic is duplicated: `StationDetails.tsx` repeats `stationFocusPoint` and the distance `8.5` from `InteractionManager.tsx`.
    Export one `focusStation(id)` helper and use it in both places.
12. `envMapIntensity` set on materials in `sharedResources.ts` does nothing in r186 (they light from `scene.environment`).
    Delete those values and tune `environmentIntensity` on `<Environment>` instead.
13. Add the shared pool entries spec 6.8 lists that are missing: geometries `capsule` and `ring`, materials `ceramic`, `joint` and `screenOff`.
14. The dust-mote geometry built in `useMemo` is never disposed.
    Add `useEffect(() => () => geometry.dispose(), [geometry])`; check every other per-instance geometry/material/texture for the same.
15. Remove the redundant `useMemo` around `sharedMaterial` in `Workstations.tsx` and the stray blank line inside the `<group>` near the end of that file.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- Headless Chromium at 1440x900 and 390x844: re-take overview, all four other presets, `?quality=low`, and a station selected with the side panel open.
  Save them in `.opencode-logs/phase3-fixes/`, compare against `01-overview-sprint.jpg` and fix what still looks off.
- Report draw calls at overview for high and low (must stay under 150 in high).
- Console: no errors or warnings except fiber's `THREE.Clock` deprecation, with StrictMode on.
- The demo still completes with the HTML UI working.
- Do not commit.
