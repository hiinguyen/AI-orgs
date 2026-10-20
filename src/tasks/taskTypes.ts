import type { AgentId } from "../agents/agentTypes.ts";

export type WorkflowPhase =
  | "queued"
  | "intake"
  | "planning"
  | "research"
  | "implementation"
  | "testing"
  | "review"
  | "done"
  | "failed";

export type TaskStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "testing"
  | "review"
  | "blocked"
  | "completed"
  | "failed";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type WorkflowSignal =
  | "picked_up"
  | "delegated"
  | "plan_ready"
  | "findings_published"
  | "submitted"
  | "tests_passed"
  | "tests_failed"
  | "changes_requested"
  | "approved"
  | "abort";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskHistoryEntry {
  from: WorkflowPhase;
  to: WorkflowPhase;
  signal: WorkflowSignal;
  /** Simulation clock in seconds. */
  at: number;
}

/** Forces QA and review outcomes per implementation iteration. */
export interface TaskScript {
  qaFailsOn?: number[];
  reviewChangesOn?: number[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  phase: WorkflowPhase;
  assignedAgentId: AgentId | null;
  /** 0..1, advances with the current phase. */
  progress: number;
  /** Simulation clock in seconds. */
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** Implementation attempt counter, 1-based once implementation starts. */
  iteration: number;
  subtasks: Subtask[];
  findings: string[];
  history: TaskHistoryEntry[];
  isDemo: boolean;
  preferredAgentId: AgentId | null;
  blockedReason: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  preferredAgentId?: AgentId;
  isDemo?: boolean;
  script?: TaskScript;
}

/** Lower is more urgent. */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "Queued",
  assigned: "Assigned",
  in_progress: "In progress",
  testing: "Testing",
  review: "Review",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
};

export const PHASE_LABELS: Record<WorkflowPhase, string> = {
  queued: "Queued",
  intake: "Intake",
  planning: "Planning",
  research: "Research",
  implementation: "Implementation",
  testing: "Testing",
  review: "Code review",
  done: "Done",
  failed: "Failed",
};

/** Task status is a projection of the workflow phase. */
export const PHASE_STATUS: Record<WorkflowPhase, TaskStatus> = {
  queued: "queued",
  intake: "assigned",
  planning: "in_progress",
  research: "in_progress",
  implementation: "in_progress",
  testing: "testing",
  review: "review",
  done: "completed",
  failed: "failed",
};

/** The agent that owns each phase. */
export const PHASE_OWNER: Record<WorkflowPhase, AgentId | null> = {
  queued: null,
  intake: "orion",
  planning: "piper",
  research: "iris",
  implementation: "kai",
  testing: "quinn",
  review: "rex",
  done: "orion",
  failed: null,
};

export const TERMINAL_PHASES: readonly WorkflowPhase[] = ["done", "failed"];

export function isTerminalPhase(phase: WorkflowPhase): boolean {
  return phase === "done" || phase === "failed";
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed";
}
