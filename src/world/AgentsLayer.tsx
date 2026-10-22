"use client";

import { AGENT_IDS } from "@/agents/agentTypes";
import { useWorldStore } from "@/state/useWorldStore";
import { AgentCharacters } from "./AgentCharacter";
import { CommLinks } from "./CommLinks";
import { PathTrail } from "./PathTrail";

/**
 * Everything that belongs to the six agents: the procedural robots, their
 * dotted path trails and the glowing communication arcs. Mounted inside the
 * existing Canvas; it never creates a second renderer.
 */
export function AgentsLayer() {
  const high = useWorldStore((state) => state.quality === "high");
  const walkingPaths = useWorldStore(
    (state) => state.overlays.walkingPaths,
  );

  return (
    <group name="agents-layer">
      <AgentCharacters high={high} />
      {AGENT_IDS.map((id) => (
        <PathTrail key={id} agentId={id} enabled={walkingPaths} />
      ))}
      <CommLinks />
    </group>
  );
}
