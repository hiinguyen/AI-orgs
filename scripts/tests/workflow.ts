/**
 * Workflow checks: the pure state machine, and the engine's pause, blocked
 * owner and reset lifecycle. Section 9 checks 1 and 4.
 */
import { AGENTS, agentName } from "../../src/agents/AgentRegistry.ts";
import type { AgentId } from "../../src/agents/agentTypes.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import { slotFor } from "../../src/simulation/worldLayout.ts";
import {
  applySignal,
  canTransition,
  isTerminal,
} from "../../src/simulation/WorkflowStateMachine.ts";
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import { PHASE_STATUS, isTerminalPhase } from "../../src/tasks/taskTypes.ts";
import type { Task, WorkflowPhase } from "../../src/tasks/taskTypes.ts";
import {
  backlogTask,
  deterministicInput,
  harness,
  taskById,
  tickUntil,
} from "./harness.ts";
import type { TestReporter } from "./harness.ts";

const PAUSED_OWNER_CASES: readonly {
  owner: AgentId;
  phase: WorkflowPhase;
  previous: WorkflowPhase;
}[] = [
  { owner: "piper", phase: "planning", previous: "intake" },
  { owner: "iris", phase: "research", previous: "planning" },
  { owner: "kai", phase: "implementation", previous: "research" },
  { owner: "quinn", phase: "testing", previous: "implementation" },
  { owner: "rex", phase: "review", previous: "testing" },
];

function seedTask(): Task {
  return {
    id: "T-999",
    title: "State machine probe",
    description: "",
    priority: "medium",
    status: "queued",
    phase: "queued",
    assignedAgentId: null,
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    iteration: 0,
    subtasks: [],
    findings: [],
    history: [],
    isDemo: false,
    preferredAgentId: null,
    blockedReason: null,
  };
}

export function runStateMachineSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("1. State machine");
  check(
    "testing --tests_failed--> implementation is allowed",
    canTransition("testing", "tests_failed"),
  );
  check(
    "queued --approved--> is rejected",
    !canTransition("queued", "approved"),
  );
  check("done is terminal", isTerminal("done"));
  check("failed is terminal", isTerminal("failed"));

  const started = applySignal(seedTask(), "picked_up", 1);
  check(
    "picked_up moves queued to intake and projects status",
    started.phase === "intake" &&
      started.status === "assigned" &&
      started.history.length === 1,
  );
  const inTesting = {
    ...started,
    phase: "testing" as const,
    iteration: 1,
    progress: 0.72,
  };
  const reworked = applySignal(inTesting, "tests_failed", 2);
  check(
    "rework re-enters implementation, bumps iteration, resets progress",
    reworked.phase === "implementation" &&
      reworked.iteration === 2 &&
      reworked.progress === 0.36,
    `${reworked.phase} i${reworked.iteration} p${reworked.progress}`,
  );
}

