import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  Vec2,
} from "../agents/agentTypes.ts";
import { MAX_LIVE_AGENTS } from "../agents/agentTypes.ts";
import { CORE_AGENTS } from "../agents/AgentRegistry.ts";
import type {
  AgentEvent,
  AgentEventType,
  EventSeverity,
} from "../events/eventTypes.ts";
import type {
  CommLink,
  SimulationStatus,
  WorldSnapshot,
} from "../integrations/AgentBackend.ts";
import type {
  Task,
  TaskPriority,
  WorkflowPhase,
} from "../tasks/taskTypes.ts";
import { PHASE_STATUS, isTerminalPhase } from "../tasks/taskTypes.ts";
import {
  WAITING_LOCATION,
  allocateBay,
  bayStand,
  routeToBay,
} from "./bays.ts";
import type { LocationId } from "./worldLayout.ts";
import { headingFor, route, slotFor } from "./worldLayout.ts";

/**
 * The shared live stage: bay allocation, the waiting queue, walking routes,
 * fade timing, link expiry and snapshot building for any backend that announces
 * live subagents. It is pure TypeScript with no Node, React or DOM imports so
 * Node can run it directly; the fake live server and the Claude Code bridge are
 * thin drivers on top of this model.
 */

export type LivePhase =
  | "hold"
  | "walk-to-bay"
  | "waiting"
  | "work"
  | "emote"
  | "walk-home"
  | "fade";

/** One live agent: its announced profile, serialisable state and timeline. */
export interface LiveAgent {
  id: AgentId;
  profile: AgentProfile;
  state: AgentState;
  phase: LivePhase;
  timer: number;
  bay: number | null;
  waiting: boolean;
  spawnedAt: number;
  outcome: "success" | "error";
  path: Vec2[];
  target: Vec2;
  linkAt: number;
  /** 0 means "stay working until the driver explicitly finishes the agent". */
  workSeconds: number;
  /** Optional text kept through the walk home, for a finish summary. */
  holdActivity: string | null;
}

export interface LiveStageOptions {
  /** Live agents allowed at once. Extra spawns are dropped and counted. */
  maxAgents?: number;
  /** Walking speed in m/s. */
  walkSpeed?: number;
  /** Pause at the hub before walking to a bay. */
  spawnHoldSeconds?: number;
  /** Fade window after the walk home. */
  fadeSeconds?: number;
  /** Success/error emote before the walk home. */
  emoteSeconds?: number;
  /** Communication arc lifetime. */
  linkDuration?: number;
  /** Wall clock source, injectable for tests. */
  now?: () => number;
  /** Prefix for generated event ids. */
  eventIdPrefix?: string;
}

export interface SpawnOptions {
  /** 0 or absent keeps the agent working until `finish()` is called. */
  workSeconds?: number;
  /** Outcome used when the work timer completes on its own. */
  outcome?: "success" | "error";
}

export interface FinishOptions {
  /** Activity text to keep through the emote and walk home. */
  activity?: string;
}

/** What the driver tells the stage about a unit of live work. */
export interface StartLiveTaskOptions {
  title: string;
  description?: string;
  /** The phase the work belongs to; the owner's role usually decides it. */
  phase: WorkflowPhase;
  owner: AgentId | null;
  priority?: TaskPriority;
}

/** Completed live tasks are kept for the panel history, newest last. */
export const MAX_LIVE_TASKS = 60;

/** Profiles kept for finished agents whose tasks are still listed. */
const MAX_LIVE_PROFILES = 256;

const DEFAULTS = {
  walkSpeed: 2.4,
  spawnHoldSeconds: 0.4,
  fadeSeconds: 0.4,
  emoteSeconds: 1.2,
  linkDuration: 2.4,
} as const;

const MAX_ACTIVITY_LENGTH = 200;

function truncatedActivity(value: string): string {
  return value.length > MAX_ACTIVITY_LENGTH
    ? value.slice(0, MAX_ACTIVITY_LENGTH)
    : value;
}

