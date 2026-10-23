/**
 * Live board checks: phase counts, active task rows, redraw signatures and the
 * planning card layout/content. These run headless against the pure modules
 * that the 3D components consume.
 */
import type { AgentId, AgentState, AgentStatus } from "../../src/agents/agentTypes.ts";
import { getAgentProfile, CORE_AGENTS } from "../../src/agents/AgentRegistry.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import type { WorldSnapshot } from "../../src/integrations/AgentBackend.ts";
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import type {
  Subtask,
  Task,
  TaskPriority,
  WorkflowPhase,
} from "../../src/tasks/taskTypes.ts";
import {
  MISSION_CHART_PHASES,
  missionSignature,
  missionTaskRows,
  missionView,
  phaseCounts,
} from "../../src/world/missionContent.ts";
import {
  DONE_CARD_TINT,
  FAILED_CARD_TINT,
  PLANNING_BOARD,
  PLANNING_BOARD_FACE_OFFSET,
  PLANNING_BOARD_NORMAL,
  PLANNING_BOARD_TANGENT,
  PLANNING_CARD_LIMIT,
  PENDING_CARD_TINT,
  planningCardPositions,
  planningCards,
  planningSignature,
} from "../../src/world/planningContent.ts";
import {
  PLANNING_BOARD_CENTER,
  headingFor,
  slotFor,
} from "../../src/simulation/worldLayout.ts";
import { harness, tickUntil } from "./harness.ts";
import type { TestReporter } from "./harness.ts";

const EPSILON = 1e-9;

function makeTask(
  id: string,
  phase: WorkflowPhase,
  priority: TaskPriority,
  createdAt: number,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    priority,
    status: phase === "queued" ? "queued" : "in_progress",
    phase,
    assignedAgentId: null,
    progress: 0,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    iteration: 0,
    subtasks: [],
    findings: [],
    history: [],
    isDemo: false,
    preferredAgentId: null,
    blockedReason: null,
    ...overrides,
  };
}

