/**
 * Scenario data for the fake live backend (scripts/fake-live-server.ts).
 *
 * The world model itself now lives in src/simulation/liveStage.ts, because the
 * Claude Code bridge drives the same stage. This file only decides which role
 * and name the nth scripted spawn gets.
 */
import type { AgentProfile } from "../../src/agents/agentTypes.ts";
import { colorForAgent } from "../../src/agents/agentPalette.ts";
import type { Task } from "../../src/tasks/taskTypes.ts";

export const LIVE_ROLES = [
  "researcher",
  "product_manager",
  "engineer",
  "qa",
  "reviewer",
] as const;

export type LiveRole = (typeof LIVE_ROLES)[number];

const LIVE_ROLE_LABELS: Record<LiveRole, string> = {
  researcher: "Researcher",
  product_manager: "Product Manager",
  engineer: "Software Engineer",
  qa: "QA Engineer",
  reviewer: "Code Reviewer",
};

/**
 * Role for the nth spawn (1-based). The first burst is four agents of the same
 * role, the case that used to collapse into one robot before phase 9.
 */
export function roleForSpawn(spawnSeq: number): LiveRole {
  return spawnSeq <= 4 ? "reviewer" : LIVE_ROLES[spawnSeq % LIVE_ROLES.length];
}

/** Profile for the nth spawn. */
export function liveProfileFor(spawnSeq: number): AgentProfile {
  const role = roleForSpawn(spawnSeq);
  const id = `live-${String(spawnSeq).padStart(2, "0")}`;
  return {
    id,
    name:
      role === "reviewer"
        ? `code-reviewer #${spawnSeq}`
        : `${role.replaceAll("_", "-")} #${spawnSeq}`,
    role,
    roleLabel: LIVE_ROLE_LABELS[role],
    tagline: "Live subagent over the fake WebSocket backend",
    color: colorForAgent(id),
    seat: spawnSeq % 6,
    kind: "live",
  };
}

export function taskFixture(): Task {
  return {
    id: "T-001",
    title: "Fake live task",
    description: "A placeholder returned by the fake live server.",
    priority: "medium",
    status: "queued",
    phase: "queued",
    assignedAgentId: null,
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    iteration: 0,
    subtasks: [],
    findings: [],
    history: [],
    isDemo: false,
    preferredAgentId: null,
    blockedReason: null,
  };
}
