# Phase 6 brief: quality, performance, reduced motion, mobile

You are the implementer (see `AGENTS.md`).
Phases 1-5 are merged on `main`.
Work on branch `phase-6-quality` (already checked out).
Much of this phase already exists in a basic form, so the job is to audit each item, fix the gaps and prove it works.

## Read first

1. `AGENTS.md`, `docs/PLAN.md` (phase 6 row and the review checklist).
2. Spec sections 0 (item 4), 6.1, 6.5, 7.1, 7.2 and 10 of `docs/spec/ai-agent-world.md`, and the phase 6 paragraph of section 11.
3. `.claude/skills/threejs-react-three-fiber/SKILL.md` and `threejs-performance/SKILL.md`, including their "Common Mistakes".
4. What exists today (read only these, use `sed -n` / `grep` for big files):
   - `src/world/WorldCanvas.tsx` (Canvas, `PerformanceMonitor` `onFallback`, `ReadySignal`, `RenderStatsProbe`)
   - `src/components/layout/AppShell.tsx` (`pickInitialQuality`, inset measuring, nav rail, bottom sheet)
   - `src/components/panels/SidePanel.tsx`, `SettingsPanel.tsx`, `src/components/controls/` (camera bar)
   - `src/state/useWorldStore.ts` (`quality`, `qualityAuto`, `setQuality`)
   - `src/world/Lighting.tsx`, `OfficeEnvironment.tsx`, `AgentsLayer.tsx` (already read `quality`)
   - `src/components/world/AgentLabelsOverlay.tsx` and `src/app/globals.css` (reduced motion is handled only here and in CSS today)
   - `src/world/CameraController.tsx`, `AgentAnimator.ts`, `CommLinks.tsx`, `OperationsHub.tsx`, `Desks.tsx` (motion sources)

## Build

1. **Quality policy as a pure module.**
   Move the quality choice out of `AppShell.tsx` into `src/state/qualityPolicy.ts` with no React or three imports.
   Signature along the lines of `pickInitialQuality({ search, width, reducedMotion, hardwareConcurrency })` returning `{ quality, auto }`.
   Rules (spec 7.2): `?quality=high|low` forces and sets `auto: false`; any other value is ignored; otherwise low when width < 768, reduced motion, or `hardwareConcurrency <= 4`; otherwise high with `auto: true`.
   `AppShell` calls it with real browser values.
   Add checks to `scripts/simulate.ts` / `scripts/tests/` for every rule, including an invalid `?quality=ultra` and a missing `hardwareConcurrency`.
2. **PerformanceMonitor fallback.**
   Keep `flipflops={2}` and the guard that a forced `?quality=` is never overridden.
   Verify in the browser with CPU throttling (CDP `Emulation.setCPUThrottlingRate`, rate 6 or higher) that an auto-high session drops to low, the Settings panel and the quality label show "Low (auto)", and the `<canvas>` element is the same node before and after (no remount).
   If the fallback never fires in headless software rendering, say so in the report and prove the path another way (for example call the store action and show shadows off, DPR capped, fewer towers, no console error).
3. **Low path completeness** (spec 0.4, 6.1).
   Audit every quality-dependent component and make low really cheap: no shadow-casting light, no environment extras, fewer skyline towers, fewer dust points, no zone lights, DPR capped at `[1, 1.2]`.
   Anything that is high-only today but not gated, or gated by a different rule than the store `quality`, gets fixed.
   Switching quality in either direction at runtime must not remount the Canvas, must not leak (dispose geometry/material/texture created for the high path when it is dropped, or keep it pooled in `sharedResources`), and must not log errors.
   Report draw calls, triangles and `renderer.info.memory` in high and low at overview with the demo running.
