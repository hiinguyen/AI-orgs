import type { AgentId } from "../agents/agentTypes.ts";

export const EVENT_TYPES = [
  "system.ready",
  "system.started",
  "system.paused",
  "system.resumed",
  "system.reset",
  "system.speed_changed",
  "task.created",
  "task.assigned",
  "task.status_changed",
  "task.completed",
  "task.failed",
  "task.blocked",
  "task.unblocked",
  "plan.created",
  "research.completed",
  "implementation.started",
  "implementation.submitted",
  "qa.started",
  "qa.passed",
  "qa.failed",
  "review.started",
  "review.approved",
  "review.changes_requested",
  "agent.message",
  "agent.arrived",
  "agent.paused",
  "agent.resumed",
  "agent.ambient",
  "agent.spawned",
  "agent.despawned",
] as const;

export type AgentEventType = (typeof EVENT_TYPES)[number];

export type EventSeverity = "info" | "success" | "warning" | "error";

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  /** Wall clock milliseconds. */
  timestamp: number;
  /** Simulation clock seconds. */
  simTime: number;
  agentId?: AgentId;
  targetAgentId?: AgentId;
  taskId?: string;
  message: string;
  severity: EventSeverity;
  /** Belongs in the human-facing activity feed? */
  feed: boolean;
  metadata?: Record<string, unknown>;
}

/** An event without the fields the engine stamps. */
export type AgentEventDraft = Omit<
  AgentEvent,
  "id" | "timestamp" | "simTime"
>;

/**
 * An event with a target is agent-to-agent communication when it carries a
 * message or an assignment.
 */
export function isAgentCommunication(event: AgentEvent): boolean {
  if (event.targetAgentId === undefined) return false;
  return event.type === "agent.message" || event.type === "task.assigned";
}

export const SYSTEM_EVENT_TYPES: readonly AgentEventType[] = [
  "system.ready",
  "system.started",
  "system.paused",
  "system.resumed",
  "system.reset",
  "system.speed_changed",
];
