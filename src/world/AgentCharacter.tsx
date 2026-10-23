"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type {
  AgentId,
  AgentProfile,
  AgentRole,
  AgentState,
  AgentStatus,
} from "@/agents/agentTypes";
import { CORE_AGENT_IDS, MAX_AGENTS } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { colorForAgent } from "@/agents/agentPalette";
import { AgentAnimator } from "@/agents/AgentAnimator";
import {
  HEADING_LAMBDA,
  POSITION_LAMBDA,
  animationTimeScale,
  dampAngle,
  dampValue,
  isTeleport,
} from "@/agents/agentMath";
import { animatorInputsFor, chestHeight, rigFor } from "@/agents/agentRigs";
import type { AgentRig } from "@/agents/agentRigs";
import { AgentSlotAllocator } from "@/agents/agentSlots";
import { ACCENT_POOLS, ACCESSORY_POOLS } from "@/agents/robotAccessories";
import { liveWorld, useWorldStore, type WorldStore } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  agentVisualFor,
  findAgentState,
  releaseAgentVisual,
} from "./agentVisuals";
import { labelAnchorFor, releaseLabelAnchor } from "@/world/labelAnchors";
import {
  MAX_ROBOTS,
  PULSE_DURATION,
  ROBOT_CAPSULE_COUNT,
  ROBOT_FOOT_COUNT,
  ROBOT_HAND_COUNT,
  ROBOT_HEAD_COUNT,
  SELECTION_COLOR,
  accessoryInstanceCount,
  clearRobotSlot,
  setRobotColor,
  writeLabelAnchor,
  writeRings,
  writeRobotMatrices,
  type RobotPools,
  type RobotRings,
} from "./robotRig";
import {
  geometries,
  hoverRingMaterial,
  materials,
  sharedMaterial,
} from "./sharedResources";

/**
 * The procedural robots. Part geometry is pooled the same way as phase 4,
 * but the roster is now dynamic: core agents take slots 0..5, live agents
 * acquire a free slot on spawn and release it once their despawn animation
 * has finished. One `AgentCharacter` marker exists per current id (keyed by
 * id); the pooled frame loop draws them all.
 */

const accessoryMaterial = sharedMaterial(
  "robot-accessory-accent",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      toneMapped: false,
    }),
);

const chestMaterial = sharedMaterial(
  "robot-chest-accent",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      toneMapped: false,
    }),
);

const statusRingMaterial = sharedMaterial(
  "robot-status-ring",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
);

const pulseRingMaterial = sharedMaterial(
  "robot-pulse-ring",
  () =>
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
);

const selectionRingMaterial = hoverRingMaterial(SELECTION_COLOR);

/** Reduced motion keeps a ring but never animates its radius or opacity. */
const CALM_PULSE_PROGRESS = 0.35;
/** Spawn and despawn scale (and so fade) over this many real seconds. */
const SPAWN_SECONDS = 0.4;
const CREATE_RETRY_SECONDS = 0.5;
/** Scratch list reused each frame, so finishing a robot allocates nothing. */
const finishedScratch: AgentId[] = [];

interface VisualState {
  id: AgentId;
  slot: number;
  role: AgentRole;
  rig: AgentRig;
  color: THREE.Color;
  animator: AgentAnimator;
  legLength: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  lastStatus: AgentStatus;
  pulse: number;
  pulseTone: "success" | "error";
  initialized: boolean;
  spawn: number;
  removed: boolean;
  despawn: number;
  /** Cached hover target string, so the frame loop never builds one. */
  hoverKey: string;
}

interface AgentFrameContext {
  camera: THREE.Camera;
  width: number;
  height: number;
  running: boolean;
  calm: boolean;
  store: WorldStore;
  pools: RobotPools;
  rings: RobotRings;
}

/** One slot allocation is enough for the whole tab. */
const coreSlot = (id: AgentId): number | null => {
  const index = CORE_AGENT_IDS.indexOf(id);
  return index === -1 ? null : index;
};