function makeSubtasks(taskId: string, count: number, done = 0): Subtask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${taskId}-${index + 1}`,
    title: `${taskId} card ${index + 1}`,
    done: index < done,
  }));
}

function makeAgent(id: AgentId, status: AgentStatus): AgentState {
  return {
    id,
    status,
    activity: "",
    currentTaskId: null,
    progress: 0,
    location: null,
    destination: null,
    position: { x: 0, z: 0 },
    heading: 0,
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

function snapshotWith(tasks: Task[], agents: AgentState[] = []): WorldSnapshot {
  return {
    clock: 0,
    status: "running",
    speed: 1,
    profiles: CORE_AGENTS.map((profile) => ({ ...profile })),
    agents,
    tasks,
    links: [],
  };
}

function runCountsChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const tasks = [
    makeTask("T-1", "intake", "high", 1),
    makeTask("T-2", "implementation", "medium", 2),
    makeTask("T-3", "done", "low", 3),
    makeTask("T-4", "failed", "high", 4),
    makeTask("T-5", "queued", "high", 5),
  ];
  const counts = phaseCounts(tasks);
  check(
    "phase counts cover every chart column",
    counts.length === MISSION_CHART_PHASES.length,
    `${counts.length} columns`,
  );
  check(
    "phase counts ignore queued and count each phase once",
    counts[0] === 1 &&
      counts[3] === 1 &&
      counts[6] === 1 &&
      counts[7] === 1 &&
      counts.reduce((sum, value) => sum + value, 0) === 4,
    counts.join(","),
  );
}

function runActiveTaskChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const tasks = [
    makeTask("T-1", "implementation", "low", 10, { progress: 0.4 }),
    makeTask("T-2", "testing", "critical", 5, {
      assignedAgentId: "quinn",
      progress: 0.7,
    }),
    makeTask("T-3", "planning", "high", 20, { progress: 1.4 }),
    makeTask("T-4", "queued", "critical", 30),
    makeTask("T-5", "done", "critical", 40),
    makeTask("T-6", "failed", "critical", 50),
    makeTask("T-7", "intake", "medium", 2, { progress: -0.3 }),
  ];
  const rows = missionTaskRows(tasks);
  check(
    "active rows exclude queued, done and failed tasks",
    rows.length === 4 && rows.every((row) => row.id !== "T-4" && row.id !== "T-5" && row.id !== "T-6"),
    rows.map((row) => row.id).join(","),
  );
  check(
    "active rows sort by priority then newest",
    rows.map((row) => row.id).join(",") === "T-2,T-3,T-7,T-1",
    rows.map((row) => row.id).join(","),
  );
  check(
    "progress is clamped to 0..1",
    rows.find((row) => row.id === "T-3")?.progress === 1 &&
      rows.find((row) => row.id === "T-7")?.progress === 0,
  );
  check(
    "row colour comes from the assigned agent",
    rows.find((row) => row.id === "T-2")?.color === getAgentProfile("quinn").color,
  );
  check(
    "the wall shows at most four tasks",
    missionTaskRows(tasks, 2).length === 2,
  );
}

function runSignatureChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const task = makeTask("T-1", "implementation", "high", 1, {
    assignedAgentId: "kai",
    progress: 0.501,
    title: "Build the authentication API",
  });
  const agent = makeAgent("kai", "working");
  const base = missionView(snapshotWith([task], [agent]), true);
  const signature = missionSignature(base);

  const rounded = missionView(
    snapshotWith([{ ...task, progress: 0.504 }], [agent]),
    true,
  );
  const moved = missionView(
    snapshotWith([{ ...task, progress: 0.506 }], [agent]),
    true,
  );
  const statusChanged = missionView(
    snapshotWith([task], [makeAgent("kai", "idle")]),
    true,
  );
  const modeChanged = missionView(snapshotWith([task], [agent]), false);

  check(
    "progress under half a per cent keeps the signature",
    missionSignature(rounded) === signature,
  );
  check(
    "an identical view produces an identical signature",
    missionSignature(missionView(snapshotWith([task], [agent]), true)) ===
      signature,
  );
  check(
    "progress crossing a whole per cent changes the signature",
    missionSignature(moved) !== signature,
  );
  check(
    "an agent status change changes the signature",
    missionSignature(statusChanged) !== signature,
  );
  check(
    "the simulation mode changes the signature",
    missionSignature(modeChanged) !== signature,
  );
  check(
    "the roster is always six agents",
    base.agents.length === 6 &&
      base.agents.every((entry) => entry.name === getAgentProfile(entry.id).name),
  );
}

function runPlanningChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const older = makeTask("T-1", "implementation", "high", 10, {
    assignedAgentId: "kai",
    subtasks: makeSubtasks("T-1", 2),
  });
  const newer = makeTask("T-2", "implementation", "high", 20, {
    assignedAgentId: "piper",
    subtasks: makeSubtasks("T-2", 3),
  });
  const cards = planningCards([older, newer]);
  check(
    "cards are ordered newest task first, then subtask order",
    cards.map((card) => card.key).join(",") ===
      "T-2-1,T-2-2,T-2-3,T-1-1,T-1-2",
    cards.map((card) => card.key).join(","),
  );
  check(
    "pending cards use the assigned agent colour",
    cards[0].tint === getAgentProfile("piper").color &&
      cards[3].tint === getAgentProfile("kai").color,
  );

  const withDone = planningCards([
    older,
    {
      ...newer,
      subtasks: newer.subtasks.map((subtask, index) => ({
        ...subtask,
        done: index === 0,
      })),
    },
  ]);
  check(
    "done cards use the muted green tint",
    withDone[0].tint === DONE_CARD_TINT &&
      withDone[1].tint === getAgentProfile("piper").color,
  );
  check(
    "ticking a subtask changes the planning signature",
    planningSignature(withDone) !== planningSignature(cards),
  );
  check(
    "unassigned pending cards fall back to warm yellow",
    planningCards([
      makeTask("T-3", "planning", "medium", 30, {
        subtasks: makeSubtasks("T-3", 1),
      }),
    ])[0].tint === PENDING_CARD_TINT,
  );

  const crowded = makeTask("T-4", "implementation", "high", 40, {
    subtasks: makeSubtasks("T-4", 30),
  });
  check(
    "cards are capped at 24",
    planningCards([crowded]).length === PLANNING_CARD_LIMIT,
  );

  const finished = makeTask("T-5", "done", "high", 50, {
    completedAt: 90,
    subtasks: makeSubtasks("T-5", 2, 2),
  });
  const finishedCards = planningCards([finished]);
  check(
    "a finished task keeps its cards when no task is active",
    finishedCards.length === 2 &&
      finishedCards.every((card) => card.tint === DONE_CARD_TINT),
    `${finishedCards.length} cards`,
  );

  const active = makeTask("T-6", "planning", "medium", 60, {
    subtasks: makeSubtasks("T-6", 1),
  });
  const replacedCards = planningCards([finished, active]);
  check(
    "a new active task replaces the finished task cards",
    replacedCards.length === 1 && replacedCards[0].taskId === "T-6",
    replacedCards.map((card) => card.taskId).join(","),
  );

  const newerFailure = makeTask("T-7", "failed", "high", 70, {
    completedAt: 120,
    subtasks: makeSubtasks("T-7", 2, 1),
  });
  const failedCards = planningCards([finished, newerFailure]);
  check(
    "the newest finished task supplies the cards",
    failedCards.length === 2 &&
      failedCards.every((card) => card.taskId === "T-7"),
    failedCards.map((card) => card.taskId).join(","),
  );
  check(
    "unfinished cards of a failed task use the muted red tint",
    failedCards[1]?.tint === FAILED_CARD_TINT &&
      failedCards[0]?.tint === DONE_CARD_TINT,
  );
}

function runLayoutChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const positions = planningCardPositions(PLANNING_CARD_LIMIT);
  const { width, height, cardWidth, cardHeight, topInset, sideInset, bottomInset } =
    PLANNING_BOARD;

  let inside = positions.length === PLANNING_CARD_LIMIT;
  for (const position of positions) {
    if (
      position.u - cardWidth / 2 < sideInset - EPSILON ||
      position.u + cardWidth / 2 > width - sideInset + EPSILON ||
      position.v - cardHeight / 2 < bottomInset - EPSILON ||
      position.v + cardHeight / 2 > height - topInset + EPSILON
    ) {
      inside = false;
    }
  }
  check("every card stays inside the board margins", inside);

  let overlapping = false;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const dx = Math.abs(positions[left].u - positions[right].u);
      const dy = Math.abs(positions[left].v - positions[right].v);
      if (dx < cardWidth - EPSILON && dy < cardHeight - EPSILON) {
        overlapping = true;
      }
    }
  }
  check("cards never overlap", !overlapping);
  check(
    "an empty board has no card positions",
    planningCardPositions(0).length === 0,
  );
}

function runPlanningWalkChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const halfWidth = PLANNING_BOARD.width / 2;
  const offsets = [0, 1].map((seat) => {
    const slot = slotFor("planning", seat);
    const dx = slot.x - PLANNING_BOARD_CENTER.x;
    const dz = slot.z - PLANNING_BOARD_CENTER.z;
    const heading = headingFor("planning", seat);
    return {
      normal:
        dx * PLANNING_BOARD_NORMAL.x +
        dz * PLANNING_BOARD_NORMAL.z -
        PLANNING_BOARD_FACE_OFFSET,
      tangent: dx * PLANNING_BOARD_TANGENT.x + dz * PLANNING_BOARD_TANGENT.z,
      facing:
        Math.sin(heading) * PLANNING_BOARD_NORMAL.x +
        Math.cos(heading) * PLANNING_BOARD_NORMAL.z,
    };
  });

  check(
    "planning walk slots stand in front of the board face",
    offsets.every((offset) => offset.normal > 0),
    offsets.map((offset) => offset.normal.toFixed(3)).join(","),
  );
  check(
    "planning walk slots stay within the board width",
    offsets.every((offset) => Math.abs(offset.tangent) <= halfWidth),
    offsets.map((offset) => offset.tangent.toFixed(3)).join(","),
  );
  check(
    "planning walk slots face the board",
    offsets.every((offset) => offset.facing <= -0.999),
    offsets.map((offset) => offset.facing.toFixed(4)).join(","),
  );
}

function runEngineBoardChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine } = harness();
  engine.start();
  const created = engine.submitTask(DEMO_TASK);
  const planned = tickUntil(
    engine,
    () => (engine.getTask(created.id)?.subtasks.length ?? 0) > 0,
    60,
  );
  const snapshot = engine.snapshot();
  const cards = planningCards(snapshot.tasks);
  const view = missionView(snapshot, true);
  check(
    "the demo creates six planning cards",
    planned && cards.length === 6,
    `${cards.length} cards`,
  );
  check(
    "the wall lists the demo task while it is active",
    view.tasks.length === 1 && view.tasks[0].id === created.id,
    view.tasks.map((row) => row.id).join(","),
  );
  check(
    "the wall counts the demo task in its current phase",
    view.counts.reduce((sum, count) => sum + count, 0) === 1,
    view.counts.join(","),
  );
  check(
    "the planning signature matches the card set",
    planningSignature(cards) === planningSignature(planningCards(snapshot.tasks)),
  );
  // The engine ticks in the same order as the UI, so a later snapshot must
  // keep every card inside the board.
  engine.tick(TICK_SECONDS);
  const later = planningCards(engine.snapshot().tasks);
  check(
    "cards stay inside the board as the task advances",
    later.every(
      (card) =>
        card.u - PLANNING_BOARD.cardWidth / 2 >=
          PLANNING_BOARD.sideInset - EPSILON &&
        card.u + PLANNING_BOARD.cardWidth / 2 <=
          PLANNING_BOARD.width - PLANNING_BOARD.sideInset + EPSILON &&
        card.v - PLANNING_BOARD.cardHeight / 2 >=
          PLANNING_BOARD.bottomInset - EPSILON &&
        card.v + PLANNING_BOARD.cardHeight / 2 <=
          PLANNING_BOARD.height - PLANNING_BOARD.topInset + EPSILON,
    ),
    `${later.length} cards`,
  );
}

export function runBoardsSuite(reporter: TestReporter): void {
  reporter.group("8. Live boards");
  runCountsChecks(reporter);
  runActiveTaskChecks(reporter);
  runSignatureChecks(reporter);
  runPlanningChecks(reporter);
  runLayoutChecks(reporter);
  runPlanningWalkChecks(reporter);
  runEngineBoardChecks(reporter);
}
