# Phase 5 brief: live mission control and planning board

You are the implementer (see `AGENTS.md`).
Phases 1-4 are merged on `main`: engine, HTML UI, the 3D office and the robots.
This phase makes the office furniture show live system state.
Work on branch `phase-5-live-boards` (already checked out).

## Read first

1. `AGENTS.md`, `docs/PLAN.md` (phase 5 row and the review checklist).
2. Spec sections 0, 6.3, 6.8 and 10 of `docs/spec/ai-agent-world.md`.
3. `.claude/skills/threejs-react-three-fiber/SKILL.md`, `threejs-textures`, `threejs-materials`, `threejs-performance`, including their "Common Mistakes".
4. `docs/spec/reference-screenshots/01-overview-sprint.jpg` and `02-demo-qa-fails.jpg`: the Mission Control wall (header, bar chart of tasks per workflow phase, agent roster with status dots) and the desk screens.
5. The code you build on: `src/world/Workstations.tsx` (`OperationsHub`, `MissionControl`, `PlanningBoard`, desk monitors and `screenMaterial(stationId)`), `src/world/proceduralTextures.ts` (`missionControlTexture`, `screenTexture`), `src/world/sharedResources.ts`, `src/world/stationOwners.ts`, `src/state/useWorldStore.ts` (`liveWorld`), `src/tasks/taskTypes.ts` (`Task`, `Subtask`, phases, labels), `src/agents/AgentRegistry.ts`.
   Keep your context small: read only what you need, use `sed -n` / `grep` for large files.

## Build

1. **Mission Control live** (spec 6.3).
   The wall screen is drawn on a canvas texture from live data: header (title, simulation mode from `backend.simulated`, never a hard-coded "SIMULATION MODE"), bar chart of task counts per workflow phase, the active tasks (title, phase label, progress bar, assigned agent colour, up to 4, newest or highest priority first), and the agent roster from `AGENT_BY_ID` with each agent's status and colour.
   Compute a content signature (a short string or number from the fields shown, with progress rounded to whole per cent) and redraw at most 4 times per second and only when the signature changed; set `texture.needsUpdate` only after a redraw.
   Read data from `liveWorld.current` in `useFrame`, never through React state.
   Put the pure parts (signature, layout of rows, phase counts) in a module without React or three imports so they are testable, and add checks to `scripts/simulate.ts` / `scripts/tests/`.
   Text must stay crisp and readable at the overview preset (canvas resolution about 2048 x 740, correct `colorSpace`, anisotropy as the skill files advise).
2. **Planning board cards** (spec 6.3).
   Up to 24 instanced sticky cards on the board, one per subtask of the active tasks (newest task first, then subtask order).
   Cards appear (scale in over about 0.3 s) as subtasks are created, and change tint when done (pending in the task's agent colour or a warm yellow, done in a muted green); lay them out in a tidy grid on the board face with a small gap, never overlapping the board edges.
   Update instance matrices and colours only when the subtask set changes (signature), not every frame, except while a card is animating in.
3. **Desk screens glow** (spec 6.3).
   Each station's monitors raise their emissive intensity smoothly (damped, frame-rate independent) when the station owner's status is `working`, and fall back when idle; other statuses (thinking, communicating) may use a middle level.
   Read the owner status from `liveWorld` in `useFrame`; no per-frame allocations.
4. **Hub ring pulse** (spec 6.3).
   The hub's glowing ring pulses while Orion works (status not `idle` and not `paused`), with a calm idle level otherwise.
   Use real time for the pulse; when the simulation is paused, slow it to the animator's 0.15x like the robots.
5. **Carry-over from phase 4.**
   `AgentCharacter.tsx` calls `animatorInputsFor(rig)` inside the frame loop, which allocates an object per agent per frame.
   Precompute the inputs once per agent (or per role) outside the frame loop.

## Quality

- Zero allocations in `useFrame` hot paths (no `new`, no `Color.set(string)`, no array or closure creation per frame).
- No React re-render at frame rate (pitfall 7).
- Draw calls at overview with the demo running stay under 150 in high (currently about 120); report high and low.
- Dispose every texture, geometry and material you create per instance.
- Functions under about 60 lines, files under 800 lines; `Workstations.tsx` is 503 lines, so split the boards into their own files (for example `MissionControl.tsx`, `PlanningBoard.tsx`, `OperationsHub.tsx`) instead of growing it.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input, reusing `.opencode-logs/phase4-fixes/cdp.mjs`, `interaction-test.mjs` and `demo-run.mjs`:
  - Demo at 1x and 4x completes in order: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion; `interaction-test.mjs` 0 failures.
  - Load the sprint (Load sprint button) and check the wall lists several tasks and the board fills with cards.
  - Screenshots in `.opencode-logs/phase5/`: Mission Control close up mid-demo and at overview, planning board after Piper's planning (cards visible) and after the task is done (done tint), a desk lit while its owner works next to an idle desk, the hub ring while Orion works, `?quality=low`, mobile 390x844 overview.
    Compare with the reference screenshots and fix what looks off (unreadable text, cards off the board, z-fighting, blown-out glow).
- Console with StrictMode: no errors or warnings except fiber's `THREE.Clock` deprecation.
- Do not commit.
