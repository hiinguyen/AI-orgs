import * as THREE from "three";
import type { AgentId, AgentRole } from "@/agents/agentTypes";
import { MAX_AGENTS } from "@/agents/agentTypes";
import type { AgentPose } from "@/agents/AgentAnimator";
import type { AgentRig } from "@/agents/agentRigs";
import { ARM_SPREAD, LEG_SPREAD, chestHeight } from "@/agents/agentRigs";
import { labelScale } from "@/agents/agentMath";
import {
  ACCESSORY_POOLS,
  ACCESSORY_SLOTS_PER_ROBOT,
  ROLE_ACCESSORY_LAYOUT,
  type AccessoryPool,
} from "@/agents/robotAccessories";
import type { LabelAnchor } from "./labelAnchors";
import { CAMERA_FOV } from "./cameraPresets";

/**
 * The robot rig in world space: one shared skeleton writer for every robot
 * slot in the pool. The pelvis carries the legs and feet and only bobs
 * vertically; the lean lives on the torso, arms and head. Static accessory
 * offsets are composed once at module load instead of every frame.
 *
 * Phase 9: slots are dynamic. Slot 0..5 are the core agents, live agents take
 * the rest, and every per-slot buffer is sized for the protocol cap so no
 * spawn ever reallocates an InstancedMesh.
 */

export const MAX_ROBOTS = MAX_AGENTS;
export const SELECTION_COLOR = "#e6eef8";
export const STATUS_RING_RADIUS = 0.7;
export const SELECTION_RING_RADIUS = 0.95;
export const PULSE_RING_START = 0.95;
export const PULSE_RING_END = 1.9;
export const PULSE_DURATION = 1.2;
export const STATUS_RING_Y = 0.014;
export const SELECTION_RING_Y = 0.018;
export const PULSE_RING_Y = 0.02;
export const CONTACT_SHADOW_Y = 0.008;

export const ROBOT_CAPSULE_COUNT = MAX_ROBOTS * 5;
export const ROBOT_HEAD_COUNT = MAX_ROBOTS;
export const ROBOT_HAND_COUNT =
  MAX_ROBOTS * ACCESSORY_SLOTS_PER_ROBOT.jointSpheres + MAX_ROBOTS * 2;
export const ROBOT_FOOT_COUNT =
  MAX_ROBOTS * ACCESSORY_SLOTS_PER_ROBOT.jointBoxes + MAX_ROBOTS * 2;

export function accessoryInstanceCount(pool: AccessoryPool): number {
  return MAX_ROBOTS * ACCESSORY_SLOTS_PER_ROBOT[pool];
}

export interface RobotPools {
  capsules: THREE.InstancedMesh | null;
  heads: THREE.InstancedMesh | null;
  chests: THREE.InstancedMesh | null;
  accessories: Record<AccessoryPool, THREE.InstancedMesh | null>;
}

export interface RobotRings {
  status: THREE.InstancedMesh | null;
  selection: THREE.InstancedMesh | null;
  pulse: THREE.InstancedMesh | null;
  shadows: THREE.InstancedMesh | null;
}

export type PulseTone = "success" | "error";

const HAND_INDEX =
  MAX_ROBOTS * ACCESSORY_SLOTS_PER_ROBOT.jointSpheres;
const FOOT_INDEX = MAX_ROBOTS * ACCESSORY_SLOTS_PER_ROBOT.jointBoxes;

const PULSE_GREEN = new THREE.Color("#6fe3a4");
const PULSE_AMBER = new THREE.Color("#f2b46a");

const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler(0, 0, 0, "YXZ");
const scratchLabel = new THREE.Vector3();
const scratchColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const mRoot = new THREE.Matrix4();
const mPelvis = new THREE.Matrix4();
const mBody = new THREE.Matrix4();
const mHead = new THREE.Matrix4();
const mLocal = new THREE.Matrix4();
const mChain = new THREE.Matrix4();
const mPart = new THREE.Matrix4();
const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function trs(
  out: THREE.Matrix4,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  scale: readonly [number, number, number],
): THREE.Matrix4 {
  scratchEuler.set(rotation[0], rotation[1], rotation[2], "XYZ");
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchPosition.set(position[0], position[1], position[2]);
  scratchScale.set(scale[0], scale[1], scale[2]);
  return out.compose(scratchPosition, scratchQuaternion, scratchScale);
}

