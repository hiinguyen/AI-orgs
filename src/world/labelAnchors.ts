import type { AgentId } from "@/agents/agentTypes";
import { CORE_AGENT_IDS } from "@/agents/agentTypes";
import { LABEL_SCALE_MIN } from "@/agents/agentMath";

/**
 * Screen-space anchors for the DOM speech bubbles. The 3D layer projects a
 * label point once per frame and writes the result here; the overlay reads it
 * from a single requestAnimationFrame loop. Nothing here is React state, so a
 * moving agent never re-renders a component.
 */
export interface LabelAnchor {
  /** CSS pixels from the left of the canvas. */
  x: number;
  /** CSS pixels from the top of the canvas. */
  y: number;
  /** Screen-space size multiplier from `labelScale`. */
  scale: number;
  /** False when the point is outside the viewport or behind the camera. */
  onScreen: boolean;
}

const anchors = new Map<AgentId, LabelAnchor>();

for (const id of CORE_AGENT_IDS) {
  anchors.set(id, { x: -1000, y: -1000, scale: LABEL_SCALE_MIN, onScreen: false });
}

/**
 * The live anchor object for an agent. The returned object is stable and is
 * mutated in place by the frame loop, so callers must never cache its values.
 */
export function labelAnchorFor(id: AgentId): LabelAnchor {
  const existing = anchors.get(id);
  if (existing) return existing;
  const created: LabelAnchor = {
    x: -1000,
    y: -1000,
    scale: LABEL_SCALE_MIN,
    onScreen: false,
  };
  anchors.set(id, created);
  return created;
}

/** Read-only lookup: never creates an anchor for an unknown or released id. */
export function peekLabelAnchor(id: AgentId): LabelAnchor | undefined {
  return anchors.get(id);
}

/** Drop an anchor when its agent despawns, so a long session cannot leak. */
export function releaseLabelAnchor(id: AgentId): void {
  anchors.delete(id);
}

export function labelAnchorCount(): number {
  return anchors.size;
}

