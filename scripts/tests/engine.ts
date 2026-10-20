/**
 * Engine checks: the demo run, determinism, concurrency/priority and the
 * backlog + sprint. Section 9 checks 2, 3, 5 and 6.
 */
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import { GENERIC_TEMPLATE, matchWorkTemplate } from "../../src/simulation/workContent.ts";
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import { SPRINT_TASKS, TASK_BACKLOG } from "../../src/tasks/taskBacklog.ts";
import { isTerminalPhase } from "../../src/tasks/taskTypes.ts";
import type { Task } from "../../src/tasks/taskTypes.ts";
import type { AgentEvent } from "../../src/events/eventTypes.ts";
import {
  DEMO_EVENTS,
  DEMO_PHASES,
  deterministicInput,
  eventSignature,
  harness,
  taskById,
  tickUntil,
} from "./harness.ts";
import type { TestReporter } from "./harness.ts";

interface DemoRun {
  task: Task;
  clock: number;
  events: AgentEvent[];
  subtaskTrend: number[];
}

function doneSubtasks(task: Task): number {
  return task.subtasks.filter((subtask) => subtask.done).length;
}

function runDemo(): DemoRun {
  const { engine, events } = harness();
  engine.emitBootEvents();
  engine.start();
  const created = engine.submitTask(DEMO_TASK);

  const start = engine.snapshot().clock;
  const subtaskTrend: number[] = [];
  for (;;) {
    const task = engine.getTask(created.id);
    if (task !== null && isTerminalPhase(task.phase)) break;
    if (engine.snapshot().clock - start > 200) {
      throw new Error(`Demo did not finish, stuck in ${task?.phase ?? "unknown"}`);
    }
    engine.tick(TICK_SECONDS);
    const next = engine.getTask(created.id);
    if (next !== null) subtaskTrend.push(doneSubtasks(next));
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
  return { task: taskById(engine, created.id), clock, events, subtaskTrend };
}

export function runDemoSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
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
  check(
    "demo iteration is 2",
    demo.task.iteration === 2,
    `iteration ${demo.task.iteration}`,
  );
  check(
    "demo progress is exactly 1",
    demo.task.progress === 1,
    `progress ${demo.task.progress}`,
  );
  check(
    "all subtasks are done",
    demo.task.subtasks.length === 6 &&
      demo.task.subtasks.every((subtask) => subtask.done),
    `${demo.task.subtasks.filter((subtask) => subtask.done).length}/${demo.task.subtasks.length}`,
  );
  check(
    "subtask cards never un-tick across rework",
    demo.subtaskTrend.every(
      (count, index) => index === 0 || count >= demo.subtaskTrend[index - 1],
    ),
    demo.subtaskTrend.join(" "),
  );
  check(
    "findings are published",
    demo.task.findings.length === 3 &&
      demo.task.findings[0].includes("Short-lived access tokens"),
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
    demoSignatures.length === repeatSignatures.length && firstDifferent === -1;
  check(
    "two fresh runs emit the same event stream",
    streamsMatch,
    firstDifferent === -1
      ? `${demoSignatures.length} vs ${repeatSignatures.length} events`
      : `event ${firstDifferent + 1}: ${demoSignatures[firstDifferent]} vs ${repeatSignatures[firstDifferent]}`,
  );
}

export function runConcurrencySuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("5. Concurrency and priority");
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

export function runBacklogSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("6. Backlog and sprint");
  const titles = new Set(TASK_BACKLOG.map((task) => task.title));
  check(
    "at least 15 backlog tasks",
    TASK_BACKLOG.length >= 15,
    `${TASK_BACKLOG.length}`,
  );
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
        .tasks.every(
          (task) => task.status === "completed" || task.status === "failed",
        ),
    900,
  );
  check("the sprint terminates", allTerminal);

  const tasks = submitted.map((task) => taskById(engine, task.id));
  const hotfix = tasks.find(
    (task) => task.title === "Patch session token leak in password-reset flow",
  );
  const migration = tasks.find(
    (task) =>
      task.title === "Migrate legacy billing cron to event-driven pipeline",
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
      .filter(
        (task) => task.subtasks.length === 0 || task.findings.length === 0,
      )
      .map((task) => task.id)
      .join(", "),
  );
}
