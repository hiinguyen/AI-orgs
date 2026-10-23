"use client";

import { useLayoutEffect, useRef, type JSX, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId, AgentState } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { STATIONS, type StationId } from "@/simulation/worldLayout";
import { liveWorld } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  geometries,
  materials,
  screenMaterial,
  sharedMaterial,
} from "./sharedResources";
import { STATION_OWNER_IDS } from "./stationOwners";
import { screenTexture } from "./proceduralTextures";
import { findAgentState } from "./agentVisuals";

const DESK_SURFACE_Y = 0.72;
const MONITOR_CENTER_Y = 1.12;
const MONITOR_Z = -0.2;
const MONITOR_X = 0.62;

const SCREEN_IDLE_GLOW = 0.55;
const SCREEN_GLOW_LAMBDA = 6;
/** Below this a pool level counts as settled, so no colour write is needed. */
const POOL_EPSILON = 0.0005;

interface MonitorSlot {
  stationId: StationId;
  frame: THREE.Vector3;
  screen: THREE.Vector3;
  angle: number;
}

const MONITORS: readonly MonitorSlot[] = STATIONS.flatMap((station) =>
  [-MONITOR_X, MONITOR_X].map((offset) => {
    const angle = offset < 0 ? 0.14 : -0.14;
    const x = station.position.x + offset;
    const z = station.position.z + MONITOR_Z;
    return {
      stationId: station.id,
      frame: new THREE.Vector3(x, MONITOR_CENTER_Y, z),
      screen: new THREE.Vector3(
        x + Math.sin(angle) * 0.031,
        MONITOR_CENTER_Y,
        z + Math.cos(angle) * 0.031,
      ),
      angle,
    };
  }),
);

const DESK_TOP_Y = DESK_SURFACE_Y + 0.1;
const KEYBOARD_Y = DESK_TOP_Y + 0.011;

interface ScreenEntry {
  material: THREE.MeshStandardMaterial;
  ownerId: AgentId;
  color: THREE.Color;
  poolLevel: number;
}

/** Emissive target for the owner's monitor: working is the brightest level. */
function screenGlowTarget(agent: AgentState | undefined): number {
  if (agent === undefined || agent.paused) return SCREEN_IDLE_GLOW;
  switch (agent.status) {
    case "working":
      return 2.6;
    case "thinking":
    case "communicating":
      return 1.25;
    case "success":
      return 1.6;
    case "error":
      return 1.05;
    case "walking":
      return 0.75;
    case "idle":
      return SCREEN_IDLE_GLOW;
  }
}

/** Floor-pool brightness for the owner's status; working is full strength. */
function screenPoolTarget(agent: AgentState | undefined): number {
  if (agent === undefined || agent.paused) return 0.1;
  switch (agent.status) {
    case "working":
      return 1;
    case "thinking":
    case "communicating":
      return 0.56;
    case "success":
      return 0.72;
    case "error":
      return 0.42;
    case "walking":
      return 0.28;
    case "idle":
      return 0.1;
  }
}

const poolScratch = new THREE.Color();

interface DeskInstances {
  slabs: THREE.InstancedMesh | null;
  bases: THREE.InstancedMesh | null;
  keyboards: THREE.InstancedMesh | null;
  strips: THREE.InstancedMesh | null;
  contact: THREE.InstancedMesh | null;
  pools: THREE.InstancedMesh | null;
}

interface DeskRefs {
  slabs: RefObject<THREE.InstancedMesh | null>;
  bases: RefObject<THREE.InstancedMesh | null>;
  keyboards: RefObject<THREE.InstancedMesh | null>;
  strips: RefObject<THREE.InstancedMesh | null>;
  frames: RefObject<THREE.InstancedMesh | null>;
  stands: RefObject<THREE.InstancedMesh | null>;
  contact: RefObject<THREE.InstancedMesh | null>;
  pools: RefObject<THREE.InstancedMesh | null>;
}

