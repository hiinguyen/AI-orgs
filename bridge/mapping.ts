/**
 * Pure mapping from a validated Claude Code hook to the shared live stage.
 * No I/O, no logging and no raw payload values beyond the short, redacted
 * activity text and task titles that the UI is meant to show.
 */
import { CORE_AGENT_IDS } from "../src/agents/agentTypes.ts";
import type { AgentId, AgentProfile, AgentRole, AgentStatus } from "../src/agents/agentTypes.ts";
import { colorForAgent } from "../src/agents/agentPalette.ts";
import { CORE_AGENTS } from "../src/agents/AgentRegistry.ts";
import { LiveStage } from "../src/simulation/liveStage.ts";
import type { HookPayload } from "./hooks.ts";
import { redact, summaryFromMessage, toolTarget, truncate } from "./redact.ts";
import type { WorkflowPhase } from "../src/tasks/taskTypes.ts";

const ORION: AgentId = "orion";

/** How long a core agent shows a finished subagent's success. */
const SUCCESS_FLASH_MS = 2500;
/** How long a core agent shows a lost or failed subagent's error. */
const ERROR_FLASH_MS = 2500;
/** How long a core agent shows a failed tool call. */
const TOOL_FAILURE_FLASH_MS = 1500;

/** Core agent that mirrors the live agents of each role, from the registry. */
export const CORE_AGENT_FOR_ROLE: Record<AgentRole, AgentId> = coreAgentForRole();

function coreAgentForRole(): Record<AgentRole, AgentId> {
  const find = (role: AgentRole): AgentId => {
    const profile = CORE_AGENTS.find(
      (core) => core.role === role && CORE_AGENT_IDS.includes(core.id),
    );
    if (profile === undefined) throw new Error(`no core agent for role ${role}`);
    return profile.id;
  };
  return {
    orchestrator: find("orchestrator"),
    researcher: find("researcher"),
    product_manager: find("product_manager"),
    engineer: find("engineer"),
    qa: find("qa"),
    reviewer: find("reviewer"),
  };
}

export interface BridgeMappingState {
  /** Sessions that already produced system.started. */
  startedSessions: Set<string>;
  /** Agent descriptions waiting for the next matching subagent type. */
  descriptions: Map<string, string[]>;
  /** Spawn ordinal per agent type, so names stay unique. */
  ordinals: Map<string, number>;
  /** Wall-clock time of the last hook per live agent, for the reaper. */
  lastSeen: Map<string, number>;
  /** Session to its live agent ids, so SessionEnd can close them. */
  sessionAgents: Map<string, Set<string>>;
  /** Reverse lookup used when an agent stops. */
  agentSession: Map<string, string>;
  /** Role of every tracked live agent, to find the core agent it mirrors. */
  agentRole: Map<string, AgentRole>;
  /** Core id to the live agent ids currently mirrored onto it. */
  coreOwners: Map<AgentId, Set<string>>;
  /** Live agent to the task it is working on. */
  agentTasks: Map<string, string>;
  /** Session to the task opened by its current prompt. */
  sessionTasks: Map<string, string>;
}

export function createMappingState(): BridgeMappingState {
  return {
    startedSessions: new Set<string>(),
    descriptions: new Map<string, string[]>(),
    ordinals: new Map<string, number>(),
    lastSeen: new Map<string, number>(),
    sessionAgents: new Map<string, Set<string>>(),
    agentSession: new Map<string, string>(),
    agentRole: new Map<string, AgentRole>(),
    coreOwners: new Map<AgentId, Set<string>>(),
    agentTasks: new Map<string, string>(),
    sessionTasks: new Map<string, string>(),
  };
}

export function resetMappingState(state: BridgeMappingState): void {
  state.startedSessions.clear();
  state.descriptions.clear();
  state.ordinals.clear();
  state.lastSeen.clear();
  state.sessionAgents.clear();
  state.agentSession.clear();
  state.agentRole.clear();
  state.coreOwners.clear();
  state.agentTasks.clear();
  state.sessionTasks.clear();
}

const ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: "Orchestrator",
  researcher: "Researcher",
  product_manager: "Product Manager",
  engineer: "Software Engineer",
  qa: "QA Engineer",
  reviewer: "Code Reviewer",
};

/** The workflow phase a role's live work belongs to. */
const PHASE_FOR_ROLE: Record<AgentRole, WorkflowPhase> = {
  orchestrator: "intake",
  researcher: "research",
  product_manager: "planning",
  engineer: "implementation",
  qa: "testing",
  reviewer: "review",
};

/** Longest prompt-derived task title; the redacted prompt is cut to this. */
const MAX_LIVE_TASK_TITLE = 80;

/**
 * Role from a Claude Code subagent type, case insensitive, first match wins.
 * Unknown types become engineers so every subagent still gets a robot.
 */
export function roleForAgentType(agentType: string): AgentRole {
  const type = agentType.toLowerCase();
  if (type.includes("review") || type.includes("audit")) return "reviewer";
  if (
    type.includes("test") ||
    type.includes("tdd") ||
    type.includes("e2e") ||
    type.includes("qa")
  ) {
    return "qa";
  }
  if (
    type.includes("plan") ||
    type.includes("architect") ||
    type.includes("design")
  ) {
    return "product_manager";
  }
  if (
    type.includes("explor") ||
    type.includes("research") ||
    type.includes("docs") ||
    type.includes("lookup") ||
    type.includes("scout")
  ) {
    return "researcher";
  }
  return "engineer";
}

/** Longest subagent_type we remember a description for. */
export const MAX_DESCRIPTION_KEY_LENGTH = 120;
/** Most distinct subagent types with queued descriptions. */
export const MAX_DESCRIPTION_KEYS = 32;
/** Most session ids remembered for the one-time system.started event. */
export const MAX_STARTED_SESSIONS = 64;
/**
 * Most agent types with a remembered ordinal. Above the live agent cap, so
 * evicting the oldest type cannot reuse a name among live agents in practice.
 */
export const MAX_ORDINAL_KEYS = 128;

function typeKey(agentType: string): string {
  return agentType.trim().toLowerCase();
}

/** Queue the description of a main-conversation Agent/Task call. */
export function rememberAgentDescription(
  state: BridgeMappingState,
  subagentType: string,
  description: string,
): void {
  const key = typeKey(subagentType);
  if (key.length === 0 || key.length > MAX_DESCRIPTION_KEY_LENGTH) return;
  const masked = redact(description);
  if (masked.length === 0) return;
  const queue = state.descriptions.get(key) ?? [];
  queue.push(truncate(masked, 80));
  // A long queue is stale; the next starts are the only ones that matter.
  if (queue.length > 8) queue.shift();
  if (!state.descriptions.has(key) && state.descriptions.size >= MAX_DESCRIPTION_KEYS) {
    const oldest = state.descriptions.keys().next();
    if (oldest.done !== true) state.descriptions.delete(oldest.value);
  }
  state.descriptions.set(key, queue);
}

/** Pop the oldest remembered description for this subagent type. */
export function takeAgentDescription(
  state: BridgeMappingState,
  subagentType: string,
): string | null {
  const key = typeKey(subagentType);
  const queue = state.descriptions.get(key);
  if (queue === undefined || queue.length === 0) return null;
  const value = queue.shift() ?? null;
  if (queue.length === 0) state.descriptions.delete(key);
  return value;
}

/** Longest working directory folder name used in a session robot name. */
const MAX_SESSION_LABEL_LENGTH = 40;
const SESSION_ORDINAL_PREFIX = "session:";

/**
 * Next spawn ordinal for a key. Nothing is stored until `commitOrdinal`, so a
 * spawn dropped at the live cap does not consume a number.
 */
function nextOrdinal(state: BridgeMappingState, key: string): number {
  return (state.ordinals.get(key) ?? 0) + 1;
}

