# Phase 10 brief: Claude Code bridge (real subagents shown live)

You are the implementer (see `AGENTS.md`).
Phases 1-9 are merged on `main` (phase 9 = dynamic live agents, PR #11).
Work on a new branch `phase-10-claude-code-bridge` created from `main`.

## Goal

Show a real Claude Code run in the UI.
Claude Code hooks report what the main conversation and every subagent are doing.
A small local bridge turns those hook calls into the existing WebSocket protocol, so each real subagent instance becomes its own robot (phase 9 made that possible), with its tool calls as activity, its start and end as spawn and despawn.
The main conversation is Orion.
Simulation mode must stay unchanged.

## Read first

1. `AGENTS.md`, `docs/PLAN.md`, spec sections 0 (non-negotiable 3: honesty), 3.4, 3.5, 10 of `docs/spec/ai-agent-world.md`.
2. `docs/briefs/phase-9-live-agents.md` and the phase 9 code it produced: `src/integrations/wsProtocol.ts` (the only accepted wire format, all input is untrusted), `AgentBackend.ts`, `WebSocketAgentBackend.ts`, `backendClient.ts`, `src/simulation/bays.ts`, `worldLayout.ts`, `src/agents/agentPalette.ts`, `agentTypes.ts` (`normaliseAgentRole`).
3. `scripts/fake-live-server.ts`, `scripts/lib/fakeLiveScenario.ts`, `scripts/lib/miniWebSocket.ts`: the fake live backend already implements the stage (bays, walking, waiting queue, fade, snapshots, events).
   The bridge must reuse that logic, not copy it (see Design 1).
4. Claude Code hooks reference: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/sub-agents.
   The facts below come from a summarised read of those pages; the exact field spellings must be confirmed against real payloads in step 1 of Build.

## Facts about Claude Code hooks (to be verified, do not trust blindly)

- Events used here: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`.
- Common stdin JSON fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`.
  Hooks that fire inside a subagent also carry `agent_id` (unique per instance) and `agent_type`.
  Hooks in the main conversation have neither.
- `PreToolUse` and `PostToolUse`: `tool_name`, `tool_input`, `tool_use_id` (post adds `tool_response`, `duration_ms`).
  `PostToolUseFailure` adds `error`, `is_interrupt`.
- `SubagentStart`: `agent_id`, `agent_type`.
  `SubagentStop`: `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`.
  It also fires for Claude Code's own internal agents, with an empty `agent_type`; ignore those.
- The subagent tool is named `Agent` (older name `Task`); its `tool_input` has `description`, `prompt`, `subagent_type`.
  Match both names.
- There is no event for a cancelled or crashed subagent.
  Nested subagents (up to 3 levels) and background subagents are not confirmed to emit start and stop events.
- A hook can be a `command` hook with `"async": true` (not awaited, `timeout` is seconds), or an `http` hook.
  Exit code 0 means success; any failure of an http hook is non-blocking.
- Hooks from user, project, local and plugin settings are merged and run in parallel.

## Design

1. **Shared stage.**
   Extract the reusable world model from `scripts/lib/fakeLiveScenario.ts` and `scripts/fake-live-server.ts` into a pure module `src/simulation/liveStage.ts` (no Node APIs, no React, `.ts` import extensions so Node runs it).
   API sketch (adjust to what the code needs): `spawn(profile)`, `setActivity(id, text, status)`, `link(from, to, kind)`, `finish(id, outcome)`, `remove(id)`, `reset()`, `tick(dt)`, `snapshot()`, `drainEvents()`.
   It owns bay allocation, the waiting queue, walking routes, fade timing, link expiry and snapshot building.
   The fake server becomes a scenario driver on top of it and keeps passing every existing check unchanged.
   The bridge becomes a hook driver on top of it.
2. **Bridge process** in `bridge/` (`bridge/server.ts`, run with `npm run bridge`, same `node --experimental-strip-types --no-warnings` style as `live:fake`).
   One HTTP server on `127.0.0.1` (default port 8791, env `BRIDGE_PORT`):
   - `POST /hook` receives hook JSON.
   - WebSocket upgrade on `/ws` speaks the existing protocol (`snapshot` on connect and on change, `event`, `ack`).
   The UI connects with `NEXT_PUBLIC_AGENT_BACKEND=websocket NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8791/ws`.
   Reuse `scripts/lib/miniWebSocket.ts` (move it to a shared place such as `bridge/lib` or `src/simulation` only if needed; do not copy it).
   Like the fake server, the bridge does not tick while no WebSocket client is connected, but it must still apply incoming hook events to the stage so that a late-connecting UI sees the current state.
3. **Forwarder** `bridge/hook-forward.mjs` (plain Node ESM, no flags, no dependencies).
   Reads the hook JSON from stdin, POSTs it to `http://127.0.0.1:${BRIDGE_PORT:-8791}/hook` with a 1 s timeout, ignores every error, prints nothing, always exits 0.
   It must never slow or break a Claude Code session, including when the bridge is not running.
   Ship `bridge/hooks.example.json` (the `hooks` block with `"async": true`, short `timeout`, `type: "command"`) for the matching events, plus a README section "Connecting Claude Code" explaining where to paste it (`~/.claude/settings.json` for all projects, or `.claude/settings.json` / `.claude/settings.local.json` for one project).
   Do not edit `.claude/` in this repo; the reviewer installs hooks.
4. **Mapping** (pure functions in `bridge/mapping.ts`, fully unit tested):

   | Hook | Effect |
   |---|---|
   | `SessionStart` | Orion `thinking`, event `system.started` once |
   | `PreToolUse` without `agent_id` (main conversation) | Orion `working`, activity "Tool: target", walks to its hub; if the tool is `Agent` or `Task`, remember `description` and `subagent_type` for the next matching start |
   | `SubagentStart` with non-empty `agent_type` | spawn a live agent: id = `agent_id`, name `"<agent_type> #<n>"` (n counts per type, resets on reset), role from the table below, `agent.spawned`, an `assign` link Orion to it, activity = remembered description if any (FIFO per `subagent_type`, best effort) |
   | `PreToolUse` with `agent_id` | that agent `working`, activity "Tool: target" |
   | `PostToolUse` with `agent_id` | that agent `thinking` |
   | `PostToolUseFailure` with `agent_id` | warning event, activity "Tool failed: <tool>", status stays `working` (a failed tool is not a failed agent) |
   | `SubagentStop` | `finish(agent_id, "success")`: success emote, `report` link to Orion, `agent.despawned` with duration; set a short truncated summary from `last_assistant_message` only as activity text |
   | `Stop` | Orion `idle` |
   | `SessionEnd` | despawn every live agent of that session as success; Orion `idle` |
   | anything else, unknown fields, internal agents | ignored without error |

   Role table (`agent_type` to `AgentRole`, case insensitive, first match wins): contains `review` or `audit` to `reviewer`; contains `test`, `tdd`, `e2e`, `qa` to `qa`; contains `plan`, `architect`, `design` to `product_manager`; contains `explor`, `research`, `docs`, `lookup`, `scout` to `researcher`; everything else to `engineer`.
5. **Orphan reaper.**
   There is no event for a cancelled or crashed subagent, so a live agent with no hook event for 10 minutes despawns with outcome `error` and activity "Lost contact".
   Also despawn on `SessionEnd`.
   The threshold is a named constant.
6. **Privacy and redaction (hook payloads contain prompts, file contents and commands).**
   Never forward or store `prompt`, `tool_response`, `transcript_path`, `last_assistant_message` beyond a 120 character truncated activity text, and never log raw payloads.
   Activity target text: for file tools the path relative to `cwd` (cap 80 chars), for `Bash` the first 60 characters of the command with obvious secrets masked (`Authorization`, `Bearer`, `token=`, `password=`, `api_key`, `sk-` style keys, `ghp_`, AWS key shapes), for `Agent` the `description`, for other tools the tool name only.
   Pure `redact()` function with tests.
7. **Trust boundary.**
   Bind `127.0.0.1` only.
   `POST /hook`: reject with 403 any request that has an `Origin` header (browsers always send one; Claude Code does not), require `content-type: application/json`, cap the body at 256 KiB, validate every field with type checks before use (ids are strings of bounded length without control characters, same rules as `wsProtocol.ts`), unknown hook names are ignored with 204, malformed input gets 400, never throw out of the handler.
   WebSocket: the same Origin allow-list as the fake server (localhost and 127.0.0.1, or no Origin).
   Cap live agents at the phase 9 limit (64); extra spawn requests are dropped and counted.
   Per-IP rate limiting is not needed (localhost), but a simple cap of 200 hook calls per second must drop the excess instead of growing memory.
8. **Capabilities and the demo buttons.**
   The bridge cannot accept tasks or pause agents.
   Add an additive protocol message `{type:"hello", capabilities:{submitTask:boolean, pauseAgent:boolean, setSpeed:boolean}}` sent on connect (validate it in `wsProtocol.ts`; backends that never send it keep today's behavior, all true).
   The bridge sends all false.
   The UI hides Run demo, Load sprint, New task, the speed control and the per-agent Pause button when the matching capability is false, and the live-mode Overview card says what the view is ("Live Claude Code session. Agents appear when Claude Code starts subagents.").
   Commands the bridge cannot do answer `{type:"ack", ok:false, error:"not supported"}`; `start`, `pause`, `resume` are accepted as no-ops that only change the reported status; `reset` clears the stage.
   This also resolves the phase 9 leftover about Demo buttons in live mode.
9. **Honesty.**
   In bridge mode the top bar must say "Live backend" with the connection state; the "Simulation mode" copy never appears (already gated on `backend.simulated`; confirm the bridge reports `simulated: false`).
10. **Tasks are out of scope.**
    Do not invent tasks from prompts (privacy and accuracy).
    Mission control and the Tasks tab stay empty in bridge mode; the Agents panel, activity feed, 3D scene and sounds are the product here.

## Build order

1. **Capture first.**
   Add `npm run bridge -- --capture` that prints, for each hook call, only the event name and the field names with value types (no values), so the real payload shapes can be confirmed.
   Add synthetic fixtures under `bridge/fixtures/` that mirror the facts above; correct the Facts section assumptions in your report if real payloads differ.
2. `src/simulation/liveStage.ts` extraction with the fake server migrated (all existing tests green before moving on).
3. `bridge/mapping.ts`, `redact.ts`, reaper, `server.ts`, `hook-forward.mjs`, `hooks.example.json`.
4. Protocol `hello` plus UI capability gating.
5. README section.

## Tests

New `scripts/tests/bridge.ts`, called from `scripts/simulate.ts`:
mapping table (each row above), role table, per-type ordinals, FIFO description matching, internal agents with empty `agent_type` ignored, four parallel subagents of the same type become four distinct live agents and four despawns, `SubagentStop` for an unknown id ignored, `SessionEnd` despawns all, orphan reaper with an injected clock, cap of 64 and the rate cap, redaction cases (Bearer token, `sk-` key, `password=`, a long Bash command, absolute path made relative), `POST /hook` validation (Origin present gives 403, wrong content type, oversize body, malformed JSON, unknown hook name), a real WebSocket client sees `hello`, snapshot and events for a scripted session, a late-connecting client sees current state, capability gating helper, `hello` parsing in `wsProtocol.ts` (absent means all true, malformed ignored).
Add `scripts/replay-hooks.ts` that POSTs a scripted session (main conversation tool calls, four parallel `code-reviewer` subagents, one `tdd-guide`, a failing tool, one subagent that never stops) so the UI can be watched without Claude Code.
The existing 385 checks must keep passing.

## Verify in the browser

Run `npm run bridge`, the app with the websocket env vars, and `scripts/replay-hooks.ts` (add an npm script `bridge:replay`).
Check with Playwright: robots appear per subagent, four same-type subagents are four robots with distinct names, activity text updates from tool calls, finished agents move to the Finished group, the lost one despawns as error after the (test-shortened) reaper time, Run demo, Load sprint, New task, speed and per-agent Pause are hidden, no "Simulation mode" copy, no console errors, simulation mode (no env vars) is unchanged.
The reviewer will do the final check with real Claude Code hooks installed; do not edit `.claude/` or user settings.

## Quality

- Gates: `npm run typecheck`, `npm run lint`, `npm test`, all clean, no warnings (also run `npx eslint scripts bridge`).
- No new runtime dependency unless unavoidable (explain it in the report); no network access beyond `127.0.0.1`; no persisted payloads; no logging of payload values.
- Files under 800 lines, functions under about 60 lines; `liveStage.ts` has no Node or DOM APIs.
- No `any` outside third-party boundary casts; no em dashes anywhere.
- Do not edit `docs/spec/`, `docs/PLAN.md`, `.claude/` or `AGENTS.md`.
- Do not commit; the reviewer commits after review.

## Report

List files created and changed, what you verified, the real hook payload facts you could confirm or not (step 1), and anything left out on purpose.

## Open questions for the reviewer (do not decide alone)

- Several Claude Code sessions at once would all feed one world; this phase keeps one merged world and one Orion.
- `run_in_background` and nested subagent hook behavior are unconfirmed; record what the capture shows.
- Whether to ship the hooks as a plugin later (plugins can carry `hooks/hooks.json`).
