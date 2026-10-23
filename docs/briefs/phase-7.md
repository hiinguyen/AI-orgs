# Phase 7 brief: sound engine

You are the implementer (see `AGENTS.md`).
Phases 1-6 are merged on `main`.
Work on branch `phase-7-sound` (already checked out).

## Read first

1. `AGENTS.md`, `docs/PLAN.md` (phase 7 row and the review checklist).
2. Spec sections 0 (items 3, 6), 8 and 10 (pitfall 5, audio needs a user gesture) of `docs/spec/ai-agent-world.md`.
3. What exists already, so you extend it and do not duplicate it:
   - `src/state/useWorldStore.ts`: `sound: { enabled, volume, ambient }` and `setSound(patch)` (defaults are in place; persistence is not).
   - `src/components/controls/SimulationControls.tsx` (mute button), `src/components/panels/SettingsPanel.tsx` (Sound section: enabled, ambient, volume), `AppShell.tsx` (`M` shortcut calls `setSound`).
   - `src/events/eventTypes.ts` (`EVENT_TYPES`, `AgentEvent`, `agentId`, `targetAgentId`), `src/integrations/backendClient.ts` (backend events reach `applyEvent`), `src/agents/AgentRegistry.ts` (agent ids).
   - `docs/spec/ai-agent-world.md` section 8 is the full cue table. Implement every cue in it.
   There is no `src/audio` directory yet.

## Build

1. **`src/audio/soundEngine.ts`** (singleton `SoundEngine`).
   Lazy `AudioContext` created only from `unlock()`, which is called from a pointer or key handler; before that `play()` and ambient calls are silent no-ops and never throw (pitfall 5).
   Master gain to `DynamicsCompressor` (threshold -18, ratio 6) to destination.
   `configure({ enabled, volume, ambient })` ramps the master gain smoothly (no clicks) and stops or starts the ambient bed.
   `setRunning(boolean)` drives the ambient bed: looped brown-ish noise (low-pass 260 Hz) plus a 58 Hz sine hum at very low gain, 1.5 s fade in, 0.25 s fade out, only while running and `ambient` and `enabled`.
   `play(event)` maps event types to the cues in section 8, with a per-type throttle (120 ms, 160 ms for `agent.arrived`, per-agent key for messages), using speaker pitches orion C5 523, piper E5 659, iris D5 587, kai A4 440, quinn F5 698, rex G4 392.
   Ambient events (`agent.ambient`) are silent.
   Every node is created per cue and disconnected when it ends (`onended`); one shared noise buffer, created once and reused.
   If `AudioContext` is unavailable, the engine disables itself quietly.
2. **Pure parts without Web Audio** in `src/audio/soundCues.ts`: event type to cue id, speaker pitch lookup, throttle key and throttle decision, settings validation and (de)serialisation.
   No React, three, Next or `@/` imports and `.ts` import extensions, so Node can test them.
   Settings persist in `localStorage` key `aaw.sound.v1`; parse defensively (invalid JSON, wrong types, volume outside 0..1 falls back to defaults field by field), and wrap storage access in try/catch (private mode).
3. **`src/audio/useSoundEffects.ts`** (mounted once in `AppShell`).
   On mount: load settings into the store (`setSound`), add `pointerdown` and `keydown` unlock listeners (removed after the first unlock and on cleanup), subscribe to backend events and call `play`, mirror store `sound` to `configure` and persist it, mirror `simStatus === "running"` to `setRunning`.
   Must be StrictMode safe: double mount leaves exactly one set of listeners and one subscription.
   Backend events must not be subscribed twice; check how `connectBackend` and `applyEvent` already fan out and add the sound subscription in the cleanest place (a store-level `subscribe` on the event log, or a second backend subscriber), without re-rendering React per event.
   The sound must not mutate simulation state and must not change determinism (non-negotiables 1 and 2).
4. **UI polish** (small, only if something is off).
   The mute button shows the muted state, `M` toggles, the Settings section reflects persisted values after reload, and the volume slider is disabled while sound is off.
   Honesty (non-negotiable 3) is unaffected: do not add any wording that implies inference.
5. **Phase 6 follow-ups** (small, fold in).
   - Add checks in `scripts/tests/quality.ts` for the `qualityEverHigh` latch (low to high to low stays true; forced low from start never sets it) and the store default `quality: "low"`; assert `.auto === false` in the "forced high" check.
   - Add a check for `initReducedMotion` if it can run headlessly with a stub `matchMedia`; otherwise say why not.
   - Remove the dead export `setReducedMotion` in `src/state/reducedMotion.ts` unless you use it in that check.
   - Rename `runMotionSuite` in `scripts/tests/motion.ts` to `runReducedMotionSuite` and update `simulate.ts`.
   - `src/world/CameraController.tsx` non-calm `followStep`: compute the camera shift from the clamped target delta, the same way the calm branch does, ideally sharing one code path.
   - `src/world/Lighting.tsx`: call `light.shadow.dispose()` when dropping shadows, and add a one-line comment that `EnvironmentGate` must stay after `<Environment>`.

## Tests

Add `scripts/tests/sound.ts`, called from `scripts/simulate.ts`, covering the pure module: every cue in section 8 is mapped from its event type, `agent.ambient` maps to nothing, speaker pitches, per-type and per-agent throttle windows, settings round trip, corrupt storage falls back field by field, volume clamping.
Optionally unit-test the engine against a minimal fake `AudioContext` that records created nodes: no context before `unlock()`, `play()` before unlock is a no-op, nodes disconnect after `onended`, ambient start and stop.

## Quality

- No audio files, no network, no binary assets.
- No per-event React re-render; no work in `useFrame`.
- Files under 800 lines, functions under about 60 lines; split the cue synthesis from the engine core if `soundEngine.ts` grows past about 400 lines.
- No em dashes anywhere. No `any` outside third-party boundary casts.
- Do not edit `docs/spec/`, `docs/PLAN.md`, `.claude/` or `AGENTS.md`.

## Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` (no warnings) all pass.
- Production build (`npm run build && npx next start -p 3123`) in headless Chromium with real CDP input (reuse `.opencode-logs/phase4-fixes/cdp.mjs`, `interaction-test.mjs`, `demo-run.mjs` and the phase 6 scripts if still present), launched with `--autoplay-policy=document-user-activation-required` (the default) so the gesture rule is really tested:
  - before any input `AudioContext` does not exist or is `suspended`, and no console error appears
  - after a real click or keypress the context is `running`
  - during a demo run, cues fire: wrap or spy `SoundEngine.play` (or count created oscillator and buffer source nodes through an injected hook behind `?debug`) and show a count per cue type that covers the demo's event types, plus the ambient bed starting on run and stopping on pause
  - mute (`M` and the button) silences new cues and fades the ambient bed; volume and toggles survive a reload
  - corrupt `aaw.sound.v1` in `localStorage` loads defaults without errors
  - demo completes in order Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion with identical timing to before (sound must not change determinism); `interaction-test.mjs` 0 failures
  - StrictMode dev server: no console errors or warnings except fiber's `THREE.Clock` notice, and one set of unlock listeners
- Screenshots in `.opencode-logs/phase7/`: Settings Sound section, muted button state, top bar during the demo.
- Do not commit.
- Finish with the short report required by `AGENTS.md`: files created or changed, what you verified (with the per-cue counts), what you could not verify (you cannot hear audio; say so).