interface RoleAccessoryEntry {
  pool: AccessoryPool;
  space: "head" | "body" | "pelvis";
  index: number;
  matrix: THREE.Matrix4;
}

/** Static accessory transforms per role, compiled once for the tab. */
const ROLE_ACCESSORIES: Readonly<Record<AgentRole, readonly RoleAccessoryEntry[]>> =
  (() => {
    const roles: AgentRole[] = [
      "orchestrator",
      "researcher",
      "product_manager",
      "engineer",
      "qa",
      "reviewer",
    ];
    const table = {} as Record<AgentRole, RoleAccessoryEntry[]>;
    for (const role of roles) {
      table[role] = ROLE_ACCESSORY_LAYOUT[role].slots.map((slot) => ({
        pool: slot.pool,
        space: slot.space,
        index: slot.localIndex,
        matrix: trs(
          new THREE.Matrix4(),
          slot.position,
          slot.rotation,
          slot.scale,
        ),
      }));
    }
    return table;
  })();

function scaledAt(
  out: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Matrix4 {
  out.makeScale(sx, sy, sz);
  out.setPosition(x, y, z);
  return out;
}

/** Horizontal ring at floor height: root * T * R(-90 deg X) * S. */
function floorRing(
  out: THREE.Matrix4,
  root: THREE.Matrix4,
  y: number,
  radius: number,
): THREE.Matrix4 {
  mLocal.makeTranslation(0, y, 0);
  mLocal.multiply(mChain.makeRotationX(-Math.PI / 2));
  mLocal.multiply(mChain.makeScale(radius, radius, 1));
  return out.multiplyMatrices(root, mLocal);
}

/** Torso capsule in the leaning body frame. */
function writeTorso(
  slotIndex: number,
  rig: AgentRig,
  pools: RobotPools,
): void {
  scaledAt(
    mChain,
    0,
    rig.hipHeight + rig.torsoHeight / 2,
    0,
    rig.torsoWidth,
    rig.torsoHeight / 2,
    rig.torsoDepth,
  );
  mPart.multiplyMatrices(mBody, mChain);
  pools.capsules?.setMatrixAt(slotIndex, mPart);
}

/** One rigid arm plus the hand sphere at its end. */
function writeArm(
  slotIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  left: boolean,
  pools: RobotPools,
): void {
  const armX = left ? pose.armLeftX : pose.armRightX;
  const armZ = left ? pose.armLeftZ : pose.armRightZ;
  const shoulderX = rig.torsoWidth / 2 + rig.armRadius + ARM_SPREAD;
  const shoulder = left ? -shoulderX : shoulderX;
  const armIndex = MAX_ROBOTS + slotIndex * 2 + (left ? 0 : 1);

  mLocal.makeTranslation(shoulder, rig.shoulderHeight, 0);
  mLocal.multiply(mChain.makeRotationX(armX));
  mLocal.multiply(mChain.makeRotationZ(armZ));
  mLocal.multiply(mChain.makeTranslation(0, -rig.armLength / 2, 0));
  mLocal.multiply(
    mChain.makeScale(rig.armRadius * 2, rig.armLength / 2, rig.armRadius * 2),
  );
  mPart.multiplyMatrices(mBody, mLocal);
  pools.capsules?.setMatrixAt(armIndex, mPart);

  // Hand at the end of the rigid arm chain.
  mLocal.makeTranslation(shoulder, rig.shoulderHeight, 0);
  mLocal.multiply(mChain.makeRotationX(armX));
  mLocal.multiply(mChain.makeRotationZ(armZ));
  mLocal.multiply(mChain.makeTranslation(0, -rig.armLength, 0));
  mPart.multiplyMatrices(mBody, mLocal);
  mChain.makeScale(0.115, 0.115, 0.115);
  mPart.multiply(mChain);
  pools.accessories.jointSpheres?.setMatrixAt(
    HAND_INDEX + slotIndex * 2 + (left ? 0 : 1),
    mPart,
  );
}

function writeArms(
  slotIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  pools: RobotPools,
): void {
  writeArm(slotIndex, rig, pose, true, pools);
  writeArm(slotIndex, rig, pose, false, pools);
}

/** One rigid leg plus the foot, both attached to the pelvis. */
function writeLeg(
  slotIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  left: boolean,
  pools: RobotPools,
): void {
  const legX = left ? pose.legLeftX : pose.legRightX;
  const hip = left ? -LEG_SPREAD : LEG_SPREAD;
  const legIndex = MAX_ROBOTS * 3 + slotIndex * 2 + (left ? 0 : 1);

  mLocal.makeTranslation(hip, rig.hipHeight, 0);
  mLocal.multiply(mChain.makeRotationX(legX));
  mLocal.multiply(mChain.makeTranslation(0, -rig.hipHeight / 2, 0));
  mLocal.multiply(
    mChain.makeScale(rig.legRadius * 2, rig.hipHeight / 2, rig.legRadius * 2),
  );
  mPart.multiplyMatrices(mPelvis, mLocal);
  pools.capsules?.setMatrixAt(legIndex, mPart);

  // Foot at the leg end, counter-rotated so its sole stays parallel to the
  // floor while the leg swings.
  mLocal.makeTranslation(hip, rig.hipHeight, 0);
  mLocal.multiply(mChain.makeRotationX(legX));
  mLocal.multiply(mChain.makeTranslation(0, -rig.hipHeight, 0));
  mLocal.multiply(mChain.makeRotationX(-legX));
  mLocal.multiply(mChain.makeTranslation(0, 0.045, 0.035));
  mPart.multiplyMatrices(mPelvis, mLocal);
  mChain.makeScale(0.17, 0.09, 0.27);
  mPart.multiply(mChain);
  pools.accessories.jointBoxes?.setMatrixAt(
    FOOT_INDEX + slotIndex * 2 + (left ? 0 : 1),
    mPart,
  );
}

function writeLegs(
  slotIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  pools: RobotPools,
): void {
  writeLeg(slotIndex, rig, pose, true, pools);
  writeLeg(slotIndex, rig, pose, false, pools);
}

/** Head sphere in the neck-pivot frame. */
function writeHead(
  slotIndex: number,
  rig: AgentRig,
  pools: RobotPools,
): void {
  scaledAt(mChain, 0, 0, 0, rig.headWidth, rig.headHeight, rig.headDepth);
  mPart.multiplyMatrices(mHead, mChain);
  pools.heads?.setMatrixAt(slotIndex, mPart);
}

/** Role accessories, each parented to the head, body or pelvis. */
function writeAccessories(
  slotIndex: number,
  role: AgentRole,
  pools: RobotPools,
): void {
  const entries = ROLE_ACCESSORIES[role];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const parent =
      entry.space === "head"
        ? mHead
        : entry.space === "body"
          ? mBody
          : mPelvis;
    mPart.multiplyMatrices(parent, entry.matrix);
    const instanceIndex =
      slotIndex * ACCESSORY_SLOTS_PER_ROBOT[entry.pool] + entry.index;
    pools.accessories[entry.pool]?.setMatrixAt(instanceIndex, mPart);
  }
}

