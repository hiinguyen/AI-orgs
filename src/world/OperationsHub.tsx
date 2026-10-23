"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { animationTimeScale } from "@/agents/agentMath";
import { HUB_CENTER } from "@/simulation/worldLayout";
import { liveWorld } from "@/state/useWorldStore";
import { agentFrozen, findAgentState } from "./agentVisuals";
import {
  geometries,
  materials,
  sharedGeometry,
  sharedMaterial,
} from "./sharedResources";

/**
 * Round operations console. The ring assembly glows calmly while Orion is
 * idle and pulses while he is working or moving. The pulse runs on real time
 * so the speed multiplier does not change its rhythm; the same freeze
 * condition as the robots' animator slows it to 0.15x.
 */

const ACTIVE_PULSE_SPEED = 3.2;
const IDLE_PULSE_SPEED = 0.9;

const hubRingMaterial = sharedMaterial(
  "hub-ring-live",
  () =>
    new THREE.MeshStandardMaterial({
      color: "#3a2a10",
      emissive: "#E8B04A",
      emissiveIntensity: 2.1,
      roughness: 0.36,
      metalness: 0.65,
    }),
);

const floorRing = sharedGeometry(
  "hub-floor-ring",
  () => new THREE.RingGeometry(1.62, 1.68, 72),
);

export function OperationsHub() {
  const ringRef = useRef<THREE.Mesh>(null);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const snapshot = liveWorld.current;
    const orion = snapshot
      ? findAgentState(snapshot.agents, "orion")
      : undefined;
    const active = orion !== undefined && !orion.paused && orion.status !== "idle";
    const timeScale = animationTimeScale(
      agentFrozen(orion, snapshot?.status === "running"),
    );
    phase.current += delta * timeScale;

    const t = phase.current;
    const pulse = active
      ? 1 + Math.sin(t * ACTIVE_PULSE_SPEED) * 0.035
      : 1 + Math.sin(t * IDLE_PULSE_SPEED) * 0.008;
    hubRingMaterial.emissiveIntensity = active
      ? 2.35 + Math.sin(t * ACTIVE_PULSE_SPEED) * 0.55
      : 1.95 + Math.sin(t * IDLE_PULSE_SPEED) * 0.12;
    if (ringRef.current) ringRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={[HUB_CENTER.x, 0, HUB_CENTER.z]}>
      <mesh
        geometry={geometries.hubBase}
        material={materials.metal}
        position={[0, 0.45, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.hubTop}
        material={materials.metal}
        position={[0, 0.94, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.cylinder}
        material={materials.metalLight}
        position={[0, 1.12, 0]}
        scale={[0.12, 0.36, 0.12]}
      />
      <mesh
        geometry={geometries.hubOrb}
        material={materials.hubAccent}
        position={[0, 1.36, 0]}
      />
      <mesh
        geometry={geometries.torus}
        material={hubRingMaterial}
        position={[0, 1.18, 0]}
        rotation-x={-Math.PI / 2}
        scale={1.0}
      />
      <mesh
        geometry={geometries.torus}
        material={hubRingMaterial}
        position={[0, 1.18, 0]}
        rotation-x={-Math.PI / 2}
        scale={1.32}
      />
      <mesh
        ref={ringRef}
        geometry={floorRing}
        material={hubRingMaterial}
        position={[0, 0.012, 0]}
        rotation-x={-Math.PI / 2}
      />
      <mesh
        geometry={geometries.plane}
        material={materials.glow}
        position={[0, 0.02, 0]}
        rotation-x={-Math.PI / 2}
        scale={[4.6, 4.6, 1]}
      />
      <mesh
        geometry={geometries.plane}
        material={materials.glowCool}
        position={[0, 0.015, 0]}
        rotation-x={-Math.PI / 2}
        scale={[16, 16, 1]}
      />
    </group>
  );
}
