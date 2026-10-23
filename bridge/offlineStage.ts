/**
 * Housekeeping while no WebSocket client is connected. Nobody watches the
 * emote and walk home, so an agent that has finished is removed at once and
 * stale robots neither count toward the live cap nor greet a late client.
 */
import type { LiveStage } from "../src/simulation/liveStage.ts";

export function dropFinishedAgents(stage: LiveStage): number {
  let dropped = 0;
  for (const agent of [...stage.liveAgents]) {
    if (
      agent.phase === "emote" ||
      agent.phase === "walk-home" ||
      agent.phase === "fade"
    ) {
      if (stage.remove(agent.id)) dropped += 1;
    }
  }
  return dropped;
}