/** Emissive chest accent in the agent colour, one instance per slot. */
function writeChestAccent(
  slotIndex: number,
  rig: AgentRig,
  pools: RobotPools,
): void {
  scaledAt(
    mChain,
    0,
    chestHeight(rig),
    rig.torsoDepth / 2 + 0.016,
    rig.torsoWidth * 0.42,
    rig.torsoHeight * 0.22,
    0.03,
  );
  mPart.multiplyMatrices(mBody, mChain);
  pools.chests?.setMatrixAt(slotIndex, mPart);
}

/**
 * Write every instanced body part for one agent. Returns the shared root
 * matrix so the ring writer can place floor decals without recomputing it.
 */
export function writeRobotMatrices(
  slotIndex: number,
  pose: AgentPose,
  rig: AgentRig,
  role: AgentRole,
  rootX: number,
  rootZ: number,
  heading: number,
  visualScale: number,
  pools: RobotPools,
): THREE.Matrix4 {
  scratchQuaternion.setFromAxisAngle(UP, heading);
  scratchPosition.set(rootX, 0, rootZ);
  const drawn = rig.scale * Math.max(0.0001, visualScale);
  scratchScale.set(drawn, drawn, drawn);
  mRoot.compose(scratchPosition, scratchQuaternion, scratchScale);

  // The pelvis bobs vertically only, and drops by exactly the amount the
  // swinging rigid legs shorten their vertical reach. That keeps the lower
  // foot on the floor instead of lifting both feet at the stride peak.
  const legAngle = Math.max(
    Math.abs(pose.legLeftX),
    Math.abs(pose.legRightX),
  );
  const pelvisDrop = rig.hipHeight * (1 - Math.cos(legAngle));
  mPelvis.makeTranslation(0, -pelvisDrop, 0);
  mPelvis.premultiply(mRoot);

  // Lean pivots around the hip but never reaches the legs.
  mLocal.makeTranslation(0, pose.bodyLift + rig.hipHeight, 0);
  mLocal.multiply(mChain.makeRotationX(pose.bodyPitch));
  mLocal.multiply(mChain.makeTranslation(0, -rig.hipHeight, 0));
  mBody.multiplyMatrices(mPelvis, mLocal);

  // Head pivot: neck yaw and pitch around its own centre.
  mLocal.makeTranslation(0, rig.headCenterY, 0);
  scratchEuler.set(pose.headPitch, pose.headYaw, pose.headRoll, "YXZ");
  mLocal.multiply(mChain.makeRotationFromEuler(scratchEuler));
  mHead.multiplyMatrices(mBody, mLocal);

  writeTorso(slotIndex, rig, pools);
  writeArms(slotIndex, rig, pose, pools);
  writeLegs(slotIndex, rig, pose, pools);
  writeHead(slotIndex, rig, pools);
  writeAccessories(slotIndex, role, pools);
  writeChestAccent(slotIndex, rig, pools);

  return mRoot;
}

