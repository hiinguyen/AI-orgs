"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { liveWorld } from "@/state/useWorldStore";
import { agentVisuals, findAgentState } from "./agentVisuals";
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

export function PathTrail({
  agentId,
  enabled,
}: {
  agentId: AgentId;
  enabled: boolean;
}) {
  const dots = useRef<THREE.InstancedMesh>(null);
  const destination = useRef<THREE.Mesh>(null);
  const phase = useRef((AGENT_BY_ID[agentId].seat * 0.137) % SPACING);
  const profile = AGENT_BY_ID[agentId];

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

    if (snapshot?.status === "running") {
      phase.current =
        (phase.current + delta * (snapshot.speed || 1) * PHASE_SPEED) % SPACING;
    }

    const visual = agentVisuals[agentId];
    let segmentIndex = 0;
    let segmentStartX = visual.x;
    let segmentStartZ = visual.z;
    let segmentEndX = path[0].x;
    let segmentEndZ = path[0].z;
    let segmentLength = Math.hypot(
      segmentEndX - segmentStartX,
      segmentEndZ - segmentStartZ,
    );
    let travelled = 0;
    let placed = 0;

    for (let index = 0; index < MAX_DOTS; index += 1) {
      const target = phase.current + index * SPACING;

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

      const t =
        segmentLength > 1e-6 ? (target - travelled) / segmentLength : 0;
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

    mesh.count = placed;
    mesh.visible = placed > 0;
    mesh.instanceMatrix.needsUpdate = true;

    const last = path[path.length - 1];
    const breath =
      0.72 + Math.sin(phase.current * 3.2 + profile.seat * 0.9) * 0.06;
    ring.visible = true;
    ring.position.set(last.x, DESTINATION_Y, last.z);
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.scale.set(breath, breath, 1);
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
