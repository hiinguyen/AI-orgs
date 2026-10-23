import type { AgentId, AgentState } from "@/agents/agentTypes";
import { CORE_AGENT_IDS } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { chestHeight, labelHeight, rigFor } from "@/agents/agentRigs";
import { headingFor, slotFor } from "@/simulation/worldLayout";

/**
 * The rendered pose of each robot after damping, shared by the systems that
 * must attach to what the user actually sees: comm arcs, hit boxes and the
 * label projection. It is rendering state only; the simulation snapshot stays
 * untouched and authoritative.
 *
 * Phase 9: this is an open map. Entries appear when an agent spawns and are
 * released when its despawn animation finishes, so a live session cannot leak
 * one pose object per subagent.
 */
export interface AgentVisualPose {
  x: number;
  z: number;
  heading: number;
  /** Uniform rig scale, so attachments can size themselves. */
  scale: number;
  /** World height of the chest, where comm arcs attach. */
  chestY: number;
  /** World height of the speech-bubble anchor. */
  labelY: number;
}

function initialPose(id: AgentId): AgentVisualPose {
  const profile = getAgentProfile(id);
  const rig = rigFor(profile.role);
  const home = profile.home ?? "hub";
  const slot = slotFor(home, profile.seat);
  return {
    x: slot.x,
    z: slot.z,
    heading: headingFor(home, profile.seat),
    scale: rig.scale,
    chestY: chestHeight(rig) * rig.scale,
    labelY: labelHeight(rig),
  };
}

export const agentVisuals = new Map<AgentId, AgentVisualPose>();

for (const id of CORE_AGENT_IDS) {
  agentVisuals.set(id, initialPose(id));
}

/** The stable live pose object for an id, created on first use. */
export function agentVisualFor(id: AgentId): AgentVisualPose {
  const existing = agentVisuals.get(id);
  if (existing) return existing;
  const created = initialPose(id);
  agentVisuals.set(id, created);
  return created;
}

export function releaseAgentVisual(id: AgentId): void {
  agentVisuals.delete(id);
}

export function resetAgentVisuals(): void {
  agentVisuals.clear();
  for (const id of CORE_AGENT_IDS) {
    agentVisuals.set(id, initialPose(id));
  }
}

/** Linear lookup over the snapshot agents, allocation free. */
export function findAgentState(
  agents: readonly AgentState[] | undefined,
  id: AgentId,
): AgentState | undefined {
  if (!agents) return undefined;
  for (const agent of agents) {
    if (agent.id === id) return agent;
  }
  return undefined;
}

/**
 * One freeze condition for every animated surface: the agent is missing or
 * paused, or the simulation is not running. Matches the animator's 0.15x
 * slow-down and the hub ring's pulse clock.
 */
export function agentFrozen(
  agent: AgentState | undefined,
  running: boolean,
): boolean {
  return agent === undefined || agent.paused || !running;
}
