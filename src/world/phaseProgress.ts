import type { Task, WorkflowPhase } from "../tasks/taskTypes.ts";
import { SIMULATION_CONFIG } from "../simulation/simulationConfig.ts";

/**
 * Progress of one workflow phase as a 0..1 ratio, derived from the task's
 * overall progress and the phase's slice of it. A task that already left the
 * phase counts as complete, one that has not reached it as not started.
 */
export function phaseRatio(task: Task, phase: WorkflowPhase): number {
  if (task.phase !== phase) {
    const [start] = SIMULATION_CONFIG.phaseProgress[phase];
    return task.progress > start ? 1 : 0;
  }
  const [start, end] = SIMULATION_CONFIG.phaseProgress[phase];
  if (end <= start) return 0;
  return Math.max(0, Math.min(1, (task.progress - start) / (end - start)));
}

export function percentOf(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}
