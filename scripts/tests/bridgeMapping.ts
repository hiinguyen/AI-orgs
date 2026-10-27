/**
 * Phase 10 checks that do not touch the network: the mapping table, role
 * table, privacy redaction, the orphan reaper and the live-agent cap.
 */
import type { AgentRole } from "../../src/agents/agentTypes.ts";
import { MAX_LIVE_AGENTS } from "../../src/agents/agentTypes.ts";
import { LiveStage } from "../../src/simulation/liveStage.ts";
import { parseHookPayload } from "../../bridge/hooks.ts";
import type { HookPayload } from "../../bridge/hooks.ts";
import {
  applyHook,
  MAX_DESCRIPTION_KEYS,
  MAX_DESCRIPTION_KEY_LENGTH,
  createMappingState,
  resetMappingState,
  roleForAgentType,
} from "../../bridge/mapping.ts";
import {
  DEFAULT_HOOK_RATE_PER_SECOND,
  createHookRateLimiter,
} from "../../bridge/rateLimit.ts";
import { ORPHAN_TIMEOUT_MS, reapOrphans } from "../../bridge/reaper.ts";
import {
  redact,
  relativePath,
  summaryFromMessage,
  toolTarget,
} from "../../bridge/redact.ts";
import type { TestReporter } from "./harness.ts";

interface StageFixture {
  stage: LiveStage;
  state: ReturnType<typeof createMappingState>;
}

function setupStage(): StageFixture {
  return {
    stage: new LiveStage({
      spawnHoldSeconds: 0,
      emoteSeconds: 0.02,
      fadeSeconds: 0.02,
      walkSpeed: 80,
      now: () => 1000,
    }),
    state: createMappingState(),
  };
}

function hook(
  partial: { hook_event_name: string } & Record<string, unknown>,
): HookPayload {
  const parsed = parseHookPayload({
    session_id: "session-1",
    cwd: "/repo",
    ...partial,
  });
  if (parsed.kind !== "ok") {
    throw new Error(`fixture hook rejected: ${parsed.kind}`);
  }
  return parsed.payload;
}

function eventTypes(stage: LiveStage): string[] {
  return stage.drainEvents().map((event) => event.type);
}

function runRoleSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("30. Claude Code agent types");

  const cases: ReadonlyArray<readonly [string, AgentRole]> = [
    ["code-reviewer", "reviewer"],
    ["security-audit", "reviewer"],
    ["tdd-guide", "qa"],
    ["e2e-runner", "qa"],
    ["qa-specialist", "qa"],
    ["system-architect", "product_manager"],
    ["ui-design", "product_manager"],
    ["explore", "researcher"],
    ["research-scout", "researcher"],
    ["docs-writer", "researcher"],
    ["lookup", "researcher"],
    ["code-writer", "engineer"],
    ["general-purpose", "engineer"],
  ];
  check(
    "the role table maps every Claude Code agent type",
    cases.every(([type, role]) => roleForAgentType(type) === role),
  );
  check(
    "role matching is case insensitive and first match wins",
    roleForAgentType("CODE-REVIEWER") === "reviewer" &&
      roleForAgentType("test-reviewer") === "reviewer" &&
      // The table is ordered, so `test` wins over `design` in a mixed name.
      roleForAgentType("design-tester") === "qa" &&
      roleForAgentType("design-planner") === "product_manager",
  );
}

function runSessionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("31. Session and main-conversation mapping");

  const { stage, state } = setupStage();
  const start = hook({ hook_event_name: "SessionStart" });
  applyHook(stage, state, start, 1000);
  applyHook(stage, state, start, 1000);
  const started = eventTypes(stage);
  const robot = stage.snapshot().agents.find((agent) => agent.id === "session-1");
  const orion = stage.snapshot().agents.find((agent) => agent.id === "orion");
  check(
    "SessionStart spawns the session robot, makes it think and emits system.started once",
    started.filter((type) => type === "system.started").length === 1 &&
      robot?.status === "thinking" &&
      orion?.status === "thinking" &&
      orion.activity === "Claude Code session started" &&
      stage.getAgent("session-1")?.profile.name === "repo #1" &&
      stage.getAgent("session-1")?.profile.kind === "live",
  );

  const afterPrompt = eventTypes(stage);
  applyHook(
    stage,
    state,
    hook({ hook_event_name: "UserPromptSubmit" }),
    1000,
  );
  check(
    "UserPromptSubmit is ignored without an event",
    afterPrompt.length === 0 && eventTypes(stage).length === 0,
  );

  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/repo/src/auth.ts" },
    }),
    1000,
  );
  const reading = stage
    .snapshot()
    .agents.find((agent) => agent.id === "session-1");
  check(
    "a main-conversation tool call puts the session robot to work on the relative path",
    reading?.status === "working" &&
      reading?.activity === "Tool: src/auth.ts",
  );
}

function runDescriptionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("32. Agent descriptions and ordinals");

  const { stage, state } = setupStage();
  const remember = (toolName: string, description: string) => {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: { description, subagent_type: "code-reviewer" },
      }),
      1000,
    );
  };
  remember("Agent", "First review");
  remember("Task", "Second review");
  for (const id of ["agent-first", "agent-second"]) {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "SubagentStart",
        agent_id: id,
        agent_type: "code-reviewer",
      }),
      1000,
    );
  }

  const first = stage.getAgent("agent-first");
  const second = stage.getAgent("agent-second");
  check(
    "remembered Agent and Task descriptions are assigned FIFO",
    first?.state.activity === "First review" &&
      second?.state.activity === "Second review",
  );
  check(
    "per-type ordinals name subagents #1 and #2",
    first?.profile.name === "code-reviewer #1" &&
      second?.profile.name === "code-reviewer #2" &&
      first?.profile.role === "reviewer",
  );

  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "agent-third",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "agent-tdd",
      agent_type: "tdd-guide",
    }),
    1000,
  );
  check(
    "ordinals count per type, so a new type starts at #1",
    stage.getAgent("agent-third")?.profile.name === "code-reviewer #3" &&
      stage.getAgent("agent-tdd")?.profile.name === "tdd-guide #1",
  );
}

function runSubagentToolSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("33. Subagent tool mapping");

  const { stage, state } = setupStage();
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "agent-tool",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  const assignEvents = stage.drainEvents();
  check(
    "SubagentStart emits a task.assigned event targeting the new subagent",
    assignEvents.some(
      (event) =>
        event.type === "task.assigned" &&
        event.targetAgentId === "agent-tool" &&
        event.agentId === "session-1" &&
        event.feed,
    ),
  );
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "PreToolUse",
      agent_id: "agent-tool",
      agent_type: "code-reviewer",
      tool_name: "Read",
      tool_input: { file_path: "/repo/src/session.ts" },
    }),
    1000,
  );
  const working = stage.getAgent("agent-tool");
  // getAgent returns the live record, so capture the PreToolUse values before
  // the PostToolUse hook mutates them in place.
  const workingStatus = working?.state.status;
  const workingActivity = working?.state.activity;
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "PostToolUse",
      agent_id: "agent-tool",
      agent_type: "code-reviewer",
      tool_name: "Read",
      tool_input: { file_path: "/repo/src/session.ts" },
    }),
    1000,
  );
  const thinking = stage.getAgent("agent-tool");
  check(
    "subagent PreToolUse works and PostToolUse returns to thinking",
    workingStatus === "working" &&
      workingActivity === "Tool: src/session.ts" &&
      thinking?.state.status === "thinking",
  );

  eventTypes(stage);
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "PostToolUseFailure",
      agent_id: "agent-tool",
      agent_type: "code-reviewer",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }),
    1000,
  );
  const failed = stage.getAgent("agent-tool");
  const failureEvents = stage.drainEvents();
  check(
    "a failed tool keeps the agent working and warns in the feed",
    failed?.state.status === "working" &&
      failed.state.activity === "Tool failed: Bash" &&
      failureEvents.some(
        (event) => event.severity === "warning" && event.feed,
      ),
  );
}

function runStopSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("34. Stop and stop edge cases");

  const stopped = setupStage();
  applyHook(
    stopped.stage,
    stopped.state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "agent-stop",
      agent_type: "tdd-guide",
    }),
    1000,
  );
  eventTypes(stopped.stage);
  applyHook(
    stopped.stage,
    stopped.state,
    hook({
      hook_event_name: "SubagentStop",
      agent_id: "agent-stop",
      agent_type: "tdd-guide",
      last_assistant_message: "All checks pass.",
    }),
    1000,
  );
  const finished = stopped.stage.getAgent("agent-stop");
  const stopEvents = stopped.stage.drainEvents();
  const report = stopped.stage
    .snapshot()
    .links.find(
      (link) => link.from === "agent-stop" && link.to === "session-1",
    );
  check(
    "SubagentStop finishes as success, links a report and keeps the summary",
    finished?.state.status === "success" &&
      finished.state.activity === "All checks pass." &&
      report?.kind === "report",
  );
  check(
    "SubagentStop emits agent.despawned with an outcome and duration",
    stopEvents.some(
      (event) =>
        event.type === "agent.despawned" &&
        event.metadata?.outcome === "success" &&
        typeof event.metadata.duration === "number",
    ),
  );
  check(
    "SubagentStop emits an agent.message event reporting back to the owner",
    stopEvents.some(
      (event) =>
        event.type === "agent.message" &&
        event.agentId === "agent-stop" &&
        event.targetAgentId === "session-1" &&
        event.feed,
    ),
  );

  eventTypes(stopped.stage);
  applyHook(
    stopped.stage,
    stopped.state,
    hook({
      hook_event_name: "SubagentStop",
      agent_id: "agent-unknown",
      agent_type: "tdd-guide",
    }),
    1000,
  );
  check(
    "SubagentStop for an unknown id is ignored",
    stopped.stage.drainEvents().length === 0,
  );

  const internal = setupStage();
  applyHook(
    internal.stage,
    internal.state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "internal-agent",
      agent_type: "",
    }),
    1000,
  );
  check(
    "an internal agent with an empty agent_type is ignored",
    internal.stage.liveAgents.length === 0 &&
      internal.stage.drainEvents().length === 0,
  );

  applyHook(
    internal.stage,
    internal.state,
    hook({ hook_event_name: "SessionStart" }),
    1000,
  );
  applyHook(
    internal.stage,
    internal.state,
    hook({ hook_event_name: "Stop" }),
    1000,
  );
  const idle = internal.stage
    .snapshot()
    .agents.find((agent) => agent.id === "session-1");
  check("Stop returns the session robot to idle", idle?.status === "idle");
  check(
    "Stop does not spawn a robot for an unknown session",
    (() => {
      const fresh = setupStage();
      applyHook(fresh.stage, fresh.state, hook({ hook_event_name: "Stop" }), 1000);
      return fresh.stage.liveAgents.length === 0;
    })(),
  );
}

function runSessionEndSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("35. Session end");

  const { stage, state } = setupStage();
  for (const id of ["end-a", "end-b"]) {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "SubagentStart",
        agent_id: id,
        agent_type: "code-reviewer",
      }),
      1000,
    );
  }
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "end-other",
      agent_type: "code-reviewer",
      session_id: "session-2",
    }),
    1000,
  );
  eventTypes(stage);
  applyHook(
    stage,
    state,
    hook({ hook_event_name: "SessionEnd" }),
    1000,
  );
  const endEvents = stage.drainEvents();
  check(
    "SessionEnd despawns the session robot and its subagents only",
    endEvents.filter((event) => event.type === "agent.despawned").length === 3 &&
      stage.has("end-other") &&
      stage.has("session-2") &&
      stage.getAgent("session-1")?.phase === "emote",
  );
}

function runParallelSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("36. Parallel subagents");

  const { stage, state } = setupStage();
  const ids = ["par-1", "par-2", "par-3", "par-4"];
  for (const id of ids) {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "SubagentStart",
        agent_id: id,
        agent_type: "code-reviewer",
      }),
      1000,
    );
  }
  const spawned = eventTypes(stage);
  const names = ids.map((id) => stage.getAgent(id)?.profile.name);
  for (const id of ids) {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "SubagentStop",
        agent_id: id,
        agent_type: "code-reviewer",
      }),
      1000,
    );
  }
  const despawned = eventTypes(stage);
  check(
    "four parallel subagents of one type are four robots with four despawns",
    new Set(ids).size === 4 &&
      new Set(names).size === 4 &&
      // Four subagents plus the lazily spawned session robot.
      spawned.filter((type) => type === "agent.spawned").length === 5 &&
      despawned.filter((type) => type === "agent.despawned").length === 4,
  );

  for (let step = 0; step < 30; step += 1) stage.tick(0.2);
  check(
    "finished agents leave the snapshot after their walk home",
    ids.every((id) => !stage.has(id)),
  );
}

function runRedactionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("37. Hook privacy and redaction");

  const bearer = redact("curl -H 'Authorization: Bearer abc.def.ghi'");
  check(
    "Bearer and Authorization values are masked",
    bearer.includes("[redacted]") && !bearer.includes("abc.def.ghi"),
  );

  const secret = redact("OPENAI_API_KEY=sk-live1234567890 password=hunter2");
  const github = redact("export GH=ghp_abcdefghijklmnopqrst");
  const aws = redact("key AKIAABCDEFGHIJKLMNOP");
  check(
    "sk- keys, password= and provider token shapes are masked",
    !secret.includes("sk-live1234567890") &&
      !secret.includes("hunter2") &&
      !github.includes("ghp_abcdefghijklmnopqrst") &&
      !aws.includes("AKIAABCDEFGHIJKLMNOP"),
  );

  const shapes: ReadonlyArray<readonly [string, string]> = [
    ["export GITHUB_TOKEN=abcd1234efgh x", "abcd1234efgh"],
    ["DB_PASSWORD=hunter2 run", "hunter2"],
    ["OPENAI_API_KEY=abc123 run", "abc123"],
    [
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls",
      "wJalrXUtnFEMI",
    ],
    ["mysql --password hunter2", "hunter2"],
    ["curl -u admin:hunter2 x", "hunter2"],
    ["curl --token abcdef x", "abcdef"],
    ["git clone https://user:pass123@github.com/x/y", "pass123"],
  ];
  for (const [input, leaked] of shapes) {
    const masked = redact(input);
    check(
      `redact masks the secret in: ${input.slice(0, 40)}`,
      masked.includes("[redacted]") && !masked.includes(leaked),
    );
  }
  check(
    "a non-secret command is unchanged by redact",
    redact("npm run build -- --watch") === "npm run build -- --watch",
  );
  const adversarial = "a_ ".repeat(240_000);
  const started = Date.now();
  redact(adversarial);
  check(
    "redact stays fast on a 700 KB adversarial input",
    Date.now() - started < 100,
  );

  const backtrackInputs: ReadonlyArray<readonly [string, string]> = [
    ["a 200 KB run of secret keywords", "token".repeat(40_000)],
    ["a 200 KB run of URL credential prefixes", "://a:".repeat(40_000)],
  ];
  for (const [label, input] of backtrackInputs) {
    const begin = Date.now();
    redact(input);
    check(
      `redact finishes in under 100 ms on ${label}`,
      Date.now() - begin < 100,
    );
  }

  const early = `${"x ".repeat(1000)}export GITHUB_TOKEN=abcd1234efgh x`;
  const earlyMasked = redact(early);
  check(
    "a secret inside the first 2048 characters is still masked",
    earlyMasked.includes("[redacted]") &&
      !earlyMasked.includes("abcd1234efgh"),
  );

  const afterSpaces = redact(`${" ".repeat(2040)}ghp_ABCDEFGHIJ`);
  check(
    "a secret after a long whitespace run is not cut into a visible fragment",
    !afterSpaces.includes("ghp_ABCD") && afterSpaces.includes("[redacted]"),
  );

  const command = `npm run ${"x".repeat(200)}`;
  const bash = toolTarget("Bash", { command }, "/repo");
  check(
    "a long Bash command is capped at 60 characters",
    bash.length <= 60 && !bash.includes("\n"),
  );

  const absolute = "/home/me/project/src/auth.ts";
  check(
    "an absolute file path becomes relative to the hook cwd",
    relativePath(absolute, "/home/me/project") === "src/auth.ts" &&
      toolTarget("Read", { file_path: absolute }, "/home/me/project") ===
        "src/auth.ts",
  );

  const summary = summaryFromMessage(`${"Bearer abc "}${"z".repeat(300)}`);
  check(
    "the finish summary is redacted and capped at 120 characters",
    summary !== null &&
      summary.length <= 120 &&
      !summary.includes("Bearer abc"),
  );
}

function runPayloadSuite(reporter: TestReporter): void {
  const { check } = reporter;
  const parsed = parseHookPayload({
    hook_event_name: "SubagentStop",
    session_id: "session-1",
    cwd: "/repo",
    agent_id: "agent-1",
    agent_type: "code-reviewer",
    transcript_path: "/home/me/.claude/session.jsonl",
    last_assistant_message: "private summary",
    tool_response: { stdout: "secret output" },
  });
  check(
    "transcript paths and tool responses never reach the mapping payload",
    parsed.kind === "ok" &&
      !Object.keys(parsed.payload).includes("transcript_path") &&
      !Object.keys(parsed.payload).includes("tool_response"),
  );
}

function runRateSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("38. Hook rate cap");

  let clock = 0;
  const limiter = createHookRateLimiter(
    DEFAULT_HOOK_RATE_PER_SECOND,
    () => clock,
  );
  let accepted = 0;
  for (let index = 0; index < 250; index += 1) {
    if (limiter.allow()) accepted += 1;
  }
  check(
    "the 201st hook in one second is dropped",
    DEFAULT_HOOK_RATE_PER_SECOND === 200 && accepted === 200,
  );

  clock = 999;
  const late = limiter.allow();
  clock = 1000;
  const nextWindow = limiter.allow();
  check("the cap refills on the next wall-clock second", !late && nextWindow);
}

function runReaperSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("39. Orphan reaper");

  const { stage, state } = setupStage();
  applyHook(
    stage,
    state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "orphan-1",
      agent_type: "code-reviewer",
    }),
    0,
  );
  eventTypes(stage);

  const early = reapOrphans(stage, state, ORPHAN_TIMEOUT_MS - 1);
  const before = stage.getAgent("orphan-1");
  check(
    "an agent inside the timeout is left alone",
    early.length === 0 && before?.phase !== "emote",
  );

  const reaped = reapOrphans(stage, state, ORPHAN_TIMEOUT_MS);
  const after = stage.getAgent("orphan-1");
  const idleRobot = stage.getAgent("session-1");
  const events = stage.drainEvents();
  check(
    "an idle session robot is reaped as a quiet success and forgotten",
    reaped.includes("session-1") &&
      idleRobot?.outcome === "success" &&
      idleRobot.state.status === "success" &&
      idleRobot.state.activity === "Session idle" &&
      !state.lastSeen.has("session-1") &&
      !state.agentSession.has("session-1") &&
      !state.sessionAgents.has("session-1"),
  );
  check(
    "a subagent silent for ten minutes despawns with Lost contact",
    reaped.includes("orphan-1") &&
      after?.outcome === "error" &&
      after.state.status === "error" &&
      after.state.activity === "Lost contact" &&
      !state.lastSeen.has("orphan-1"),
  );
  check(
    "the reaper emits an error despawn event",
    events.some(
      (event) =>
        event.type === "agent.despawned" &&
        event.metadata?.outcome === "error",
    ),
  );

  state.lastSeen.set("ghost-agent", 0);
  check(
    "a tracked id that is no longer on the stage is forgotten quietly",
    reapOrphans(stage, state, ORPHAN_TIMEOUT_MS).length === 0 &&
      !state.lastSeen.has("ghost-agent"),
  );
}

function runCapSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("40. Live agent cap");

  const { stage, state } = setupStage();
  for (let index = 0; index < MAX_LIVE_AGENTS + 6; index += 1) {
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "SubagentStart",
        agent_id: `cap-${index}`,
        agent_type: "code-reviewer",
      }),
      1000 + index,
    );
  }
  check(
    "the 64-agent cap drops extras and counts them",
    stage.liveAgents.length === MAX_LIVE_AGENTS &&
      MAX_LIVE_AGENTS === 64 &&
      // The session robot takes one slot, so seven subagents are dropped.
      stage.droppedSpawns === 7,
  );
}

function runBoundsSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("41. Mapping state bounds and ordinals");

  const { stage, state } = setupStage();
  const remember = (subagentType: string, description: string, now: number) =>
    applyHook(
      stage,
      state,
      hook({
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: { description, subagent_type: subagentType },
      }),
      now,
    );
  for (let index = 0; index < 300; index += 1) {
    remember(`${"x".repeat(MAX_DESCRIPTION_KEY_LENGTH + 1)}${index}`, "long", index);
  }
  check(
    "subagent types longer than the key limit are not remembered",
    state.descriptions.size === 0,
  );
  for (let index = 0; index < MAX_DESCRIPTION_KEYS * 3; index += 1) {
    remember(`type-${index}`, "short", index);
  }
  check(
    "the description map keeps at most the key cap, oldest evicted",
    state.descriptions.size === MAX_DESCRIPTION_KEYS &&
      !state.descriptions.has("type-0") &&
      state.descriptions.has(`type-${MAX_DESCRIPTION_KEYS * 3 - 1}`),
  );

  const start = (fixture: StageFixture, id: string, now: number) =>
    applyHook(
      fixture.stage,
      fixture.state,
      hook({
        hook_event_name: "SubagentStart",
        agent_id: id,
        agent_type: "code-reviewer",
      }),
      now,
    );
  const named = setupStage();
  start(named, "ord-a", 1000);
  resetMappingState(named.state);
  named.stage.finish("ord-a", "success");
  start(named, "ord-b", 1001);
  check(
    "ordinals restart at #1 after resetMappingState",
    named.stage.getAgent("ord-b")?.profile.name === "code-reviewer #1",
  );

  const capped = setupStage();
  for (let index = 0; index < MAX_LIVE_AGENTS + 3; index += 1) {
    start(capped, `full-${index}`, 1000 + index);
  }
  check(
    "a spawn dropped at the cap does not consume an ordinal",
    capped.state.ordinals.get("code-reviewer") === MAX_LIVE_AGENTS - 1 &&
      capped.stage.getAgent(`full-${MAX_LIVE_AGENTS - 2}`)?.profile.name ===
        `code-reviewer #${MAX_LIVE_AGENTS - 1}`,
  );

  const fifo = setupStage();
  for (const text of ["one", "two"]) {
    applyHook(
      fifo.stage,
      fifo.state,
      hook({
        hook_event_name: "PreToolUse",
        tool_name: "Task",
        tool_input: { description: text, subagent_type: "code-reviewer" },
      }),
      1000,
    );
  }
  start(fifo, "fifo-1", 1000);
  start(fifo, "fifo-2", 1000);
  check(
    "descriptions for a normal type still match FIFO",
    fifo.stage.getAgent("fifo-1")?.state.activity === "one" &&
      fifo.stage.getAgent("fifo-2")?.state.activity === "two",
  );
}

function toolHook(
  sessionId: string,
  cwd: string,
  file: string,
  extra: Record<string, unknown> = {},
): HookPayload {
  return hook({
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    cwd,
    tool_name: "Read",
    tool_input: { file_path: `${cwd}/${file}` },
    ...extra,
  });
}

function runMultiSessionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("41b. One robot per Claude Code session");

  const { stage, state } = setupStage();
  applyHook(stage, state, toolHook("sess-a", "/work/alpha", "a.ts"), 1000);
  applyHook(stage, state, toolHook("sess-b", "/work/beta", "b.ts"), 1000);
  const a = stage.getAgent("sess-a");
  const b = stage.getAgent("sess-b");
  check(
    "two sessions get two live robots named after their folders",
    a !== null &&
      b !== null &&
      a.profile.name === "alpha #1" &&
      b.profile.name === "beta #1" &&
      a.profile.role === "orchestrator" &&
      a.profile.tagline === "Live Claude Code session" &&
      state.sessionAgents.get("sess-a")?.has("sess-a") === true,
  );
  applyHook(stage, state, toolHook("sess-b", "/work/beta", "c.ts"), 1000);
  check(
    "a tool call in session B does not change session A",
    stage.getAgent("sess-a")?.state.activity === "Tool: a.ts" &&
      stage.getAgent("sess-b")?.state.activity === "Tool: c.ts",
  );
  applyHook(stage, state, toolHook("sess-c", "/work/alpha", "d.ts"), 1000);
  check(
    "same-folder sessions get distinct ordinals",
    stage.getAgent("sess-c")?.profile.name === "alpha #2",
  );

  applyHook(
    stage,
    state,
    toolHook("sess-a", "/work/alpha", "x", {
      hook_event_name: "SubagentStart",
      agent_id: "sub-a",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  applyHook(
    stage,
    state,
    toolHook("sess-b", "/work/beta", "x", {
      hook_event_name: "SubagentStart",
      agent_id: "sub-b",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  const links = stage.snapshot().links;
  check(
    "subagent assign links come from their own session robot, not Orion",
    links.some((l) => l.from === "sess-a" && l.to === "sub-a" && l.kind === "assign") &&
      links.some((l) => l.from === "sess-b" && l.to === "sub-b" && l.kind === "assign") &&
      !links.some((l) => l.from === "orion" && l.kind === "assign"),
  );
  applyHook(
    stage,
    state,
    toolHook("sess-a", "/work/alpha", "x", {
      hook_event_name: "SubagentStop",
      agent_id: "sub-a",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  check(
    "a subagent report links back to its own session robot",
    stage
      .snapshot()
      .links.some((l) => l.from === "sub-a" && l.to === "sess-a" && l.kind === "report"),
  );

  applyHook(stage, state, hook({ hook_event_name: "SessionEnd", session_id: "sess-a", cwd: "/work/alpha" }), 1000);
  check(
    "SessionEnd of A despawns A's robot and not B's robot or subagent",
    stage.getAgent("sess-a")?.phase === "emote" &&
      stage.getAgent("sess-b")?.phase !== "emote" &&
      stage.getAgent("sub-b")?.phase !== "emote",
  );

  const capped = setupStage();
  for (let index = 0; index < MAX_LIVE_AGENTS; index += 1) {
    applyHook(capped.stage, capped.state, toolHook(`fill-${index}`, "/w/f", "f.ts"), 1000);
  }
  applyHook(capped.stage, capped.state, toolHook("overflow", "/w/o", "o.ts"), 1000);
  const orionActivity = capped.stage
    .snapshot()
    .agents.find((agent) => agent.id === "orion");
  check(
    "when the live cap is full a session falls back to Orion",
    !capped.stage.has("overflow") &&
      capped.stage.liveAgents.length === MAX_LIVE_AGENTS &&
      orionActivity?.activity === "Tool: o.ts",
  );

  const alive = setupStage();
  applyHook(alive.stage, alive.state, toolHook("busy", "/w/busy", "a.ts"), 0);
  applyHook(
    alive.stage,
    alive.state,
    toolHook("busy", "/w/busy", "a.ts", {
      hook_event_name: "SubagentStart",
      agent_id: "busy-sub",
      agent_type: "code-reviewer",
    }),
    0,
  );
  const half = ORPHAN_TIMEOUT_MS / 2;
  applyHook(
    alive.stage,
    alive.state,
    toolHook("busy", "/w/busy", "a.ts", {
      agent_id: "busy-sub",
      agent_type: "code-reviewer",
    }),
    half,
  );
  // The session itself was last heard at t=0, the subagent at half.
  const reapedBusy = reapOrphans(alive.stage, alive.state, ORPHAN_TIMEOUT_MS + 1000);
  check(
    "a subagent hook keeps its session robot from being reaped",
    reapedBusy.length === 0 && alive.stage.getAgent("busy")?.phase !== "emote",
  );

  const touches: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["UserPromptSubmit", {}],
    ["Stop", {}],
    ["PostToolUse", { tool_name: "Read" }],
    ["PostToolUseFailure", { tool_name: "Read" }],
  ];
  for (const [event, extra] of touches) {
    const fixture = setupStage();
    applyHook(fixture.stage, fixture.state, toolHook("keep", "/w/keep", "a.ts"), 0);
    applyHook(
      fixture.stage,
      fixture.state,
      hook({
        hook_event_name: event,
        session_id: "keep",
        cwd: "/w/keep",
        ...extra,
      }),
      half,
    );
    const reapedKeep = reapOrphans(fixture.stage, fixture.state, ORPHAN_TIMEOUT_MS + 1000);
    check(
      `${event} keeps an active session robot alive`,
      reapedKeep.length === 0 && fixture.stage.getAgent("keep")?.phase !== "emote",
    );
  }

  const core = setupStage();
  applyHook(
    core.stage,
    core.state,
    hook({
      hook_event_name: "PreToolUse",
      session_id: "orion",
      tool_name: "Read",
      tool_input: { file_path: "/repo/x.ts" },
    }),
    1000,
  );
  check(
    "session_id orion falls back to Orion without spawning",
    core.stage.liveAgents.length === 0 &&
      core.stage.snapshot().agents.find((agent) => agent.id === "orion")
        ?.activity === "Tool: x.ts",
  );

  const clash = setupStage();
  applyHook(
    clash.stage,
    clash.state,
    hook({
      hook_event_name: "SubagentStart",
      agent_id: "clash-id",
      agent_type: "code-reviewer",
    }),
    1000,
  );
  const before = clash.stage.liveAgents.length;
  applyHook(
    clash.stage,
    clash.state,
    hook({ hook_event_name: "PreToolUse", session_id: "clash-id", tool_name: "Read" }),
    1000,
  );
  check(
    "a session_id equal to an unrelated live agent id does not spawn or hijack it",
    clash.stage.liveAgents.length === before &&
      clash.stage.getAgent("clash-id")?.profile.kind === "live" &&
      clash.state.agentSession.get("clash-id") === "session-1",
  );
}

function coreOf(
  stage: LiveStage,
  id: string,
): { status: string; activity: string; location: string | null } {
  const agent = stage.snapshot().agents.find((entry) => entry.id === id);
  return {
    status: agent?.status ?? "missing",
    activity: agent?.activity ?? "missing",
    location: agent?.location ?? null,
  };
}

function startSub(
  fixture: StageFixture,
  agentId: string,
  agentType: string,
  now = 1000,
): void {
  applyHook(
    fixture.stage,
    fixture.state,
    hook({ hook_event_name: "SubagentStart", agent_id: agentId, agent_type: agentType }),
    now,
  );
}

function stopSub(fixture: StageFixture, agentId: string, agentType: string): void {
  applyHook(
    fixture.stage,
    fixture.state,
    hook({ hook_event_name: "SubagentStop", agent_id: agentId, agent_type: agentType }),
    1000,
  );
}

function subTool(fixture: StageFixture, agentId: string, agentType: string): void {
  applyHook(
    fixture.stage,
    fixture.state,
    hook({
      hook_event_name: "PreToolUse",
      agent_id: agentId,
      agent_type: agentType,
      tool_name: "Read",
      tool_input: { file_path: "/repo/src/a.ts" },
    }),
    1000,
  );
}

function runCoreMirrorSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("51. Live activity mirrors onto core agents");

  const one = setupStage();
  startSub(one, "rev-1", "code-reviewer");
  subTool(one, "rev-1", "code-reviewer");
  const rexWorking = coreOf(one.stage, "rex");
  check(
    "a code-reviewer subagent working makes Rex show its activity and status",
    rexWorking.status === "working" &&
      rexWorking.activity === "Tool: src/a.ts" &&
      one.stage.getAgent("rev-1") !== null,
  );
  stopSub(one, "rev-1", "code-reviewer");
  advanceStage(one.stage, 3);
  check(
    "Rex returns to idle when the reviewer stops",
    coreOf(one.stage, "rex").status === "idle" &&
      coreOf(one.stage, "rex").activity === "Rex is idle",
  );

  const two = setupStage();
  startSub(two, "rev-1", "code-reviewer");
  startSub(two, "rev-2", "code-reviewer");
  stopSub(two, "rev-1", "code-reviewer");
  advanceStage(two.stage, 3);
  const midStatus = coreOf(two.stage, "rex").status;
  const stillActive = midStatus === "working" || midStatus === "thinking";
  stopSub(two, "rev-2", "code-reviewer");
  advanceStage(two.stage, 3);
  check(
    "Rex stays active until both reviewers are gone",
    stillActive && coreOf(two.stage, "rex").status === "idle",
  );

  const roles = setupStage();
  applyHook(roles.stage, roles.state, hook({ hook_event_name: "SessionStart" }), 1000);
  startSub(roles, "p-1", "planner");
  startSub(roles, "q-1", "tdd-guide");
  startSub(roles, "k-1", "something-else");
  startSub(roles, "i-1", "explore");
  // Piper and Iris walk to their boards first; let that finish before reading
  // their mirrored status back (orion/quinn/kai have no board and are
  // unaffected by the extra ticks).
  advanceStage(roles.stage, 3);
  const thinking = (id: string): boolean => coreOf(roles.stage, id).status === "thinking";
  check(
    "session mirrors to orion, planner to piper, tdd-guide to quinn, unknown to kai, explore to iris",
    ["orion", "piper", "quinn", "kai", "iris"].every(thinking) &&
      coreOf(roles.stage, "rex").status === "idle" &&
      coreOf(roles.stage, "piper").activity === "Started as planner",
  );

  const reap = setupStage();
  startSub(reap, "rev-1", "code-reviewer", 0);
  reapOrphans(reap.stage, reap.state, ORPHAN_TIMEOUT_MS);
  advanceStage(reap.stage, 3);
  check(
    "reaping a subagent releases its core agent",
    coreOf(reap.stage, "rex").status === "idle" && reap.state.coreOwners.size === 0,
  );

  const end = setupStage();
  applyHook(end.stage, end.state, hook({ hook_event_name: "SessionStart" }), 1000);
  startSub(end, "rev-1", "code-reviewer");
  applyHook(end.stage, end.state, hook({ hook_event_name: "SessionEnd" }), 1000);
  check(
    "SessionEnd releases every mirrored core agent",
    coreOf(end.stage, "rex").status === "idle" &&
      coreOf(end.stage, "orion").status === "idle" &&
      end.state.coreOwners.size === 0 &&
      end.state.agentRole.size === 0,
  );

  const full = setupStage();
  for (let index = 0; index < MAX_LIVE_AGENTS + 2; index += 1) {
    startSub(full, `cap-${index}`, "code-reviewer", 1000 + index);
  }
  const owners = full.state.coreOwners.get("rex");
  check(
    "mirror sets stay within the live cap",
    owners !== undefined && owners.size <= MAX_LIVE_AGENTS,
  );
  applyHook(
    full.stage,
    full.state,
    hook({ hook_event_name: "SessionStart", session_id: "late-session" }),
    2000,
  );
  applyHook(
    full.stage,
    full.state,
    toolHook("late-session", "/repo", "a.ts"),
    2000,
  );
  const pinned = coreOf(full.stage, "orion");
  applyHook(
    full.stage,
    full.state,
    hook({ hook_event_name: "Stop", session_id: "late-session" }),
    2000,
  );
  check(
    "a cap-full session falls back to Orion without registering an owner",
    pinned.status === "working" &&
      !(full.state.coreOwners.get("orion")?.has("late-session") ?? false) &&
      !full.state.agentRole.has("late-session") &&
      // The first session robot still owns Orion, so the fallback Stop keeps it.
      coreOf(full.stage, "orion").status === "working",
  );
  applyHook(
    full.stage,
    full.state,
    hook({ hook_event_name: "SessionEnd", session_id: "session-1" }),
    2000,
  );
  check(
    "Orion is not left pinned once the last owning session robot ends",
    coreOf(full.stage, "orion").status === "idle" &&
      coreOf(full.stage, "orion").activity === "Orion is idle",
  );

  const core = setupStage();
  applyHook(
    core.stage,
    core.state,
    hook({ hook_event_name: "SessionStart", session_id: "orion" }),
    1000,
  );
  check(
    "session_id orion drives Orion directly with no owner entry",
    coreOf(core.stage, "orion").status === "thinking" &&
      !core.state.coreOwners.has("orion") &&
      core.stage.getAgent("orion") === null,
  );
  applyHook(core.stage, core.state, hook({ hook_event_name: "Stop", session_id: "orion" }), 1000);
  check(
    "Stop on the Orion fallback leaves Orion idle with the standard text",
    coreOf(core.stage, "orion").status === "idle" &&
      coreOf(core.stage, "orion").activity === "Orion is idle",
  );
  applyHook(core.stage, core.state, toolHook("orion", "/repo", "a.ts"), 1000);
  applyHook(core.stage, core.state, hook({ hook_event_name: "SessionEnd", session_id: "orion" }), 1000);
  check(
    "SessionEnd on the Orion fallback does not leave Orion pinned",
    coreOf(core.stage, "orion").status === "idle" &&
      coreOf(core.stage, "orion").activity === "Orion is idle",
  );

  const status = setupStage();
  startSub(status, "rev-1", "code-reviewer");
  subTool(status, "rev-1", "code-reviewer");
  applyHook(
    status.stage,
    status.state,
    hook({
      hook_event_name: "PostToolUse",
      agent_id: "rev-1",
      agent_type: "code-reviewer",
      tool_name: "Read",
    }),
    1000,
  );
  check(
    "PostToolUse on a subagent mirrors its status only and keeps the activity",
    coreOf(status.stage, "rex").status === "thinking" &&
      coreOf(status.stage, "rex").activity === "Tool: src/a.ts",
  );

  const failure = setupStage();
  startSub(failure, "rev-1", "code-reviewer");
  applyHook(
    failure.stage,
    failure.state,
    hook({
      hook_event_name: "PostToolUseFailure",
      agent_id: "rev-1",
      agent_type: "code-reviewer",
      tool_name: "Read",
    }),
    1000,
  );
  advanceStage(failure.stage, 3);
  check(
    "PostToolUseFailure on a subagent mirrors onto the core agent",
    coreOf(failure.stage, "rex").status === "working" &&
      coreOf(failure.stage, "rex").activity === "Tool failed: Read",
  );

  const stop = setupStage();
  applyHook(stop.stage, stop.state, hook({ hook_event_name: "SessionStart" }), 1000);
  applyHook(stop.stage, stop.state, toolHook("session-1", "/repo", "a.ts"), 1000);
  const busy = coreOf(stop.stage, "orion").status === "working";
  applyHook(stop.stage, stop.state, hook({ hook_event_name: "Stop" }), 1000);
  check(
    "Stop on a session robot mirrors idle onto Orion",
    busy &&
      coreOf(stop.stage, "orion").status === "idle" &&
      coreOf(stop.stage, "orion").activity === "Idle",
  );

  const leaving = setupStage();
  applyHook(leaving.stage, leaving.state, hook({ hook_event_name: "SessionStart" }), 1000);
  applyHook(leaving.stage, leaving.state, toolHook("orion", "/repo", "b.ts"), 1000);
  const fallbackDrives = coreOf(leaving.stage, "orion").activity === "Tool: b.ts";
  applyHook(leaving.stage, leaving.state, hook({ hook_event_name: "SessionEnd" }), 1000);
  check(
    "a session robot leaving while a fallback session drives Orion idles Orion (last writer wins)",
    fallbackDrives && coreOf(leaving.stage, "orion").status === "idle",
  );

  const guard = setupStage();
  applyHook(guard.stage, guard.state, hook({ hook_event_name: "SessionStart" }), 0);
  applyHook(
    guard.stage,
    guard.state,
    hook({ hook_event_name: "SessionStart", session_id: "session-b" }),
    ORPHAN_TIMEOUT_MS,
  );
  applyHook(
    guard.stage,
    guard.state,
    toolHook("session-b", "/repo", "a.ts"),
    ORPHAN_TIMEOUT_MS,
  );
  reapOrphans(guard.stage, guard.state, ORPHAN_TIMEOUT_MS);
  applyHook(guard.stage, guard.state, hook({ hook_event_name: "SessionEnd" }), ORPHAN_TIMEOUT_MS);
  check(
    "a late SessionEnd of a reaped session leaves Orion active for another session",
    coreOf(guard.stage, "orion").status === "working",
  );
  applyHook(guard.stage, guard.state, hook({ hook_event_name: "Stop", session_id: "orion" }), ORPHAN_TIMEOUT_MS);
  check(
    "Stop on the Orion fallback leaves Orion active while a session robot owns it",
    coreOf(guard.stage, "orion").status === "working",
  );

  const coreId = setupStage();
  startSub(coreId, "rex", "code-reviewer");
  startSub(coreId, "rev-1", "code-reviewer");
  subTool(coreId, "rev-1", "code-reviewer");
  check(
    "a subagent whose agent_id is a core id does not spawn, and Rex mirroring still works",
    coreId.stage.getAgent("rex") === null &&
      !coreId.state.agentSession.has("rex") &&
      coreOf(coreId.stage, "rex").status === "working",
  );

  const reset = setupStage();
  startSub(reset, "rev-1", "code-reviewer");
  resetMappingState(reset.state);
  check(
    "reset clears the mirror state",
    reset.state.coreOwners.size === 0 && reset.state.agentRole.size === 0,
  );
}

function runBoardWalkSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("51b. Live mode walks Piper/Iris to their boards");

  const planning = setupStage();
  startSub(planning, "p-1", "planner");
  advanceStage(planning.stage, 3);
  check(
    "a plan subagent walks Piper to the Sprint Planning board",
    coreOf(planning.stage, "piper").location === "planning",
  );
  stopSub(planning, "p-1", "planner");
  advanceStage(planning.stage, 3);
  check(
    "Piper walks back to the Product Station once the planner stops",
    coreOf(planning.stage, "piper").location === "product",
  );

  const research = setupStage();
  startSub(research, "i-1", "explore");
  advanceStage(research.stage, 3);
  check(
    "an explore subagent walks Iris to the Research Board",
    coreOf(research.stage, "iris").location === "researchBoard",
  );
  stopSub(research, "i-1", "explore");
  advanceStage(research.stage, 3);
  check(
    "Iris walks back to the Research Station once the explorer stops",
    coreOf(research.stage, "iris").location === "research",
  );

  const concurrent = setupStage();
  startSub(concurrent, "p-1", "planner");
  startSub(concurrent, "p-2", "architect");
  advanceStage(concurrent.stage, 3);
  stopSub(concurrent, "p-1", "planner");
  advanceStage(concurrent.stage, 3);
  check(
    "Piper stays at the board while a second planner subagent is still running",
    coreOf(concurrent.stage, "piper").location === "planning",
  );
  stopSub(concurrent, "p-2", "architect");
  advanceStage(concurrent.stage, 3);
  check(
    "Piper walks home once every planner subagent has stopped",
    coreOf(concurrent.stage, "piper").location === "product",
  );

  const untouched = setupStage();
  startSub(untouched, "p-1", "planner");
  startSub(untouched, "i-1", "explore");
  startSub(untouched, "k-1", "something-else");
  startSub(untouched, "q-1", "tdd-guide");
  startSub(untouched, "r-1", "code-reviewer");
  advanceStage(untouched.stage, 3);
  check(
    "Orion, Kai, Quinn and Rex never leave their home station",
    coreOf(untouched.stage, "orion").location === "hub" &&
      coreOf(untouched.stage, "kai").location === "dev" &&
      coreOf(untouched.stage, "quinn").location === "testing" &&
      coreOf(untouched.stage, "rex").location === "review",
  );
}

/** Advance the stage clock by `seconds`, in ticks the stage accepts. */
function advanceStage(stage: LiveStage, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) stage.tick(0.1);
}

function failTool(fixture: StageFixture, agentId: string, agentType: string): void {
  applyHook(
    fixture.stage,
    fixture.state,
    hook({
      hook_event_name: "PostToolUseFailure",
      agent_id: agentId,
      agent_type: agentType,
      tool_name: "Read",
    }),
    1000,
  );
}

function runCoreFlashSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("52. Transient outcome flashes on core agents");

  const ok = setupStage();
  startSub(ok, "rev-1", "code-reviewer");
  subTool(ok, "rev-1", "code-reviewer");
  stopSub(ok, "rev-1", "code-reviewer");
  check(
    "SubagentStop success flashes Rex as success right after, over the idle write",
    coreOf(ok.stage, "rex").status === "success" &&
      coreOf(ok.stage, "rex").activity === "Rex: done",
  );
  advanceStage(ok.stage, 1);
  check(
    "the success flash is still shown before its duration passes",
    coreOf(ok.stage, "rex").status === "success",
  );
  advanceStage(ok.stage, 2);
  check(
    "Rex shows the persistent idle state after the flash expires",
    coreOf(ok.stage, "rex").status === "idle" &&
      coreOf(ok.stage, "rex").activity === "Rex is idle",
  );

  const shared = setupStage();
  startSub(shared, "rev-1", "code-reviewer");
  startSub(shared, "rev-2", "code-reviewer");
  subTool(shared, "rev-2", "code-reviewer");
  stopSub(shared, "rev-1", "code-reviewer");
  const flashing = coreOf(shared.stage, "rex").status === "success";
  advanceStage(shared.stage, 3);
  check(
    "with another owner left, the flash plays then the persistent working state shows",
    flashing && coreOf(shared.stage, "rex").status === "working",
  );

  const lost = setupStage();
  startSub(lost, "rev-1", "code-reviewer", 0);
  reapOrphans(lost.stage, lost.state, ORPHAN_TIMEOUT_MS);
  check(
    "a reaped Lost contact subagent flashes Rex as an error",
    coreOf(lost.stage, "rex").status === "error" &&
      coreOf(lost.stage, "rex").activity === "Lost contact",
  );
  advanceStage(lost.stage, 3);
  check(
    "Rex returns to idle after the error flash",
    coreOf(lost.stage, "rex").status === "idle",
  );

  const failed = setupStage();
  startSub(failed, "rev-1", "code-reviewer");
  subTool(failed, "rev-1", "code-reviewer");
  failTool(failed, "rev-1", "code-reviewer");
  check(
    "PostToolUseFailure flashes the mirrored core agent as an error",
    coreOf(failed.stage, "rex").status === "error" &&
      coreOf(failed.stage, "rex").activity === "Tool failed",
  );
  advanceStage(failed.stage, 1);
  check(
    "the tool failure flash is still shown before 1.5 seconds",
    coreOf(failed.stage, "rex").status === "error",
  );
  advanceStage(failed.stage, 1);
  check(
    "after the tool failure flash Rex shows the persistent working state",
    coreOf(failed.stage, "rex").status === "working" &&
      coreOf(failed.stage, "rex").activity === "Tool failed: Read",
  );

  const mainFail = setupStage();
  applyHook(mainFail.stage, mainFail.state, hook({ hook_event_name: "SessionStart" }), 1000);
  applyHook(
    mainFail.stage,
    mainFail.state,
    hook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash" }),
    1000,
  );
  check(
    "PostToolUseFailure on the main conversation flashes Orion as an error",
    coreOf(mainFail.stage, "orion").status === "error",
  );

  const orionFail = setupStage();
  applyHook(
    orionFail.stage,
    orionFail.state,
    hook({ hook_event_name: "SessionStart", session_id: "orion" }),
    1000,
  );
  applyHook(
    orionFail.stage,
    orionFail.state,
    hook({ hook_event_name: "PostToolUseFailure", session_id: "orion", tool_name: "Bash" }),
    1000,
  );
  const orionFlash = coreOf(orionFail.stage, "orion").status === "error";
  advanceStage(orionFail.stage, 3);
  check(
    "PostToolUseFailure with Orion as the fallback driver flashes Orion, then shows its persistent state",
    orionFlash && coreOf(orionFail.stage, "orion").status === "thinking",
  );

  const rawCore = setupStage();
  applyHook(rawCore.stage, rawCore.state, hook({ hook_event_name: "SessionStart" }), 1000);
  failTool(rawCore, "rex", "code-reviewer");
  const rexAtOnce = coreOf(rawCore.stage, "rex").status;
  advanceStage(rawCore.stage, 3);
  check(
    "PostToolUseFailure with a core agent_id and no live robot never flashes Rex",
    rexAtOnce === "idle" && coreOf(rawCore.stage, "rex").status === "idle",
  );

  const idle = setupStage();
  applyHook(idle.stage, idle.state, hook({ hook_event_name: "SessionStart" }), 0);
  reapOrphans(idle.stage, idle.state, ORPHAN_TIMEOUT_MS);
  check(
    "reaping an idle session robot does not flash Orion as an error",
    coreOf(idle.stage, "orion").status !== "error",
  );

  const nonCore = setupStage();
  nonCore.stage.flashCore("not-a-core", "error", "x", 1000);
  nonCore.stage.flashCore("rex", "error", "x", 0);
  check(
    "flashing a non-core id or a zero duration is ignored",
    nonCore.stage.snapshot().agents.every((agent) => agent.status === "idle"),
  );

  const replace = setupStage();
  replace.stage.flashCore("rex", "error", "first", 1000);
  replace.stage.flashCore("rex", "success", "second", 3000);
  advanceStage(replace.stage, 2);
  check(
    "a new flash on the same core agent replaces the old one",
    coreOf(replace.stage, "rex").status === "success" &&
      coreOf(replace.stage, "rex").activity === "second",
  );
  replace.stage.reset();
  replace.stage.setStatus("running");
  replace.stage.flashCore("rex", "error", "x", 1000);
  replace.stage.reset();
  check(
    "reset clears flashes",
    coreOf(replace.stage, "rex").status === "idle",
  );
}

export function runBridgeMappingSuites(reporter: TestReporter): void {
  runRoleSuite(reporter);
  runSessionSuite(reporter);
  runDescriptionSuite(reporter);
  runSubagentToolSuite(reporter);
  runStopSuite(reporter);
  runSessionEndSuite(reporter);
  runParallelSuite(reporter);
  runRedactionSuite(reporter);
  runPayloadSuite(reporter);
  runRateSuite(reporter);
  runReaperSuite(reporter);
  runCapSuite(reporter);
  runBoundsSuite(reporter);
  runMultiSessionSuite(reporter);
  runCoreMirrorSuite(reporter);
  runBoardWalkSuite(reporter);
  runCoreFlashSuite(reporter);
}