/** Status, selection, pulse and contact-shadow floor decals. */
export function writeRings(
  slotIndex: number,
  color: THREE.Color,
  energy: number,
  highlighted: boolean,
  pulseActive: boolean,
  pulseProgress: number,
  pulseTone: PulseTone,
  root: THREE.Matrix4,
  rings: RobotRings,
): void {
  scratchColor.copy(color).multiplyScalar(energy);
  rings.status?.setColorAt(slotIndex, scratchColor);
  rings.status?.setMatrixAt(
    slotIndex,
    floorRing(mPart, root, STATUS_RING_Y, STATUS_RING_RADIUS),
  );

  const selectionRadius = highlighted ? SELECTION_RING_RADIUS : 0;
  rings.selection?.setMatrixAt(
    slotIndex,
    floorRing(mPart, root, SELECTION_RING_Y, selectionRadius),
  );

  const pulseRadius = pulseActive
    ? PULSE_RING_START + (PULSE_RING_END - PULSE_RING_START) * pulseProgress
    : 0;
  if (!pulseActive) {
    scratchColor.setRGB(0, 0, 0);
  } else if (pulseTone === "error") {
    scratchColor.copy(PULSE_AMBER).multiplyScalar(1 - pulseProgress);
  } else {
    scratchColor.copy(PULSE_GREEN).multiplyScalar(1 - pulseProgress);
  }
  rings.pulse?.setColorAt(slotIndex, scratchColor);
  rings.pulse?.setMatrixAt(
    slotIndex,
    floorRing(mPart, root, PULSE_RING_Y, pulseRadius),
  );

  mLocal.makeTranslation(0, CONTACT_SHADOW_Y, 0);
  mLocal.multiply(mChain.makeRotationX(-Math.PI / 2));
  mLocal.multiply(mChain.makeScale(1.15, 0.82, 1));
  rings.shadows?.setMatrixAt(
    slotIndex,
    mPart.multiplyMatrices(root, mLocal),
  );
}

