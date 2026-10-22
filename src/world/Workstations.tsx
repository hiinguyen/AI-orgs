"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  HUB_CENTER,
  LOCATIONS,
  MISSION_CONTROL,
  STATIONS,
  type StationId,
} from "@/simulation/worldLayout";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import {
  geometries,
  materials,
  screenMaterial,
  sharedGeometry,
  sharedMaterial,
} from "./sharedResources";
import { STATION_OWNER_IDS } from "./stationOwners";
import { screenTexture } from "./proceduralTextures";

const DESK_SURFACE_Y = 0.72;
const MONITOR_CENTER_Y = 1.12;
const MONITOR_Z = -0.2;
const MONITOR_X = 0.62;

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

interface RingSeat {
  x: number;
  z: number;
  rotation: number;
}

/**
 * Furniture seats halfway between the agent ring slots, so a robot can stand
 * on every slot without clipping a stool or a lounge seat.
 */
function seatsBetweenSlots(
  slots: readonly { x: number; z: number }[],
  center: { x: number; z: number },
): RingSeat[] {
  const count = slots.length;
  return slots.map((slot) => {
    const angle =
      Math.atan2(slot.x - center.x, slot.z - center.z) +
      Math.PI / count;
    const radius = Math.hypot(slot.x - center.x, slot.z - center.z);
    return {
      x: center.x + Math.sin(angle) * radius,
      z: center.z + Math.cos(angle) * radius,
      rotation: angle + Math.PI,
    };
  });
}

const COLLAB_CENTER = LOCATIONS.collab.center ?? { x: -5, z: 5.6 };
const LOUNGE_CENTER = LOCATIONS.lounge.center ?? { x: 7.5, z: 6.2 };
const COLLAB_SEATS = seatsBetweenSlots(
  LOCATIONS.collab.slots,
  COLLAB_CENTER,
);
const LOUNGE_SEATS = seatsBetweenSlots(
  LOCATIONS.lounge.slots,
  LOUNGE_CENTER,
);

