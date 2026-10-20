import type { AgentId, AgentProfile } from "./agentTypes.ts";

export const AGENTS: readonly AgentProfile[] = [
  {
    id: "orion",
    name: "Orion",
    role: "orchestrator",
    roleLabel: "Orchestrator",
    tagline: "Coordinates work and delegates tasks",
    color: "#E8B04A",
    home: "hub",
    seat: 0,
  },
  {
    id: "iris",
    name: "Iris",
    role: "researcher",
    roleLabel: "Researcher",
    tagline: "Researches technical topics and gathers information",
    color: "#5CC8D7",
    home: "research",
    seat: 1,
  },
  {
    id: "piper",
    name: "Piper",
    role: "product_manager",
    roleLabel: "Product Manager",
    tagline: "Converts requirements into actionable tasks",
    color: "#A78BFA",
    home: "product",
    seat: 2,
  },
  {
    id: "kai",
    name: "Kai",
    role: "engineer",
    roleLabel: "Software Engineer",
    tagline: "Implements software features",
    color: "#6C9EFF",
    home: "dev",
    seat: 3,
  },
  {
    id: "quinn",
    name: "Quinn",
    role: "qa",
    roleLabel: "QA Engineer",
    tagline: "Tests completed work",
    color: "#5FD39A",
    home: "testing",
    seat: 4,
  },
  {
    id: "rex",
    name: "Rex",
    role: "reviewer",
    roleLabel: "Code Reviewer",
    tagline: "Reviews implementation quality",
    color: "#F08A7E",
    home: "review",
    seat: 5,
  },
] as const;

export const AGENT_BY_ID: Record<AgentId, AgentProfile> = {
  orion: AGENTS[0],
  iris: AGENTS[1],
  piper: AGENTS[2],
  kai: AGENTS[3],
  quinn: AGENTS[4],
  rex: AGENTS[5],
};

export function getAgentProfile(id: AgentId): AgentProfile {
  return AGENT_BY_ID[id];
}

export function agentName(id: AgentId): string {
  return AGENT_BY_ID[id].name;
}
