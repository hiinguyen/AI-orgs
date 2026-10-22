"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { CommLink, WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld } from "@/state/useWorldStore";
import { agentVisuals } from "./agentVisuals";
import { geometries, sharedMaterial } from "./sharedResources";

/**
 * Communication arcs. Each active CommLink gets a quadratic bezier ribbon in
 * the sender's colour between the two chest heights, plus three instanced
 * packets running from sender to receiver over the link duration. The ribbon
 * is a pair of crossed strips, so it keeps its width from any camera angle,
 * and it is rewritten in place: no geometry is allocated per frame or link.
 */

const MAX_LINKS = 4;
const POINTS = 28;
const PACKETS_PER_LINK = 3;
const MAX_PACKETS = MAX_LINKS * PACKETS_PER_LINK;
/** Half-widths: a thin line at the overview, slightly heavier for assignments. */
const RIBBON_WIDTH = 0.012;
const ASSIGN_RIBBON_WIDTH = 0.02;
const ARC_HEIGHT = 0.45;
/** Instance scale of the shared 0.5 m sphere: 0.09 reads as a 9 cm dot. */
const PACKET_SCALE = 0.09;

/**
 * Packets launch in a stagger and travel for the rest of the link, so none
 * of them ever wraps from the receiver back to the sender mid-link.
 */
const PACKET_STAGGER = 0.16;
const PACKET_TRAVEL = 1 - (PACKETS_PER_LINK - 1) * PACKET_STAGGER;

const UP = new THREE.Vector3(0, 1, 0);
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchSide = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchColor = new THREE.Color();
const scratchDummy = new THREE.Object3D();
const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

const AGENT_COLORS: Record<AgentId, THREE.Color> = {
  orion: new THREE.Color(AGENT_BY_ID.orion.color),
  iris: new THREE.Color(AGENT_BY_ID.iris.color),
  piper: new THREE.Color(AGENT_BY_ID.piper.color),
  kai: new THREE.Color(AGENT_BY_ID.kai.color),
  quinn: new THREE.Color(AGENT_BY_ID.quinn.color),
  rex: new THREE.Color(AGENT_BY_ID.rex.color),
};

/**
 * Normal blending, not additive: the two crossed strips cover the same
 * centre line, and adding both on top of the floor pushed every channel past
 * one, so the sender colour washed out to white. Normal blending keeps the
 * arc in the sender's colour at every preset.
 */
const arcMaterial = sharedMaterial(
  "comm-arc",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
);

const packetMaterial = sharedMaterial(
  "comm-packet",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
);

interface LinkSlot {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  position: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
}

function createSlot(index: number): LinkSlot {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(
    new Float32Array(POINTS * 4 * 3),
    3,
  );
  position.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.BufferAttribute(new Float32Array(POINTS * 4 * 3), 3);
  color.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", color);

  const indices: number[] = [];
  for (let sample = 0; sample < POINTS - 1; sample += 1) {
    const start = sample * 4;
    const next = start + 4;
    indices.push(
      start,
      start + 1,
      next + 1,
      start,
      next + 1,
      next,
      start + 2,
      start + 3,
      next + 3,
      start + 2,
      next + 3,
      next + 2,
    );
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, (POINTS - 1) * 12);

  const mesh = new THREE.Mesh(geometry, arcMaterial);
  mesh.name = `comm-arc-${index}`;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;

  return { mesh, position, color };
}

const SLOTS: readonly LinkSlot[] = Array.from(
  { length: MAX_LINKS },
  (_, index) => createSlot(index),
);

function bezier(
  out: THREE.Vector3,
  start: THREE.Vector3,
  control: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const inverse = 1 - t;
  const a = inverse * inverse;
  const b = 2 * inverse * t;
  const c = t * t;
  return out.set(
    a * start.x + b * control.x + c * end.x,
    a * start.y + b * control.y + c * end.y,
    a * start.z + b * control.z + c * end.z,
  );
}