function Desks() {
  const slabs = useRef<THREE.InstancedMesh>(null);
  const bases = useRef<THREE.InstancedMesh>(null);
  const keyboards = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const frames = useRef<THREE.InstancedMesh>(null);
  const stands = useRef<THREE.InstancedMesh>(null);
  const contact = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  const stripMaterial = sharedMaterial(
    "desk-accent-strips",
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        toneMapped: false,
      }),
  );

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    STATIONS.forEach((station, index) => {
      const { x, z } = station.position;

      dummy.position.set(x, DESK_SURFACE_Y + 0.05, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      slabs.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(x, 0, z);
      dummy.updateMatrix();
      bases.current?.setMatrixAt(index, dummy.matrix);

      // No chair between the robot and the desk: the agent stands at its
      // workstation and types. A chair there overlapped the torso and the
      // working arms passed through its back.
      dummy.position.set(x, KEYBOARD_Y, z + 0.34);
      dummy.updateMatrix();
      keyboards.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(x, DESK_SURFACE_Y - 0.035, z + 0.588);
      dummy.scale.set(2.48, 0.026, 0.012);
      dummy.updateMatrix();
      strips.current?.setMatrixAt(index, dummy.matrix);
      color.set(AGENT_BY_ID[STATION_OWNER_IDS[station.id]].color);
      strips.current?.setColorAt(index, color);

      dummy.position.set(x, 0.014, z + 0.4);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(3.4, 2.2, 1);
      dummy.updateMatrix();
      contact.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(x, 0.018, z + 0.3);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(3.8, 2.6, 1);
      dummy.updateMatrix();
      pools.current?.setMatrixAt(index, dummy.matrix);
    });

    MONITORS.forEach((monitor, index) => {
      dummy.position.copy(monitor.frame);
      dummy.rotation.set(0, monitor.angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      frames.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(monitor.frame.x, DESK_SURFACE_Y, monitor.frame.z);
      dummy.updateMatrix();
      stands.current?.setMatrixAt(index, dummy.matrix);
    });

    for (const mesh of [
      slabs.current,
      bases.current,
      keyboards.current,
      strips.current,
      frames.current,
      stands.current,
      contact.current,
      pools.current,
    ]) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
    if (strips.current?.instanceColor) {
      strips.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame((_, delta) => {
    const texture = screenTexture();
    texture.offset.y = (texture.offset.y + delta * 0.035) % 1;
  });

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
        args={[geometries.plane, materials.glow, STATIONS.length]}
      />

      {MONITORS.map((monitor, index) => (
        <mesh
          key={`${monitor.stationId}-${index}`}
          geometry={geometries.monitorScreen}
          material={screenMaterial(monitor.stationId)}
          position={monitor.screen}
          rotation-y={monitor.angle}
        />
      ))}
    </group>
  );
}

function OperationsHub() {
  const ring = sharedGeometry(
    "hub-floor-ring",
    () => new THREE.RingGeometry(1.62, 1.68, 72),
  );

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
        material={materials.hubAccent}
        position={[0, 1.18, 0]}
        rotation-x={-Math.PI / 2}
        scale={1.0}
      />
      <mesh
        geometry={geometries.torus}
        material={materials.hubAccent}
        position={[0, 1.18, 0]}
        rotation-x={-Math.PI / 2}
        scale={1.32}
      />
      <mesh
        geometry={ring}
        material={materials.hubAccent}
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

function MissionControl() {
  return (
    <group position={[MISSION_CONTROL.x, 0, MISSION_CONTROL.z]}>
      <mesh
        geometry={geometries.box}
        material={materials.screenFrame}
        position={[0, 2.6, -0.18]}
        scale={[8.36, 3.24, 0.22]}
        castShadow
      />
      <mesh
        geometry={geometries.plane}
        material={materials.missionScreen}
        position={[0, 2.6, -0.06]}
        scale={[8.0, 2.9, 1]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 0.78, -0.55]}
        scale={[8.5, 0.14, 1.0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={materials.wallPanel}
        position={[0, 0.38, -0.6]}
        scale={[8.3, 0.72, 0.9]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geometries.plane}
        material={materials.hubAccent}
        position={[0, 0.5, -0.16]}
        scale={[7.2, 0.03, 1]}
      />
    </group>
  );
}

function PlanningBoard() {
  const cardGeometry = sharedGeometry(
    "sticky-card",
    () => new THREE.BoxGeometry(0.03, 0.34, 0.5),
  );
  const boardPlane = sharedGeometry(
    "planning-board-plane",
    () => new THREE.PlaneGeometry(3.6, 2.3),
  );

  return (
    <group position={[-13.55, 0, 4.9]}>
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 1.5, 0]}
        scale={[0.16, 2.85, 4.02]}
        castShadow
      />
      <mesh
        geometry={boardPlane}
        material={materials.board}
        position={[0.09, 1.55, 0]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[-0.2, 0.1, 1.7]}
        scale={[0.5, 0.2, 0.5]}
      />
      <instancedMesh
        args={[cardGeometry, materials.stickyCard, 24]}
        count={0}
        castShadow
      />
    </group>
  );
}

function CollabTable() {
  const stools = useRef<THREE.InstancedMesh>(null);
  const center = COLLAB_CENTER;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    COLLAB_SEATS.forEach((seat, index) => {
      dummy.position.set(seat.x, 0, seat.z);
      dummy.rotation.set(0, seat.rotation, 0);
      dummy.updateMatrix();
      stools.current?.setMatrixAt(index, dummy.matrix);
    });
    if (stools.current) stools.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <group position={[center.x, 0, center.z]}>
        <mesh
          geometry={geometries.cylinder}
          material={materials.desk}
          position={[0, 0.74, 0]}
          scale={[2.1, 0.08, 2.1]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={geometries.cylinder}
          material={materials.metal}
          position={[0, 0.36, 0]}
          scale={[0.44, 0.72, 0.44]}
          castShadow
        />
        <mesh
          geometry={geometries.cylinder}
          material={materials.metal}
          position={[0, 0.03, 0]}
          scale={[1.1, 0.06, 1.1]}
        />
      </group>
      <instancedMesh
        ref={stools}
        args={[geometries.stool, materials.chair, COLLAB_SEATS.length]}
        castShadow
      />
    </group>
  );
}

function Lounge() {
  const seats = useRef<THREE.InstancedMesh>(null);
  const center = LOUNGE_CENTER;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    LOUNGE_SEATS.forEach((seat, index) => {
      dummy.position.set(seat.x, 0, seat.z);
      dummy.rotation.set(0, seat.rotation, 0);
      dummy.updateMatrix();
      seats.current?.setMatrixAt(index, dummy.matrix);
    });
    if (seats.current) seats.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <group position={[center.x, 0, center.z]}>
        <mesh
          geometry={geometries.cylinder}
          material={materials.metal}
          position={[0, 0.06, 0]}
          scale={[2.5, 0.12, 2.5]}
          receiveShadow
        />
        <mesh
          geometry={geometries.cylinder}
          material={materials.desk}
          position={[0, 0.3, 0]}
          scale={[1.5, 0.36, 1.5]}
          castShadow
          receiveShadow
        />
      </group>
      <instancedMesh
        ref={seats}
        args={[geometries.loungeSeat, materials.chair, LOUNGE_SEATS.length]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

/** Every desk, console, wall screen, board and lounge seat in the office. */
export function Workstations() {
  return (
    <group>
      <Desks />
      <OperationsHub />
      <MissionControl />
      <PlanningBoard />
      <CollabTable />
      <Lounge />
    </group>
  );
}
