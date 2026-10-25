/**
 * Phase 9 checks: the dynamic agent set. Bay allocation and geometry, profile
 * validation, total lookups for unknown ids, deterministic live colours and
 * pitches, plus a real WebSocket round trip against the fake live server.
 */
import type {
  AgentId,
  AgentProfile,
  AgentRole,
  AgentState,
  AgentStatus,
  Vec2,
} from "../../src/agents/agentTypes.ts";
import {
  CORE_AGENT_IDS,
  MAX_LIVE_AGENTS,
  isAgentId,
  normaliseAgentRole,
} from "../../src/agents/agentTypes.ts";
import {
  agentName,
  getAgentProfile,
  setAnnouncedProfiles,
} from "../../src/agents/AgentRegistry.ts";
import {
  CORE_AGENT_COLORS,
  LIVE_AGENT_PALETTE,
  colorForAgent,
  liveColorIndex,
} from "../../src/agents/agentPalette.ts";
import { rigFor } from "../../src/agents/agentRigs.ts";
import { AgentSlotAllocator } from "../../src/agents/agentSlots.ts";
import type { AgentEvent } from "../../src/events/eventTypes.ts";
import type { WorldSnapshot } from "../../src/integrations/AgentBackend.ts";
import { WebSocketAgentBackend } from "../../src/integrations/WebSocketAgentBackend.ts";
import {
  parseAgentEvent,
  parseAgentProfile,
  parseServerMessage,
  parseWorldSnapshot,
} from "../../src/integrations/wsProtocol.ts";
import { profileFor, useWorldStore } from "../../src/state/useWorldStore.ts";
import { SimulationEngine } from "../../src/simulation/SimulationEngine.ts";
import {
  WAITING_LOCATION,
  allocateBay,
  bayAt,
  bayDesk,
  bayStand,
  routeToBay,
} from "../../src/simulation/bays.ts";
import {
  BAY_COUNT,
  BAY_DESK_DEPTH,
  BAY_DESK_WIDTH,
  BAY_DESKS,
  BAY_STANDS,
  CORRIDOR_Z,
  FLOOR,
  LOCATIONS,
  STATIONS,
  distance,
} from "../../src/simulation/worldLayout.ts";
import {
  LIVE_SPEAKER_PITCHES,
  speakerPitch,
} from "../../src/audio/soundCues.ts";
import { startFakeLiveServer } from "../fake-live-server.ts";
import type { TestReporter } from "./harness.ts";

const CORE_COLORS = CORE_AGENT_COLORS.map((entry) => entry.color);

function makeLiveProfile(index: number): AgentProfile {
  return {
    id: `live-${index}`,
    name: `live-agent #${index}`,
    role: "engineer",
    roleLabel: "Software Engineer",
    tagline: "A live subagent",
    color: colorForAgent(`live-${index}`),
    seat: index % 6,
    kind: "live",
  };
}