4. **Reduced motion everywhere** (spec 7.1).
   Today only bubbles and CSS respect it.
   Add one source of truth: a `reducedMotion` flag in the store (or a tiny non-React module with a ref) set from `matchMedia("(prefers-reduced-motion: reduce)")` and kept live with the `change` event; read it in `useFrame` without React re-renders and without per-frame allocation.
   When set:
   - robot idle bobbing, head sway and celebration flourishes are reduced to a static or very small pose; walking still moves the robot (it is information) but without bounce
   - dust drift is frozen, hub ring and desk glow use fixed levels (no pulse), comm packets show as a static glow on the arc instead of travelling, path trails do not shimmer
   - camera preset changes jump instead of easing, and follow mode does not smooth-chase
   - CSS animations and transitions in `globals.css` and the loading screen are off or near-instant
   Keep behaviour identical when the flag is off.
   Put the pure decisions (for example "pulse amplitude for flag") in a React-free module with checks.
5. **Mobile layout** (spec 7.2) at 390x844 and 360x740, portrait and landscape 844x390.
   Audit and fix: nav rail collapses to a bottom bar, the side panel is a 40 dvh bottom sheet that does not hide the bar, the camera bar floats above the sheet and not over the top bar, insets written to the store match the real regions so the camera fit shows the whole office, `env(safe-area-inset-*)` is respected (add `viewport-fit=cover` through the Next `viewport` export), tap targets are at least 40 px, no horizontal scroll, text is not clipped, the task dialog scrolls inside the viewport, orbit and pinch zoom work with touch.
   Fix anything that overlaps or looks off, even if it is not strictly listed.
6. **`?quality=` flag in the UI.**
   The Settings panel already explains it.
   Make sure the top bar or settings shows the active mode and whether it is forced or auto, and that changing the segmented control sets `auto: false`.
7. **StrictMode and console.**
   Confirm `reactStrictMode` is on in dev (Next default; do not turn it off).
   The dev server (`npm run dev`) and the production build must both show zero console errors or warnings except fiber's `THREE.Clock` deprecation, through a full demo run, a quality switch each way, a resize across the 768 px breakpoint, and a reduced-motion toggle.
8. **Phase 5 follow-ups.**
   - `src/world/missionDrawing.ts` uses the literal `Inter` in `ctx.font`; resolve the real `--font-sans` family once (from `getComputedStyle(document.documentElement)`) and use it, with `system-ui, sans-serif` as the fallback, and redraw the wall once fonts are ready (`document.fonts.ready`).
   - Fix the stale comment in `src/world/OperationsHub.tsx` near line 19 so it matches the code (including the reduced motion behaviour you add).
   - Remove the duplicated JSDoc line in `src/world/planningContent.ts` near lines 59-60.

## Quality

- Zero allocations in `useFrame` hot paths; no React re-render at frame rate (pitfall 7).
- Do not key or remount the Canvas (pitfall 2); no drei `<Html>`; no `PCFSoftShadowMap`; no `THREE.Clock` in our code.
- Files under 800 lines, functions under about 60 lines.
- No em dash characters anywhere, including comments and docs.
- No binary assets, no network downloads.
- Do not edit `docs/spec/`, `docs/PLAN.md`, `.claude/` or `AGENTS.md`.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input, reusing `.opencode-logs/phase4-fixes/cdp.mjs`, `interaction-test.mjs` and `demo-run.mjs` if they are still there:
  - demo at 1x and 4x completes in order: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion; `interaction-test.mjs` 0 failures, in both high and low
  - with `?quality=low`, `?quality=high`, no flag, and an invalid flag
  - with `prefers-reduced-motion: reduce` emulated (CDP `Emulation.setEmulatedMedia`), including toggling it live
  - at 1440x900, 390x844 and 844x390
- Screenshots in `.opencode-logs/phase6/`: desktop high, desktop low, mobile portrait overview with sheet open and closed, mobile landscape, reduced motion mid-demo, Settings panel showing "Low (auto)" after a fallback.
  Compare with `docs/spec/reference-screenshots/` and fix what looks off.
- Numbers to report: draw calls, triangles, geometries, textures in high and low; frame time in ms from `RenderStatsProbe` if available, with the caveat that headless software GL is not representative.
- Do not commit.
- Finish with the short report required by `AGENTS.md`: files changed, what you verified, what you could not do.