/** Static matrices for every desk, strip, contact shadow and glow pool. */
function writeDeskMatrices(
  meshes: DeskInstances,
  dummy: THREE.Object3D,
  color: THREE.Color,
): void {
  STATIONS.forEach((station, index) => {
    const { x, z } = station.position;

    dummy.position.set(x, DESK_SURFACE_Y + 0.05, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    meshes.slabs?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    meshes.bases?.setMatrixAt(index, dummy.matrix);

    // No chair between the robot and the desk: the agent stands at its
    // workstation and types. A chair there overlapped the torso and the
    // working arms passed through its back.
    dummy.position.set(x, KEYBOARD_Y, z + 0.34);
    dummy.updateMatrix();
    meshes.keyboards?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(x, DESK_SURFACE_Y - 0.035, z + 0.588);
    dummy.scale.set(2.48, 0.026, 0.012);
    dummy.updateMatrix();
    meshes.strips?.setMatrixAt(index, dummy.matrix);
    color.set(getAgentProfile(STATION_OWNER_IDS[station.id]).color);
    meshes.strips?.setColorAt(index, color);

    dummy.position.set(x, 0.014, z + 0.4);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(3.4, 2.2, 1);
    dummy.updateMatrix();
    meshes.contact?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(x, 0.018, z + 0.3);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(3.8, 2.6, 1);
    dummy.updateMatrix();
    meshes.pools?.setMatrixAt(index, dummy.matrix);
  });
}

/** Static matrices for the two monitor frames and stands per station. */
function writeMonitorMatrices(
  frames: THREE.InstancedMesh | null,
  stands: THREE.InstancedMesh | null,
  dummy: THREE.Object3D,
): void {
  MONITORS.forEach((monitor, index) => {
    dummy.position.copy(monitor.frame);
    dummy.rotation.set(0, monitor.angle, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    frames?.setMatrixAt(index, dummy.matrix);

    dummy.position.set(monitor.frame.x, DESK_SURFACE_Y, monitor.frame.z);
    dummy.updateMatrix();
    stands?.setMatrixAt(index, dummy.matrix);
  });
}

function useDeskMeshes(
  screensRef: RefObject<ScreenEntry[] | null>,
): DeskRefs {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const bases = useRef<THREE.InstancedMesh>(null);
  const keyboards = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const frames = useRef<THREE.InstancedMesh>(null);
  const stands = useRef<THREE.InstancedMesh>(null);
  const contact = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const deskMeshes: DeskInstances = {
      slabs: slabs.current,
      bases: bases.current,
      keyboards: keyboards.current,
      strips: strips.current,
      contact: contact.current,
      pools: pools.current,
    };
    writeDeskMatrices(deskMeshes, dummy, color);
    writeMonitorMatrices(frames.current, stands.current, dummy);

    for (const mesh of Object.values(deskMeshes)) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
    if (frames.current) frames.current.instanceMatrix.needsUpdate = true;
    if (stands.current) stands.current.instanceMatrix.needsUpdate = true;
    if (strips.current?.instanceColor) {
      strips.current.instanceColor.needsUpdate = true;
    }
    writeInitialPoolColors(screensRef.current, pools.current);
  }, [screensRef]);

  return {
    slabs,
    bases,
    keyboards,
    strips,
    frames,
    stands,
    contact,
    pools,
  };
}

/** Seed each floor pool with its owner colour at the idle level. */
function writeInitialPoolColors(
  screens: ScreenEntry[] | null,
  poolMesh: THREE.InstancedMesh | null,
): void {
  if (!poolMesh || !screens) return;
  screens.forEach((entry, index) => {
    poolScratch.copy(entry.color).multiplyScalar(entry.poolLevel);
    poolMesh.setColorAt(index, poolScratch);
  });
  if (poolMesh.instanceColor) {
    poolMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    poolMesh.instanceColor.needsUpdate = true;
  }
}

function useScreenEntries(): RefObject<ScreenEntry[] | null> {
  const screens = useRef<ScreenEntry[] | null>(null);
  if (screens.current === null) {
    screens.current = STATIONS.map((station) => {
      const ownerId = STATION_OWNER_IDS[station.id];
      return {
        material: screenMaterial(station.id),
        ownerId,
        color: new THREE.Color(getAgentProfile(ownerId).color),
        poolLevel: 0.1,
      };
    });
  }
  return screens;
}

