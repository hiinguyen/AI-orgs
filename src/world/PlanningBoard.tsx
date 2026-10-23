"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLANNING_BOARD_CENTER } from "@/simulation/worldLayout";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld } from "@/state/useWorldStore";
import { geometries, materials, sharedGeometry } from "./sharedResources";
import {
  PLANNING_BOARD,
  PLANNING_BOARD_FACE_OFFSET,
  PLANNING_BOARD_ROTATION,
  PLANNING_CARD_LIMIT,
  planningCards,
  planningSignature,
  type PlanningCard,
} from "./planningContent";

/**
 * Whiteboard with one instanced sticky card per subtask of the active tasks.
 * The card set, matrices and colours are rebuilt only when the subtask
 * signature changes; while a card is scaling in, its matrix is rewritten each
 * frame until it reaches full size. The board is angled out of the west wall
 * so the cards read from the Collaboration and Overview camera presets.
 */

const CARD_X = 0.12;
const BOARD_CENTER_Z = PLANNING_BOARD.width / 2;
const BOARD_BOTTOM_Y = 0.35;
const CARD_SCALE_SECONDS = 0.3;
const SIGNATURE_INTERVAL_SECONDS = 0.2;

const cardGeometry = sharedGeometry(
  "sticky-card",
  () =>
    new THREE.BoxGeometry(
      0.03,
      PLANNING_BOARD.cardHeight,
      PLANNING_BOARD.cardWidth,
    ),
);
const boardPlane = sharedGeometry(
  "planning-board-plane",
  () => new THREE.PlaneGeometry(PLANNING_BOARD.width, PLANNING_BOARD.height),
);

interface Scratch {
  dummy: THREE.Object3D;
  tints: Map<string, THREE.Color>;
}

function tintColor(scratch: Scratch, tint: string): THREE.Color {
  const existing = scratch.tints.get(tint);
  if (existing) return existing;
  const color = new THREE.Color(tint);
  scratch.tints.set(tint, color);
  return color;
}

function cardScale(age: number): number {
  if (age >= CARD_SCALE_SECONDS) return 1;
  const t = Math.max(0, age) / CARD_SCALE_SECONDS;
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

function writeCard(
  mesh: THREE.InstancedMesh,
  card: PlanningCard,
  scale: number,
  index: number,
  scratch: Scratch,
): void {
  scratch.dummy.position.set(
    CARD_X,
    BOARD_BOTTOM_Y + card.v,
    BOARD_CENTER_Z - card.u,
  );
  scratch.dummy.rotation.set(0, 0, 0);
  scratch.dummy.scale.set(1, scale, scale);
  scratch.dummy.updateMatrix();
  mesh.setMatrixAt(index, scratch.dummy.matrix);
  mesh.setColorAt(index, tintColor(scratch, card.tint));
}

function writeCards(
  mesh: THREE.InstancedMesh,
  cards: readonly PlanningCard[],
  born: Map<string, number>,
  now: number,
  scratch: Scratch,
): Map<string, number> {
  const nextBorn = new Map<string, number>();
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const bornAt = born.get(card.key) ?? now;
    nextBorn.set(card.key, bornAt);
    writeCard(mesh, card, cardScale(now - bornAt), index, scratch);
  }
  mesh.count = cards.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return nextBorn;
}

function isAnimating(
  cards: readonly PlanningCard[],
  born: Map<string, number>,
  now: number,
): boolean {
  for (const card of cards) {
    const bornAt = born.get(card.key);
    if (bornAt === undefined || now - bornAt < CARD_SCALE_SECONDS) return true;
  }
  return false;
}

export function PlanningBoard() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const cards = useRef<readonly PlanningCard[]>([]);
  const born = useRef(new Map<string, number>());
  const signature = useRef<string | null>(null);
  const lastSnapshot = useRef<WorldSnapshot | null | undefined>(undefined);
  const elapsed = useRef(SIGNATURE_INTERVAL_SECONDS);
  const animating = useRef(false);

  const scratchRef = useRef<Scratch | null>(null);
  if (scratchRef.current === null) {
    scratchRef.current = {
      dummy: new THREE.Object3D(),
      tints: new Map(),
    };
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The engine caches a bounding sphere on first cull. With count 0 that
    // sphere would sit empty at the group origin, so give the mesh a fixed
    // sphere that covers every card position on the board face instead.
    const centerY = BOARD_BOTTOM_Y + PLANNING_BOARD.height / 2;
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CARD_X, centerY, BOARD_CENTER_Z),
      Math.hypot(PLANNING_BOARD.width / 2, PLANNING_BOARD.height / 2) + 0.1,
    );
    // Allocate the instance colour buffer before the first render so the
    // first card write cannot force a shader recompile.
    mesh.setColorAt(0, new THREE.Color("#ffffff"));
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const scratch = scratchRef.current;
    if (!mesh || !scratch) return;

    elapsed.current += delta;
    if (elapsed.current >= SIGNATURE_INTERVAL_SECONDS) {
      elapsed.current = 0;
      const snapshot = liveWorld.current;
      // Building the card list and signature is pointless until the backend
      // publishes another snapshot; the signature stays the redraw gate.
      if (snapshot !== lastSnapshot.current) {
        lastSnapshot.current = snapshot;
        const nextCards = planningCards(snapshot?.tasks ?? []);
        const nextSignature = planningSignature(nextCards);
        if (nextSignature !== signature.current) {
          signature.current = nextSignature;
          cards.current = nextCards;
          const now = performance.now() / 1000;
          born.current = writeCards(mesh, nextCards, born.current, now, scratch);
          animating.current = isAnimating(nextCards, born.current, now);
        }
      }
    }

    if (!animating.current) return;
    const now = performance.now() / 1000;
    let stillAnimating = false;
    const current = cards.current;
    for (let index = 0; index < current.length; index += 1) {
      const card = current[index];
      const bornAt = born.current.get(card.key) ?? now;
      const age = now - bornAt;
      writeCard(mesh, card, cardScale(age), index, scratch);
      if (age < CARD_SCALE_SECONDS) stillAnimating = true;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    animating.current = stillAnimating;
  });

  return (
    <group
      position={[PLANNING_BOARD_CENTER.x, 0, PLANNING_BOARD_CENTER.z]}
      rotation-y={PLANNING_BOARD_ROTATION}
    >
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 1.5, 0]}
        scale={[0.16, 2.98, 4.42]}
        castShadow
      />
      <mesh
        geometry={boardPlane}
        material={materials.board}
        position={[PLANNING_BOARD_FACE_OFFSET, 1.55, 0]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[-0.28, 0.1, -1.25]}
        scale={[0.5, 0.2, 0.4]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[-0.28, 0.1, 1.25]}
        scale={[0.5, 0.2, 0.4]}
      />
      <instancedMesh
        ref={meshRef}
        args={[cardGeometry, materials.stickyCard, PLANNING_CARD_LIMIT]}
        castShadow
      />
    </group>
  );
}
