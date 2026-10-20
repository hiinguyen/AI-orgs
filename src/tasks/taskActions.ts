import type { CreateTaskInput, Task } from "./taskTypes.ts";
import { PRIORITY_ORDER, isTerminalPhase } from "./taskTypes.ts";

export const DEMO_TASK: CreateTaskInput = {
  title: "Build a user authentication API with JWT support",
  description:
    "Register/login endpoints, short-lived access tokens with refresh-token rotation, and middleware for protected routes.",
  priority: "high",
  isDemo: true,
  script: { qaFailsOn: [1], reviewChangesOn: [] },
};

export type TaskFilter = "all" | "active" | "queued" | "done";

export function isActiveTask(task: Task): boolean {
  return (
    task.phase !== "queued" && !isTerminalPhase(task.phase)
  );
}

export function pendingTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => !isTerminalPhase(task.phase));
}

export function activeTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter(isActiveTask);
}

export function queuedTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.phase === "queued");
}

export function completedTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.phase === "done");
}

export function filterTasks(
  tasks: readonly Task[],
  filter: TaskFilter,
): Task[] {
  switch (filter) {
    case "active":
      return activeTasks(tasks);
    case "queued":
      return queuedTasks(tasks);
    case "done":
      return completedTasks(tasks);
    default:
      return [...tasks];
  }
}

export function taskCounts(tasks: readonly Task[]): {
  all: number;
  active: number;
  queued: number;
  done: number;
} {
  return {
    all: tasks.length,
    active: activeTasks(tasks).length,
    queued: queuedTasks(tasks).length,
    done: completedTasks(tasks).length,
  };
}

/** Highest priority first, then oldest. Used by the orchestrator scheduler. */
export function sortTasksByPriorityThenAge(
  tasks: readonly Task[],
): Task[] {
  return [...tasks].sort((left, right) => {
    const priorityDelta =
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDelta !== 0) return priorityDelta;
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function listGroup(task: Task): number {
  if (isActiveTask(task)) return 0;
  if (task.phase === "queued") return 1;
  return 2;
}

/** Active first, then queued, then finished; newest first inside a group. */
export function sortTasksForList(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const groupDelta = listGroup(left) - listGroup(right);
    if (groupDelta !== 0) return groupDelta;
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return right.id.localeCompare(left.id);
  });
}

export function findTask(
  tasks: readonly Task[],
  taskId: string,
): Task | undefined {
  return tasks.find((task) => task.id === taskId);
}
