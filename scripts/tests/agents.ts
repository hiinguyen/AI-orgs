/**
 * Phase 4 checks for the pure agent modules: the rig table, accessory layout,
 * gait, pose blending, heading damping, label scale and the comm-link clock.
 * These are the parts of the 3D layer that can run without a renderer, so
 * `npm test` catches them in Node. Each topic has its own suite; `runAgentsSuite`
 * is the entry point.
 */
import {
  AGENT_RIGS,
  ACCESSORY_KINDS,
  ARM_SPREAD,
  animatorInputsFor,
  chestHeight,
  handSpread,
  headTopHeight,
  labelHeight,
  legLength,
  rigFor,
} from "../../src/agents/agentRigs.ts";
import type { AgentRole } from "../../src/agents/agentTypes.ts";
import { CORE_AGENT_IDS } from "../../src/agents/agentTypes.ts";
import { getAgentProfile } from "../../src/agents/AgentRegistry.ts";
import {
  ACCESSORY_POOLS,
  buildAccessoryLayout,
} from "../../src/agents/robotAccessories.ts";
import {
  ANIMATION_STATES,
  AgentAnimator,
  MAX_ARM_SWING,
  MAX_LEG_SWING,
  MAX_WALK_CADENCE,
  TYPING_ARM_SPREAD,
  WALK_RAMP_SPEED,
  createPose,
  poseFor,
  poseForState,
  walkAmplitude,
  walkCadence,
} from "../../src/agents/AgentAnimator.ts";
import { SIMULATION_CONFIG } from "../../src/simulation/simulationConfig.ts";
import {
  LABEL_SCALE_MAX,
  LABEL_SCALE_MIN,
  animationTimeScale,
  dampAngle,
  isTeleport,
  labelScale,
  normalizeAngle,
  shortestAngleDelta,
} from "../../src/agents/agentMath.ts";
import {
  syncCommClock,
  type CommClockSample,
  type CommClockState,
} from "../../src/world/commClock.ts";
import type { TestReporter } from "./harness.ts";

const ROLES: readonly AgentRole[] = [
  "orchestrator",
  "researcher",
  "product_manager",
  "engineer",
  "qa",
  "reviewer",
];

/** Shortest drawn leg, the worst case for the cadence cap. */
const GAIT_LEG_LENGTH = legLength(AGENT_RIGS.qa);

/** One render frame at 60 fps, the display clock's nominal step. */
const FRAME_SECONDS = 1 / 60;

function close(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

function finitePose(pose: ReturnType<typeof createPose>): boolean {
  return Object.values(pose).every((value) => Number.isFinite(value));
}

function runRigTableChecks(reporter: TestReporter): void {
  const { check } = reporter;

  check(
    "one rig per role, keyed by role",
    ROLES.every((role) => AGENT_RIGS[role]?.role === role) &&
      Object.keys(AGENT_RIGS).length === ROLES.length,
  );
  check(
    "every agent maps to a rig with a finite scale in 0.96-1.12",
    CORE_AGENT_IDS.every((id) => {
      const rig = rigFor(getAgentProfile(id).role);
      return (
        Number.isFinite(rig.scale) && rig.scale >= 0.96 && rig.scale <= 1.12
      );
    }),
  );
  check(
    "all six accessories are distinct silhouettes",
    new Set(ROLES.map((role) => AGENT_RIGS[role].accessory)).size === 6 &&
      ACCESSORY_KINDS.length === 6,
  );
  check(
    "torso, head, arm and leg dimensions are positive",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      return (
        rig.torsoWidth > 0 &&
        rig.torsoHeight > 0 &&
        rig.torsoDepth > 0 &&
        rig.headWidth > 0 &&
        rig.headHeight > 0 &&
        rig.headDepth > 0 &&
        rig.armLength > 0 &&
        rig.armRadius > 0 &&
        rig.legRadius > 0
      );
    }),
  );
  check(
    "rigFor returns the same table entry",
    ROLES.every((role) => rigFor(role) === AGENT_RIGS[role]),
  );
}

