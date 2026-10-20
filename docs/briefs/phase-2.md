# Phase 2 brief: state + HTML UI (3D area stays blank)

You are the implementer (see `AGENTS.md`).
Phase 1 (engine, `MockAgentBackend`, 84 headless checks) is merged; do not change its behaviour.
Read `AGENTS.md`, `docs/PLAN.md`, and spec sections 0, 2, 3.5, 7 and 10 of `docs/spec/ai-agent-world.md` before writing code.
Study the four images in `docs/spec/reference-screenshots/` closely: the UI must look like them (dark glass panels, spacing, type sizes, metric layout, pills, task cards, workflow list).

## 1. Backend client and store

- `src/integrations/WebSocketAgentBackend.ts`: implements `AgentBackend` over the JSON protocol in spec 3.5.
  Commands carry a `crypto.randomUUID()` id; each returns a promise resolved or rejected by the matching `ack`; pending acks reject on disconnect and after a timeout.
  `snapshot` messages update `getSnapshot()` and notify snapshot listeners; `event` messages notify event listeners.
  Validate every incoming message shape at the boundary (it is untrusted input) and ignore malformed ones with a single `console.warn`, never crash.
  `kind: "websocket"`, `simulated: false`, `label: "Live backend"`.
- `src/integrations/backendClient.ts`: `getBackend()` (singleton; websocket when `NEXT_PUBLIC_AGENT_BACKEND=websocket` and `NEXT_PUBLIC_AGENT_WS_URL` is set, otherwise `MockAgentBackend`), `connectBackend()` (connects, wires events and snapshots into the store, emits boot events for the mock, returns a disposer that is safe under React StrictMode double-mount), and the `commands` object from spec 3.5 including `submitTasks(inputs, gapMs = 220)` and `autoStartIfReady`.
  Command failures surface in the store as a backend error string shown in Settings and the top bar, not as an unhandled rejection.
- `src/state/useWorldStore.ts` (Zustand 5):
  - module-level mutable `liveWorld` buffer written on every snapshot (for the 3D layer later);
  - a throttled mirror for React: push at most every 160 ms, but immediately when status, speed, or a signature of agent statuses/activities/task ids/phases/statuses changes (spec section 2 and pitfall 7). Position-only changes must never cause a React render;
  - an events log (newest first, capped by `SIMULATION_CONFIG.maxEvents`, reuse `src/events/eventStore.ts` selectors);
  - UI state: active tab, selected agent / task / station, hovered, `followAgentId`, task dialog open + `preferredAgentId`, overlays (walking paths, speech indicators), quality (`high` | `low`, with `auto` flag), `sceneReady`, `viewInsets`, `camera` request `{nonce, preset?, focus?, distance?}`, `backend` connection info, and `sound` settings shape (wired in phase 7; persist nothing yet).
  Use narrow selectors in components so a feed update does not re-render the top bar.

## 2. UI (spec section 7)

- `src/app/globals.css`: the full theme from 7.1 and the utilities `.surface`, `.eyebrow`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-quiet`, `.field`, `.scroll-thin`, `.pulse-dot`, `.agent-bubble*`, plus the `prefers-reduced-motion` rules. Fonts Inter and JetBrains Mono via `next/font/google` in `layout.tsx` (Next self-hosts them at build time, so there is no runtime CDN request).
- `src/components/layout/`: `AppShell` (7.2 layout, `ResizeObserver` insets into the store, low-quality pick on mount, `?quality=` flag, `connectBackend()`, auto-start when `sceneReady`), `NavRail`, `TopBar` (7.3), `LoadingScreen` (7.6).
  Until the 3D canvas exists in phase 3, render an empty full-viewport placeholder in its place that sets `sceneReady` once it mounts, so auto-start and the loading screen work now. Keep it trivially replaceable by `WorldCanvas`.
- `src/components/controls/`: `SimulationControls` (Start/Pause/Resume, speed segmented control, mute toggle wired to the store only, Reset with inline confirm, Run demo, Load sprint, New task), `CameraBar` (preset buttons Overview, Operations Hub, Research, Development, Collaboration writing camera requests to the store, plus a fullscreen toggle).
- `src/components/panels/`: `SidePanel` with the five tabs and every element listed in 7.4, `TaskCard`, `TaskDetails` (workflow list of 7 phases with owner names and check / current / pending states exactly like screenshots 02 and 03, "Reworked N× after QA/review feedback", task cards with checkmarks, research findings, timeline, blocked and failure banners, the "Simulated output from canned templates - no model inference." footnote), `AgentDetails`, `TaskDialog` (7.5).
- `src/components/activity/ActivityFeed.tsx` and `src/components/ui.tsx` (shared atoms: avatar, status pill, priority tag, progress bar, segmented control, relative time).
- `AgentLabelsOverlay` is phase 4; do not build it yet.
- Keyboard shortcuts from 7.2, ignored while typing or with the dialog open.
- Mobile (< 768 px): nav rail becomes a bottom bar and the side panel a 40 dvh bottom sheet, nothing overflows horizontally.
- Honesty (spec section 0): "Simulation mode · no live inference" in the top bar, the dialog footer, Settings and the demo callout; "Live backend" only when the websocket backend is active.
- Accessibility: every icon-only button has an `aria-label` and a visible focus ring; the dialog traps focus, closes on Esc and returns focus; tabs and segmented controls are keyboard operable.

## 3. Verify

- `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- Add a headless check (in `scripts/simulate.ts` or a second script wired into `npm test`) for the store throttle: feeding 30 snapshots per second that only move positions produces at most one mirror update per 160 ms, while a status change produces an immediate update. If the store cannot be imported by Node without React, test the pure throttle/signature logic extracted into a plain `.ts` module.
- Run `npm run dev`, load the page, press Run demo and confirm the task cards, agent statuses, workflow list and activity feed move through the whole demo to "done". Report what you saw.

Do not build any 3D (no `@react-three/*` imports yet) and do not commit.
Print a short report: files created, what you verified, anything left out on purpose.
