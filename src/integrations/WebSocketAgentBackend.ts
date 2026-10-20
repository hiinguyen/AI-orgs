import type {
  AgentId,
  AgentState,
  AgentStatus,
  Vec2,
} from "../agents/agentTypes.ts";
import { isAgentId } from "../agents/agentTypes.ts";
import type { AgentEvent, AgentEventType, EventSeverity } from "../events/eventTypes.ts";
import { EVENT_TYPES } from "../events/eventTypes.ts";
import type { LocationId } from "../simulation/worldLayout.ts";
import { LOCATIONS } from "../simulation/worldLayout.ts";
import type {
  CreateTaskInput,
  Subtask,
  Task,
  TaskHistoryEntry,
  TaskPriority,
  TaskStatus,
  WorkflowPhase,
  WorkflowSignal,
} from "../tasks/taskTypes.ts";
import {
  PHASE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "../tasks/taskTypes.ts";
import type {
  AgentBackend,
  CommLink,
  SimulationStatus,
  WorldSnapshot,
} from "./AgentBackend.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;

const AGENT_STATUSES: ReadonlySet<string> = new Set<AgentStatus>([
  "idle",
  "walking",
  "working",
  "thinking",
  "communicating",
  "success",
  "error",
]);
const SIMULATION_STATUSES: ReadonlySet<string> = new Set<SimulationStatus>([
  "ready",
  "running",
  "paused",
]);
const TASK_STATUSES: ReadonlySet<string> = new Set(
  Object.keys(STATUS_LABELS),
);
const TASK_PHASES: ReadonlySet<string> = new Set(Object.keys(PHASE_LABELS));
const TASK_PRIORITIES: ReadonlySet<string> = new Set(
  Object.keys(PRIORITY_LABELS),
);
const WORKFLOW_SIGNALS: ReadonlySet<string> = new Set<WorkflowSignal>([
  "picked_up",
  "delegated",
  "plan_ready",
  "findings_published",
  "submitted",
  "tests_passed",
  "tests_failed",
  "changes_requested",
  "approved",
  "abort",
]);
const LOCATION_IDS: ReadonlySet<string> = new Set(Object.keys(LOCATIONS));
const EVENT_TYPES_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
const SEVERITIES: ReadonlySet<string> = new Set<EventSeverity>([
  "info",
  "success",
  "warning",
  "error",
]);
const LINK_KINDS: ReadonlySet<string> = new Set<CommLink["kind"]>([
  "message",
  "assign",
  "report",
]);

type BackendCommand =
  | { name: "start" | "stop" | "pause" | "resume" | "reset" }
  | { name: "setSpeed"; multiplier: number }
  | { name: "submitTask"; input: CreateTaskInput }
  | { name: "pauseAgent" | "resumeAgent"; agentId: AgentId };

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T | null {
  return typeof value === "string" && allowed.has(value)
    ? (value as T)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseVec2(value: unknown): Vec2 | null {
  if (!isRecord(value)) return null;
  const x = readFiniteNumber(value, "x");
  const z = readFiniteNumber(value, "z");
  return x === null || z === null ? null : { x, z };
}

function parseAgentState(value: unknown): AgentState | null {
  if (!isRecord(value)) return null;

  const id = readString(value, "id");
  if (id === null || !isAgentId(id)) return null;

  const status = readEnum<AgentStatus>(value.status, AGENT_STATUSES);
  if (status === null) return null;

  const activity = readString(value, "activity");
  if (activity === null) return null;

  const rawTaskId = value.currentTaskId;
  if (rawTaskId !== null && typeof rawTaskId !== "string") return null;
  const currentTaskId = rawTaskId;

  const progress = readFiniteNumber(value, "progress");
  if (progress === null) return null;

  const rawLocation = value.location;
  let location: LocationId | null;
  if (rawLocation === null) {
    location = null;
  } else {
    const parsed = readEnum<LocationId>(rawLocation, LOCATION_IDS);
    if (parsed === null) return null;
    location = parsed;
  }

  const rawDestination = value.destination;
  let destination: LocationId | null;
  if (rawDestination === null) {
    destination = null;
  } else {
    const parsed = readEnum<LocationId>(rawDestination, LOCATION_IDS);
    if (parsed === null) return null;
    destination = parsed;
  }

  const position = parseVec2(value.position);
  if (position === null) return null;

  const heading = readFiniteNumber(value, "heading");
  if (heading === null) return null;

  if (!Array.isArray(value.path)) return null;
  const path: Vec2[] = [];
  for (const point of value.path) {
    const parsed = parseVec2(point);
    if (parsed === null) return null;
    path.push(parsed);
  }

  const rawFacing = value.facingAgentId;
  let facingAgentId: AgentId | null;
  if (rawFacing === null) {
    facingAgentId = null;
  } else if (typeof rawFacing === "string" && isAgentId(rawFacing)) {
    facingAgentId = rawFacing;
  } else {
    return null;
  }

  const paused = readBoolean(value, "paused");
  if (paused === null) return null;

  return {
    id,
    status,
    activity,
    currentTaskId,
    progress: clamp01(progress),
    location,
    destination,
    position,
    heading,
    path,
    facingAgentId,
    paused,
  };
}

function parseSubtask(value: unknown): Subtask | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const title = readString(value, "title");
  const done = readBoolean(value, "done");
  if (id === null || title === null || done === null) return null;
  return { id, title, done };
}

function parseHistoryEntry(value: unknown): TaskHistoryEntry | null {
  if (!isRecord(value)) return null;
  const from = readEnum<WorkflowPhase>(value.from, TASK_PHASES);
  const to = readEnum<WorkflowPhase>(value.to, TASK_PHASES);
  const signal = readEnum<WorkflowSignal>(value.signal, WORKFLOW_SIGNALS);
  const at = readFiniteNumber(value, "at");
  if (from === null || to === null || signal === null || at === null) {
    return null;
  }
  return { from, to, signal, at };
}

function parseTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;

  const id = readString(value, "id");
  const title = readString(value, "title");
  const description = readString(value, "description");
  if (id === null || title === null || description === null) return null;

  const priority = readEnum<TaskPriority>(value.priority, TASK_PRIORITIES);
  const status = readEnum<TaskStatus>(value.status, TASK_STATUSES);
  const phase = readEnum<WorkflowPhase>(value.phase, TASK_PHASES);
  if (priority === null || status === null || phase === null) return null;

  const rawOwner = value.assignedAgentId;
  let assignedAgentId: AgentId | null;
  if (rawOwner === null) {
    assignedAgentId = null;
  } else if (typeof rawOwner === "string" && isAgentId(rawOwner)) {
    assignedAgentId = rawOwner;
  } else {
    return null;
  }

  const progress = readFiniteNumber(value, "progress");
  const createdAt = readFiniteNumber(value, "createdAt");
  const updatedAt = readFiniteNumber(value, "updatedAt");
  const iteration = readFiniteNumber(value, "iteration");
  if (
    progress === null ||
    createdAt === null ||
    updatedAt === null ||
    iteration === null
  ) {
    return null;
  }

  const rawCompletedAt = value.completedAt;
  let completedAt: number | null;
  if (rawCompletedAt === null) {
    completedAt = null;
  } else if (
    typeof rawCompletedAt === "number" &&
    Number.isFinite(rawCompletedAt)
  ) {
    completedAt = rawCompletedAt;
  } else {
    return null;
  }

  if (!Array.isArray(value.subtasks)) return null;
  const subtasks: Subtask[] = [];
  for (const raw of value.subtasks) {
    const parsed = parseSubtask(raw);
    if (parsed === null) return null;
    subtasks.push(parsed);
  }

  if (!Array.isArray(value.findings)) return null;
  const findings: string[] = [];
  for (const raw of value.findings) {
    if (typeof raw !== "string") return null;
    findings.push(raw);
  }

  if (!Array.isArray(value.history)) return null;
  const history: TaskHistoryEntry[] = [];
  for (const raw of value.history) {
    const parsed = parseHistoryEntry(raw);
    if (parsed === null) return null;
    history.push(parsed);
  }

  const isDemo = readBoolean(value, "isDemo");
  if (isDemo === null) return null;

  const rawPreferred = value.preferredAgentId;
  let preferredAgentId: AgentId | null;
  if (rawPreferred === null) {
    preferredAgentId = null;
  } else if (typeof rawPreferred === "string" && isAgentId(rawPreferred)) {
    preferredAgentId = rawPreferred;
  } else {
    return null;
  }

  const rawBlocked = value.blockedReason;
  let blockedReason: string | null;
  if (rawBlocked === null) {
    blockedReason = null;
  } else if (typeof rawBlocked === "string") {
    blockedReason = rawBlocked;
  } else {
    return null;
  }

  return {
    id,
    title,
    description,
    priority,
    status,
    phase,
    assignedAgentId,
    progress: clamp01(progress),
    createdAt,
    updatedAt,
    completedAt,
    iteration,
    subtasks,
    findings,
    history,
    isDemo,
    preferredAgentId,
    blockedReason,
  };
}

