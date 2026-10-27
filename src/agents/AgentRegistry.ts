import type {
  AgentId,
  AgentProfile,
  AgentRole,
} from "./agentTypes.ts";
import { CORE_AGENT_IDS } from "./agentTypes.ts";
import { CORE_AGENT_COLORS, colorForAgent } from "./agentPalette.ts";

/**
 * Profiles are open now: the six simulation agents are fixed, and any live
 * backend may announce additional subagents. `getAgentProfile` is total: it
 * returns a usable fallback for an id nobody announced yet, so UI code never
 * needs to guard (`profile.name`, `profile.color` are always valid).
 *
 * The store mirrors snapshots into this registry on every snapshot, which
 * keeps the pure simulation helpers and the React layer reading one map.
 */

const ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: "Orchestrator",
  researcher: "Researcher",
  product_manager: "Product Manager",
  engineer: "Software Engineer",
  qa: "QA Engineer",
  reviewer: "Code Reviewer",
};

export const CORE_AGENTS: readonly AgentProfile[] = [
  {
    id: "orion",
    name: "Orion",
    role: "orchestrator",
    roleLabel: "Orchestrator",
    tagline: "Coordinates work and delegates tasks",
    color: CORE_AGENT_COLORS[0].color,
    home: "hub",
    seat: 0,
    kind: "core",
  },
  {
    id: "iris",
    name: "Iris",
    role: "researcher",
    roleLabel: "Researcher",
    tagline: "Researches technical topics and gathers information",
    color: CORE_AGENT_COLORS[1].color,
    home: "research",
    seat: 1,
    kind: "core",
  },
  {
    id: "piper",
    name: "Piper",
    role: "product_manager",
    roleLabel: "Product Manager",
    tagline: "Converts requirements into actionable tasks",
    color: CORE_AGENT_COLORS[2].color,
    home: "product",
    seat: 2,
    kind: "core",
  },
  {
    id: "kai",
    name: "Kai",
    role: "engineer",
    roleLabel: "Software Engineer",
    tagline: "Implements software features",
    color: CORE_AGENT_COLORS[3].color,
    home: "dev",
    seat: 3,
    kind: "core",
  },
  {
    id: "quinn",
    name: "Quinn",
    role: "qa",
    roleLabel: "QA Engineer",
    tagline: "Tests completed work",
    color: CORE_AGENT_COLORS[4].color,
    home: "testing",
    seat: 4,
    kind: "core",
  },
  {
    id: "rex",
    name: "Rex",
    role: "reviewer",
    roleLabel: "Code Reviewer",
    tagline: "Reviews implementation quality",
    color: CORE_AGENT_COLORS[5].color,
    home: "review",
    seat: 5,
    kind: "core",
  },
] as const;

export const CORE_AGENT_BY_ID: ReadonlyMap<AgentId, AgentProfile> = new Map(
  CORE_AGENTS.map((profile) => [profile.id, profile]),
);

/** Backwards-compatible name for the six core profiles. */
export const AGENTS = CORE_AGENTS;

/**
 * Every live profile ever announced, keyed by id. Entries are kept after an
 * agent leaves the current snapshot (finishes or despawns) so historical
 * events referencing it still resolve a real name instead of a raw-id
 * fallback. Bounded like `fallbackProfiles` below.
 */
const announcedProfiles = new Map<AgentId, AgentProfile>();
const MAX_ANNOUNCED_PROFILES = 256;
const fallbackProfiles = new Map<AgentId, AgentProfile>();
let announcedSignature = "";

/** Deterministic fallback for an id that no snapshot has announced. */
function fallbackAgentProfile(id: AgentId): AgentProfile {
  const existing = fallbackProfiles.get(id);
  if (existing) return existing;

  const label = id.length > 24 ? `${id.slice(0, 24)}...` : id;
  const profile: AgentProfile = {
    id,
    name: `Agent ${label}`,
    role: "engineer",
    roleLabel: ROLE_LABELS.engineer,
    tagline: "Announced by the live backend",
    color: colorForAgent(id),
    seat: 0,
    kind: "live",
  };
  // Bounded cache: a long session may see hundreds of transient ids.
  if (fallbackProfiles.size >= 256) {
    const oldest = fallbackProfiles.keys().next().value;
    if (oldest !== undefined) fallbackProfiles.delete(oldest);
  }
  fallbackProfiles.set(id, profile);
  return profile;
}

/**
 * Merge in the snapshot's live profiles. Core profiles are never overridden
 * by a backend, and a profile already announced for an id that has since
 * left the snapshot is kept, not dropped. Returns true when the set actually
 * changed.
 */
export function setAnnouncedProfiles(
  profiles: readonly AgentProfile[],
): boolean {
  const live = profiles.filter(
    (profile) => profile.kind === "live" && !CORE_AGENT_BY_ID.has(profile.id),
  );
  const signature = live
    .map(
      (profile) =>
        `${profile.id}:${profile.name}:${profile.role}:${profile.roleLabel}:${profile.color}:${profile.seat}`,
    )
    .sort()
    .join("|");
  if (signature === announcedSignature) return false;

  announcedSignature = signature;
  for (const profile of live) {
    // Re-insert to refresh recency for the bounded eviction below.
    announcedProfiles.delete(profile.id);
    announcedProfiles.set(profile.id, profile);
    if (announcedProfiles.size > MAX_ANNOUNCED_PROFILES) {
      const oldest = announcedProfiles.keys().next().value;
      if (oldest !== undefined) announcedProfiles.delete(oldest);
    }
  }
  return true;
}

/** Total: core, then last announced, then a deterministic fallback. */
export function getAgentProfile(id: AgentId): AgentProfile {
  return (
    CORE_AGENT_BY_ID.get(id) ??
    announcedProfiles.get(id) ??
    fallbackAgentProfile(id)
  );
}

export function agentName(id: AgentId): string {
  return getAgentProfile(id).name;
}

export { CORE_AGENT_IDS };
