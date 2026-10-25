"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLANNING_BOARD_CENTER } from "@/simulation/worldLayout";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  geometries,
  materials,
  sharedGeometry,
  sharedMaterial,
} from "./sharedResources";
import {
  PLANNING_BOARD,
  PLANNING_BOARD_FACE_OFFSET,
  PLANNING_BOARD_ROTATION,
  BOARD_FEET_DEPTH,
  CARD_SCALE_SECONDS,
  PLANNING_BOARD_FRAME_WIDTH,
  PLANNING_CARD_LIMIT,
  cardScale,
  planningCards,
  planningSignature,
  planningStatus,
  type PlanningCard,
  type PlanningStatus,
} from "./planningContent";
import { stationWorking } from "./stationPresence";
import { getAgentProfile } from "@/agents/AgentRegistry";
import {
  createStripSurface,
  drawStrip,
  type StripSurface,
  type StripStyle,
} from "./boardStrip";

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
const SIGNATURE_INTERVAL_SECONDS = 0.2;
/** Feet are 0.5 m deep boxes; their back edge sits at BOARD_FEET_DEPTH. */
const FOOT_X = 0.25 - BOARD_FEET_DEPTH;
const GLOW_LAMBDA = 5;
const IDLE_GLOW = 0.4;
const ACTIVE_GLOW = 2.3;
const STRIP_WIDTH = PLANNING_BOARD.width - 0.24;
const STRIP_HEIGHT = 0.16;
const STRIP_Y = BOARD_BOTTOM_Y + 0.12;
const STRIP_STYLE: StripStyle = {
  accent: "#f0b429",
  background: "#1d2733",
  track: "#3a4757",
  text: "#e8edf2",
  muted: "#8a97a6",
};

const glowMaterial = sharedMaterial(
  "planning-board-glow",
  () =>
    new THREE.MeshStandardMaterial({
      color: "#0b1119",
      emissive: "#f0b429",
      emissiveIntensity: IDLE_GLOW,
      roughness: 0.34,
      metalness: 0.28,
    }),
);

let stripSurface: StripSurface | null = null;
function planningStrip(): StripSurface {
  if (stripSurface === null) {
    stripSurface = createStripSurface(STRIP_WIDTH, STRIP_HEIGHT);
  }
  return stripSurface;
}

const stripMaterial = sharedMaterial(
  "planning-board-strip",
  () =>
    new THREE.MeshStandardMaterial({
      map: planningStrip().texture,
      emissiveMap: planningStrip().texture,
      emissive: "#ffffff",
      emissiveIntensity: 0.5,
      transparent: true,
      roughness: 0.6,
      metalness: 0,
    }),
);
const stripPlane = sharedGeometry(
  "planning-board-strip-plane",
  () => new THREE.PlaneGeometry(STRIP_WIDTH, STRIP_HEIGHT),
);

function stripSignature(status: PlanningStatus | null): string {
  return status === null
    ? "idle"
    : `${status.taskId}:${status.percent}:${status.cards}`;
}

function paintStrip(status: PlanningStatus | null): void {
  drawStrip(
    planningStrip(),
    status === null
      ? {
          label: "SPRINT BOARD READY - WAITING FOR THE NEXT TASK",
          ratio: null,
          percentText: "--",
        }
      : {
          label: `${getAgentProfile("piper").name.toUpperCase()} PLANNING ${status.taskId} - ${status.cards} ${status.cards === 1 ? "CARD" : "CARDS"}`,
          ratio: status.ratio,
          percentText: `${status.percent}%`,
        },
    STRIP_STYLE,
  );
}

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
  calm: boolean,
): Map<string, number> {
  const nextBorn = new Map<string, number>();
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const bornAt = born.get(card.key) ?? now;
    nextBorn.set(card.key, bornAt);
    writeCard(mesh, card, calm ? 1 : cardScale(now - bornAt), index, scratch);
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
  const stripKey = useRef<string | null>(null);

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
    // Card z is BOARD_CENTER_Z - u, so a centred grid spans both sides of 0.
    const centerY = BOARD_BOTTOM_Y + PLANNING_BOARD.height / 2;
    const centerZ = BOARD_CENTER_Z - PLANNING_BOARD.width / 2;
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CARD_X, centerY, centerZ),
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

    glowMaterial.emissiveIntensity = THREE.MathUtils.damp(
      glowMaterial.emissiveIntensity,
      stationWorking(liveWorld.current, "planning", "planning")
        ? ACTIVE_GLOW
        : IDLE_GLOW,
      GLOW_LAMBDA,
      delta,
    );

    elapsed.current += delta;
    if (elapsed.current >= SIGNATURE_INTERVAL_SECONDS) {
      elapsed.current = 0;
      const snapshot = liveWorld.current;
      // Building the card list and signature is pointless until the backend
      // publishes another snapshot; the signature stays the redraw gate.
      if (snapshot !== lastSnapshot.current) {
        lastSnapshot.current = snapshot;
        const status = planningStatus(snapshot?.tasks ?? []);
        const statusKey = stripSignature(status);
        if (statusKey !== stripKey.current) {
          stripKey.current = statusKey;
          paintStrip(status);
        }
        const nextCards = planningCards(snapshot?.tasks ?? []);
        const nextSignature = planningSignature(nextCards);
        if (nextSignature !== signature.current) {
          signature.current = nextSignature;
          cards.current = nextCards;
          const now = performance.now() / 1000;
          const calm = reducedMotion.current;
          born.current = writeCards(
            mesh,
            nextCards,
            born.current,
            now,
            scratch,
            calm,
          );
          animating.current = !calm && isAnimating(nextCards, born.current, now);
        }
      }
    }

    if (!animating.current) return;
    const now = performance.now() / 1000;
    const calm = reducedMotion.current;
    let stillAnimating = false;
    const current = cards.current;
    for (let index = 0; index < current.length; index += 1) {
      const card = current[index];
      const bornAt = born.current.get(card.key) ?? now;
      const age = now - bornAt;
      writeCard(mesh, card, calm ? 1 : cardScale(age), index, scratch);
      if (!calm && age < CARD_SCALE_SECONDS) stillAnimating = true;
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
        scale={[0.16, 2.98, PLANNING_BOARD_FRAME_WIDTH]}
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
        material={glowMaterial}
        position={[PLANNING_BOARD_FACE_OFFSET + 0.05, 2.82, 0]}
        scale={[0.05, 0.03, PLANNING_BOARD.width]}
      />
      <mesh
        geometry={stripPlane}
        material={stripMaterial}
        position={[PLANNING_BOARD_FACE_OFFSET + 0.004, STRIP_Y, 0]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[FOOT_X, 0.1, -1.25]}
        scale={[0.5, 0.2, 0.4]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[FOOT_X, 0.1, 1.25]}
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
