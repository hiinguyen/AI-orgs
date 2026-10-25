# AI Agent World

A living 3D office in the browser where six AI agents - an Orchestrator, a Product Manager, a Researcher, a Software Engineer, a QA Engineer and a Code Reviewer - walk between labelled stations, exchange glowing messages, fail a test, fix it, get approved, and celebrate. Every walk, gesture, screen glow, speech bubble, sound and communication arc is driven by backend state and a fixed vocabulary of structured events. Nothing on screen is decorative animation that lies about what the system is doing.

**This runs on a deterministic local simulation, not on LLMs.** No model is called, no code is written, all outputs are canned templates. The UI says so plainly - "Simulation mode - no live inference" in the top bar, the task dialog, settings and the demo callout. The architecture makes it trivial to swap the simulation for a real orchestrator over WebSocket without touching the 3D layer or the UI (see [Connecting a real backend](#connecting-a-real-backend)).

![Demo run video: the scripted demo task from queue to celebration, at 1x speed with sound](docs/demo.mp4)

---

## Contents

- [Quick start](#quick-start)
- [The 94-second demo](#the-94-second-demo)
- [The team](#the-team)
- [Feature tour](#feature-tour)
- [Controls](#controls)
- [Commands and checks](#commands-and-checks)
- [Architecture](#architecture)
- [Demo, backlog and sprint content](#demo-backlog-and-sprint-content)
- [Connecting a real backend](#connecting-a-real-backend)
- [Connecting Claude Code](#connecting-claude-code)
- [Testing](#testing)
- [Engineering notes: why the code looks like this](#engineering-notes-why-the-code-looks-like-this)
- [More docs](#more-docs)

## Quick start

Requires Node 22.7+ or 24+ (the test script runs TypeScript directly via `node --experimental-strip-types`) and any browser with WebGL 2.

```bash
npm install
npm run dev
```

Open http://localhost:3000, wait ~1 second for the loading screen, then press **Run demo** in the top bar. Within about 100 seconds you will watch six distinct robots walk between labelled stations, exchange glowing messages, fail a test, fix it, get approved, and celebrate - with sound - while every step is mirrored in the side panel and the activity feed.

No other setup, no binary assets to download: textures are painted on `<canvas>` at runtime, sounds are synthesised with Web Audio, and the robots are procedural primitives. The repo runs with `npm install && npm run dev` and nothing else.

URL flags:

- `?quality=high` - force the high rendering path (shadows, environment reflections, full skyline, DPR up to 1.75).
- `?quality=low` - force the performance path (no shadows or environment, ~120 skyline towers, capped DPR).

Without a flag the app picks quality up front from the machine (cores, viewport width, reduced-motion preference) and can still drop to low automatically if the frame rate cannot hold (see [Rendering and performance](#rendering-and-performance))).

### Two ways to run it

| Mode | What drives the robots | How to start |
| --- | --- | --- |
| Simulation (default) | The deterministic local simulation, no hooks needed | `npm run dev`, then press **Run demo** |
| Live (Claude Code) | Your real Claude Code sessions, through hooks | `npm run bridge` plus `npm run dev` with two environment variables |

Live mode needs two processes.
Start the hooks bridge in one terminal:

```bash
npm run bridge
```

Start the app, pointed at the bridge, in a second terminal:

```bash
NEXT_PUBLIC_AGENT_BACKEND=websocket \
NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8791/ws \
npm run dev
```

Open http://localhost:3000 and check that the top bar reads "Live backend".

To see it move without Claude Code, run `npm run bridge:replay` in a third terminal.
It posts a scripted session with parallel subagents, tool calls and a failure, so you can watch robots appear and the six core agents change posture.

To drive it with real Claude Code sessions, install the hooks once (step 3 of [Connecting Claude Code](#connecting-claude-code)), then start Claude Code in any project.
Each session gets its own robot, and each subagent gets one that hangs off it.
The six core agents mirror the live agent of their role: they type while it works, think between tool calls, and flash green or red when a subagent finishes or fails.
In live mode Run demo, Load sprint, New task and the speed control are hidden, because the bridge only watches.

If nothing shows up:

- The top bar still says "Simulation mode": the `NEXT_PUBLIC_*` variables are read when the dev server starts, so stop it and start it again with them set.
- Opening http://127.0.0.1:8791 only shows a banner and proves the bridge is up, not that hooks arrive. Run `npm run bridge -- --capture` to print the name of each hook event as it comes in.
- Hooks arrive from `npm run bridge:replay` but not from Claude Code: Claude Code reads hook settings when a session starts, so start a new session, or review them with `/hooks`.
- Port 8791 is busy: set `BRIDGE_PORT`, use the same port in `NEXT_PUBLIC_AGENT_WS_URL`, and export the same `BRIDGE_PORT` in the environment that runs Claude Code.
- Short read-only subagents finish in seconds, so their robots can leave before you look. Use `npm run bridge:replay` to see long-lived ones.

## The 94-second demo

The **Run demo** button loads a single scripted task and runs it at 1x speed. It completes in about 94 simulation seconds, tick for tick identical on every run:

1. **Intake** - Orion (orchestrator) walks to the Operations Hub, thinks, then talks to Piper. A glowing assignment arc fires and `T-001` becomes hers.
2. **Planning** - Piper walks to the Sprint Planning board in the west corner and breaks the task into six subtasks; sticky cards appear one by one as the breakdown progresses, with a progress bar and percent on the board. She briefs Iris.
3. **Research** - Iris works at the dark Research board on the centre-right side of the floor, where findings appear as rows with a progress bar while she researches, then briefs Kai.
4. **Implementation** - Kai works at the Engineering Station; his monitors glow while he types, subtasks tick off, the mission-control wall tracks progress. He submits the build to Quinn.
5. **Testing** - Quinn runs the test suite at the QA Lab - and the demo task is scripted to **fail** on the first attempt. Quinn shows a red pulse, buzzes, and reports back to Kai.
6. **Rework** - Kai returns to his desk, fixes the failing test (iteration 2) and submits again. Quinn's tests pass this time; Rex gets the build.
7. **Review** - Rex reviews at the Review Station, approves, and tells Orion.
8. **Done** - Orion walks back to the hub, a success pulse fires, the completion fanfare plays, and the mission-control wall and task card hit 100%.

The whole choreography - who walks where, who talks to whom, which subtask is done, which screen glows - is a projection of the simulation state, not a canned animation. If you pause the simulation, agents freeze mid-step and their tasks turn `blocked`. If you pause an individual agent, their work (and only their work) halts with a "Kai is paused" banner.

## The team

| id | name | role | tagline | colour | home station |
|---|---|---|---|---|---|
| orion | Orion | Orchestrator | Coordinates work and delegates tasks | `#E8B04A` | Operations Hub |
| iris | Iris | Researcher | Researches technical topics and gathers information | `#5CC8D7` | Research Station |
| piper | Piper | Product Manager | Converts requirements into actionable tasks | `#A78BFA` | Product Station |
| kai | Kai | Software Engineer | Implements software features | `#6C9EFF` | Engineering Station |
| quinn | Quinn | QA Engineer | Tests completed work | `#5FD39A` | QA Lab |
| rex | Rex | Code Reviewer | Reviews implementation quality | `#F08A7E` | Review Station |

Each role has a distinct rig: Orion is taller with a crown-like visor, Iris has a lens, Piper carries a tablet, Kai wears a headset, Quinn has twin sensors, Rex has a monocle. Each agent has a seat index and every shared location (the collab table ring and a row of six stand slots in front of each board) has one slot per seat, so two agents never overlap there, and a personal pitch used for their communication sounds (Orion C5, Piper E5, Iris D5, Kai A4, Quinn F5, Rex G4).

## Feature tour

**The world.** A dark glass office at blue hour: procedural floor tiles, a dusk-gradient window wall with an instanced skyline of ~260 towers behind it, low glass partitions between zones, plants, drifting dust motes. One wall carries the **mission-control screen** - a canvas texture that redraws a few times per second with active task titles, phases, progress bars and agent statuses, only when the content actually changed. The **sprint planning board** holds up to 24 sticky cards that appear as subtasks are created and change tint when they are done; its amber LED and progress strip run while the planner works there. The **research board** opposite it is a dark display that lists findings as rows with its own progress strip, and its cyan LED brightens while the researcher works there. Desks have chairs and monitors with a scrolling procedural "code" screen whose emissive glow rises while the owner works.

**The agents.** Procedural robots with a blended pose system: idle breathing, walking driven by actual speed, typing, thinking (head tilt, hand to chin), talking gestures, a success bounce and an error slump. Each agent trails a path of small discs flowing along their remaining route, with a breathing ring at the destination. Communication is drawn as a glowing bezier arc between the two agents with instanced packet sprites travelling along it. Speech bubbles are DOM pills that track the 3D position of each agent (see [engineering notes](#engineering-notes-why-the-code-looks-like-this) for why they are not drei `<Html>`).

**The UI.** Everything floats above the canvas: an icon rail (Overview / Agents / Tasks / Activity / Settings), a top bar with live metrics (Agents, Active, Pending, Completed) and simulation controls (start/pause, speed 0.5x to 4x, mute, reset, Run demo, Load sprint, New task), and a side panel:

- **Overview** - callout with the demo buttons, agent roster, in-flight task cards, latest activity.
- **Agents** - select an agent to see what they are doing right now, assign them a task, pause/resume them, follow them with the camera, or read their event history (activity and communication tabs).
- **Tasks** - filter and sort task cards with progress bars in the owner's colour; open a task for its workflow, subtasks, research findings and full timeline, including "Reworked 2x after QA feedback".
- **Activity** - the full event feed with severity dots and a "messages only" filter.
- **Settings** - rendering quality, overlays (paths, speech indicators), sound, backend connection details, and the key simulation constants.

**Sound.** Fully procedural Web Audio: per-agent message pings at their own pitch, keyboard clicks while implementing, a whoosh on submit, a buzzer on failed tests, chimes on pass/approve, a fanfare on completion, a thud when a paused task blocks, and a soft office hum while the simulation runs. Master gain runs through a compressor; the mute toggle and the `M` key persist in `localStorage`.

## Controls

Keyboard (ignored while typing in inputs or with the dialog open):

| key | action |
|---|---|
| `Space` | start / pause / resume the simulation |
| `N` | new task dialog |
| `B` | load the 8-task sprint (resumes if paused) |
| `M` | mute / unmute |
| `Esc` | clear selection, stop following |

Mouse: click an agent or a station to select it (the camera focuses, details open in the panel); drag to orbit, scroll to zoom; hover highlights. Camera presets in the bottom bar cover Overview, Operations Hub, Research, Development and Collaboration. Selecting an agent offers a follow mode that tracks them with a damped camera until you press `Esc` or drag.

The orbit camera is clamped so you can never leave the office (target locked to the floor area, distance 3.5 to 70 m, polar 0.18 to 1.36 rad), and preset distances scale against whatever screen area the floating UI leaves free, so the same part of the office stays visible on a narrow window or a phone.

## Commands and checks

```bash
npm run dev        # Next dev server on :3000
npm run build      # production build
npm run start      # serve the production build
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint over src/
npm run test         # headless simulation suite (see Testing)
npm run bridge       # Claude Code hooks bridge on 127.0.0.1:8791
npm run bridge:replay # scripted hook session, no Claude Code needed
```

CI runs `npm ci` plus typecheck, lint, the headless simulation tests and a production build on Node 22 and 24 on every push and pull request. A phase counts as done only when the checks pass locally.

## Architecture

Three hard layers with one-way data flow. Rendering never mutates simulation state; all commands go through the backend contract.

```
                +-------------------------------------------------+
   commands     |            AgentBackend (contract)              |
 (UI -> cmd)   |  mock: SimulationEngine   websocket: WS client   |
                +----------------------+--------------------------+
                                       |  events (AgentEvent[])
                                       |  snapshots (WorldSnapshot, 30 Hz)
                                       v
                +-------------------------------------------------+
                | useWorldStore (Zustand)                         |
                |  liveWorld   mutable buffer, read by useFrame    |
                |  mirror      throttled React state (~160 ms)    |
                +----------------------+--------------------------+
                        |                          |
             reads in useFrame              subscribes (React)
                        v                          v
                 three.js canvas            HTML panels, feed,
                 (world, agents,            task cards, top bar
                  arcs, sound hooks)
```

- **Simulation** (`src/simulation`, `src/tasks`, `src/events`, non-React `src/agents`): the entire mock brain in pure TypeScript that also runs in Node without a browser. `SimulationEngine` owns a seeded RNG, an `AgentController` per agent (each with an action queue of `move / work / talk / emote / wait / call`), the task scheduler (Orchestrator picks highest priority, then oldest, up to 2 concurrent), the `WorkflowStateMachine`, and an event bus capped at 400 events.
- **Contract** (`src/integrations`): `AgentBackend` - `connect / start / stop / pause / resume / reset / setSpeed / submitTask / pauseAgent / resumeAgent / getSnapshot / subscribe / subscribeSnapshot` - implemented by `MockAgentBackend` (wraps the engine, ticks it with `setInterval`, clamps each real-time step so a sleeping tab never teleports agents) and `WebSocketAgentBackend`. `backendClient.ts` selects by env var and exposes a `commands` object the UI calls.
- **State** (`src/state`): every snapshot is written into the mutable `liveWorld` buffer, and a React update is pushed at most every 160 ms unless a *significant* signature changed (statuses, phases, assignments). The 3D layer reads `liveWorld` inside `useFrame` - position changes alone never re-render React.
- **World** (`src/world`): canvas, lighting, environment, workstations, camera controller, raycast picking, shared geometry/material pools, procedural textures, DOM label anchors.
- **UI** (`src/components`): shell, panels, controls, feed. Talks only to the store and `commands`.

### Domain model

A task moves through a fixed state machine; its status is a projection of its phase:

```
queued -> intake -> planning -> research -> implementation -> testing -> review -> done
                              ^              |               |
                              |   tests_failed|               | changes_requested
                              +---------------+---------------+
any non-terminal --abort--> failed
```

- Entering `implementation` bumps the iteration counter (attempt 1, 2, 3 - the cap).
- QA fails with probability 0.3, review requests changes with probability 0.25, both only below the iteration cap; rework resets progress to the phase start.
- Scripted tasks (`script: { qaFailsOn: [1], reviewChangesOn: [2] }`) force exact outcomes per iteration so demos are repeatable to the second.
- Pausing the responsible agent overrides the status to `blocked` with a reason, without touching the phase.

Everything is serialisable plain data - `AgentState`, `Task`, `AgentEvent`, `WorldSnapshot` - because a real backend would send exactly these over the wire.

### Determinism

Same seed + same inputs = same run, tick for tick. The engine uses a mulberry32 RNG from `seed: 20261018`, and each task's RNG is seeded by `hashString(title) ^ seed ^ taskSeq`, so QA and review outcomes are stable across runs. The demo task is fully scripted; the test suite proves a fresh engine finishes the demo within 0.05 simulation seconds of the previous run.

### Rendering and performance

Budget: hold 60 fps on a 2020 laptop. The main levers:

- One shadow-casting directional light with a tight orthographic frustum over the floor; hemisphere fill; a few shadowless warm accents; a procedural `Environment` built from `Lightformer`s (no HDR download). In low quality, shadows and environment are skipped.
- Shared geometry and material pools (`sharedGeometry` / `sharedMaterial`, per-colour accent pools), `InstancedMesh` for the skyline, path discs, comm packets and planning-board sticky cards.
- No post-processing; ACESFilmic tone mapping; DPR capped per quality path.
- `PerformanceMonitor` with 2 flip-flops; on fallback the store switches to the `low` path (kept until reload; a forced `?quality=` is never overridden).
- Mobile: the nav rail collapses to a bottom bar, the side panel becomes a bottom sheet, and quality starts low.
- `prefers-reduced-motion` disables pulse and bubble animations and freezes agent animation weights.

### Audio

A singleton `SoundEngine` lazily creates the `AudioContext` on the first pointer/key event (a browser requirement - before that, cues are silent no-ops), routes master gain through a compressor, throttles per event type, and keeps an ambient brown-noise bed while the simulation runs. Settings persist in `localStorage` under `aaw.sound.v1`.

## Demo, backlog and sprint content

- **Demo task** - "Build a user authentication API with JWT support", scripted to fail QA once and pass review, completing on iteration 2 in ~75 s.
- **Backlog** - 18 realistic product tasks across auth, payments, search, realtime, migrations, notifications, performance, deploy, mobile sync, export, i18n, AI, rate-limiting, API and UI domains. Two are scripted: a critical session-token hot-fix that passes on iteration 3, and a billing migration that fails after the iteration cap.
- **Sprint** (`B` or Load sprint) - an 8-task subset including both scripted tasks, two criticals and a low-priority export task that visibly waits in the queue behind the concurrency cap.
- The **New task** dialog offers suggestion chips and a "Surprise me" random backlog pick. A preferred agent is routed via the Orchestrator so the full workflow still applies.

Work content (subtasks, findings, test names, review notes) comes from domain templates matched by regex on the task text, with a generic fallback - written like a senior engineer's notes, generated by no one.

## Connecting a real backend

The mock is only one implementation of a small contract. Set:

```
NEXT_PUBLIC_AGENT_BACKEND=websocket
NEXT_PUBLIC_AGENT_WS_URL=wss://your-orchestrator.example/agents
```

and the app connects over WebSocket using this JSON protocol:

Client -> server commands (each with a UUID `id`):

```json
{"type":"command","id":"<uuid>","command":{"name":"start"}}
{"type":"command","id":"<uuid>","command":{"name":"setSpeed","multiplier":2}}
{"type":"command","id":"<uuid>","command":{"name":"submitTask","input":{"title":"...","priority":"high"}}}
{"type":"command","id":"<uuid>","command":{"name":"pauseAgent","agentId":"kai"}}
```

Server -> client:

```json
{"type":"event","event":{"id":"...","type":"qa.failed","agentId":"quinn","taskId":"T-001","severity":"warning","message":"...","simTime":12.4}}
{"type":"snapshot","snapshot":{"clock":42.5,"status":"running","speed":1,"agents":[...],"tasks":[...],"links":[...]}}
{"type":"ack","id":"<uuid>","ok":true,"result":{...}}
```

Snapshots arrive on connect and on change; `links` are communication arcs the 3D layer draws between agents. The full event vocabulary (28 event types), the snapshot shape and the agent/task models are defined in `src/events/eventTypes.ts`, `src/integrations/AgentBackend.ts` and `src/tasks/taskTypes.ts` - implement them and the entire visualisation, UI and sound layer works without a single change on the 3D side. The settings panel shows which backend is connected, and the top bar switches from "Simulation mode - no live inference" to "Live backend".

## Connecting Claude Code

The bridge lets a real Claude Code run drive the 3D world. Claude Code hooks POST their JSON to a local server, which gives every Claude Code session its own live robot, named after the session's working directory folder (for example `my-repo #1`), and every subagent instance its own robot hanging off its session's robot: tool calls become activity, `SubagentStart` spawns a robot and `SubagentStop` sends it home, and `SessionEnd` removes the session robot with its subagents.
Live robots also mirror their activity and status onto the core agent that matches their role, so the six core agents are no longer idle fixtures.
Core agents return to idle when no live agent of their role remains.
When several live agents share a role, the core agent shows whichever wrote last, so its text and status can come from different agents on status-only updates.
Orion also remains the fallback driver when the live agent cap is full.

| Live agent role | Claude Code source | Core agent |
| --- | --- | --- |
| orchestrator | session robot | Orion |
| researcher | `explore`, `research`, `docs`, `lookup`, `scout` subagents | Iris |
| product_manager | `plan`, `architect`, `design` subagents | Piper |
| engineer | any other subagent type | Kai |
| qa | `test`, `tdd`, `e2e`, `qa` subagents | Quinn |
| reviewer | `review`, `audit` subagents | Rex |

1. Start the bridge in one terminal:

   ```bash
   npm run bridge
   ```

   It listens on `http://127.0.0.1:8791`; set `BRIDGE_PORT` to change the port. `npm run bridge -- --capture` additionally prints each hook's event name and the field names with their value types. It never prints values, prompts, commands, tool responses or transcript paths.

2. Start the app against it:

   ```bash
   NEXT_PUBLIC_AGENT_BACKEND=websocket \
   NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8791/ws \
   npm run dev
   ```

   The top bar reads "Live backend". Simulation mode is unchanged when those variables are absent.

3. Install the hooks. `bridge/hooks.example.json` contains the `hooks` block for `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop` and `Stop`. Replace `/absolute/path/to/ai-agent-world` with the real checkout path, then merge the block into one of:

   - `~/.claude/settings.json` for every project
   - `.claude/settings.json` or `.claude/settings.local.json` for one project

   Every hook uses `"async": true` with a 5 second timeout and calls `node bridge/hook-forward.mjs`. The forwarder reads stdin, POSTs to the bridge with a 1 second timeout, prints nothing and always exits 0, so a stopped bridge never slows a Claude Code session. If you change `BRIDGE_PORT`, set the same value in the environment that runs Claude Code.

4. Optional: watch without Claude Code. `npm run bridge:replay` posts a scripted session with four parallel `code-reviewer` subagents, a `tdd-guide`, tool calls, a failure and two agents that stay running.

The bridge is read-only by design. Run demo, Load sprint, New task, the speed control and the per-agent Pause button are hidden because the bridge cannot submit tasks, pause agents or change speed; the commands still answer with a friendly "not supported". Tasks and Mission Control stay empty. Several Claude Code sessions are separate robots in one world; live agents (sessions and subagents) share the 64 agent cap, and when it is full a session falls back to driving Orion. OpenCode and other non-Claude-Code agents send no hooks, so they do not appear. Subagents with an empty `agent_type` (Claude Code internal agents) are ignored on purpose. There is no event for a cancelled or crashed subagent, so a subagent with no hook for 10 minutes despawns as an error with "Lost contact". A session with 10 minutes of silence leaves quietly and comes back as a new robot on its next hook. Nested and background subagent hook behavior is not confirmed.

The six core agents mirror the live agents of their role.
A finished subagent flashes its core agent as success for 2.5 seconds, a lost subagent flashes error for 2.5 seconds, then the core agent shows its persistent idle, working or thinking state again.
A failed tool call flashes error for 1.5 seconds on the core agent that mirrors the failing robot, including Orion when it is the fallback driver.
In websocket mode a working or thinking core agent also shows a speech bubble with its current activity, and this bubble follows the speech-indicators toggle.

The bridge never stores or forwards prompts, tool responses, transcript paths or full assistant messages. Activity text is limited to the tool name, a file path relative to the hook `cwd`, the first 60 characters of a masked Bash command, an `Agent`/`Task` description, or a 120 character truncated summary. `redact()` masks `Authorization`/`Bearer` values, `token`, `password` and `api_key` assignments, `sk-` keys, GitHub tokens and AWS access key shapes. Hook requests with an `Origin` header, a non-JSON content type, a body over 256 KiB or malformed fields are rejected; the server binds loopback only and caps hook calls at 200 per second.

## Testing

`npm test` runs `scripts/simulate.ts` - the simulation engine imported directly into Node, no browser, no mocking of the DOM. It prints one check per line and exits non-zero on any failure:

1. State machine transition rules (allowed and rejected signals, terminal phases).
2. The full demo workflow: reaches `done` on iteration 2 with progress exactly 1, all subtasks done, non-empty findings, every expected event type fired, at least 7 agent-to-agent communications, the exact phase order including the rework loop, under 100 simulation seconds.
3. Determinism: a fresh engine finishes the demo within 0.05 sim seconds of the first run.
4. Pause/resume/reset semantics, including agent pause blocking tasks and `reset()` returning to a clean world.
5. Scheduler concurrency and priority ordering (critical beats medium beats low; all three complete).
6. Backlog and sprint integrity (unique titles, domain templates matched, the scripted hot-fix completes on iteration 3, the scripted migration fails, every task has subtasks and findings).

## Engineering notes: why the code looks like this

Nine constraints shaped the implementation, learned the hard way:

1. **Speech bubbles are a DOM overlay, not drei `<Html>`.** drei `Html` creates a nested React root that React 19 StrictMode cannot synchronously unmount - it throws on every double-invoke. Instead, `useFrame` projects each agent's label anchor to screen space into a module-level map, and a plain DOM overlay positions the pills (see `src/world/labelAnchors.ts`, `src/components/world/AgentLabelsOverlay.tsx`).
2. **The Canvas is never remounted** (no `key={quality}`). Remounting tears down every WebGL resource mid-render; `shadows` and `dpr` are reactive props instead, and quality is read from the store inside components.
3. **three r186 removed `PCFSoftShadowMap`** - the lighting uses `PCFShadowMap` with `shadow.radius`.
4. **The simulation imports use explicit `.ts` extensions and never import React, three or Next**, because Node runs those files directly in tests via `node --experimental-strip-types`.
5. **Audio only unlocks on a user gesture** - the `AudioContext` is created from the first pointer/key handler, and every `play()` before that is a silent no-op.
6. **Tab sleep is clamped** - each real-time step is capped at 0.1 s, so agents never teleport after the tab was hidden.
7. **React never re-renders at 30 Hz** - snapshots land in a mutable buffer for `useFrame`; the Zustand mirror updates at most every 160 ms unless a real signature changed.
8. **The camera fits the free screen area** - the floating UI reports its pixel insets, and preset distances scale against them, or the office is cut off on narrow screens.
9. **Click vs orbit uses a 5 px movement tolerance**, or every drag ending on empty space would clear the selection.

## More docs

- `docs/spec/ai-agent-world.md` - the full product specification this was built from, phase by phase.
- `docs/PLAN.md` - phase plan, versions and review gates.
- `docs/spec/reference-screenshots/` - screenshots of the original build this one matches (dark glass UI, layout, density).

The demo video at the top (`docs/demo.mp4`) is a real screen capture of the production build running the scripted demo task at 1x speed with sound.
