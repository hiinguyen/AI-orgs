/**
 * Board location and route checks: stand slots, walk footprints, the collab
 * table, ambient overlap, and interrupted planning or research. Headless, run
 * against the pure layout modules and the engine.
 */
import type { Vec2 } from "../../src/agents/agentTypes.ts";
import { CORE_AGENTS, getAgentProfile } from "../../src/agents/AgentRegistry.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import { matchWorkTemplate } from "../../src/simulation/workContent.ts";
import {
  CORRIDOR_Z,
  FLOOR,
  LOCATIONS,
  LOCATION_IDS,
  PLANNING_BOARD_CENTER,
  PLANNING_CORRIDOR_ENTRY,
  RESEARCH_BOARD_CENTER,
  RESEARCH_CORRIDOR_ENTRY,
  STATIONS,
  BAY_DESKS,
  BAY_DESK_DEPTH,
  BAY_DESK_WIDTH,
  distance,
  headingFor,
  route,
} from "../../src/simulation/worldLayout.ts";
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import type { WorkflowPhase } from "../../src/tasks/taskTypes.ts";
import {
  BOARD_FACE_FRONT,
  BOARD_FEET_DEPTH,
  PLANNING_BOARD_FRAME_WIDTH,
  PLANNING_BOARD_NORMAL,
  PLANNING_BOARD_TANGENT,
  planningCards,
  planningStatus,
} from "../../src/world/planningContent.ts";
import {
  RESEARCH_BOARD,
  RESEARCH_BOARD_FACE_OFFSET,
  RESEARCH_BOARD_FRAME_WIDTH,
  RESEARCH_BOARD_NORMAL,
  RESEARCH_BOARD_TANGENT,
  researchView,
} from "../../src/world/researchContent.ts";
import { harness } from "./harness.ts";
import type { TestReporter } from "./harness.ts";
import { makeTask } from "./boards.ts";
function runLocationChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const slots = LOCATIONS.researchBoard.slots;
  const halfWidth = RESEARCH_BOARD.width / 2;
  const offsets = slots.map((slot, seat) => {
    const dx = slot.x - RESEARCH_BOARD_CENTER.x;
    const dz = slot.z - RESEARCH_BOARD_CENTER.z;
    const heading = headingFor("researchBoard", seat);
    return {
      normal:
        dx * RESEARCH_BOARD_NORMAL.x +
        dz * RESEARCH_BOARD_NORMAL.z -
        RESEARCH_BOARD_FACE_OFFSET,
      tangent: dx * RESEARCH_BOARD_TANGENT.x + dz * RESEARCH_BOARD_TANGENT.z,
      facing:
        Math.sin(heading) * RESEARCH_BOARD_NORMAL.x +
        Math.cos(heading) * RESEARCH_BOARD_NORMAL.z,
    };
  });
  check(
    "each board has one stand slot per agent seat",
    slots.length === CORE_AGENTS.length &&
      LOCATIONS.planning.slots.length === CORE_AGENTS.length &&
      CORE_AGENTS.every((agent) => agent.seat < slots.length),
  );
  check(
    "slot index is the seat, so no two seats share a board spot",
    LOCATIONS.planning.slots.concat(slots).every((slot, index, all) =>
      all.every(
        (other, otherIndex) =>
          index === otherIndex || distance(slot, other) > 0.6,
      ),
    ),
  );
  check(
    "research slots stand in front of the board face",
    offsets.every((offset) => offset.normal > 0.5),
  );
  check(
    "research slots stay within the board width",
    offsets.every((offset) => Math.abs(offset.tangent) <= halfWidth),
  );
  check(
    "research slots face the board",
    offsets.every((offset) => offset.facing <= -0.999),
    offsets.map((offset) => offset.facing.toFixed(4)).join(","),
  );
  const others = LOCATION_IDS.filter((id) => id !== "researchBoard");
  const clear = (point: Vec2): boolean =>
    others.every((id) =>
      LOCATIONS[id].slots.every((other) => distance(point, other) > 0.9),
    ) &&
    BAY_DESKS.every(
      (desk) =>
        Math.abs(point.x - desk.x) > BAY_DESK_WIDTH / 2 + 0.4 ||
        Math.abs(point.z - desk.z) > BAY_DESK_DEPTH / 2 + 0.4,
    ) &&
    STATIONS.every((station) => distance(point, station.position) > 1.6);
  check("research slots are clear of other slots, bays and desks", slots.every(clear));
  check(
    "the research board stays inside the floor",
    slots.every(
      (slot) =>
        slot.x > FLOOR.minX &&
        slot.x < FLOOR.maxX &&
        slot.z > CORRIDOR_Z &&
        slot.z < FLOOR.maxZ,
    ) &&
      RESEARCH_BOARD_CENTER.x + halfWidth < FLOOR.maxX,
  );
  check(
    "there is no lounge location any more",
    !(LOCATION_IDS as readonly string[]).includes("lounge"),
  );
}

function runChoreographyLocationChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine } = harness();
  engine.start();
  engine.submitTask(DEMO_TASK);
  const seen = new Map<WorkflowPhase, Set<string>>();
  const cardCounts = new Set<number>();
  const findingCounts = new Set<number>();
  for (let tick = 0; tick < 4000; tick += 1) {
    engine.tick(TICK_SECONDS);
    const snapshot = engine.snapshot();
    for (const agent of snapshot.agents) {
      if (agent.status !== "working" || agent.location === null) continue;
      const task = snapshot.tasks[0];
      if (!task) continue;
      const set = seen.get(task.phase) ?? new Set<string>();
      set.add(`${agent.id}@${agent.location}`);
      seen.set(task.phase, set);
    }
    const shown = snapshot.tasks[0];
    if (shown?.phase === "planning") cardCounts.add(shown.subtasks.length);
    if (shown?.phase === "research") findingCounts.add(shown.findings.length);
    if (shown?.phase === "done") break;
  }
  check(
    "sprint cards appear one by one while planning",
    cardCounts.size >= 6 && cardCounts.has(1) && cardCounts.has(6),
    [...cardCounts].join(","),
  );
  check(
    "findings appear one by one while researching",
    findingCounts.has(1) && findingCounts.has(3),
    [...findingCounts].join(","),
  );
  check(
    "planning work happens at the sprint planning board",
    seen.get("planning")?.has("piper@planning") === true,
    [...(seen.get("planning") ?? [])].join(","),
  );
  check(
    "research work happens at the research board",
    seen.get("research")?.has("iris@researchBoard") === true,
    [...(seen.get("research") ?? [])].join(","),
  );
}

/** Real board geometry: frame width, feet behind the panel, front of cards. */
const TABLE_RADIUS = 1.05;

function runSlotSpacingChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const rows = [LOCATIONS.planning.slots, LOCATIONS.researchBoard.slots];
  const origins: Vec2[] = [];
  for (const id of LOCATION_IDS) origins.push(...LOCATIONS[id].slots);
  for (const station of STATIONS) origins.push(station.position);

  const tooClose: string[] = [];
  for (const row of rows) {
    for (const slot of row) {
      const others = row.filter((other) => other !== slot);
      for (const origin of origins) {
        if (row.includes(origin)) continue;
        const walks: [Vec2, Vec2][] = [
          [origin, slot],
          [slot, origin],
        ];
        for (const [start, end] of walks) {
          const path = [start, ...route(start, end)];
          for (let index = 1; index < path.length; index += 1) {
            const a = path[index - 1];
            const b = path[index];
            const steps = Math.max(1, Math.ceil(distance(a, b) / 0.05));
            for (let step = 0; step <= steps; step += 1) {
              const point = {
                x: a.x + ((b.x - a.x) * step) / steps,
                z: a.z + ((b.z - a.z) * step) / steps,
              };
              if (others.some((other) => distance(point, other) < 0.4)) {
                tooClose.push(`${slot.x},${slot.z}`);
              }
            }
          }
        }
      }
    }
  }
  check(
    "walks into or out of a board slot keep 0.4 m from the other slots",
    tooClose.length === 0,
    `${tooClose.length} samples, e.g. ${tooClose[0] ?? "none"}`,
  );
  check(
    "the working seat takes the board slot nearest the corridor entry",
    [
      { name: "planning" as const, seat: getAgentProfile("piper").seat },
      { name: "researchBoard" as const, seat: getAgentProfile("iris").seat },
    ].every(({ name, seat }) => {
      const slots = LOCATIONS[name].slots;
      const entry =
        name === "planning" ? PLANNING_CORRIDOR_ENTRY : RESEARCH_CORRIDOR_ENTRY;
      return slots.every(
        (other) => distance(slots[seat], entry) <= distance(other, entry) + 1e-9,
      );
    }),
  );
}

function runDeskClearanceChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const clearance = 0.3;
  const desks = [
    ...BAY_DESKS.map((desk) => ({
      ...desk,
      halfX: BAY_DESK_WIDTH / 2,
      halfZ: BAY_DESK_DEPTH / 2,
    })),
    ...STATIONS.map((station) => ({
      ...station.position,
      halfX: 1.3,
      halfZ: 0.575,
    })),
  ];
  const gap = (point: Vec2, desk: (typeof desks)[number]): number =>
    Math.hypot(
      Math.max(0, Math.abs(point.x - desk.x) - desk.halfX),
      Math.max(0, Math.abs(point.z - desk.z) - desk.halfZ),
    );
  // Bay walkers leave by their own column route, so dispatch is not an origin.
  const origins: Vec2[] = [];
  for (const id of LOCATION_IDS) {
    if (id !== "dispatch") origins.push(...LOCATIONS[id].slots);
  }

  const boardSlots = [
    ...LOCATIONS.planning.slots,
    ...LOCATIONS.researchBoard.slots,
  ];
  const hits: string[] = [];
  for (const slot of boardSlots) {
    const slotGap = Math.min(...desks.map((desk) => gap(slot, desk)));
    if (slotGap < clearance) hits.push(`slot ${slot.x},${slot.z}`);
    for (const origin of origins) {
      if (boardSlots.includes(origin)) continue;
      // The walker's own desk is the one nearest its start slot.
      const own = desks.reduce((best, desk) =>
        distance(origin, desk) < distance(origin, best) ? desk : best,
      );
      const others = desks.filter((desk) => desk !== own);
      const walks: [Vec2, Vec2][] = [
        [origin, slot],
        [slot, origin],
      ];
      for (const [start, end] of walks) {
        const path = [start, ...route(start, end)];
        for (let index = 1; index < path.length; index += 1) {
          const a = path[index - 1];
          const b = path[index];
          const steps = Math.max(1, Math.ceil(distance(a, b) / 0.05));
          for (let step = 0; step <= steps; step += 1) {
            const point = {
              x: a.x + ((b.x - a.x) * step) / steps,
              z: a.z + ((b.z - a.z) * step) / steps,
            };
            if (others.some((desk) => gap(point, desk) < clearance)) {
              hits.push(`${origin.x},${origin.z}->${slot.x},${slot.z}`);
              step = steps;
              index = path.length;
            }
          }
        }
      }
    }
  }
  check(
    "walks to and from board slots keep 0.3 m from every desk but their own",
    hits.length === 0,
    `${hits.length} hits, e.g. ${hits[0] ?? "none"}`,
  );
}

function runRouteFootprintChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const margin = 0.3;
  const boards = [
    {
      name: "sprint",
      location: "planning" as const,
      center: PLANNING_BOARD_CENTER,
      normal: PLANNING_BOARD_NORMAL,
      tangent: PLANNING_BOARD_TANGENT,
      halfWidth: PLANNING_BOARD_FRAME_WIDTH / 2,
    },
    {
      name: "research",
      location: "researchBoard" as const,
      center: RESEARCH_BOARD_CENTER,
      normal: RESEARCH_BOARD_NORMAL,
      tangent: RESEARCH_BOARD_TANGENT,
      halfWidth: RESEARCH_BOARD_FRAME_WIDTH / 2,
    },
  ];
  const insideFootprint = (
    board: (typeof boards)[number],
    point: Vec2,
  ): boolean => {
    const dx = point.x - board.center.x;
    const dz = point.z - board.center.z;
    const along = dx * board.normal.x + dz * board.normal.z;
    const across = dx * board.tangent.x + dz * board.tangent.z;
    return (
      along > -BOARD_FEET_DEPTH - margin &&
      along < BOARD_FACE_FRONT + margin &&
      Math.abs(across) < board.halfWidth + margin
    );
  };
  const crossesBoard = (from: Vec2, to: Vec2): string | null => {
    const points = [from, ...route(from, to)];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const steps = Math.max(1, Math.ceil(distance(a, b) / 0.05));
      for (let step = 0; step <= steps; step += 1) {
        const point = {
          x: a.x + ((b.x - a.x) * step) / steps,
          z: a.z + ((b.z - a.z) * step) / steps,
        };
        for (const board of boards) {
          if (insideFootprint(board, point)) return board.name;
        }
      }
    }
    return null;
  };

  const origins: Vec2[] = [];
  for (const id of LOCATION_IDS) origins.push(...LOCATIONS[id].slots);
  for (const station of STATIONS) origins.push(station.position);

  const table = LOCATIONS.collab.center ?? { x: -5, z: 5.6 };
  const crossesTable = (from: Vec2, to: Vec2): boolean => {
    const points = [from, ...route(from, to)];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const steps = Math.max(1, Math.ceil(distance(a, b) / 0.05));
      for (let step = 0; step <= steps; step += 1) {
        const point = {
          x: a.x + ((b.x - a.x) * step) / steps,
          z: a.z + ((b.z - a.z) * step) / steps,
        };
        if (distance(point, table) < TABLE_RADIUS + margin) return true;
      }
    }
    return false;
  };
  const tableHits = LOCATIONS.collab.slots.flatMap((slot) =>
    origins.filter(
      (origin) => crossesTable(origin, slot) || crossesTable(slot, origin),
    ),
  );
  check(
    "walks to and from every collab slot go around the table",
    tableHits.length === 0,
    `${tableHits.length} crossings`,
  );

  for (const board of boards) {
    const boardSlots = LOCATIONS[board.location].slots;
    const hits: string[] = [];
    for (const slot of boardSlots) {
      for (const origin of origins) {
        const into = crossesBoard(origin, slot);
        if (into !== null) hits.push(`to ${board.location}:${into}@${origin.x},${origin.z}`);
        const out = crossesBoard(slot, origin);
        if (out !== null) hits.push(`from ${board.location}:${out}`);
      }
    }
    check(
      `walks to and from the ${board.name} board never enter its footprint`,
      hits.length === 0,
      `${hits.length} crossings ${hits.slice(0, 2).join(" ")}`,
    );
  }
}

function runAmbientOverlapChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const { engine } = harness();
  engine.start();
  let restingOverlaps = 0;
  let sawWander = false;
  const steps = Math.round(1200 / TICK_SECONDS);
  for (let step = 0; step < steps; step += 1) {
    engine.tick(TICK_SECONDS);
    if (step % 15 !== 0) continue;
    const resting = engine
      .snapshot()
      .agents.filter(
        (agent) =>
          agent.path.length === 0 &&
          (agent.status === "idle" || /Taking a moment/.test(agent.activity)),
      );
    if (resting.some((agent) => /Taking a moment/.test(agent.activity))) {
      sawWander = true;
    }
    for (let a = 0; a < resting.length; a += 1) {
      for (let b = a + 1; b < resting.length; b += 1) {
        if (distance(resting[a].position, resting[b].position) < 0.5) {
          restingOverlaps += 1;
        }
      }
    }
  }
  check(
    "ambient wander never stacks two resting agents on one spot over 1200 s",
    sawWander && restingOverlaps === 0,
    `${restingOverlaps} overlapping samples, wander seen: ${sawWander}`,
  );
}

function runInterruptChecks(reporter: TestReporter): void {
  const { check } = reporter;
  const template = matchWorkTemplate(
    `${DEMO_TASK.title} ${DEMO_TASK.description ?? ""}`,
  );
  const { engine } = harness();
  engine.start();
  const created = engine.submitTask(DEMO_TASK);
  let prefixHolds = true;
  let sawPartial = false;
  for (let tick = 0; tick < 4000; tick += 1) {
    engine.tick(TICK_SECONDS);
    const task = engine.getTask(created.id);
    if (task === null) break;
    const titles = task.subtasks.map((subtask) => subtask.title);
    if (!titles.every((title, index) => title === template.subtasks[index])) {
      prefixHolds = false;
    }
    if (
      task.findings.some((finding, index) => finding !== template.findings[index])
    ) {
      prefixHolds = false;
    }
    if (task.phase === "planning" && titles.length > 1 && titles.length < 6) {
      sawPartial = true;
      break;
    }
  }
  check(
    "revealed subtasks and findings are always a prefix of the template",
    prefixHolds && sawPartial,
  );
  engine.reset();
  const snapshot = engine.snapshot();
  check(
    "a reset mid-planning clears the cards and both board views",
    snapshot.tasks.length === 0 &&
      planningCards(snapshot.tasks).length === 0 &&
      planningStatus(snapshot.tasks) === null &&
      researchView(snapshot.tasks).rows.length === 0,
  );
  // A task that fails after partial work keeps exactly what was revealed.
  const failedMidResearch = makeTask("T-F", "failed", "high", 5, {
    findings: template.findings.slice(0, 2),
    completedAt: 9,
  });
  const failedView = researchView([failedMidResearch]);
  check(
    "a failed task keeps its partial findings, not researching, as a prefix",
    failedView.rows.length === 2 &&
      !failedView.researching &&
      failedView.rows.every((row, index) => row.text === template.findings[index]),
  );
}

export function runBoardRoutesSuite(reporter: TestReporter): void {
  reporter.group("8b. Board locations and routes");
  runLocationChecks(reporter);
  runSlotSpacingChecks(reporter);
  runRouteFootprintChecks(reporter);
  runDeskClearanceChecks(reporter);
  runChoreographyLocationChecks(reporter);
  runAmbientOverlapChecks(reporter);
  runInterruptChecks(reporter);
}
