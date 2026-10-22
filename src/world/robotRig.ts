import * as THREE from "three";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_IDS } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { AgentPose } from "@/agents/AgentAnimator";
import type { AgentRig } from "@/agents/agentRigs";
import {
  ARM_SPREAD,
  LEG_SPREAD,
  chestHeight,
  rigFor,
} from "@/agents/agentRigs";
import { labelScale } from "@/agents/agentMath";
import {
  ACCESSORY_POOLS,
  buildAccessoryLayout,
  type AccessoryPool,
} from "@/agents/robotAccessories";
import type { LabelAnchor } from "./labelAnchors";
import { CAMERA_FOV } from "./cameraPresets";

/**
 * The robot rig in world space: one shared skeleton writer for the six
 * instanced characters. The pelvis carries the legs and feet and only bobs
 * vertically; the lean lives on the torso, arms and head. Static accessory
 * offsets are composed once at module load instead of every frame.
 */

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

export const ROBOT_PROFILES = AGENT_IDS.map((id) => AGENT_BY_ID[id]);
export const ROBOT_RIGS: readonly AgentRig[] = ROBOT_PROFILES.map((profile) =>
  rigFor(profile.role),
);
export const ROBOT_COUNT = AGENT_IDS.length;
export const ROBOT_HOVER_IDS = AGENT_IDS.map((id) => `agent:${id}`);
export const ROBOT_COLORS: readonly THREE.Color[] = ROBOT_PROFILES.map(
  (profile) => new THREE.Color(profile.color),
);
export const ACCESSORY_LAYOUT = buildAccessoryLayout(ROBOT_RIGS);

export { ACCESSORY_POOLS };
export type { AccessoryPool };

export interface RobotPools {
  capsules: THREE.InstancedMesh | null;
  heads: THREE.InstancedMesh | null;
  chests: Array<THREE.Mesh | null>;
  accessories: Record<AccessoryPool, THREE.InstancedMesh | null>;
}

export interface RobotRings {
  status: THREE.InstancedMesh | null;
  selection: THREE.InstancedMesh | null;
  pulse: THREE.InstancedMesh | null;
  shadows: THREE.InstancedMesh | null;
}

export type PulseTone = "success" | "error";

const HAND_INDEX = ACCESSORY_LAYOUT.counts.jointSpheres;
const FOOT_INDEX = ACCESSORY_LAYOUT.counts.jointBoxes;
export const JOINT_SPHERE_COUNT = HAND_INDEX + ROBOT_COUNT * 2;
export const JOINT_BOX_COUNT = FOOT_INDEX + ROBOT_COUNT * 2;

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

/** Static accessory transforms, compiled once for the lifetime of the tab. */
const ACCESSORY_LOCAL_MATRICES: readonly (readonly THREE.Matrix4[])[] =
  ACCESSORY_LAYOUT.slots.map((slots) =>
    slots.map((slot) =>
      trs(
        new THREE.Matrix4(),
        slot.position,
        slot.rotation,
        slot.scale,
      ),
    ),
  );

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
  agentIndex: number,
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
  pools.capsules?.setMatrixAt(agentIndex, mPart);
}

/** One rigid arm plus the hand sphere at its end. */
function writeArm(
  agentIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  left: boolean,
  pools: RobotPools,
): void {
  const armX = left ? pose.armLeftX : pose.armRightX;
  const armZ = left ? pose.armLeftZ : pose.armRightZ;
  const shoulderX = rig.torsoWidth / 2 + rig.armRadius + ARM_SPREAD;
  const shoulder = left ? -shoulderX : shoulderX;
  const armIndex = ROBOT_COUNT + agentIndex * 2 + (left ? 0 : 1);

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
    HAND_INDEX + agentIndex * 2 + (left ? 0 : 1),
    mPart,
  );
}

function writeArms(
  agentIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  pools: RobotPools,
): void {
  writeArm(agentIndex, rig, pose, true, pools);
  writeArm(agentIndex, rig, pose, false, pools);
}

/** One rigid leg plus the foot, both attached to the pelvis. */
function writeLeg(
  agentIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  left: boolean,
  pools: RobotPools,
): void {
  const legX = left ? pose.legLeftX : pose.legRightX;
  const hip = left ? -LEG_SPREAD : LEG_SPREAD;
  const legIndex = ROBOT_COUNT * 3 + agentIndex * 2 + (left ? 0 : 1);

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
    FOOT_INDEX + agentIndex * 2 + (left ? 0 : 1),
    mPart,
  );
}

function writeLegs(
  agentIndex: number,
  rig: AgentRig,
  pose: AgentPose,
  pools: RobotPools,
): void {
  writeLeg(agentIndex, rig, pose, true, pools);
  writeLeg(agentIndex, rig, pose, false, pools);
}