function makeLiveState(index: number): AgentState {
  return {
    id: `live-${index}`,
    status: "idle" as AgentStatus,
    activity: "waiting",
    currentTaskId: null,
    progress: 0,
    location: "collab",
    destination: null,
    position: { x: 0, z: 8 },
    heading: 0,
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

function bayInsideFloor(point: Vec2): boolean {
  return (
    point.x >= FLOOR.minX + 0.4 &&
    point.x <= FLOOR.maxX - 0.4 &&
    point.z >= FLOOR.minZ + 0.4 &&
    point.z <= FLOOR.maxZ - 0.4
  );
}

function distanceToRing(point: Vec2, center: Vec2, radius: number): number {
  return Math.hypot(point.x - center.x, point.z - center.z) - radius;
}

function runBaySuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("20. Dispatch Floor bays");

  check(
    "allocateBay returns the lowest free index",
    allocateBay(new Set()) === 0 &&
      allocateBay(new Set([0, 2])) === 1 &&
      allocateBay(new Set([0, 1, 3])) === 2,
  );
  check(
    "allocateBay returns null when every bay is taken",
    allocateBay(new Set(Array.from({ length: BAY_COUNT }, (_, index) => index))) ===
      null,
  );
  {
    const occupied = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const last = allocateBay(occupied);
    occupied.delete(4);
    check(
      "a freed bay is reused instead of growing the floor",
      last === 11 && allocateBay(occupied) === 4,
    );
  }
  check(
    "every bay has a stand and a matching desk",
    BAY_STANDS.length === BAY_COUNT &&
      BAY_DESKS.length === BAY_COUNT &&
      BAY_STANDS.every(
        (stand, index) =>
          Math.abs(stand.x - BAY_DESKS[index].x) < 1e-6 &&
          stand.z - BAY_DESKS[index].z > 0.5,
      ),
  );
  check(
    "bay stands and desks stay inside the floor",
    BAY_STANDS.every(bayInsideFloor) && BAY_DESKS.every(bayInsideFloor),
  );
  check(
    "bay stands are clear of the corridor and the core stations",
    BAY_STANDS.every(
      (stand) =>
        Math.abs(stand.z - CORRIDOR_Z) > 1 &&
        STATIONS.every(
          (station) => distance(stand, station.position) > 1.6,
        ),
    ),
  );
  check(
    "bay stands and desks stay outside the collaboration ring",
    BAY_STANDS.concat(BAY_DESKS).every((point) => {
      const collab = LOCATIONS.collab.center ?? { x: -5, z: 5.6 };
      return distanceToRing(point, collab, 1.75) > 0.35;
    }),
  );
  check(
    "bay cells do not overlap each other",
    BAY_STANDS.every((stand, index) =>
      BAY_STANDS.every((other, otherIndex) => {
        if (index === otherIndex) return true;
        const dx = Math.abs(stand.x - other.x);
        const dz = Math.abs(stand.z - other.z);
        return dx >= BAY_DESK_WIDTH + 0.2 || dz >= BAY_DESK_DEPTH + 0.2;
      }),
    ),
  );
  check(
    "the routed walk to a bay never crosses a ring or a desk",
    BAY_STANDS.every((stand, index) => {
      const points = routeToBay({ x: 0, z: 1.15 }, index);
      const collab = LOCATIONS.collab.center ?? { x: -5, z: 5.6 };
      const clearOfRings = points.every(
        (point) => distanceToRing(point, collab, 1.75) > 0.2,
      );
      const halfWidth = BAY_DESK_WIDTH / 2 + 0.1;
      const halfDepth = BAY_DESK_DEPTH / 2 + 0.1;
      const clearOfDesks = BAY_DESKS.every((desk) =>
        points.every(
          (point) =>
            Math.abs(point.x - desk.x) > halfWidth ||
            Math.abs(point.z - desk.z) > halfDepth,
        ),
      );
      return (
        clearOfRings &&
        clearOfDesks &&
        Math.abs(points[points.length - 1].x - stand.x) < 1e-6 &&
        Math.abs(points[points.length - 1].z - stand.z) < 1e-6
      );
    }),
  );
  check(
    "bayAt maps a stand position to its bay and nothing else",
    bayAt(bayStand(5)) === 5 &&
      bayAt(bayDesk(5)) === null &&
      bayAt({ x: bayStand(5).x + 3, z: bayStand(5).z }) === null,
  );
  check(
    "bayStand and bayDesk clamp bad indices instead of throwing",
    bayStand(-1).x === BAY_STANDS[0].x &&
      bayStand(999).x === BAY_STANDS[BAY_COUNT - 1].x &&
      bayDesk(Number.NaN).z === BAY_DESKS[0].z,
  );
}

function runProfileSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("21. Dynamic agent profiles");

  const valid = parseAgentProfile({
    id: "live-42",
    name: "code-reviewer #42",
    role: "reviewer",
    roleLabel: "Code Reviewer",
    tagline: "Reviews a live change",
    color: "#FF7A1A",
    seat: 2,
    kind: "live",
  });
  check(
    "a valid live profile parses with its home left unset",
    valid !== null &&
      valid.id === "live-42" &&
      valid.kind === "live" &&
      valid.home === undefined &&
      valid.role === "reviewer" &&
      valid.color === colorForAgent("live-42"),
  );
  check(
    "malformed profiles are dropped, not thrown",
    parseAgentProfile(null) === null &&
      parseAgentProfile({ id: "", name: "x", role: "qa" }) === null &&
      parseAgentProfile({ id: "live-1", name: "", role: "qa" }) === null &&
      parseAgentProfile({
        id: "live-1",
        name: "x",
        role: "qa",
        home: "moon",
      }) === null,
  );
  check(
    "an unknown role falls back to the engineer rig",
    normaliseAgentRole("warp-drive") === "engineer" &&
      rigFor("warp-drive" as AgentRole).role === "engineer",
  );

  const engine = new SimulationEngine();
  const base = engine.snapshot();
  check(
    "the simulation publishes exactly the six core profiles",
    base.profiles.length === 6 &&
      base.profiles.every((profile) => profile.kind === "core") &&
      CORE_AGENT_IDS.every((id) =>
        base.profiles.some((profile) => profile.id === id),
      ),
  );

  const duplicate = parseWorldSnapshot({
    ...base,
    profiles: [...base.profiles, makeLiveProfile(1), makeLiveProfile(1)],
    agents: [makeLiveState(1), makeLiveState(1)],
  });
  check(
    "duplicate profiles and agents are ignored",
    duplicate !== null &&
      duplicate.profiles.filter((profile) => profile.id === "live-1").length === 1 &&
      duplicate.agents.length === 1,
  );

  const overCapProfiles = Array.from({ length: MAX_LIVE_AGENTS + 5 }, (_, index) =>
    makeLiveProfile(index + 1),
  );
  const overCapAgents = Array.from(
    { length: MAX_LIVE_AGENTS + 5 },
    (_, index) => makeLiveState(index + 1),
  );
  const capped = parseWorldSnapshot({
    ...base,
    profiles: [...base.profiles, ...overCapProfiles],
    agents: overCapAgents,
  });
  check(
    "live agents are capped at 64, extras are dropped",
    capped !== null &&
      capped.agents.filter((agent) => !CORE_AGENT_IDS.includes(agent.id)).length ===
        MAX_LIVE_AGENTS,
  );

  const malformedSnapshot = parseWorldSnapshot({
    ...base,
    profiles: [...base.profiles, { id: "bad", name: "" }],
    agents: [...base.agents, { id: "bad" }],
  });
  check(
    "an agent without an announced profile is dropped",
    malformedSnapshot !== null &&
      !malformedSnapshot.agents.some((agent) => agent.id === "bad"),
  );

  check(
    "any non-empty id is a valid agent id",
    isAgentId("live-code-reviewer-2") &&
      isAgentId("orion") &&
      !isAgentId("") &&
      !isAgentId("x".repeat(65)),
  );
}

function runLookupSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("22. Total agent lookups");

  check(
    "unknown ids never throw and always return a usable profile",
    (() => {
      try {
        const profile = getAgentProfile("nobody-announced-this");
        return (
          profile.id === "nobody-announced-this" &&
          profile.name.length > 0 &&
          profile.color.startsWith("#") &&
          agentName("another-ghost").length > 0
        );
      } catch {
        return false;
      }
    })(),
  );
  check(
    "a backend-announced live profile replaces the fallback",
    (() => {
      const profile = makeLiveProfile(9);
      setAnnouncedProfiles([profile]);
      const found = getAgentProfile(profile.id);
      return found.name === profile.name && found.kind === "live";
    })(),
  );
}

function runColorAndPitchSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("23. Live colours and speaker pitches");

  const colored = Array.from({ length: 200 }, (_, index) =>
    colorForAgent(`live-${index}`),
  );
  check(
    "live colours are deterministic from the id hash",
    colored.every(
      (color, index) => color === colorForAgent(`live-${index}`),
    ),
  );
  check(
    "the live palette has twelve distinct entries and avoids the core colours",
    LIVE_AGENT_PALETTE.length === 12 &&
      new Set(LIVE_AGENT_PALETTE).size === 12 &&
      LIVE_AGENT_PALETTE.every((color) => !CORE_COLORS.includes(color)) &&
      CORE_AGENT_IDS.every((id) => !LIVE_AGENT_PALETTE.includes(colorForAgent(id))),
  );
  check(
    "the hash picks a stable palette index in range",
    colored.every(
      (color) => LIVE_AGENT_PALETTE.includes(color),
    ) && liveColorIndex("live-7") === liveColorIndex("live-7"),
  );

  const pitches = Array.from({ length: 64 }, (_, index) =>
    speakerPitch(`live-${index}`),
  );
  check(
    "live speaker pitches stay inside C4..C6 on the pentatonic scale",
    pitches.every(
      (pitch) =>
        pitch >= LIVE_SPEAKER_PITCHES[0] &&
        pitch <= LIVE_SPEAKER_PITCHES[LIVE_SPEAKER_PITCHES.length - 1] &&
        LIVE_SPEAKER_PITCHES.includes(pitch),
    ),
  );
  check(
    "core speakers keep their spec pitch",
    speakerPitch("orion") === 523 && speakerPitch("rex") === 392,
  );
  check(
    "live pitches are deterministic",
    speakerPitch("live-3") === speakerPitch("live-3"),
  );
}

function runSlotSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("24. Robot slot lifecycle");

  const allocator = new AgentSlotAllocator(6, 70);
  let peak = 0;
  let leaked = false;
  for (let cycle = 0; cycle < 200; cycle += 1) {
    const first = allocator.acquire();
    const second = allocator.acquire();
    peak = Math.max(peak, allocator.activeCount);
    if (first === null || second === null) {
      leaked = true;
      break;
    }
    allocator.release(first);
    allocator.release(second);
  }
  check(
    "200 spawn/despawn cycles return every live slot",
    !leaked && allocator.activeCount === 6 && allocator.freeCount === 64,
    `${allocator.activeCount} active, ${allocator.freeCount} free, peak ${peak}`,
  );
  const small = new AgentSlotAllocator(6, 8);
  const slots = [small.acquire(), small.acquire()];
  check(
    "the allocator refuses to overdraw the pool",
    slots.every((slot) => slot !== null) && small.acquire() === null,
  );
}

function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function runLifecycleSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("25. Live agent lifecycle over WebSocket");

  const server = await startFakeLiveServer({
    port: 0,
    spawnBurst: 14,
    spawnIntervalMs: 60_000,
    maxAgents: 14,
    workSeconds: 0.4,
    emoteSeconds: 0.05,
    fadeSeconds: 0.05,
    walkSpeed: 60,
    tickMs: 20,
  });
  const backend = new WebSocketAgentBackend(
    `ws://127.0.0.1:${server.port}`,
    { connectTimeoutMs: 3000, reconnectBaseMs: 50, reconnectMaxMs: 200 },
  );

  const snapshots: WorldSnapshot[] = [];
  const events: AgentEvent[] = [];
  let waitingIds: AgentId[] = [];
  let sawBaysFilled = false;
  let sawPromotion = false;

  backend.subscribeSnapshot((snapshot) => {
    snapshots.push(snapshot);
    // Mirror the store: announce the profiles the backend sent, so lookups
    // resolve live roles and names rather than the fallback.
    setAnnouncedProfiles(snapshot.profiles);
    const live = snapshot.agents.filter(
      (agent) => getAgentProfile(agent.id).kind === "live",
    );
    if (live.length === 14) {
      const waiting = live.filter(
        (agent) => agent.location === WAITING_LOCATION && agent.path.length === 0,
      );
      const inBays = live.filter(
        (agent) =>
          agent.location === "dispatch" ||
          agent.destination === "dispatch",
      );
      if (inBays.length === 12 && waiting.length === 2) {
        sawBaysFilled = true;
        if (waitingIds.length === 0) {
          waitingIds = waiting.map((agent) => agent.id);
        }
      }
    }
    if (
      waitingIds.length > 0 &&
      snapshot.agents.some(
        (agent) =>
          waitingIds.includes(agent.id) && agent.location === "dispatch",
      )
    ) {
      sawPromotion = true;
    }
  });
  backend.subscribe((event) => {
    events.push(event);
  });

  try {
    await backend.connect();
    await waitFor(
      () =>
        snapshots.some(
          (snapshot) =>
            snapshot.agents.filter(
              (agent) => getAgentProfile(agent.id).kind === "live",
            ).length === 14,
        ),
      5000,
      "fourteen live agents",
    );

    const firstFull = snapshots.find(
      (snapshot) =>
        snapshot.agents.filter(
          (agent) => getAgentProfile(agent.id).kind === "live",
        ).length === 14,
    );
    const firstLive = firstFull?.agents.filter(
      (agent) => getAgentProfile(agent.id).kind === "live",
    ) ?? [];
    check(
      "fourteen live agents arrive in one snapshot",
      firstLive.length === 14,
    );
    check(
      "four simultaneous agents of the same role stay four robots",
      new Set(firstLive.slice(0, 4).map((agent) => agent.id)).size === 4 &&
        firstLive
          .slice(0, 4)
          .every((agent) => getAgentProfile(agent.id).role === "reviewer"),
    );
    check(
      "every announced live id has its own profile and name",
      firstLive.every((agent) => {
        const profile = getAgentProfile(agent.id);
        return profile.kind === "live" && profile.name.length > 0;
      }),
    );
    check(
      "spawned events carry the live agents",
      events.filter((event) => event.type === "agent.spawned").length >= 14,
    );

    await waitFor(() => sawBaysFilled, 5000, "12 bays and 2 waiters");
    check(
      "twelve agents take bays and the extra two wait at the collaboration table",
      sawBaysFilled && waitingIds.length === 2,
    );

    await waitFor(
      () => events.some((event) => event.type === "agent.despawned"),
      5000,
      "a despawned agent",
    );
    check(
      "despawned events carry an outcome and a duration",
      events
        .filter((event) => event.type === "agent.despawned")
        .every(
          (event) =>
            (event.metadata?.outcome === "success" ||
              event.metadata?.outcome === "error") &&
            typeof event.metadata?.duration === "number",
        ),
    );
    check(
      "despawned events are feed events with a success/error severity",
      events
        .filter((event) => event.type === "agent.despawned")
        .every((event) => {
          const expected =
            event.metadata?.outcome === "error" ? "error" : "success";
          return event.feed && event.severity === expected;
        }),
    );

    await waitFor(() => sawPromotion, 5000, "a waiting agent promoted");
    check(
      "a waiting agent takes a bay as soon as one frees",
      sawPromotion,
    );
  } finally {
    await backend.disconnect();
    await server.close();
  }
}

function runHostileSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("21b. Hostile backend input");

  const base = new SimulationEngine().snapshot();
  const hostileIds = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  for (const id of hostileIds) {
    const profile = { ...makeLiveProfile(1), id };
    const parsed = parseAgentProfile(profile);
    check(`profile id "${id}" parses as a plain live agent`,
      parsed !== null && parsed.id === id && parsed.kind === "live");
    check(`speakerPitch("${id}") is a finite frequency`,
      Number.isFinite(speakerPitch(id)) && typeof speakerPitch(id) === "number");
    // Unannounced ids must resolve to a real profile, not a prototype member.
    const lookup = profileFor(useWorldStore.getState().profiles, id);
    check(`profileFor("${id}") returns a profile object`,
      typeof lookup === "object" && lookup.id === id);
  }

  const hostileProfiles = hostileIds.map((id) => ({ ...makeLiveProfile(1), id }));
  const hostileStates = hostileIds.map((id) => ({ ...makeLiveState(1), id }));
  const snapshot = parseWorldSnapshot({
    ...base,
    profiles: [...base.profiles, ...hostileProfiles],
    agents: [...base.agents, ...hostileStates],
  });
  check("a snapshot with prototype-named ids parses",
    snapshot !== null &&
      hostileIds.every((id) => snapshot.agents.some((a) => a.id === id)));
  if (snapshot !== null) {
    useWorldStore.getState().applySnapshot(snapshot);
    const profiles = useWorldStore.getState().profiles;
    check("the store keeps prototype-named ids as plain keys",
      hostileIds.every((id) => profiles.get(id)?.id === id) &&
        Object.getPrototypeOf(profiles) === Map.prototype &&
        ({} as Record<string, unknown>).name === undefined);
  }

  // Core id spoofing.
  check("a live profile claiming a core id is rejected",
    parseAgentProfile({ ...makeLiveProfile(1), id: "orion", kind: "live" }) === null);
  check("a core profile with a non-core id is rejected",
    parseAgentProfile({ ...makeLiveProfile(1), kind: "core" }) === null);
  const spoof = { ...makeLiveProfile(1), id: "orion", name: "Evil Orion" };
  useWorldStore.getState().applySnapshot({
    ...base,
    profiles: [spoof, makeLiveProfile(2)],
    agents: base.agents,
  });
  const orion = useWorldStore.getState().profiles.get("orion");
  check("a spoofed live orion never overwrites the core profile in the store",
    orion !== undefined && orion.kind === "core" && orion.name !== "Evil Orion");
  useWorldStore.getState().applySnapshot({ ...base, profiles: base.profiles });

  // Numbers.
  const agentWith = (patch: Record<string, unknown>) =>
    parseWorldSnapshot({
      ...base,
      agents: [{ ...base.agents[0], ...patch }],
    });
  const bad = (patch: Record<string, unknown>): boolean => {
    const result = agentWith(patch);
    return result === null || result.agents.length === 0;
  };
  check("1e308 position is rejected", bad({ position: { x: 1e308, z: 0 } }));
  check("Infinity-like JSON position is rejected",
    bad({ position: { x: Number.POSITIVE_INFINITY, z: 0 } }));
  check("NaN position is rejected", bad({ position: { x: Number.NaN, z: 0 } }));
  check("1e308 heading is rejected", bad({ heading: 1e308 }));
  check("an absurd path point is rejected",
    bad({ path: [{ x: 0, z: 1e300 }] }));

  // Text caps.
  const long = "x".repeat(5000);
  const capped = agentWith({ activity: long });
  check("oversized activity is truncated",
    capped !== null && capped.agents[0].activity.length === 200);
  const event = parseAgentEvent({
    id: "e1", type: "system.ready", timestamp: 1, simTime: 1,
    message: long, severity: "info", feed: true,
  });
  check("oversized event message is truncated",
    event !== null && event.message.length === 300);
  const bigMeta = parseAgentEvent({
    id: "e2", type: "system.ready", timestamp: 1, simTime: 1,
    message: "m", severity: "info", feed: true,
    metadata: { blob: long },
  });
  check("oversized metadata is dropped, event kept",
    bigMeta !== null && bigMeta.metadata === undefined);
  const manyKeys = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`k${i}`, i]),
  );
  const keyedMeta = parseAgentEvent({
    id: "e3", type: "system.ready", timestamp: 1, simTime: 1,
    message: "m", severity: "info", feed: true, metadata: manyKeys,
  });
  check("metadata with more than 16 keys is dropped",
    keyedMeta !== null && keyedMeta.metadata === undefined);
  check("an event with a control-char task id is rejected",
    parseAgentEvent({
      id: "e4", type: "system.ready", timestamp: 1, simTime: 1,
      message: "m", severity: "info", feed: true, taskId: "a\u0000b",
    }) === null);

  // Byte-accurate frame cap: 400k three-byte chars is only 400k UTF-16 units.
  const frame = JSON.stringify({ type: "event", pad: "\u20ac".repeat(400_000) });
  const parsedFrame = parseServerMessage(frame);
  check("a multi-byte frame over 1 MiB is rejected by byte length",
    parsedFrame.kind === "invalid");
}

export async function runLiveAgentsSuite(
  reporter: TestReporter,
): Promise<void> {
  runBaySuite(reporter);
  runProfileSuite(reporter);
  runHostileSuite(reporter);
  runLookupSuite(reporter);
  runColorAndPitchSuite(reporter);
  runSlotSuite(reporter);
  await runLifecycleSuite(reporter);
}
