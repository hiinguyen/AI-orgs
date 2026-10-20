"use client";

import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { useWorldStore } from "@/state/useWorldStore";
import { Lighting } from "./Lighting";
import { OfficeEnvironment } from "./OfficeEnvironment";
import { Workstations } from "./Workstations";
import { CameraController } from "./CameraController";
import { InteractionManager } from "./InteractionManager";
import { CAMERA_FOV, INITIAL_CAMERA_POSITION } from "./cameraPresets";
import { wasDragGesture } from "./pointerGesture";

declare global {
  interface Window {
    /** Draw calls of the previous frame when the page is opened with ?debug. */
    __AAW_DRAW_CALLS__?: number;
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
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debug");

  useFrame(() => {
    if (enabled) window.__AAW_DRAW_CALLS__ = gl.info.render.calls;
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
        onPointerMissed={() => {
          if (wasDragGesture()) return;
          useWorldStore.getState().clearSelection();
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
        <InteractionManager />
        <CameraController />
      </Canvas>
    </div>
  );
}
