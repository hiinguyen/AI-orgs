"use client";

import { useWorldStore } from "@/state/useWorldStore";
import type { AgentState } from "@/agents/agentTypes";
import { AgentCharacters } from "./AgentCharacter";
import { CommLinks } from "./CommLinks";
import { PathTrail } from "./PathTrail";

const EMPTY_AGENTS: readonly AgentState[] = [];

/**
 * Everything that belongs to the current agent roster: the procedural robots,
 * their dotted path trails and the glowing communication arcs. Mounted inside
 * the existing Canvas; it never creates a second renderer.
 *
 * Phase 9: the list comes from the snapshot, so a live backend can add and
 * remove robots. Core agents keep their trails exactly as before.
 */
export function AgentsLayer() {
  const high = useWorldStore((state) => state.quality === "high");
  const walkingPaths = useWorldStore((state) => state.overlays.walkingPaths);
  const agents = useWorldStore((state) => state.world?.agents ?? EMPTY_AGENTS);

  return (
    <group name="agents-layer">
      <AgentCharacters high={high} />
      {agents.map((agent) => (
        <PathTrail
          key={agent.id}
          agentId={agent.id}
          enabled={walkingPaths}
        />
      ))}
      <CommLinks />
    </group>
  );
}
