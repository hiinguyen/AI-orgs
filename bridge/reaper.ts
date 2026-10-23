/**
 * Orphan reaper. Claude Code emits no event when a subagent is cancelled or
 * crashes, so a live agent that stops sending hooks is treated as lost after a
 * fixed wall-clock silence. The time source is injected so the checks can run
 * without waiting ten minutes.
 */
import type { AgentId } from "../src/agents/agentTypes.ts";
import type { LiveStage } from "../src/simulation/liveStage.ts";
import { forgetAgent, type BridgeMappingState } from "./mapping.ts";

export const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Finish every tracked agent whose last hook is older than the timeout.
 * Returns the ids that were asked to finish, in tracking order. A reaped agent
 * keeps its error emote and walk home when a client is watching; a caller with
 * no connected client can remove the returned ids immediately to free capacity.
 */
export function reapOrphans(
  stage: LiveStage,
  state: BridgeMappingState,
  now: number = Date.now(),
  timeoutMs: number = ORPHAN_TIMEOUT_MS,
): AgentId[] {
  const reaped: AgentId[] = [];
  for (const [agentId, lastSeen] of state.lastSeen) {
    if (now - lastSeen < timeoutMs) continue;
    if (!stage.has(agentId)) {
      forgetAgent(state, agentId);
      continue;
    }
    stage.finish(agentId, "error", { activity: "Lost contact" });
    forgetAgent(state, agentId);
    reaped.push(agentId);
  }
  return reaped;
}
