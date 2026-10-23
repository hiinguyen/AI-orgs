import type { AgentId, AgentState } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { chestHeight, labelHeight, rigFor } from "@/agents/agentRigs";
import { headingFor, slotFor } from "@/simulation/worldLayout";

/**
 * The rendered pose of each robot after damping, shared by the systems that
 * must attach to what the user actually sees: comm arcs, hit boxes and the
 * label projection. It is rendering state only; the simulation snapshot stays
 * untouched and authoritative.
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
  const profile = AGENT_BY_ID[id];
  const rig = rigFor(profile.role);
  const slot = slotFor(profile.home, profile.seat);
  return {
    x: slot.x,
    z: slot.z,
    heading: headingFor(profile.home, profile.seat),
    scale: rig.scale,
    chestY: chestHeight(rig) * rig.scale,
    labelY: labelHeight(rig),
  };
}

export const agentVisuals: Record<AgentId, AgentVisualPose> = {
  orion: initialPose("orion"),
  iris: initialPose("iris"),
  piper: initialPose("piper"),
  kai: initialPose("kai"),
  quinn: initialPose("quinn"),
  rex: initialPose("rex"),
};

/** Linear lookup over the six snapshot agents, allocation free. */
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
