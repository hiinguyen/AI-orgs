import type { AgentRig } from "./agentRigs.ts";
import { ARM_SPREAD, LEG_SPREAD } from "./agentRigs.ts";

/**
 * Static accessory layout for the procedural robots: neck, belt, joints,
 * visor and the per-role head silhouette. Pure data, so the renderer can
 * precompute one local matrix per slot once and the headless checks can load
 * it without three.
 *
 * `space` selects the parent matrix:
 * - `pelvis` follows the hips only (never the torso lean);
 * - `body` follows the leaning torso and arms;
 * - `head` follows the neck and head rotation.
 */

export type AccessoryPool =
  | "accentBoxes"
  | "jointBoxes"
  | "jointCylinders"
  | "jointSpheres"
  | "accentSpheres"
  | "accentRings";

export type AccessorySpace = "head" | "body" | "pelvis";

export interface AccessorySpec {
  pool: AccessoryPool;
  space: AccessorySpace;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface AccessorySlot extends AccessorySpec {
  index: number;
}

export interface AccessoryLayout {
  slots: AccessorySlot[][];
  counts: Record<AccessoryPool, number>;
}

export const ACCESSORY_POOLS: readonly AccessoryPool[] = [
  "accentBoxes",
  "jointBoxes",
  "jointCylinders",
  "jointSpheres",
  "accentSpheres",
  "accentRings",
] as const;

export const ACCENT_POOLS: ReadonlySet<AccessoryPool> = new Set<AccessoryPool>([
  "accentBoxes",
  "accentSpheres",
  "accentRings",
]);

function accessory(
  pool: AccessoryPool,
  space: AccessorySpace,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
): AccessorySpec {
  return { pool, space, position, rotation, scale };
}

/** Neck, belt, visor and role accessory, in rig-local metres. */
export function roleAccessories(rig: AgentRig): AccessorySpec[] {
  const list: AccessorySpec[] = [];
  const { headWidth, headHeight, headDepth } = rig;
  const shoulderX = rig.torsoWidth / 2 + rig.armRadius + ARM_SPREAD;
  const headHalf = headHeight / 2;

  list.push(
    accessory(
      "jointCylinders",
      "body",
      [0, rig.shoulderHeight + 0.03, 0],
      [0.1, 0.08, 0.1],
    ),
    accessory(
      "jointBoxes",
      "pelvis",
      [0, rig.hipHeight + 0.025, 0],
      [rig.torsoWidth * 0.82, 0.07, rig.torsoDepth * 0.84],
    ),
    accessory(
      "jointSpheres",
      "body",
      [shoulderX, rig.shoulderHeight, 0],
      [0.13, 0.13, 0.13],
    ),
    accessory(
      "jointSpheres",
      "body",
      [-shoulderX, rig.shoulderHeight, 0],
      [0.13, 0.13, 0.13],
    ),
    accessory(
      "jointSpheres",
      "pelvis",
      [LEG_SPREAD, rig.hipHeight, 0],
      [0.12, 0.12, 0.12],
    ),
    accessory(
      "jointSpheres",
      "pelvis",
      [-LEG_SPREAD, rig.hipHeight, 0],
      [0.12, 0.12, 0.12],
    ),
    accessory(
      "jointBoxes",
      "head",
      [0, 0, headDepth / 2 + 0.004],
      [headWidth * 0.72, headHeight * rig.visorHeightRatio, 0.02],
    ),
    accessory(
      "accentBoxes",
      "head",
      [0, 0, headDepth / 2 + 0.018],
      [headWidth * 0.55, 0.028, 0.012],
    ),
  );

  switch (rig.accessory) {
    case "crown": {
      // Three short spikes; the tallest reaches 0.08 m above the head.
      list.push(
        accessory(
          "accentBoxes",
          "head",
          [-0.09, headHalf + 0.03, 0],
          [0.035, 0.1, 0.035],
        ),
        accessory(
          "accentBoxes",
          "head",
          [0, headHalf + 0.01, 0],
          [0.045, 0.14, 0.045],
        ),
        accessory(
          "accentBoxes",
          "head",
          [0.09, headHalf + 0.03, 0],
          [0.035, 0.1, 0.035],
        ),
      );
      break;
    }
    case "lens": {
      list.push(
        accessory(
          "jointCylinders",
          "head",
          [headWidth / 2 + 0.02, 0.015, 0.04],
          [0.09, 0.06, 0.09],
          [0, 0, Math.PI / 2],
        ),
        accessory(
          "accentSpheres",
          "head",
          [headWidth / 2 + 0.055, 0.015, 0.04],
          [0.055, 0.055, 0.055],
        ),
      );
      break;
    }
    case "tablet": {
      list.push(
        accessory(
          "jointBoxes",
          "body",
          [0, rig.shoulderHeight - 0.22, rig.torsoDepth / 2 + 0.09],
          [0.3, 0.22, 0.025],
          [-0.28, 0, 0],
        ),
        accessory(
          "accentBoxes",
          "body",
          [0, rig.shoulderHeight - 0.22, rig.torsoDepth / 2 + 0.11],
          [0.25, 0.17, 0.01],
          [-0.28, 0, 0],
        ),
      );
      break;
    }
    case "headset": {
      list.push(
        accessory(
          "jointBoxes",
          "head",
          [0, headHalf + 0.005, 0],
          [0.07, 0.03, headDepth * 0.9],
        ),
        accessory(
          "jointCylinders",
          "head",
          [headWidth / 2 + 0.02, 0.01, 0],
          [0.12, 0.045, 0.12],
          [0, 0, Math.PI / 2],
        ),
        accessory(
          "jointCylinders",
          "head",
          [-headWidth / 2 - 0.02, 0.01, 0],
          [0.12, 0.045, 0.12],
          [0, 0, Math.PI / 2],
        ),
      );
      break;
    }
    case "twin_sensors": {
      // Short antennae: the tip spheres reach 0.105 m above the head.
      list.push(
        accessory(
          "jointCylinders",
          "head",
          [0.09, headHalf + 0.02, 0],
          [0.022, 0.1, 0.022],
        ),
        accessory(
          "jointCylinders",
          "head",
          [-0.09, headHalf + 0.02, 0],
          [0.022, 0.1, 0.022],
        ),
        accessory(
          "accentSpheres",
          "head",
          [0.09, headHalf + 0.075, 0],
          [0.06, 0.06, 0.06],
        ),
        accessory(
          "accentSpheres",
          "head",
          [-0.09, headHalf + 0.075, 0],
          [0.06, 0.06, 0.06],
        ),
      );
      break;
    }
    case "monocle": {
      list.push(
        accessory(
          "accentRings",
          "head",
          [0.075, 0.02, headDepth / 2 + 0.01],
          [0.17, 0.17, 1],
        ),
      );
      break;
    }
  }

  return list;
}

export function buildAccessoryLayout(
  rigs: readonly AgentRig[],
): AccessoryLayout {
  const cursors: Record<AccessoryPool, number> = {
    accentBoxes: 0,
    jointBoxes: 0,
    jointCylinders: 0,
    jointSpheres: 0,
    accentSpheres: 0,
    accentRings: 0,
  };
  const slots = rigs.map((rig) =>
    roleAccessories(rig).map((spec) => {
      const index = cursors[spec.pool];
      cursors[spec.pool] += 1;
      return { ...spec, index };
    }),
  );
  return { slots, counts: cursors };
}
