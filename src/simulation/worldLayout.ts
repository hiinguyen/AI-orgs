import type { AgentId, Vec2 } from "../agents/agentTypes.ts";
import { getAgentProfile } from "../agents/AgentRegistry.ts";

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
  | "researchBoard"
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
/** Angled whiteboard in the collaboration corner, clear of the walking corridor. */
export const PLANNING_BOARD_CENTER: Vec2 = { x: -10.8, z: 5.5 };
/** Board group rotations around Y; the research board is the mirror image. */
export const PLANNING_BOARD_ROTATION = -0.55;
export const RESEARCH_BOARD_ROTATION = Math.PI - PLANNING_BOARD_ROTATION;
/**
 * Research board on the east side, facing the room like the planning board
 * does, mirroring its geometry. It sits near the centre-right so the
 * researcher's walk keeps the demo under its time budget.
 */
export const RESEARCH_BOARD_CENTER: Vec2 = { x: 7.4, z: 5.5 };

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One stand slot per agent seat, in a row in front of each board. */
const BOARD_SEATS = 6;
const BOARD_SLOT_PITCH = 0.7;
const BOARD_SLOT_DISTANCE = 1.7;
/**
 * Distance in front of the board face where the corridor entry point lies, so
 * the walk in to a slot never runs along the row past other agents.
 */
const BOARD_APPROACH_ALONG = 2.4;
/** The last leg into a slot runs straight in from this far in front. */
const BOARD_FRONT_STEP = 1.0;
/** Seats that do the board's phase work (Piper plans, Iris researches). */
const PLANNING_WORK_SEAT = getAgentProfile("piper").seat;
const RESEARCH_WORK_SEAT = getAgentProfile("iris").seat;

/**
 * Stand slots in a row parallel to the board face, centred on the board and
 * BOARD_SLOT_DISTANCE in front of it, plus the heading that faces the board.
 */
function boardRow(
  center: Vec2,
  rotation: number,
  corridorEntry: Vec2,
  workSeat: number,
): { slots: Vec2[]; facing: number } {
  const normal = { x: Math.cos(rotation), z: -Math.sin(rotation) };
  const tangent = { x: Math.sin(rotation), z: Math.cos(rotation) };
  const slots: Vec2[] = [];
  for (let index = 0; index < BOARD_SEATS; index += 1) {
    const along = (index - (BOARD_SEATS - 1) / 2) * BOARD_SLOT_PITCH;
    slots.push({
      x: round(center.x + normal.x * BOARD_SLOT_DISTANCE + tangent.x * along),
      z: round(center.z + normal.z * BOARD_SLOT_DISTANCE + tangent.z * along),
    });
  }
  // The seat that works at the board takes the slot nearest the corridor
  // entry; slot index stays the seat, only the row positions are permuted.
  let nearest = 0;
  for (let index = 1; index < slots.length; index += 1) {
    if (distance(slots[index], corridorEntry) < distance(slots[nearest], corridorEntry)) {
      nearest = index;
    }
  }
  const swapped = slots[workSeat];
  slots[workSeat] = slots[nearest];
  slots[nearest] = swapped;
  return { slots, facing: round(Math.atan2(-normal.x, -normal.z)) };
}

/** Corridor point whose distance in front of the board face is BOARD_APPROACH_ALONG. */
function boardCorridorEntry(center: Vec2, rotation: number): Vec2 {
  const x =
    center.x +
    (BOARD_APPROACH_ALONG - -Math.sin(rotation) * (CORRIDOR_Z - center.z)) /
      Math.cos(rotation);
  return { x: round(x), z: CORRIDOR_Z };
}

function ring(
  center: Vec2,
  radius: number,
  count = 6,
  startAngle = 0,
): Vec2[] {
  const slots: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = startAngle + (index / count) * Math.PI * 2;
    slots.push({
      x: round(center.x + Math.sin(angle) * radius),
      z: round(center.z + Math.cos(angle) * radius),
    });
  }
  return slots;
}

const COLLAB_CENTER: Vec2 = { x: -5, z: 5.6 };
export const PLANNING_CORRIDOR_ENTRY = boardCorridorEntry(
  PLANNING_BOARD_CENTER,
  PLANNING_BOARD_ROTATION,
);
export const RESEARCH_CORRIDOR_ENTRY = boardCorridorEntry(
  RESEARCH_BOARD_CENTER,
  RESEARCH_BOARD_ROTATION,
);
const PLANNING_ROW = boardRow(
  PLANNING_BOARD_CENTER,
  PLANNING_BOARD_ROTATION,
  PLANNING_CORRIDOR_ENTRY,
  PLANNING_WORK_SEAT,
);
const RESEARCH_ROW = boardRow(
  RESEARCH_BOARD_CENTER,
  RESEARCH_BOARD_ROTATION,
  RESEARCH_CORRIDOR_ENTRY,
  RESEARCH_WORK_SEAT,
);

