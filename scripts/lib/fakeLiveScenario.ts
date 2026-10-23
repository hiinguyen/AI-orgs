/**
 * Scenario helpers for the fake live backend (scripts/fake-live-server.ts).
 * Everything here is pure: it builds profiles, agent states, events and
 * snapshots from plain values. The server keeps the sockets, the command
 * handling and the tick loop, which need its closure.
 */
import type {
  AgentId,
  AgentProfile,
  AgentState,
  Vec2,
} from "../../src/agents/agentTypes.ts";
import { CORE_AGENTS } from "../../src/agents/AgentRegistry.ts";
import { colorForAgent } from "../../src/agents/agentPalette.ts";
import type { AgentEvent, EventSeverity } from "../../src/events/eventTypes.ts";
import type {
  CommLink,
  SimulationStatus,
  WorldSnapshot,
} from "../../src/integrations/AgentBackend.ts";
import { headingFor, slotFor } from "../../src/simulation/worldLayout.ts";
import type { Task } from "../../src/tasks/taskTypes.ts";

export const LIVE_ROLES = [
  "researcher",
  "product_manager",
  "engineer",
  "qa",
  "reviewer",
] as const;

export type LiveRole = (typeof LIVE_ROLES)[number];

export interface LiveAgent {
  id: AgentId;
  profile: AgentProfile;
  state: AgentState;
  phase: "walk-to-bay" | "work" | "emote" | "walk-home" | "fade";
  timer: number;
  bay: number | null;
  waiting: boolean;
  spawnedAt: number;
  outcome: "success" | "error";
  path: Vec2[];
  target: Vec2;
  linkAt: number;
}

export interface AgentEventExtra {
  agentId?: AgentId;
  targetAgentId?: AgentId;
  severity?: EventSeverity;
  feed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SnapshotInput {
  clock: number;
  status: SimulationStatus;
  speed: number;
  paused: boolean;
  live: readonly LiveAgent[];
  links: readonly CommLink[];
}

const LIVE_ROLE_LABELS: Record<LiveRole, string> = {
  researcher: "Researcher",
  product_manager: "Product Manager",
  engineer: "Software Engineer",
  qa: "QA Engineer",
  reviewer: "Code Reviewer",
};

/**
 * Role for the nth spawn (1-based). The first burst is four agents of the same
 * role, the case that used to collapse into one robot before phase 9.
 */
export function roleForSpawn(spawnSeq: number): LiveRole {
  return spawnSeq <= 4 ? "reviewer" : LIVE_ROLES[spawnSeq % LIVE_ROLES.length];
}

/** Profile for the nth spawn. */
export function liveProfileFor(spawnSeq: number): AgentProfile {
  const role = roleForSpawn(spawnSeq);
  const id = `live-${String(spawnSeq).padStart(2, "0")}`;
  return {
    id,
    name:
      role === "reviewer"
        ? `code-reviewer #${spawnSeq}`
        : `${role.replaceAll("_", "-")} #${spawnSeq}`,
    role,
    roleLabel: LIVE_ROLE_LABELS[role],
    tagline: "Live subagent over the fake WebSocket backend",
    color: colorForAgent(id),
    seat: spawnSeq % 6,
    kind: "live",
  };
}

/** A freshly spawned agent, standing at the hub and not yet walking. */
export function createLiveAgent(
  profile: AgentProfile,
  spawnedAt: number,
): LiveAgent {
  const hub = slotFor("hub", 0);
  const state: AgentState = {
    id: profile.id,
    status: "idle",
    activity: "Arrived at the Operations Hub",
    currentTaskId: null,
    progress: 0,
    location: "hub",
    destination: null,
    position: { x: hub.x, z: hub.z },
    heading: headingFor("hub", 0),
    path: [],
    facingAgentId: null,
    paused: false,
  };
  return {
    id: profile.id,
    profile,
    state,
    phase: "walk-to-bay",
    timer: 0,
    bay: null,
    waiting: false,
    spawnedAt,
    outcome: "success",
    path: [],
    target: hub,
    linkAt: 0,
  };
}

/** Move a point along a routed path at `speed`, returning the consumed step. */
export function advance(
  position: Vec2,
  path: Vec2[],
  budget: number,
): { moved: number; heading: number | null } {
  let remaining = budget;
  let moved = 0;
  let heading: number | null = null;
  while (remaining > 1e-7 && path.length > 0) {
    const next = path[0];
    const dx = next.x - position.x;
    const dz = next.z - position.z;
    const step = Math.hypot(dx, dz);
    if (step <= 1e-7) {
      path.shift();
      continue;
    }
    heading = Math.atan2(dx, dz);
    if (step <= remaining) {
      position.x = next.x;
      position.z = next.z;
      path.shift();
      remaining -= step;
      moved += step;
    } else {
      const ratio = remaining / step;
      position.x += dx * ratio;
      position.z += dz * ratio;
      moved += remaining;
      remaining = 0;
    }
  }
  return { moved, heading };
}

/** Event for the live feed. `seq` is the server's running event counter. */
export function buildAgentEvent(
  seq: number,
  clock: number,
  type: AgentEvent["type"],
  message: string,
  extra: AgentEventExtra = {},
): AgentEvent {
  return {
    id: `live-evt-${seq}`,
    type,
    timestamp: Date.now(),
    simTime: Math.round(clock * 1000) / 1000,
    message,
    severity: extra.severity ?? "info",
    feed: extra.feed ?? true,
    ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
    ...(extra.targetAgentId === undefined
      ? {}
      : { targetAgentId: extra.targetAgentId }),
    ...(extra.metadata === undefined ? {} : { metadata: extra.metadata }),
  };
}

function coreState(profile: AgentProfile): AgentState {
  const home = profile.home ?? "hub";
  const slot = slotFor(home, profile.seat);
  return {
    id: profile.id,
    status: "idle",
    activity: `${profile.name} is idle`,
    currentTaskId: null,
    progress: 0,
    location: home,
    destination: null,
    position: { x: slot.x, z: slot.z },
    heading: headingFor(home, profile.seat),
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

/** Full world snapshot: the core roster plus the live agents and open links. */
export function buildWorldSnapshot(input: SnapshotInput): WorldSnapshot {
  return {
    clock: Math.round(input.clock * 1000) / 1000,
    status: input.status,
    speed: input.speed,
    profiles: [
      ...CORE_AGENTS.map((profile) => ({ ...profile })),
      ...input.live.map((agent) => ({ ...agent.profile })),
    ],
    agents: [
      ...CORE_AGENTS.map((profile) => coreState(profile)),
      ...input.live.map((agent) => ({
        ...agent.state,
        position: { ...agent.state.position },
        path: agent.state.path.map((point) => ({ ...point })),
        paused: agent.state.paused || input.paused,
      })),
    ],
    tasks: [],
    links: input.links
      .filter((link) => link.endsAt > input.clock)
      .map((link) => ({ ...link })),
  };
}

export function taskFixture(): Task {
  return {
    id: "T-001",
    title: "Fake live task",
    description: "A placeholder returned by the fake live server.",
    priority: "medium",
    status: "queued",
    phase: "queued",
    assignedAgentId: null,
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    iteration: 0,
    subtasks: [],
    findings: [],
    history: [],
    isDemo: false,
    preferredAgentId: null,
    blockedReason: null,
  };
}
