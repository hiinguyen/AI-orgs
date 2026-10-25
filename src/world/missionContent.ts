import type { AgentId, AgentStatus } from "../agents/agentTypes.ts";
import { CORE_AGENT_IDS } from "../agents/agentTypes.ts";
import { getAgentProfile } from "../agents/AgentRegistry.ts";
import type { WorldSnapshot } from "../integrations/AgentBackend.ts";
import {
  PHASE_LABELS,
  PRIORITY_ORDER,
  type Task,
  type WorkflowPhase,
} from "../tasks/taskTypes.ts";
import { isActiveTask } from "../tasks/taskActions.ts";
import { stationOperator } from "./stationPresence.ts";

/**
 * Pure mission-control content: phase counts, active task rows, the roster and
 * the redraw signature. It imports no React and no three so the headless
 * checks can load it with node --experimental-strip-types.
 */

export type MissionChartPhase = Exclude<WorkflowPhase, "queued">;

export const MISSION_CHART_PHASES: readonly MissionChartPhase[] = [
  "intake",
  "planning",
  "research",
  "implementation",
  "testing",
  "review",
  "done",
  "failed",
];

export const MISSION_CHART_LABELS: Record<MissionChartPhase, string> = {
  intake: "INTAKE",
  planning: "PLANNING",
  research: "RESEARCH",
  implementation: "BUILD",
  testing: "QA",
  review: "REVIEW",
  done: "DONE",
  failed: "FAILED",
};

/** Bar colour follows the phase owner, so the chart matches the roster. */
export const MISSION_CHART_COLORS: Record<MissionChartPhase, string> = {
  intake: getAgentProfile("orion").color,
  planning: getAgentProfile("piper").color,
  research: getAgentProfile("iris").color,
  implementation: getAgentProfile("kai").color,
  testing: getAgentProfile("quinn").color,
  review: getAgentProfile("rex").color,
  done: "#7cc4d6",
  failed: "#ff8a7a",
};

const CHART_INDEX: Record<WorkflowPhase, number> = {
  queued: -1,
  intake: 0,
  planning: 1,
  research: 2,
  implementation: 3,
  testing: 4,
  review: 5,
  done: 6,
  failed: 7,
};

export interface MissionTaskRow {
  id: string;
  title: string;
  phase: WorkflowPhase;
  phaseLabel: string;
  progress: number;
  color: string;
  agentName: string;
}

export interface MissionAgentRow {
  id: AgentId;
  name: string;
  roleLabel: string;
  color: string;
  status: AgentStatus;
  paused: boolean;
  statusLabel: string;
  statusColor: string;
}

export interface MissionOperator {
  id: AgentId;
  name: string;
  color: string;
}

export interface MissionView {
  simulated: boolean;
  counts: readonly number[];
  tasks: readonly MissionTaskRow[];
  agents: readonly MissionAgentRow[];
  operator: MissionOperator | null;
}

export const MISSION_ACTIVE_TASK_LIMIT = 4;

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  walking: "Moving",
  working: "Working",
  thinking: "Thinking",
  communicating: "Communicating",
  success: "Done",
  error: "Error",
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#7c8797",
  walking: "#9ad7e6",
  working: "#6fe3a4",
  thinking: "#7cc4d6",
  communicating: "#c4b5fd",
  success: "#6fe3a4",
  error: "#ff8a7a",
};

const PAUSED_COLOR = "#f2b46a";

/** Task counts per chart column, in MISSION_CHART_PHASES order. */
export function phaseCounts(tasks: readonly Task[]): number[] {
  const counts = MISSION_CHART_PHASES.map(() => 0);
  for (const task of tasks) {
    const index = CHART_INDEX[task.phase];
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}

function taskColor(task: Task): string {
  if (task.assignedAgentId === null) return "#7cc4d6";
  return getAgentProfile(task.assignedAgentId).color;
}

function taskAgentName(task: Task): string {
  if (task.assignedAgentId === null) return "Unassigned";
  return getAgentProfile(task.assignedAgentId).name;
}

/**
 * Active tasks for the wall: highest priority first, then newest. Terminal
 * and queued tasks are not "active" (taskActions.isActiveTask).
 */
export function missionTaskRows(
  tasks: readonly Task[],
  limit: number = MISSION_ACTIVE_TASK_LIMIT,
): MissionTaskRow[] {
  const active = tasks.filter(isActiveTask);
  active.sort(
    (left, right) =>
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
      right.createdAt - left.createdAt ||
      right.id.localeCompare(left.id),
  );
  return active.slice(0, limit).map((task) => ({
    id: task.id,
    title: task.title,
    phase: task.phase,
    phaseLabel: PHASE_LABELS[task.phase],
    progress: Math.max(0, Math.min(1, task.progress)),
    color: taskColor(task),
    agentName: taskAgentName(task),
  }));
}

function agentRow(id: AgentId, snapshot: WorldSnapshot | null): MissionAgentRow {
  const profile = getAgentProfile(id);
  let status: AgentStatus = "idle";
  let paused = false;
  if (snapshot !== null) {
    for (const agent of snapshot.agents) {
      if (agent.id !== id) continue;
      status = agent.status;
      paused = agent.paused;
      break;
    }
  }
  return {
    id,
    name: profile.name,
    roleLabel: profile.roleLabel,
    color: profile.color,
    status,
    paused,
    statusLabel: paused ? "Paused" : STATUS_LABELS[status],
    statusColor: paused ? PAUSED_COLOR : STATUS_COLORS[status],
  };
}

/**
 * The agent currently driving the wall from the mission console. Only an
 * agent physically at the console and in an active state counts, so the
 * header never claims control while nobody is there.
 */
function missionOperator(
  snapshot: WorldSnapshot | null,
): MissionOperator | null {
  const agent = stationOperator(snapshot, "mission");
  if (agent === null) return null;
  const profile = getAgentProfile(agent.id);
  return {
    id: agent.id,
    name: profile.name,
    color: profile.color,
  };
}

/** Everything the wall draws, derived from one snapshot. */
export function missionView(
  snapshot: WorldSnapshot | null,
  simulated: boolean,
): MissionView {
  const tasks = snapshot?.tasks ?? [];
  return {
    simulated,
    counts: phaseCounts(tasks),
    tasks: missionTaskRows(tasks),
    agents: CORE_AGENT_IDS.map((id) => agentRow(id, snapshot)),
    operator: missionOperator(snapshot),
  };
}

/**
 * Short content signature. Progress is rounded to whole per cent, so a task
 * moving from 41.2% to 41.4% does not force a redraw. The simulation mode is
 * part of it because the header shows it.
 */
export function missionSignature(view: MissionView): string {
  const counts = view.counts.join(",");
  const tasks = view.tasks
    .map(
      (task) =>
        `${task.id}:${task.title}:${task.phase}:${Math.round(task.progress * 100)}:${task.color}`,
    )
    .join("|");
  const agents = view.agents
    .map((agent) => `${agent.id}:${agent.paused ? "paused" : agent.status}`)
    .join("|");
  const operator = view.operator === null ? "none" : view.operator.id;
  return `${view.simulated ? "sim" : "live"}#${counts}#${tasks}#${agents}#${operator}`;
}