/** Head sphere in the neck-pivot frame. */
function writeHead(
  agentIndex: number,
  rig: AgentRig,
  pools: RobotPools,
): void {
  scaledAt(mChain, 0, 0, 0, rig.headWidth, rig.headHeight, rig.headDepth);
  mPart.multiplyMatrices(mHead, mChain);
  pools.heads?.setMatrixAt(agentIndex, mPart);
}

/** Role accessories, each parented to the head, body or pelvis. */
function writeAccessories(agentIndex: number, pools: RobotPools): void {
  const slots = ACCESSORY_LAYOUT.slots[agentIndex];
  const locals = ACCESSORY_LOCAL_MATRICES[agentIndex];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const parent =
      slot.space === "head"
        ? mHead
        : slot.space === "body"
          ? mBody
          : mPelvis;
    mPart.multiplyMatrices(parent, locals[index]);
    pools.accessories[slot.pool]?.setMatrixAt(slot.index, mPart);
  }
}

/**
 * Emissive chest accent in the agent colour, one mesh per agent so the
 * shared accentMaterial pool can supply the right emissive per colour.
 */
function writeChestAccent(
  agentIndex: number,
  rig: AgentRig,
  pools: RobotPools,
): void {
  const chest = pools.chests[agentIndex];
  if (!chest) return;
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
  mPart.decompose(chest.position, chest.quaternion, chest.scale);
}

/**
 * Write every instanced body part for one agent. Returns the shared root
 * matrix so the ring writer can place floor decals without recomputing it.
 */
export function writeRobotMatrices(
  agentIndex: number,
  pose: AgentPose,
  rig: AgentRig,
  rootX: number,
  rootZ: number,
  heading: number,
  pools: RobotPools,
): THREE.Matrix4 {
  scratchQuaternion.setFromAxisAngle(UP, heading);
  scratchPosition.set(rootX, 0, rootZ);
  scratchScale.set(rig.scale, rig.scale, rig.scale);
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

  writeTorso(agentIndex, rig, pools);
  writeArms(agentIndex, rig, pose, pools);
  writeLegs(agentIndex, rig, pose, pools);
  writeHead(agentIndex, rig, pools);
  writeAccessories(agentIndex, pools);
  writeChestAccent(agentIndex, rig, pools);

  return mRoot;
}

/** Status, selection, pulse and contact-shadow floor decals. */
export function writeRings(
  agentIndex: number,
  energy: number,
  highlighted: boolean,
  pulseActive: boolean,
  pulseProgress: number,
  pulseTone: PulseTone,
  root: THREE.Matrix4,
  rings: RobotRings,
): void {
  // The per-profile colours are parsed once at module load, never per frame.
  scratchColor.copy(ROBOT_COLORS[agentIndex]).multiplyScalar(energy);
  rings.status?.setColorAt(agentIndex, scratchColor);
  rings.status?.setMatrixAt(
    agentIndex,
    floorRing(mPart, root, STATUS_RING_Y, STATUS_RING_RADIUS),
  );

  const selectionRadius = highlighted ? SELECTION_RING_RADIUS : 0;
  rings.selection?.setMatrixAt(
    agentIndex,
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
  rings.pulse?.setColorAt(agentIndex, scratchColor);
  rings.pulse?.setMatrixAt(
    agentIndex,
    floorRing(mPart, root, PULSE_RING_Y, pulseRadius),
  );

  mLocal.makeTranslation(0, CONTACT_SHADOW_Y, 0);
  mLocal.multiply(mChain.makeRotationX(-Math.PI / 2));
  mLocal.multiply(mChain.makeScale(1.15, 0.82, 1));
  rings.shadows?.setMatrixAt(
    agentIndex,
    mPart.multiplyMatrices(root, mLocal),
  );
}

/** Project the speech-bubble anchor for one agent into screen space. */
export function writeLabelAnchor(
  id: AgentId,
  x: number,
  z: number,
  rig: AgentRig,
  camera: THREE.Camera,
  width: number,
  height: number,
  anchor: LabelAnchor,
): void {
  scratchLabel.set(x, rig.labelY * rig.scale, z);
  const distance = scratchLabel.distanceTo(camera.position);
  scratchLabel.project(camera);
  anchor.scale = labelScale(CAMERA_FOV, distance);
  anchor.onScreen =
    scratchLabel.z > -1 &&
    scratchLabel.z < 1 &&
    Math.abs(scratchLabel.x) < 1.04 &&
    Math.abs(scratchLabel.y) < 1.04;
  anchor.x = (scratchLabel.x * 0.5 + 0.5) * width;
  anchor.y = (-scratchLabel.y * 0.5 + 0.5) * height;
}
