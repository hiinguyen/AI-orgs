import type { AgentId } from "@/agents/agentTypes";
import {
  STATION_OWNERS,
  type Station,
  type StationId,
} from "@/simulation/worldLayout";

/**
 * Station to agent map from the spec, plus small helpers shared by the 3D
 * workstations, the interaction layer and the side panel.
 */
export const STATION_OWNER_IDS: Record<StationId, AgentId> = STATION_OWNERS;

export const STATION_IDS: readonly StationId[] = [
  "ops",
  "research",
  "product",
  "dev",
  "testing",
  "review",
];

export function isStationId(value: string): value is StationId {
  return (STATION_IDS as readonly string[]).includes(value);
}

export function stationOwnerId(stationId: StationId): AgentId {
  return STATION_OWNER_IDS[stationId];
}

/** Parse a store hover target such as "station:dev". */
export function stationIdFromTarget(target: string | null): StationId | null {
  if (target === null || !target.startsWith("station:")) return null;
  const id = target.slice("station:".length);
  return isStationId(id) ? id : null;
}

export function stationTarget(station: Station | StationId): string {
  return `station:${typeof station === "string" ? station : station.id}`;
}
