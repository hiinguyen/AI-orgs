/**
 * Headless engine checks, run with:
 *   node --experimental-strip-types --no-warnings scripts/simulate.ts
 *
 * Six groups, matching section 9 of the spec. Prints a check or cross per
 * assertion and exits 1 if anything fails.
 */
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";
import { TICK_SECONDS } from "../src/simulation/simulationConfig.ts";
import { applySignal, canTransition, isTerminal } from "../src/simulation/WorkflowStateMachine.ts";
import { GENERIC_TEMPLATE, matchWorkTemplate } from "../src/simulation/workContent.ts";
import { AGENTS } from "../src/agents/AgentRegistry.ts";
import { slotFor } from "../src/simulation/worldLayout.ts";
import { DEMO_TASK } from "../src/tasks/taskActions.ts";
import { SPRINT_TASKS, TASK_BACKLOG } from "../src/tasks/taskBacklog.ts";
import { isTerminalPhase } from "../src/tasks/taskTypes.ts";
import type { AgentEvent } from "../src/events/eventTypes.ts";
import type { CreateTaskInput, Task } from "../src/tasks/taskTypes.ts";

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

function main(): void {
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

  // ---------------------------------------------------------------- group 4
  group("4. Pause, resume, blocked agents, reset");
  {
    const { engine } = harness();
    engine.start();
    const created = engine.submitTask(
      deterministicInput("Stripe checkout retry handling", "high"),
    );

    for (let index = 0; index < 60; index += 1) engine.tick(TICK_SECONDS);
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
      check(
        "resuming the owner unblocks the task",
        taskById(engine, created.id).status !== "blocked",
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
    check(
      "low starts after a slot frees up",
      taskById(engine, low.id).iteration === 1,
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

  // ----------------------------------------------------------------- summary
  console.log("");
  if (failures === 0) {
    console.log(`All ${checks} checks passed.`);
  } else {
    console.log(`${failures} of ${checks} checks failed.`);
    process.exitCode = 1;
  }
}

main();
