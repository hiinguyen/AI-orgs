import type { LocationId } from "../simulation/worldLayout.ts";

export type AgentId = "orion" | "iris" | "piper" | "kai" | "quinn" | "rex";

export type AgentRole =
  | "orchestrator"
  | "researcher"
  | "product_manager"
  | "engineer"
  | "qa"
  | "reviewer";

export type AgentStatus =
  | "idle"
  | "walking"
  | "working"
  | "thinking"
  | "communicating"
  | "success"
  | "error";

export interface Vec2 {
  x: number;
  z: number;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: AgentRole;
  roleLabel: string;
  tagline: string;
  color: string;
  home: LocationId;
  /** Stable seat index (0..5) used at shared ring locations. */
  seat: number;
}

/**
 * Serialisable agent state. A real backend sends the same shape, so nothing
 * in the rendering layer needs to know which backend is driving it.
 */
export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  activity: string;
  currentTaskId: string | null;
  progress: number;
  location: LocationId | null;
  destination: LocationId | null;
  position: Vec2;
  heading: number;
  path: Vec2[];
  facingAgentId: AgentId | null;
  paused: boolean;
}

export const AGENT_IDS: readonly AgentId[] = [
  "orion",
  "iris",
  "piper",
  "kai",
  "quinn",
  "rex",
] as const;

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}
