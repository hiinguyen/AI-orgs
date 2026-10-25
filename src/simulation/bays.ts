import type { Vec2 } from "../agents/agentTypes.ts";
import {
  BAY_COLUMNS,
  BAY_COUNT,
  BAY_DESKS,
  BAY_STANDS,
  CORRIDOR_Z,
  distance,
  type LocationId,
} from "./worldLayout.ts";

/**
 * Dispatch Floor helpers. Bays are pure layout data: a live agent takes the
 * lowest free bay, and when every bay is occupied it waits at the Collaboration
 * Table ring until one frees.
 *
 * This module is imported by the simulation-side fake backend and the
 * headless checks, so it stays free of React, three and Next imports.
 */

export const DISPATCH_LOCATION: LocationId = "dispatch";
export const WAITING_LOCATION: LocationId = "collab";

/** Lowest free bay index, or null when all twelve are occupied. */
export function allocateBay(occupied: ReadonlySet<number>): number | null {
  for (let index = 0; index < BAY_COUNT; index += 1) {
    if (!occupied.has(index)) return index;
  }
  return null;
}

function clampBay(index: number): number {
  if (!Number.isFinite(index)) return 0;
  const whole = Math.trunc(index);
  return Math.max(0, Math.min(BAY_COUNT - 1, whole));
}

/** Stand slot of a bay, where the agent types. */
export function bayStand(index: number): Vec2 {
  return BAY_STANDS[clampBay(index)];
}

/** Matching desk position, 0.8 m in front of the stand. */
export function bayDesk(index: number): Vec2 {
  return BAY_DESKS[clampBay(index)];
}

/**
 * The bay whose stand an agent is closest to, when it is close enough to
 * count as the occupant. Used by the desk glow and by the checks; the caller
 * never has to trust an index from the backend.
 */
export function bayAt(
  position: Vec2,
  maxDistance = 0.6,
): number | null {
  let best: number | null = null;
  let bestDistance = maxDistance;
  for (let index = 0; index < BAY_STANDS.length; index += 1) {
    const stand = BAY_STANDS[index];
    const distanceToStand = Math.hypot(
      position.x - stand.x,
      position.z - stand.z,
    );
    if (distanceToStand <= bestDistance) {
      best = index;
      bestDistance = distanceToStand;
    }
  }
  return best;
}

/** The aisle between a bay column and the next one, used to avoid desks. */
function bayLaneX(index: number): number {
  const clamped = clampBay(index);
  const column = clamped % BAY_COLUMNS;
  const stand = BAY_STANDS[clamped];
  if (column === BAY_COLUMNS - 1) return stand.x + 0.9;
  return (stand.x + BAY_STANDS[clamped + 1].x) / 2;
}

/**
 * A routed walk to a bay that stays in the aisles between desks instead of
 * walking over the row in front. The corridor leg is shared with the normal
 * `route()`; the last two legs go up a column gap and sideways at the bay's
 * stand line, which is always 0.8 m clear of that row's desks.
 */
export function routeToBay(from: Vec2, index: number): Vec2[] {
  const stand = bayStand(index);
  const laneX = bayLaneX(index);
  const points: Vec2[] = [];
  const push = (point: Vec2): void => {
    const last = points.length > 0 ? points[points.length - 1] : from;
    if (distance(last, point) < 0.03) return;
    points.push({ x: point.x, z: point.z });
  };
  push({ x: from.x, z: CORRIDOR_Z });
  push({ x: laneX, z: CORRIDOR_Z });
  push({ x: laneX, z: stand.z });
  push({ x: stand.x, z: stand.z });
  return points;
}