/** Damp each owner's monitor glow and floor pool towards the live status. */
function useScreenGlow(
  screensRef: RefObject<ScreenEntry[] | null>,
  poolMeshRef: RefObject<THREE.InstancedMesh | null>,
): void {
  useFrame((_, delta) => {
    const screens = screensRef.current;
    if (screens === null) return;
    const snapshot = liveWorld.current;
    const running = snapshot?.status === "running";
    const calm = reducedMotion.current;
    const texture = screenTexture();
    if (running && !calm) {
      texture.offset.y = (texture.offset.y + delta * 0.035) % 1;
    }

    const poolMesh = poolMeshRef.current;
    let poolsDirty = false;
    for (let index = 0; index < screens.length; index += 1) {
      const entry = screens[index];
      const agent = snapshot
        ? findAgentState(snapshot.agents, entry.ownerId)
        : undefined;
      const glowTarget = screenGlowTarget(agent);
      entry.material.emissiveIntensity = calm
        ? glowTarget
        : THREE.MathUtils.damp(
            entry.material.emissiveIntensity,
            glowTarget,
            SCREEN_GLOW_LAMBDA,
            delta,
          );
      const target = screenPoolTarget(agent);
      const next = calm
        ? target
        : THREE.MathUtils.damp(
            entry.poolLevel,
            target,
            SCREEN_GLOW_LAMBDA,
            delta,
          );
      if (Math.abs(next - entry.poolLevel) <= POOL_EPSILON) continue;
      entry.poolLevel = next;
      if (poolMesh) {
        poolScratch.copy(entry.color).multiplyScalar(next);
        poolMesh.setColorAt(index, poolScratch);
        poolsDirty = true;
      }
    }
    if (poolsDirty && poolMesh?.instanceColor) {
      poolMesh.instanceColor.needsUpdate = true;
    }
  });
}

interface DeskInstanceProps {
  slabs: RefObject<THREE.InstancedMesh | null>;
  bases: RefObject<THREE.InstancedMesh | null>;
  keyboards: RefObject<THREE.InstancedMesh | null>;
  strips: RefObject<THREE.InstancedMesh | null>;
  frames: RefObject<THREE.InstancedMesh | null>;
  stands: RefObject<THREE.InstancedMesh | null>;
  contact: RefObject<THREE.InstancedMesh | null>;
  pools: RefObject<THREE.InstancedMesh | null>;
  stripMaterial: THREE.MeshBasicMaterial;
}

function DeskInstances({
  slabs,
  bases,
  keyboards,
  strips,
  frames,
  stands,
  contact,
  pools,
  stripMaterial,
}: DeskInstanceProps): JSX.Element {
  return (
    <group>
      <instancedMesh
        ref={slabs}
        args={[geometries.deskSlab, materials.desk, STATIONS.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={bases}
        args={[geometries.deskBase, materials.chair, STATIONS.length]}
        castShadow
      />
      <instancedMesh
        ref={keyboards}
        args={[geometries.keyboard, materials.screenFrame, STATIONS.length]}
        castShadow
      />
      <instancedMesh
        ref={strips}
        args={[geometries.box, stripMaterial, STATIONS.length]}
      />
      <instancedMesh
        ref={frames}
        args={[geometries.monitorFrame, materials.screenFrame, MONITORS.length]}
        castShadow
      />
      <instancedMesh
        ref={stands}
        args={[geometries.monitorStand, materials.metal, MONITORS.length]}
      />
      <instancedMesh
        ref={contact}
        args={[geometries.plane, materials.contactShadow, STATIONS.length]}
      />
      <instancedMesh
        ref={pools}
        args={[geometries.plane, materials.statusGlow, STATIONS.length]}
      />
    </group>
  );
}

function MonitorScreens(): JSX.Element {
  return (
    <>
      {MONITORS.map((monitor, index) => (
        <mesh
          key={`${monitor.stationId}-${index}`}
          geometry={geometries.monitorScreen}
          material={screenMaterial(monitor.stationId)}
          position={monitor.screen}
          rotation-y={monitor.angle}
        />
      ))}
    </>
  );
}

export function Desks(): JSX.Element {
  const screens = useScreenEntries();
  const meshes = useDeskMeshes(screens);
  const stripMaterial = sharedMaterial(
    "desk-accent-strips",
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        toneMapped: false,
      }),
  );

  useScreenGlow(screens, meshes.pools);

  return (
    <group>
      <DeskInstances
        slabs={meshes.slabs}
        bases={meshes.bases}
        keyboards={meshes.keyboards}
        strips={meshes.strips}
        frames={meshes.frames}
        stands={meshes.stands}
        contact={meshes.contact}
        pools={meshes.pools}
        stripMaterial={stripMaterial}
      />
      <MonitorScreens />
    </group>
  );
}