function runRigHeightChecks(reporter: TestReporter): void {
  const { check } = reporter;

  check(
    "label height after scale stays within 1.85-2.05 m",
    ROLES.every((role) => {
      const height = labelHeight(AGENT_RIGS[role]);
      return height >= 1.85 && height <= 2.05;
    }),
    ROLES.map(
      (role) => `${role}:${labelHeight(AGENT_RIGS[role]).toFixed(3)}`,
    ).join(" "),
  );
  check(
    "the visible head top after scale stays within 1.75-1.85 m",
    ROLES.every((role) => {
      const height = headTopHeight(AGENT_RIGS[role]);
      return height >= 1.75 && height <= 1.85;
    }),
    ROLES.map(
      (role) => `${role}:${headTopHeight(AGENT_RIGS[role]).toFixed(3)}`,
    ).join(" "),
  );
  check(
    "the label anchor clears the visible head top by 0.10-0.15 m",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      const clearance = (rig.labelY - rig.headTopY) * rig.scale;
      return clearance >= 0.1 && clearance <= 0.15;
    }),
    ROLES.map((role) => {
      const rig = AGENT_RIGS[role];
      return `${role}:${((rig.labelY - rig.headTopY) * rig.scale).toFixed(3)}`;
    }).join(" "),
  );
}

function runRigOrderChecks(reporter: TestReporter): void {
  const { check } = reporter;

  check(
    "head top is above the head sphere centre",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      return rig.headTopY >= rig.headCenterY + rig.headHeight / 2;
    }),
  );
  check(
    "hip < shoulder < head centre < label anchor",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      return (
        rig.hipHeight < rig.shoulderHeight &&
        rig.shoulderHeight < rig.headCenterY &&
        rig.headCenterY + rig.headHeight / 2 < rig.labelY
      );
    }),
  );
  check(
    "chest height sits between the hip and the shoulders",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      const chest = chestHeight(rig);
      return chest > rig.hipHeight && chest < rig.shoulderHeight;
    }),
  );
  check(
    "the drawn leg length applies the rig scale to the hip height",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      return close(legLength(rig), rig.hipHeight * rig.scale);
    }),
  );
  check(
    "rig to animator inputs use the drawn leg length",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      const inputs = animatorInputsFor(rig);
      return (
        close(inputs.legLength, legLength(rig)) &&
        close(inputs.legLength, rig.hipHeight * rig.scale)
      );
    }),
    ROLES.map(
      (role) => `${role}:${animatorInputsFor(AGENT_RIGS[role]).legLength.toFixed(3)}`,
    ).join(" "),
  );
}

function runRigSuite(reporter: TestReporter): void {
  reporter.group("Agent rigs");
  runRigTableChecks(reporter);
  runRigHeightChecks(reporter);
  runRigOrderChecks(reporter);
}

function runLayoutSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Robot accessories");
  const layout = buildAccessoryLayout(ROLES.map((role) => AGENT_RIGS[role]));
  check(
    "the layout builds one slot list per rig",
    layout.slots.length === ROLES.length,
  );
  check(
    "every pool has unique contiguous instance indices",
    ACCESSORY_POOLS.every((pool) => {
      const indices = layout.slots.flatMap((slots) =>
        slots
          .filter((slot) => slot.pool === pool)
          .map((slot) => slot.index),
      );
      return (
        indices.length === layout.counts[pool] &&
        new Set(indices).size === indices.length &&
        indices.every((index) => index >= 0 && index < indices.length)
      );
    }),
  );
  check(
    "every rig carries an accent part for its colour",
    layout.slots.every((slots) =>
      slots.some(
        (slot) =>
          slot.pool === "accentBoxes" ||
          slot.pool === "accentSpheres" ||
          slot.pool === "accentRings",
      ),
    ),
  );
  check(
    "hip and belt parts follow the pelvis, not the leaning torso",
    layout.slots.every(
      (slots) => slots.filter((slot) => slot.space === "pelvis").length >= 3,
    ),
  );
}

function runWalkPoseChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent gait");
  check(
    "walking swing is driven by actual speed",
    poseFor("walking", 0.1, 0).legLeftX === 0 &&
      poseFor("walking", 0.1, 2.4).legLeftX !== 0,
  );
  check(
    "walking leaves the vertical bob to the pelvis",
    poseFor("walking", 0.3, 2.4).bodyLift === 0 &&
      poseFor("walking", 0.3, 9.6).bodyLift === 0,
  );

  const quarter = Math.PI / 2;
  const atPeak = (speed: number) =>
    poseFor("walking", 0, speed, GAIT_LEG_LENGTH, quarter);
  check(
    "walk swing grows with ground speed up to the cap",
    Math.abs(atPeak(0.6).legLeftX) < Math.abs(atPeak(2.4).legLeftX) &&
      Math.abs(atPeak(2.4).legLeftX) <= MAX_LEG_SWING + 1e-9,
    `0.6:${atPeak(0.6).legLeftX.toFixed(3)} 2.4:${atPeak(2.4).legLeftX.toFixed(3)}`,
  );

  {
    let largestStep = 0;
    let previous = walkAmplitude(0);
    for (let speed = 0.002; speed <= WALK_RAMP_SPEED + 1e-9; speed += 0.002) {
      const amplitude = walkAmplitude(speed);
      largestStep = Math.max(largestStep, amplitude - previous);
      previous = amplitude;
    }
    check(
      "walk amplitude ramps in smoothly from zero",
      walkAmplitude(0) === 0 &&
        largestStep < 0.005 &&
        walkAmplitude(0.02) < 0.02 &&
        walkAmplitude(WALK_RAMP_SPEED) > 0.1,
      `max step ${largestStep.toFixed(4)} rad, 0.02:${walkAmplitude(0.02).toFixed(4)}`,
    );
  }

  {
    let peakLeg = 0;
    let peakArm = 0;
    for (let speed = 0; speed <= 9.6 + 1e-9; speed += 0.1) {
      const pose = atPeak(speed);
      peakLeg = Math.max(peakLeg, Math.abs(pose.legLeftX));
      peakArm = Math.max(peakArm, Math.abs(pose.armLeftX));
    }
    check(
      "walk amplitude never exceeds the leg and arm caps up to 4x",
      peakLeg <= MAX_LEG_SWING + 1e-9 && peakArm <= MAX_ARM_SWING + 1e-9,
      `leg ${peakLeg.toFixed(3)} arm ${peakArm.toFixed(3)}`,
    );
  }
}

function runStrideChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent stride");
  {
    const cadences: string[] = [];
    const planted = ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      const leg = legLength(rig);
      let ok = true;
      for (const multiplier of [1, 2]) {
        const speed = SIMULATION_CONFIG.walkSpeed * multiplier;
        const stride = 2 * leg * Math.sin(walkAmplitude(speed));
        const cadence = walkCadence(speed, leg);
        if (Math.abs(cadence * stride - speed) > 1e-9) ok = false;
        if (multiplier === 2) cadences.push(`${role}:${cadence.toFixed(2)}`);
      }
      return ok;
    });
    check(
      "every rig's stride matches ground speed at 1x and 2x",
      planted,
      `${cadences.join(" ")} steps/s at 2x (cap ${MAX_WALK_CADENCE})`,
    );
  }

  {
    const strideAt4x =
      2 *
      GAIT_LEG_LENGTH *
      Math.sin(walkAmplitude(SIMULATION_CONFIG.walkSpeed * 4));
    const walkCadence4x = walkCadence(
      SIMULATION_CONFIG.walkSpeed * 4,
      GAIT_LEG_LENGTH,
    );
    check(
      "the step rate is capped at 4x, so the capped gait slides there",
      walkCadence4x === MAX_WALK_CADENCE &&
        walkCadence4x * strideAt4x < SIMULATION_CONFIG.walkSpeed * 4,
      `${walkCadence4x.toFixed(2)} steps/s covers ${(walkCadence4x * strideAt4x).toFixed(2)} m/s`,
    );
  }
}

function runWalkPhaseChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent gait phase");
  {
    const animator = new AgentAnimator();
    const step = 1 / 60;
    let previous = animator.walkPhase;
    let rampOk = true;
    for (let index = 0; index < 720; index += 1) {
      const speed = Math.min(9.6, index * 0.02);
      animator.update(step, "walking", speed, false, GAIT_LEG_LENGTH);
      const jump = animator.walkPhase - previous;
      if (jump < -1e-12 || jump > MAX_WALK_CADENCE * Math.PI * step + 1e-9) {
        rampOk = false;
      }
      previous = animator.walkPhase;
    }
    check("the gait phase advances continuously over a speed ramp", rampOk);

    // The old phase came from the absolute clock, so a speed change after a
    // minute shifted it by elapsed * delta cadence. One update around that
    // point may only advance by one capped step.
    const settled = new AgentAnimator();
    for (let index = 0; index < 60 * 30; index += 1) {
      settled.update(1 / 30, "walking", 2.4, false, GAIT_LEG_LENGTH);
    }
    const beforeChange = settled.walkPhase;
    settled.update(1 / 30, "walking", 9.6, false, GAIT_LEG_LENGTH);
    const change = settled.walkPhase - beforeChange;
    check(
      "a speed change does not jump the gait phase",
      change >= 0 && change <= MAX_WALK_CADENCE * Math.PI * (1 / 30) + 1e-9,
      `jump ${change.toFixed(4)} rad`,
    );
  }
}

function runGaitSuite(reporter: TestReporter): void {
  runWalkPoseChecks(reporter);
  runStrideChecks(reporter);
  runWalkPhaseChecks(reporter);
}

function runPoseShapeChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent pose shapes");
  check(
    "createPose starts at rest",
    Object.values(createPose()).every((value) => value === 0),
  );
  check(
    "every state writes a finite pose",
    ANIMATION_STATES.every((state) => finitePose(poseFor(state, 0.7, 2.4))),
  );
  check(
    "typing hands sit 0.30-0.35 m apart, inside the shoulders",
    ROLES.every((role) => {
      const rig = AGENT_RIGS[role];
      const spread = handSpread(rig, TYPING_ARM_SPREAD);
      const shoulders =
        (rig.torsoWidth / 2 + rig.armRadius + ARM_SPREAD) * 2 * rig.scale;
      return spread >= 0.3 && spread <= 0.35 && spread < shoulders;
    }),
    ROLES.map((role) =>
      `${role}:${handSpread(AGENT_RIGS[role], TYPING_ARM_SPREAD).toFixed(3)}`,
    ).join(" "),
  );
  check(
    "working leans forward more than idle",
    poseFor("working", 0.4, 0).bodyPitch >
      poseFor("idle", 0.4, 0).bodyPitch,
  );
  check(
    "error keeps the feet on the floor while slumping",
    poseFor("error", 0.4, 0).bodyLift >= 0 &&
      poseFor("error", 0.4, 0).headPitch > poseFor("idle", 0.4, 0).headPitch,
  );
  {
    const scratch = createPose();
    poseForState("success", scratch, 0.5, 0);
    const first = scratch.bodyLift;
    poseForState("error", scratch, 0.5, 0);
    check(
      "poseForState overwrites every field instead of accumulating",
      scratch.bodyLift !== first && finitePose(scratch),
    );
  }
}

function runPoseBlendChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent pose blending");
  {
    const animator = new AgentAnimator();
    const initial = animator.weights.idle;
    const returnedFirst = animator.update(1 / 60, "working", 1, false);
    const returnedSecond = animator.update(1 / 60, "working", 1, false);
    check(
      "weights blend towards the target without a snap",
      initial === 1 &&
        animator.weights.idle > 0 &&
        animator.weights.working > 0 &&
        animator.weights.idle < 1,
    );
    check(
      "state weights always sum to one",
      close(
        ANIMATION_STATES.reduce(
          (total, state) => total + animator.weights[state],
          0,
        ),
        1,
        1e-9,
      ),
    );
    check(
      "update returns the same preallocated pose object",
      returnedFirst === returnedSecond && returnedFirst === animator.pose,
    );
    for (let index = 0; index < 180; index += 1) {
      animator.update(1 / 60, "working", 1, false);
    }
    check(
      "after three seconds the target state dominates",
      animator.weights.working > 0.99 &&
        ANIMATION_STATES.every((state) =>
          state === "working" ? true : animator.weights[state] < 0.01,
        ),
    );
    check("blended pose stays finite", finitePose(animator.pose));
  }
}

