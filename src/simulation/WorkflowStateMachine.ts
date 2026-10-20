import {
  PHASE_OWNER,
  PHASE_STATUS,
  isTerminalPhase,
} from "../tasks/taskTypes.ts";
import type {
  Task,
  WorkflowPhase,
  WorkflowSignal,
} from "../tasks/taskTypes.ts";
import { SIMULATION_CONFIG } from "./simulationConfig.ts";

const TRANSITIONS: Record<
  Exclude<WorkflowPhase, "done" | "failed">,
  Partial<Record<Exclude<WorkflowSignal, "abort">, WorkflowPhase>>
> = {
  queued: { picked_up: "intake" },
  intake: { delegated: "planning" },
  planning: { plan_ready: "research" },
  research: { findings_published: "implementation" },
  implementation: { submitted: "testing" },
  testing: { tests_passed: "review", tests_failed: "implementation" },
  review: { approved: "done", changes_requested: "implementation" },
};

/** The phase a signal moves to, or null when the signal is not valid here. */
export function nextPhase(
  from: WorkflowPhase,
  signal: WorkflowSignal,
): WorkflowPhase | null {
  if (signal === "abort") {
    return isTerminalPhase(from) ? null : "failed";
  }
  if (from === "done" || from === "failed") return null;
  return TRANSITIONS[from][signal] ?? null;
}

export function canTransition(
  from: WorkflowPhase,
  signal: WorkflowSignal,
): boolean {
  return nextPhase(from, signal) !== null;
}

export function isTerminal(phase: WorkflowPhase): boolean {
  return isTerminalPhase(phase);
}

/**
 * Pure transition: returns a new task, never mutates the input. Invalid
 * signals leave the task untouched so a late backend event cannot corrupt it.
 */
export function applySignal(
  task: Task,
  signal: WorkflowSignal,
  at: number,
): Task {
  const to = nextPhase(task.phase, signal);
  if (to === null) return task;

  const isRework = signal === "tests_failed" || signal === "changes_requested";
  const phaseStart = SIMULATION_CONFIG.phaseProgress[to][0];
  const progress = isRework
    ? phaseStart
    : Math.max(task.progress, phaseStart);
  const iteration =
    to === "implementation" ? task.iteration + 1 : task.iteration;

  return {
    ...task,
    phase: to,
    status: PHASE_STATUS[to],
    assignedAgentId: PHASE_OWNER[to],
    progress,
    iteration,
    updatedAt: at,
    completedAt: isTerminalPhase(to) ? at : task.completedAt,
    blockedReason: null,
    history: [
      ...task.history,
      { from: task.phase, to, signal, at },
    ],
  };
}
