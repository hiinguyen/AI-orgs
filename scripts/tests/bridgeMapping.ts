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
  const orion = stage.snapshot().agents.find((agent) => agent.id === "orion");
  check(
    "SessionStart makes Orion think and emits system.started once",
    started.filter((type) => type === "system.started").length === 1 &&
      orion?.status === "thinking",
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
    .agents.find((agent) => agent.id === "orion");
  check(
    "a main-conversation tool call puts Orion to work on the relative path",
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
      (link) => link.from === "agent-stop" && link.to === "orion",
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
    hook({ hook_event_name: "Stop" }),
    1000,
  );
  const idle = internal.stage
    .snapshot()
    .agents.find((agent) => agent.id === "orion");
  check("Stop returns Orion to idle", idle?.status === "idle");
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
    "SessionEnd despawns every agent of that session and leaves Orion idle",
    endEvents.filter((event) => event.type === "agent.despawned").length === 2 &&
      stage.has("end-other") &&
      stage
        .snapshot()
        .agents.find((agent) => agent.id === "orion")?.status === "idle",
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
      spawned.filter((type) => type === "agent.spawned").length === 4 &&
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
  const events = stage.drainEvents();
  check(
    "an agent silent for ten minutes despawns with Lost contact",
    reaped.length === 1 &&
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
      stage.droppedSpawns === 6,
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
    capped.state.ordinals.get("code-reviewer") === MAX_LIVE_AGENTS &&
      capped.stage.getAgent(`full-${MAX_LIVE_AGENTS - 1}`)?.profile.name ===
        `code-reviewer #${MAX_LIVE_AGENTS}`,
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
}
