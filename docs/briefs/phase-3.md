# Phase 3 brief: the 3D office (no agents yet)

You are the implementer (see `AGENTS.md`).
Phases 1 and 2 are merged: the engine, the store (`liveWorld`, camera request, quality, `viewInsets`, `sceneReady`, hover/selection) and the full HTML UI exist. Do not change their behaviour beyond wiring the canvas in.

Read first, in this order:
1. `AGENTS.md`, `docs/PLAN.md`.
2. Spec sections 0, 5, 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8 and 10 of `docs/spec/ai-agent-world.md`.
3. These skill files completely, including their "Common Mistakes": `.claude/skills/threejs-react-three-fiber/SKILL.md`, `threejs-fundamentals`, `threejs-lighting`, `threejs-materials`, `threejs-geometry`, `threejs-textures`, `threejs-interaction`, `threejs-performance`. When they disagree with what you remember about three.js, they win (three r186, fiber 9.8, drei 10.7).
4. `docs/spec/reference-screenshots/01-overview-sprint.jpg` and `02-demo-qa-fails.jpg`: the office must read like these (dark blue-hour glass office, white desks with dual dark monitors, round glowing hub console, mission-control wall at the back, skyline of lit towers behind the windows, plants, collab table, lounge with sofas, zone partitions).

## Build (spec section 2 layout, `src/world/`)

- `WorldCanvas.tsx` per 6.1 exactly: `shadows={high ? "percentage" : false}`, reactive `dpr`, camera fov 40 at the `overview` preset, ACESFilmic + exposure 1.15, background `#080b10`, fog `#0a0e15` 48-130, drei `PerformanceMonitor` (`flipflops={2}`, `onFallback` -> store quality `low` with auto flag), a `ReadySignal` that sets `sceneReady` after 3 rendered frames, click-vs-orbit 5 px tolerance, `onPointerMissed` clears selection only on a real click. Never key or remount the Canvas (pitfall 2).
  Load it from `AppShell` with `next/dynamic` and `ssr: false`, replacing `WorldPlaceholder` (delete the placeholder).
- `sharedResources.ts` + `proceduralTextures.ts` (6.8): lazy pooled geometries/materials, `accentMaterial(color)`, `tintedMaterial(color)`, cached canvas textures (`floorTexture, windowsTexture, skyTexture, screenTexture, blobTexture, glowTexture`) with correct color spaces. No image files, no HDR downloads.
- `OfficeEnvironment.tsx` (6.2): floor tiles, back window wall with dusk sky, side walls, glass partitions between zones, potted plants, dust motes (`Points`, 260 high / 90 low, animated with delta time), instanced skyline (~260 high / ~120 low, one draw call, emissive lit-window texture).
- `Workstations.tsx` (6.3): `Desk` per station from `worldLayout.ts` positions (desk slab, chair, 2-3 monitors with a scrolling procedural code texture, invisible hit box), `OperationsHub` round console with a ring, `MissionControl` wall screen drawn on a canvas texture (static content for now, phase 5 makes it live), `PlanningBoard` with the instanced sticky-card mesh in place (cards can stay hidden until phase 5), `CollabTable` with 6 stools and `Lounge` with low sofas matching the ring slots in `worldLayout.ts`.
  The monitor emissive-glow-on-owner-working and hub-ring pulse are phase 5; build the materials so they can be driven later, but do not wire them yet.
- `stationOwners.ts` from the spec map.
- `Lighting.tsx` (6.5): one shadow-casting directional light with a tight orthographic frustum over the floor (2048 map in high, no shadow in low), hemisphere fill, a few warm non-shadow desk lights, a procedural `Environment` from `Lightformer`s in high only. `PCFShadowMap` semantics via `shadows="percentage"`; never `PCFSoftShadowMap`. Remember r186 physical light units (see threejs-lighting).
- `cameraPresets.ts` + `CameraController.tsx` (6.6): the five presets and `CAMERA_LIMITS` exactly as specified, drei `OrbitControls` with damping, exponential damping toward a requested preset/focus on a new `camera.nonce` (frame-rate independent `THREE.MathUtils.damp`), user drag cancels the move, inset-aware fit using `viewInsets` with the formula in 6.6, target clamped to the office box, follow-mode plumbing for `followAgentId` (agents arrive in phase 4; follow can no-op when no agent mesh exists yet). Wire the existing `CameraBar` buttons to these presets.
- `InteractionManager.tsx` (6.7): hover over a desk hit box sets `hovered: "station:<id>"` and the pointer cursor; leaving the canvas clears hover; a click (within 5 px) selects the station, opens its panel content (station name, owner, owner status) and focuses the camera on the desk.
- No drei `<Html>` anywhere (pitfall 1). No post-processing.

## Quality and performance

- `high` and `low` paths both work and are switchable live from Settings without remounting the Canvas.
- Count draw calls with `gl.info.render.calls` read after render (see threejs-performance) and report the number for the overview preset in high and low. Target: under 150 in high.
- Zero allocations inside `useFrame` hot paths (reuse vectors).

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- Open the app in a real browser (headless Chromium is fine) at 1440x900 and 390x844 and save screenshots of: overview preset, each of the other four presets, `?quality=low`. Put them in `.opencode-logs/phase3/` (git-ignored) and compare them against the reference screenshots yourself; fix anything that clearly looks off (empty areas, z-fighting, overexposed or black surfaces, furniture through walls, objects hidden behind the floating UI).
- With React StrictMode on, the console must have no errors and no warnings except fiber's own `THREE.Clock` deprecation warning.
- The HTML UI from phase 2 must still work end to end (run the demo; agents are not visible yet, which is expected).

Do not build agents, trails, comm arcs, speech bubbles, or the live wall/board content (phases 4 and 5).
Do not commit. Print a short report: files, draw calls high/low, what you verified, the screenshot paths, anything left out.
