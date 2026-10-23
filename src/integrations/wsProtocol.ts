/**
 * Boundary for the JSON protocol in spec 3.5. Everything here treats inbound
 * data as untrusted: messages are size-capped before parsing, arrays are
 * length-capped before their elements are read, and a single bad value rejects
 * the whole message instead of partially applying it.
 */
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  Vec2,
} from "../agents/agentTypes.ts";
import {
  MAX_AGENTS,
  MAX_AGENT_ID_LENGTH,
  MAX_LIVE_AGENTS,
  isAgentId,
  normaliseAgentRole,
} from "../agents/agentTypes.ts";
import { CORE_AGENT_IDS } from "../agents/agentTypes.ts";
import { CORE_AGENTS } from "../agents/AgentRegistry.ts";
import { colorForAgent } from "../agents/agentPalette.ts";
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
export { MAX_AGENTS };
export const MAX_TASKS = 500;
export const MAX_TASK_COLLECTION = 100;
export const MAX_PATH_POINTS = 256;
export const MAX_LINKS = 64;
export const MAX_ACTIVITY_LENGTH = 200;
export const MAX_EVENT_MESSAGE_LENGTH = 300;
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_FINDING_LENGTH = 500;
export const MAX_REASON_LENGTH = 300;
export const MAX_METADATA_KEYS = 16;
export const MAX_METADATA_BYTES = 2048;
/** Generous bound on any coordinate; the floor is 30 x 21. */
const COORD_LIMIT = 100;
/** Reject a hostile agents array before validating thousands of entries. */
const MAX_RAW_AGENTS = MAX_AGENTS * 4;

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
  if (x === null || z === null) return null;
  if (Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) return null;
  return { x, z };
}

/** Truncate rather than reject: a long label is still a usable label. */
function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** An id-like string: same rules as an agent id, or null. */
function readId(value: unknown): string | null {
  return typeof value === "string" && isAgentId(value) ? value : null;
}

/** Bounded metadata: dropped entirely when too many keys or too large. */
function boundedMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (Object.keys(value).length > MAX_METADATA_KEYS) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json.length > MAX_METADATA_BYTES) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return value;
}

function readColor(record: Record<string, unknown>): string | null {
  const value = record.color;
  if (typeof value !== "string") return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function readText(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = readString(record, key);
  if (value === null || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return value;
}

/**
 * One announced agent profile. Malformed profiles are dropped by the caller;
 * an unknown role still gets a rig (the engineer rig), and a live agent's
 * colour always comes from the id hash so two same-role agents differ.
 */
export function parseAgentProfile(value: unknown): AgentProfile | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  if (id === null || id.length > MAX_AGENT_ID_LENGTH || !isAgentId(id)) {
    return null;
  }

  const name = readText(value, "name", 80);
  if (name === null) return null;

  const rawRole = readString(value, "role");
  if (rawRole === null) return null;
  const role = normaliseAgentRole(rawRole);
  const rawRoleLabel = readText(value, "roleLabel", 60);
  const rawTagline = readText(value, "tagline", 160);
  const kind = readEnum<AgentProfile["kind"]>(
    value.kind,
    new Set(["core", "live"]),
  );

  const rawHome = value.home;
  let home: LocationId | undefined;
  if (rawHome !== undefined && rawHome !== null) {
    const parsed = readEnum<LocationId>(rawHome, LOCATION_IDS);
    if (parsed === null) return null;
    home = parsed;
  }

  const seat = readFiniteNumber(value, "seat");
  const isCoreId = CORE_AGENT_IDS.includes(id);
  // Kind is decided by the id alone: a backend cannot mint a core agent or
  // claim a core id as live.
  if (kind === "live" && isCoreId) return null;
  if (kind === "core" && !isCoreId) return null;
  const resolvedKind: AgentProfile["kind"] = isCoreId ? "core" : "live";
  // Live colours are a client-side identity: always the id hash, never a
  // backend-provided colour that could collide with another agent.
  const color =
    resolvedKind === "live"
      ? colorForAgent(id)
      : (readColor(value) ?? colorForAgent(id));

  return {
    id,
    name,
    role,
    roleLabel:
      rawRoleLabel ??
      role
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    tagline: rawTagline ?? "Announced by the backend",
    color,
    ...(home === undefined ? {} : { home }),
    seat: seat === null ? 0 : Math.max(0, Math.min(63, Math.trunc(seat))),
    kind: resolvedKind,
  };
}

/**
 * Parse the profile list. Returns null only when the field itself is the
 * wrong shape; individual malformed profiles are dropped defensively.
 */
function parseProfiles(value: unknown): AgentProfile[] | null {
  if (value === undefined) return CORE_AGENTS.map((profile) => ({ ...profile }));
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_AGENTS * 2) return null;

  const profiles: AgentProfile[] = [];
  const seen = new Set<AgentId>();
  for (const raw of value) {
    const parsed = parseAgentProfile(raw);
    if (parsed === null) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    profiles.push(parsed);
  }
  return profiles;
}

