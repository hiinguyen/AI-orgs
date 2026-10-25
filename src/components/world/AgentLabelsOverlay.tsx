"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { addAfterEffect } from "@react-three/fiber";
import type { AgentId, AgentProfile, AgentState } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { useWorldStore, type ViewInsets } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  peekLabelAnchor,
  releaseLabelAnchor,
  type LabelAnchor,
} from "@/world/labelAnchors";
import { cn } from "@/components/ui";

/**
 * DOM speech bubbles for the current roster. drei `<Html>` is banned in this
 * project (spec pitfall 1); the 3D layer projects a label point into
 * `labelAnchors` every frame and this overlay moves the bubbles from fiber's
 * after-render effect. Nothing here is React state, so a moving agent never
 * re-renders a component.
 *
 * Phase 9: bubbles are keyed by id and appear or disappear with the snapshot.
 * The long live names (for example "code-reviewer #12") are truncated by CSS,
 * and a bubble's anchor, size and fade memory are dropped when it unmounts.
 */

const FADE_RATE = 11;
/** Keep the whole pill clear of the floating UI by this many pixels. */
const UI_MARGIN = 12;
/** Do not touch the DOM unless the anchor moved by one of these amounts. */
const ANCHOR_EPSILON = 0.2;
const SCALE_EPSILON = 0.002;

interface AnchorMemory {
  x: number;
  y: number;
  scale: number;
}

interface BubbleSize {
  width: number;
  height: number;
}

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

interface BubbleProps {
  agentId: AgentId;
  profile: AgentProfile;
  agent: AgentState | undefined;
  shown: boolean;
  onMount: (id: AgentId, node: HTMLDivElement | null) => void;
  onMeasure: (id: AgentId, width: number, height: number) => void;
}

/** One pill. Content comes from the store mirror, visibility from the overlay. */
function AgentBubble({
  agentId,
  profile,
  agent,
  shown,
  onMount,
  onMeasure,
}: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Register on mount and measure on every content render; reading the size
  // in the frame loop would force a layout every frame.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    onMount(agentId, node);
    onMeasure(agentId, node.offsetWidth, node.offsetHeight);
    return () => onMount(agentId, null);
  }, [agentId, onMount, onMeasure]);

  // Activity text changes with the mirror, so the pill width changes too. A
  // layout read per render (at most every 160 ms) keeps the UI-clearance test
  // honest without forcing layout inside the frame loop.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) onMeasure(agentId, node.offsetWidth, node.offsetHeight);
  });

  return (
    <div
      ref={ref}
      className={cn(
        "agent-bubble agent-bubble--anchored",
        agent?.status === "success" && "agent-bubble--success",
        agent?.status === "error" && "agent-bubble--error",
      )}
      data-agent={profile.id}
      data-visible={shown ? "1" : "0"}
      title={profile.name}
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
}

