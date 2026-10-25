"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  MISSION_CONSOLE,
  MISSION_CONTROL,
  MISSION_STAND_SLOTS,
} from "@/simulation/worldLayout";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import { geometries, materials, sharedMaterial } from "./sharedResources";
import { missionControlSurface } from "./proceduralTextures";
import { missionSignature, missionView } from "./missionContent";
import { drawMissionControl, resolveMissionFont } from "./missionDrawing";
import { stationOperator } from "./stationPresence";

/**
 * Wall screen with live task content. The canvas is repainted at most four
 * times per second, and only when the content signature changed. All data is
 * read from the mutable live snapshot inside useFrame; this component never
 * subscribes to the React mirror.
 */

const REDRAW_INTERVAL_SECONDS = 0.25;
const CONSOLE_GLOW_LAMBDA = 5;
const CONSOLE_IDLE_GLOW = 0.62;
const CONSOLE_ACTIVE_GLOW = 2.5;
/** Console centre in the wall group's local space (the wall sits at -z). */
const CONSOLE_Z = MISSION_CONSOLE.z - MISSION_CONTROL.z;

const consoleGlowMaterial = sharedMaterial(
  "mission-console-glow",
  () =>
    new THREE.MeshStandardMaterial({
      color: "#0b1119",
      emissive: "#a78bfa",
      emissiveIntensity: CONSOLE_IDLE_GLOW,
      roughness: 0.34,
      metalness: 0.28,
    }),
);

/** True while an unpaused agent is actively operating the wall. */
function consoleOperated(): boolean {
  return stationOperator(liveWorld.current, "mission") !== null;
}

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
    const glowTarget = consoleOperated()
      ? CONSOLE_ACTIVE_GLOW
      : CONSOLE_IDLE_GLOW;
    consoleGlowMaterial.emissiveIntensity = THREE.MathUtils.damp(
      consoleGlowMaterial.emissiveIntensity,
      glowTarget,
      CONSOLE_GLOW_LAMBDA,
      delta,
    );

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

      {/* Control deck: the operating surface between the wall and the room. */}
      <mesh
        geometry={geometries.plane}
        material={materials.contactShadow}
        position={[0, 0.012, CONSOLE_Z + 0.12]}
        rotation-x={-Math.PI / 2}
        scale={[7.2, 2.0, 1]}
      />
      <mesh
        geometry={geometries.plane}
        material={materials.glowCool}
        position={[0, 0.009, CONSOLE_Z + 0.18]}
        rotation-x={-Math.PI / 2}
        scale={[7.4, 2.8, 1]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.chair}
        position={[0, 0.42, CONSOLE_Z]}
        scale={[6.1, 0.84, 0.78]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 0.87, CONSOLE_Z]}
        scale={[6.34, 0.07, 0.94]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={consoleGlowMaterial}
        position={[0, 0.79, CONSOLE_Z + 0.48]}
        scale={[6.2, 0.028, 0.026]}
      />
      {MISSION_STAND_SLOTS.map((slot) => (
        <group key={slot.x} position={[slot.x, 0, CONSOLE_Z]}>
          <mesh
            geometry={geometries.box}
            material={materials.screenFrame}
            position={[0, 1.06, -0.02]}
            rotation-x={-0.42}
            scale={[1.72, 0.58, 0.05]}
            castShadow
          />
          <mesh
            geometry={geometries.plane}
            material={consoleGlowMaterial}
            position={[0, 1.06, 0.04]}
            rotation-x={-0.42}
            scale={[1.56, 0.46, 1]}
          />
          <mesh
            geometry={geometries.keyboard}
            material={materials.screenFrame}
            position={[0, 0.915, 0.25]}
            castShadow
          />
        </group>
      ))}
    </group>
  );
}