/** Chest and accent instance colours for the role occupying a slot. */
export function setRobotColor(
  slotIndex: number,
  role: AgentRole,
  color: THREE.Color,
  pools: RobotPools,
): void {
  pools.chests?.setColorAt(slotIndex, color);
  if (pools.chests?.instanceColor) {
    pools.chests.instanceColor.needsUpdate = true;
  }

  const entries = ROLE_ACCESSORIES[role];
  for (const entry of entries) {
    const isAccent =
      entry.pool === "accentBoxes" ||
      entry.pool === "accentSpheres" ||
      entry.pool === "accentRings";
    if (!isAccent) continue;
    const instanceIndex =
      slotIndex * ACCESSORY_SLOTS_PER_ROBOT[entry.pool] + entry.index;
    pools.accessories[entry.pool]?.setColorAt(instanceIndex, color);
    const mesh = pools.accessories[entry.pool];
    if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** Zero every instance belonging to a slot when its agent leaves. */
export function clearRobotSlot(
  slotIndex: number,
  pools: RobotPools,
  rings: RobotRings,
): void {
  pools.capsules?.setMatrixAt(slotIndex, zeroMatrix);
  pools.capsules?.setMatrixAt(MAX_ROBOTS + slotIndex * 2, zeroMatrix);
  pools.capsules?.setMatrixAt(MAX_ROBOTS + slotIndex * 2 + 1, zeroMatrix);
  pools.capsules?.setMatrixAt(MAX_ROBOTS * 3 + slotIndex * 2, zeroMatrix);
  pools.capsules?.setMatrixAt(MAX_ROBOTS * 3 + slotIndex * 2 + 1, zeroMatrix);
  pools.heads?.setMatrixAt(slotIndex, zeroMatrix);
  pools.chests?.setMatrixAt(slotIndex, zeroMatrix);
  for (const pool of ACCESSORY_POOLS) {
    const base = slotIndex * ACCESSORY_SLOTS_PER_ROBOT[pool];
    const mesh = pools.accessories[pool];
    for (let index = 0; index < ACCESSORY_SLOTS_PER_ROBOT[pool]; index += 1) {
      mesh?.setMatrixAt(base + index, zeroMatrix);
    }
  }
  pools.accessories.jointSpheres?.setMatrixAt(HAND_INDEX + slotIndex * 2, zeroMatrix);
  pools.accessories.jointSpheres?.setMatrixAt(
    HAND_INDEX + slotIndex * 2 + 1,
    zeroMatrix,
  );
  pools.accessories.jointBoxes?.setMatrixAt(FOOT_INDEX + slotIndex * 2, zeroMatrix);
  pools.accessories.jointBoxes?.setMatrixAt(
    FOOT_INDEX + slotIndex * 2 + 1,
    zeroMatrix,
  );

  rings.status?.setMatrixAt(slotIndex, zeroMatrix);
  rings.selection?.setMatrixAt(slotIndex, zeroMatrix);
  rings.pulse?.setMatrixAt(slotIndex, zeroMatrix);
  rings.shadows?.setMatrixAt(slotIndex, zeroMatrix);
}

/** Project the speech-bubble anchor for one agent into screen space. */
export function writeLabelAnchor(
  id: AgentId,
  x: number,
  z: number,
  rig: AgentRig,
  visualScale: number,
  camera: THREE.Camera,
  width: number,
  height: number,
  anchor: LabelAnchor,
): void {
  const drawnScale = Math.max(0, visualScale);
  scratchLabel.set(x, rig.labelY * rig.scale * drawnScale, z);
  const distance = scratchLabel.distanceTo(camera.position);
  scratchLabel.project(camera);
  anchor.scale = labelScale(CAMERA_FOV, distance);
  anchor.onScreen =
    drawnScale > 0.4 &&
    scratchLabel.z > -1 &&
    scratchLabel.z < 1 &&
    Math.abs(scratchLabel.x) < 1.04 &&
    Math.abs(scratchLabel.y) < 1.04;
  anchor.x = (scratchLabel.x * 0.5 + 0.5) * width;
  anchor.y = (-scratchLabel.y * 0.5 + 0.5) * height;
}