function runAnimationClockChecks(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent animation clock");
  {
    const frozen = new AgentAnimator();
    const running = new AgentAnimator();
    for (let index = 0; index < 10; index += 1) {
      frozen.update(0.1, "idle", 0, true);
      running.update(0.1, "idle", 0, false);
    }
    check(
      "frozen animation advances the clock at 15 per cent",
      close(frozen.time, 0.15, 1e-9) && close(running.time, 1, 1e-9),
      `${frozen.time.toFixed(3)} vs ${running.time.toFixed(3)}`,
    );
  }
  check(
    "frozen animation time scale is 0.15",
    close(animationTimeScale(true), 0.15) &&
      close(animationTimeScale(false), 1),
  );
}

function runAnimatorSuite(reporter: TestReporter): void {
  runPoseShapeChecks(reporter);
  runPoseBlendChecks(reporter);
  runAnimationClockChecks(reporter);
}

function runMotionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent motion");
  check(
    "shortest heading delta wraps across +/- PI",
    close(shortestAngleDelta(3, -3), 2 * Math.PI - 6, 1e-6) &&
      Math.abs(shortestAngleDelta(3, -3)) < Math.PI &&
      Math.abs(shortestAngleDelta(-3, 3)) < Math.PI,
  );
  check(
    "normalizeAngle wraps into (-PI, PI]",
    close(normalizeAngle(Math.PI * 3), Math.PI, 1e-6) &&
      close(normalizeAngle(-Math.PI * 3), Math.PI, 1e-6) &&
      close(normalizeAngle(0), 0, 1e-6),
  );
  {
    const first = dampAngle(3, -3, 9, 0.05);
    check(
      "dampAngle takes the short arc instead of crossing zero",
      first > 3,
      `result ${first.toFixed(4)}`,
    );
    const settled = dampAngle(3, -3, 9, 1);
    check(
      "dampAngle converges on the wrapped target",
      Math.abs(shortestAngleDelta(settled, -3)) < 1e-3,
      `result ${settled.toFixed(5)}`,
    );
    const split = dampAngle(dampAngle(3, -3, 9, 1 / 30), -3, 9, 1 / 30);
    const whole = dampAngle(3, -3, 9, 1 / 15);
    check(
      "dampAngle is frame-rate independent",
      Math.abs(split - whole) < 1e-6,
      `${split.toFixed(6)} vs ${whole.toFixed(6)}`,
    );
  }
  check(
    "teleport detection triggers over 4 m",
    isTeleport(0, 0, 4.1, 0) && !isTeleport(0, 0, 3.9, 0),
  );
}

function runLabelScaleSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("Agent labels");
  check(
    "label scale clamps to 0.72-1.05",
    close(labelScale(40, 4), LABEL_SCALE_MAX) &&
      close(labelScale(40, 60), LABEL_SCALE_MIN),
  );
  {
    const mid = labelScale(40, 9);
    check(
      "label scale follows 6.5 / (2 tan(fov/2) distance) in the middle",
      mid > LABEL_SCALE_MIN &&
        mid <= LABEL_SCALE_MAX &&
        Math.abs(mid - 6.5 / (2 * Math.tan((40 * Math.PI) / 360) * 9)) < 1e-9,
      `scale ${mid.toFixed(4)}`,
    );
  }
  check(
    "label scale is monotonic with distance",
    [8, 10, 12, 14, 18].every((distance, index, list) =>
      index === 0
        ? true
        : labelScale(40, distance) <= labelScale(40, list[index - 1]),
    ),
  );
}

/**
 * Run a snapshot stream whose clock advances `rate` times wall time, with a
 * new snapshot every `snapshotEvery` frames.
 */
