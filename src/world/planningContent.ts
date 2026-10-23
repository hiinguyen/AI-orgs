import { getAgentProfile } from "../agents/AgentRegistry.ts";
import { isTerminalPhase, type Task } from "../tasks/taskTypes.ts";
import { isActiveTask } from "../tasks/taskActions.ts";

/**
 * Pure planning-board content and layout. The board is a 4.0 x 2.4 m plane;
 * cards are laid out in a fixed six-column grid below the painted header.
 * No React or three imports, so the headless checks can load this module.
 */

export const PLANNING_CARD_LIMIT = 24;

/** Board group rotation around Y and the local X of its painted face. */
export const PLANNING_BOARD_ROTATION = -0.55;
export const PLANNING_BOARD_FACE_OFFSET = 0.09;

/** World-space board axes derived from the group rotation. */
export const PLANNING_BOARD_NORMAL = {
  x: Math.cos(PLANNING_BOARD_ROTATION),
  z: -Math.sin(PLANNING_BOARD_ROTATION),
} as const;

export const PLANNING_BOARD_TANGENT = {
  x: Math.sin(PLANNING_BOARD_ROTATION),
  z: Math.cos(PLANNING_BOARD_ROTATION),
} as const;

export const PLANNING_BOARD = {
  width: 4.0,
  height: 2.4,
  columns: 6,
  cardWidth: 0.56,
  cardHeight: 0.38,
  gap: 0.06,
  /** Painted "SPRINT PLANNING" strip at the top of the board. */
  topInset: 0.4,
  sideInset: 0.12,
  bottomInset: 0.12,
} as const;

export const PENDING_CARD_TINT = "#f0c96e";
export const DONE_CARD_TINT = "#86a58d";
export const FAILED_CARD_TINT = "#c68b82";

export interface PlanningCardPosition {
  /** Centre along the board width, metres from the left edge. */
  u: number;
  /** Centre above the board bottom, metres. */
  v: number;
}

export interface PlanningCard extends PlanningCardPosition {
  key: string;
  taskId: string;
  title: string;
  done: boolean;
  tint: string;
}

/** Centre positions for `count` cards, top-left first, six per row. */
export function planningCardPositions(
  count: number,
): PlanningCardPosition[] {
  const total = Math.max(0, Math.min(PLANNING_CARD_LIMIT, Math.floor(count)));
  const { width, height, columns, cardWidth, cardHeight, gap, topInset } =
    PLANNING_BOARD;
  // A fixed six-column grid keeps existing cards in place while a row fills.
  const gridWidth = columns * cardWidth + (columns - 1) * gap;
  const left = (width - gridWidth) / 2;
  const top = height - topInset;
  const positions: PlanningCardPosition[] = [];
  for (let index = 0; index < total; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.push({
      u: left + column * (cardWidth + gap) + cardWidth / 2,
      v: top - row * (cardHeight + gap) - cardHeight / 2,
    });
  }
  return positions;
}

function cardTint(task: Task, done: boolean): string {
  if (done) return DONE_CARD_TINT;
  if (task.phase === "failed") return FAILED_CARD_TINT;
  if (task.assignedAgentId === null) return PENDING_CARD_TINT;
  return getAgentProfile(task.assignedAgentId).color;
}

/** Completion time of a terminal task, falling back for older snapshots. */
function finishedAt(task: Task): number {
  return task.completedAt ?? task.updatedAt;
}

/**
 * The tasks whose cards the board shows: newest active task first. With no
 * active task, the newest finished task keeps its cards on the board until
 * another task becomes active.
 */
function planningTasks(tasks: readonly Task[]): Task[] {
  const active = tasks.filter(isActiveTask);
  if (active.length > 0) {
    active.sort(
      (left, right) =>
        right.createdAt - left.createdAt || right.id.localeCompare(left.id),
    );
    return active;
  }

  let newest: Task | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const task of tasks) {
    if (!isTerminalPhase(task.phase)) continue;
    const at = finishedAt(task);
    if (at > newestAt || (at === newestAt && task.id > (newest?.id ?? ""))) {
      newest = task;
      newestAt = at;
    }
  }
  return newest === null ? [] : [newest];
}

/**
 * One card per subtask of the selected tasks, newest task first, then subtask
 * order, capped at 24. Done cards use the muted green tint; serialised failed
 * work uses a muted red.
 */
export function planningCards(tasks: readonly Task[]): PlanningCard[] {
  const selected = planningTasks(tasks);
  const positions = planningCardPositions(PLANNING_CARD_LIMIT);
  const cards: PlanningCard[] = [];
  for (const task of selected) {
    for (const subtask of task.subtasks) {
      if (cards.length >= PLANNING_CARD_LIMIT) return cards;
      const position = positions[cards.length];
      cards.push({
        key: subtask.id,
        taskId: task.id,
        title: subtask.title,
        done: subtask.done,
        tint: cardTint(task, subtask.done),
        u: position.u,
        v: position.v,
      });
    }
  }
  return cards;
}

/** Content signature for the card set; layout is part of the card data. */
export function planningSignature(cards: readonly PlanningCard[]): string {
  return cards
    .map((card) => `${card.key}:${card.title}:${card.done ? 1 : 0}:${card.tint}`)
    .join("|");
}
