"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MISSION_CONTROL } from "@/simulation/worldLayout";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import { geometries, materials } from "./sharedResources";
import { missionControlSurface } from "./proceduralTextures";
import { missionSignature, missionView } from "./missionContent";
import { drawMissionControl, resolveMissionFont } from "./missionDrawing";

/**
 * Wall screen with live task content. The canvas is repainted at most four
 * times per second, and only when the content signature changed. All data is
 * read from the mutable live snapshot inside useFrame; this component never
 * subscribes to the React mirror.
 */

const REDRAW_INTERVAL_SECONDS = 0.25;

export function MissionControl() {
  const elapsed = useRef(REDRAW_INTERVAL_SECONDS);
  const lastSignature = useRef<string | null>(null);
  const lastSnapshot = useRef<WorldSnapshot | null | undefined>(undefined);
  const lastSimulated = useRef<boolean | null>(null);

  // Resolve the real UI font once, then repaint after web fonts finish so the
  // wall never keeps a system-font fallback for the life of the tab.
  useEffect(() => {
    let cancelled = false;
    resolveMissionFont();
    const repaint = () => {
      if (cancelled) return;
      resolveMissionFont();
      lastSnapshot.current = undefined;
      lastSignature.current = null;
      elapsed.current = REDRAW_INTERVAL_SECONDS;
    };
    void document.fonts.ready.then(repaint);
    return () => {
      cancelled = true;
    };
  }, []);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < REDRAW_INTERVAL_SECONDS) return;
    elapsed.current = 0;

    const snapshot = liveWorld.current;
    const simulated = useWorldStore.getState().backend.simulated;
    // Do not rebuild the view while the backend has not published anything
    // new; the signature below stays the redraw gate for content changes.
    if (snapshot === lastSnapshot.current && simulated === lastSimulated.current) {
      return;
    }
    lastSnapshot.current = snapshot;
    lastSimulated.current = simulated;

    const view = missionView(snapshot, simulated);
    const signature = missionSignature(view);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    const surface = missionControlSurface();
    drawMissionControl(surface.ctx, view);
    surface.texture.needsUpdate = true;
  });

  return (
    <group position={[MISSION_CONTROL.x, 0, MISSION_CONTROL.z]}>
      <mesh
        geometry={geometries.box}
        material={materials.screenFrame}
        position={[0, 2.8, -0.18]}
        scale={[11.76, 4.46, 0.22]}
        castShadow
      />
      <mesh
        geometry={geometries.plane}
        material={materials.missionScreen}
        position={[0, 2.8, -0.06]}
        scale={[11.4, 4.12, 1]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 0.78, -0.55]}
        scale={[11.9, 0.14, 1.0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={materials.wallPanel}
        position={[0, 0.38, -0.6]}
        scale={[11.7, 0.72, 0.9]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.plane}
        material={materials.hubAccent}
        position={[0, 0.5, -0.16]}
        scale={[10.6, 0.03, 1]}
      />
    </group>
  );
}
