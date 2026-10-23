# Phase 6 review fixes

You are the implementer (see `AGENTS.md`).
Branch `phase-6-quality` is checked out with the phase 6 work uncommitted in the working tree.
Do not revert or rewrite it; fix only the items below.
Typecheck, lint, test and build currently pass, and must still pass at the end.

Read `docs/briefs/phase-6.md` for context, and `.claude/skills/threejs-react-three-fiber/SKILL.md` and `threejs-performance/SKILL.md` for the "Common Mistakes".

## Fixes

1. **HIGH: shadow map leak on high to low** (`src/world/Lighting.tsx` near line 52).
   The directional light only toggles `castShadow={high}` and stays mounted.
   three keeps the 2048x2048 `light.shadow.map` render target after the light stops casting, so a high to low switch leaks it.
   Fix by either mounting the shadow-casting light only while `high` (fiber then disposes it), or holding a ref and, when `high` becomes false, calling `light.shadow.map?.dispose()` and setting `light.shadow.map = null` in an effect.
   Switching back to high must still produce working shadows without remounting the Canvas.
   Prove it: switch high to low to high to low in a production build and compare `renderer.info.memory.textures` and the number of render targets after each cycle; they must not grow.
2. **MEDIUM: environment baked in low** (`src/world/Lighting.tsx` near lines 14-39 and 104-110).
   `<Environment>` is always mounted, so a session that starts low (mobile, reduced motion, 4 or fewer cores) still builds the Lightformer cube and PMREM.
   Spec 6.5 and brief item 3 say low skips the environment.
   Mount `<Environment>` only once quality has been high at least once (a small `hasBeenHigh` state or ref), keep it mounted afterwards so the pooled texture is reused, and remove the layout-effect ordering trick in `EnvironmentGate` if it is no longer needed (keep only what the pooled case still requires).
   `environmentIntensity` must not be the only thing hiding it.
   Prove it: with `?quality=low` from load, no PMREM or environment render target is created; report `renderer.info.memory` and `scene.environment === null`.
3. **MEDIUM: unlayered CSS beats utilities** (`src/app/globals.css` near lines 412-440).
   The new touch-target block is outside `@layer components` (which closes near line 367), so `.chip`, `.range`, `.btn`, `.segmented-option` and `.camera-preset` rules override Tailwind utilities.
   Move the block inside `@layer components` (or a layer that sits below utilities) and scope it to `max-width: 900px`.
   `min-width: 40px` on the small `SegmentedControl` (speed control) must not push the top bar into overflow or an ugly wrap: re-check at 390x844, 360x740 and 844x390 with no horizontal scroll, nothing clipped, nothing overlapping.
   If it does not fit, let the top bar wrap deliberately or move secondary controls, and look at the screenshots yourself.
4. **LOW: reduced motion hides the status ring** (`src/world/AgentCharacter.tsx` near line 297).
   Under reduced motion the success and error pulse ring is removed entirely.
   Show it as a static ring at a fixed opacity instead, so the status cue stays.
5. **LOW: calm follow drift** (`src/world/CameraController.tsx` near lines 160-170, `followStep`).
   In calm mode the camera shifts by the unclamped target delta and then `clampTarget` runs, so the camera/target offset drifts once the target hits the clamp.
   Compute the camera shift from the clamped target delta, matching the non-calm path.
6. **LOW: safe areas** (`src/app/globals.css` near lines 73-89, `AppShell.tsx`, `TaskDialog.tsx`, `LoadingScreen`).
   `.app-safe` pads the shell, but the fixed `TaskDialog` and `LoadingScreen` ignore safe-area insets, and the measured `viewInsets` ignore the padding.
   Make the fixed overlays respect `env(safe-area-inset-*)`, and make sure the inset measurement (rects relative to the viewport) stays correct with the padding.
   Emulate a notch if you can (CDP `Emulation.setSafeAreaInsetsOverride`) and check the camera fit.
7. **LOW: debug hook in the frame loop** (`src/world/WorldCanvas.tsx`, probe).
   `window.__AAW_SET_QUALITY__` is assigned lazily inside `useFrame`.
   Move it into a `useEffect` with cleanup that removes it, still only active with `?debug`.
8. **LOW: label case** (`src/state/qualityPolicy.ts` lines 75-76).
   `describeQuality` returns "Low (auto)"; the brief and docs say "low (auto)" in places.
   Keep the capitalised UI label, but make sure the checks in `scripts/tests/quality.ts` and any docs agree on one spelling.
   No change needed if they already do.

## Rules

- Same rules as `docs/briefs/phase-6.md` (no per-frame allocations, no Canvas remount, no `<Html>`, no `PCFSoftShadowMap`, no `THREE.Clock`, no em dashes, files under 800 lines).
- Add a check to `scripts/tests/` only where a pure function changed; the GPU resource proofs are browser checks.
- Verify: `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass; production browser run with the demo in high and low (phase order, `interaction-test.mjs` 0 failures, zero console output beyond the fiber Clock notice) and screenshots in `.opencode-logs/phase6-fixes/` for mobile 390x844, 360x740 and 844x390.
- Do not commit.
- Finish with the short report required by `AGENTS.md`, with the numbers from items 1 and 2.