function commitOrdinal(
  state: BridgeMappingState,
  key: string,
  ordinal: number,
): void {
  state.ordinals.delete(key);
  if (state.ordinals.size >= MAX_ORDINAL_KEYS) {
    const oldest = state.ordinals.keys().next();
    if (oldest.done !== true) state.ordinals.delete(oldest.value);
  }
  state.ordinals.set(key, ordinal);
}

function folderLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  const last = parts[parts.length - 1] ?? "";
  const masked = truncate(redact(last), MAX_SESSION_LABEL_LENGTH);
  return masked.length > 0 ? masked : "session";
}

/** Title for a prompt task: the redacted prompt, cut to one short line. */
function promptTitle(prompt: string | null): string | null {
  if (prompt === null) return null;
  const masked = truncate(redact(prompt), MAX_LIVE_TASK_TITLE);
  return masked.length > 0 ? masked : null;
}

/**
 * Open the task for a new prompt. A prompt is one turn of session work, so a
 * previous task that never saw Stop is closed first instead of left running.
 */
function startSessionTask(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  actor: AgentId,
): void {
  const previous = state.sessionTasks.get(payload.sessionId);
  if (previous !== undefined) {
    stage.finishTask(previous, "success");
    state.sessionTasks.delete(payload.sessionId);
  }
  const title =
    promptTitle(payload.prompt) ?? "Claude Code session work";
  const task = stage.startTask({
    title,
    description: `Live Claude Code session in ${folderLabel(payload.cwd)}`,
    phase: "intake",
    owner: actor,
  });
  state.sessionTasks.set(payload.sessionId, task.id);
  stage.emit("task.created", `New live task: ${title}`, {
    taskId: task.id,
    agentId: actor,
    severity: "info",
    feed: true,
  });
}

/**
 * The session task, created on first use when the prompt hook carried no
 * prompt (or never ran). Never opens a second task for one turn.
 */
function ensureSessionTask(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  actor: AgentId,
): string | null {
  const existing = state.sessionTasks.get(payload.sessionId);
  if (existing !== undefined && stage.getTask(existing) !== null) {
    stage.touchTask(existing);
    return existing;
  }
  startSessionTask(stage, state, payload, actor);
  return state.sessionTasks.get(payload.sessionId) ?? null;
}

/** Close the session task and forget its mapping. */
function finishSessionTask(
  stage: LiveStage,
  state: BridgeMappingState,
  sessionId: string,
  outcome: "success" | "error",
): void {
  const taskId = state.sessionTasks.get(sessionId);
  if (taskId === undefined) return;
  stage.finishTask(taskId, outcome);
  state.sessionTasks.delete(sessionId);
}

/** Close a subagent's task and forget its mapping. */
function finishAgentTask(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
  outcome: "success" | "error",
): void {
  const taskId = state.agentTasks.get(agentId);
  if (taskId === undefined) return;
  stage.finishTask(taskId, outcome);
  state.agentTasks.delete(agentId);
}

/** Keep the session's task fresh while a main-agent tool call runs. */
function touchSessionTask(
  stage: LiveStage,
  state: BridgeMappingState,
  sessionId: string,
): void {
  const taskId = state.sessionTasks.get(sessionId);
  if (taskId !== undefined) stage.touchTask(taskId);
}

/** Keep the owner's task fresh while a tool call starts or ends. */
function touchAgentTask(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
): void {
  const taskId = state.agentTasks.get(agentId);
  if (taskId !== undefined) stage.touchTask(taskId);
}

/**
 * The live robot of a Claude Code session, spawned on first use so a bridge
 * restarted mid-session still catches up. Falls back to Orion when the live
 * cap is full.
 */
