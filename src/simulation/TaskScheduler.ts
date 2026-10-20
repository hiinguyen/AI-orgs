import type { Task } from "../tasks/taskTypes.ts";
import { isTerminalPhase } from "../tasks/taskTypes.ts";
import { sortTasksByPriorityThenAge } from "../tasks/taskActions.ts";

/**
 * Concurrency policy for the orchestrator: at most maxConcurrentTasks work in
 * flight, picked by priority and then by age. Pure, so it is easy to test.
 */
export class TaskScheduler {
  private readonly maxConcurrentTasks: number;

  constructor(maxConcurrentTasks: number) {
    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  activeCount(tasks: readonly Task[]): number {
    return tasks.filter(
      (task) => task.phase !== "queued" && !isTerminalPhase(task.phase),
    ).length;
  }

  canPick(tasks: readonly Task[]): boolean {
    return this.activeCount(tasks) < this.maxConcurrentTasks;
  }

  /** The next task to pick up, or null when the floor is full or empty. */
  nextTask(tasks: readonly Task[]): Task | null {
    if (!this.canPick(tasks)) return null;
    const queued = sortTasksByPriorityThenAge(
      tasks.filter((task) => task.phase === "queued"),
    );
    return queued[0] ?? null;
  }
}
