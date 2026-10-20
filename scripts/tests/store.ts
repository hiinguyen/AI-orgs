/**
 * Store checks: the throttled React mirror. Section 9 check 7 in the phase 2
 * brief and spec pitfall 7.
 */
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import type { WorldSnapshot } from "../../src/integrations/AgentBackend.ts";
import { SimulationEngine } from "../../src/simulation/SimulationEngine.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import {
  MIRROR_INTERVAL_MS,
  ThrottledMirror,
} from "../../src/state/mirrorThrottle.ts";
import type { TestReporter } from "./harness.ts";

interface FakeTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

export function runMirrorSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("7. React mirror throttle");

  const timers: FakeTimer[] = [];
  const pushes: number[] = [];
  let now = 0;

  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      let next: FakeTimer | null = null;
      for (const timer of timers) {
        if (
          !timer.cancelled &&
          timer.at <= target &&
          (next === null || timer.at < next.at)
        ) {
          next = timer;
        }
      }
      if (next === null) break;
      next.cancelled = true;
      now = next.at;
      next.callback();
    }
    now = target;
  };

  const mirror = new ThrottledMirror({
    intervalMs: MIRROR_INTERVAL_MS,
    now: () => now,
    setTimer: (callback, ms) => {
      const timer: FakeTimer = { at: now + ms, callback, cancelled: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      (handle as unknown as FakeTimer).cancelled = true;
    },
    push: () => {
      pushes.push(now);
    },
  });

  const baseEngine = new SimulationEngine();
  baseEngine.start();
  baseEngine.submitTask(DEMO_TASK);
  for (let index = 0; index < 120; index += 1) {
    baseEngine.tick(TICK_SECONDS);
  }
  const base = baseEngine.snapshot();
  check(
    "mirror check starts from a live world",
    base.tasks.length > 0 && base.agents.length === 6,
    `${base.tasks.length} tasks`,
  );

  const positionOnly = (step: number): WorldSnapshot => ({
    ...base,
    clock: base.clock + step * 0.01,
    agents: base.agents.map((agent, index) => ({
      ...agent,
      position: {
        x: agent.position.x + step * 0.01 * (index + 1),
        z: agent.position.z - step * 0.005,
      },
      heading: agent.heading + step * 0.002,
    })),
  });

  const progressOnly = (step: number): WorldSnapshot => ({
    ...base,
    clock: base.clock + step * 0.02,
    agents: base.agents.map((agent) => ({
      ...agent,
      progress: Math.min(1, agent.progress + step * 0.002),
    })),
    tasks: base.tasks.map((task) => ({
      ...task,
      progress: Math.min(1, task.progress + step * 0.002),
      updatedAt: task.updatedAt + step * 0.02,
    })),
  });

  mirror.apply(base);
  const seedCount = pushes.length;
  for (let index = 0; index < 30; index += 1) {
    now += 1000 / 30;
    advance(0);
    mirror.apply(positionOnly(index + 1));
  }
  advance(250);
  check(
    "30 position-only snapshots per second never reach the React mirror",
    pushes.length === seedCount,
    `${pushes.length - seedCount} extra updates`,
  );

  const progressStart = pushes.length;
  for (let index = 0; index < 30; index += 1) {
    now += 1000 / 30;
    mirror.apply(progressOnly(index + 1));
    advance(0);
  }
  advance(250);
  const progressPushes = pushes.slice(progressStart);
  const gaps = progressPushes
    .slice(1)
    .map((at, index) => at - progressPushes[index]);
  check(
    "progress-only snapshots are throttled to about one update per 160 ms",
    progressPushes.length >= 3 && progressPushes.length <= 8,
    `${progressPushes.length} updates in about one second`,
  );
  check(
    "throttled mirror updates are at least 160 ms apart",
    gaps.every((gap) => gap >= MIRROR_INTERVAL_MS - 1e-6),
    gaps.map((gap) => gap.toFixed(1)).join(", "),
  );

  const beforeStatus = pushes.length;
  now += 10;
  const statusAt = now;
  const statusResult = mirror.apply({ ...base, status: "paused" });
  check(
    "a status change reaches the mirror immediately",
    statusResult === "immediate" &&
      pushes.length === beforeStatus + 1 &&
      pushes[pushes.length - 1] === statusAt,
    `${statusResult}, ${pushes.length - beforeStatus} updates`,
  );

  mirror.dispose();
}
