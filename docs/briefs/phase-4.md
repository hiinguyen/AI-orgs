# Phase 4 brief: the agents

You are the implementer (see `AGENTS.md`).
Phases 1-3 are merged on `main`: the engine, the HTML UI and the static 3D office.
This phase puts the six robots into the office and makes the demo watchable end to end.

## Read first

1. `AGENTS.md`, `docs/PLAN.md`.
2. Spec sections 0, 3.1, 3.5, 5, 6.4, 6.6 (follow mode), 6.7, 6.8 and 10 of `docs/spec/ai-agent-world.md`.
3. These skill files completely, including their "Common Mistakes": `.claude/skills/threejs-react-three-fiber/SKILL.md`, `threejs-fundamentals`, `threejs-geometry`, `threejs-materials`, `threejs-animation`, `threejs-interaction`, `threejs-performance`. When they disagree with what you remember about three.js, they win (three r186, fiber 9.8, drei 10.7).
4. `docs/spec/reference-screenshots/01-overview-sprint.jpg` and `02-demo-qa-fails.jpg`: robots, dotted path trails, glowing comm arcs and the dark-glass speech pills must read like these.
5. The phase 3 code you build on: `src/world/` (especially `sharedResources.ts`, `proceduralTextures.ts`, `CameraController.tsx`, `InteractionManager.tsx`, `pointerGesture.ts`), `src/state/useWorldStore.ts` (`liveWorld`, `selectAgent`, `hovered`, `followAgentId`, `overlays.walkingPaths`, `overlays.speechIndicators`), `src/agents/agentTypes.ts` (`AgentState`: `status`, `position`, `heading`, `path`, `facingAgentId`, `paused`) and `src/integrations/AgentBackend.ts` (`CommLink`).

## Build (spec 6.4, files under `src/world/` unless noted)

- `AgentCharacter.tsx`: procedural robot per spec 6.4 from the shared pools only (`capsule`, `ring`, `cylinder`, `box`, `sphere`, `disc`; `ceramic`, `joint`, `accentMaterial(color)`).
  - Parts: torso, head with visor, two arms, two legs, emissive chest accent in the agent colour, floor status ring, white selection ring (select or hover), pulse ring (green on `success`, amber on `error`).
  - One rig per role (scale 0.96-1.12, hip/shoulder/head heights, label height ~1.85-2.05) and a distinct silhouette: orchestrator taller with a crown-like visor, researcher with a lens, PM with a tablet, engineer with a headset, QA with twin sensors, reviewer with a monocle.
    Put the rig table in a pure module (for example `src/agents/agentRigs.ts`, no React or three imports, `.ts` extensions) so it stays testable.
  - Characters cast shadows. The soft contact shadow is a radial blob sprite from `blobTexture`.
  - An invisible cylinder hit mesh per agent for picking (spec 6.7).
- `AgentAnimator.ts`: one pure pose function per animation state (idle breathing, walking leg/arm swing driven by actual speed, working forward lean + typing arms, thinking head tilt + hand to chin, communicating gesture, success bounce, error slump), mapped from `AgentStatus`.
  Keep a weight per state, damp weights toward the target with delta time and return the weighted sum.
  Multiply animation speed by 0.15 when the agent or the simulation is paused or not running.
  No allocations per frame: write into preallocated pose objects.
- Per frame, read the agent from `liveWorld.current` (never from React state): damp the root position toward it (lambda 12), damp the heading (lambda 9, shortest angle), snap when the jump is over 4 m.
  Use `THREE.MathUtils.damp`, frame-rate independent. Rendering never mutates simulation state.
- `AgentsLayer.tsx`: mounts the six characters plus their trails and the comm links inside the existing Canvas. No new Canvas, no Canvas `key`.
- `PathTrail` per agent: one `InstancedMesh` of up to 64 small discs in the agent colour, flowing along the remaining `path` at 0.32 m spacing with a phase offset, and a breathing destination ring.
  Hidden when `overlays.walkingPaths` is off. Update instance matrices in `useFrame` with reused objects.
- `CommLinks`: for each active `CommLink` (`from`, `to`, `kind`, `startedAt`, `endsAt` against the snapshot `clock`) draw a quadratic bezier arc between the two agents' chest heights with a glowing tube or line, plus 2-3 instanced packet sprites travelling from `from` to `to` over the link duration.
  Colour from the sender; `assign` arcs slightly thicker. Pool or reuse the arc geometry; do not allocate a new one every frame.
- Speech bubbles are DOM, not drei `<Html>` (pitfall 1):
  - A module-level `labelAnchors: Map<AgentId, LabelAnchor>`; inside `useFrame` project `(x, labelY * scale, z)` with the camera and write `{ x, y, scale, onScreen }` where `scale = clamp(6.5 / (2 * tan(fov / 2) * distance), 0.72, 1.05)`.
  - `src/components/world/AgentLabelsOverlay.tsx` (or next to the other overlays), mounted in `AppShell` above the canvas with `pointer-events: none`.
    It renders one bubble per agent from the store (name, activity or "Paused", green/amber border for success/error) and shows it when the agent is selected, hovered, paused, or, if `overlays.speechIndicators` is on, when its status is communicating, success or error.
    A single `requestAnimationFrame` loop sets each bubble's `transform` and `visibility` from the anchors. No React re-render per frame.
  - Style: pill, dark glass, agent-colour dot, bold name, muted activity, 12 px, fade-in animation, matching the reference screenshots.
- Interaction (extend `InteractionManager.tsx`): hover over an agent sets `hovered: "agent:<id>"` and the pointer cursor; a click within the 5 px tolerance selects the agent, opens its panel and focuses the camera on it at distance 7.5.
  The existing station hover and click must keep working.
- Follow mode (`CameraController.tsx`): when `followAgentId` is set, damp the target to the agent each frame and keep the camera offset; `Esc` or a drag releases it.
  Wire it to whatever "Follow" control the agent panel has, or add one there if it is missing.

## Quality and performance

- Both `high` and `low` work and switch live without remounting the Canvas. In `low`, characters may skip shadow casting.
- Zero allocations inside `useFrame` hot paths.
- Position changes must never cause React renders (pitfall 7). Check with the React profiler or a render counter that the side panel does not re-render at frame rate during the demo.
- Report draw calls at the overview preset in high and low with the demo running. Target: under 150 in high.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
  Add headless checks to `scripts/simulate.ts` for anything pure you add (rig table sanity, shortest-angle heading damp, label scale clamp, pose weight blending).
- Open the app in a real browser (headless Chromium is fine) at 1440x900 and 390x844, press **Run demo** and watch it to the end.
  The sequence must be visible: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion.
  Save screenshots of the overview mid-demo, the QA failure moment, a comm arc in flight, a selected agent with its speech bubble, follow mode, and `?quality=low`, in `.opencode-logs/phase4/`.
  Compare them against the reference screenshots yourself and fix anything that looks off (robots sinking into the floor or floating, feet sliding, arcs clipping through desks, bubbles drifting from their robot or covered by the floating UI, trails z-fighting with the floor).
- With React StrictMode on, the console must have no errors and no warnings except fiber's own `THREE.Clock` deprecation warning.
- The HTML UI from phase 2 and the station interaction from phase 3 must still work.
- Do not commit.
