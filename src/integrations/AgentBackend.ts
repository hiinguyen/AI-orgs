import type { AgentId, AgentProfile, AgentState } from "../agents/agentTypes.ts";
import type { AgentEvent } from "../events/eventTypes.ts";
import type { CreateTaskInput, Task } from "../tasks/taskTypes.ts";

export type SimulationStatus = "ready" | "running" | "paused";

export interface CommLink {
  id: string;
  from: AgentId;
  to: AgentId;
  kind: "message" | "assign" | "report";
  /** Backend clock, seconds. */
  startedAt: number;
  /** Backend clock, seconds. */
  endsAt: number;
}

export interface WorldSnapshot {
  clock: number;
  status: SimulationStatus;
  speed: number;
  /** Who exists right now. Any backend may announce core and live agents. */
  profiles: AgentProfile[];
  agents: AgentState[];
  tasks: Task[];
  links: CommLink[];
}

/** Transport health, reported by backends that can lose their connection. */
export interface BackendConnectionState {
  connected: boolean;
  error: string | null;
}

/**
 * What a backend can accept. Older backends never announce these, so the
 * defaults are all true and the UI behaves exactly as before this message
 * existed. The Claude Code bridge sends all false.
 */
export interface BackendCapabilities {
  submitTask: boolean;
  pauseAgent: boolean;
  setSpeed: boolean;
}

export type BackendCapability = keyof BackendCapabilities;

export const DEFAULT_BACKEND_CAPABILITIES: BackendCapabilities = {
  submitTask: true,
  pauseAgent: true,
  setSpeed: true,
};

export function isCapabilityEnabled(
  capabilities: BackendCapabilities,
  capability: BackendCapability,
): boolean {
  return capabilities[capability];
}

/**
 * True for the Claude Code bridge: a real (non simulated) backend that
 * announced every capability as false. One rule, used by every panel that
 * shows bridge-specific copy. A live backend that merely lacks one capability
 * is not a bridge.
 */
export function isBridgeBackend(
  simulated: boolean,
  capabilities: BackendCapabilities,
): boolean {
  return (
    !simulated &&
    !capabilities.submitTask &&
    !capabilities.pauseAgent &&
    !capabilities.setSpeed
  );
}

/**
 * The only boundary the UI and the 3D layer know. MockAgentBackend runs the
 * local simulation; a WebSocket backend can implement the same surface.
 */
export interface AgentBackend {
  readonly kind: "mock" | "websocket";
  readonly label: string;
  readonly simulated: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  setSpeed(multiplier: number): Promise<void>;

  submitTask(input: CreateTaskInput): Promise<Task>;
  pauseAgent(id: AgentId): Promise<void>;
  resumeAgent(id: AgentId): Promise<void>;

  getSnapshot(): WorldSnapshot | null;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  subscribeSnapshot(listener: (snapshot: WorldSnapshot) => void): () => void;
  /** Optional: only transports that can drop a connection need to report. */
  subscribeConnection?(
    listener: (state: BackendConnectionState) => void,
  ): () => void;
  /** Optional: what this backend accepts. Absent means every capability. */
  getCapabilities?(): BackendCapabilities;
  subscribeCapabilities?(
    listener: (capabilities: BackendCapabilities) => void,
  ): () => void;
}
