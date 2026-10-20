import type { AgentId, AgentState } from "../agents/agentTypes.ts";
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
  agents: AgentState[];
  tasks: Task[];
  links: CommLink[];
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
}
