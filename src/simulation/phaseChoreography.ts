import type { AgentController } from "../agents/AgentController.ts";
import type { AgentId } from "../agents/agentTypes.ts";
import type { AgentEvent, AgentEventDraft } from "../events/eventTypes.ts";
import type { CommLink } from "../integrations/AgentBackend.ts";
import type { Subtask, Task, TaskScript, WorkflowPhase, WorkflowSignal } from "../tasks/taskTypes.ts";
import { PHASE_OWNER } from "../tasks/taskTypes.ts";
import { roundClock } from "./simClock.ts";
import type { SimulationConfig } from "./simulationConfig.ts";
import { LOCATIONS } from "./worldLayout.ts";
import { shortTitle } from "./workContent.ts";
import type { WorkTemplate } from "./workContent.ts";

export type EmitOptions = Partial<
  Pick<
    AgentEventDraft,
    | "agentId"
    | "targetAgentId"
    | "taskId"
    | "severity"
    | "feed"
    | "metadata"
  >
>;

export interface TaskMeta {
  script: TaskScript | undefined;
  rng: () => number;
  template: WorkTemplate;
}

/** One side of a testing/review outcome: emote, handoff talk, message, event. */
interface OutcomeHandoff {
  activity: string;
  target: AgentId;
  talk: string;
  message: string;
  eventType:
    | "qa.failed"
    | "qa.passed"
    | "review.changes_requested"
    | "review.approved";
  eventMessage: string;
  metadata: Record<string, unknown>;
  severity: "warning" | "success";
}

interface PhaseOutcome {
  agentId: AgentId;
  taskId: string;
  failed: boolean;
  failSignal: "tests_failed" | "changes_requested";
  passSignal: "tests_passed" | "approved";
  fail: OutcomeHandoff;
  pass: OutcomeHandoff;
}

function iterationLabel(count: number): string {
  return `${count} ${count === 1 ? "iteration" : "iterations"}`;
}

/** Everything the phase scripts need from the engine. */
export interface PhaseChoreographyContext {
  readonly config: SimulationConfig;
  clock(): number;
  emit(
    type: AgentEvent["type"],
    message: string,
    options?: EmitOptions,
  ): void;
  pushLink(from: AgentId, to: AgentId, kind: CommLink["kind"]): void;
  applyAndEnter(taskId: string, signal: WorkflowSignal): void;
  setProgress(taskId: string, phase: WorkflowPhase, ratio: number): void;
  tickSubtasks(taskId: string, ratio: number): void;
  getTask(taskId: string): Task | undefined;
  updateTask(taskId: string, update: (task: Task) => Task): void;
  getMeta(taskId: string): TaskMeta | undefined;
  getController(agentId: AgentId): AgentController | undefined;
  detachOwner(agentId: AgentId, taskId: string): void;
}

/**
 * The per-phase choreography: turns each workflow phase into an action queue
 * for the owning agent, then applies the next workflow signal. All decisions
 * are deterministic; the engine owns the task map, clock and controllers.
 */
export class PhaseChoreography {
  private readonly ctx: PhaseChoreographyContext;

  constructor(context: PhaseChoreographyContext) {
    this.ctx = context;
  }

  enterPhase(task: Task): void {
    switch (task.phase) {
      case "intake":
        this.scheduleIntake(task);
        break;
      case "planning":
        this.schedulePlanning(task);
        break;
      case "research":
        this.scheduleResearch(task);
        break;
      case "implementation":
        this.scheduleImplementation(task);
        break;
      case "testing":
        this.scheduleTesting(task);
        break;
      case "review":
        this.scheduleReview(task);
        break;
      case "done":
        this.scheduleFinale(task);
        break;
      case "queued":
      case "failed":
        break;
    }
  }

  private ownerController(task: Task): AgentController | null {
    const owner = PHASE_OWNER[task.phase];
    if (!owner) return null;
    const controller = this.ctx.getController(owner);
    if (!controller) return null;
    controller.assignTask(task.id);
    return controller;
  }

  private scheduleIntake(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);

