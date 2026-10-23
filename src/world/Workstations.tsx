"use client";

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { LOCATIONS } from "@/simulation/worldLayout";
import { geometries, materials } from "./sharedResources";
import { Desks } from "./Desks";
import { BayDesks } from "./BayDesks";
import { OperationsHub } from "./OperationsHub";
import { MissionControl } from "./MissionControl";
import { PlanningBoard } from "./PlanningBoard";

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
      <BayDesks />
      <OperationsHub />
      <MissionControl />
      <PlanningBoard />
      <CollabTable />
      <Lounge />
    </group>
  );
}