function resetScenario(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine } = harness();
  engine.start();
  const created = engine.submitTask(
    deterministicInput("Stripe checkout retry handling", "high"),
  );

  const walking = tickUntil(
    engine,
    () => engine.snapshot().agents.some((agent) => agent.status === "walking"),
    20,
  );
  check("an agent is walking before the pause", walking);
  engine.pause();
  const beforePause = engine.snapshot();
  engine.tick(1);
  engine.tick(1);
  const afterPause = engine.snapshot();
  check(
    "a paused simulation does not advance its clock",
    afterPause.clock === beforePause.clock,
    `${beforePause.clock} vs ${afterPause.clock}`,
  );
  check(
    "a paused simulation does not move agents",
    afterPause.agents.every(
      (agent, index) =>
        agent.position.x === beforePause.agents[index].position.x &&
        agent.position.z === beforePause.agents[index].position.z,
    ),
  );

  engine.resume();
  for (let index = 0; index < 30; index += 1) engine.tick(TICK_SECONDS);
  const afterResume = engine.snapshot();
  check(
    "a resumed simulation advances again",
    afterResume.clock > afterPause.clock,
  );

  const ownerReady = tickUntil(
    engine,
    () => {
      const task = engine.getTask(created.id);
      return task !== null && task.assignedAgentId !== null;
    },
    20,
  );
  const owned = taskById(engine, created.id);
  check(
    "the orchestrator assigns an owner",
    ownerReady && owned.assignedAgentId !== null,
  );

  if (owned.assignedAgentId) {
    engine.pauseAgent(owned.assignedAgentId);
    const blocked = taskById(engine, created.id);
    check(
      "pausing the owner blocks the task",
      blocked.status === "blocked" &&
        (blocked.blockedReason ?? "").includes("paused"),
      blocked.blockedReason ?? "",
    );
    engine.resumeAgent(owned.assignedAgentId);
    const resumed = taskById(engine, created.id);
    check(
      "resuming the owner restores the phase projection",
      resumed.status === PHASE_STATUS[resumed.phase] &&
        resumed.blockedReason === null,
      `${resumed.status} vs ${PHASE_STATUS[resumed.phase]}`,
    );
  }

  const completed = tickUntil(
    engine,
    () => {
      const task = engine.getTask(created.id);
      return task !== null && isTerminalPhase(task.phase);
    },
    300,
  );
  check("the task completes after resuming", completed);

  const randomInput = backlogTask(
    "Notification digest with per-user preferences",
  );
  const randomTask = engine.submitTask(randomInput);
  const randomDone = tickUntil(
    engine,
    () => {
      const task = engine.getTask(randomTask.id);
      return task !== null && isTerminalPhase(task.phase);
    },
    400,
  );
  check("a task with random outcomes terminates", randomDone);

  engine.reset();
  const reset = engine.snapshot();
  check("reset clears tasks", reset.tasks.length === 0);
  check("reset returns to ready", reset.status === "ready");
  check("reset zeroes the clock", reset.clock === 0);
  check(
    "reset puts every agent idle at its home slot",
    reset.agents.every((agent) => {
      const profile = AGENTS.find((entry) => entry.id === agent.id);
      if (!profile) return false;
      const slot = slotFor(profile.home, profile.seat);
      return (
        agent.status === "idle" &&
        agent.location === profile.home &&
        Math.abs(agent.position.x - slot.x) < 1e-6 &&
        Math.abs(agent.position.z - slot.z) < 1e-6
      );
    }),
  );
}

function pausedOwnerCases(reporter: TestReporter): void {
  const { check } = reporter;
  for (const entry of PAUSED_OWNER_CASES) {
    const { engine, events } = harness();
    engine.start();
    const created = engine.submitTask(DEMO_TASK);
    const owner = agentName(entry.owner);
    const reachedPrevious = tickUntil(
      engine,
      () => taskById(engine, created.id).phase === entry.previous,
      120,
    );
    engine.pauseAgent(entry.owner);
    const marker = events.length;

    const entered = tickUntil(
      engine,
      () => taskById(engine, created.id).phase === entry.phase,
      120,
    );
    const blocked = taskById(engine, created.id);
    check(
      `paused ${owner}: entering ${entry.phase} is blocked`,
      reachedPrevious &&
        entered &&
        blocked.status === "blocked" &&
        blocked.blockedReason === `${owner} is paused`,
      `${blocked.status} - ${blocked.blockedReason ?? "no reason"}`,
    );
    check(
      `paused ${owner}: task.blocked fires on phase entry`,
      events.slice(marker).some(
        (event) =>
          event.type === "task.blocked" &&
          event.taskId === created.id &&
          event.metadata?.reason === `${owner} is paused`,
      ),
    );

    engine.resumeAgent(entry.owner);
    const resumed = taskById(engine, created.id);
    check(
      `paused ${owner}: resuming restores the ${entry.phase} projection`,
      resumed.status === PHASE_STATUS[resumed.phase] &&
        resumed.blockedReason === null &&
        events
          .slice(marker)
          .some(
            (event) =>
              event.type === "task.unblocked" && event.taskId === created.id,
          ),
      `${resumed.status} vs ${PHASE_STATUS[resumed.phase]}`,
    );

    const finished = tickUntil(
      engine,
      () => isTerminalPhase(taskById(engine, created.id).phase),
      250,
    );
    const final = taskById(engine, created.id);
    check(
      `paused ${owner}: the task still completes`,
      finished && final.phase === "done" && final.iteration === 2,
      `${final.phase} i${final.iteration}`,
    );
  }
}

