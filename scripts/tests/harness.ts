/**
 * Shared plumbing for the headless checks: the engine harness, tick loop and
 * small fixtures the engine, workflow, store and backend suites all use.
 */
import type { AgentEvent } from "../../src/events/eventTypes.ts";
import { SimulationEngine } from "../../src/simulation/SimulationEngine.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import { TASK_BACKLOG } from "../../src/tasks/taskBacklog.ts";
import type { CreateTaskInput, Task } from "../../src/tasks/taskTypes.ts";

export interface TestReporter {
  check(name: string, condition: boolean, detail?: string): void;
  group(title: string): void;
}

export interface Harness {
  engine: SimulationEngine;
  events: AgentEvent[];
}

export function harness(): Harness {
  const engine = new SimulationEngine();
  const events: AgentEvent[] = [];
  engine.events.subscribe((event) => {
    events.push(event);
  });
  return { engine, events };
}

export function tickUntil(
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

export function taskById(engine: SimulationEngine, id: string): Task {
  const task = engine.getTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

export function backlogTask(title: string): CreateTaskInput {
  const found = TASK_BACKLOG.find((task) => task.title === title);
  if (!found) throw new Error(`Backlog title not found: ${title}`);
  return found;
}

export function deterministicInput(
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
export function eventSignature(event: AgentEvent): string {
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

export const DEMO_PHASES = [
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

export const DEMO_EVENTS = [
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
