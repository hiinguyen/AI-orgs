"use client";

import { useEffect, useRef } from "react";
import { addAfterEffect } from "@react-three/fiber";
import {
  AGENT_IDS,
  type AgentProfile,
  type AgentState,
} from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { useWorldStore, type ViewInsets } from "@/state/useWorldStore";
import { labelAnchorFor } from "@/world/labelAnchors";
import { cn } from "@/components/ui";

/**
 * DOM speech bubbles for the six robots. drei `<Html>` is banned in this
 * project (spec pitfall 1); the 3D layer projects a label point into
 * `labelAnchors` every frame and this overlay moves the bubbles from fiber's
 * after-render effect. That effect runs after the anchors were written in the
 * same frame, so a bubble never trails the robot by one frame, and it is
 * still one DOM update per frame with no React render.
 *
 * Bubble sizes are measured by a ResizeObserver, never inside the frame loop:
 * reading offsetWidth after a style write would force a layout every frame.
 * The tick still does all its reads before its writes.
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

/** Per-frame scratch arrays, allocated once per mount. */
interface BubbleFrame {
  fade: number[];
  wanted: number[];
  transforms: Array<string | null>;
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

/** Forget the last transform so the first frame always places every bubble. */
function resetAnchorMemory(): void {
  for (const memory of anchorMemory) {
    memory.x = Number.NEGATIVE_INFINITY;
    memory.y = Number.NEGATIVE_INFINITY;
    memory.scale = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Measure the pills on mount and whenever their content reflows. Sizes are
 * cached because reading offsetWidth inside the frame loop would force a
 * layout every frame. Returns the observer disconnect.
 */
function measureBubbles(
  elements: ReadonlyArray<HTMLDivElement | null>,
  sizes: BubbleSize[],
): () => void {
  const measure = (element: HTMLElement, index: number) => {
    sizes[index].width = element.offsetWidth;
    sizes[index].height = element.offsetHeight;
  };
  const indexByElement = new Map<Element, number>();
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const index = indexByElement.get(entry.target);
      if (index === undefined) continue;
      measure(entry.target as HTMLElement, index);
    }
  });
  elements.forEach((element, index) => {
    if (!element) return;
    indexByElement.set(element, index);
    observer.observe(element);
    measure(element, index);
  });
  return () => observer.disconnect();
}

/**
 * Read phase: project each anchor and decide visibility. Every read (anchor,
 * cached pill size, window and UI insets) happens before the write phase, and
 * a transform is only rewritten when the bubble actually moved.
 */
function readAnchors(
  elements: ReadonlyArray<HTMLDivElement | null>,
  sizes: readonly BubbleSize[],
  frame: BubbleFrame,
  insets: ViewInsets,
  width: number,
  height: number,
): void {
  for (let index = 0; index < AGENT_IDS.length; index += 1) {
    const element = elements[index];
    frame.transforms[index] = null;
    if (!element) {
      frame.wanted[index] = 0;
      continue;
    }
    const anchor = labelAnchorFor(AGENT_IDS[index]);
    const size = sizes[index];
    // Keep the whole pill out of the floating UI: a sliver peeking out under
    // the top bar or the side panel reads as a rendering glitch. The pill is
    // centred on the anchor and sits above it, and its size scales with the
    // anchor.
    const halfWidth = (size.width * anchor.scale) / 2;
    const pillHeight = size.height * anchor.scale;
    const clearOfUi =
      anchor.onScreen &&
      anchor.x - halfWidth > insets.left + UI_MARGIN &&
      anchor.x + halfWidth < width - insets.right - UI_MARGIN &&
      anchor.y - 10 - pillHeight > insets.top + UI_MARGIN &&
      anchor.y < height - insets.bottom - UI_MARGIN;
    frame.wanted[index] = element.dataset.visible === "1" && clearOfUi ? 1 : 0;

    if (!anchor.onScreen) continue;
    const memory = anchorMemory[index];
    if (
      Math.abs(memory.x - anchor.x) > ANCHOR_EPSILON ||
      Math.abs(memory.y - anchor.y) > ANCHOR_EPSILON ||
      Math.abs(memory.scale - anchor.scale) > SCALE_EPSILON
    ) {
      memory.x = anchor.x;
      memory.y = anchor.y;
      memory.scale = anchor.scale;
      frame.transforms[index] =
        `translate3d(${anchor.x.toFixed(1)}px, ${(anchor.y - 10).toFixed(1)}px, 0) ` +
        `translate(-50%, -100%) scale(${anchor.scale.toFixed(3)})`;
    }
  }
}

