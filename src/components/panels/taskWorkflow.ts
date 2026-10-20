import type { AgentId } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { Task } from "@/tasks/taskTypes";
import { PHASE_OWNER } from "@/tasks/taskTypes";

export type DisplayPhase =
  | "intake"
  | "planning"
  | "research"
  | "implementation"
  | "testing"
  | "review"
  | "done";

export const WORKFLOW_PHASES: readonly DisplayPhase[] = [
  "intake",
  "planning",
  "research",
  "implementation",
  "testing",
  "review",
  "done",
];

export type WorkflowRowState = "done" | "current" | "pending" | "failed";

export interface WorkflowRow {
  phase: DisplayPhase;
  ownerId: AgentId | null;
  state: WorkflowRowState;
}

function lastActivePhase(task: Task): DisplayPhase | null {
  if (task.phase === "failed") {
    for (let index = task.history.length - 1; index >= 0; index -= 1) {
      const phase = task.history[index].to;
      if (phase !== "failed" && phase !== "queued") {
        return phase;
      }
    }
    return "intake";
  }
  if (task.phase === "queued") return null;
  return task.phase;
}

/** Seven visible workflow rows with check, current, pending or failed states. */
export function workflowRows(task: Task): WorkflowRow[] {
  const current = lastActivePhase(task);
  const currentIndex =
    current === null ? -1 : WORKFLOW_PHASES.indexOf(current);
  const failed = task.phase === "failed";

  return WORKFLOW_PHASES.map((phase, index) => {
    let state: WorkflowRowState;
    if (task.phase === "done") {
      state = "done";
    } else if (currentIndex === -1) {
      state = "pending";
    } else if (index < currentIndex) {
      state = "done";
    } else if (index === currentIndex) {
      state = failed ? "failed" : "current";
    } else {
      state = "pending";
    }
    return { phase, ownerId: PHASE_OWNER[phase], state };
  });
}

export function taskProgressColor(task: Task): string {
  if (task.phase === "done") return "var(--color-ok)";
  if (task.phase === "failed") return "var(--color-bad)";
  if (task.status === "blocked") return "var(--color-warn)";
  if (task.assignedAgentId !== null) {
    return AGENT_BY_ID[task.assignedAgentId].color;
  }
  return "var(--color-signal)";
}
