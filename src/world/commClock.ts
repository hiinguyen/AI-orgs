import type { SimulationStatus } from "../integrations/AgentBackend.ts";

/**
 * Display clock for the communication arcs. The backend publishes snapshots
 * at 30 Hz; the render loop runs faster, so the arc clock free-runs between
 * snapshots and is corrected towards each new one.
 *
 * Correction is symmetric. The old `Math.max(local, snapshot)` could only pull
 * the clock forward: when the backend advanced slower than wall time the
 * packets drifted ahead of the robots until the error crossed the snap
 * threshold and the clock jumped back. A damped correction in both directions
 * keeps the arcs beside the agents instead.
 */

export interface CommClockSample {
  clock: number;
  status: SimulationStatus;
  speed: number;
}

export interface CommClockState {
  clock: number;
  /** Identity of the last applied sample, so a repeat send is not a new one. */
  sample: CommClockSample | null;
}

/**
 * An error this large is a reset, a demo restart or a reconnect, not normal
 * jitter, so the clock snaps instead of easing.
 */
export const COMM_CLOCK_SNAP_SECONDS = 0.25;

/** Fraction of the remaining error corrected on each new snapshot. */
export const COMM_CLOCK_CORRECTION_RATE = 0.4;

/**
 * Advance the display clock by one frame and, when `sample` is a new
 * snapshot, ease it towards the backend clock. The clock never steps
 * backward by more than one frame's worth while running, and it snaps when
 * the simulation is not running or the error is large.
 */
export function syncCommClock(
  state: CommClockState,
  sample: CommClockSample,
  delta: number,
): void {
  const speed =
    Number.isFinite(sample.speed) && sample.speed > 0 ? sample.speed : 0;
  const frameAdvance = (Number.isFinite(delta) ? Math.max(0, delta) : 0) * speed;
  const previous = state.clock;
  const first = state.sample === null;
  const isNew = state.sample !== sample;
  state.sample = sample;

  if (sample.status !== "running" || first) {
    state.clock = sample.clock;
    return;
  }

  const predicted = previous + frameAdvance;
  if (!isNew) {
    state.clock = predicted;
    return;
  }

  const error = sample.clock - predicted;
  if (Math.abs(error) > COMM_CLOCK_SNAP_SECONDS) {
    state.clock = sample.clock;
    return;
  }

  const corrected = predicted + error * COMM_CLOCK_CORRECTION_RATE;
  state.clock = Math.max(corrected, previous - frameAdvance);
}