/** Same millisecond rounding as the snapshot clock, so times line up. */
function roundClock(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function coreState(profile: AgentProfile): AgentState {
  const home = profile.home ?? "hub";
  const slot = slotFor(home, profile.seat);
  return {
    id: profile.id,
    status: "idle",
    activity: `${profile.name} is idle`,
    currentTaskId: null,
    progress: 0,
    location: home,
    destination: null,
    position: { x: slot.x, z: slot.z },
    heading: headingFor(home, profile.seat),
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

/**
 * The two core agents with a board to visit in live mode. Every other core
 * agent stays fixed at its home station regardless of live subagent activity.
 */
const CORE_BOARD_LOCATION: Partial<Record<AgentId, LocationId>> = {
  piper: "planning",
  iris: "researchBoard",
};

interface CoreMotionState {
  phase: "to-board" | "at-board" | "to-home";
  position: Vec2;
  heading: number;
  path: Vec2[];
  location: LocationId | null;
}

/**
 * Move a point along a routed path at `speed`, returning the consumed step and
 * the last heading it faced. Mutates both the position and the path.
 */
export function advance(
  position: Vec2,
  path: Vec2[],
  budget: number,
): { moved: number; heading: number | null } {
  let remaining = budget;
  let moved = 0;
  let heading: number | null = null;
  while (remaining > 1e-7 && path.length > 0) {
    const next = path[0];
    const dx = next.x - position.x;
    const dz = next.z - position.z;
    const step = Math.hypot(dx, dz);
    if (step <= 1e-7) {
      path.shift();
      continue;
    }
    heading = Math.atan2(dx, dz);
    if (step <= remaining) {
      position.x = next.x;
      position.z = next.z;
      path.shift();
      remaining -= step;
      moved += step;
    } else {
      const ratio = remaining / step;
      position.x += dx * ratio;
      position.z += dz * ratio;
      moved += remaining;
      remaining = 0;
    }
  }
  return { moved, heading };
}

export interface AgentEventExtra {
  agentId?: AgentId;
  targetAgentId?: AgentId;
  taskId?: string;
  severity?: EventSeverity;
  feed?: boolean;
  metadata?: Record<string, unknown>;
}

export class LiveStage {
  private readonly maxAgents: number;
  private readonly walkSpeed: number;
  private readonly spawnHoldSeconds: number;
  private readonly fadeSeconds: number;
  private readonly emoteSeconds: number;
  private readonly linkDuration: number;
  private readonly now: () => number;
  private readonly eventIdPrefix: string;

  private clockSeconds = 0;
  private status: SimulationStatus = "running";
  private speed = 1;
  private globalPaused = false;
  private eventSeq = 0;
  private linkSeq = 0;
  private baysDirty = false;

  private readonly agents: LiveAgent[] = [];
  private readonly links: CommLink[] = [];
  private readonly tasks: Task[] = [];
  private readonly pendingEvents: AgentEvent[] = [];
  /**
   * Every profile this stage has spawned. A finished agent leaves the roster
   * but its task keeps referring to it, so the snapshot includes the profile
   * for as long as a task does.
   */
  private readonly profilesById = new Map<AgentId, AgentProfile>();
  private taskSeq = 0;
  private readonly coreOverrides = new Map<
    AgentId,
    { status: AgentStatus; activity: string }
  >();
  /** Walking state for the core agents that have a board (Piper, Iris). */
  private readonly coreMotion = new Map<AgentId, CoreMotionState>();

  /** Transient core outcomes, shown over the overrides until `until`. */
  private readonly coreFlashes = new Map<
    AgentId,
    { status: AgentStatus; activity: string; until: number }
  >();

  /** Spawn requests refused because the cap was reached. */
  droppedSpawns = 0;

  constructor(options: LiveStageOptions = {}) {
    this.maxAgents = options.maxAgents ?? MAX_LIVE_AGENTS;
    this.walkSpeed = options.walkSpeed ?? DEFAULTS.walkSpeed;
    this.spawnHoldSeconds =
      options.spawnHoldSeconds ?? DEFAULTS.spawnHoldSeconds;
    this.fadeSeconds = options.fadeSeconds ?? DEFAULTS.fadeSeconds;
    this.emoteSeconds = options.emoteSeconds ?? DEFAULTS.emoteSeconds;
    this.linkDuration = options.linkDuration ?? DEFAULTS.linkDuration;
    this.now = options.now ?? Date.now;
    this.eventIdPrefix = options.eventIdPrefix ?? "live";
  }

  get clock(): number {
    return this.clockSeconds;
  }

  get simulationStatus(): SimulationStatus {
    return this.status;
  }

  get liveAgents(): readonly LiveAgent[] {
    return this.agents;
  }

  setStatus(status: SimulationStatus): void {
    this.status = status;
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed;
  }

  setGlobalPaused(paused: boolean): void {
    this.globalPaused = paused;
  }

  has(id: AgentId): boolean {
    return this.agents.some((agent) => agent.id === id);
  }

  getAgent(id: AgentId): LiveAgent | null {
    return this.agents.find((agent) => agent.id === id) ?? null;
  }

  /** An event queued for the driver to broadcast. */
  emit(
    type: AgentEventType,
    message: string,
    extra: AgentEventExtra = {},
  ): void {
    this.eventSeq += 1;
    this.pendingEvents.push({
      id: `${this.eventIdPrefix}-evt-${this.eventSeq}`,
      type,
      timestamp: this.now(),
      simTime: Math.round(this.clockSeconds * 1000) / 1000,
      message: truncatedActivity(message),
      severity: extra.severity ?? "info",
      feed: extra.feed ?? true,
      ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
      ...(extra.targetAgentId === undefined
        ? {}
        : { targetAgentId: extra.targetAgentId }),
      ...(extra.taskId === undefined ? {} : { taskId: extra.taskId }),
      ...(extra.metadata === undefined ? {} : { metadata: extra.metadata }),
    });
  }

  /** Take the events emitted since the last drain. */
  drainEvents(): AgentEvent[] {
    const events = this.pendingEvents.slice();
    this.pendingEvents.length = 0;
    return events;
  }

  /** Spawn a live agent. Returns null on a duplicate id or a full stage. */
  spawn(profile: AgentProfile, options: SpawnOptions = {}): LiveAgent | null {
    if (this.agents.length >= this.maxAgents) {
      this.droppedSpawns += 1;
      return null;
    }
    if (this.has(profile.id)) return null;

    const hub = slotFor("hub", 0);
    const state: AgentState = {
      id: profile.id,
      status: "idle",
      activity: "Arrived at the Operations Hub",
      currentTaskId: null,
      progress: 0,
      location: "hub",
      destination: null,
      position: { x: hub.x, z: hub.z },
      heading: headingFor("hub", 0),
      path: [],
      facingAgentId: null,
      paused: false,
    };
    const agent: LiveAgent = {
      id: profile.id,
      profile,
      state,
      phase: "hold",
      timer: 0,
      bay: null,
      waiting: false,
      spawnedAt: this.clockSeconds,
      outcome: options.outcome ?? "success",
      path: [],
      target: hub,
      linkAt: 0,
      workSeconds: Math.max(0, options.workSeconds ?? 0),
      holdActivity: null,
    };
    this.agents.push(agent);
    this.rememberProfile(profile);

    const bay = allocateBay(this.occupiedBays());
    if (bay === null) {
      agent.phase = "waiting";
      agent.waiting = true;
      agent.state.activity = "Waiting for a dispatch bay";
      this.placeWaiting();
    } else if (this.spawnHoldSeconds > 0) {
      agent.bay = bay;
      agent.timer = this.spawnHoldSeconds;
      agent.state.activity = "Booting at the Operations Hub";
    } else {
      this.beginWalkToBay(agent, bay);
    }

    this.emit("agent.spawned", `${profile.name} joined the Dispatch Floor`, {
      agentId: profile.id,
      severity: "info",
      feed: true,
      metadata: {
        role: profile.role,
        bay: agent.bay,
        waiting: agent.waiting,
        name: profile.name,
      },
    });
    return agent;
  }

  /** Update any live agent's activity, and optionally its status. */
  setActivity(
    id: AgentId,
    activity: string,
    status?: AgentStatus,
  ): void {
    const live = this.getAgent(id);
    if (live !== null) {
      live.state.activity = truncatedActivity(activity);
      if (status !== undefined) live.state.status = status;
      return;
    }
    const core = CORE_AGENTS.find((profile) => profile.id === id);
    if (core === undefined) return;
    const current = this.coreOverrides.get(id);
    this.coreOverrides.set(id, {
      status: status ?? current?.status ?? "idle",
      activity: truncatedActivity(activity),
    });
  }

  /** Update a core agent's status without changing its activity. */
  setStatusFor(id: AgentId, status: AgentStatus): void {
    const live = this.getAgent(id);
    if (live !== null) {
      live.state.status = status;
      return;
    }
    const core = CORE_AGENTS.find((profile) => profile.id === id);
    if (core === undefined) return;
    const current = this.coreOverrides.get(id);
    this.coreOverrides.set(id, {
      status,
      activity: current?.activity ?? `${core.name} is idle`,
    });
  }

  /**
   * Flash a core agent with a success or error outcome for `durationMs` of
   * stage time. The persistent override is untouched and shows again once the
   * flash expires; a new flash on the same agent replaces the old one.
   */
  flashCore(
    id: AgentId,
    status: "success" | "error",
    activity: string,
    durationMs: number,
  ): void {
    if (!CORE_AGENTS.some((profile) => profile.id === id)) return;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.coreFlashes.set(id, {
      status,
      activity: truncatedActivity(activity),
      until: this.clockSeconds + durationMs / 1000,
    });
  }

  /**
   * Walk a core agent with a board (Piper, Iris) from wherever it is to that
   * board. No-op for a core agent without a board, or one already heading to
   * or standing at it.
   */
  sendCoreToBoard(id: AgentId): void {
    const boardLocation = CORE_BOARD_LOCATION[id];
    if (boardLocation === undefined) return;
    const existing = this.coreMotion.get(id);
    if (
      existing !== undefined &&
      (existing.phase === "to-board" || existing.phase === "at-board")
    ) {
      return;
    }
    const profile = CORE_AGENTS.find((candidate) => candidate.id === id);
    if (profile === undefined) return;
    const home = profile.home ?? "hub";
    const from = existing?.position ?? slotFor(home, profile.seat);
    const target = slotFor(boardLocation, profile.seat);
    this.coreMotion.set(id, {
      phase: "to-board",
      position: { ...from },
      heading: existing?.heading ?? headingFor(home, profile.seat),
      path: route(from, target),
      location: null,
    });
  }

  /**
   * Walk a core agent with a board back to its home station. No-op when it
   * has no motion entry (already home) or is already heading there.
   */
  sendCoreHome(id: AgentId): void {
    const existing = this.coreMotion.get(id);
    if (existing === undefined || existing.phase === "to-home") return;
    const profile = CORE_AGENTS.find((candidate) => candidate.id === id);
    if (profile === undefined) return;
    const home = profile.home ?? "hub";
    const target = slotFor(home, profile.seat);
    this.coreMotion.set(id, {
      phase: "to-home",
      position: { ...existing.position },
      heading: existing.heading,
      path: route(existing.position, target),
      location: null,
    });
  }

  /** Add a communication arc between two agents. */
  link(from: AgentId, to: AgentId, kind: CommLink["kind"]): void {
    this.linkSeq += 1;
    this.links.push({
      id: `${this.eventIdPrefix}-link-${this.linkSeq}`,
      from,
      to,
      kind,
      startedAt: Math.round(this.clockSeconds * 1000) / 1000,
      endsAt:
        Math.round((this.clockSeconds + this.linkDuration) * 1000) / 1000,
    });
  }

  /**
   * Finish a live agent: success/error emote, a despawn event with its
   * lifetime, then a walk home and fade. Repeated calls are ignored.
   */
  finish(id: AgentId, outcome: "success" | "error", options: FinishOptions = {}): boolean {
    const agent = this.getAgent(id);
    if (agent === null) return false;
    if (
      agent.phase === "emote" ||
      agent.phase === "walk-home" ||
      agent.phase === "fade"
    ) {
      return false;
    }
    agent.outcome = outcome;
    agent.phase = "emote";
    agent.timer = this.emoteSeconds;
    agent.holdActivity =
      options.activity === undefined
        ? null
        : truncatedActivity(options.activity);
    agent.state.status = outcome;
    agent.state.progress = 1;
    agent.state.activity =
      options.activity !== undefined
        ? truncatedActivity(options.activity)
        : outcome === "error"
          ? `${agent.profile.name} hit a problem`
          : `${agent.profile.name} looks pleased`;
    const duration = Math.max(0, this.clockSeconds - agent.spawnedAt);
    this.emit("agent.despawned", `${agent.profile.name} left the floor`, {
      agentId: agent.id,
      severity: outcome === "error" ? "error" : "success",
      feed: true,
      metadata: { outcome, duration },
    });
    this.freeBay(agent);
    return true;
  }

  /** Drop a live agent immediately, with no emote or fade. */
  remove(id: AgentId): boolean {
    const index = this.agents.findIndex((agent) => agent.id === id);
    if (index < 0) return false;
    const [agent] = this.agents.splice(index, 1);
    if (agent?.bay !== null && agent !== undefined) {
      this.promoteWaiting();
    }
    return true;
  }

  /**
   * Start the task an agent is working on. The stage owns the record so the
   * side panel, the mission wall and every other snapshot reader see one list.
   */
  startTask(options: StartLiveTaskOptions): Task {
    this.taskSeq += 1;
    const at = roundClock(this.clockSeconds);
    const task: Task = {
      id: `L-${this.taskSeq}`,
      title: options.title,
      description: options.description ?? "",
      priority: options.priority ?? "medium",
      status: PHASE_STATUS[options.phase],
      phase: options.phase,
      assignedAgentId: options.owner,
      progress: 0,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      iteration: 0,
      subtasks: [],
      findings: [],
      history: [
        { from: "queued", to: options.phase, signal: "picked_up", at },
      ],
      isDemo: false,
      preferredAgentId: null,
      blockedReason: null,
    };
    this.tasks.push(task);
    this.trimTasks();
    this.setCurrentTask(options.owner, task.id);
    return task;
  }

  /** A task by id, live reference, or null when it was trimmed or unknown. */
  getTask(id: string): Task | null {
    return this.tasks.find((task) => task.id === id) ?? null;
  }

  /** Mark a running task as freshly updated; terminal tasks do not move. */
  touchTask(id: string): void {
    const task = this.getTask(id);
    if (task === null || isTerminalPhase(task.phase)) return;
    task.updatedAt = roundClock(this.clockSeconds);
  }

  /**
   * Finish a running task. A success is done and fully progressed; a failure
   * keeps the progress it had and ends in the failed phase.
   */
  finishTask(id: string, outcome: "success" | "error"): boolean {
    const task = this.getTask(id);
    if (task === null || isTerminalPhase(task.phase)) return false;
    const at = roundClock(this.clockSeconds);
    const to: WorkflowPhase = outcome === "success" ? "done" : "failed";
    task.history.push({
      from: task.phase,
      to,
      signal: outcome === "success" ? "submitted" : "abort",
      at,
    });
    task.phase = to;
    task.status = PHASE_STATUS[to];
    task.updatedAt = at;
    if (outcome === "success") {
      task.completedAt = at;
      task.progress = 1;
    }
    this.clearCurrentTask(task.assignedAgentId, task.id);
    return true;
  }

  private setCurrentTask(owner: AgentId | null, taskId: string): void {
    if (owner === null) return;
    const agent = this.getAgent(owner);
    if (agent === null) return;
    agent.state.currentTaskId = taskId;
  }

  private clearCurrentTask(owner: AgentId | null, taskId: string): void {
    if (owner === null) return;
    const agent = this.getAgent(owner);
    if (agent === null || agent.state.currentTaskId !== taskId) return;
    agent.state.currentTaskId = null;
  }

  /** Keep the newest tasks, dropping the oldest finished ones first. */
  private trimTasks(): void {
    while (this.tasks.length > MAX_LIVE_TASKS) {
      const finished = this.tasks.findIndex((task) =>
        isTerminalPhase(task.phase),
      );
      this.tasks.splice(finished >= 0 ? finished : 0, 1);
    }
  }

  /** Bound the profile archive, never dropping a live or task-referenced one. */
  private rememberProfile(profile: AgentProfile): void {
    if (
      !this.profilesById.has(profile.id) &&
      this.profilesById.size >= MAX_LIVE_PROFILES
    ) {
      const referenced = new Set<AgentId>();
      for (const agent of this.agents) referenced.add(agent.id);
      for (const task of this.tasks) {
        if (task.assignedAgentId !== null) {
          referenced.add(task.assignedAgentId);
        }
      }
      for (const id of this.profilesById.keys()) {
        if (!referenced.has(id)) {
          this.profilesById.delete(id);
          break;
        }
      }
    }
    this.profilesById.set(profile.id, profile);
  }

  /** Clear the stage and every queued event, back to a ready world. */
  reset(): void {
    this.agents.length = 0;
    this.links.length = 0;
    this.tasks.length = 0;
    this.pendingEvents.length = 0;
    this.profilesById.clear();
    this.coreOverrides.clear();
    this.coreFlashes.clear();
    this.coreMotion.clear();
    this.clockSeconds = 0;
    this.status = "ready";
    this.globalPaused = false;
    this.eventSeq = 0;
    this.linkSeq = 0;
    this.taskSeq = 0;
    this.baysDirty = false;
    this.droppedSpawns = 0;
  }

  /** Advance walking, timers, links and the waiting queue. */
  tick(dt: number): void {
    if (this.status !== "running") return;
    const step = Math.max(0, Math.min(0.2, dt));
    if (step <= 0) return;
    this.clockSeconds += step * this.speed;

    for (const agent of this.agents) {
      this.tickAgent(agent, step);
      if (agent.bay !== null && agent.phase === "walk-home") {
        agent.bay = null;
        this.baysDirty = true;
      }
    }

    const faded = this.agents.some(
      (agent) => agent.phase === "fade" && agent.timer <= 0,
    );
    if (faded) {
      for (let index = this.agents.length - 1; index >= 0; index -= 1) {
        if (this.agents[index].phase === "fade" && this.agents[index].timer <= 0) {
          this.agents.splice(index, 1);
        }
      }
      this.baysDirty = true;
    }
    if (this.baysDirty) {
      this.baysDirty = false;
      this.promoteWaiting();
    }

    for (const [id, motion] of this.coreMotion) {
      if (motion.path.length === 0) continue;
      const movement = advance(motion.position, motion.path, step * this.walkSpeed);
      if (movement.heading !== null) motion.heading = movement.heading;
      if (motion.path.length > 0) continue;
      if (motion.phase === "to-board") {
        motion.phase = "at-board";
        motion.location = CORE_BOARD_LOCATION[id] ?? null;
      } else if (motion.phase === "to-home") {
        this.coreMotion.delete(id);
      }
    }

    for (const [id, flash] of this.coreFlashes) {
      if (flash.until <= this.clockSeconds) this.coreFlashes.delete(id);
    }

    this.links.splice(
      0,
      this.links.length,
      ...this.links.filter((link) => link.endsAt > this.clockSeconds),
    );
  }

  /** A complete snapshot in the phase 9 wire shape. */
  snapshot(): WorldSnapshot {
    const coreStates: AgentState[] = CORE_AGENTS.map((profile) => {
      const motion = this.coreMotion.get(profile.id);
      const base =
        motion === undefined
          ? coreState(profile)
          : {
              ...coreState(profile),
              location: motion.location,
              destination:
                motion.phase === "to-board"
                  ? (CORE_BOARD_LOCATION[profile.id] ?? null)
                  : motion.phase === "to-home"
                    ? (profile.home ?? "hub")
                    : null,
              position: { x: motion.position.x, z: motion.position.z },
              heading: motion.heading,
              path: motion.path.map((point) => ({ ...point })),
            };
      const stored = this.coreOverrides.get(profile.id);
      const flash = this.coreFlashes.get(profile.id);
      const override =
        flash !== undefined && flash.until > this.clockSeconds ? flash : stored;
      const walking = motion !== undefined && motion.path.length > 0;
      return {
        ...base,
        status: walking ? "walking" : (override?.status ?? base.status),
        activity: override?.activity ?? base.activity,
        paused: this.globalPaused,
      };
    });

    const profiles: AgentProfile[] = [
      ...CORE_AGENTS.map((profile) => ({ ...profile })),
      ...this.agents.map((agent) => ({ ...agent.profile })),
    ];
    const announced = new Set(profiles.map((profile) => profile.id));
    for (const task of this.tasks) {
      const owner = task.assignedAgentId;
      if (owner === null || announced.has(owner)) continue;
      const profile = this.profilesById.get(owner);
      if (profile === undefined) continue;
      announced.add(owner);
      profiles.push({ ...profile });
    }

    return {
      clock: Math.round(this.clockSeconds * 1000) / 1000,
      status: this.status,
      speed: this.speed,
      profiles,
      agents: [
        ...coreStates,
        ...this.agents.map((agent) => ({
          ...agent.state,
          position: { ...agent.state.position },
          path: agent.state.path.map((point) => ({ ...point })),
          paused: agent.state.paused || this.globalPaused,
        })),
      ],
      tasks: this.tasks.map((task) => ({
        ...task,
        subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
        findings: [...task.findings],
        history: task.history.map((entry) => ({ ...entry })),
      })),
      links: this.links
        .filter((link) => link.endsAt > this.clockSeconds)
        .map((link) => ({ ...link })),
    };
  }

  private occupiedBays(): Set<number> {
    const occupied = new Set<number>();
    for (const agent of this.agents) {
      if (agent.bay !== null && agent.phase !== "fade") occupied.add(agent.bay);
    }
    return occupied;
  }

  private waitingAgents(): LiveAgent[] {
    return this.agents.filter(
      (agent) => agent.waiting && agent.phase === "waiting",
    );
  }

  private placeWaiting(): void {
    let index = 0;
    for (const agent of this.agents) {
      if (!agent.waiting || agent.phase !== "waiting") continue;
      const slot = slotFor(WAITING_LOCATION, index);
      agent.state.position.x = slot.x;
      agent.state.position.z = slot.z;
      agent.state.location = WAITING_LOCATION;
      agent.state.destination = null;
      agent.state.path = [];
      agent.state.heading = headingFor(WAITING_LOCATION, index);
      index += 1;
    }
  }

  private beginWalkToBay(agent: LiveAgent, bay: number): void {
    agent.bay = bay;
    agent.waiting = false;
    agent.phase = "walk-to-bay";
    const stand = bayStand(bay);
    agent.path = routeToBay(agent.state.position, bay);
    agent.target = stand;
    agent.state.destination = "dispatch";
    agent.state.location = null;
    agent.state.status = "walking";
    agent.state.activity = `Walking to dispatch bay ${bay + 1}`;
    agent.state.path = agent.path.map((point) => ({ ...point }));
    agent.timer = 0;
  }

  private promoteWaiting(): void {
    const occupied = this.occupiedBays();
    for (const agent of this.waitingAgents()) {
      const bay = allocateBay(occupied);
      if (bay === null) break;
      occupied.add(bay);
      this.beginWalkToBay(agent, bay);
      agent.state.activity = `Claimed dispatch bay ${bay + 1}`;
    }
    this.placeWaiting();
  }

  private beginWork(agent: LiveAgent): void {
    agent.phase = "work";
    agent.timer = agent.workSeconds;
    agent.state.status = "working";
    agent.state.location = "dispatch";
    agent.state.destination = null;
    agent.state.path = [];
    agent.state.heading = headingFor("dispatch", agent.bay ?? 0);
    agent.state.progress = 0;
    agent.state.activity = `${agent.profile.name} is working on a live task`;
    agent.linkAt = 0;
  }

  private beginWalkHome(agent: LiveAgent): void {
    agent.phase = "walk-home";
    agent.timer = 0;
    const hub = slotFor("hub", 0);
    agent.path = route(agent.state.position, hub);
    agent.target = hub;
    agent.state.destination = "hub";
    agent.state.location = null;
    agent.state.status = "walking";
    agent.state.progress = 0;
    agent.state.activity =
      agent.holdActivity ?? "Heading back to the Operations Hub";
    agent.state.path = agent.path.map((point) => ({ ...point }));
  }

  private freeBay(agent: LiveAgent): void {
    if (agent.bay === null) return;
    agent.bay = null;
    this.baysDirty = true;
  }

  private tickAgent(agent: LiveAgent, dt: number): void {
    switch (agent.phase) {
      case "hold": {
        agent.timer -= dt;
        if (agent.timer <= 0) {
          if (agent.bay === null) {
            agent.phase = "waiting";
            agent.waiting = true;
            agent.state.activity = "Waiting for a dispatch bay";
            this.placeWaiting();
          } else {
            this.beginWalkToBay(agent, agent.bay);
          }
        }
        return;
      }
      case "waiting":
        return;
      case "walk-to-bay": {
        const step = advance(
          agent.state.position,
          agent.path,
          dt * this.walkSpeed,
        );
        if (step.heading !== null) agent.state.heading = step.heading;
        agent.state.path = agent.path.map((point) => ({ ...point }));
        if (agent.path.length === 0) this.beginWork(agent);
        return;
      }
      case "work": {
        if (agent.workSeconds <= 0) return;
        agent.timer -= dt;
        agent.state.progress = Math.max(
          0,
          Math.min(1, 1 - agent.timer / Math.max(0.001, agent.workSeconds)),
        );
        // One message arc early in the work phase, so live comm links show.
        if (agent.linkAt === 0 && agent.state.progress > 0.15) {
          agent.linkAt = this.clockSeconds;
          this.link(agent.id, "orion", "message");
          this.emit("agent.message", `${agent.profile.name} reported to Orion`, {
            agentId: agent.id,
            targetAgentId: "orion",
            severity: "info",
            feed: true,
          });
        }
        if (agent.timer <= 0) this.finish(agent.id, agent.outcome);
        return;
      }
      case "emote": {
        agent.timer -= dt;
        if (agent.timer <= 0) this.beginWalkHome(agent);
        return;
      }
      case "walk-home": {
        const step = advance(
          agent.state.position,
          agent.path,
          dt * this.walkSpeed,
        );
        if (step.heading !== null) agent.state.heading = step.heading;
        agent.state.path = agent.path.map((point) => ({ ...point }));
        if (agent.path.length === 0) {
          agent.phase = "fade";
          agent.timer = this.fadeSeconds;
        }
        return;
      }
      case "fade": {
        agent.timer -= dt;
        return;
      }
    }
  }
}
