import type { AgentId, Vec2 } from "../agents/agentTypes.ts";

export const FLOOR = {
  width: 30,
  depth: 21,
  minX: -15,
  maxX: 15,
  minZ: -9.5,
  maxZ: 11.5,
} as const;

export const CORRIDOR_Z = 2.8;

export type LocationId =
  | "hub"
  | "ops"
  | "research"
  | "product"
  | "dev"
  | "testing"
  | "review"
  | "planning"
  | "collab"
  | "lounge";

export type ZoneId =
  | "operations"
  | "research"
  | "development"
  | "collaboration";

export interface WorldLocation {
  id: LocationId;
  label: string;
  slots: readonly Vec2[];
  /** Radians, or "inward" for ring slots that face their centre. */
  facing: number | "inward";
  center?: Vec2;
  zone: ZoneId;
}

export const HUB_CENTER: Vec2 = { x: 0, z: -0.6 };
export const MISSION_CONTROL: Vec2 = { x: 0, z: -7.4 };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ring(center: Vec2, radius: number, count = 6): Vec2[] {
  const slots: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    slots.push({
      x: round(center.x + Math.sin(angle) * radius),
      z: round(center.z + Math.cos(angle) * radius),
    });
  }
  return slots;
}

const COLLAB_CENTER: Vec2 = { x: -5, z: 5.6 };
const LOUNGE_CENTER: Vec2 = { x: 7.5, z: 6.2 };

export const LOCATIONS: Record<LocationId, WorldLocation> = {
  hub: {
    id: "hub",
    label: "Operations Hub",
    slots: [{ x: 0, z: 1.15 }],
    facing: Math.PI,
    zone: "operations",
  },
  ops: {
    id: "ops",
    label: "Ops Console",
    slots: [{ x: -8.25, z: -0.03 }],
    facing: Math.PI,
    zone: "research",
  },
  research: {
    id: "research",
    label: "Research Station",
    slots: [{ x: -10, z: -3.83 }],
    facing: Math.PI,
    zone: "research",
  },
  product: {
    id: "product",
    label: "Product Station",
    slots: [{ x: -6.5, z: -3.83 }],
    facing: Math.PI,
    zone: "research",
  },
  dev: {
    id: "dev",
    label: "Engineering Station",
    slots: [{ x: 6.5, z: -3.83 }],
    facing: Math.PI,
    zone: "development",
  },
  testing: {
    id: "testing",
    label: "QA Lab",
    slots: [{ x: 10, z: -3.83 }],
    facing: Math.PI,
    zone: "development",
  },
  review: {
    id: "review",
    label: "Review Station",
    slots: [{ x: 8.25, z: -0.03 }],
    facing: Math.PI,
    zone: "development",
  },
  planning: {
    id: "planning",
    label: "Planning Board",
    slots: [
      { x: -11.4, z: 4.2 },
      { x: -11, z: 5.6 },
    ],
    facing: -Math.PI / 2,
    zone: "collaboration",
  },
  collab: {
    id: "collab",
    label: "Collaboration Table",
    slots: ring(COLLAB_CENTER, 1.75),
    facing: "inward",
    center: COLLAB_CENTER,
    zone: "collaboration",
  },
  lounge: {
    id: "lounge",
    label: "Meeting Lounge",
    slots: ring(LOUNGE_CENTER, 2.1),
    facing: "inward",
    center: LOUNGE_CENTER,
    zone: "collaboration",
  },
};

export const LOCATION_IDS: readonly LocationId[] = [
  "hub",
  "ops",
  "research",
  "product",
  "dev",
  "testing",
  "review",
  "planning",
  "collab",
  "lounge",
];

export function isLocationId(value: string): value is LocationId {
  return (LOCATION_IDS as readonly string[]).includes(value);
}

export function slotFor(location: LocationId, seatIndex: number): Vec2 {
  const slots = LOCATIONS[location].slots;
  const index = ((seatIndex % slots.length) + slots.length) % slots.length;
  return slots[index];
}

/** Radians the agent should face when standing on a slot. */
export function headingFor(location: LocationId, seatIndex: number): number {
  const entry = LOCATIONS[location];
  if (typeof entry.facing === "number") return entry.facing;
  const slot = slotFor(location, seatIndex);
  const center = entry.center ?? slot;
  return Math.atan2(center.x - slot.x, center.z - slot.z);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Route through the corridor band: out to CORRIDOR_Z, along x, then in to the
 * destination. Avoids cutting through desks on both sides of the floor.
 */
export function route(from: Vec2, to: Vec2): Vec2[] {
  const points: Vec2[] = [];
  const push = (point: Vec2): void => {
    const last = points.length > 0 ? points[points.length - 1] : from;
    if (distance(last, point) < 0.03) return;
    points.push({ x: round(point.x), z: round(point.z) });
  };

  push({ x: from.x, z: CORRIDOR_Z });
  push({ x: to.x, z: CORRIDOR_Z });
  push({ x: to.x, z: to.z });
  return points;
}

export function pathLength(points: readonly Vec2[], from?: Vec2): number {
  let total = 0;
  let previous = from ?? points[0];
  const startIndex = from ? 0 : 1;
  for (let index = startIndex; index < points.length; index += 1) {
    total += distance(previous, points[index]);
    previous = points[index];
  }
  return total;
}

export type StationId =
  | "ops"
  | "research"
  | "product"
  | "dev"
  | "testing"
  | "review";

export interface Station {
  id: StationId;
  label: string;
  /** Desk position, 1.12 m behind the stand slot so typing hands reach. */
  position: Vec2;
  /** Desk rotation in radians (0: monitor faces +z). */
  rotation: number;
}

/** Desk owner map, shared by the 3D desks and the panel. */
export const STATION_OWNERS: Record<StationId, AgentId> = {
  ops: "orion",
  research: "iris",
  product: "piper",
  dev: "kai",
  testing: "quinn",
  review: "rex",
};

export const STATIONS: readonly Station[] = [
  {
    id: "ops",
    label: "Ops Console",
    position: { x: -8.25, z: -1.15 },
    rotation: 0,
  },
  {
    id: "research",
    label: "Research Station",
    position: { x: -10, z: -4.95 },
    rotation: 0,
  },
  {
    id: "product",
    label: "Product Station",
    position: { x: -6.5, z: -4.95 },
    rotation: 0,
  },
  {
    id: "dev",
    label: "Engineering Station",
    position: { x: 6.5, z: -4.95 },
    rotation: 0,
  },
  {
    id: "testing",
    label: "QA Lab",
    position: { x: 10, z: -4.95 },
    rotation: 0,
  },
  {
    id: "review",
    label: "Review Station",
    position: { x: 8.25, z: -1.15 },
    rotation: 0,
  },
];

export function stationForAgent(agentId: AgentId): Station | undefined {
  return STATIONS.find((station) => STATION_OWNERS[station.id] === agentId);
}
