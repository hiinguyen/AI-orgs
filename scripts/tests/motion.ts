/**
 * Phase 6 checks for reduced-motion decisions: the pure policy helpers and
 * the calm pose variants. Walking keeps its stride because it carries
 * information; idle sway and the success bounce do not.
 */
import {
  motionAmplitude,
  motionLevel,
} from "../../src/agents/motionPolicy.ts";
import {
  DEFAULT_LEG_LENGTH,
  createPose,
  poseFor,
  poseForState,
} from "../../src/agents/AgentAnimator.ts";
import type { AgentPose } from "../../src/agents/AgentAnimator.ts";
import type { AgentStatus } from "../../src/agents/agentTypes.ts";
import type { TestReporter } from "./harness.ts";

const QUARTER = Math.PI / 2;
const STATES: readonly AgentStatus[] = [
  "idle",
  "walking",
  "working",
  "thinking",
  "communicating",
  "success",
  "error",
];

/** Sample one full cycle of the working and thinking poses, 0 to 6.3 s. */
function sampleTimes(): number[] {
  return Array.from({ length: 127 }, (_, index) => index * 0.05);
}

function poseSeries(
  state: AgentStatus,
  calm: boolean,
  field: keyof AgentPose,
): number[] {
  return sampleTimes().map(
    (time) =>
      poseFor(state, time, 0, DEFAULT_LEG_LENGTH, undefined, calm)[field],
  );
}

function peakToPeak(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function samePose(
  left: ReturnType<typeof createPose>,
  right: ReturnType<typeof createPose>,
): boolean {
  return Object.keys(left).every(
    (key) =>
      left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

export function runReducedMotionSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("Reduced motion policy");

  check(
    "motionAmplitude removes oscillation when reduced",
    motionAmplitude(true, 0.8) === 0 && motionAmplitude(false, 0.8) === 0.8,
  );
  check(
    "motionLevel holds the fixed level when reduced",
    motionLevel(true, 2.35, 1.95) === 1.95 &&
      motionLevel(false, 2.35, 1.95) === 2.35,
  );

  const idleA = poseFor("idle", 0.4, 0, DEFAULT_LEG_LENGTH, undefined, true);
  const idleB = poseFor("idle", 2.7, 0, DEFAULT_LEG_LENGTH, undefined, true);
  check(
    "idle pose is static under reduced motion",
    samePose(idleA, idleB) &&
      idleA.headYaw === 0 &&
      idleA.headRoll === 0,
  );

  const walkA = poseFor(
    "walking",
    0.2,
    2.4,
    DEFAULT_LEG_LENGTH,
    QUARTER,
    true,
  );
  const walkB = poseFor(
    "walking",
    0.2,
    2.4,
    DEFAULT_LEG_LENGTH,
    QUARTER,
    false,
  );
  check(
    "walking keeps its stride under reduced motion",
    Math.abs(walkA.legLeftX) > 0.1 &&
      walkA.legLeftX === walkB.legLeftX &&
      walkA.armLeftX === walkB.armLeftX,
  );
  check(
    "walking loses only the head sway under reduced motion",
    walkA.headPitch === -0.02 && walkA.headYaw === 0 && walkB.headYaw !== 0,
  );

  const successCalm = poseFor(
    "success",
    0.3,
    0,
    DEFAULT_LEG_LENGTH,
    undefined,
    true,
  );
  const successNormal = poseFor(
    "success",
    0.3,
    0,
    DEFAULT_LEG_LENGTH,
    undefined,
    false,
  );
  check(
    "success celebration bounce is removed under reduced motion",
    successCalm.bodyLift === 0 && successNormal.bodyLift > 0.05,
  );

  const errorCalm = poseFor(
    "error",
    0.8,
    0,
    DEFAULT_LEG_LENGTH,
    undefined,
    true,
  );
  const errorLater = poseFor(
    "error",
    3.1,
    0,
    DEFAULT_LEG_LENGTH,
    undefined,
    true,
  );
  check(
    "error slump holds still under reduced motion",
    samePose(errorCalm, errorLater),
  );

  const scratch = createPose();
  poseForState("communicating", scratch, 1.2, 0, DEFAULT_LEG_LENGTH, undefined, true);
  check(
    "calm poses stay finite for every animated state",
    ["idle", "walking", "working", "thinking", "communicating", "success", "error"].every(
      (state) =>
        Object.values(
          poseFor(
            state as Parameters<typeof poseFor>[0],
            1.1,
            2.4,
            DEFAULT_LEG_LENGTH,
            QUARTER,
            true,
          ),
        ).every((value) => Number.isFinite(value)),
    ) &&
      Object.values(scratch).every((value) => Number.isFinite(value)),
  );

  group("Working and thinking motion");

  check(
    "typing swings the hands at least 0.4 rad peak to peak",
    peakToPeak(poseSeries("working", false, "armLeftX")) >= 0.4,
  );
  check(
    "thinking hand taps the chin at least 0.2 rad peak to peak",
    peakToPeak(poseSeries("thinking", false, "armRightX")) >= 0.2,
  );
  check(
    "working head nods at least 0.08 rad peak to peak",
    peakToPeak(poseSeries("working", false, "headPitch")) >= 0.08,
  );
  check(
    "idle arm sway stays under 0.12 rad peak to peak",
    peakToPeak(poseSeries("idle", false, "armLeftX")) <= 0.12,
  );

  const CALM_FIELDS: readonly (keyof AgentPose)[] = [
    "armLeftX",
    "armRightX",
    "headPitch",
    "headYaw",
    "headRoll",
    "bodyLift",
  ];
  check(
    "working and thinking hold still under reduced motion",
    (["working", "thinking"] as const).every((state) =>
      CALM_FIELDS.every(
        (field) => peakToPeak(poseSeries(state, true, field)) === 0,
      ),
    ),
  );

  check(
    "every pose field stays finite over the sampled cycle",
    STATES.every((state) =>
      [false, true].every((calm) =>
        sampleTimes().every((time) =>
          Object.values(
            poseFor(state, time, 2.4, DEFAULT_LEG_LENGTH, QUARTER, calm),
          ).every((value) => Number.isFinite(value)),
        ),
      ),
    ),
  );
}