/** Start a robot where the first snapshot says it is, never at the origin. */
function initializeVisual(
  visual: VisualState,
  agent: AgentState | undefined,
): void {
  if (agent) {
    visual.x = agent.position.x;
    visual.z = agent.position.z;
    visual.heading = agent.heading;
  }
  visual.initialized = true;
}

function updateVisualStatus(
  visual: VisualState,
  agent: AgentState | undefined,
  delta: number,
  running: boolean,
): AgentStatus {
  const status: AgentStatus = agent?.status ?? "idle";
  if (status !== visual.lastStatus) {
    if (status === "success" || status === "error") {
      visual.pulse = 0;
      visual.pulseTone = status;
    }
    visual.lastStatus = status;
  }

  const frozen = agent === undefined || agent.paused || !running;
  if (visual.pulse < PULSE_DURATION) {
    visual.pulse = Math.min(
      PULSE_DURATION,
      visual.pulse + delta * animationTimeScale(frozen),
    );
  }
  return status;
}

function updateVisualMotion(
  visual: VisualState,
  agent: AgentState | undefined,
  delta: number,
  running: boolean,
): AgentStatus {
  if (!visual.initialized) initializeVisual(visual, agent);

  const targetX = agent ? agent.position.x : visual.x;
  const targetZ = agent ? agent.position.z : visual.z;
  const beforeX = visual.x;
  const beforeZ = visual.z;
  let snapped = false;

  if (isTeleport(visual.x, visual.z, targetX, targetZ)) {
    visual.x = targetX;
    visual.z = targetZ;
    visual.heading = agent ? agent.heading : visual.heading;
    visual.speed = 0;
    snapped = true;
  } else {
    visual.x = THREE.MathUtils.damp(visual.x, targetX, POSITION_LAMBDA, delta);
    visual.z = THREE.MathUtils.damp(visual.z, targetZ, POSITION_LAMBDA, delta);
  }

  if (agent) {
    const heading = dampAngle(
      visual.heading,
      agent.heading,
      HEADING_LAMBDA,
      delta,
    );
    visual.heading = snapped ? agent.heading : heading;
  }

  if (!snapped && delta > 0) {
    const moved = Math.hypot(visual.x - beforeX, visual.z - beforeZ);
    const instantSpeed = Math.min(moved / delta, 12);
    visual.speed = dampValue(visual.speed, instantSpeed, 6, delta);
  } else {
    visual.speed = dampValue(visual.speed, 0, 6, delta);
  }

  return updateVisualStatus(visual, agent, delta, running);
}

function ringEnergy(animator: AgentAnimator, paused: boolean): number {
  const workWeight = Math.max(
    animator.weights.working,
    animator.weights.thinking,
    animator.weights.communicating,
  );
  return Math.min(1.15, 0.22 + workWeight * 0.76 + (paused ? 0 : 0.08));
}

/** Publish the damped pose that comm arcs, hit boxes and labels read. */
function publishVisualPose(visual: VisualState, visualScale: number): void {
  const poseOut = agentVisualFor(visual.id);
  const drawn = visual.rig.scale * visualScale;
  poseOut.x = visual.x;
  poseOut.z = visual.z;
  poseOut.heading = visual.heading;
  poseOut.scale = drawn;
  poseOut.chestY = chestHeight(visual.rig) * drawn;
  poseOut.labelY = visual.rig.labelY * drawn;
}

