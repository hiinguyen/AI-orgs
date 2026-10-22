import type { AgentStatus } from "./agentTypes.ts";
import { dampValue, animationTimeScale } from "./agentMath.ts";

/**
 * Procedural robot animation. Every animation state is a pure function that
 * writes an absolute pose into a caller-owned object, so a frame never
 * allocates. The animator keeps one weight per state, damps the weights
 * towards the target with delta time and returns the weighted sum.
 */

export const ANIMATION_STATES: readonly AgentStatus[] = [
  "idle",
  "walking",
  "working",
  "thinking",
  "communicating",
  "success",
  "error",
] as const;

/** Rotations in radians, offsets in metres. */
export interface AgentPose {
  bodyLift: number;
  bodyPitch: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armLeftX: number;
  armLeftZ: number;
  armRightX: number;
  armRightZ: number;
  legLeftX: number;
  legRightX: number;
}

const WEIGHT_LAMBDA = 8;
const MAX_STEP_SECONDS = 0.1;

export const DEFAULT_LEG_LENGTH = 0.66;

/** Largest leg swing, so the fastest walk never does a split. */
export const MAX_LEG_SWING = 0.5;
/** Largest arm swing, slightly smaller than the legs as in a real gait. */
export const MAX_ARM_SWING = 0.45;
const ARM_SWING_RATIO = MAX_ARM_SWING / MAX_LEG_SWING;
/**
 * Fastest gait cadence, in steps per second. With the drawn (scaled) leg
 * length the slowest rig needs about 7.7 steps/s at 2x, so eight keeps every
 * rig planted there; 4x is capped and slides.
 */
export const MAX_WALK_CADENCE = 8;
/** Ground speed over which the walk swing ramps in from zero, in m/s. */
export const WALK_RAMP_SPEED = 0.1;
/** Lateral arm angle that brings the typing hands over the keyboard. */
export const TYPING_ARM_SPREAD = 0.28;

export function createPose(): AgentPose {
  return {
    bodyLift: 0,
    bodyPitch: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    armLeftX: 0,
    armLeftZ: 0,
    armRightX: 0,
    armRightZ: 0,
    legLeftX: 0,
    legRightX: 0,
  };
}

