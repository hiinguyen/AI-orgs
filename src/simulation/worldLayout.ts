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
  | "mission"
  | "planning"
  | "collab"
  | "lounge"
  | "dispatch";

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
/**
 * Control console between the wall and the room. The two stand slots sit off
 * the centre line so the walk from the corridor never passes through the
 * Operations Hub, and Piper reaches the console without stepping over it.
 */
export const MISSION_CONSOLE: Vec2 = { x: 0, z: -6.55 };
export const MISSION_STAND_SLOTS: readonly Vec2[] = [
  { x: -2.2, z: -5.35 },
  { x: 2.2, z: -5.35 },
];
/** Angled whiteboard in the collaboration corner, clear of the walking corridor. */
export const PLANNING_BOARD_CENTER: Vec2 = { x: -10.8, z: 5.1 };

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

/**
 * Dispatch Floor bays. Four columns by three rows in the open foreground
 * between the collaboration ring and the lounge, clear of both rings, the
 * corridor at z 2.8, the planning board, every core desk and the side walls.
 *
 * Bay cells are compact: a stand slot with a 0.9 m deep desk in front of it
 * (towards -z, matching the core stations' facing).
 */
export const BAY_COUNT = 12;
export const BAY_COLUMNS = 4;
const BAY_FIRST_X = -1.2;
const BAY_FIRST_Z = 8.0;
const BAY_PITCH_X = 1.8;
const BAY_PITCH_Z = 1.5;
const BAY_DESK_OFFSET_Z = 0.8;

function buildBayStands(): Vec2[] {
  const stands: Vec2[] = [];
  for (let row = 0; row < BAY_COUNT / BAY_COLUMNS; row += 1) {
    for (let column = 0; column < BAY_COLUMNS; column += 1) {
      stands.push({
        x: round(BAY_FIRST_X + column * BAY_PITCH_X),
        z: round(BAY_FIRST_Z + row * BAY_PITCH_Z),
      });
    }
  }
  return stands;
}

export const BAY_STANDS: readonly Vec2[] = buildBayStands();
export const BAY_DESKS: readonly Vec2[] = BAY_STANDS.map((stand) => ({
  x: stand.x,
  z: round(stand.z - BAY_DESK_OFFSET_Z),
}));
export const BAY_DESK_DEPTH = 0.55;
export const BAY_DESK_WIDTH = 1.0;

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
  mission: {
    id: "mission",
    label: "Mission Control",
    slots: MISSION_STAND_SLOTS,
    facing: Math.PI,
    zone: "operations",
  },
  planning: {
    id: "planning",
    label: "Planning Board",
    slots: [
      { x: -9.14, z: 5.06 },
      { x: -10.08, z: 6.6 },
    ],
    facing: -2.15,
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
  dispatch: {
    id: "dispatch",
    label: "Dispatch Floor",
    slots: BAY_STANDS,
    facing: Math.PI,
    zone: "operations",
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
  "mission",
  "planning",
  "collab",
  "lounge",
  "dispatch",
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
