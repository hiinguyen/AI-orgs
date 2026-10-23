# Phase 9 brief: dynamic agents (one robot per live subagent)

You are the implementer (see `AGENTS.md`).
Phases 1-7 are merged on `main`.
Work on a new branch `phase-9-live-agents` created from `main`.

## Goal

Today the world has exactly six fixed robots (`AgentId` is a union of six names) and six fixed desks.
A real backend (phase 10: a bridge fed by Claude Code hooks) will run an arbitrary number of subagents, several of the same kind at once.
Every live subagent instance must get its own robot, with no merging.
This phase makes the agent set dynamic.
It does not build the bridge.
Simulation mode must keep behaving exactly as today (same six robots, same seeded outcomes, determinism intact).

## Read first

1. `AGENTS.md`, `docs/PLAN.md`, spec sections 0, 3, 5, 6.4, 7.4 and 10 of `docs/spec/ai-agent-world.md`.
2. The skill files listed in `AGENTS.md` (r3f, fundamentals, performance).
3. The code that hardcodes the six agents: `src/agents/agentTypes.ts` (`AgentId`, `AGENT_IDS`, `isAgentId`), `src/agents/AgentRegistry.ts`, `src/agents/agentRigs.ts`, `src/simulation/worldLayout.ts` (stations, `slotFor`, rings), `src/world/AgentsLayer.tsx`, `AgentCharacter.tsx`, `Desks.tsx`, `stationOwners.ts`, `CommLinks.tsx`, `PathTrail.tsx`, `src/components/world/AgentLabelsOverlay.tsx`, `src/components/panels/Agent*.tsx`, `OverviewPanel.tsx`, `src/audio/soundCues.ts`, `src/integrations/wsProtocol.ts`, `MockAgentBackend.ts`.
   Run `grep -rn "Record<AgentId" src scripts` and `grep -rn "AGENT_IDS\|AGENT_BY_ID" src scripts` first; about 38 sites need a decision.

## Design (follow it, ask in the report if something blocks it)

1. **Ids and profiles.**
   `AgentId` becomes `string`.
   The six simulation agents stay as `CORE_AGENT_IDS` and keep their profiles.
   `WorldSnapshot` gains `profiles: AgentProfile[]` so any backend can announce who exists.
   `AgentProfile` gains `kind: "core" | "live"`, and `home` becomes optional for live agents (they live in bays, see 3).
   The store holds a `profiles` map filled from the snapshot; `getAgentProfile(id)` and `agentName(id)` read from it with a safe fallback for unknown ids (never throw, never return undefined).
   Remove every `Record<AgentId, ...>` that assumed a closed set; use `Map` or `Record<string, ...>` with a lookup helper.
2. **Lifecycle events.**
   Add `agent.spawned` and `agent.despawned` to `EVENT_TYPES` (feed true, severity info; `despawned` is success or error from metadata `outcome`).
   A live agent is removed from the snapshot only after a despawn animation finishes (see 4); the Agents panel keeps a "Finished" group for the last 8 finished agents (name, role label, outcome, duration).
3. **Bays.**
   Add a "Dispatch Floor" area to `worldLayout.ts` with `BAY_COUNT = 12` stand slots plus a matching desk each, laid out in a clear grid that does not overlap existing stations, rings, the corridor or glass walls (check against `FLOOR` and `route()`).
   Pure helpers in a new `src/simulation/bays.ts`: `allocateBay(occupied: ReadonlySet<number>): number | null` (lowest free index), `bayStand(index)`, `bayDesk(index)`.
   When all 12 bays are taken, extra agents wait at the Meeting Lounge ring and the top bar shows "+N waiting"; they take a bay as soon as one frees.
   Core agents keep their current stations.
4. **Rendering.**
   `AgentsLayer` renders from the snapshot's agent list, not a fixed array; one `AgentCharacter` per id, keyed by id.
   Rig choice comes from `AgentRole`; an unknown or new role falls back to the engineer rig.
   Live agent color: deterministic from the id hash over a fixed palette of 12 distinct hues that avoids the six core colors.
   Name: `profile.name` as sent (for example "code-reviewer #2"); the bubble must truncate long names with CSS (no layout break).
   Desks for bays are one `InstancedMesh` set (no per-bay React tree), screens glow when the occupant works.
   Spawn: scale/fade in over 0.4 s at the Operations Hub, then walk to the bay.
   Despawn: after success or error emote (the existing `emote`), walk to the hub, scale/fade out over 0.4 s.
   Reduced motion: no scale animation, instant appear and disappear after the emote.
   Per-agent resources (animator, trail, label anchor, comm link refs) are created on spawn and disposed on despawn; no leaks over 200 spawn/despawn cycles.
5. **Interaction and panels.**
   Picking, hover, follow, Focus camera, pause/resume and the Activity feed work for any id, core or live.
   Agents panel lists core agents first, then live agents (newest first), then Finished.
   Mission control, planning board and station owner logic keep using core agents only; live agents must not break them (they ignore unknown ids).
6. **Sound.**
   Speaker pitch for non-core ids: hash to a major pentatonic note in C4..C6; `agent.spawned` and `agent.despawned` get short soft cues (rising and falling two-note blip), throttled like other cues.
7. **Backend contract.**
   Update `wsProtocol.ts` parsing: validate `profiles`, drop unknown or malformed agents defensively, cap live agents at 64 total, ignore duplicates.
   `MockAgentBackend` and `SimulationEngine` keep publishing exactly the six core profiles (no behavior change).
8. **Dev fixture to see it work.**
   Add `scripts/fake-live-server.ts` (Node WebSocket server, `npm run live:fake`) that speaks the existing protocol and spawns, works and despawns agents on a timer, including 4 simultaneous agents of the same role and 16 agents at once (to exercise the waiting queue).
   Document the two env vars to point the UI at it in the report; do not edit the README (docs are a later phase).

## Tests

Extend `npm test` (new `scripts/tests/liveAgents.ts`, called from `scripts/simulate.ts`):
`allocateBay` (lowest free, full returns null, reuse after free), bay slots inside `FLOOR` and not colliding with stations/rings, profile parsing (valid, malformed, duplicates, over cap), unknown id lookups never throw, spawn/despawn lifecycle against the WebSocket backend with a fake server (spawned agents appear in the snapshot, waiting queue promotes when a bay frees), simulation determinism unchanged (existing seeded checks still pass), color hash determinism and no collision with core colors, pitch hash is within range.

## Verify in the browser

Run `npm run live:fake` and the app with the websocket env vars, check with Playwright: robots appear one per agent, four same-role agents are four distinct robots with distinct colors and names, 16 agents show 12 in bays plus "+4 waiting", despawned robots leave, no console errors under StrictMode, frame rate acceptable in low and high quality.
Also confirm normal simulation mode and "Run demo" are visually unchanged.

## Quality

- Gates: `npm run typecheck`, `npm run lint`, `npm test`, all clean, no warnings.
- No `any` outside third-party boundary casts; files under 800 lines; no per-agent React tree for desks; no work in `useFrame` that allocates per agent per frame.
- No binary assets, no network at runtime besides the configured WebSocket.
- No em dashes anywhere.
- Do not edit `docs/spec/`, `docs/PLAN.md`, `.claude/` or `AGENTS.md`.
- Do not commit; the reviewer commits after review.
- Do not start phase 10 (the Claude Code bridge).
