import type { AgentId, AgentProfile, AgentState, Vec2 } from "./agentTypes.ts";
import { agentName } from "./AgentRegistry.ts";
import type { AgentEventDraft } from "../events/eventTypes.ts";
import type { AmbientConfig } from "../simulation/simulationConfig.ts";
import { randomInRange } from "../simulation/EventBus.ts";
import type { LocationId } from "../simulation/worldLayout.ts";
import {
  LOCATIONS,
  headingFor,
  route,
  slotFor,
} from "../simulation/worldLayout.ts";

export interface MoveAction {
  kind: "move";
  to: LocationId;
  slot?: number;
  activity?: string;
  onDone?: () => void;
  ambient?: boolean;
}

export interface WorkAction {
  kind: "work";
  duration: number;
  status: "working" | "thinking";
  activity: string;
  onProgress?: (progress: number) => void;
  onDone?: () => void;
  ambient?: boolean;
}

export interface TalkAction {
  kind: "talk";
  target: AgentId;
  duration: number;
  activity?: string;
  onStart?: () => void;
  onDone?: () => void;
  ambient?: boolean;
}

export interface EmoteAction {
  kind: "emote";
  status: "success" | "error";
  duration: number;
  activity?: string;
  onDone?: () => void;
  ambient?: boolean;
}

export interface WaitAction {
  kind: "wait";
  duration: number;
  face?: AgentId;
  activity?: string;
  onDone?: () => void;
  ambient?: boolean;
}

export interface CallAction {
  kind: "call";
  fn: () => void;
  onDone?: () => void;
  ambient?: boolean;
}

export type AgentAction =
  | MoveAction
  | WorkAction
  | TalkAction
  | EmoteAction
  | WaitAction
  | CallAction;

export interface AgentControllerConfig {
  walkSpeed: number;
  returnHomeDelay: number;
  ambient: AmbientConfig;
}

export interface AgentControllerOptions {
  profile: AgentProfile;
  state: AgentState;
  rng: () => number;
  clock: () => number;
  emit: (draft: AgentEventDraft) => void;
  getState: (id: AgentId) => AgentState | undefined;
  config: AgentControllerConfig;
}

interface RunningAction {
  action: AgentAction;
  elapsed: number;
  travelled: boolean;
  slot: number;
}

const AMBIENT_LOCATIONS: readonly LocationId[] = [
  "collab",
  "lounge",
  "planning",
];

const EPSILON = 1e-7;

