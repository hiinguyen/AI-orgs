"use client";

import { useLayoutEffect, useRef } from "react";
import type { JSX } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BAY_DESK_DEPTH,
  BAY_DESK_WIDTH,
  BAY_DESKS,
  BAY_STANDS,
} from "@/simulation/worldLayout";
import { bayAt } from "@/simulation/bays";
import { liveWorld } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  CORE_COLOR_BY_ID,
  LIVE_AGENT_PALETTE,
  liveColorIndex,
} from "@/agents/agentPalette";
import {
  geometries,
  materials,
  sharedMaterial,
} from "./sharedResources";
import { screenTexture } from "./proceduralTextures";

/**
 * The Dispatch Floor desks. Twelve compact workstations, drawn as one set of
 * InstancedMeshes (slab, base, keyboard, monitor, screen, contact shadow and
 * floor pool) instead of a React tree per bay, so adding sixteen live agents
 * costs a handful of draw calls rather than dozens.
 *
 * A bay's screen brightens when the live agent standing at its stand is
 * working; the occupant is found by position, never by trusting an index from
 * the backend.
 */

const DESK_SURFACE_Y = 0.72;
const MONITOR_CENTER_Y = 1.12;
const MONITOR_Z = -0.2;
const SLAB_SCALE_X = BAY_DESK_WIDTH / 2.6;
const SLAB_SCALE_Z = BAY_DESK_DEPTH / 1.15;
const SCREEN_IDLE = 0.42;
const GLOW_LAMBDA = 6;

const bayScreenMaterial = sharedMaterial(
  "bay-screen",
  () =>
    new THREE.MeshBasicMaterial({
      map: screenTexture(),
      color: "#ffffff",
      toneMapped: false,
    }),
);

interface BayDeskInstances {
  slabs: THREE.InstancedMesh | null;
  bases: THREE.InstancedMesh | null;
  keyboards: THREE.InstancedMesh | null;
  frames: THREE.InstancedMesh | null;
  stands: THREE.InstancedMesh | null;
  screens: THREE.InstancedMesh | null;
  contact: THREE.InstancedMesh | null;
  pools: THREE.InstancedMesh | null;
}

function writeBayMatrices(meshes: BayDeskInstances): void {
  const dummy = new THREE.Object3D();
  BAY_DESKS.forEach((desk, index) => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(desk.x, DESK_SURFACE_Y + 0.05, desk.z);
    dummy.scale.set(SLAB_SCALE_X, 1, SLAB_SCALE_Z);
    dummy.updateMatrix();
    meshes.slabs?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, 0, desk.z);
    dummy.updateMatrix();
    meshes.bases?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, DESK_SURFACE_Y + 0.111, desk.z + 0.26);
    dummy.scale.set(0.72, 1, 0.78);
    dummy.updateMatrix();
    meshes.keyboards?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, MONITOR_CENTER_Y, desk.z + MONITOR_Z);
    dummy.scale.set(0.58, 0.86, 1);
    dummy.updateMatrix();
    meshes.frames?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(
      desk.x,
      MONITOR_CENTER_Y,
      desk.z + MONITOR_Z + 0.031,
    );
    dummy.scale.set(0.58, 0.86, 1);
    dummy.updateMatrix();
    meshes.screens?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, DESK_SURFACE_Y, desk.z + MONITOR_Z);
    dummy.scale.set(0.58, 0.86, 1);
    dummy.updateMatrix();
    meshes.stands?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, 0.014, desk.z + 0.28);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(1.5, 1.1, 1);
    dummy.updateMatrix();
    meshes.contact?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(desk.x, 0.018, desk.z + 0.26);
    dummy.scale.set(1.7, 1.3, 1);
    dummy.updateMatrix();
    meshes.pools?.setMatrixAt(index, dummy.matrix);

    dummy.rotation.set(0, 0, 0);
  });
}

const scratchColor = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
/** Base tint for a bay with no occupant. */
const UNOCCUPIED_BASE = new THREE.Color("#ffffff");
/** One colour per live palette index, parsed once instead of every frame. */
const LIVE_PALETTE_COLORS: readonly THREE.Color[] = LIVE_AGENT_PALETTE.map(
  (hex) => new THREE.Color(hex),
);
/** Core agent colours keyed by agent id, parsed once. */
const CORE_PALETTE_COLORS: ReadonlyMap<string, THREE.Color> = new Map(
  Array.from(CORE_COLOR_BY_ID, ([id, hex]) => [id, new THREE.Color(hex)]),
);

/** Precomputed base colour for an agent; matches colorForAgent exactly. */
function baseColorFor(agentId: string): THREE.Color {
  return (
    CORE_PALETTE_COLORS.get(agentId) ??
    LIVE_PALETTE_COLORS[liveColorIndex(agentId)]
  );
}

