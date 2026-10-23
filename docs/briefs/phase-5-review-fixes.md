# Phase 5 review fixes

You are the implementer (see `AGENTS.md`).
Phase 5 (`docs/briefs/phase-5.md`) is built in the working tree on branch `phase-5-live-boards`, not committed.
The reviewer re-ran the gates (all pass, 200 checks), `interaction-test.mjs` (0 failures), the demo at 1x and 4x (correct order, peak draw calls 125 / 133 in high, console clean) and an independent code review.
Fix the items below without redoing work that already passes.

Status (paused on 2026-10-23 at the user's request, committed as a work-in-progress commit):
- A first run reproduced item 1 in the browser (`.opencode-logs/phase5-review-fixes/repro-before-pan-down-1.jpg`: board face fully in view, all 12 cards gone after panning down) and then started the fixes.
- It was stopped while splitting `Desks.tsx` (item 5): `npm run typecheck` and `npm test` (208 checks) pass, `npm run lint` fails in `Desks.tsx` ("Cannot access refs during render", "Cannot modify local variables after render completes").
- When resuming: check every item below against the tree (some may be done or half done), fix the lint errors without reading refs during render, then run the full Verify list; nothing after the repro has been verified in the browser yet.

Context budget (mandatory): never Read a full-size screenshot more than once.
To inspect a detail, crop it with PIL to a region of at most 800 px wide and read the crop; keep total image reads under about 15.
Use `sed -n` / `grep` for large files and check state numerically through `window.__AAW_DEBUG_STATE__` and `__AAW_DRAW_CALLS__` where you can.
Re-read the "Common Mistakes" of `.claude/skills/threejs-performance/SKILL.md` and `threejs-textures/SKILL.md` first.

## A. HIGH - must fix

1. Planning cards can be frustum-culled by a stale, empty bounding sphere.
   `PlanningBoard.tsx` sets `mesh.count = 0` before the first render, so in three r186 `InstancedMesh.computeBoundingSphere()` runs once with no instances and caches an empty sphere at the group origin; nothing recomputes it and `frustumCulled` is on.
   When the board is in view but that origin is near or outside a frustum plane, the cards vanish (and they can drop out of the shadow pass).
   First reproduce it in the production build with real CDP input (orbit or zoom so the board stays in view while its floor origin leaves the frame) and record the card visibility before the fix.
   Fix it at the root: recompute the bounding sphere after each card write (or give the mesh a fixed sphere that covers the board face), then confirm with the same camera framing that the cards stay drawn.
   Also create the instance colour attribute up front (before the first render) so the first card does not force a shader recompile.

## B. MEDIUM - must fix

2. The cards disappear the moment the task finishes.
   `planningContent.ts` keeps only `isActiveTask` tasks, so at `done` the board empties and the "after the task is done (done tint)" state of the brief never shows.
   Rule: cards come from the active tasks as now; when there is no active task, show the newest finished task's cards (done in the muted green, failed subtasks in a muted red if the model has them) until a new task becomes active.
   Add checks in `scripts/tests/boards.ts` for this rule (done task with no active task keeps its cards; a new active task replaces them).
3. The Mission Control header subtitle overlaps the title.
   At overview the small subtitle text starts on top of the last letters of "MISSION CONTROL".
   Place it from the measured title width (`ctx.measureText`) plus a gap, or on its own line, and check every text block on the wall for overlap or clipping at the longest realistic content (long task titles, 4 active tasks, all roster statuses).
4. `Desks.tsx` writes the floor-pool `setColorAt` and `instanceColor.needsUpdate = true` every frame for all 8 stations, even when every level has settled.
   Skip the write when no level moved by more than a small epsilon this frame.
5. `Desks()` is about 156 lines; split it (for example a `useScreenGlow` hook and the instanced-mesh JSX) so no function is over about 60 lines.
6. `MissionControl.tsx` builds the view and signature string every 0.25 s and `PlanningBoard.tsx` filters, sorts and builds its signature every 0.2 s, even when nothing changed.
   Before building, skip the work when the inputs are unchanged (for example the `liveWorld.current` snapshot reference, or the tasks array and agent statuses references, whichever actually changes per backend update); keep the signature as the redraw gate.

## C. LOW - fix

7. `PlanningBoard.tsx` hard-codes the card geometry size (`0.38 x 0.56`) while the layout uses `PLANNING_BOARD.cardWidth` / `cardHeight`; derive it from `PLANNING_BOARD`.
8. `OperationsHub.tsx` slows the pulse to 0.15x for any status other than `running`, including `idle` before the simulation starts.
   Use exactly the same condition the robots' animator uses for its 0.15x slow-down.
9. Tests in `scripts/tests/boards.ts`:
   - the identical view gives an identical signature (the actual redraw gate);
   - the cards-inside-the-board check also covers `v`, not only `u`;
   - the moved planning board walk slots stand in front of the board face (distance along the board normal), within the board width, with facing equal to the inverse board normal.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input, reusing the scripts in `.opencode-logs/phase5/` (`cdp.mjs`, `interaction-test.mjs`, `verify-demo.mjs`, `verify-drawcalls.mjs`, `verify-sprint.mjs`):
  - `interaction-test.mjs` 0 failures; demo at 1x and 4x completes in order (Orion, Piper, Iris, Kai, Quinn fail, Kai, Quinn pass, Rex, Orion).
  - Item 1 before and after, as described above.
  - Screenshots in `.opencode-logs/phase5-review-fixes/`: Mission Control close up with the whole wall in frame and its header not hidden by the HUD (frame the camera on the wall, not the Operations Hub preset), Mission Control at overview (crop the header to check item 3), planning board after the demo reached `done` (done tint), planning board during the sprint.
  - Peak draw calls at overview with the demo running, high and low, under 150 in high.
  - Console with StrictMode: no errors or warnings except fiber's `THREE.Clock` deprecation.
- Stop the server and Chromium you started before you finish.
- Do not commit.
  Print the report `AGENTS.md` asks for.
