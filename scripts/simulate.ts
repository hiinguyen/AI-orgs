/**
 * Headless engine checks, run with:
 *   node --experimental-strip-types --no-warnings scripts/simulate.ts
 *
 * Six groups, matching section 9 of the spec, plus store mirror and WebSocket
 * boundary checks. Prints a check or cross per assertion and exits 1 if
 * anything fails.
 */
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";
import { TICK_SECONDS } from "../src/simulation/simulationConfig.ts";
import { applySignal, canTransition, isTerminal } from "../src/simulation/WorkflowStateMachine.ts";
import { GENERIC_TEMPLATE, matchWorkTemplate } from "../src/simulation/workContent.ts";
import { AGENTS, agentName } from "../src/agents/AgentRegistry.ts";
import { slotFor } from "../src/simulation/worldLayout.ts";
import { DEMO_TASK } from "../src/tasks/taskActions.ts";
import { SPRINT_TASKS, TASK_BACKLOG } from "../src/tasks/taskBacklog.ts";
import { PHASE_STATUS, isTerminalPhase } from "../src/tasks/taskTypes.ts";
import type { WorkflowPhase } from "../src/tasks/taskTypes.ts";
import type { AgentId } from "../src/agents/agentTypes.ts";
import type { AgentEvent } from "../src/events/eventTypes.ts";
import type { CreateTaskInput, Task } from "../src/tasks/taskTypes.ts";
import type { WorldSnapshot } from "../src/integrations/AgentBackend.ts";
import {
  MIRROR_INTERVAL_MS,
  ThrottledMirror,
} from "../src/state/mirrorThrottle.ts";
import {
  WebSocketAgentBackend,
  parseAgentEvent,
  parseWorldSnapshot,
} from "../src/integrations/WebSocketAgentBackend.ts";