function midFlightReset(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine } = harness();
  engine.emitBootEvents();
  engine.start();
  engine.setSpeed(2);
  engine.submitTask(
    deterministicInput("Add rate limiting to public endpoints", "high"),
  );
  engine.submitTask(
    deterministicInput("Build a weekly uptime dashboard", "medium"),
  );
  const twoInFlight = tickUntil(
    engine,
    () =>
      engine
        .snapshot()
        .tasks.filter(
          (task) => task.phase !== "queued" && !isTerminalPhase(task.phase),
        ).length === 2,
    40,
  );
  engine.pauseAgent("quinn");
  check(
    "reset scenario has two tasks in flight and a paused agent",
    twoInFlight &&
      engine.snapshot().agents.find((agent) => agent.id === "quinn")
        ?.paused === true,
  );

  engine.reset();
  const reset = engine.snapshot();
  check("mid-flight reset clears every task", reset.tasks.length === 0);
  check(
    "mid-flight reset returns to ready at clock 0",
    reset.status === "ready" && reset.clock === 0,
    `${reset.status} at ${reset.clock}`,
  );
  check(
    "mid-flight reset puts every agent idle, unpaused and at its home slot",
    reset.agents.every((agent) => {
      const profile = AGENTS.find((entry) => entry.id === agent.id);
      if (!profile) return false;
      const slot = slotFor(profile.home, profile.seat);
      return (
        agent.status === "idle" &&
        !agent.paused &&
        agent.location === profile.home &&
        Math.abs(agent.position.x - slot.x) < 1e-6 &&
        Math.abs(agent.position.z - slot.z) < 1e-6
      );
    }),
  );
  check(
    "reset keeps the user's current speed",
    reset.speed === 2,
    `${reset.speed}`,
  );

  engine.start();
  const next = engine.submitTask(
    deterministicInput("Add audit logging to admin actions", "high"),
  );
  check("a post-reset task gets id T-001", next.id === "T-001", next.id);
  const nextDone = tickUntil(
    engine,
    () => {
      const task = engine.getTask(next.id);
      return task !== null && isTerminalPhase(task.phase);
    },
    300,
  );
  check("a post-reset task still completes", nextDone);
}

function resetEventIds(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine, events } = harness();
  engine.emitBootEvents();
  engine.start();
  engine.submitTask(deterministicInput("Reset event id probe", "medium"));
  for (let index = 0; index < 120; index += 1) engine.tick(TICK_SECONDS);
  engine.reset();
  const afterReset = events.length;
  engine.emitBootEvents();
  engine.start();
  engine.submitTask(deterministicInput("Reset event id probe", "medium"));
  for (let index = 0; index < 120; index += 1) engine.tick(TICK_SECONDS);
  const resetIds = events.slice(afterReset).map((event) => event.id);

  const { engine: fresh, events: freshEvents } = harness();
  fresh.emitBootEvents();
  fresh.start();
  fresh.submitTask(deterministicInput("Reset event id probe", "medium"));
  for (let index = 0; index < 120; index += 1) fresh.tick(TICK_SECONDS);
  const freshIds = freshEvents.map((event) => event.id);
  const idsMatch =
    resetIds.length === freshIds.length &&
    resetIds.every((id, index) => id === freshIds[index]);
  check(
    "reset restarts event ids like a fresh engine",
    idsMatch,
    idsMatch
      ? undefined
      : `${resetIds[0] ?? "none"} vs ${freshIds[0] ?? "none"} (${resetIds.length} vs ${freshIds.length})`,
  );

  const { engine: repeated, events: repeatedEvents } = harness();
  repeated.reset();
  repeated.reset();
  repeated.start();
  const repeatedIds = repeatedEvents.map((event) => event.id);
  check(
    "event ids stay unique across back-to-back resets",
    new Set(repeatedIds).size === repeatedIds.length,
    repeatedIds.join(", "),
  );
}

export function runLifecycleSuite(reporter: TestReporter): void {
  reporter.group("4. Pause, resume, blocked agents, reset");
  resetScenario(reporter);
  pausedOwnerCases(reporter);
  midFlightReset(reporter);
  resetEventIds(reporter);
}