function sessionActor(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): AgentId {
  const id = payload.sessionId;
  if (isOwnRobot(stage, state, id)) {
    state.lastSeen.set(id, now);
    return id;
  }
  // A core id, an unrelated live agent or a departing robot: never spawn.
  if (stage.has(id) || CORE_AGENT_IDS.includes(id)) return ORION;
  const key = `${SESSION_ORDINAL_PREFIX}${folderLabel(payload.cwd).toLowerCase()}`;
  const ordinal = nextOrdinal(state, key);
  const profile: AgentProfile = {
    id,
    name: `${folderLabel(payload.cwd)} #${ordinal}`,
    role: "orchestrator",
    roleLabel: ROLE_LABELS.orchestrator,
    tagline: "Live Claude Code session",
    color: colorForAgent(id),
    seat: (ordinal - 1) % 6,
    kind: "live",
  };
  if (stage.spawn(profile, { workSeconds: 0 }) === null) return ORION;
  commitOrdinal(state, key, ordinal);
  trackAgent(state, id, id);
  registerMirror(stage, state, id, profile.role);
  state.lastSeen.set(id, now);
  return id;
}

/** The session robot if it exists, otherwise Orion. Never spawns. */
function findSessionActor(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
): AgentId {
  return isOwnRobot(stage, state, payload.sessionId) ? payload.sessionId : ORION;
}

/** True when the live agent with this id is the tracked robot of that session. */
function isOwnRobot(
  stage: LiveStage,
  state: BridgeMappingState,
  sessionId: string,
): boolean {
  return state.agentSession.get(sessionId) === sessionId && stage.has(sessionId);
}

/** Keep a session robot from being reaped while its subagents are active. */
function touchSession(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  if (isOwnRobot(stage, state, payload.sessionId)) {
    state.lastSeen.set(payload.sessionId, now);
  }
}

