/**
 * Pure reduced-motion decisions shared by the animator, the environment and
 * the camera. No React, three or browser globals, so `npm test` can exercise
 * every branch.
 */

/** Scale a decorative oscillation down, or remove it, under reduced motion. */
export function motionAmplitude(
  reducedMotion: boolean,
  amplitude: number,
): number {
  return reducedMotion ? 0 : amplitude;
}

/**
 * Pick an animated level or a fixed level. Used for pulses, rings and glow
 * pools that should hold still when the user asks for less motion.
 */
export function motionLevel(
  reducedMotion: boolean,
  animated: number,
  fixed: number,
): number {
  return reducedMotion ? fixed : animated;
}
