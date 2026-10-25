import type { AgentState } from "../agents/agentTypes.ts";
import type { WorldSnapshot } from "../integrations/AgentBackend.ts";
import type { LocationId } from "../simulation/worldLayout.ts";

/**
 * One definition of "operating a station" for every surface that reacts to
 * the agent standing there: the wall console glow, the planning-board LED and
 * the Mission Control header. Walking or idling at a slot does not count.
 */
export function agentOperatesAt(
  agent: AgentState,
  location: LocationId,
): boolean {
  if (agent.paused || agent.location !== location) return false;
  return (
    agent.status === "working" ||
    agent.status === "thinking" ||
    agent.status === "communicating"
  );
}

/** The first unpaused agent operating the station, if any. */
export function stationOperator(
  snapshot: WorldSnapshot | null,
  location: LocationId,
): AgentState | null {
  if (snapshot === null) return null;
  for (const agent of snapshot.agents) {
    if (agentOperatesAt(agent, location)) return agent;
  }
  return null;
}
