/**
 * Pure mapping from a validated Claude Code hook to the shared live stage.
 * No I/O, no logging and no raw payload values beyond the short, redacted
 * activity text that the UI is meant to show.
 */
import type { AgentProfile, AgentRole } from "../src/agents/agentTypes.ts";
import { colorForAgent } from "../src/agents/agentPalette.ts";
import { LiveStage } from "../src/simulation/liveStage.ts";
import type { HookPayload } from "./hooks.ts";
import { redact, summaryFromMessage, toolTarget, truncate } from "./redact.ts";

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
}

export function createMappingState(): BridgeMappingState {
  return {
    startedSessions: new Set<string>(),
    descriptions: new Map<string, string[]>(),
    ordinals: new Map<string, number>(),
    lastSeen: new Map<string, number>(),
    sessionAgents: new Map<string, Set<string>>(),
    agentSession: new Map<string, string>(),
  };
}

export function resetMappingState(state: BridgeMappingState): void {
  state.startedSessions.clear();
  state.descriptions.clear();
  state.ordinals.clear();
  state.lastSeen.clear();
  state.sessionAgents.clear();
  state.agentSession.clear();
}

const ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: "Orchestrator",
  researcher: "Researcher",
  product_manager: "Product Manager",
  engineer: "Software Engineer",
  qa: "QA Engineer",
  reviewer: "Code Reviewer",
};

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

function setOrion(stage: LiveStage, activity: string, status: "thinking" | "working" | "idle"): void {
  stage.setActivity("orion", activity, status);
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

/** Drop an agent from the session and reaper bookkeeping. */
export function forgetAgent(state: BridgeMappingState, agentId: string): void {
  const sessionId = state.agentSession.get(agentId);
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
): void {
  stage.setStatus("running");
  setOrion(stage, "Claude Code session started", "thinking");
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
  const agents = state.sessionAgents.get(payload.sessionId);
  if (agents !== undefined) {
    for (const id of agents) {
      stage.finish(id, "success");
      forgetAgent(state, id);
    }
    state.sessionAgents.delete(payload.sessionId);
  }
  setOrion(stage, "Idle", "idle");
}

function handleMainTool(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
): void {
  const target = toolTarget(payload.toolName ?? "tool", payload.toolInput, payload.cwd);
  setOrion(stage, `Tool: ${target}`, "working");
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

  const key = typeKey(payload.agentType);
  const ordinal = (state.ordinals.get(key) ?? 0) + 1;

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
  state.ordinals.delete(key);
  if (state.ordinals.size >= MAX_ORDINAL_KEYS) {
    const oldest = state.ordinals.keys().next();
    if (oldest.done !== true) state.ordinals.delete(oldest.value);
  }
  state.ordinals.set(key, ordinal);

  trackAgent(state, payload.sessionId, payload.agentId);
  state.lastSeen.set(payload.agentId, now);

  const description = takeAgentDescription(state, payload.agentType);
  stage.setActivity(
    payload.agentId,
    description ?? `Started as ${payload.agentType}`,
    "thinking",
  );
  stage.link("orion", payload.agentId, "assign");
}

function handleSubagentStop(
  stage: LiveStage,
  state: BridgeMappingState,
  payload: HookPayload,
): void {
  if (payload.agentId === null) return;
  if (payload.agentType === null || payload.agentType.length === 0) return;
  if (!stage.has(payload.agentId)) return;

  const summary = summaryFromMessage(payload.lastAssistantMessage);
  stage.finish(
    payload.agentId,
    "success",
    summary === null ? {} : { activity: summary },
  );
  stage.link(payload.agentId, "orion", "report");
  forgetAgent(state, payload.agentId);
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
      handleSessionStart(stage, state, payload);
      return;
    case "SessionEnd":
      handleSessionEnd(stage, state, payload);
      return;
    case "UserPromptSubmit":
      return;
    case "PreToolUse":
      if (payload.agentId === null) {
        handleMainTool(stage, state, payload);
      } else if (stage.has(payload.agentId)) {
        state.lastSeen.set(payload.agentId, now);
        const target = toolTarget(
          payload.toolName ?? "tool",
          payload.toolInput,
          payload.cwd,
        );
        stage.setActivity(payload.agentId, `Tool: ${target}`, "working");
      }
      return;
    case "PostToolUse":
      if (payload.agentId !== null && stage.has(payload.agentId)) {
        state.lastSeen.set(payload.agentId, now);
        stage.setStatusFor(payload.agentId, "thinking");
      }
      return;
    case "PostToolUseFailure":
      if (payload.agentId !== null && stage.has(payload.agentId)) {
        state.lastSeen.set(payload.agentId, now);
        const tool = truncate(payload.toolName ?? "tool", 40);
        stage.setActivity(payload.agentId, `Tool failed: ${tool}`, "working");
        stage.emit("agent.message", `Tool failed: ${tool}`, {
          agentId: payload.agentId,
          severity: "warning",
          feed: true,
        });
      }
      return;
    case "SubagentStart":
      handleSubagentStart(stage, state, payload, now);
      return;
    case "SubagentStop":
      handleSubagentStop(stage, state, payload);
      return;
    case "Stop":
      setOrion(stage, "Idle", "idle");
      return;
  }
}