function runSlowerBackend(
  rate: number,
  snapshotEvery: number,
  frames: number,
): number {
  const state: CommClockState = { clock: 0, sample: null };
  let backend = 0;
  let sample: CommClockSample = { clock: backend, status: "running", speed: 1 };
  syncCommClock(state, sample, FRAME_SECONDS);
  let maxError = 0;
  for (let index = 0; index < frames; index += 1) {
    backend += FRAME_SECONDS * rate;
    if (index % snapshotEvery === 0) {
      sample = { clock: backend, status: "running", speed: 1 };
    }
    syncCommClock(state, sample, FRAME_SECONDS);
    maxError = Math.max(maxError, Math.abs(state.clock - backend));
  }
  return maxError;
}

function runClockDriftChecks(reporter: TestReporter): void {
  const { check } = reporter;

  const maxError = runSlowerBackend(0.5, 3, 60 * 5);
  check(
    "a backend slower than wall time holds the clock within 100 ms",
    maxError < 0.1,
    `largest error ${(maxError * 1000).toFixed(1)} ms`,
  );
}

function runClockBackwardResetChecks(reporter: TestReporter): void {
  const { check } = reporter;

  const state: CommClockState = { clock: 0, sample: null };
  let backend = 0;
  let sample: CommClockSample = { clock: backend, status: "running", speed: 1 };
  syncCommClock(state, sample, FRAME_SECONDS);
  for (let index = 0; index < 30; index += 1) {
    backend += FRAME_SECONDS;
    if (index % 2 === 0) {
      sample = { clock: backend, status: "running", speed: 1 };
    }
    syncCommClock(state, sample, FRAME_SECONDS);
  }

  // A demo restart that rewinds the backend clock by less than the snap
  // threshold: the display clock must ease back, not jump.
  backend -= 0.08;
  sample = { clock: backend, status: "running", speed: 1 };
  let maxBackstep = 0;
  let frames = 0;
  for (let index = 0; index < 60; index += 1) {
    const previous = state.clock;
    if (index > 0) {
      backend += FRAME_SECONDS;
      if (index % 2 === 0) {
        sample = { clock: backend, status: "running", speed: 1 };
      }
    }
    syncCommClock(state, sample, FRAME_SECONDS);
    maxBackstep = Math.max(maxBackstep, previous - state.clock);
    if (Math.abs(state.clock - backend) <= 0.01) {
      frames = index + 1;
      break;
    }
  }
  check(
    "a backward reset under 1 s re-syncs within 12 frames",
    frames > 0 && frames <= 12,
    `re-synced in ${frames} frames`,
  );
  check(
    "the correction never steps the clock back more than one frame",
    maxBackstep <= FRAME_SECONDS + 1e-9,
    `largest step back ${(maxBackstep * 1000).toFixed(2)} ms`,
  );
}

function runClockSnapChecks(reporter: TestReporter): void {
  const { check } = reporter;

  {
    const state: CommClockState = { clock: 40, sample: null };
    syncCommClock(
      state,
      { clock: 40, status: "running", speed: 1 },
      FRAME_SECONDS,
    );
    syncCommClock(
      state,
      { clock: 39.5, status: "running", speed: 1 },
      FRAME_SECONDS,
    );
    check(
      "a running jump past the snap threshold snaps",
      close(state.clock, 39.5),
      `clock ${state.clock.toFixed(3)}`,
    );
  }
  {
    const state: CommClockState = { clock: 40, sample: null };
    syncCommClock(
      state,
      { clock: 40, status: "running", speed: 1 },
      FRAME_SECONDS,
    );
    syncCommClock(
      state,
      { clock: 12.5, status: "paused", speed: 1 },
      FRAME_SECONDS,
    );
    check(
      "pause snaps the display clock to the snapshot",
      close(state.clock, 12.5),
      `clock ${state.clock.toFixed(3)}`,
    );
  }
}

function runCommClockSuite(reporter: TestReporter): void {
  reporter.group("Communication link clock");
  runClockDriftChecks(reporter);
  runClockBackwardResetChecks(reporter);
  runClockSnapChecks(reporter);
}

export function runAgentsSuite(reporter: TestReporter): void {
  runRigSuite(reporter);
  runLayoutSuite(reporter);
  runGaitSuite(reporter);
  runAnimatorSuite(reporter);
  runMotionSuite(reporter);
  runLabelScaleSuite(reporter);
  runCommClockSuite(reporter);
}
