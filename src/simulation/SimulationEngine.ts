import type { AgentId, AgentProfile, AgentState } from "../agents/agentTypes.ts";
import { AGENT_IDS } from "../agents/agentTypes.ts";
import { AGENTS, AGENT_BY_ID, agentName } from "../agents/AgentRegistry.ts";
import { AgentController } from "../agents/AgentController.ts";
import type { AgentEvent, AgentEventDraft } from "../events/eventTypes.ts";
import { EventBus, createRng, hashString } from "./EventBus.ts";
import { SIMULATION_CONFIG } from "./simulationConfig.ts";
import type { SimulationConfig } from "./simulationConfig.ts";
import { TaskScheduler } from "./TaskScheduler.ts";
import { applySignal } from "./WorkflowStateMachine.ts";
import type {
  CreateTaskInput,
  Task,
  WorkflowPhase,
  WorkflowSignal,
} from "../tasks/taskTypes.ts";
import { PHASE_STATUS, isTerminalPhase } from "../tasks/taskTypes.ts";
import { LOCATIONS, headingFor, slotFor } from "./worldLayout.ts";
import { matchWorkTemplate, shortTitle } from "./workContent.ts";
import type {
  CommLink,
  SimulationStatus,
  WorldSnapshot,
} from "../integrations/AgentBackend.ts";
import { PhaseChoreography } from "./phaseChoreography.ts";
import type { EmitOptions, TaskMeta } from "./phaseChoreography.ts";
import { roundClock } from "./simClock.ts";

function cloneAgent(state: AgentState): AgentState {
  return {
    ...state,
    position: { ...state.position },
    path: state.path.map((point) => ({ ...point })),
  };
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    findings: [...task.findings],
    history: task.history.map((entry) => ({ ...entry })),
  };
}

