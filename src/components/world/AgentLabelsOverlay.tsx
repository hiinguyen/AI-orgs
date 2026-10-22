"use client";

import { useEffect, useRef } from "react";
import { addAfterEffect } from "@react-three/fiber";
import { AGENT_IDS } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { useWorldStore } from "@/state/useWorldStore";
import { labelAnchorFor } from "@/world/labelAnchors";
import { cn } from "@/components/ui";

/**
 * DOM speech bubbles for the six robots. drei `<Html>` is banned in this
 * project (spec pitfall 1); the 3D layer projects a label point into
 * `labelAnchors` every frame and this overlay moves the bubbles from fiber's
 * after-render effect. That effect runs after the anchors were written in the
 * same frame, so a bubble never trails the robot by one frame, and it is
 * still one DOM update per frame with no React render.
 */

const FADE_RATE = 11;

interface AnchorMemory {
  x: number;
  y: number;
  scale: number;
}

const anchorMemory: AnchorMemory[] = AGENT_IDS.map(() => ({
  x: Number.NEGATIVE_INFINITY,
  y: Number.NEGATIVE_INFINITY,
  scale: Number.NEGATIVE_INFINITY,
}));

/** "Quinn is idle" reads as "Idle" instead of "Quinn Quinn is idle". */
function displayActivity(name: string, activity: string | undefined): string {
  if (!activity) return "Idle";
  let text = activity;
  if (text.startsWith(`${name} is `)) {
    text = text.slice(name.length + 4);
  } else if (text.startsWith(`${name} `)) {
    text = text.slice(name.length + 1);
  }
  if (text.length === 0) return activity;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AgentLabelsOverlay() {
  const agents = useWorldStore((state) => state.world?.agents);
  const selectedAgentId = useWorldStore((state) => state.selectedAgentId);
  const hovered = useWorldStore((state) => state.hovered);
  const speechIndicators = useWorldStore(
    (state) => state.overlays.speechIndicators,
  );
  const bubbleRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let last = -1;
    const fade = new Array<number>(AGENT_IDS.length).fill(0);
    for (const memory of anchorMemory) {
      memory.x = Number.NEGATIVE_INFINITY;
      memory.y = Number.NEGATIVE_INFINITY;
      memory.scale = Number.NEGATIVE_INFINITY;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const tick = (now: number) => {
      const elapsed =
        last < 0 ? 0.016 : Math.max(0.001, Math.min(0.1, (now - last) / 1000));
      last = now;
      const insets = useWorldStore.getState().viewInsets;
      const width = window.innerWidth;
      const height = window.innerHeight;

      for (let index = 0; index < AGENT_IDS.length; index += 1) {
        const element = bubbleRefs.current[index];
        if (!element) continue;
        const anchor = labelAnchorFor(AGENT_IDS[index]);
        // Keep the whole pill out of the floating UI: a sliver peeking out
        // under the top bar or the side panel reads as a rendering glitch.
        // The pill is centred on the anchor and sits above it, and its size
        // scales with the anchor.
        const halfWidth = (element.offsetWidth * anchor.scale) / 2;
        const pillHeight = element.offsetHeight * anchor.scale;
        const clearOfUi =
          anchor.onScreen &&
          anchor.x - halfWidth > insets.left + 12 &&
          anchor.x + halfWidth < width - insets.right - 12 &&
          anchor.y - 10 - pillHeight > insets.top + 12 &&
          anchor.y < height - insets.bottom - 12;
        const wanted = element.dataset.visible === "1" && clearOfUi ? 1 : 0;
        if (reducedMotion) {
          fade[index] = wanted;
        } else {
          fade[index] +=
            (wanted - fade[index]) * (1 - Math.exp(-FADE_RATE * elapsed));
        }

        element.style.opacity = fade[index].toFixed(3);
        element.style.visibility = fade[index] > 0.01 ? "visible" : "hidden";

        if (!anchor.onScreen) continue;
        const memory = anchorMemory[index];
        if (
          Math.abs(memory.x - anchor.x) > 0.2 ||
          Math.abs(memory.y - anchor.y) > 0.2 ||
          Math.abs(memory.scale - anchor.scale) > 0.002
        ) {
          memory.x = anchor.x;
          memory.y = anchor.y;
          memory.scale = anchor.scale;
          element.style.transform =
            `translate3d(${anchor.x.toFixed(1)}px, ${(anchor.y - 10).toFixed(1)}px, 0) ` +
            `translate(-50%, -100%) scale(${anchor.scale.toFixed(3)})`;
        }
      }
    };

    return addAfterEffect(tick);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-testid="agent-labels"
    >
      {AGENT_IDS.map((id, index) => {
        const profile = AGENT_BY_ID[id];
        const agent = agents?.find((entry) => entry.id === id);
        const shown =
          selectedAgentId === id ||
          hovered === `agent:${id}` ||
          agent?.paused === true ||
          (speechIndicators &&
            (agent?.status === "communicating" ||
              agent?.status === "success" ||
              agent?.status === "error"));

        return (
          <div
            key={id}
            ref={(node) => {
              bubbleRefs.current[index] = node;
            }}
            className={cn(
              "agent-bubble agent-bubble--anchored",
              agent?.status === "success" && "agent-bubble--success",
              agent?.status === "error" && "agent-bubble--error",
            )}
            data-agent={id}
            data-visible={shown ? "1" : "0"}
          >
            <span
              className="agent-bubble__dot"
              style={{ backgroundColor: profile.color }}
            />
            <span className="agent-bubble__name">{profile.name}</span>
            <span className="agent-bubble__activity">
              {agent?.paused
                ? "Paused"
                : displayActivity(profile.name, agent?.activity)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
