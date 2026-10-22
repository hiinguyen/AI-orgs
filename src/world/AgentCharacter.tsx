"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId, AgentState, AgentStatus } from "@/agents/agentTypes";
import { AgentAnimator } from "@/agents/AgentAnimator";
import {
  HEADING_LAMBDA,
  POSITION_LAMBDA,
  animationTimeScale,
  dampAngle,
  dampValue,
  isTeleport,
} from "@/agents/agentMath";
import { animatorInputsFor, chestHeight } from "@/agents/agentRigs";
import { ACCENT_POOLS } from "@/agents/robotAccessories";
import {
  liveWorld,
  useWorldStore,
  type WorldStore,
} from "@/state/useWorldStore";
import { agentVisuals, findAgentState } from "./agentVisuals";
import { labelAnchorFor } from "@/world/labelAnchors";
import {
  ACCESSORY_LAYOUT,
  ACCESSORY_POOLS,
  JOINT_BOX_COUNT,
  JOINT_SPHERE_COUNT,
  PULSE_DURATION,
  ROBOT_COLORS,
  ROBOT_COUNT,
  ROBOT_HOVER_IDS,
  ROBOT_PROFILES,
  ROBOT_RIGS,
  SELECTION_COLOR,
  writeLabelAnchor,
  writeRings,
  writeRobotMatrices,
  type AccessoryPool,
  type RobotPools,
  type RobotRings,
} from "./robotRig";
import {
  accentMaterial,
  geometries,
  hoverRingMaterial,
  materials,
  sharedMaterial,
} from "./sharedResources";

/**
 * The six procedural robots, drawn as twelve instanced part pools plus six
 * emissive chest accents rather than per-character mesh trees. Six characters
 * times roughly fifteen parts would add ninety draw calls; pooling by part
 * type leaves the whole team at a fraction of that, which keeps the overview
 * under the 150-call budget. Each instance still gets its own rig-scaled
 * transform, so the roles keep distinct silhouettes.
 */

const accessoryMaterial = sharedMaterial(
  "robot-accessory-accent",
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

interface VisualState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  animator: AgentAnimator;
  lastStatus: AgentStatus;
  pulse: number;
  pulseTone: "success" | "error";
  initialized: boolean;
}

function createVisualState(id: AgentId): VisualState {
  const pose = agentVisuals[id];
  return {
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    speed: 0,
    animator: new AgentAnimator(),
    lastStatus: "idle",
    pulse: PULSE_DURATION,
    pulseTone: "success",
    initialized: false,
  };
}

function createVisuals(): Record<AgentId, VisualState> {
  return {
    orion: createVisualState("orion"),
    iris: createVisualState("iris"),
    piper: createVisualState("piper"),
    kai: createVisualState("kai"),
    quinn: createVisualState("quinn"),
    rex: createVisualState("rex"),
  };
}

interface AgentFrameContext {
  camera: THREE.Camera;
  width: number;
  height: number;
  running: boolean;
  store: WorldStore;
  pools: RobotPools;
  rings: RobotRings;
}

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

/**
 * Track a status edge, arm the success/error pulse and advance it. Returns
 * the status the pose should blend towards.
 */
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

  const frozen = !agent || agent.paused || !running;
  if (visual.pulse < PULSE_DURATION) {
    // Real time, so a pause cannot freeze a bright ring; the usual
    // frozen slow-down keeps the pulse from ticking while paused.
    visual.pulse = Math.min(
      PULSE_DURATION,
      visual.pulse + delta * animationTimeScale(frozen),
    );
  }

  return status;
}

/**
 * Damp the drawn position, heading and measured speed towards the snapshot.
 * Returns the status the pose should blend towards.
 */
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
    // Keep the cap above 4x walk speed so the stride stays matched when the
    // robot really moves that fast.
    const instantSpeed = Math.min(moved / delta, 12);
    visual.speed = dampValue(visual.speed, instantSpeed, 6, delta);
  } else {
    visual.speed = dampValue(visual.speed, 0, 6, delta);
  }

  return updateVisualStatus(visual, agent, delta, running);
}

/**
 * Brightness of the floor status ring: working, thinking and communicating
 * agents read brighter than idle ones.
 */
function ringEnergy(animator: AgentAnimator, paused: boolean): number {
  const workWeight = Math.max(
    animator.weights.working,
    animator.weights.thinking,
    animator.weights.communicating,
  );
  return Math.min(1.15, 0.22 + workWeight * 0.76 + (paused ? 0 : 0.08));
}