function parseCommLink(value: unknown): CommLink | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const from =
    typeof value.from === "string" && isAgentId(value.from)
      ? value.from
      : null;
  const to =
    typeof value.to === "string" && isAgentId(value.to) ? value.to : null;
  const kind = readEnum<CommLink["kind"]>(value.kind, LINK_KINDS);
  const startedAt = readFiniteNumber(value, "startedAt");
  const endsAt = readFiniteNumber(value, "endsAt");
  if (
    id === null ||
    from === null ||
    to === null ||
    kind === null ||
    startedAt === null ||
    endsAt === null
  ) {
    return null;
  }
  return { id, from, to, kind, startedAt, endsAt };
}

export function parseWorldSnapshot(value: unknown): WorldSnapshot | null {
  if (!isRecord(value)) return null;
  const clock = readFiniteNumber(value, "clock");
  const status = readEnum<SimulationStatus>(value.status, SIMULATION_STATUSES);
  const speed = readFiniteNumber(value, "speed");
  if (clock === null || status === null || speed === null || speed <= 0) {
    return null;
  }
  if (!Array.isArray(value.agents) || !Array.isArray(value.tasks)) {
    return null;
  }
  if (!Array.isArray(value.links)) return null;

  const agents: AgentState[] = [];
  for (const raw of value.agents) {
    const parsed = parseAgentState(raw);
    if (parsed === null) return null;
    agents.push(parsed);
  }

  const tasks: Task[] = [];
  for (const raw of value.tasks) {
    const parsed = parseTask(raw);
    if (parsed === null) return null;
    tasks.push(parsed);
  }

  const links: CommLink[] = [];
  for (const raw of value.links) {
    const parsed = parseCommLink(raw);
    if (parsed === null) return null;
    links.push(parsed);
  }

  return { clock, status, speed, agents, tasks, links };
}

