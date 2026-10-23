"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId, Vec2 } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { liveColorIndex } from "@/agents/agentPalette";
import { hashString } from "@/simulation/EventBus.ts";
import { liveWorld } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import { agentVisualFor, findAgentState } from "./agentVisuals";
import {
  geometries,
  hoverRingMaterial,
  sharedMaterial,
} from "./sharedResources";

/**
 * Dotted path trail for one agent: up to 64 small discs flowing along the
 * remaining simulated path at 0.32 m spacing, plus a breathing destination
 * ring. The phase advances with simulation time, so a paused world freezes
 * the dots instead of implying motion that is not happening.
 */

const MAX_DOTS = 64;
const SPACING = 0.32;
const DOT_SIZE = 0.1;
const TRAIL_Y = 0.019;
const DESTINATION_Y = 0.023;
const PHASE_SPEED = 0.55;

const trailMaterial = sharedMaterial(
  "path-trail-disc",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
);

const scratchDummy = new THREE.Object3D();
const scratchColor = new THREE.Color();

/**
 * Place the flowing dots from the drawn position along the remaining path.
 * Returns how many instances were written.
 */
function writeTrail(
  mesh: THREE.InstancedMesh,
  path: readonly Vec2[],
  startX: number,
  startZ: number,
  phase: number,
): number {
  let segmentIndex = 0;
  let segmentStartX = startX;
  let segmentStartZ = startZ;
  let segmentEndX = path[0].x;
  let segmentEndZ = path[0].z;
  let segmentLength = Math.hypot(
    segmentEndX - segmentStartX,
    segmentEndZ - segmentStartZ,
  );
  let travelled = 0;
  let placed = 0;

  for (let index = 0; index < MAX_DOTS; index += 1) {
    const target = phase + index * SPACING;

    while (
      target > travelled + segmentLength &&
      segmentIndex < path.length - 1
    ) {
      travelled += segmentLength;
      segmentIndex += 1;
      segmentStartX = segmentEndX;
      segmentStartZ = segmentEndZ;
      segmentEndX = path[segmentIndex].x;
      segmentEndZ = path[segmentIndex].z;
      segmentLength = Math.hypot(
        segmentEndX - segmentStartX,
        segmentEndZ - segmentStartZ,
      );
    }

    if (target > travelled + segmentLength) break;

    const t = segmentLength > 1e-6 ? (target - travelled) / segmentLength : 0;
    const x = segmentStartX + (segmentEndX - segmentStartX) * t;
    const z = segmentStartZ + (segmentEndZ - segmentStartZ) * t;
    const size = DOT_SIZE * (1 - (index / MAX_DOTS) * 0.35);

    scratchDummy.position.set(x, TRAIL_Y, z);
    scratchDummy.rotation.set(-Math.PI / 2, 0, 0);
    scratchDummy.scale.set(size, size, 1);
    scratchDummy.updateMatrix();
    mesh.setMatrixAt(index, scratchDummy.matrix);
    placed += 1;
  }

  return placed;
}

function writeDestination(
  ring: THREE.Mesh,
  path: readonly Vec2[],
  phase: number,
  seat: number,
  calm: boolean,
): void {
  const last = path[path.length - 1];
  const breath = calm
    ? 0.72
    : 0.72 + Math.sin(phase * 3.2 + seat * 0.9) * 0.06;
  ring.visible = true;
  ring.position.set(last.x, DESTINATION_Y, last.z);
  ring.rotation.set(-Math.PI / 2, 0, 0);
  ring.scale.set(breath, breath, 1);
}

export function PathTrail({
  agentId,
  enabled,
}: {
  agentId: AgentId;
  enabled: boolean;
}) {
  const dots = useRef<THREE.InstancedMesh>(null);
  const destination = useRef<THREE.Mesh>(null);
  const profile = getAgentProfile(agentId);
  // A deterministic phase per id keeps same-role live agents out of lockstep.
  const phaseSeed = profile.kind === "core" ? profile.seat : hashString(agentId);
  const phase = useRef((phaseSeed * 0.137 + liveColorIndex(agentId) * 0.041) % SPACING);

  useLayoutEffect(() => {
    const mesh = dots.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < MAX_DOTS; index += 1) {
      scratchColor
        .set(profile.color)
        .multiplyScalar(1 - (index / MAX_DOTS) * 0.45);
      mesh.setColorAt(index, scratchColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = 0;
  }, [profile.color]);

  useFrame((_, delta) => {
    const mesh = dots.current;
    const ring = destination.current;
    if (!mesh || !ring) return;

    const snapshot = liveWorld.current;
    const agent = findAgentState(snapshot?.agents, agentId);
    const path = agent?.path;

    if (!enabled || !agent || !path || path.length === 0) {
      mesh.visible = false;
      mesh.count = 0;
      ring.visible = false;
      return;
    }

    const calm = reducedMotion.current;
    if (snapshot?.status === "running" && !calm) {
      phase.current =
        (phase.current + delta * (snapshot.speed || 1) * PHASE_SPEED) % SPACING;
    }

    const visual = agentVisualFor(agentId);
    const placed = writeTrail(mesh, path, visual.x, visual.z, phase.current);
    mesh.count = placed;
    mesh.visible = placed > 0;
    mesh.instanceMatrix.needsUpdate = true;
    writeDestination(ring, path, phase.current, phaseSeed, calm);
  });

  return (
    <group>
      <instancedMesh
        ref={dots}
        args={[geometries.disc, trailMaterial, MAX_DOTS]}
        count={0}
        frustumCulled={false}
        renderOrder={1}
      />
      <mesh
        ref={destination}
        geometry={geometries.ring}
        material={hoverRingMaterial(profile.color)}
        rotation-x={-Math.PI / 2}
        position={[0, DESTINATION_Y, 0]}
        visible={false}
        renderOrder={2}
      />
    </group>
  );
}