export function resetPose(pose: AgentPose): void {
  pose.bodyLift = 0;
  pose.bodyPitch = 0;
  pose.headPitch = 0;
  pose.headYaw = 0;
  pose.headRoll = 0;
  pose.armLeftX = 0;
  pose.armLeftZ = 0;
  pose.armRightX = 0;
  pose.armRightZ = 0;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

function addWeighted(target: AgentPose, source: AgentPose, weight: number): void {
  target.bodyLift += source.bodyLift * weight;
  target.bodyPitch += source.bodyPitch * weight;
  target.headPitch += source.headPitch * weight;
  target.headYaw += source.headYaw * weight;
  target.headRoll += source.headRoll * weight;
  target.armLeftX += source.armLeftX * weight;
  target.armLeftZ += source.armLeftZ * weight;
  target.armRightX += source.armRightX * weight;
  target.armRightZ += source.armRightZ * weight;
  target.legLeftX += source.legLeftX * weight;
  target.legRightX += source.legRightX * weight;
}



export function idlePose(pose: AgentPose, time: number, speed: number): void {
  void speed;
  const breath = Math.sin(time * 1.6);
  pose.bodyLift = 0.006 + breath * 0.006;
  pose.bodyPitch = 0.012;
  pose.headPitch = -0.02 + Math.sin(time * 0.7) * 0.03;
  pose.headYaw = Math.sin(time * 0.45 + 1) * 0.14;
  pose.headRoll = Math.sin(time * 0.6) * 0.02;
  pose.armLeftX = Math.sin(time * 0.9) * 0.04 + 0.01;
  pose.armLeftZ = -0.06;
  pose.armRightX = -Math.sin(time * 0.9 + 0.4) * 0.04 + 0.01;
  pose.armRightZ = 0.06;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

/**
 * Swing amplitude for a ground speed. It ramps in smoothly over the first
 * `WALK_RAMP_SPEED` m/s, so crossing a standstill cannot step the legs from
 * neutral to a visible swing, then grows with speed up to `MAX_LEG_SWING`.
 */
export function walkAmplitude(speed: number): number {
  const moving = Math.max(0, speed);
  const ramp = Math.min(1, moving / WALK_RAMP_SPEED);
  const eased = ramp * ramp * (3 - 2 * ramp);
  return Math.min(MAX_LEG_SWING, (0.12 + 0.2 * moving) * eased);
}

/**
 * Steps per second for a ground speed. The stride length is set by the swing
 * amplitude, so below the cadence cap the distance covered per step matches
 * the ground exactly and the planted foot does not slide.
 */
export function walkCadence(
  speed: number,
  legLength: number = DEFAULT_LEG_LENGTH,
): number {
  const moving = Math.max(0, speed);
  const amplitude = walkAmplitude(moving);
  if (amplitude === 0) return 0;
  const stride = 2 * legLength * Math.sin(amplitude);
  return Math.min(MAX_WALK_CADENCE, moving / Math.max(stride, 0.1));
}

/**
 * A rigid-leg stride whose ground speed matches the speed the robot is
 * actually moving at. `walkPhase` is integrated by the animator instead of
 * being derived from the absolute clock, so a change of speed cannot jump the
 * legs to another point of the cycle.
 *
 * The renderer lowers the pelvis by `hipHeight * (1 - cos(swing))`, which
 * keeps the lower foot exactly on the floor at every stride angle.
 */
export function walkingPose(
  pose: AgentPose,
  walkPhase: number,
  speed: number,
): void {
  const moving = Math.max(0, speed);
  const amplitude = walkAmplitude(moving);
  // Keep the phase moving through the cycle while a stationary weight fades.
  const swing = amplitude * Math.sin(walkPhase);
  const ratio = Math.min(1, moving / 2.4);

  // The vertical bob belongs to the pelvis, which the renderer derives from
  // the leg angle; lifting the torso here would also lift the feet.
  pose.bodyLift = 0;
  pose.bodyPitch = 0.05 + 0.02 * ratio;
  pose.headPitch = -0.02 - Math.sin(walkPhase * 2) * 0.02 * ratio;
  pose.headYaw = Math.sin(walkPhase * 0.5) * 0.04 * ratio;
  pose.headRoll = 0;
  pose.armLeftX = -swing * ARM_SWING_RATIO;
  pose.armLeftZ = -0.07;
  pose.armRightX = swing * ARM_SWING_RATIO;
  pose.armRightZ = 0.07;
  pose.legLeftX = swing;
  pose.legRightX = -swing;
}

export function workingPose(pose: AgentPose, time: number, speed: number): void {
  void speed;
  const typing = Math.sin(time * 9.5);
  pose.bodyLift = 0.004 + Math.sin(time * 2.2) * 0.004;
  pose.bodyPitch = 0.15;
  pose.headPitch = 0.17;
  pose.headYaw = Math.sin(time * 0.8) * 0.03;
  pose.headRoll = 0;
  // Arms reach forward and inwards, hands about a keyboard width apart.
  pose.armLeftX = -0.95 + typing * 0.12;
  pose.armLeftZ = TYPING_ARM_SPREAD;
  pose.armRightX = -0.95 - typing * 0.12;
  pose.armRightZ = -TYPING_ARM_SPREAD;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

export function thinkingPose(pose: AgentPose, time: number, speed: number): void {
  void speed;
  pose.bodyLift = 0.006 + Math.sin(time * 1.4) * 0.004;
  pose.bodyPitch = 0.02;
  pose.headPitch = -0.06 + Math.sin(time * 0.9) * 0.02;
  pose.headYaw = -0.18;
  pose.headRoll = 0.16;
  pose.armLeftX = 0.04;
  pose.armLeftZ = -0.08;
  pose.armRightX = -1.92 + Math.sin(time * 1.2) * 0.05;
  pose.armRightZ = -0.55;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

export function communicatingPose(
  pose: AgentPose,
  time: number,
  speed: number,
): void {
  void speed;
  const gesture = Math.sin(time * 3.2);
  pose.bodyLift = 0.008 + Math.sin(time * 1.9) * 0.005;
  pose.bodyPitch = 0.035;
  pose.headPitch = -0.03;
  pose.headYaw = Math.sin(time * 2.1) * 0.08;
  pose.headRoll = 0.03 * Math.sin(time * 1.6);
  pose.armLeftX = -0.22;
  pose.armLeftZ = -0.06;
  pose.armRightX = -1.12 + gesture * 0.16;
  pose.armRightZ = -0.32 + gesture * 0.06;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

export function successPose(pose: AgentPose, time: number, speed: number): void {
  void speed;
  const bounce = Math.abs(Math.sin(time * 5.4));
  pose.bodyLift = bounce * 0.16;
  pose.bodyPitch = -0.02;
  pose.headPitch = -0.12;
  pose.headYaw = Math.sin(time * 2.6) * 0.04;
  pose.headRoll = 0;
  pose.armLeftX = -2.45;
  pose.armLeftZ = -0.55;
  pose.armRightX = -2.45;
  pose.armRightZ = 0.55;
  pose.legLeftX = 0.04;
  pose.legRightX = -0.04;
}

export function errorPose(pose: AgentPose, time: number, speed: number): void {
  void speed;
  pose.bodyLift = 0.002 + Math.sin(time * 1.3) * 0.002;
  pose.bodyPitch = 0.22;
  pose.headPitch = 0.36;
  pose.headYaw = Math.sin(time * 0.7) * 0.03;
  pose.headRoll = 0.04;
  pose.armLeftX = 0.12;
  pose.armLeftZ = -0.04;
  pose.armRightX = 0.12;
  pose.armRightZ = 0.04;
  pose.legLeftX = 0;
  pose.legRightX = 0;
}

/**
 * Write the absolute pose for one state. `walkPhase` is the integrated gait
 * phase; callers that do not track one get a time-derived phase for a single
 * sample, which is enough for the headless pose checks.
 */
export function poseForState(
  state: AgentStatus,
  pose: AgentPose,
  time: number,
  speed: number,
  legLength: number = DEFAULT_LEG_LENGTH,
  walkPhase?: number,
): void {
  switch (state) {
    case "idle":
      idlePose(pose, time, speed);
      return;
    case "walking": {
      const phase =
        walkPhase ?? time * walkCadence(speed, legLength) * Math.PI;
      walkingPose(pose, phase, speed);
      return;
    }
    case "working":
      workingPose(pose, time, speed);
      return;
    case "thinking":
      thinkingPose(pose, time, speed);
      return;
    case "communicating":
      communicatingPose(pose, time, speed);
      return;
    case "success":
      successPose(pose, time, speed);
      return;
    case "error":
      errorPose(pose, time, speed);
      return;
  }
}

export class AgentAnimator {
  /** Per-state blend weights, always normalised to a sum of one. */
  readonly weights: Record<AgentStatus, number> = {
    idle: 1,
    walking: 0,
    working: 0,
    thinking: 0,
    communicating: 0,
    success: 0,
    error: 0,
  };

  /** The blended output, reused on every call. */
  readonly pose: AgentPose = createPose();

  private readonly scratch: AgentPose = createPose();
  private elapsed = 0;
  private walkPhaseValue = 0;

  /** Animation clock since the animator was created, in seconds. */
  get time(): number {
    return this.elapsed;
  }

  /**
   * Integrated gait phase in radians. It only ever advances by the current
   * cadence, so changing speed cannot shift the legs to another pose.
   */
  get walkPhase(): number {
    return this.walkPhaseValue;
  }

  /**
   * Advance the animation clock and blend towards `status`. `frozen` is true
   * while the agent or the simulation is paused: the clock and the blend run
   * at 15 per cent speed so the character settles instead of freezing rigid.
   */
  update(
    delta: number,
    status: AgentStatus,
    speed: number,
    frozen: boolean,
    legLength: number = DEFAULT_LEG_LENGTH,
  ): AgentPose {
    const step =
      Math.min(Math.max(delta, 0), MAX_STEP_SECONDS) *
      animationTimeScale(frozen);
    this.elapsed += step;
    this.walkPhaseValue +=
      walkCadence(speed, legLength) * Math.PI * step;

    let total = 0;
    for (const state of ANIMATION_STATES) {
      const target = state === status ? 1 : 0;
      const weight = dampValue(this.weights[state], target, WEIGHT_LAMBDA, step);
      this.weights[state] = weight;
      total += weight;
    }

    if (total < 1e-6) {
      for (const state of ANIMATION_STATES) {
        this.weights[state] = state === status ? 1 : 0;
      }
      total = 1;
    }

    resetPose(this.pose);
    for (const state of ANIMATION_STATES) {
      const weight = this.weights[state];
      if (weight < 1e-4) continue;
      poseForState(
        state,
        this.scratch,
        this.elapsed,
        speed,
        legLength,
        this.walkPhaseValue,
      );
      addWeighted(this.pose, this.scratch, weight / total);
    }

    return this.pose;
  }
}

/** Convenience used by the headless checks: one state, no blending. */
export function poseFor(
  state: AgentStatus,
  time: number,
  speed: number,
  legLength: number = DEFAULT_LEG_LENGTH,
  walkPhase?: number,
): AgentPose {
  const pose = createPose();
  poseForState(state, pose, time, speed, legLength, walkPhase);
  return pose;
}
