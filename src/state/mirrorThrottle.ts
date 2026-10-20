import type { WorldSnapshot } from "../integrations/AgentBackend.ts";

/** Minimum gap between position/activity driven React mirror updates. */
export const MIRROR_INTERVAL_MS = 160;

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Fields that must reach React immediately: run state, speed, and the agent
 * and task status signature. Everything here changes visible UI structure.
 */
export function significantSignature(snapshot: WorldSnapshot): string {
  const agents = snapshot.agents
    .map(
      (agent) =>
        `${agent.id}:${agent.status}:${agent.paused ? 1 : 0}:${agent.currentTaskId ?? ""}:${agent.activity}`,
    )
    .join("|");
  const tasks = snapshot.tasks
    .map((task) => `${task.id}:${task.phase}:${task.status}`)
    .join("|");
  return `${snapshot.status}#${snapshot.speed}#${agents}#${tasks}`;
}

/**
 * Everything the HTML UI can read except positions, headings and paths. A
 * position-only snapshot keeps this value unchanged, so the mirror can drop it
 * without causing a React render.
 */
export function uiSignature(snapshot: WorldSnapshot): string {
  const agents = snapshot.agents
    .map((agent) =>
      [
        agent.id,
        agent.status,
        agent.paused ? 1 : 0,
        agent.activity,
        agent.currentTaskId ?? "",
        agent.location ?? "",
        agent.destination ?? "",
        agent.facingAgentId ?? "",
        agent.progress.toFixed(4),
      ].join(":"),
    )
    .join("|");
  const tasks = snapshot.tasks
    .map((task) =>
      [
        task.id,
        task.title,
        task.description,
        task.priority,
        task.status,
        task.phase,
        task.assignedAgentId ?? "",
        task.progress.toFixed(4),
        task.createdAt,
        task.updatedAt,
        task.completedAt ?? "",
        task.iteration,
        task.subtasks.map((subtask) => `${subtask.id}:${subtask.done ? 1 : 0}`).join(","),
        task.findings.length,
        task.history.length,
        task.isDemo ? 1 : 0,
        task.preferredAgentId ?? "",
        task.blockedReason ?? "",
      ].join(":"),
    )
    .join("|");
  return `${snapshot.status}#${snapshot.speed}#${agents}#${tasks}`;
}

export interface ThrottledMirrorOptions {
  push: (snapshot: WorldSnapshot) => void;
  intervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export type MirrorApplyResult = "immediate" | "throttled" | "ignored";

/**
 * Rate-limits React-bound snapshot updates without ever hiding a structural
 * change. The simulation can publish 30 snapshots per second; React sees at
 * most one per interval, and nothing at all when only positions moved.
 */
export class ThrottledMirror {
  private readonly push: (snapshot: WorldSnapshot) => void;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  private pending: WorldSnapshot | null = null;
  private timer: TimerHandle | null = null;
  private lastPushAt = Number.NEGATIVE_INFINITY;
  private lastSignificant: string | null = null;
  private lastUi = "";
  private disposed = false;

  constructor(options: ThrottledMirrorOptions) {
    this.push = options.push;
    this.intervalMs = options.intervalMs ?? MIRROR_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  apply(snapshot: WorldSnapshot): MirrorApplyResult {
    if (this.disposed) return "ignored";

    const significant = significantSignature(snapshot);
    const ui = uiSignature(snapshot);

    if (significant !== this.lastSignificant) {
      this.pushNow(snapshot, significant, ui);
      return "immediate";
    }

    if (ui === this.lastUi) {
      // Position, heading or path change only. The 3D layer reads liveWorld;
      // the HTML UI has nothing new to show.
      return "ignored";
    }

    this.pending = snapshot;
    const elapsed = this.now() - this.lastPushAt;
    if (elapsed >= this.intervalMs) {
      this.pushNow(snapshot, significant, ui);
      return "throttled";
    }

    if (this.timer === null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        const next = this.pending;
        if (next !== null) {
          this.pushNow(next, significantSignature(next), uiSignature(next));
        }
      }, this.intervalMs - elapsed);
    }
    return "throttled";
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private pushNow(
    snapshot: WorldSnapshot,
    significant: string,
    ui: string,
  ): void {
    this.pending = null;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.lastPushAt = this.now();
    this.lastSignificant = significant;
    this.lastUi = ui;
    this.push(snapshot);
  }
}