function createInitialAgentState(profile: AgentProfile): AgentState {
  const slot = slotFor(profile.home, profile.seat);
  return {
    id: profile.id,
    status: "idle",
    activity: `${profile.name} is idle`,
    currentTaskId: null,
    progress: 0,
    location: profile.home,
    destination: null,
    position: { x: slot.x, z: slot.z },
    heading: headingFor(profile.home, profile.seat),
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

/**
 * The whole mock brain: deterministic clock, agent action queues, workflow
 * choreography, events, links and snapshots. No React, three, Next or alias
 * imports here, so Node can run it directly in tests.
 */
export class SimulationEngine {
  readonly events = new EventBus<AgentEvent>();
  readonly snapshots = new EventBus<WorldSnapshot>();

  private readonly config: SimulationConfig;
  private readonly seed: number;
  private readonly scheduler: TaskScheduler;
  private readonly choreography: PhaseChoreography;

  private clock = 0;
  private status: SimulationStatus = "ready";
  private speed: number;

  private readonly agents = new Map<AgentId, AgentState>();
  private readonly controllers = new Map<AgentId, AgentController>();
  private readonly tasks = new Map<string, Task>();
  private readonly taskOrder: string[] = [];
  private readonly taskMeta = new Map<string, TaskMeta>();
  private links: CommLink[] = [];

  private taskSeq = 0;
  private linkSeq = 0;
  private eventSeq = 0;
  private resetSeq = 0;

  constructor(seed: number = SIMULATION_CONFIG.seed) {
    this.seed = seed;
    this.config = SIMULATION_CONFIG;
    this.speed = this.config.defaultSpeed;
    this.scheduler = new TaskScheduler(this.config.maxConcurrentTasks);
    this.buildAgents();
    this.choreography = new PhaseChoreography({
      config: this.config,
      clock: () => this.clock,
      emit: (type, message, options) => {
        this.emit(type, message, options);
      },
      pushLink: (from, to, kind) => this.pushLink(from, to, kind),
      applyAndEnter: (taskId, signal) => this.applyAndEnter(taskId, signal),
      setProgress: (taskId, phase, ratio) =>
        this.setProgress(taskId, phase, ratio),
      tickSubtasks: (taskId, ratio) => this.tickSubtasks(taskId, ratio),
      getTask: (taskId) => this.tasks.get(taskId),
      updateTask: (taskId, update) => this.updateTask(taskId, update),
      getMeta: (taskId) => this.taskMeta.get(taskId),
      getController: (agentId) => this.controllers.get(agentId),
      detachOwner: (agentId, taskId) => this.detachOwner(agentId, taskId),
    });
  }

  // ---------------------------------------------------------------- commands

  start(): void {
    if (this.status === "running") return;
    if (this.status === "paused") {
      this.resume();
      return;
    }
    this.status = "running";
    this.emit("system.started", "Simulation started", { severity: "info" });
    this.publishSnapshot();
  }

  stop(): void {
    if (this.status === "ready") return;
    this.status = "ready";
    this.publishSnapshot();
  }

  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    this.emit("system.paused", "Simulation paused", {
      severity: "warning",
    });
    this.publishSnapshot();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.emit("system.resumed", "Simulation resumed", {
      severity: "info",
    });
    this.publishSnapshot();
  }

  reset(): void {
    this.status = "ready";
    this.clock = 0;

    this.tasks.clear();
    this.taskOrder.length = 0;
    this.taskMeta.clear();
    this.links = [];
    this.taskSeq = 0;
    this.linkSeq = 0;

    this.agents.clear();
    this.controllers.clear();
    this.buildAgents();

    // The reset event closes the previous run. It lives in its own id
    // namespace because the next run restarts at evt-0001 below; emitting it
    // from the run sequence would put evt-0001 (reset) next to evt-0001
    // (system.started) after a back-to-back reset, and event ids are keys.
    this.resetSeq += 1;
    this.events.publish({
      id: `evt-reset-${this.resetSeq}`,
      timestamp: Date.now(),
      simTime: roundClock(this.clock),
      type: "system.reset",
      message: "Simulation reset - six agents idle",
      severity: "info",
      feed: true,
    });
    // The next run starts at evt-0001, exactly like a fresh engine.
    this.eventSeq = 0;
    this.publishSnapshot();
  }

  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.speed = multiplier;
    this.emit("system.speed_changed", `Speed set to ${multiplier}x`, {
      severity: "info",
      metadata: { speed: multiplier },
    });
    this.publishSnapshot();
  }

  submitTask(input: CreateTaskInput): Task {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error("Task title is required");
    }
    this.taskSeq += 1;
    const id = `T-${String(this.taskSeq).padStart(3, "0")}`;
    const description = input.description?.trim() ?? "";
    const template = matchWorkTemplate(`${title} ${description}`);
    const script = input.script;

    const task: Task = {
      id,
      title,
      description,
      priority: input.priority ?? "medium",
      status: "queued",
      phase: "queued",
      assignedAgentId: null,
      progress: 0,
      createdAt: roundClock(this.clock),
      updatedAt: roundClock(this.clock),
      completedAt: null,
      iteration: 0,
      subtasks: [],
      findings: [],
      history: [],
      isDemo: input.isDemo ?? false,
      preferredAgentId: input.preferredAgentId ?? null,
      blockedReason: null,
    };

    this.tasks.set(id, task);
    this.taskOrder.push(id);
    this.taskMeta.set(id, {
      script,
      rng: createRng((hashString(title) ^ this.seed ^ this.taskSeq) >>> 0),
      template,
    });

    this.emit("task.created", `New task: "${shortTitle(title)}"`, {
      taskId: id,
      severity: "info",
      metadata: {
        priority: task.priority,
        preferredAgentId: task.preferredAgentId,
        isDemo: task.isDemo,
      },
    });
    this.publishSnapshot();
    return cloneTask(task);
  }

  pauseAgent(id: AgentId): void {
    const state = this.agents.get(id);
    if (!state || state.paused) return;
    const name = agentName(id);
    state.paused = true;
    this.emit("agent.paused", `${name} is paused`, {
      agentId: id,
      severity: "warning",
    });

    for (const task of this.tasks.values()) {
      if (task.assignedAgentId !== id || isTerminalPhase(task.phase)) continue;
      this.blockTaskForPausedOwner(task);
    }
    this.publishSnapshot();
  }

  resumeAgent(id: AgentId): void {
    const state = this.agents.get(id);
    if (!state || !state.paused) return;
    const name = agentName(id);
    state.paused = false;
    this.emit("agent.resumed", `${name} is back`, {
      agentId: id,
      severity: "info",
    });

    for (const task of this.tasks.values()) {
      if (task.assignedAgentId !== id || task.status !== "blocked") continue;
      task.status = PHASE_STATUS[task.phase];
      task.blockedReason = null;
      task.updatedAt = roundClock(this.clock);
      this.emit(
        "task.unblocked",
        `"${shortTitle(task.title)}" is moving again`,
        {
          taskId: task.id,
          agentId: id,
          severity: "info",
        },
      );
    }
    this.publishSnapshot();
  }

  // ------------------------------------------------------------------- clock

  tick(realDtSeconds: number): void {
    if (
      this.status !== "running" ||
      !Number.isFinite(realDtSeconds) ||
      realDtSeconds <= 0
    ) {
      return;
    }

    const dt = realDtSeconds * this.speed;
    this.clock += dt;

    for (const controller of this.controllers.values()) {
      controller.tick(dt);
    }

    this.pruneLinks();
    this.runScheduler();
    this.publishSnapshot();
  }

  // --------------------------------------------------------------- snapshots

  snapshot(): WorldSnapshot {
    return {
      clock: roundClock(this.clock),
      status: this.status,
      speed: this.speed,
      agents: AGENT_IDS.map((id) => {
        const state = this.agents.get(id);
        return state
          ? cloneAgent(state)
          : createInitialAgentState(AGENT_BY_ID[id]);
      }),
      tasks: this.orderedTasks().map(cloneTask),
      links: this.links.map((link) => ({ ...link })),
    };
  }

  publishSnapshot(): void {
    this.snapshots.publish(this.snapshot());
  }

  getTask(id: string): Task | null {
    const task = this.tasks.get(id);
    return task ? cloneTask(task) : null;
  }

  emitBootEvents(): void {
    this.emit("system.ready", "Simulation ready - no live inference", {
      severity: "info",
    });
    for (const profile of AGENTS) {
      this.emit(
        "system.ready",
        `${profile.name} is at the ${LOCATIONS[profile.home].label}`,
        {
          agentId: profile.id,
          severity: "info",
        },
      );
    }
    this.publishSnapshot();
  }

  // ---------------------------------------------------------------- scheduler

  private runScheduler(): void {
    const orion = this.agents.get("orion");
    if (!orion || orion.paused) return;
    const next = this.scheduler.nextTask(this.orderedTasks());
    if (!next) return;
    this.applyAndEnter(next.id, "picked_up");
  }

  private orderedTasks(): Task[] {
    const ordered: Task[] = [];
    for (const id of this.taskOrder) {
      const task = this.tasks.get(id);
      if (task) ordered.push(task);
    }
    return ordered;
  }

  // ---------------------------------------------------------------- workflow

  private applyAndEnter(taskId: string, signal: WorkflowSignal): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const previousOwner = task.assignedAgentId;
    const updated = applySignal(task, signal, roundClock(this.clock));
    if (updated === task) return;

    this.tasks.set(taskId, updated);
    if (previousOwner && previousOwner !== updated.assignedAgentId) {
      this.detachOwner(previousOwner, taskId);
    }
    this.blockTaskForPausedOwner(updated);
    this.choreography.enterPhase(updated);
  }

  /**
   * Spec 3.2: while the responsible agent is paused the projected status is
   * overridden to `blocked`. The phase stays untouched, so resuming restores
   * the status from `PHASE_STATUS` again.
   */
  private blockTaskForPausedOwner(task: Task): void {
    if (isTerminalPhase(task.phase) || task.status === "blocked") return;
    const owner = task.assignedAgentId;
    if (!owner) return;
    const ownerState = this.agents.get(owner);
    if (!ownerState?.paused) return;
    const name = agentName(owner);
    task.status = "blocked";
    task.blockedReason = `${name} is paused`;
    task.updatedAt = roundClock(this.clock);
    this.emit(
      "task.blocked",
      `"${shortTitle(task.title)}" is blocked because ${name} is paused`,
      {
        taskId: task.id,
        agentId: owner,
        severity: "warning",
        metadata: { reason: task.blockedReason },
      },
    );
  }

  private detachOwner(agentId: AgentId, taskId: string): void {
    const state = this.agents.get(agentId);
    const controller = this.controllers.get(agentId);
    if (!state || !controller) return;
    if (state.currentTaskId === taskId) controller.releaseTask();
  }

  // ------------------------------------------------------------------ details

  private updateTask(
    taskId: string,
    update: (task: Task) => Task,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.set(taskId, update(task));
  }

  private setProgress(
    taskId: string,
    phase: WorkflowPhase,
    ratio: number,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task || task.phase !== phase) return;
    const [start, end] = this.config.phaseProgress[phase];
    const clamped = Math.max(0, Math.min(1, ratio));
    task.progress = Math.max(task.progress, start + (end - start) * clamped);
    task.updatedAt = roundClock(this.clock);
  }

  /**
   * Task cards are monotonic: a rework restarts the implementation progress
   * ratio at 0, but a card that was already checked stays checked. Rework
   * never un-ticking a card is a product invariant (and a UI review finding).
   */
  private tickSubtasks(taskId: string, ratio: number): void {
    const task = this.tasks.get(taskId);
    if (!task || task.subtasks.length === 0) return;
    const count = task.subtasks.length;
    const doneCount = Math.min(count, Math.floor(ratio * count + 1e-9));
    let changed = false;
    const subtasks = task.subtasks.map((subtask, index) => {
      const done = subtask.done || index < doneCount;
      if (done !== subtask.done) changed = true;
      return done === subtask.done ? subtask : { ...subtask, done };
    });
    if (!changed) return;
    this.tasks.set(taskId, {
      ...task,
      subtasks,
      updatedAt: roundClock(this.clock),
    });
  }

  private pushLink(
    from: AgentId,
    to: AgentId,
    kind: CommLink["kind"],
  ): void {
    this.linkSeq += 1;
    const startedAt = roundClock(this.clock);
    this.links.push({
      id: `link-${this.linkSeq}`,
      from,
      to,
      kind,
      startedAt,
      endsAt: roundClock(startedAt + this.config.linkDuration),
    });
  }

  private pruneLinks(): void {
    this.links = this.links.filter((link) => link.endsAt > this.clock);
  }

  private buildAgents(): void {
    for (const profile of AGENTS) {
      const state = createInitialAgentState(profile);
      this.agents.set(profile.id, state);
      const controller = new AgentController({
        profile,
        state,
        rng: createRng(
          (hashString(`agent:${profile.id}`) ^ this.seed) >>> 0,
        ),
        clock: () => this.clock,
        emit: (draft) => {
          this.emitDraft(draft);
        },
        getState: (id) => this.agents.get(id),
        config: {
          walkSpeed: this.config.walkSpeed,
          returnHomeDelay: this.config.returnHomeDelay,
          ambient: this.config.ambient,
        },
      });
      this.controllers.set(profile.id, controller);
    }
  }

  private emit(
    type: AgentEvent["type"],
    message: string,
    options: EmitOptions = {},
  ): AgentEvent {
    return this.emitDraft({
      type,
      message,
      severity: options.severity ?? "info",
      feed: options.feed ?? true,
      agentId: options.agentId,
      targetAgentId: options.targetAgentId,
      taskId: options.taskId,
      metadata: options.metadata,
    });
  }

  private emitDraft(draft: AgentEventDraft): AgentEvent {
    this.eventSeq += 1;
    const event: AgentEvent = {
      id: `evt-${String(this.eventSeq).padStart(4, "0")}`,
      timestamp: Date.now(),
      simTime: roundClock(this.clock),
      ...draft,
    };
    this.events.publish(event);
    return event;
  }
}