function parseAgentState(value: unknown): AgentState | null {
  if (!isRecord(value)) return null;

  const id = readId(value.id);
  if (id === null) return null;

  const status = readEnum<AgentStatus>(value.status, AGENT_STATUSES);
  if (status === null) return null;

  const rawActivity = readString(value, "activity");
  if (rawActivity === null) return null;
  const activity = truncate(rawActivity, MAX_ACTIVITY_LENGTH);

  const rawTaskId = value.currentTaskId;
  let currentTaskId: string | null;
  if (rawTaskId === null) {
    currentTaskId = null;
  } else {
    currentTaskId = readId(rawTaskId);
    if (currentTaskId === null) return null;
  }

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
  if (heading === null || Math.abs(heading) > 1e4) return null;

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
  const id = readId(value.id);
  const title = readString(value, "title");
  const done = readBoolean(value, "done");
  if (id === null || title === null || done === null) return null;
  return { id, title: truncate(title, MAX_TITLE_LENGTH), done };
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

  const id = readId(value.id);
  const rawTitle = readString(value, "title");
  const rawDescription = readString(value, "description");
  if (id === null || rawTitle === null || rawDescription === null) return null;
  const title = truncate(rawTitle, MAX_TITLE_LENGTH);
  const description = truncate(rawDescription, MAX_DESCRIPTION_LENGTH);

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
    findings.push(truncate(raw, MAX_FINDING_LENGTH));
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
    blockedReason = truncate(rawBlocked, MAX_REASON_LENGTH);
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
  const id = readId(value.id);
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
  if (value.agents.length > MAX_RAW_AGENTS) return null;
  if (value.tasks.length > MAX_TASKS) return null;
  if (value.links.length > MAX_LINKS) return null;

  const profiles = parseProfiles(value.profiles);
  if (profiles === null) return null;
  const announced = new Set<AgentId>(profiles.map((profile) => profile.id));
  const core = new Set<AgentId>(CORE_AGENT_IDS);

  // Agents are a live roster, so one bad or unknown entry only drops that
  // entry. Duplicates are ignored and the live count is capped at 64.
  const agents: AgentState[] = [];
  const agentIds = new Set<AgentId>();
  let liveCount = 0;
  for (const raw of value.agents) {
    const parsed = parseAgentState(raw);
    if (parsed === null) continue;
    if (agentIds.has(parsed.id)) continue;
    if (!core.has(parsed.id) && !announced.has(parsed.id)) continue;
    if (!core.has(parsed.id)) {
      if (liveCount >= MAX_LIVE_AGENTS) continue;
      liveCount += 1;
    }
    agentIds.add(parsed.id);
    agents.push(parsed);
  }

  const tasks: Task[] = [];
  for (const raw of value.tasks) {
    const parsed = parseTask(raw);
    if (parsed !== null) tasks.push(parsed);
  }

  const links: CommLink[] = [];
  for (const raw of value.links) {
    const parsed = parseCommLink(raw);
    if (parsed !== null) links.push(parsed);
  }

  return { clock, status, speed, profiles, agents, tasks, links };
}

export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value)) return null;
  const id = readId(value.id);
  const type = readEnum<AgentEventType>(value.type, EVENT_TYPES_SET);
  const timestamp = readFiniteNumber(value, "timestamp");
  const simTime = readFiniteNumber(value, "simTime");
  const rawMessage = readString(value, "message");
  const message =
    rawMessage === null ? null : truncate(rawMessage, MAX_EVENT_MESSAGE_LENGTH);
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
    const checked = readId(rawTaskId);
    if (checked === null) return null;
    taskId = checked;
  }

  const rawMetadata = value.metadata;
  let metadata: Record<string, unknown> | undefined;
  if (rawMetadata !== undefined) {
    if (!isRecord(rawMetadata)) return null;
    metadata = boundedMetadata(rawMetadata);
  }

  const lifecycle = type === "agent.spawned" || type === "agent.despawned";
  const resolvedSeverity: EventSeverity =
    type === "agent.despawned"
      ? metadata?.outcome === "error"
        ? "error"
        : "success"
      : severity;

  return {
    id,
    type,
    timestamp,
    simTime,
    message,
    severity: resolvedSeverity,
    feed: lifecycle ? true : feed,
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
  // UTF-16 units undercount multi-byte text, so measure real UTF-8 bytes.
  // length * 3 is a cheap upper bound that skips encoding small frames.
  const byteLength =
    raw.length * 3 <= MAX_MESSAGE_BYTES
      ? raw.length
      : new TextEncoder().encode(raw).length;
  if (byteLength > MAX_MESSAGE_BYTES) {
    return invalid(
      `ignoring a ${Math.round(byteLength / 1024)} KiB message from the backend (limit ${MAX_MESSAGE_BYTES / 1024} KiB)`,
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
