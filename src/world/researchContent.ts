import { isTerminalPhase, type Task } from "../tasks/taskTypes.ts";
import { isActiveTask } from "../tasks/taskActions.ts";
import { RESEARCH_BOARD_ROTATION } from "../simulation/worldLayout.ts";
import { percentOf, phaseRatio } from "./phaseProgress.ts";

/**
 * Pure research-board content and layout. The board is a 3.6 x 2.4 m display
 * panel that lists one row per published finding below a painted header.
 * No React or three imports, so the headless checks can load this module.
 */

export { RESEARCH_BOARD_ROTATION };
export const RESEARCH_BOARD_FACE_OFFSET = 0.09;

export const RESEARCH_BOARD = {
  width: 3.6,
  height: 2.4,
  pxPerMetre: 300,
} as const;

/** Frame width of the research board, a little wider than its panel. */
export const RESEARCH_BOARD_FRAME_WIDTH = RESEARCH_BOARD.width + 0.22;

export const RESEARCH_ROW_LIMIT = 6;
export const RESEARCH_ACCENT = "#5cc8d7";

/** World-space board axes derived from the group rotation. */
export const RESEARCH_BOARD_NORMAL = {
  x: Math.cos(RESEARCH_BOARD_ROTATION),
  z: -Math.sin(RESEARCH_BOARD_ROTATION),
} as const;

export const RESEARCH_BOARD_TANGENT = {
  x: Math.sin(RESEARCH_BOARD_ROTATION),
  z: Math.cos(RESEARCH_BOARD_ROTATION),
} as const;

export interface ResearchRow {
  key: string;
  /** 1-based finding number. */
  index: number;
  text: string;
}

export interface ResearchView {
  taskId: string | null;
  /** The research question, or an idle prompt. */
  topic: string;
  rows: readonly ResearchRow[];
  /** 0..1 progress of the research step. */
  ratio: number;
  percent: number;
  /** True while a task is in the research phase. */
  researching: boolean;
}

export const IDLE_TOPIC = "No open research question";

function newest(tasks: readonly Task[]): Task | null {
  let best: Task | null = null;
  for (const task of tasks) {
    if (
      best === null ||
      task.createdAt > best.createdAt ||
      (task.createdAt === best.createdAt && task.id > best.id)
    ) {
      best = task;
    }
  }
  return best;
}

/**
 * The task the board shows: the newest one being researched, else the newest
 * active task that already has findings, else the newest finished task with
 * findings so the last result stays readable.
 */
function researchTask(tasks: readonly Task[]): Task | null {
  const active = tasks.filter(isActiveTask);
  const researching = newest(active.filter((task) => task.phase === "research"));
  if (researching !== null) return researching;
  const withFindings = newest(active.filter((task) => task.findings.length > 0));
  if (withFindings !== null) return withFindings;
  return newest(
    tasks.filter((task) => isTerminalPhase(task.phase) && task.findings.length > 0),
  );
}

/** Rows for the shown task: the first findings, capped at the row limit. */
export function researchRows(task: Task): ResearchRow[] {
  return task.findings.slice(0, RESEARCH_ROW_LIMIT).map((text, index) => ({
    key: `${task.id}-f${index + 1}`,
    index: index + 1,
    text,
  }));
}

export function researchView(tasks: readonly Task[]): ResearchView {
  const task = researchTask(tasks);
  if (task === null) {
    return {
      taskId: null,
      topic: IDLE_TOPIC,
      rows: [],
      ratio: 0,
      percent: 0,
      researching: false,
    };
  }
  const ratio = phaseRatio(task, "research");
  return {
    taskId: task.id,
    topic: task.title,
    rows: researchRows(task),
    ratio,
    percent: percentOf(ratio),
    researching: task.phase === "research",
  };
}

/** Content signature; the board repaints only when it changes. */
export function researchSignature(view: ResearchView): string {
  const rows = view.rows.map((row) => `${row.key}:${row.text}`).join("|");
  return `${view.taskId ?? "none"}#${view.topic}#${view.percent}#${view.researching ? 1 : 0}#${rows}`;
}