function faceHeading(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * Owns one agent's action queue, movement along routed paths and ambient
 * behaviour. All timing is simulation time; the controller never reads a
 * wall clock and never renders anything.
 */
export class AgentController {
  private readonly profile: AgentProfile;
  private readonly state: AgentState;
  private readonly rng: () => number;
  private readonly clock: () => number;
  private readonly emit: (draft: AgentEventDraft) => void;
  private readonly getState: (id: AgentId) => AgentState | undefined;
  private readonly config: AgentControllerConfig;

  private readonly queue: AgentAction[] = [];
  private running: RunningAction | null = null;
  private ambientIdleSince: number | null = null;
  private nextAmbientAt: number;

  constructor(options: AgentControllerOptions) {
    this.profile = options.profile;
    this.state = options.state;
    this.rng = options.rng;
    this.clock = options.clock;
    this.emit = options.emit;
    this.getState = options.getState;
    this.config = options.config;
    this.nextAmbientAt =
      options.clock() + this.ambientGap();
  }

  enqueue(actions: readonly AgentAction[], options?: { ambient?: boolean }): void {
    for (const action of actions) {
      if (options?.ambient) action.ambient = true;
      this.queue.push(action);
    }
  }

  /** Called when a task phase starts: ambient play is cancelled. */
  assignTask(taskId: string): void {
    this.clearAmbient();
    this.state.currentTaskId = taskId;
    this.ambientIdleSince = null;
    this.nextAmbientAt = this.clock() + this.ambientGap();
  }

  /** Called when the agent no longer owns a task. */
  releaseTask(): void {
    this.state.currentTaskId = null;
    this.ambientIdleSince = null;
  }

  /** Drops queued ambient actions and interrupts one in flight. */
  clearAmbient(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].ambient) this.queue.splice(index, 1);
    }
    if (!this.running?.action.ambient) return;
    this.running = null;
    this.state.path = [];
    this.state.destination = null;
    this.state.location = null;
    this.clearFacing();
    this.state.status = "idle";
    this.state.activity = `${this.profile.name} is idle`;
  }

  tick(dt: number): void {
    if (this.state.paused || dt <= 0) return;

    let remaining = dt;
    let guard = 0;
    while (remaining > EPSILON && guard < 512) {
      guard += 1;

      if (!this.running) {
        const next = this.queue.shift();
        if (!next) break;
        this.startAction(next);
        if (!this.running) continue;
        if (this.readyToFinish()) {
          this.finishAction();
          continue;
        }
      }

      const consumed = this.advance(remaining);
      remaining -= consumed;
      if (this.running && this.readyToFinish()) {
        this.finishAction();
      }
      if (consumed <= EPSILON && this.running) break;
    }

    this.settleIdle();
    this.maybeAmbient();
  }

  private ambientGap(): number {
    return randomInRange(
      this.rng,
      this.config.ambient.minGap,
      this.config.ambient.maxGap,
    );
  }

  private startAction(action: AgentAction): void {
    switch (action.kind) {
      case "move": {
        const slot = action.slot ?? this.profile.seat;
        const target = slotFor(action.to, slot);
        const path = route(this.state.position, target);
        this.state.destination = action.to;
        this.state.location = null;
        this.state.path = path;
        this.state.status = "walking";
        this.state.activity =
          action.activity ?? `Walking to ${LOCATIONS[action.to].label}`;
        this.running = {
          action,
          elapsed: 0,
          travelled: path.length > 0,
          slot,
        };
        return;
      }
      case "work": {
        this.state.status = action.status;
        this.state.activity = action.activity;
        this.state.progress = 0;
        this.running = { action, elapsed: 0, travelled: false, slot: 0 };
        return;
      }
      case "talk": {
        const targetState = this.getState(action.target);
        this.state.status = "communicating";
        this.state.facingAgentId = action.target;
        this.state.activity =
          action.activity ?? `Talking to ${agentName(action.target)}`;
        if (targetState) {
          targetState.facingAgentId = this.profile.id;
          targetState.heading = faceHeading(
            targetState.position,
            this.state.position,
          );
          this.state.heading = faceHeading(
            this.state.position,
            targetState.position,
          );
        }
        this.running = { action, elapsed: 0, travelled: false, slot: 0 };
        action.onStart?.();
        return;
      }
      case "emote": {
        this.state.status = action.status;
        this.state.activity =
          action.activity ??
          (action.status === "success"
            ? `${this.profile.name} looks pleased`
            : `${this.profile.name} hit a problem`);
        this.running = { action, elapsed: 0, travelled: false, slot: 0 };
        return;
      }
      case "wait": {
        this.state.status = "idle";
        this.state.activity =
          action.activity ?? `${this.profile.name} is waiting`;
        if (action.face) this.state.facingAgentId = action.face;
        this.running = { action, elapsed: 0, travelled: false, slot: 0 };
        return;
      }
      case "call": {
        action.fn();
        action.onDone?.();
        this.running = null;
        return;
      }
    }
  }

  private advance(dt: number): number {
    const running = this.running;
    if (!running) return dt;
    const action = running.action;

    if (action.kind === "move") {
      return this.advanceMove(dt);
    }
    if (action.kind === "call") return dt;

    const remaining = Math.max(0, action.duration - running.elapsed);
    const consumed = Math.min(dt, remaining);
    running.elapsed += consumed;

    if (action.kind === "work" && action.duration > 0) {
      const progress = Math.min(1, running.elapsed / action.duration);
      this.state.progress = progress;
      action.onProgress?.(progress);
    }
    return consumed;
  }

  private advanceMove(dt: number): number {
    const speed = this.config.walkSpeed;
    let budget = dt * speed;
    let travelledDistance = 0;

    while (budget > EPSILON && this.state.path.length > 0) {
      const next = this.state.path[0];
      const dx = next.x - this.state.position.x;
      const dz = next.z - this.state.position.z;
      const step = Math.hypot(dx, dz);

      if (step <= EPSILON) {
        this.state.path.shift();
        continue;
      }

      if (step <= budget) {
        this.state.position.x = next.x;
        this.state.position.z = next.z;
        this.state.heading = Math.atan2(dx, dz);
        this.state.path.shift();
        budget -= step;
        travelledDistance += step;
      } else {
        const ratio = budget / step;
        this.state.position.x += dx * ratio;
        this.state.position.z += dz * ratio;
        this.state.heading = Math.atan2(dx, dz);
        travelledDistance += budget;
        budget = 0;
      }
    }

    return speed > 0 ? travelledDistance / speed : dt;
  }

  private readyToFinish(): boolean {
    const running = this.running;
    if (!running) return false;
    const action = running.action;
    if (action.kind === "move") return this.state.path.length === 0;
    if (action.kind === "call") return true;
    return running.elapsed >= action.duration - EPSILON;
  }

  private finishAction(): void {
    const running = this.running;
    if (!running) return;
    const action = running.action;
    this.running = null;

    switch (action.kind) {
      case "move": {
        const location = action.to;
        this.state.path = [];
        this.state.destination = null;
        this.state.location = location;
        this.state.heading = headingFor(location, running.slot);
        if (running.travelled) {
          this.emit({
            type: "agent.arrived",
            agentId: this.profile.id,
            message: `${this.profile.name} arrived at ${LOCATIONS[location].label}`,
            severity: "info",
            feed: false,
            metadata: { location },
          });
        }
        break;
      }
      case "talk": {
        this.clearFacing();
        break;
      }
      case "work":
      case "emote":
      case "wait":
        break;
      case "call":
        break;
    }

    action.onDone?.();
  }

  private clearFacing(): void {
    const targetId = this.state.facingAgentId;
    if (targetId === null) return;
    const target = this.getState(targetId);
    if (target && target.facingAgentId === this.profile.id) {
      target.facingAgentId = null;
    }
    this.state.facingAgentId = null;
  }

  private settleIdle(): void {
    if (this.running || this.queue.length > 0) return;
    if (this.state.paused) return;
    if (this.state.status !== "walking") {
      this.state.status = "idle";
    }
    if (this.state.currentTaskId === null) {
      this.state.progress = 0;
      this.state.activity = `${this.profile.name} is idle`;
    }
  }

  private maybeAmbient(): void {
    if (
      this.state.paused ||
      this.state.currentTaskId !== null ||
      this.running ||
      this.queue.length > 0
    ) {
      return;
    }

    const now = this.clock();
    if (this.ambientIdleSince === null) this.ambientIdleSince = now;

    const home = LOCATIONS[this.profile.home];
    if (this.state.location !== this.profile.home) {
      if (now - this.ambientIdleSince < this.config.returnHomeDelay) return;
      this.ambientIdleSince = null;
      this.enqueue(
        [
          {
            kind: "move",
            to: this.profile.home,
            activity: `Heading back to ${home.label}`,
          },
        ],
        { ambient: true },
      );
      return;
    }

    if (now < this.nextAmbientAt) return;

    const location =
      AMBIENT_LOCATIONS[
        Math.min(
          AMBIENT_LOCATIONS.length - 1,
          Math.floor(this.rng() * AMBIENT_LOCATIONS.length),
        )
      ];
    const label = LOCATIONS[location].label;
    const stay = randomInRange(
      this.rng,
      this.config.ambient.minStay,
      this.config.ambient.maxStay,
    );
    this.nextAmbientAt =
      now + this.config.returnHomeDelay + stay + this.ambientGap();

    this.enqueue(
      [
        {
          kind: "move",
          to: location,
          slot: this.profile.seat,
          activity: `Drifting to the ${label}`,
          onDone: () => {
            this.emit({
              type: "agent.ambient",
              agentId: this.profile.id,
              message: `${this.profile.name} drifted to the ${label}`,
              severity: "info",
              feed: false,
              metadata: { location },
            });
          },
        },
        {
          kind: "wait",
          duration: stay,
          activity: `Taking a moment at the ${label}`,
        },
        {
          kind: "move",
          to: this.profile.home,
          activity: `Heading back to ${home.label}`,
        },
      ],
      { ambient: true },
    );
  }
}
