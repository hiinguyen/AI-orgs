import type { AgentId } from "../agents/agentTypes.ts";
import { SIMULATION_CONFIG } from "../simulation/simulationConfig.ts";
import type { AgentEvent } from "./eventTypes.ts";
import { isAgentCommunication } from "./eventTypes.ts";

/** Prepends the event; logs are kept newest-first for the activity feed. */
export function appendEvent(
  log: readonly AgentEvent[],
  event: AgentEvent,
  max = SIMULATION_CONFIG.maxEvents,
): AgentEvent[] {
  return [event, ...log].slice(0, Math.max(0, max));
}

export function feedEvents(
  log: readonly AgentEvent[],
  messagesOnly = false,
): AgentEvent[] {
  return log.filter(
    (event) => event.feed && (!messagesOnly || isAgentCommunication(event)),
  );
}

export function latestEvents(
  log: readonly AgentEvent[],
  limit = 8,
): AgentEvent[] {
  return log.slice(0, Math.max(0, limit));
}

export function eventsForAgent(
  log: readonly AgentEvent[],
  agentId: AgentId,
): AgentEvent[] {
  return log.filter(
    (event) =>
      event.agentId === agentId || event.targetAgentId === agentId,
  );
}

export function communicationEvents(
  log: readonly AgentEvent[],
): AgentEvent[] {
  return log.filter(isAgentCommunication);
}

export function eventsForTask(
  log: readonly AgentEvent[],
  taskId: string,
): AgentEvent[] {
  return log.filter((event) => event.taskId === taskId);
}

export function agentsInEvent(event: AgentEvent): AgentId[] {
  const agents: AgentId[] = [];
  if (event.agentId) agents.push(event.agentId);
  if (event.targetAgentId && event.targetAgentId !== event.agentId) {
    agents.push(event.targetAgentId);
  }
  return agents;
}