/**
 * Module-level index order, reused every frame: the snapshot already owns
 * the links, so only their indices are sorted. Newest first, independent of
 * the order the backend sends them in.
 */
const linkOrder: number[] = [];

function orderLinksNewestFirst(
  links: readonly CommLink[],
  clock: number,
): number {
  linkOrder.length = 0;
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    if (clock < link.startedAt || clock >= link.endsAt) continue;
    linkOrder.push(index);
  }
  // Insertion sort: a snapshot carries only a handful of links.
  for (let index = 1; index < linkOrder.length; index += 1) {
    const current = linkOrder[index];
    const startedAt = links[current].startedAt;
    let slot = index - 1;
    while (slot >= 0 && links[linkOrder[slot]].startedAt < startedAt) {
      linkOrder[slot + 1] = linkOrder[slot];
      slot -= 1;
    }
    linkOrder[slot + 1] = current;
  }
  return Math.min(MAX_LINKS, linkOrder.length);
}

export function CommLinks() {
  const packets = useRef<THREE.InstancedMesh>(null);
  const clock = useRef(0);
  const lastSnapshot = useRef<WorldSnapshot | null>(null);

  useLayoutEffect(() => {
    const mesh = packets.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scratchColor.setRGB(0, 0, 0);
    for (let index = 0; index < MAX_PACKETS; index += 1) {
      mesh.setMatrixAt(index, zeroMatrix);
      mesh.setColorAt(index, scratchColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame((_, delta) => {
    const packetMesh = packets.current;
    if (!packetMesh) return;
    const snapshot = liveWorld.current;
    if (!snapshot) return;

    // Interpolate the 30 Hz backend clock between snapshots; each snapshot
    // re-syncs it. Without this the packets advance in visible steps.
    if (snapshot !== lastSnapshot.current) {
      lastSnapshot.current = snapshot;
      clock.current = snapshot.clock;
    } else if (snapshot.status === "running") {
      clock.current += delta * snapshot.speed;
    }

    const links = snapshot.links;
    // A snapshot can carry stale links whose end is already behind the clock;
    // skip them and fill the draw slots from the newest active links.
    const active = orderLinksNewestFirst(links, clock.current);

    for (let slotIndex = 0; slotIndex < MAX_LINKS; slotIndex += 1) {
      const slot = SLOTS[slotIndex];
      const link =
        slotIndex < active ? links[linkOrder[slotIndex]] : undefined;
      if (!link) {
        slot.mesh.visible = false;
        for (let packet = 0; packet < PACKETS_PER_LINK; packet += 1) {
          const index = slotIndex * PACKETS_PER_LINK + packet;
          packetMesh.setMatrixAt(index, zeroMatrix);
          scratchColor.setRGB(0, 0, 0);
          packetMesh.setColorAt(index, scratchColor);
        }
        continue;
      }

      const from = agentVisuals[link.from];
      const to = agentVisuals[link.to];
      scratchA.set(from.x, from.chestY, from.z);
      scratchB.set(to.x, to.chestY, to.z);
      const distance = Math.hypot(
        scratchB.x - scratchA.x,
        scratchB.z - scratchA.z,
      );
      scratchC.set(
        (scratchA.x + scratchB.x) / 2,
        Math.max(scratchA.y, scratchB.y) +
          ARC_HEIGHT +
          Math.min(distance * 0.04, 0.9),
        (scratchA.z + scratchB.z) / 2,
      );

      const sender = AGENT_COLORS[link.from];
      const width =
        link.kind === "assign" ? ASSIGN_RIBBON_WIDTH : RIBBON_WIDTH;
      const positionArray = slot.position.array as Float32Array;
      const colorArray = slot.color.array as Float32Array;

      for (let sample = 0; sample < POINTS; sample += 1) {
        const t = sample / (POINTS - 1);
        bezier(
          scratchPoint,
          scratchA,
          scratchC,
          scratchB,
          t,
        );
        scratchTangent
          .set(
            2 * (1 - t) * (scratchC.x - scratchA.x) +
              2 * t * (scratchB.x - scratchC.x),
            2 * (1 - t) * (scratchC.y - scratchA.y) +
              2 * t * (scratchB.y - scratchC.y),
            2 * (1 - t) * (scratchC.z - scratchA.z) +
              2 * t * (scratchB.z - scratchC.z),
          )
          .normalize();

        scratchSide.copy(scratchTangent).cross(UP);
        if (scratchSide.lengthSq() < 1e-6) {
          scratchSide.set(1, 0, 0);
        } else {
          scratchSide.normalize();
        }
        scratchUp.copy(scratchSide).cross(scratchTangent).normalize();

        const taper = 0.4 + 0.6 * Math.sin(Math.PI * t);
        const halfWidth = width * taper;
        // Stay at or below the sender's own colour: above one it clips white.
        const intensity = 0.86 + 0.14 * Math.sin(Math.PI * t);
        scratchColor.copy(sender).multiplyScalar(intensity);

        const base = sample * 12;
        for (let vertex = 0; vertex < 4; vertex += 1) {
          const offset = base + vertex * 3;
          const horizontal = vertex < 2 ? 1 : 0;
          const sign = vertex % 2 === 0 ? -1 : 1;
          const dx = horizontal
            ? scratchSide.x * sign * halfWidth
            : scratchUp.x * sign * halfWidth;
          const dy = horizontal
            ? scratchSide.y * sign * halfWidth
            : scratchUp.y * sign * halfWidth;
          const dz = horizontal
            ? scratchSide.z * sign * halfWidth
            : scratchUp.z * sign * halfWidth;
          positionArray[offset] = scratchPoint.x + dx;
          positionArray[offset + 1] = scratchPoint.y + dy;
          positionArray[offset + 2] = scratchPoint.z + dz;
          colorArray[offset] = scratchColor.r;
          colorArray[offset + 1] = scratchColor.g;
          colorArray[offset + 2] = scratchColor.b;
        }
      }

      slot.position.needsUpdate = true;
      slot.color.needsUpdate = true;
      slot.mesh.visible = true;

      const duration = Math.max(0.001, link.endsAt - link.startedAt);
      const progress = Math.min(
        1,
        Math.max(0, (clock.current - link.startedAt) / duration),
      );
      for (let packet = 0; packet < PACKETS_PER_LINK; packet += 1) {
        const index = slotIndex * PACKETS_PER_LINK + packet;
        const packetT =
          (progress - packet * PACKET_STAGGER) / PACKET_TRAVEL;
        if (packetT < 0 || packetT > 1) {
          packetMesh.setMatrixAt(index, zeroMatrix);
          scratchColor.setRGB(0, 0, 0);
          packetMesh.setColorAt(index, scratchColor);
          continue;
        }
        bezier(
          scratchPoint,
          scratchA,
          scratchC,
          scratchB,
          packetT,
        );
        scratchDummy.position.copy(scratchPoint);
        scratchDummy.rotation.set(0, 0, 0);
        const size =
          link.kind === "assign" ? PACKET_SCALE * 1.25 : PACKET_SCALE;
        scratchDummy.scale.setScalar(size);
        scratchDummy.updateMatrix();
        packetMesh.setMatrixAt(index, scratchDummy.matrix);
        scratchColor
          .copy(sender)
          .multiplyScalar(0.95 + 0.1 * Math.sin(packet));
        packetMesh.setColorAt(index, scratchColor);
      }
    }

    packetMesh.instanceMatrix.needsUpdate = true;
    if (packetMesh.instanceColor) packetMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group name="comm-links">
      {SLOTS.map((slot) => (
        <primitive key={slot.mesh.name} object={slot.mesh} />
      ))}
      <instancedMesh
        ref={packets}
        args={[geometries.sphere, packetMaterial, MAX_PACKETS]}
        count={MAX_PACKETS}
        frustumCulled={false}
        renderOrder={5}
      />
    </group>
  );
}
