import type { AgentRole } from "./agentTypes.ts";

/**
 * Per-role robot proportions, in metres before the rig scale is applied.
 * Pure data so the headless checks can validate the rig table without a
 * renderer, and so the 3D layer never hard-codes a character dimension.
 *
 * The character is built bottom-up: feet on the floor, hip at `hipHeight`,
 * shoulders at `shoulderHeight`, head centred at `headCenterY`. `headTopY` is
 * the highest visible point of the head, including the role accessory, and
 * `labelY` sits just above it; both are scaled by `scale` when drawn.
 *
 * The table targets a drawn head top of 1.75-1.85 m so a standing robot rises
 * clearly above the 1.4 m monitor line, as in the reference screenshots.
 */

export type HeadAccessory =
  | "crown"
  | "lens"
  | "tablet"
  | "headset"
  | "twin_sensors"
  | "monocle";

export interface AgentRig {
  role: AgentRole;
  /** Uniform scale applied to every part of the character. */
  scale: number;
  hipHeight: number;
  torsoHeight: number;
  /** Hip height + torso height, minus the neck gap. */
  shoulderHeight: number;
  headCenterY: number;
  torsoWidth: number;
  torsoDepth: number;
  headWidth: number;
  headHeight: number;
  headDepth: number;
  armLength: number;
  armRadius: number;
  legRadius: number;
  /** Highest visible point of the head, including the role accessory. */
  headTopY: number;
  /** Speech-bubble anchor above the head, before scale. */
  labelY: number;
  accessory: HeadAccessory;
  /** Visor height as a fraction of the head height. */
  visorHeightRatio: number;
}

export const ACCESSORY_KINDS: readonly HeadAccessory[] = [
  "crown",
  "lens",
  "tablet",
  "headset",
  "twin_sensors",
  "monocle",
] as const;

/** Distance from the torso centre line to each shoulder joint. */
export const ARM_SPREAD = 0.03;
/** Distance from the centre line to each hip joint. */
export const LEG_SPREAD = 0.13;

export const AGENT_RIGS: Record<AgentRole, AgentRig> = {
  orchestrator: {
    role: "orchestrator",
    scale: 1.12,
    hipHeight: 0.594,
    torsoHeight: 0.594,
    shoulderHeight: 1.172,
    headCenterY: 1.391,
    torsoWidth: 0.485,
    torsoDepth: 0.313,
    headWidth: 0.375,
    headHeight: 0.344,
    headDepth: 0.336,
    armLength: 0.703,
    armRadius: 0.0688,
    legRadius: 0.0844,
    headTopY: 1.643,
    labelY: 1.763,
    accessory: "crown",
    visorHeightRatio: 0.52,
  },
  researcher: {
    role: "researcher",
    scale: 1.0,
    hipHeight: 0.684,
    torsoHeight: 0.684,
    shoulderHeight: 1.35,
    headCenterY: 1.602,
    torsoWidth: 0.558,
    torsoDepth: 0.36,
    headWidth: 0.432,
    headHeight: 0.396,
    headDepth: 0.387,
    armLength: 0.81,
    armRadius: 0.0792,
    legRadius: 0.0972,
    headTopY: 1.8,
    labelY: 1.92,
    accessory: "lens",
    visorHeightRatio: 0.44,
  },
  product_manager: {
    role: "product_manager",
    scale: 0.98,
    hipHeight: 0.69,
    torsoHeight: 0.69,
    shoulderHeight: 1.361,
    headCenterY: 1.615,
    torsoWidth: 0.563,
    torsoDepth: 0.363,
    headWidth: 0.436,
    headHeight: 0.399,
    headDepth: 0.39,
    armLength: 0.817,
    armRadius: 0.0799,
    legRadius: 0.098,
    headTopY: 1.815,
    labelY: 1.935,
    accessory: "tablet",
    visorHeightRatio: 0.4,
  },
  engineer: {
    role: "engineer",
    scale: 1.03,
    hipHeight: 0.665,
    torsoHeight: 0.665,
    shoulderHeight: 1.313,
    headCenterY: 1.558,
    torsoWidth: 0.543,
    torsoDepth: 0.35,
    headWidth: 0.42,
    headHeight: 0.385,
    headDepth: 0.376,
    armLength: 0.788,
    armRadius: 0.077,
    legRadius: 0.0945,
    headTopY: 1.77,
    labelY: 1.89,
    accessory: "headset",
    visorHeightRatio: 0.46,
  },
  qa: {
    role: "qa",
    scale: 0.96,
    hipHeight: 0.675,
    torsoHeight: 0.675,
    shoulderHeight: 1.331,
    headCenterY: 1.58,
    torsoWidth: 0.55,
    torsoDepth: 0.355,
    headWidth: 0.426,
    headHeight: 0.391,
    headDepth: 0.382,
    armLength: 0.799,
    armRadius: 0.0781,
    legRadius: 0.0958,
    headTopY: 1.88,
    labelY: 2.0,
    accessory: "twin_sensors",
    visorHeightRatio: 0.42,
  },
  reviewer: {
    role: "reviewer",
    scale: 1.06,
    hipHeight: 0.656,
    torsoHeight: 0.656,
    shoulderHeight: 1.295,
    headCenterY: 1.536,
    torsoWidth: 0.535,
    torsoDepth: 0.345,
    headWidth: 0.414,
    headHeight: 0.38,
    headDepth: 0.371,
    armLength: 0.777,
    armRadius: 0.0759,
    legRadius: 0.0932,
    headTopY: 1.726,
    labelY: 1.846,
    accessory: "monocle",
    visorHeightRatio: 0.44,
  },
};

export function rigFor(role: AgentRole): AgentRig {
  return AGENT_RIGS[role];
}

/** Speech-bubble anchor above the floor once the rig scale is applied. */
export function labelHeight(rig: AgentRig): number {
  return rig.labelY * rig.scale;
}

/** Highest visible point of the head once the rig scale is applied. */
export function headTopHeight(rig: AgentRig): number {
  return rig.headTopY * rig.scale;
}

/** Height of the chest accent and of the comm-arc attachment point. */
export function chestHeight(rig: AgentRig): number {
  return rig.hipHeight + rig.torsoHeight * 0.66;
}

/**
 * Lateral distance between the hands when both arms are rotated inwards by
 * `armZ` radians. The Z rotation moves a hand by `armLength * sin(armZ)`
 * towards the centre line, so typing can bring the hands over a keyboard
 * that is narrower than the shoulders.
 */
export function handSpread(rig: AgentRig, armZ: number): number {
  const shoulderX = rig.torsoWidth / 2 + rig.armRadius + ARM_SPREAD;
  const inward = rig.armLength * Math.sin(armZ);
  return Math.max(0, shoulderX - inward) * 2 * rig.scale;
}
