"use client";

import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { liveWorld, useWorldStore, waitingAgentCount } from "@/state/useWorldStore";
import { shouldAutoFallback } from "@/state/qualityPolicy";
import { reducedMotion } from "@/state/reducedMotion";
import { getAgentProfile } from "@/agents/AgentRegistry";
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
    /** Per-frame render totals and memory counters when ?debug is present. */
    __AAW_RENDER_STATS__?: {
      calls: number;
      triangles: number;
      points: number;
      lines: number;
      geometries: number;
      textures: number;
      programs: number;
      dpr: number;
      shadows: boolean;
      environment: boolean;
      frameMs: number | null;
    };
    /** Projected speech-bubble anchors when the page is opened with ?debug. */
    __AAW_LABEL_ANCHORS__?: Record<
      string,
      { x: number; y: number; scale: number; onScreen: boolean }
    >;
    /** Compact simulation view for the phase verification scripts. */
    __AAW_DEBUG_STATE__?: {
      clock: number;
      status: string;
      speed: number;
      waiting: number;
      uiAgents: number;
      uiWaiting: number;
      uiProfiles: number;
      profiles: Array<{
        id: string;
        name: string;
        role: string;
        kind: string;
        color: string;
      }>;
      links: Array<{ from: string; to: string; kind: string }>;
      agents: Array<{
        id: string;
        name: string;
        status: string;
        activity: string;
        paused: boolean;
        currentTaskId: string | null;
      }>;
      tasks: Array<{
        id: string;
        title: string;
        phase: string;
        status: string;
        iteration: number;
        progress: number;
        assignedAgentId: string | null;
        completedAt: number | null;
        subtasks: Array<{ id: string; title: string; done: boolean }>;
      }>;
      camera: { x: number; y: number; z: number };
      ui: {
        selectedAgentId: string | null;
        selectedStationId: string | null;
        hovered: string | null;
        followAgentId: string | null;
        activeTab: string;
        quality: string;
        qualityAuto: boolean;
        reducedMotion: boolean;
      };
    };
    /** Side panel render count when the page is opened with ?debug. */
    __AAW_SIDE_PANEL_RENDERS__?: number;
    /** Debug-only quality setter used by the phase checks. */
    __AAW_SET_QUALITY__?: (quality: "high" | "low", auto: boolean) => void;
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
  const scene = useThree((state) => state.scene);
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debug");
  const lastPublish = useRef(0);
  const frameTotal = useRef(0);
  const frameCount = useRef(0);

  // The manual quality hook is a debugging convenience, installed once and
  // removed again: assigning it from the frame loop left a stale closure on
  // window after the probe unmounted.
  useEffect(() => {
    if (!enabled) return;
    window.__AAW_SET_QUALITY__ = (quality, auto) => {
      useWorldStore.getState().setQuality(quality, auto);
    };
    return () => {
      delete window.__AAW_SET_QUALITY__;
    };
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled) return;
    frameTotal.current += delta;
    frameCount.current += 1;
    // Debug-only probe, throttled so it never changes the frame cost the
    // phase checks are measuring.
    const now = performance.now();
    if (now - lastPublish.current < 200) return;
    const frameMs =
      frameCount.current > 0
        ? (frameTotal.current / frameCount.current) * 1000
        : null;
    frameTotal.current = 0;
    frameCount.current = 0;
    lastPublish.current = now;
    const info = gl.info;
    window.__AAW_DRAW_CALLS__ = info.render.calls;
    window.__AAW_RENDER_STATS__ = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      dpr: gl.getPixelRatio(),
      shadows: gl.shadowMap.enabled,
      environment: scene.environment !== null,
      frameMs,
    };
    const store = useWorldStore.getState();
    const anchors: Record<
      string,
      { x: number; y: number; scale: number; onScreen: boolean }
    > = {};
    const snapshot = liveWorld.current;
    if (snapshot) {
      for (const agent of snapshot.agents) {
        const anchor = labelAnchorFor(agent.id);
        anchors[agent.id] = {
          x: anchor.x,
          y: anchor.y,
          scale: anchor.scale,
          onScreen: anchor.onScreen,
        };
      }
      window.__AAW_LABEL_ANCHORS__ = anchors;
      window.__AAW_DEBUG_STATE__ = {
        clock: snapshot.clock,
        status: snapshot.status,
        speed: snapshot.speed,
        waiting: waitingAgentCount(snapshot),
        uiAgents: store.world?.agents.length ?? 0,
        uiWaiting: waitingAgentCount(store.world),
        uiProfiles: store.profiles.size,
        profiles: snapshot.profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          role: profile.role,
          kind: profile.kind,
          color: profile.color,
        })),
        links: snapshot.links.map((link) => ({
          from: link.from,
          to: link.to,
          kind: link.kind,
        })),
        agents: snapshot.agents.map((agent) => ({
          id: agent.id,
          name: getAgentProfile(agent.id).name,
          status: agent.status,
          activity: agent.activity,
          paused: agent.paused,
          currentTaskId: agent.currentTaskId,
        })),
        tasks: snapshot.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          phase: task.phase,
          status: task.status,
          iteration: task.iteration,
          progress: task.progress,
          assignedAgentId: task.assignedAgentId,
          completedAt: task.completedAt, // Used by the browser checks.
          subtasks: task.subtasks.map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            done: subtask.done,
          })),
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
          quality: store.quality,
          qualityAuto: store.qualityAuto,
          reducedMotion: reducedMotion.current,
        },
      };
    }
  });

  return null;
}

/**
 * The single Canvas. Quality changes update the `shadows` and `dpr` props in
 * place; the Canvas is never keyed or remounted (see spec pitfall 2).
 *
 * The 2D map is a second renderer, not a replacement: switching to 2D only
 * stops the frame loop once the loading screen has seen its first frames, so
 * the WebGL context and every baked resource survive the round trip.
 */
export function WorldCanvas() {
  const quality = useWorldStore((state) => state.quality);
  const high = quality === "high";
  const setQuality = useWorldStore((state) => state.setQuality);
  const viewMode = useWorldStore((state) => state.viewMode);
  const sceneReady = useWorldStore((state) => state.sceneReady);
  // frameloop stays "always" until ReadySignal has counted three frames;
  // dropping to "never" earlier would leave the loading screen on screen.
  const resting = sceneReady && viewMode === "2d";

  return (
    <div
      className="absolute inset-0"
      style={resting ? { visibility: "hidden" } : undefined}
      data-view={viewMode}
    >
      <Canvas
        frameloop={resting ? "never" : "always"}
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
            // A forced ?quality=high or ?quality=low must not be overridden
            // by the performance monitor.
            if (shouldAutoFallback(store.quality, store.qualityAuto)) {
              setQuality("low", true);
            }
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