function isAgentTool(toolName: string | null): boolean {
  if (toolName === null) return false;
  const lower = toolName.toLowerCase();
  return lower === "agent" || lower === "task";
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function trackAgent(
  state: BridgeMappingState,
  sessionId: string,
  agentId: string,
): void {
  state.agentSession.set(agentId, sessionId);
  const agents = state.sessionAgents.get(sessionId) ?? new Set<string>();
  agents.add(agentId);
  state.sessionAgents.set(sessionId, agents);
}

/**
 * Register a live agent as an owner of the core agent for its role. The
 * first owner of a role with a board (product_manager -> Piper, researcher
 * -> Iris) sends that core agent walking to it.
 */
function registerMirror(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
  role: AgentRole,
): void {
  const coreId = CORE_AGENT_FOR_ROLE[role];
  state.agentRole.set(agentId, role);
  const owners = state.coreOwners.get(coreId) ?? new Set<string>();
  const wasEmpty = owners.size === 0;
  owners.add(agentId);
  state.coreOwners.set(coreId, owners);
  if (wasEmpty) stage.sendCoreToBoard(coreId);
}

/** Core agent mirroring this live agent, or null when it is not registered. */
function mirrorTarget(state: BridgeMappingState, agentId: string): AgentId | null {
  const role = state.agentRole.get(agentId);
  return role === undefined ? null : CORE_AGENT_FOR_ROLE[role];
}

/** Stop mirroring an agent; the core agent goes idle with its last owner. */
function releaseMirror(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
): void {
  const coreId = mirrorTarget(state, agentId);
  state.agentRole.delete(agentId);
  if (coreId === null) return;
  const owners = state.coreOwners.get(coreId);
  if (owners === undefined) return;
  owners.delete(agentId);
  if (owners.size > 0) return;
  state.coreOwners.delete(coreId);
  setCoreIdle(stage, coreId);
  stage.sendCoreHome(coreId);
}

/** Put a core agent back to its default idle activity. */
function setCoreIdle(stage: LiveStage, coreId: AgentId): void {
  const core = CORE_AGENTS.find((profile) => profile.id === coreId);
  if (core !== undefined) stage.setActivity(coreId, `${core.name} is idle`, "idle");
}

/** True while a live agent of this role mirrors onto the core agent. */
function hasMirrorOwners(state: BridgeMappingState, coreId: AgentId): boolean {
  return (state.coreOwners.get(coreId)?.size ?? 0) > 0;
}

/**
 * Update a live agent and the core agent that mirrors its role. A null
 * activity changes only the status. Several owners of a role are last-writer-
 * wins (text and status may come from different owners on status-only updates).
 */
function setLiveActivity(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: AgentId,
  activity: string | null,
  status: AgentStatus,
): void {
  const coreId = mirrorTarget(state, agentId);
  if (activity === null) {
    stage.setStatusFor(agentId, status);
    if (coreId !== null) stage.setStatusFor(coreId, status);
    return;
  }
  stage.setActivity(agentId, activity, status);
  if (coreId !== null) stage.setActivity(coreId, activity, status);
}

/**
 * Flash the core agent mirroring this live agent with a transient outcome.
 * Must run before `releaseMirror`, which forgets the role. No-op when the
 * agent is not mirrored; a core agent acting for itself (the Orion fallback
 * driver) is flashed directly.
 */
function flashOutcome(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
  status: "success" | "error",
  text: string,
  durationMs: number,
): void {
  const coreId =
    mirrorTarget(state, agentId) ??
    (CORE_AGENT_IDS.includes(agentId) ? agentId : null);
  if (coreId !== null) stage.flashCore(coreId, status, text, durationMs);
}

/** A human-readable name for a core or live agent id, for event messages. */
function displayName(stage: LiveStage, id: AgentId): string {
  return (
    CORE_AGENTS.find((core) => core.id === id)?.name ??
    stage.getAgent(id)?.profile.name ??
    id
  );
}

/** Drop an agent from the session, reaper and core mirror bookkeeping. */
export function forgetAgent(
  stage: LiveStage,
  state: BridgeMappingState,
  agentId: string,
): void {
  // An agent finished as an error (for example "Lost contact") flashes its
  // core agent here, the one path every finish goes through.
  const finished = stage.getAgent(agentId);
  if (finished !== null && finished.outcome === "error") {
    flashOutcome(
      stage,
      state,
      agentId,
      "error",
      finished.state.activity,
      ERROR_FLASH_MS,
    );
  }
  releaseMirror(stage, state, agentId);
  const sessionId = state.agentSession.get(agentId);
  const isSessionRobot = sessionId === agentId;
  // A session robot that leaves quietly still completed its work; any other
  // agent without an outcome is treated as lost.
  const outcome: "success" | "error" =
    finished?.outcome ?? (isSessionRobot ? "success" : "error");
  finishAgentTask(stage, state, agentId, outcome);
  if (isSessionRobot) finishSessionTask(stage, state, agentId, outcome);
  state.agentSession.delete(agentId);
  state.lastSeen.delete(agentId);
  if (sessionId === undefined) return;
  const agents = state.sessionAgents.get(sessionId);
  if (agents === undefined) return;
  agents.delete(agentId);
  if (agents.size === 0) state.sessionAgents.delete(sessionId);
}

function handleSessionStart(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  stage.setStatus("running");
  const actor = sessionActor(stage, state, payload, now);
  setLiveActivity(stage, state, actor, "Claude Code session started", "thinking");
  if (state.startedSessions.has(payload.sessionId)) return;
  if (state.startedSessions.size >= MAX_STARTED_SESSIONS) {
    const oldest = state.startedSessions.values().next();
    if (oldest.done !== true) state.startedSessions.delete(oldest.value);
  }
  state.startedSessions.add(payload.sessionId);
  stage.emit("system.started", "Claude Code session started", {
    severity: "info",
    feed: true,
  });
}

function handleSessionEnd(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
): void {
  const hadRobot = isOwnRobot(stage, state, payload.sessionId);
  finishSessionTask(stage, state, payload.sessionId, "success");
  const agents = state.sessionAgents.get(payload.sessionId);
  if (agents !== undefined) {
    for (const id of agents) {
      finishAgentTask(stage, state, id, "success");
      stage.finish(id, "success");
      forgetAgent(stage, state, id);
    }
    state.sessionAgents.delete(payload.sessionId);
  }
  // Orion is only idle when no live session robot still mirrors onto it.
  if (!hadRobot && !hasMirrorOwners(state, ORION)) setCoreIdle(stage, ORION);
}

function handlePrompt(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  const actor = sessionActor(stage, state, payload, now);
  setLiveActivity(stage, state, actor, "Reading a new prompt", "thinking");
  startSessionTask(stage, state, payload, actor);
}

function handleMainTool(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  const target = toolTarget(payload.toolName ?? "tool", payload.toolInput, payload.cwd);
  const actor = sessionActor(stage, state, payload, now);
  ensureSessionTask(stage, state, payload, actor);
  setLiveActivity(stage, state, actor, `Tool: ${target}`, "working");
  if (!isAgentTool(payload.toolName)) return;
  const subagentType = readString(payload.toolInput, "subagent_type");
  const description = readString(payload.toolInput, "description");
  if (subagentType !== null && description !== null) {
    rememberAgentDescription(state, subagentType, description);
  }
}

function handleSubagentStart(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  if (payload.agentId === null) return;
  // Claude Code's own internal agents announce an empty agent_type.
  if (payload.agentType === null || payload.agentType.length === 0) return;
  if (stage.has(payload.agentId)) return;
  // A core id is never a live agent, like a session id (see sessionActor).
  if (CORE_AGENT_IDS.includes(payload.agentId)) return;

  // Spawn the parent first so a bridge restarted mid-session still has it.
  const parent = sessionActor(stage, state, payload, now);
  const key = typeKey(payload.agentType);
  const ordinal = nextOrdinal(state, key);

  const role = roleForAgentType(payload.agentType);
  const name = truncate(`${payload.agentType} #${ordinal}`, 60);
  const profile: AgentProfile = {
    id: payload.agentId,
    name,
    role,
    roleLabel: ROLE_LABELS[role],
    tagline: "Live Claude Code subagent",
    color: colorForAgent(payload.agentId),
    seat: (ordinal - 1) % 6,
    kind: "live",
  };
  const agent = stage.spawn(profile, { workSeconds: 0 });
  if (agent === null) return;
  // Only a spawn that succeeded consumes the ordinal, so names stay gapless.
  commitOrdinal(state, key, ordinal);

  trackAgent(state, payload.sessionId, payload.agentId);
  registerMirror(stage, state, payload.agentId, role);
  state.lastSeen.set(payload.agentId, now);

  const description = takeAgentDescription(state, payload.agentType);
  const task = stage.startTask({
    title:
      description ?? truncate(`${payload.agentType} task`, MAX_LIVE_TASK_TITLE),
    description: `Live ${ROLE_LABELS[role]} subagent in ${folderLabel(payload.cwd)}`,
    phase: PHASE_FOR_ROLE[role],
    owner: payload.agentId,
  });
  state.agentTasks.set(payload.agentId, task.id);
  setLiveActivity(
    stage,
    state,
    payload.agentId,
    description ?? `Started as ${payload.agentType}`,
    "thinking",
  );
  stage.link(parent, payload.agentId, "assign");
  stage.emit(
    "task.assigned",
    `${displayName(stage, parent)} assigned work to ${name}`,
    {
      agentId: parent,
      targetAgentId: payload.agentId,
      taskId: task.id,
      severity: "info",
      feed: true,
    },
  );
}

function handleSubagentStop(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now: number,
): void {
  if (payload.agentId === null) return;
  if (payload.agentType === null || payload.agentType.length === 0) return;
  if (!stage.has(payload.agentId)) return;

  const summary = summaryFromMessage(payload.lastAssistantMessage);
  finishAgentTask(stage, state, payload.agentId, "success");
  const coreId = mirrorTarget(state, payload.agentId);
  const coreName = CORE_AGENTS.find((core) => core.id === coreId)?.name ?? "Agent";
  flashOutcome(
    stage,
    state,
    payload.agentId,
    "success",
    summary ?? `${coreName}: done`,
    SUCCESS_FLASH_MS,
  );
  stage.finish(
    payload.agentId,
    "success",
    summary === null ? {} : { activity: summary },
  );
  const ownerId = state.agentSession.get(payload.agentId);
  const owner = ownerId !== undefined && stage.has(ownerId) ? ownerId : ORION;
  touchSession(stage, state, payload, now);
  stage.link(payload.agentId, owner, "report");
  stage.emit(
    "agent.message",
    `${displayName(stage, payload.agentId)} reported back to ${displayName(stage, owner)}`,
    {
      agentId: payload.agentId,
      targetAgentId: owner,
      severity: "info",
      feed: true,
    },
  );
  forgetAgent(stage, state, payload.agentId);
}

function handleStop(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
): void {
  finishSessionTask(stage, state, payload.sessionId, "success");
  const actor = findSessionActor(stage, state, payload);
  if (actor !== ORION) {
    setLiveActivity(stage, state, actor, "Idle", "idle");
    return;
  }
  // The Orion fallback must not undo a session robot that Orion mirrors.
  if (!hasMirrorOwners(state, ORION)) setCoreIdle(stage, ORION);
}

/** Apply one validated hook. Unknown events have no effect. */
export function applyHook(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
  now = Date.now(),
): void {
  switch (payload.eventName) {
    case "SessionStart":
      handleSessionStart(stage, state, payload, now);
      return;
    case "SessionEnd":
      handleSessionEnd(stage, state, payload);
      return;
    case "UserPromptSubmit":
      handlePrompt(stage, state, payload, now);
      return;
    case "PreToolUse":
      if (payload.agentId === null) {
        handleMainTool(stage, state, payload, now);
      } else if (stage.has(payload.agentId)) {
        touchSession(stage, state, payload, now);
        state.lastSeen.set(payload.agentId, now);
        touchAgentTask(stage, state, payload.agentId);
        const target = toolTarget(
          payload.toolName ?? "tool",
          payload.toolInput,
          payload.cwd,
        );
        setLiveActivity(stage, state, payload.agentId, `Tool: ${target}`, "working");
      }
      return;
    case "PostToolUse":
      touchSession(stage, state, payload, now);
      if (payload.agentId !== null && stage.has(payload.agentId)) {
        state.lastSeen.set(payload.agentId, now);
        touchAgentTask(stage, state, payload.agentId);
        setLiveActivity(stage, state, payload.agentId, null, "thinking");
      } else {
        touchSessionTask(stage, state, payload.sessionId);
      }
      return;
    case "PostToolUseFailure":
      touchSession(stage, state, payload, now);
      // Like the other tool hooks, an agent_id that is not a live robot
      // (including a core id) is ignored rather than attributed elsewhere.
      if (payload.agentId === null || stage.has(payload.agentId)) {
        flashOutcome(
          stage,
          state,
          payload.agentId ?? findSessionActor(stage, state, payload),
          "error",
          "Tool failed",
          TOOL_FAILURE_FLASH_MS,
        );
      }
      if (payload.agentId !== null && stage.has(payload.agentId)) {
        state.lastSeen.set(payload.agentId, now);
        touchAgentTask(stage, state, payload.agentId);
        const tool = truncate(payload.toolName ?? "tool", 40);
        setLiveActivity(stage, state, payload.agentId, `Tool failed: ${tool}`, "working");
        stage.emit("agent.message", `Tool failed: ${tool}`, {
          agentId: payload.agentId,
          severity: "warning",
          feed: true,
        });
      } else {
        touchSessionTask(stage, state, payload.sessionId);
      }
      return;
    case "SubagentStart":
      handleSubagentStart(stage, state, payload, now);
      return;
    case "SubagentStop":
      handleSubagentStop(stage, state, payload, now);
      return;
    case "Stop":
      touchSession(stage, state, payload, now);
      handleStop(stage, state, payload);
      return;
  }
}