/** Publish the damped pose that comm arcs, hit boxes and labels read. */
function publishVisualPose(
  profile: (typeof ROBOT_PROFILES)[number],
  visual: VisualState,
  rig: (typeof ROBOT_RIGS)[number],
): void {
  const poseOut = agentVisuals[profile.id];
  poseOut.x = visual.x;
  poseOut.z = visual.z;
  poseOut.heading = visual.heading;
  poseOut.scale = rig.scale;
  poseOut.chestY = chestHeight(rig) * rig.scale;
  poseOut.labelY = rig.labelY * rig.scale;
}

/** Floor decals: status energy, selection/hover ring and pulse. */
function writeAgentRings(
  agentIndex: number,
  visual: VisualState,
  agent: AgentState | undefined,
  store: WorldStore,
  root: THREE.Matrix4,
  rings: RobotRings,
): void {
  const highlighted =
    store.selectedAgentId === ROBOT_PROFILES[agentIndex].id ||
    store.hovered === ROBOT_HOVER_IDS[agentIndex];
  writeRings(
    agentIndex,
    ringEnergy(visual.animator, agent?.paused ?? false),
    highlighted,
    visual.pulse < PULSE_DURATION,
    Math.min(1, visual.pulse / PULSE_DURATION),
    visual.pulseTone,
    root,
    rings,
  );
}

/** Pose, matrices, floor rings and label anchor for one robot. */
function writeAgentVisual(
  agentIndex: number,
  visual: VisualState,
  status: AgentStatus,
  agent: AgentState | undefined,
  delta: number,
  context: AgentFrameContext,
): void {
  const profile = ROBOT_PROFILES[agentIndex];
  const rig = ROBOT_RIGS[agentIndex];
  const frozen = !agent || agent.paused || !context.running;
  const pose = visual.animator.update(
    delta,
    status,
    visual.speed,
    frozen,
    animatorInputsFor(rig).legLength,
  );

  publishVisualPose(profile, visual, rig);

  const root = writeRobotMatrices(
    agentIndex,
    pose,
    rig,
    visual.x,
    visual.z,
    visual.heading,
    context.pools,
  );

  writeAgentRings(
    agentIndex,
    visual,
    agent,
    context.store,
    root,
    context.rings,
  );

  writeLabelAnchor(
    profile.id,
    visual.x,
    visual.z,
    rig,
    context.camera,
    context.width,
    context.height,
    labelAnchorFor(profile.id),
  );
}

/** Flag every instanced buffer that `writeAgentVisual` filled this frame. */
function markPoolsDirty(pools: RobotPools, rings: RobotRings): void {
  if (pools.capsules) pools.capsules.instanceMatrix.needsUpdate = true;
  if (pools.heads) pools.heads.instanceMatrix.needsUpdate = true;
  for (const pool of ACCESSORY_POOLS) {
    const mesh = pools.accessories[pool];
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
  }
  if (rings.status) {
    rings.status.instanceMatrix.needsUpdate = true;
    if (rings.status.instanceColor) {
      rings.status.instanceColor.needsUpdate = true;
    }
  }
  if (rings.selection) {
    rings.selection.instanceMatrix.needsUpdate = true;
  }
  if (rings.pulse) {
    rings.pulse.instanceMatrix.needsUpdate = true;
    if (rings.pulse.instanceColor) {
      rings.pulse.instanceColor.needsUpdate = true;
    }
  }
  if (rings.shadows) {
    rings.shadows.instanceMatrix.needsUpdate = true;
  }
}

