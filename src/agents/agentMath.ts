/**
 * Pure motion and label maths shared by the 3D layer and the headless checks.
 * No React, three or Next imports: `node --experimental-strip-types` loads it
 * directly.
 */

export const POSITION_LAMBDA = 12;
export const HEADING_LAMBDA = 9;

/** A jump over this distance is a reset or teleport: snap instead of damping. */
export const TELEPORT_DISTANCE = 4;

/** Animation time multiplier while the simulation is paused or not running. */
export const FROZEN_TIME_SCALE = 0.15;

export const LABEL_SCALE_MIN = 0.72;
export const LABEL_SCALE_MAX = 1.05;
export const LABEL_DISTANCE_CONSTANT = 6.5;

const TWO_PI = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Exponential approach, frame-rate independent. Matches
 * `THREE.MathUtils.damp` without importing three.
 */
export function dampValue(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  if (delta <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/** Wrap an angle into (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

/** Signed shortest rotation that takes `from` to `to`, in (-PI, PI]. */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/**
 * Damp a heading along the short arc. Normalizing after every step keeps the
 * value bounded, so a character that spins past PI never accumulates turns.
 */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  if (delta <= 0) return normalizeAngle(current);
  const step = shortestAngleDelta(current, target);
  return normalizeAngle(current + step * (1 - Math.exp(-lambda * delta)));
}

/** True when the distance between two floor points is a reset-sized jump. */
export function isTeleport(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  return dx * dx + dz * dz > TELEPORT_DISTANCE * TELEPORT_DISTANCE;
}

/**
 * Spec 6.4: `scale = clamp(6.5 / (2 * tan(fov / 2) * distance), 0.72, 1.05)`.
 * The value is a screen-space multiplier for the DOM speech bubble.
 */
export function labelScale(fovDegrees: number, distance: number): number {
  const fovRadians = (fovDegrees * Math.PI) / 180;
  const denominator =
    2 * Math.tan(fovRadians / 2) * Math.max(distance, 0.001);
  if (denominator < 1e-6) return LABEL_SCALE_MAX;
  return clamp(
    LABEL_DISTANCE_CONSTANT / denominator,
    LABEL_SCALE_MIN,
    LABEL_SCALE_MAX,
  );
}

/** Animation clock multiplier: frozen agents move at 15 per cent speed. */
export function animationTimeScale(frozen: boolean): number {
  return frozen ? FROZEN_TIME_SCALE : 1;
}