    controller.enqueue([
      {
        kind: "move",
        to: "hub",
        activity: `Walking to the ${LOCATIONS.hub.label}`,
      },
      {
        kind: "work",
        duration: durations.intakeThink,
        status: "thinking",
        activity: `Reading "${label}"`,
        onProgress: (progress) =>
          this.ctx.setProgress(task.id, "intake", progress),
      },
      {
        kind: "talk",
        target: "piper",
        duration: durations.assign,
        activity: `Assigning "${label}" to Piper`,
        onStart: () => this.ctx.pushLink("orion", "piper", "assign"),
        onDone: () => {
          this.ctx.emit(
            "task.assigned",
            `Orion assigned "${label}" to Piper`,
            {
              agentId: "orion",
              targetAgentId: "piper",
              taskId: task.id,
              severity: "info",
              metadata: { phase: "planning" },
            },
          );
          this.ctx.applyAndEnter(task.id, "delegated");
        },
      },
    ]);
  }

  private schedulePlanning(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);
    const meta = this.ctx.getMeta(task.id);
    if (!meta) return;

    controller.enqueue([
      {
        kind: "move",
        to: "mission",
        activity: `Walking to ${LOCATIONS.mission.label}`,
      },
      {
        kind: "work",
        duration: durations.breakdown,
        status: "working",
        activity: `Controlling the wall: planning "${label}"`,
        onProgress: (progress) =>
          this.ctx.setProgress(task.id, "planning", progress),
        onDone: () => {
          const subtasks: Subtask[] = meta.template.subtasks.map(
            (title, index) => ({
              id: `${task.id}-${index + 1}`,
              title,
              done: false,
            }),
          );
          this.ctx.updateTask(task.id, (current) => ({
            ...current,
            subtasks,
            updatedAt: roundClock(this.ctx.clock()),
          }));
          this.ctx.emit(
            "plan.created",
            `Piper created ${subtasks.length} task cards for "${label}"`,
            {
              agentId: "piper",
              taskId: task.id,
              severity: "info",
              metadata: { subtasks: subtasks.map((subtask) => subtask.title) },
            },
          );
        },
      },
      {
        kind: "talk",
        target: "iris",
        duration: durations.coordinate,
        activity: `Briefing Iris on "${label}"`,
        onStart: () => this.ctx.pushLink("piper", "iris", "message"),
        onDone: () => {
          this.ctx.emit(
            "agent.message",
            `Piper briefed Iris on the research questions for "${label}"`,
            {
              agentId: "piper",
              targetAgentId: "iris",
              taskId: task.id,
              severity: "info",
            },
          );
          this.ctx.applyAndEnter(task.id, "plan_ready");
        },
      },
    ]);
  }

  private scheduleResearch(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);
    const meta = this.ctx.getMeta(task.id);
    if (!meta) return;

    controller.enqueue([
      {
        kind: "move",
        to: "planning",
        activity: `Walking to the ${LOCATIONS.planning.label}`,
      },
      {
        kind: "work",
        duration: durations.research,
        status: "working",
        activity: `Researching "${label}" at the board`,
        onProgress: (progress) =>
          this.ctx.setProgress(task.id, "research", progress),
        onDone: () => {
          this.ctx.updateTask(task.id, (current) => ({
            ...current,
            findings: [...meta.template.findings],
            updatedAt: roundClock(this.ctx.clock()),
          }));
        },
      },
      {
        kind: "talk",
        target: "kai",
        duration: durations.publish,
        activity: `Publishing findings for "${label}"`,
        onStart: () => this.ctx.pushLink("iris", "kai", "message"),
        onDone: () => {
          this.ctx.emit(
            "agent.message",
            `Iris walked Kai through the findings for "${label}"`,
            {
              agentId: "iris",
              targetAgentId: "kai",
              taskId: task.id,
              severity: "info",
            },
          );
          this.ctx.emit(
            "research.completed",
            `Iris published ${meta.template.findings.length} findings for "${label}"`,
            {
              agentId: "iris",
              targetAgentId: "kai",
              taskId: task.id,
              severity: "success",
              metadata: { findings: [...meta.template.findings] },
            },
          );
          this.ctx.applyAndEnter(task.id, "findings_published");
        },
      },
    ]);
  }

  private scheduleImplementation(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);
    const iteration = task.iteration;
    const implementationDuration =
      iteration <= 1 ? durations.implement : durations.fix;

    controller.enqueue([
      {
        kind: "move",
        to: "dev",
        activity: `Walking to the ${LOCATIONS.dev.label}`,
      },
      {
        kind: "call",
        fn: () => {
          this.ctx.emit(
            "implementation.started",
            `Kai started implementation of "${label}"`,
            {
              agentId: "kai",
              taskId: task.id,
              severity: "info",
              metadata: { iteration },
            },
          );
        },
      },
      {
        kind: "work",
        duration: implementationDuration,
        status: "working",
        activity:
          iteration <= 1
            ? `Implementing "${label}"`
            : `Fixing "${label}" (iteration ${iteration})`,
        onProgress: (progress) => {
          this.ctx.setProgress(task.id, "implementation", progress);
          this.ctx.tickSubtasks(task.id, progress);
        },
      },
      {
        kind: "talk",
        target: "quinn",
        duration: durations.submit,
        activity: `Submitting build #${iteration} to Quinn`,
        onStart: () => this.ctx.pushLink("kai", "quinn", "report"),
        onDone: () => {
          this.ctx.emit(
            "agent.message",
            `Kai handed build #${iteration} to Quinn for testing`,
            {
              agentId: "kai",
              targetAgentId: "quinn",
              taskId: task.id,
              severity: "info",
            },
          );
          this.ctx.emit(
            "implementation.submitted",
            `Kai submitted build #${iteration} of "${label}" for testing`,
            {
              agentId: "kai",
              targetAgentId: "quinn",
              taskId: task.id,
              severity: "info",
              metadata: { iteration },
            },
          );
          this.ctx.applyAndEnter(task.id, "submitted");
        },
      },
    ]);
  }

  private scheduleTesting(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);
    const iteration = task.iteration;

    controller.enqueue([
      {
        kind: "move",
        to: "testing",
        activity: `Walking to the ${LOCATIONS.testing.label}`,
      },
      {
        kind: "call",
        fn: () => {
          this.ctx.emit(
            "qa.started",
            `Quinn started testing build #${iteration} of "${label}"`,
            {
              agentId: "quinn",
              taskId: task.id,
              severity: "info",
              feed: false,
              metadata: { iteration },
            },
          );
        },
      },
      {
        kind: "work",
        duration: durations.test,
        status: "working",
        activity: `Testing build #${iteration}`,
        onProgress: (progress) =>
          this.ctx.setProgress(task.id, "testing", progress),
      },
      {
        kind: "call",
        fn: () => this.decideTesting(task.id, iteration),
      },
    ]);
  }

  private decideTesting(taskId: string, iteration: number): void {
    const task = this.ctx.getTask(taskId);
    const meta = this.ctx.getMeta(taskId);
    if (!task || !meta) return;
    const label = shortTitle(task.title);
    const testName =
      meta.template.tests[(iteration - 1) % meta.template.tests.length];

    this.enqueueOutcome({
      agentId: "quinn",
      taskId,
      failed: this.qaFails(task),
      failSignal: "tests_failed",
      passSignal: "tests_passed",
      fail: {
        activity: `Failing test: ${testName}`,
        target: "kai",
        talk: `Reporting ${testName} to Kai`,
        message: `Quinn reported ${testName} to Kai`,
        eventType: "qa.failed",
        eventMessage: `Quinn: failing test: ${testName}`,
        metadata: { test: testName, iteration },
        severity: "warning",
      },
      pass: {
        activity: `All tests passing for "${label}"`,
        target: "rex",
        talk: `Handing build #${iteration} to Rex for review`,
        message: `Quinn handed build #${iteration} to Rex for review`,
        eventType: "qa.passed",
        eventMessage: `Quinn passed build #${iteration} of "${label}"`,
        metadata: { iteration },
        severity: "success",
      },
    });
  }

  private scheduleReview(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);
    const iteration = task.iteration;

    controller.enqueue([
      {
        kind: "move",
        to: "review",
        activity: `Walking to the ${LOCATIONS.review.label}`,
      },
      {
        kind: "call",
        fn: () => {
          this.ctx.emit(
            "review.started",
            `Rex started reviewing build #${iteration} of "${label}"`,
            {
              agentId: "rex",
              taskId: task.id,
              severity: "info",
              feed: false,
              metadata: { iteration },
            },
          );
        },
      },
      {
        kind: "work",
        duration: durations.review,
        status: "working",
        activity: `Reviewing build #${iteration}`,
        onProgress: (progress) =>
          this.ctx.setProgress(task.id, "review", progress),
      },
      {
        kind: "call",
        fn: () => this.decideReview(task.id, iteration),
      },
    ]);
  }

  private decideReview(taskId: string, iteration: number): void {
    const task = this.ctx.getTask(taskId);
    const meta = this.ctx.getMeta(taskId);
    if (!task || !meta) return;
    const label = shortTitle(task.title);
    const note =
      meta.template.reviewNotes[
        (iteration - 1) % meta.template.reviewNotes.length
      ];

    this.enqueueOutcome({
      agentId: "rex",
      taskId,
      failed: this.reviewRequestsChanges(task),
      failSignal: "changes_requested",
      passSignal: "approved",
      fail: {
        activity: `Requesting changes: ${note}`,
        target: "kai",
        talk: "Walking Kai through the review notes",
        message: "Rex walked Kai through the review notes",
        eventType: "review.changes_requested",
        eventMessage: `Rex requested changes: ${note}`,
        metadata: { note, iteration },
        severity: "warning",
      },
      pass: {
        activity: `Approving "${label}"`,
        target: "orion",
        talk: "Reporting the approval to Orion",
        message: `Rex approved "${label}" and told Orion`,
        eventType: "review.approved",
        eventMessage: `Rex approved "${label}"`,
        metadata: { iteration },
        severity: "success",
      },
    });
  }

  /** Shared fail/pass choreography for QA and code review. */
  private enqueueOutcome(outcome: PhaseOutcome): void {
    const controller = this.ctx.getController(outcome.agentId);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const handoff = outcome.failed ? outcome.fail : outcome.pass;

    controller.enqueue([
      {
        kind: "emote",
        status: outcome.failed ? "error" : "success",
        duration: outcome.failed ? durations.errorEmote : durations.celebrate,
        activity: handoff.activity,
      },
      {
        kind: "talk",
        target: handoff.target,
        duration: durations.report,
        activity: handoff.talk,
        onStart: () =>
          this.ctx.pushLink(outcome.agentId, handoff.target, "report"),
        onDone: () => {
          this.ctx.emit("agent.message", handoff.message, {
            agentId: outcome.agentId,
            targetAgentId: handoff.target,
            taskId: outcome.taskId,
            severity: "info",
          });
          this.ctx.emit(handoff.eventType, handoff.eventMessage, {
            agentId: outcome.agentId,
            targetAgentId: handoff.target,
            taskId: outcome.taskId,
            severity: handoff.severity,
            metadata: handoff.metadata,
          });
          if (outcome.failed) {
            this.rework(outcome.taskId, outcome.failSignal);
          } else {
            this.ctx.applyAndEnter(outcome.taskId, outcome.passSignal);
          }
        },
      },
    ]);
  }

  private scheduleFinale(task: Task): void {
    const controller = this.ownerController(task);
    if (!controller) return;
    const durations = this.ctx.config.durations;
    const label = shortTitle(task.title);

    controller.enqueue([
      {
        kind: "move",
        to: "hub",
        activity: `Walking to the ${LOCATIONS.hub.label}`,
      },
      {
        kind: "emote",
        status: "success",
        duration: durations.announce,
        activity: `Announcing "${label}"`,
        onDone: () => {
          this.ctx.updateTask(task.id, (current) => ({
            ...current,
            progress: 1,
            updatedAt: roundClock(this.ctx.clock()),
          }));
          this.ctx.emit(
            "task.completed",
            `"${label}" is shipped after ${iterationLabel(task.iteration)}`,
            {
              agentId: "orion",
              taskId: task.id,
              severity: "success",
              metadata: { iterations: task.iteration },
            },
          );
          this.ctx.detachOwner("orion", task.id);
        },
      },
    ]);
  }

  private rework(
    taskId: string,
    signal: "tests_failed" | "changes_requested",
  ): void {
    const task = this.ctx.getTask(taskId);
    if (!task) return;
    if (task.iteration >= this.ctx.config.maxIterations) {
      const previousOwner = task.assignedAgentId;
      const iteration = task.iteration;
      this.ctx.applyAndEnter(taskId, "abort");
      this.ctx.emit(
        "task.failed",
        `"${shortTitle(task.title)}" failed after ${iterationLabel(iteration)}`,
        {
          taskId,
          agentId: previousOwner ?? undefined,
          severity: "error",
          metadata: { iterations: iteration },
        },
      );
      return;
    }
    this.ctx.applyAndEnter(taskId, signal);
  }

  private qaFails(task: Task): boolean {
    const meta = this.ctx.getMeta(task.id);
    if (!meta) return false;
    const scripted = meta.script?.qaFailsOn;
    if (scripted) return scripted.includes(task.iteration);
    return (
      meta.rng() < this.ctx.config.qaFailRate &&
      task.iteration < this.ctx.config.maxIterations
    );
  }

  private reviewRequestsChanges(task: Task): boolean {
    const meta = this.ctx.getMeta(task.id);
    if (!meta) return false;
    const scripted = meta.script?.reviewChangesOn;
    if (scripted) return scripted.includes(task.iteration);
    return (
      meta.rng() < this.ctx.config.reviewChangeRate &&
      task.iteration < this.ctx.config.maxIterations
    );
  }
}