export function AgentCharacters({ high }: { high: boolean }) {
  const capsules = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const chests = useRef<Array<THREE.Mesh | null>>([]);
  const statusRings = useRef<THREE.InstancedMesh>(null);
  const selectionRings = useRef<THREE.InstancedMesh>(null);
  const pulseRings = useRef<THREE.InstancedMesh>(null);
  const shadows = useRef<THREE.InstancedMesh>(null);
  const poolRefs = useRef<Record<AccessoryPool, THREE.InstancedMesh | null>>({
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
    chests: [],
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

  const visuals = useRef<Record<AgentId, VisualState> | null>(null);
  if (visuals.current === null) visuals.current = createVisuals();
  const frameContext = useRef<AgentFrameContext | null>(null);

  useLayoutEffect(() => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const color = new THREE.Color();

    pools.current.capsules = capsules.current;
    pools.current.heads = heads.current;
    pools.current.chests = chests.current;
    pools.current.accessories = poolRefs.current;
    rings.current.status = statusRings.current;
    rings.current.selection = selectionRings.current;
    rings.current.pulse = pulseRings.current;
    rings.current.shadows = shadows.current;

    for (const mesh of [
      capsules.current,
      heads.current,
      statusRings.current,
      selectionRings.current,
      pulseRings.current,
      shadows.current,
      ...Object.values(poolRefs.current),
    ]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Nothing should be drawn until the first frame writes real matrices.
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.setMatrixAt(index, zero);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Accent parts take the owning agent's colour once; the colour never
    // changes, only the transforms do.
    for (const pool of ACCENT_POOLS) {
      const mesh = poolRefs.current[pool];
      if (!mesh) continue;
      for (let agentIndex = 0; agentIndex < ROBOT_COUNT; agentIndex += 1) {
        color.copy(ROBOT_COLORS[agentIndex]);
        for (const slot of ACCESSORY_LAYOUT.slots[agentIndex]) {
          if (slot.pool !== pool) continue;
          mesh.setColorAt(slot.index, color);
        }
      }
      if (mesh.instanceColor) {
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor.needsUpdate = true;
      }
    }

    color.setRGB(0, 0, 0);
    for (let agentIndex = 0; agentIndex < ROBOT_COUNT; agentIndex += 1) {
      statusRings.current?.setColorAt(agentIndex, color);
      pulseRings.current?.setColorAt(agentIndex, color);
    }
    color.setRGB(1, 1, 1);
    for (let agentIndex = 0; agentIndex < ROBOT_COUNT; agentIndex += 1) {
      shadows.current?.setColorAt(agentIndex, color);
    }
    if (statusRings.current?.instanceColor) {
      statusRings.current.instanceColor.setUsage(THREE.DynamicDrawUsage);
      statusRings.current.instanceColor.needsUpdate = true;
    }
    if (pulseRings.current?.instanceColor) {
      pulseRings.current.instanceColor.setUsage(THREE.DynamicDrawUsage);
      pulseRings.current.instanceColor.needsUpdate = true;
    }
    if (shadows.current?.instanceColor) {
      shadows.current.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame((frame, delta) => {
    const visualRecord = visuals.current;
    if (visualRecord === null) return;
    const snapshot = liveWorld.current;
    const running = snapshot?.status === "running";
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
    context.store = useWorldStore.getState();
    context.pools = pools.current;
    context.rings = rings.current;

    for (let agentIndex = 0; agentIndex < ROBOT_COUNT; agentIndex += 1) {
      const profile = ROBOT_PROFILES[agentIndex];
      const visual = visualRecord[profile.id];
      const agent = findAgentState(snapshot?.agents, profile.id);
      const status = updateVisualMotion(visual, agent, delta, running);
      writeAgentVisual(agentIndex, visual, status, agent, delta, context);
    }

    markPoolsDirty(pools.current, rings.current);
  });

  return (
    <group name="agents">
      <instancedMesh
        ref={capsules}
        args={[geometries.capsule, materials.ceramic, ROBOT_COUNT * 5]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={heads}
        args={[geometries.sphere, materials.ceramic, ROBOT_COUNT]}
        castShadow={high}
        frustumCulled={false}
      />

      <instancedMesh
        ref={(node) => {
          poolRefs.current.accentBoxes = node;
        }}
        args={[
          geometries.box,
          accessoryMaterial,
          ACCESSORY_LAYOUT.counts.accentBoxes,
        ]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(node) => {
          poolRefs.current.jointBoxes = node;
        }}
        args={[geometries.box, materials.joint, JOINT_BOX_COUNT]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(node) => {
          poolRefs.current.jointCylinders = node;
        }}
        args={[
          geometries.cylinder,
          materials.joint,
          ACCESSORY_LAYOUT.counts.jointCylinders,
        ]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(node) => {
          poolRefs.current.jointSpheres = node;
        }}
        args={[geometries.sphere, materials.joint, JOINT_SPHERE_COUNT]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(node) => {
          poolRefs.current.accentSpheres = node;
        }}
        args={[
          geometries.sphere,
          accessoryMaterial,
          ACCESSORY_LAYOUT.counts.accentSpheres,
        ]}
        castShadow={high}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(node) => {
          poolRefs.current.accentRings = node;
        }}
        args={[
          geometries.ring,
          accessoryMaterial,
          ACCESSORY_LAYOUT.counts.accentRings,
        ]}
        frustumCulled={false}
      />

      {ROBOT_PROFILES.map((profile, index) => (
        <mesh
          key={profile.id}
          ref={(node) => {
            chests.current[index] = node;
          }}
          geometry={geometries.box}
          material={accentMaterial(profile.color)}
          castShadow={high}
        />
      ))}

      <instancedMesh
        ref={statusRings}
        args={[geometries.ring, statusRingMaterial, ROBOT_COUNT]}
        renderOrder={1}
        frustumCulled={false}
      />
      <instancedMesh
        ref={selectionRings}
        args={[geometries.ring, selectionRingMaterial, ROBOT_COUNT]}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh
        ref={pulseRings}
        args={[geometries.ring, pulseRingMaterial, ROBOT_COUNT]}
        renderOrder={3}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shadows}
        args={[geometries.plane, materials.contactShadow, ROBOT_COUNT]}
        renderOrder={0}
        frustumCulled={false}
      />
    </group>
  );
}