/** Write phase: fade and place the bubbles from the values read above. */
function writeBubbles(
  elements: ReadonlyArray<HTMLDivElement | null>,
  frame: BubbleFrame,
  elapsed: number,
  reducedMotion: boolean,
): void {
  for (let index = 0; index < AGENT_IDS.length; index += 1) {
    const element = elements[index];
    if (!element) continue;
    if (reducedMotion) {
      frame.fade[index] = frame.wanted[index];
    } else {
      frame.fade[index] +=
        (frame.wanted[index] - frame.fade[index]) *
        (1 - Math.exp(-FADE_RATE * elapsed));
    }
    element.style.opacity = frame.fade[index].toFixed(3);
    element.style.visibility =
      frame.fade[index] > 0.01 ? "visible" : "hidden";
    const transform = frame.transforms[index];
    if (transform !== null) element.style.transform = transform;
  }
}

interface BubbleProps {
  profile: AgentProfile;
  agent: AgentState | undefined;
  shown: boolean;
  attach: (node: HTMLDivElement | null) => void;
}

/** One pill. Content comes from the store mirror, visibility from the overlay. */
function AgentBubble({ profile, agent, shown, attach }: BubbleProps) {
  return (
    <div
      ref={attach}
      className={cn(
        "agent-bubble agent-bubble--anchored",
        agent?.status === "success" && "agent-bubble--success",
        agent?.status === "error" && "agent-bubble--error",
      )}
      data-agent={profile.id}
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
}

export function AgentLabelsOverlay() {
  const agents = useWorldStore((state) => state.world?.agents);
  const selectedAgentId = useWorldStore((state) => state.selectedAgentId);
  const hovered = useWorldStore((state) => state.hovered);
  const speechIndicators = useWorldStore(
    (state) => state.overlays.speechIndicators,
  );
  const bubbleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const bubbleSizes = useRef<BubbleSize[]>(
    AGENT_IDS.map(() => ({ width: 0, height: 0 })),
  );

  useEffect(() => {
    let last = -1;
    const frame: BubbleFrame = {
      fade: new Array<number>(AGENT_IDS.length).fill(0),
      wanted: new Array<number>(AGENT_IDS.length).fill(0),
      transforms: new Array<string | null>(AGENT_IDS.length).fill(null),
    };
    resetAnchorMemory();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const disconnect = measureBubbles(bubbleRefs.current, bubbleSizes.current);

    const tick = (now: number) => {
      const elapsed =
        last < 0 ? 0.016 : Math.max(0.001, Math.min(0.1, (now - last) / 1000));
      last = now;
      const insets = useWorldStore.getState().viewInsets;
      readAnchors(
        bubbleRefs.current,
        bubbleSizes.current,
        frame,
        insets,
        window.innerWidth,
        window.innerHeight,
      );
      writeBubbles(bubbleRefs.current, frame, elapsed, reducedMotion);
    };

    const removeEffect = addAfterEffect(tick);
    return () => {
      removeEffect();
      disconnect();
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-testid="agent-labels"
    >
      {AGENT_IDS.map((id, index) => {
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
          <AgentBubble
            key={id}
            profile={AGENT_BY_ID[id]}
            agent={agent}
            shown={shown}
            attach={(node) => {
              bubbleRefs.current[index] = node;
            }}
          />
        );
      })}
    </div>
  );
}
