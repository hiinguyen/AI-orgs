"use client";

import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { AGENT_IDS } from "@/agents/agentTypes";
import { labelAnchorFor } from "@/world/labelAnchors";
import { Lighting } from "./Lighting";
import { OfficeEnvironment } from "./OfficeEnvironment";
import { Workstations } from "./Workstations";
import { AgentsLayer } from "./AgentsLayer";
import { CameraController } from "./CameraController";
import { InteractionManager } from "./InteractionManager";
import { CAMERA_FOV, INITIAL_CAMERA_POSITION } from "./cameraPresets";

declare global {
  interface Window {
    /** Draw calls of the previous frame when the page is opened with ?debug. */
    __AAW_DRAW_CALLS__?: number;
    /** Projected speech-bubble anchors when the page is opened with ?debug. */
    __AAW_LABEL_ANCHORS__?: Record<
      string,
      { x: number; y: number; scale: number; onScreen: boolean }
    >;
    /** Compact simulation view for the phase verification scripts. */
    __AAW_DEBUG_STATE__?: {
      clock: number;
      status: string;
      links: Array<{ from: string; to: string; kind: string }>;
      agents: Array<{
        id: string;
        name: string;
        status: string;
        activity: string;
        paused: boolean;
      }>;
      tasks: Array<{
        id: string;
        title: string;
        phase: string;
        status: string;
        iteration: number;
        progress: number;
      }>;
      camera: { x: number; y: number; z: number };
      ui: {
        selectedAgentId: string | null;
        selectedStationId: string | null;
        hovered: string | null;
        followAgentId: string | null;
        activeTab: string;
      };
    };
    /** Side panel render count when the page is opened with ?debug. */
    __AAW_SIDE_PANEL_RENDERS__?: number;
  }
}

/** Flips sceneReady after three rendered frames so the loading screen fades. */
function ReadySignal() {
  const frames = useRef(0);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    frames.current += 1;
    if (frames.current >= 3) {
      done.current = true;
      useWorldStore.getState().setSceneReady(true);
    }
  });

  return null;
}

/**
 * Development aid used by the phase screenshots and the reviewer: with
 * ?debug in the URL the renderer's draw-call count of the last frame is
 * published on window. It never runs unless the flag is present.
 */
function RenderStatsProbe() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debug");
  const lastPublish = useRef(0);

  useFrame(() => {
    if (!enabled) return;
    // Debug-only probe, throttled so it never changes the frame cost the
    // phase checks are measuring.
    const now = performance.now();
    if (now - lastPublish.current < 200) return;
    lastPublish.current = now;
    window.__AAW_DRAW_CALLS__ = gl.info.render.calls;
    const store = useWorldStore.getState();
    const anchors: Record<
      string,
      { x: number; y: number; scale: number; onScreen: boolean }
    > = {};
    for (const id of AGENT_IDS) {
      const anchor = labelAnchorFor(id);
      anchors[id] = {
        x: anchor.x,
        y: anchor.y,
        scale: anchor.scale,
        onScreen: anchor.onScreen,
      };
    }
    window.__AAW_LABEL_ANCHORS__ = anchors;
    const snapshot = liveWorld.current;
    if (snapshot) {
      window.__AAW_DEBUG_STATE__ = {
        clock: snapshot.clock,
        status: snapshot.status,
        links: snapshot.links.map((link) => ({
          from: link.from,
          to: link.to,
          kind: link.kind,
        })),
        agents: snapshot.agents.map((agent) => ({
          id: agent.id,
          name: AGENT_BY_ID[agent.id].name,
          status: agent.status,
          activity: agent.activity,
          paused: agent.paused,
        })),
        tasks: snapshot.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          phase: task.phase,
          status: task.status,
          iteration: task.iteration,
          progress: task.progress,
        })),
        camera: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        ui: {
          selectedAgentId: store.selectedAgentId,
          selectedStationId: store.selectedStationId,
          hovered: store.hovered,
          followAgentId: store.followAgentId,
          activeTab: store.activeTab,
        },
      };
    }
  });

  return null;
}

/**
 * The single Canvas. Quality changes update the `shadows` and `dpr` props in
 * place; the Canvas is never keyed or remounted (see spec pitfall 2).
 */
export function WorldCanvas() {
  const quality = useWorldStore((state) => state.quality);
  const high = quality === "high";
  const setQuality = useWorldStore((state) => state.setQuality);

  return (
    <div className="absolute inset-0">
      <Canvas
        shadows={high ? "percentage" : false}
        dpr={high ? [1, 1.75] : [1, 1.2]}
        camera={{
          position: [
            INITIAL_CAMERA_POSITION[0],
            INITIAL_CAMERA_POSITION[1],
            INITIAL_CAMERA_POSITION[2],
          ],
          fov: CAMERA_FOV,
          near: 0.1,
          far: 220,
        }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <color attach="background" args={["#080b10"]} />
        <fog attach="fog" args={["#0a0e15", 48, 130]} />
        <PerformanceMonitor
          flipflops={2}
          onFallback={() => {
            const store = useWorldStore.getState();
            if (store.quality !== "low") setQuality("low", true);
          }}
        />
        <ReadySignal />
        <RenderStatsProbe />
        <Lighting />
        <OfficeEnvironment />
        <Workstations />
        <AgentsLayer />
        <InteractionManager />
        <CameraController />
      </Canvas>
    </div>
  );
}