/**
 * Dispatch Floor bays. Four columns by three rows in the open foreground
 * between the collaboration ring and the research board, clear of the ring, the
 * corridor at z 2.8, both boards, every core desk and the side walls.
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
  planning: {
    id: "planning",
    label: "Planning Board",
    slots: PLANNING_ROW.slots,
    facing: PLANNING_ROW.facing,
    zone: "collaboration",
  },
  collab: {
    id: "collab",
    label: "Collaboration Table",
    // Seat 0 starts on the corridor side, so the first seats are the nearest.
    slots: ring(COLLAB_CENTER, 1.75, 6, Math.PI),
    facing: "inward",
    center: COLLAB_CENTER,
    zone: "collaboration",
  },
  researchBoard: {
    id: "researchBoard",
    label: "Research Board",
    slots: RESEARCH_ROW.slots,
    facing: RESEARCH_ROW.facing,
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
  "planning",
  "collab",
  "researchBoard",
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
 * Corridor point where a walk to or from a board slot leaves the corridor.
 * The corridor end straight above a slot can sit behind the board panel, so
 * board walks use a corridor point in front of the face and go diagonally
 * to the slot. Offsets are relative to the board centre (x mirrored).
 */
const BOARDS_WITH_APPROACH: readonly {
  location: LocationId;
  corridorX: number;
  rotation: number;
}[] = [
  {
    location: "planning",
    corridorX: PLANNING_CORRIDOR_ENTRY.x,
    rotation: PLANNING_BOARD_ROTATION,
  },
  {
    location: "researchBoard",
    corridorX: RESEARCH_CORRIDOR_ENTRY.x,
    rotation: RESEARCH_BOARD_ROTATION,
  },
];

/**
 * Waypoints (corridor point first, slot excluded) for a board slot: the
 * corridor point in front of the face, then a point straight in front of the
 * slot, so the last leg never runs along the row past other agents.
 */
function boardApproach(point: Vec2): Vec2[] | null {
  for (const board of BOARDS_WITH_APPROACH) {
    const isSlot = LOCATIONS[board.location].slots.some(
      (slot) => distance(slot, point) < 0.05,
    );
    if (!isSlot) continue;
    return [
      { x: board.corridorX, z: CORRIDOR_Z },
      {
        x: point.x + Math.cos(board.rotation) * BOARD_FRONT_STEP,
        z: point.z - Math.sin(board.rotation) * BOARD_FRONT_STEP,
      },
    ];
  }
  return null;
}

/** Collaboration table top radius plus the clearance a walker keeps. */
const TABLE_RADIUS = 1.05;
const TABLE_CLEARANCE = 0.4;
/** The detour column runs this far to the side of the table centre. */
const TABLE_DETOUR_X = 2.45;
/** Radial distance past the ring where the detour turns in to a slot. */
const TABLE_DETOUR_OUTSET = 0.8;

function nearestOnSegment(a: Vec2, b: Vec2, point: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared),
        );
  return distance({ x: a.x + dx * t, z: a.z + dz * t }, point);
}

/**
 * Waypoints (corridor first, slot excluded) for a collab slot whose straight
 * walk from the corridor would cut through the table: down a column beside
 * the ring (on the side of `other`, the far end of the walk), then radially
 * in from outside. Null when the direct walk is clear.
 */
function collabDetour(point: Vec2, other: Vec2): Vec2[] | null {
  const collab = LOCATIONS.collab;
  const center = collab.center;
  if (center === undefined) return null;
  if (!collab.slots.some((slot) => distance(slot, point) < 0.05)) return null;
  const entry = { x: point.x, z: CORRIDOR_Z };
  if (nearestOnSegment(entry, point, center) > TABLE_RADIUS + TABLE_CLEARANCE) {
    return null;
  }
  const radius = distance(point, center);
  const scale = (radius + TABLE_DETOUR_OUTSET) / radius;
  const outer = {
    x: center.x + (point.x - center.x) * scale,
    z: center.z + (point.z - center.z) * scale,
  };
  const columnX = center.x + (other.x >= center.x ? TABLE_DETOUR_X : -TABLE_DETOUR_X);
  return [
    { x: columnX, z: CORRIDOR_Z },
    { x: columnX, z: outer.z },
    outer,
  ];
}

/**
 * Route through the corridor band: out to CORRIDOR_Z, along x, then in to the
 * destination. Avoids cutting through desks on both sides of the floor.
 * Walks to and from a board slot use that board's front corridor point, and
 * walks to and from a collab slot behind the table go around it.
 */
export function route(from: Vec2, to: Vec2): Vec2[] {
  const points: Vec2[] = [];
  const push = (point: Vec2): void => {
    const last = points.length > 0 ? points[points.length - 1] : from;
    if (distance(last, point) < 0.03) return;
    points.push({ x: round(point.x), z: round(point.z) });
  };

  const leaving = collabDetour(from, to);
  if (leaving !== null) {
    for (let index = leaving.length - 1; index >= 0; index -= 1) {
      push(leaving[index]);
    }
  } else {
    const boardLeave = boardApproach(from);
    if (boardLeave === null) {
      push({ x: from.x, z: CORRIDOR_Z });
    } else {
      for (let index = boardLeave.length - 1; index >= 0; index -= 1) {
        push(boardLeave[index]);
      }
    }
  }

  const arriving = collabDetour(to, from);
  if (arriving !== null) {
    for (const point of arriving) push(point);
  } else {
    const boardArrive = boardApproach(to);
    if (boardArrive === null) {
      push({ x: to.x, z: CORRIDOR_Z });
    } else {
      for (const point of boardArrive) push(point);
    }
  }
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