function markPoolsDirty(pools: RobotPools, rings: RobotRings): void {
  if (pools.capsules) pools.capsules.instanceMatrix.needsUpdate = true;
  if (pools.heads) pools.heads.instanceMatrix.needsUpdate = true;
  if (pools.chests) {
    pools.chests.instanceMatrix.needsUpdate = true;
    if (pools.chests.instanceColor) pools.chests.instanceColor.needsUpdate = true;
  }
  for (const pool of ACCESSORY_POOLS) {
    const mesh = pools.accessories[pool];
    if (mesh) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  if (rings.status) {
    rings.status.instanceMatrix.needsUpdate = true;
    if (rings.status.instanceColor) rings.status.instanceColor.needsUpdate = true;
  }
  if (rings.selection) rings.selection.instanceMatrix.needsUpdate = true;
  if (rings.pulse) {
    rings.pulse.instanceMatrix.needsUpdate = true;
    if (rings.pulse.instanceColor) rings.pulse.instanceColor.needsUpdate = true;
  }
  if (rings.shadows) rings.shadows.instanceMatrix.needsUpdate = true;
}

function easeScale(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/** One per agent id, keyed by id. The pooled loop does the drawing. */
export function AgentCharacter({ agentId }: { agentId: AgentId }) {
  void agentId;
  return null;
}

const ACCESSORY_GEOMETRIES: Record<
  (typeof ACCESSORY_POOLS)[number],
  THREE.BufferGeometry
> = {
  accentBoxes: geometries.box,
  jointBoxes: geometries.box,
  jointCylinders: geometries.cylinder,
  jointSpheres: geometries.sphere,
  accentSpheres: geometries.sphere,
  accentRings: geometries.ring,
};

export function AgentCharacters({ high }: { high: boolean }) {
  const capsules = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const chests = useRef<THREE.InstancedMesh>(null);
  const statusRings = useRef<THREE.InstancedMesh>(null);
  const selectionRings = useRef<THREE.InstancedMesh>(null);
  const pulseRings = useRef<THREE.InstancedMesh>(null);
  const shadows = useRef<THREE.InstancedMesh>(null);
  const poolRefs = useRef<Record<string, THREE.InstancedMesh | null>>({
    accentBoxes: null,
    jointBoxes: null,
    jointCylinders: null,
    jointSpheres: null,
    accentSpheres: null,
    accentRings: null,
  });
  const pools = useRef<RobotPools>({
    capsules: null,
    heads: null,
    chests: null,
    accessories: {
      accentBoxes: null,
      jointBoxes: null,
      jointCylinders: null,
      jointSpheres: null,
      accentSpheres: null,
      accentRings: null,
    },
  });
  const rings = useRef<RobotRings>({
    status: null,
    selection: null,
    pulse: null,
    shadows: null,
  });

  const visuals = useRef<Map<AgentId, VisualState>>(new Map());
  const allocator = useRef<AgentSlotAllocator | null>(null);
  const nextCreateRetry = useRef(0);
  if (allocator.current === null) {
    allocator.current = new AgentSlotAllocator(CORE_AGENT_IDS.length, MAX_AGENTS);
  }
  const frameContext = useRef<AgentFrameContext | null>(null);

  const agents = useWorldStore((state) => state.world?.agents);

  const createVisual = (agent: AgentState): VisualState | null => {
    const id = agent.id;
    if (visuals.current.has(id)) return visuals.current.get(id) ?? null;
    const slots = allocator.current;
    if (slots === null) return null;

    const fixed = coreSlot(id);
    const slot = fixed ?? slots.acquire();
    if (slot === null) return null;

    const profile: AgentProfile = getAgentProfile(id);
    const role = profile.role;
    const rig = rigFor(role);
    const color = new THREE.Color(
      profile.kind === "core" ? profile.color : colorForAgent(id),
    );
    const visual: VisualState = {
      id,
      slot,
      role,
      rig,
      color,
      animator: new AgentAnimator(),
      legLength: animatorInputsFor(rig).legLength,
      x: agent.position.x,
      z: agent.position.z,
      heading: agent.heading,
      speed: 0,
      lastStatus: "idle",
      pulse: PULSE_DURATION,
      pulseTone: "success",
      initialized: true,
      spawn: profile.kind === "core" ? 1 : 0,
      removed: false,
      despawn: 0,
      hoverKey: `agent:${id}`,
    };
    visuals.current.set(id, visual);
    setRobotColor(slot, role, color, pools.current);
    return visual;
  };

  const dropVisual = (id: AgentId): void => {
    const visual = visuals.current.get(id);
    if (!visual) return;
    clearRobotSlot(visual.slot, pools.current, rings.current);
    if (coreSlot(id) === null) allocator.current?.release(visual.slot);
    visuals.current.delete(id);
    releaseAgentVisual(id);
    releaseLabelAnchor(id);
  };

  useLayoutEffect(() => {
    pools.current.capsules = capsules.current;
    pools.current.heads = heads.current;
    pools.current.chests = chests.current;
    pools.current.accessories = poolRefs.current as RobotPools["accessories"];
    rings.current.status = statusRings.current;
    rings.current.selection = selectionRings.current;
    rings.current.pulse = pulseRings.current;
    rings.current.shadows = shadows.current;

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const color = new THREE.Color();
    color.setRGB(0, 0, 0);

    for (const mesh of [
      capsules.current,
      heads.current,
      chests.current,
      statusRings.current,
      selectionRings.current,
      pulseRings.current,
      shadows.current,
      ...Object.values(poolRefs.current),
    ]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.setMatrixAt(index, zero);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (let index = 0; index < MAX_ROBOTS; index += 1) {
      statusRings.current?.setColorAt(index, color);
      pulseRings.current?.setColorAt(index, color);
    }
    color.setRGB(1, 1, 1);
    for (let index = 0; index < MAX_ROBOTS; index += 1) {
      shadows.current?.setColorAt(index, color);
      chests.current?.setColorAt(index, color);
    }
    for (const mesh of [statusRings.current, pulseRings.current]) {
      if (mesh?.instanceColor) {
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    if (chests.current?.instanceColor) {
      chests.current.instanceColor.setUsage(THREE.DynamicDrawUsage);
      chests.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    const visualsMap = visuals.current;
    const slots = allocator.current;
    return () => {
      // Unmount leaves the whole pool behind: drop the per-agent records and
      // anchors so a StrictMode remount starts from a clean slate.
      for (const id of visualsMap.keys()) {
        releaseAgentVisual(id);
        releaseLabelAnchor(id);
      }
      visualsMap.clear();
      slots?.reset();
    };
  }, []);

  useFrame((frame, delta) => {
    const snapshot = liveWorld.current;
    const liveAgents = snapshot?.agents;
    const running = snapshot?.status === "running";

    // Any agent in the authoritative snapshot without a visual was spawned
    // while React still showed the previous mirror.
    if (liveAgents) {
      for (const agent of liveAgents) {
        if (visuals.current.has(agent.id)) continue;
        // A full pool must not retry (and allocate) every frame.
        if (frame.clock.elapsedTime < nextCreateRetry.current) continue;
        if (createVisual(agent) === null && coreSlot(agent.id) === null) {
          nextCreateRetry.current = frame.clock.elapsedTime + CREATE_RETRY_SECONDS;
        }
      }
    }

    // The controller moved the camera earlier this frame; refresh its world
    // matrices so the projected bubble anchors match the current frame.
    const camera = frame.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    let context = frameContext.current;
    if (context === null) {
      context = {
        camera,
        width: frame.size.width,
        height: frame.size.height,
        running,
        calm: reducedMotion.current,
        store: useWorldStore.getState(),
        pools: pools.current,
        rings: rings.current,
      };
      frameContext.current = context;
    }
    context.camera = camera;
    context.width = frame.size.width;
    context.height = frame.size.height;
    context.running = running;
    context.calm = reducedMotion.current;
    context.store = useWorldStore.getState();
    context.pools = pools.current;
    context.rings = rings.current;

    const calm = context.calm;
    finishedScratch.length = 0;

    for (const visual of visuals.current.values()) {
      const agent = findAgentState(liveAgents, visual.id);
      if (agent) {
        if (visual.removed) {
          // Reappeared mid-despawn: smoothstep is symmetric, so this spawn
          // value reproduces the current fade-out scale and eases back up.
          visual.spawn = Math.max(0, 1 - visual.despawn / SPAWN_SECONDS);
          visual.despawn = 0;
        }
        visual.removed = false;
        if (visual.spawn < 1) {
          visual.spawn = calm ? 1 : Math.min(1, visual.spawn + delta / SPAWN_SECONDS);
        }
      } else {
        const isCore = coreSlot(visual.id) !== null;
        if (isCore) {
          // A transient core omission must not erase a station owner.
          visual.removed = false;
        } else if (!visual.removed) {
          visual.removed = true;
          visual.despawn = 0;
        }
        if (visual.removed) {
          visual.despawn += delta;
          if (calm || visual.despawn >= SPAWN_SECONDS) {
            finishedScratch.push(visual.id);
            continue;
          }
        }
      }

      const status = updateVisualMotion(visual, agent, delta, running);
      const frozen = agent === undefined || agent.paused || !running;
      const pose = visual.animator.update(
        delta,
        status,
        visual.speed,
        frozen,
        visual.legLength,
        calm,
      );

      let visualScale = 1;
      if (!calm) {
        if (visual.removed) {
          visualScale = 1 - easeScale(visual.despawn / SPAWN_SECONDS);
        } else if (visual.spawn < 1) {
          visualScale = easeScale(visual.spawn);
        }
      }

      publishVisualPose(visual, visualScale);

      const root = writeRobotMatrices(
        visual.slot,
        pose,
        visual.rig,
        visual.role,
        visual.x,
        visual.z,
        visual.heading,
        visualScale,
        context.pools,
      );

      const highlighted =
        context.store.selectedAgentId === visual.id ||
        context.store.hovered === visual.hoverKey;
      writeRings(
        visual.slot,
        visual.color,
        ringEnergy(visual.animator, agent?.paused ?? false),
        highlighted,
        visual.pulse < PULSE_DURATION,
        calm
          ? CALM_PULSE_PROGRESS
          : Math.min(1, visual.pulse / PULSE_DURATION),
        visual.pulseTone,
        root,
        context.rings,
      );

      writeLabelAnchor(
        visual.id,
        visual.x,
        visual.z,
        visual.rig,
        visualScale,
        context.camera,
        context.width,
        context.height,
        labelAnchorFor(visual.id),
      );
    }

    if (finishedScratch.length > 0) {
      for (const id of finishedScratch) dropVisual(id);
      finishedScratch.length = 0;
    }

    markPoolsDirty(context.pools, context.rings);
  });

  const shownAgents = agents ?? [];
  return (
    <group name="agents">
      {shownAgents.map((agent) => (
        <AgentCharacter key={agent.id} agentId={agent.id} />
      ))}
      <instancedMesh
        ref={capsules}
        args={[geometries.capsule, materials.ceramic, ROBOT_CAPSULE_COUNT]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={heads}
        args={[geometries.sphere, materials.ceramic, ROBOT_HEAD_COUNT]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={chests}
        args={[geometries.box, chestMaterial, MAX_ROBOTS]}
        castShadow={high}
        frustumCulled={false}
      />

      {ACCESSORY_POOLS.map((pool) => (
        <instancedMesh
          key={pool}
          ref={(node) => {
            poolRefs.current[pool] = node;
          }}
          args={[
            ACCESSORY_GEOMETRIES[pool],
            ACCENT_POOLS.has(pool) ? accessoryMaterial : materials.joint,
            pool === "jointSpheres"
              ? ROBOT_HAND_COUNT
              : pool === "jointBoxes"
                ? ROBOT_FOOT_COUNT
                : accessoryInstanceCount(pool),
          ]}
          castShadow={high}
          frustumCulled={false}
        />
      ))}

      <instancedMesh
        ref={statusRings}
        args={[geometries.ring, statusRingMaterial, MAX_ROBOTS]}
        renderOrder={1}
        frustumCulled={false}
      />
      <instancedMesh
        ref={selectionRings}
        args={[geometries.ring, selectionRingMaterial, MAX_ROBOTS]}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh
        ref={pulseRings}
        args={[geometries.ring, pulseRingMaterial, MAX_ROBOTS]}
        renderOrder={3}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shadows}
        args={[geometries.plane, materials.contactShadow, MAX_ROBOTS]}
        renderOrder={0}
        frustumCulled={false}
      />
    </group>
  );
}