/** Screen brightness for a live occupant's status. */
function screenTarget(status: string | undefined, paused: boolean): number {
  if (status === undefined || paused) return SCREEN_IDLE;
  switch (status) {
    case "working":
      return 1;
    case "thinking":
    case "communicating":
      return 0.68;
    case "success":
      return 0.82;
    case "error":
      return 0.55;
    case "walking":
      return 0.5;
    default:
      return SCREEN_IDLE;
  }
}

const occupant: number[] = new Array<number>(BAY_DESKS.length).fill(-1);
const levels: number[] = new Array<number>(BAY_DESKS.length).fill(SCREEN_IDLE);

export function BayDesks(): JSX.Element {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const bases = useRef<THREE.InstancedMesh>(null);
  const keyboards = useRef<THREE.InstancedMesh>(null);
  const frames = useRef<THREE.InstancedMesh>(null);
  const stands = useRef<THREE.InstancedMesh>(null);
  const screens = useRef<THREE.InstancedMesh>(null);
  const contact = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const meshes: BayDeskInstances = {
      slabs: slabs.current,
      bases: bases.current,
      keyboards: keyboards.current,
      frames: frames.current,
      stands: stands.current,
      screens: screens.current,
      contact: contact.current,
      pools: pools.current,
    };
    writeBayMatrices(meshes);
    for (const mesh of Object.values(meshes)) {
      if (mesh) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (let index = 0; index < BAY_DESKS.length; index += 1) {
      scratchColor.setRGB(SCREEN_IDLE, SCREEN_IDLE, SCREEN_IDLE);
      screens.current?.setColorAt(index, scratchColor);
      scratchColor.setRGB(0.06, 0.08, 0.1);
      pools.current?.setColorAt(index, scratchColor);
    }
    if (screens.current?.instanceColor) {
      screens.current.instanceColor.setUsage(THREE.DynamicDrawUsage);
      screens.current.instanceColor.needsUpdate = true;
    }
    if (pools.current?.instanceColor) {
      pools.current.instanceColor.setUsage(THREE.DynamicDrawUsage);
      pools.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame((_, delta) => {
    const snapshot = liveWorld.current;
    const calm = reducedMotion.current;
    const screensMesh = screens.current;
    const poolsMesh = pools.current;
    if (!screensMesh || !poolsMesh) return;

    for (let index = 0; index < occupant.length; index += 1) occupant[index] = -1;
    if (snapshot) {
      for (let index = 0; index < snapshot.agents.length; index += 1) {
        const agent = snapshot.agents[index];
        const bay = bayAt(agent.position, 0.55);
        if (bay !== null && agent.location === "dispatch") {
          occupant[bay] = index;
        }
      }
    }

    for (let bay = 0; bay < BAY_STANDS.length; bay += 1) {
      const agentIndex = occupant[bay];
      const agent =
        agentIndex >= 0 && snapshot ? snapshot.agents[agentIndex] : undefined;
      const target = screenTarget(agent?.status, agent?.paused ?? false);
      const next = calm
        ? target
        : THREE.MathUtils.damp(levels[bay], target, GLOW_LAMBDA, delta);
      levels[bay] = next;
      const baseColor = agent ? baseColorFor(agent.id) : UNOCCUPIED_BASE;
      scratchColor
        .copy(baseColor)
        .lerp(WHITE, 0.35)
        .multiplyScalar(0.28 + next * 0.72);
      screensMesh.setColorAt(bay, scratchColor);
      scratchColor.copy(baseColor).multiplyScalar(0.06 + next * 0.24);
      poolsMesh.setColorAt(bay, scratchColor);
    }
    if (screensMesh.instanceColor) screensMesh.instanceColor.needsUpdate = true;
    if (poolsMesh.instanceColor) poolsMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group name="dispatch-floor">
      <instancedMesh
        ref={slabs}
        args={[geometries.deskSlab, materials.desk, BAY_DESKS.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={bases}
        args={[geometries.deskBase, materials.chair, BAY_DESKS.length]}
        castShadow
      />
      <instancedMesh
        ref={keyboards}
        args={[geometries.keyboard, materials.screenFrame, BAY_DESKS.length]}
        castShadow
      />
      <instancedMesh
        ref={frames}
        args={[geometries.monitorFrame, materials.screenFrame, BAY_DESKS.length]}
        castShadow
      />
      <instancedMesh
        ref={screens}
        args={[geometries.monitorScreen, bayScreenMaterial, BAY_DESKS.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={stands}
        args={[geometries.monitorStand, materials.metal, BAY_DESKS.length]}
      />
      <instancedMesh
        ref={contact}
        args={[geometries.plane, materials.contactShadow, BAY_DESKS.length]}
      />
      <instancedMesh
        ref={pools}
        args={[geometries.plane, materials.statusGlow, BAY_DESKS.length]}
      />
    </group>
  );
}
