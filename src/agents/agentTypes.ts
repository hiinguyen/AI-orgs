import type { LocationId } from "../simulation/worldLayout.ts";

/**
 * Phase 9: the agent set is open. Core simulation agents keep their stable
 * ids; a real backend announces live subagents by any id string.
 */
export type AgentId = string;

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

/** Whether an agent is one of the six simulation agents or a live subagent. */
export type AgentKind = "core" | "live";

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: AgentRole;
  roleLabel: string;
  tagline: string;
  color: string;
  /** Core agents live at a station; live agents live in a dispatch bay. */
  home?: LocationId;
  /** Stable seat index (0..5) used at shared ring locations. */
  seat: number;
  kind: AgentKind;
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

/** A live backend may announce this many live agents; the six core are extra. */
export const MAX_LIVE_AGENTS = 64;
/** Total robots the renderer pools for: six core agents plus the live cap. */
export const MAX_AGENTS = MAX_LIVE_AGENTS + 6;
/** Defensive upper bound on an id string that arrives from a backend. */
export const MAX_AGENT_ID_LENGTH = 64;

export const AGENT_ROLES: readonly AgentRole[] = [
  "orchestrator",
  "researcher",
  "product_manager",
  "engineer",
  "qa",
  "reviewer",
] as const;

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

/** An unknown or newer backend role still gets a robot: the engineer rig. */
export function normaliseAgentRole(value: string): AgentRole {
  return isAgentRole(value) ? value : "engineer";
}

/**
 * Any usable id is a valid agent id now. The check rejects empty and
 * unbounded strings, plus control characters that would corrupt the DOM.
 */
export function isAgentId(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_AGENT_ID_LENGTH) return false;
  return !/[\u0000-\u001f\u007f]/.test(value);
}

/** Derive the stable slot order for the six core agents. */
export const CORE_AGENT_IDS: readonly AgentId[] = [
  "orion",
  "iris",
  "piper",
  "kai",
  "quinn",
  "rex",
] as const;