export function AgentLabelsOverlay() {
  const agents = useWorldStore((state) => state.world?.agents);
  const selectedAgentId = useWorldStore((state) => state.selectedAgentId);
  const hovered = useWorldStore((state) => state.hovered);
  const speechIndicators = useWorldStore(
    (state) => state.overlays.speechIndicators,
  );

  const isLiveBackend = useWorldStore(
    (state) => state.backend.kind === "websocket",
  );

  const bubbleRefs = useRef<Map<AgentId, HTMLDivElement>>(new Map());
  const bubbleSizes = useRef<Map<AgentId, BubbleSize>>(new Map());
  const anchorMemory = useRef<Map<AgentId, AnchorMemory>>(new Map());
  const fadeValues = useRef<Map<AgentId, number>>(new Map());
  const transformMemory = useRef<Map<AgentId, string>>(new Map());

  const registerBubble = useCallback(
    (id: AgentId, node: HTMLDivElement | null) => {
      if (node !== null) {
        bubbleRefs.current.set(id, node);
        anchorMemory.current.delete(id);
        transformMemory.current.delete(id);
        return;
      }
      bubbleRefs.current.delete(id);
      bubbleSizes.current.delete(id);
      anchorMemory.current.delete(id);
      fadeValues.current.delete(id);
      transformMemory.current.delete(id);
      releaseLabelAnchor(id);
    },
    [],
  );

  const measureBubble = useCallback(
    (id: AgentId, width: number, height: number) => {
      bubbleSizes.current.set(id, { width, height });
    },
    [],
  );

  useEffect(() => {
    const memories = anchorMemory.current;
    const fades = fadeValues.current;
    const transforms = transformMemory.current;
    return () => {
      for (const id of memories.keys()) releaseLabelAnchor(id);
      memories.clear();
      fades.clear();
      transforms.clear();
    };
  }, []);

  useEffect(() => {
    let last = -1;

    const readAnchors = (
      width: number,
      height: number,
      elapsed: number,
    ): void => {
      const insets: ViewInsets = useWorldStore.getState().viewInsets;
      const fadeStep = 1 - Math.exp(-FADE_RATE * elapsed);
      for (const [id, element] of bubbleRefs.current) {
        const anchor: LabelAnchor | undefined = peekLabelAnchor(id);
        if (!anchor) continue;
        const size = bubbleSizes.current.get(id);
        if (!size) continue;
        const halfWidth = (size.width * anchor.scale) / 2;
        const pillHeight = size.height * anchor.scale;
        const clearOfUi =
          anchor.onScreen &&
          anchor.x - halfWidth > insets.left + UI_MARGIN &&
          anchor.x + halfWidth < width - insets.right - UI_MARGIN &&
          anchor.y - 10 - pillHeight > insets.top + UI_MARGIN &&
          anchor.y < height - insets.bottom - UI_MARGIN;
        const wanted = element.dataset.visible === "1" && clearOfUi ? 1 : 0;

        let fade = fadeValues.current.get(id);
        if (fade === undefined) {
          fade = 0;
          fadeValues.current.set(id, fade);
        }
        const memory = anchorMemory.current.get(id);
        if (
          !memory ||
          Math.abs(memory.x - anchor.x) > ANCHOR_EPSILON ||
          Math.abs(memory.y - anchor.y) > ANCHOR_EPSILON ||
          Math.abs(memory.scale - anchor.scale) > SCALE_EPSILON
        ) {
          anchorMemory.current.set(id, {
            x: anchor.x,
            y: anchor.y,
            scale: anchor.scale,
          });
          if (anchor.onScreen) {
            const transform =
              `translate3d(${anchor.x.toFixed(1)}px, ${(anchor.y - 10).toFixed(1)}px, 0) ` +
              `translate(-50%, -100%) scale(${anchor.scale.toFixed(3)})`;
            transformMemory.current.set(id, transform);
          }
        }

        const nextFade = reducedMotion.current
          ? wanted
          : fade + (wanted - fade) * fadeStep;
        fadeValues.current.set(id, nextFade);
        element.style.opacity = nextFade.toFixed(3);
        element.style.visibility = nextFade > 0.01 ? "visible" : "hidden";
        const transform = transformMemory.current.get(id);
        if (transform !== undefined) element.style.transform = transform;
      }
    };

    const tick = (now: number) => {
      const elapsed =
        last < 0 ? 0.016 : Math.max(0.001, Math.min(0.1, (now - last) / 1000));
      last = now;
      readAnchors(window.innerWidth, window.innerHeight, elapsed);
    };

    const removeEffect = addAfterEffect(tick);
    const memories = anchorMemory.current;
    const fades = fadeValues.current;
    const transforms = transformMemory.current;
    return () => {
      removeEffect();
      for (const id of memories.keys()) releaseLabelAnchor(id);
      memories.clear();
      fades.clear();
      transforms.clear();
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-testid="agent-labels"
    >
      {agents?.map((agent) => {
        const profile = getAgentProfile(agent.id);
        const shown =
          selectedAgentId === agent.id ||
          hovered === `agent:${agent.id}` ||
          agent.paused ||
          (speechIndicators &&
            (agent.status === "communicating" ||
              agent.status === "success" ||
              agent.status === "error" ||
              // Live mode: say what each busy core agent is doing.
              (isLiveBackend &&
                profile.kind === "core" &&
                (agent.status === "working" || agent.status === "thinking") &&
                agent.activity.length > 0)));

        return (
          <AgentBubble
            key={agent.id}
            agentId={agent.id}
            profile={profile}
            agent={agent}
            shown={shown}
            onMount={registerBubble}
            onMeasure={measureBubble}
          />
        );
      })}
    </div>
  );
}