export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const type = readEnum<AgentEventType>(value.type, EVENT_TYPES_SET);
  const timestamp = readFiniteNumber(value, "timestamp");
  const simTime = readFiniteNumber(value, "simTime");
  const message = readString(value, "message");
  const severity = readEnum<EventSeverity>(value.severity, SEVERITIES);
  const feed = readBoolean(value, "feed");
  if (
    id === null ||
    type === null ||
    timestamp === null ||
    simTime === null ||
    message === null ||
    severity === null ||
    feed === null
  ) {
    return null;
  }

  const rawAgentId = value.agentId;
  let agentId: AgentId | undefined;
  if (rawAgentId !== undefined) {
    if (typeof rawAgentId !== "string" || !isAgentId(rawAgentId)) return null;
    agentId = rawAgentId;
  }

  const rawTarget = value.targetAgentId;
  let targetAgentId: AgentId | undefined;
  if (rawTarget !== undefined) {
    if (typeof rawTarget !== "string" || !isAgentId(rawTarget)) return null;
    targetAgentId = rawTarget;
  }

  const rawTaskId = value.taskId;
  let taskId: string | undefined;
  if (rawTaskId !== undefined) {
    if (typeof rawTaskId !== "string") return null;
    taskId = rawTaskId;
  }

  const rawMetadata = value.metadata;
  let metadata: Record<string, unknown> | undefined;
  if (rawMetadata !== undefined) {
    if (!isRecord(rawMetadata)) return null;
    metadata = rawMetadata;
  }

  return {
    id,
    type,
    timestamp,
    simTime,
    message,
    severity,
    feed,
    ...(agentId === undefined ? {} : { agentId }),
    ...(targetAgentId === undefined ? {} : { targetAgentId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Talks to a real orchestrator over the JSON protocol in spec 3.5. Every
 * inbound message is untrusted: a malformed snapshot, event or ack is logged
 * once and dropped instead of reaching the store.
 */
export class WebSocketAgentBackend implements AgentBackend {
  readonly kind = "websocket" as const;
  readonly label = "Live backend";
  readonly simulated = false;

  private readonly url: string;
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private snapshot: WorldSnapshot | null = null;

  private readonly pending = new Map<string, PendingCommand>();
  private readonly eventListeners = new Set<(event: AgentEvent) => void>();
  private readonly snapshotListeners = new Set<
    (snapshot: WorldSnapshot) => void
  >();

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connecting !== null) return this.connecting;

    const attempt = new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        reject(new Error("Could not open the backend WebSocket"));
        return;
      }

      this.socket = socket;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(message));
      };

      const timer = setTimeout(() => {
        fail("Timed out connecting to the backend");
        socket.close();
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        fail("Could not connect to the backend");
      };
      socket.onclose = () => {
        fail("Backend connection closed");
        if (this.socket === socket) {
          this.socket = null;
          this.rejectPending(new Error("Backend disconnected"));
        }
      };
      socket.onmessage = (message: MessageEvent) => {
        this.handleMessage(message.data);
      };
    });

    this.connecting = attempt;
    void attempt.then(
      () => {
        this.connecting = null;
      },
      () => {
        this.connecting = null;
      },
    );
    return attempt;
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    this.rejectPending(new Error("Backend disconnected"));
    if (
      socket !== null &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close();
    }
  }

  async start(): Promise<void> {
    await this.command({ name: "start" });
  }

  async stop(): Promise<void> {
    await this.command({ name: "stop" });
  }

  async pause(): Promise<void> {
    await this.command({ name: "pause" });
  }

  async resume(): Promise<void> {
    await this.command({ name: "resume" });
  }

  async reset(): Promise<void> {
    await this.command({ name: "reset" });
  }

  async setSpeed(multiplier: number): Promise<void> {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error("Speed must be a positive number");
    }
    await this.command({ name: "setSpeed", multiplier });
  }

  async submitTask(input: CreateTaskInput): Promise<Task> {
    const result = await this.command({ name: "submitTask", input });
    const task = parseTask(result);
    if (task === null) {
      throw new Error("Backend acknowledgement did not contain a valid task");
    }
    return task;
  }

  async pauseAgent(id: AgentId): Promise<void> {
    if (!isAgentId(id)) throw new Error("Unknown agent");
    await this.command({ name: "pauseAgent", agentId: id });
  }

  async resumeAgent(id: AgentId): Promise<void> {
    if (!isAgentId(id)) throw new Error("Unknown agent");
    await this.command({ name: "resumeAgent", agentId: id });
  }

  getSnapshot(): WorldSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeSnapshot(listener: (snapshot: WorldSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  private command(command: BackendCommand): Promise<unknown> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Backend is not connected"));
    }

    const id = createCommandId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Backend did not acknowledge ${command.name} within ${
              ACK_TIMEOUT_MS / 1000
            }s`,
          ),
        );
      }, ACK_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        socket.send(JSON.stringify({ type: "command", id, command }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("Could not send the command"),
        );
      }
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      console.warn(
        "[agent-backend] Ignoring a non-text message from the backend",
      );
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      console.warn("[agent-backend] Ignoring malformed JSON from the backend");
      return;
    }

    if (!isRecord(message) || typeof message.type !== "string") {
      console.warn("[agent-backend] Ignoring a message without a type");
      return;
    }

    switch (message.type) {
      case "snapshot": {
        const snapshot = parseWorldSnapshot(message.snapshot);
        if (snapshot === null) {
          console.warn("[agent-backend] Ignoring a malformed snapshot");
          return;
        }
        this.snapshot = snapshot;
        for (const listener of this.snapshotListeners) listener(snapshot);
        return;
      }
      case "event": {
        const event = parseAgentEvent(message.event);
        if (event === null) {
          console.warn("[agent-backend] Ignoring a malformed event");
          return;
        }
        for (const listener of this.eventListeners) listener(event);
        return;
      }
      case "ack": {
        this.handleAck(message);
        return;
      }
      default:
        console.warn(
          `[agent-backend] Ignoring unknown message type "${message.type}"`,
        );
    }
  }

  private handleAck(message: Record<string, unknown>): void {
    const id = readString(message, "id");
    if (id === null) {
      console.warn("[agent-backend] Ignoring an acknowledgement without an id");
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      // A late ack for a timed out or disconnected command.
      return;
    }
    const ok = readBoolean(message, "ok");
    if (ok === null) {
      console.warn("[agent-backend] Ignoring an acknowledgement without ok");
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(
      new Error(
        typeof message.error === "string" && message.error.length > 0
          ? message.error
          : "Backend rejected the command",
      ),
    );
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