let checks = 0;
let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.log(`  \u2717 ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function group(title: string): void {
  console.log(`\n${title}`);
}

interface Harness {
  engine: SimulationEngine;
  events: AgentEvent[];
}

function harness(): Harness {
  const engine = new SimulationEngine();
  const events: AgentEvent[] = [];
  engine.events.subscribe((event) => {
    events.push(event);
  });
  return { engine, events };
}

function tickUntil(
  engine: SimulationEngine,
  predicate: () => boolean,
  maxSimSeconds: number,
): boolean {
  const start = engine.snapshot().clock;
  while (!predicate()) {
    if (engine.snapshot().clock - start > maxSimSeconds) return false;
    engine.tick(TICK_SECONDS);
  }
  return true;
}

function taskById(engine: SimulationEngine, id: string): Task {
  const task = engine.getTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

function backlogTask(title: string): CreateTaskInput {
  const found = TASK_BACKLOG.find((task) => task.title === title);
  if (!found) throw new Error(`Backlog title not found: ${title}`);
  return found;
}

function deterministicInput(
  title: string,
  priority: CreateTaskInput["priority"] = "medium",
): CreateTaskInput {
  return {
    title,
    description: "A predictable task for the engine checks.",
    priority,
    script: { qaFailsOn: [], reviewChangesOn: [] },
  };
}

/** Everything deterministic in an event, excluding the wall-clock timestamp. */
function eventSignature(event: AgentEvent): string {
  return [
    event.id,
    event.type,
    event.simTime,
    event.message,
    event.agentId ?? "",
    event.targetAgentId ?? "",
    event.taskId ?? "",
  ].join("|");
}

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

const DEMO_PHASES = [
  "queued",
  "intake",
  "planning",
  "research",
  "implementation",
  "testing",
  "implementation",
  "testing",
  "review",
  "done",
];

const DEMO_EVENTS = [
  "task.created",
  "task.assigned",
  "plan.created",
  "research.completed",
  "implementation.started",
  "implementation.submitted",
  "qa.failed",
  "qa.passed",
  "review.approved",
  "task.completed",
];

interface DemoRun {
  task: Task;
  clock: number;
  events: AgentEvent[];
}

function runDemo(): DemoRun {
  const { engine, events } = harness();
  engine.emitBootEvents();
  engine.start();
  const created = engine.submitTask(DEMO_TASK);

  const finished = tickUntil(
    engine,
    () => {
      const task = engine.getTask(created.id);
      return task !== null && isTerminalPhase(task.phase);
    },
    200,
  );
  const task = taskById(engine, created.id);
  if (!finished) {
    throw new Error(`Demo did not finish, stuck in ${task.phase}`);
  }

  const shipped = tickUntil(
    engine,
    () =>
      events.some(
        (event) =>
          event.type === "task.completed" && event.taskId === created.id,
      ),
    30,
  );
  if (!shipped) {
    throw new Error("Demo reached done without a task.completed event");
  }

  const clock = engine.snapshot().clock;
  return { task: taskById(engine, created.id), clock, events };
}

async function main(): Promise<void> {
  console.log("AI Agent World - headless simulation checks");

  // ---------------------------------------------------------------- group 1
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

  const seedTask: Task = {
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
  const started = applySignal(seedTask, "picked_up", 1);
  check(
    "picked_up moves queued to intake and projects status",
    started.phase === "intake" && started.status === "assigned" && started.history.length === 1,
  );
  const inTesting = { ...started, phase: "testing" as const, iteration: 1, progress: 0.72 };
  const reworked = applySignal(inTesting, "tests_failed", 2);
  check(
    "rework re-enters implementation, bumps iteration, resets progress",
    reworked.phase === "implementation" &&
      reworked.iteration === 2 &&
      reworked.progress === 0.36,
    `${reworked.phase} i${reworked.iteration} p${reworked.progress}`,
  );

  // ---------------------------------------------------------------- group 2
  group("2. Demo workflow");
  const demo = runDemo();
  check(
    "boot events include system.ready and one line per agent",
    demo.events.length >= 7 && demo.events[0].type === "system.ready",
    `${demo.events.length} events`,
  );
  check(
    "demo ends done/completed",
    demo.task.phase === "done" && demo.task.status === "completed",
  );
  check("demo iteration is 2", demo.task.iteration === 2, `iteration ${demo.task.iteration}`);
  check("demo progress is exactly 1", demo.task.progress === 1, `progress ${demo.task.progress}`);
  check(
    "all subtasks are done",
    demo.task.subtasks.length === 6 && demo.task.subtasks.every((subtask) => subtask.done),
    `${demo.task.subtasks.filter((subtask) => subtask.done).length}/${demo.task.subtasks.length}`,
  );
  check(
    "findings are published",
    demo.task.findings.length === 3 && demo.task.findings[0].includes("Short-lived access tokens"),
  );

  const demoTypes = new Set(demo.events.map((event) => event.type));
  for (const type of DEMO_EVENTS) {
    check(`event ${type}`, demoTypes.has(type as AgentEvent["type"]));
  }

  const demoCommunications = demo.events.filter(
    (event) =>
      event.targetAgentId !== undefined &&
      (event.type === "agent.message" || event.type === "task.assigned"),
  );
  check(
    "at least 7 agent-to-agent communications",
    demoCommunications.length >= 7,
    `${demoCommunications.length} found`,
  );

  const demoPhases = ["queued", ...demo.task.history.map((entry) => entry.to)];
  check(
    "phase order matches the demo choreography",
    demoPhases.join(" > ") === DEMO_PHASES.join(" > "),
    demoPhases.join(" > "),
  );
  check(
    "demo completes in under 100 sim seconds",
    demo.clock < 100,
    `${demo.clock.toFixed(2)}s`,
  );

  // ---------------------------------------------------------------- group 3
  group("3. Determinism");
  const repeat = runDemo();
  check(
    "a fresh engine finishes the demo within 0.05 sim seconds",
    Math.abs(repeat.clock - demo.clock) <= 0.05,
    `${demo.clock.toFixed(3)} vs ${repeat.clock.toFixed(3)}`,
  );
  check(
    "a fresh engine produces the same phase order",
    repeat.task.history.map((entry) => entry.to).join(">") ===
      demo.task.history.map((entry) => entry.to).join(">"),
  );

  const demoSignatures = demo.events.map(eventSignature);
  const repeatSignatures = repeat.events.map(eventSignature);
  const firstDifferent = demoSignatures.findIndex(
    (signature, index) => signature !== repeatSignatures[index],
  );
  const streamsMatch =
    demoSignatures.length === repeatSignatures.length &&
    firstDifferent === -1;
  check(
    "two fresh runs emit the same event stream",
    streamsMatch,
    firstDifferent === -1
      ? `${demoSignatures.length} vs ${repeatSignatures.length} events`
      : `event ${firstDifferent + 1}: ${demoSignatures[firstDifferent]} vs ${repeatSignatures[firstDifferent]}`,
  );

  // ---------------------------------------------------------------- group 4
  group("4. Pause, resume, blocked agents, reset");
  {
    const { engine } = harness();
    engine.start();
    const created = engine.submitTask(
      deterministicInput("Stripe checkout retry handling", "high"),
    );

    const walking = tickUntil(
      engine,
      () =>
        engine.snapshot().agents.some((agent) => agent.status === "walking"),
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
    check("the orchestrator assigns an owner", ownerReady && owned.assignedAgentId !== null);

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

    const randomInput = backlogTask("Notification digest with per-user preferences");
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

  {
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
            (task) =>
              task.phase !== "queued" && !isTerminalPhase(task.phase),
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

  {
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
  }

  // ---------------------------------------------------------------- group 5
  group("5. Concurrency and priority");
  {
    const { engine } = harness();
    engine.start();
    const low = engine.submitTask(
      deterministicInput("Export quarterly numbers as CSV", "low"),
    );
    const medium = engine.submitTask(
      deterministicInput("Add search indexing for invoices", "medium"),
    );
    const critical = engine.submitTask(
      deterministicInput("Fix critical payment outage", "critical"),
    );

    for (let index = 0; index < 60; index += 1) engine.tick(TICK_SECONDS);
    const lowTask = taskById(engine, low.id);
    const mediumTask = taskById(engine, medium.id);
    const criticalTask = taskById(engine, critical.id);
    check(
      "critical starts first",
      criticalTask.phase !== "queued",
      criticalTask.phase,
    );
    check(
      "medium takes the second slot",
      mediumTask.phase !== "queued",
      mediumTask.phase,
    );
    check("low waits while both slots are busy", lowTask.phase === "queued");

    const allTerminal = tickUntil(
      engine,
      () =>
        ["completed", "failed"].includes(taskById(engine, low.id).status) &&
        ["completed", "failed"].includes(taskById(engine, medium.id).status) &&
        ["completed", "failed"].includes(taskById(engine, critical.id).status),
      400,
    );
    check("all three tasks finish", allTerminal);
    check(
      "all three tasks complete",
      [low.id, medium.id, critical.id].every(
        (id) => taskById(engine, id).phase === "done",
      ),
    );
    const finishedLow = taskById(engine, low.id);
    const finishedMedium = taskById(engine, medium.id);
    const finishedCritical = taskById(engine, critical.id);
    const firstSlotFreedAt = Math.min(
      finishedMedium.completedAt ?? Infinity,
      finishedCritical.completedAt ?? Infinity,
    );
    const lowFirstTransition = finishedLow.history[0];
    check(
      "low starts after a slot frees up",
      lowFirstTransition !== undefined &&
        Number.isFinite(firstSlotFreedAt) &&
        lowFirstTransition.at >= firstSlotFreedAt,
      lowFirstTransition
        ? `low at ${lowFirstTransition.at}, slot freed at ${firstSlotFreedAt}`
        : "low never started",
    );
  }

  // ---------------------------------------------------------------- group 6
  group("6. Backlog and sprint");
  {
    const titles = new Set(TASK_BACKLOG.map((task) => task.title));
    check("at least 15 backlog tasks", TASK_BACKLOG.length >= 15, `${TASK_BACKLOG.length}`);
    check("backlog titles are unique", titles.size === TASK_BACKLOG.length);
    const generic = TASK_BACKLOG.filter(
      (task) =>
        matchWorkTemplate(`${task.title} ${task.description ?? ""}`) ===
        GENERIC_TEMPLATE,
    );
    check(
      "at most 2 backlog tasks fall through to generic",
      generic.length <= 2,
      `${generic.length}: ${generic.map((task) => task.title).join(", ")}`,
    );

    check("sprint has 8 tasks", SPRINT_TASKS.length === 8);

    const { engine } = harness();
    engine.start();
    const submitted = SPRINT_TASKS.map((task) => engine.submitTask(task));
    const allTerminal = tickUntil(
      engine,
      () =>
        engine
          .snapshot()
          .tasks.every((task) => task.status === "completed" || task.status === "failed"),
      900,
    );
    check("the sprint terminates", allTerminal);

    const tasks = submitted.map((task) => taskById(engine, task.id));
    const hotfix = tasks.find(
      (task) => task.title === "Patch session token leak in password-reset flow",
    );
    const migration = tasks.find(
      (task) => task.title === "Migrate legacy billing cron to event-driven pipeline",
    );

    check(
      "scripted hot-fix ends done at iteration 3",
      hotfix !== undefined && hotfix.phase === "done" && hotfix.iteration === 3,
      hotfix ? `${hotfix.phase} i${hotfix.iteration}` : "missing",
    );
    check(
      "scripted migration ends failed",
      migration !== undefined && migration.phase === "failed",
      migration?.phase,
    );
    const completedCount = tasks.filter((task) => task.phase === "done").length;
    check("at least 5 of 8 complete", completedCount >= 5, `${completedCount}/8`);
    check(
      "every sprint task has subtasks and findings",
      tasks.every(
        (task) => task.subtasks.length > 0 && task.findings.length > 0,
      ),
      tasks
        .filter((task) => task.subtasks.length === 0 || task.findings.length === 0)
        .map((task) => task.id)
        .join(", "),
    );
  }

  // ---------------------------------------------------------------- group 7
  group("7. React mirror throttle");
  {
    interface FakeTimer {
      at: number;
      callback: () => void;
      cancelled: boolean;
    }

    const timers: FakeTimer[] = [];
    const pushes: number[] = [];
    let now = 0;

    const advance = (ms: number): void => {
      const target = now + ms;
      for (;;) {
        let next: FakeTimer | null = null;
        for (const timer of timers) {
          if (
            !timer.cancelled &&
            timer.at <= target &&
            (next === null || timer.at < next.at)
          ) {
            next = timer;
          }
        }
        if (next === null) break;
        next.cancelled = true;
        now = next.at;
        next.callback();
      }
      now = target;
    };

    const mirror = new ThrottledMirror({
      intervalMs: MIRROR_INTERVAL_MS,
      now: () => now,
      setTimer: (callback, ms) => {
        const timer: FakeTimer = { at: now + ms, callback, cancelled: false };
        timers.push(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (handle) => {
        (handle as unknown as FakeTimer).cancelled = true;
      },
      push: () => {
        pushes.push(now);
      },
    });

    const baseEngine = new SimulationEngine();
    baseEngine.start();
    baseEngine.submitTask(DEMO_TASK);
    for (let index = 0; index < 120; index += 1) {
      baseEngine.tick(TICK_SECONDS);
    }
    const base = baseEngine.snapshot();
    check(
      "mirror check starts from a live world",
      base.tasks.length > 0 && base.agents.length === 6,
      `${base.tasks.length} tasks`,
    );

    const positionOnly = (step: number): WorldSnapshot => ({
      ...base,
      clock: base.clock + step * 0.01,
      agents: base.agents.map((agent, index) => ({
        ...agent,
        position: {
          x: agent.position.x + step * 0.01 * (index + 1),
          z: agent.position.z - step * 0.005,
        },
        heading: agent.heading + step * 0.002,
      })),
    });

    const progressOnly = (step: number): WorldSnapshot => ({
      ...base,
      clock: base.clock + step * 0.02,
      agents: base.agents.map((agent) => ({
        ...agent,
        progress: Math.min(1, agent.progress + step * 0.002),
      })),
      tasks: base.tasks.map((task) => ({
        ...task,
        progress: Math.min(1, task.progress + step * 0.002),
        updatedAt: task.updatedAt + step * 0.02,
      })),
    });

    mirror.apply(base);
    const seedCount = pushes.length;
    for (let index = 0; index < 30; index += 1) {
      now += 1000 / 30;
      advance(0);
      mirror.apply(positionOnly(index + 1));
    }
    advance(250);
    check(
      "30 position-only snapshots per second never reach the React mirror",
      pushes.length === seedCount,
      `${pushes.length - seedCount} extra updates`,
    );

    const progressStart = pushes.length;
    for (let index = 0; index < 30; index += 1) {
      now += 1000 / 30;
      mirror.apply(progressOnly(index + 1));
      advance(0);
    }
    advance(250);
    const progressPushes = pushes.slice(progressStart);
    const gaps = progressPushes
      .slice(1)
      .map((at, index) => at - progressPushes[index]);
    check(
      "progress-only snapshots are throttled to about one update per 160 ms",
      progressPushes.length >= 3 && progressPushes.length <= 8,
      `${progressPushes.length} updates in about one second`,
    );
    check(
      "throttled mirror updates are at least 160 ms apart",
      gaps.every((gap) => gap >= MIRROR_INTERVAL_MS - 1e-6),
      gaps.map((gap) => gap.toFixed(1)).join(", "),
    );

    const beforeStatus = pushes.length;
    now += 10;
    const statusAt = now;
    const statusResult = mirror.apply({ ...base, status: "paused" });
    check(
      "a status change reaches the mirror immediately",
      statusResult === "immediate" &&
        pushes.length === beforeStatus + 1 &&
        pushes[pushes.length - 1] === statusAt,
      `${statusResult}, ${pushes.length - beforeStatus} updates`,
    );

    mirror.dispose();
  }

  // ---------------------------------------------------------------- group 8
  group("8. WebSocket boundary");
  {
    const wsEngine = new SimulationEngine();
    wsEngine.start();
    wsEngine.submitTask(DEMO_TASK);
    for (let index = 0; index < 60; index += 1) {
      wsEngine.tick(TICK_SECONDS);
    }
    const snapshot = wsEngine.snapshot();
    const wsTask = snapshot.tasks[0];
    check(
      "snapshot fixture has a task",
      wsTask !== undefined,
      `${snapshot.tasks.length} tasks`,
    );

    check(
      "a valid snapshot passes boundary validation",
      parseWorldSnapshot(snapshot) !== null,
    );
    check(
      "a snapshot with an unknown agent status is rejected",
      parseWorldSnapshot({
        ...snapshot,
        agents: snapshot.agents.map((agent, index) =>
          index === 0 ? { ...agent, status: "dancing" } : agent,
        ),
      }) === null,
    );
    check(
      "a snapshot with an unknown task priority is rejected",
      parseWorldSnapshot({
        ...snapshot,
        tasks: snapshot.tasks.map((task, index) =>
          index === 0 ? { ...task, priority: "urgent" } : task,
        ),
      }) === null,
    );

    const wsEvent: AgentEvent = {
      id: "evt-ws-1",
      type: "agent.message",
      timestamp: Date.now(),
      simTime: 1.25,
      agentId: "orion",
      targetAgentId: "piper",
      message: "Boundary check",
      severity: "info",
      feed: true,
    };
    check(
      "a valid event passes boundary validation",
      parseAgentEvent(wsEvent) !== null,
    );
    check(
      "an event with an unknown type is rejected",
      parseAgentEvent({ ...wsEvent, type: "agent.party" }) === null,
    );

    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSING = 2;
      static CLOSED = 3;
      static last: FakeSocket | null = null;

      readyState = FakeSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((message: { data: unknown }) => void) | null = null;
      readonly sent: string[] = [];

      constructor(_url: string) {
        FakeSocket.last = this;
      }

      send(data: string): void {
        this.sent.push(data);
      }

      close(): void {
        if (this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.();
      }

      open(): void {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
      }

      receive(data: unknown): void {
        this.onmessage?.({ data });
      }
    }

    const nativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    try {
      const backend = new WebSocketAgentBackend("ws://boundary.test");
      const seenSnapshots: WorldSnapshot[] = [];
      const seenEvents: AgentEvent[] = [];
      backend.subscribeSnapshot((next) => seenSnapshots.push(next));
      backend.subscribe((event) => seenEvents.push(event));

      const connecting = backend.connect();
      const socket = FakeSocket.last;
      check("the websocket transport opens a socket", socket !== null);
      if (socket === null) throw new Error("FakeSocket was not created");
      socket.open();
      await connecting;

      socket.receive(JSON.stringify({ type: "snapshot", snapshot }));
      check(
        "a snapshot updates getSnapshot and notifies listeners",
        backend.getSnapshot()?.clock === snapshot.clock &&
          seenSnapshots.length === 1,
      );

      socket.receive(JSON.stringify({ type: "event", event: wsEvent }));
      check(
        "an event notifies subscribers",
        seenEvents.length === 1 && seenEvents[0].message === wsEvent.message,
      );

      const nativeWarn = console.warn;
      let warnings = 0;
      console.warn = () => {
        warnings += 1;
      };
      try {
        socket.receive(
          JSON.stringify({
            type: "snapshot",
            snapshot: { ...snapshot, agents: [{ id: "orion" }] },
          }),
        );
        socket.receive(
          JSON.stringify({
            type: "event",
            event: { ...wsEvent, type: "agent.party" },
          }),
        );
        socket.receive("not json");
      } finally {
        console.warn = nativeWarn;
      }
      check(
        "malformed messages warn once each and leave state untouched",
        warnings === 3 &&
          backend.getSnapshot()?.clock === snapshot.clock &&
          seenEvents.length === 1,
        `${warnings} warnings`,
      );

      if (wsTask === undefined) throw new Error("Task fixture missing");
      const submitted = backend.submitTask(DEMO_TASK);
      const sentSubmit = socket.sent[socket.sent.length - 1];
      const submitMessage = JSON.parse(sentSubmit ?? "{}") as {
        id?: string;
      };
      socket.receive(
        JSON.stringify({
          type: "ack",
          id: submitMessage.id,
          ok: true,
          result: wsTask,
        }),
      );
      const created = await submitted;
      check(
        "submitTask resolves with the task from the matching ack",
        created.id === wsTask.id,
      );

      const rejected = backend.start();
      const sentStart = socket.sent[socket.sent.length - 1];
      const startMessage = JSON.parse(sentStart ?? "{}") as { id?: string };
      socket.receive(
        JSON.stringify({
          type: "ack",
          id: startMessage.id,
          ok: false,
          error: "start is locked",
        }),
      );
      let rejection = "";
      try {
        await rejected;
      } catch (error) {
        rejection = error instanceof Error ? error.message : "";
      }
      check(
        "a failed ack rejects the command with the backend message",
        rejection === "start is locked",
        rejection,
      );

      const pending = backend.pause();
      await backend.disconnect();
      let disconnected = false;
      try {
        await pending;
      } catch {
        disconnected = true;
      }
      check("pending acks reject on disconnect", disconnected);
    } finally {
      globalThis.WebSocket = nativeWebSocket;
    }
  }

  // ----------------------------------------------------------------- summary
  console.log("");
  if (failures === 0) {
    console.log(`All ${checks} checks passed.`);
  } else {
    console.log(`${failures} of ${checks} checks failed.`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
