/**
 * Boundary for the JSON protocol in spec 3.5. Everything here treats inbound
 * data as untrusted: messages are size-capped before parsing, arrays are
 * length-capped before their elements are read, and a single bad value rejects
 * the whole message instead of partially applying it.
 */
import type { AgentId, AgentState, AgentStatus, Vec2 } from "../agents/agentTypes.ts";
import { isAgentId } from "../agents/agentTypes.ts";
import type {
  AgentEvent,
  AgentEventType,
  EventSeverity,
} from "../events/eventTypes.ts";
import { EVENT_TYPES } from "../events/eventTypes.ts";
import type { LocationId } from "../simulation/worldLayout.ts";
import { LOCATIONS } from "../simulation/worldLayout.ts";
import type {
  Subtask,
  Task,
  TaskHistoryEntry,
  TaskPriority,
  TaskStatus,
  WorkflowPhase,
  WorkflowSignal,
} from "../tasks/taskTypes.ts";
import { PHASE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../tasks/taskTypes.ts";
import type { CommLink, SimulationStatus, WorldSnapshot } from "./AgentBackend.ts";

/** A message larger than this is dropped before `JSON.parse` runs. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;
/** The protocol has six agents; a wider roster is a hostile or broken server. */
export const MAX_AGENTS = 16;
export const MAX_TASKS = 500;
export const MAX_TASK_COLLECTION = 100;
export const MAX_PATH_POINTS = 256;
export const MAX_LINKS = 64;

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
const TASK_STATUSES: ReadonlySet<string> = new Set(Object.keys(STATUS_LABELS));
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

export function isRecord(value: unknown): value is Record<string, unknown> {
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
  if (value.path.length > MAX_PATH_POINTS) return null;
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

export function parseTask(value: unknown): Task | null {
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
  if (value.subtasks.length > MAX_TASK_COLLECTION) return null;
  const subtasks: Subtask[] = [];
  for (const raw of value.subtasks) {
    const parsed = parseSubtask(raw);
    if (parsed === null) return null;
    subtasks.push(parsed);
  }

  if (!Array.isArray(value.findings)) return null;
  if (value.findings.length > MAX_TASK_COLLECTION) return null;
  const findings: string[] = [];
  for (const raw of value.findings) {
    if (typeof raw !== "string") return null;
    findings.push(raw);
  }

  if (!Array.isArray(value.history)) return null;
  if (value.history.length > MAX_TASK_COLLECTION) return null;
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
  if (value.agents.length > MAX_AGENTS) return null;
  if (value.tasks.length > MAX_TASKS) return null;
  if (value.links.length > MAX_LINKS) return null;

  const agents: AgentState[] = [];
  const agentIds = new Set<AgentId>();
  for (const raw of value.agents) {
    const parsed = parseAgentState(raw);
    if (parsed === null) return null;
    if (agentIds.has(parsed.id)) return null;
    agentIds.add(parsed.id);
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

/** A fully validated server frame, or a reason why it was dropped. */
export type ServerMessage =
  | { kind: "snapshot"; snapshot: WorldSnapshot }
  | { kind: "event"; event: AgentEvent }
  | { kind: "ack"; id: string; ok: boolean; result: unknown; error: string | null }
  | { kind: "invalid"; reason: string };

function invalid(reason: string): ServerMessage {
  return { kind: "invalid", reason };
}

/**
 * Parses one raw frame from the socket. The size check happens on the string
 * so an oversized payload is never handed to `JSON.parse`.
 */
export function parseServerMessage(raw: unknown): ServerMessage {
  if (typeof raw !== "string") {
    return invalid("ignoring a non-text message from the backend");
  }
  if (raw.length > MAX_MESSAGE_BYTES) {
    return invalid(
      `ignoring a ${Math.round(raw.length / 1024)} KiB message from the backend (limit ${MAX_MESSAGE_BYTES / 1024} KiB)`,
    );
  }

  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return invalid("ignoring malformed JSON from the backend");
  }

  if (!isRecord(message) || typeof message.type !== "string") {
    return invalid("ignoring a message without a type");
  }

  switch (message.type) {
    case "snapshot": {
      const snapshot = parseWorldSnapshot(message.snapshot);
      return snapshot === null
        ? invalid("ignoring a malformed snapshot")
        : { kind: "snapshot", snapshot };
    }
    case "event": {
      const event = parseAgentEvent(message.event);
      return event === null
        ? invalid("ignoring a malformed event")
        : { kind: "event", event };
    }
    case "ack": {
      const id = readString(message, "id");
      if (id === null) return invalid("ignoring an acknowledgement without an id");
      const ok = readBoolean(message, "ok");
      if (ok === null) {
        return invalid("ignoring an acknowledgement without ok");
      }
      const error =
        typeof message.error === "string" && message.error.length > 0
          ? message.error
          : null;
      return { kind: "ack", id, ok, result: message.result, error };
    }
    default:
      return invalid(`ignoring unknown message type "${message.type}"`);
  }
}
