import { hashString } from "../simulation/EventBus.ts";

/**
 * Fixed colour palettes for robots. Core agents keep the six spec colours;
 * live agents hash their id into a twelve-hue palette that deliberately
 * avoids the core hues, so two agents of the same role still read as two
 * distinct robots.
 */

export interface CoreColor {
  id: string;
  color: string;
}

export const CORE_AGENT_COLORS: readonly CoreColor[] = [
  { id: "orion", color: "#E8B04A" },
  { id: "iris", color: "#5CC8D7" },
  { id: "piper", color: "#A78BFA" },
  { id: "kai", color: "#6C9EFF" },
  { id: "quinn", color: "#5FD39A" },
  { id: "rex", color: "#F08A7E" },
] as const;

export const CORE_COLOR_BY_ID: ReadonlyMap<string, string> = new Map(
  CORE_AGENT_COLORS.map((entry) => [entry.id, entry.color]),
);

/**
 * Twelve hues spread around the colour wheel, each pulled away from the six
 * core colours in RGB so a live agent can never be mistaken for Orion, Iris,
 * Piper, Kai, Quinn or Rex at the overview.
 */
export const LIVE_AGENT_PALETTE: readonly string[] = [
  "#FF7A1A", // orange
  "#FDE047", // yellow
  "#A3E635", // lime
  "#22C55E", // green
  "#14B8A6", // teal
  "#06B6D4", // cyan
  "#0EA5E9", // sky
  "#4338CA", // indigo
  "#7C3AED", // violet
  "#D946EF", // fuchsia
  "#F472B6", // pink
  "#F43F5E", // rose
] as const;

export function liveColorIndex(id: string): number {
  return hashString(id) % LIVE_AGENT_PALETTE.length;
}

/** Core colour when known, otherwise the deterministic live palette entry. */
export function colorForAgent(id: string): string {
  return CORE_COLOR_BY_ID.get(id) ?? LIVE_AGENT_PALETTE[liveColorIndex(id)];
}

export function isCoreAgentId(id: string): boolean {
  return CORE_COLOR_BY_ID.has(id);
}
