/**
 * Development-only live backend: a tiny WebSocket server that speaks the
 * protocol in spec 3.5 and keeps a changing roster of live subagents.
 *
 *   npm run live:fake
 *   NEXT_PUBLIC_AGENT_BACKEND=websocket
 *   NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8790
 *
 * It has no dependencies (the repo installs no `ws` package): the handshake
 * and the text frames are implemented directly on node:net. It also exports
 * `startFakeLiveServer` so the headless checks can drive a real WebSocket
 * round trip without a browser.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import type {
  AgentId,
  AgentProfile,
  AgentState,
  Vec2,
} from "../src/agents/agentTypes.ts";
import { CORE_AGENTS } from "../src/agents/AgentRegistry.ts";
import { colorForAgent } from "../src/agents/agentPalette.ts";
import type { AgentEvent, EventSeverity } from "../src/events/eventTypes.ts";
import type {
  CommLink,
  SimulationStatus,
  WorldSnapshot,
} from "../src/integrations/AgentBackend.ts";
import { allocateBay, bayStand, routeToBay } from "../src/simulation/bays.ts";
import {
  headingFor,
  route,
  slotFor,
} from "../src/simulation/worldLayout.ts";
import type { Task } from "../src/tasks/taskTypes.ts";
import {
  CLOSE_NORMAL,
  OPCODE_CLOSE,
  OPCODE_PING,
  encodeClose,
  encodeFrame,
  encodeText,
  readFrames,
  webSocketAccept,
} from "./lib/miniWebSocket.ts";

const ALLOWED_ORIGIN_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
]);

/**
 * Browsers always send Origin on a WebSocket handshake. Clients that send no
 * Origin (CLI tools, tests) are allowed. A browser page is allowed only when
 * it is served from localhost or 127.0.0.1, on any port.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return ALLOWED_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const LIVE_ROLES = [
  "researcher",
  "product_manager",
  "engineer",
  "qa",
  "reviewer",
] as const;

export interface FakeLiveServerOptions {
  /** 0 picks a free port; the resolved port is returned. */
  port?: number;
  /** Live agents spawned before the interval takes over (default 4). */
  spawnBurst?: number;
  /** Spawn one more agent this often while below `maxAgents`. */
  spawnIntervalMs?: number;
  /** Total concurrent live agents (default 16). */
  maxAgents?: number;
  /** Simulated seconds each agent works (default 18). */
  workSeconds?: number;
  /** Simulated seconds of success/error emote (default 1.2). */
  emoteSeconds?: number;
  /** Fade window left in the snapshot after `agent.despawned` (default 0.1 s). */
  fadeSeconds?: number;
  /** Walking speed in m/s (default 2.4, matching the simulation). */
  walkSpeed?: number;
  /** Server tick in milliseconds (default 100). */
  tickMs?: number;
}

export interface FakeLiveServer {
  port: number;
  close(): Promise<void>;
}

interface LiveAgent {
  id: AgentId;
  profile: AgentProfile;
  state: AgentState;
  phase: "walk-to-bay" | "work" | "emote" | "walk-home" | "fade";
  timer: number;
  bay: number | null;
  waiting: boolean;
  spawnedAt: number;
  outcome: "success" | "error";
  path: Vec2[];
  target: Vec2;
  linkAt: number;
}

interface Client {
  socket: Socket;
  buffer: Buffer;
}

/** Move a point along a routed path at `speed`, returning the consumed step. */
function advance(
  position: Vec2,
  path: Vec2[],
  budget: number,
): { moved: number; heading: number | null } {
  let remaining = budget;
  let moved = 0;
  let heading: number | null = null;
  while (remaining > 1e-7 && path.length > 0) {
    const next = path[0];
    const dx = next.x - position.x;
    const dz = next.z - position.z;
    const step = Math.hypot(dx, dz);
    if (step <= 1e-7) {
      path.shift();
      continue;
    }
    heading = Math.atan2(dx, dz);
    if (step <= remaining) {
      position.x = next.x;
      position.z = next.z;
      path.shift();
      remaining -= step;
      moved += step;
    } else {
      const ratio = remaining / step;
      position.x += dx * ratio;
      position.z += dz * ratio;
      moved += remaining;
      remaining = 0;
    }
  }
  return { moved, heading };
}

function coreState(profile: AgentProfile): AgentState {
  const home = profile.home ?? "hub";
  const slot = slotFor(home, profile.seat);
  return {
    id: profile.id,
    status: "idle",
    activity: `${profile.name} is idle`,
    currentTaskId: null,
    progress: 0,
    location: home,
    destination: null,
    position: { x: slot.x, z: slot.z },
    heading: headingFor(home, profile.seat),
    path: [],
    facingAgentId: null,
    paused: false,
  };
}

function taskFixture(): Task {
  return {
    id: "T-001",
    title: "Fake live task",
    description: "A placeholder returned by the fake live server.",
    priority: "medium",
    status: "queued",
    phase: "queued",
    assignedAgentId: null,
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    iteration: 0,
    subtasks: [],
    findings: [],
    history: [],
    isDemo: false,
    preferredAgentId: null,
    blockedReason: null,
  };
}

export async function startFakeLiveServer(
  options: FakeLiveServerOptions = {},
): Promise<FakeLiveServer> {
  const tickMs = options.tickMs ?? 100;
  let spawnBurst = options.spawnBurst ?? 4;
  const spawnIntervalMs = options.spawnIntervalMs ?? 900;
  const maxAgents = options.maxAgents ?? 16;
  const workSeconds = options.workSeconds ?? 18;
  const emoteSeconds = options.emoteSeconds ?? 1.2;
  const fadeSeconds = options.fadeSeconds ?? 0.1;
  const walkSpeed = options.walkSpeed ?? 2.4;
  /** The client scales a new robot in over 0.4 s at the hub. */
  const spawnHoldSeconds = 0.4;

  let clock = 0;
  let status: SimulationStatus = "running";
  let speed = 1;
  let spawnCountdown = 0;
  let spawnSeq = 0;
  let eventSeq = 0;
  let linkSeq = 0;
  let paused = false;

  const live: LiveAgent[] = [];
  const links: CommLink[] = [];
  const clients = new Set<Client>();

  const broadcast = (value: unknown): void => {
    const text = JSON.stringify(value);
    const frame = encodeText(text);
    for (const client of clients) {
      if (client.socket.destroyed) continue;
      try {
        client.socket.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  };

  const emit = (
    type: AgentEvent["type"],
    message: string,
    extra: {
      agentId?: AgentId;
      targetAgentId?: AgentId;
      severity?: EventSeverity;
      feed?: boolean;
      metadata?: Record<string, unknown>;
    } = {},
  ): void => {
    eventSeq += 1;
    const event: AgentEvent = {
      id: `live-evt-${eventSeq}`,
      type,
      timestamp: Date.now(),
      simTime: Math.round(clock * 1000) / 1000,
      message,
      severity: extra.severity ?? "info",
      feed: extra.feed ?? true,
      ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
      ...(extra.targetAgentId === undefined
        ? {}
        : { targetAgentId: extra.targetAgentId }),
      ...(extra.metadata === undefined ? {} : { metadata: extra.metadata }),
    };
    broadcast({ type: "event", event });
  };

  const occupiedBays = (): Set<number> => {
    const occupied = new Set<number>();
    for (const agent of live) {
      if (agent.bay !== null && agent.phase !== "fade") occupied.add(agent.bay);
    }
    return occupied;
  };

  const waitingAgents = (): LiveAgent[] =>
    live.filter((agent) => agent.waiting && agent.phase !== "fade");

  const placeWaiting = (): void => {
    let index = 0;
    for (const agent of live) {
      if (!agent.waiting || agent.phase !== "walk-to-bay") continue;
      const slot = slotFor("lounge", index);
      agent.state.position.x = slot.x;
      agent.state.position.z = slot.z;
      agent.state.location = "lounge";
      agent.state.destination = null;
      agent.state.path = [];
      agent.state.heading = headingFor("lounge", index);
      index += 1;
    }
  };

  const beginWalkToBay = (agent: LiveAgent, bay: number): void => {
    agent.bay = bay;
    agent.waiting = false;
    agent.phase = "walk-to-bay";
    const stand = bayStand(bay);
    agent.path = routeToBay(agent.state.position, bay);
    agent.target = stand;
    agent.state.destination = "dispatch";
    agent.state.location = null;
    agent.state.status = "walking";
    agent.state.activity = `Walking to dispatch bay ${bay + 1}`;
    agent.state.path = agent.path.map((point) => ({ ...point }));
    agent.timer = 0;
  };

  const promoteWaiting = (): void => {
    const occupied = occupiedBays();
    const waiting = waitingAgents();
    for (const agent of waiting) {
      const bay = allocateBay(occupied);
      if (bay === null) break;
      occupied.add(bay);
      beginWalkToBay(agent, bay);
      agent.state.activity = `Claimed dispatch bay ${bay + 1}`;
    }
    placeWaiting();
  };

  const spawnAgent = (): void => {
    if (live.filter((agent) => agent.phase !== "fade").length >= maxAgents) {
      return;
    }
    spawnSeq += 1;
    // The first burst is four agents of the same role, the case that used to
    // collapse into one robot before phase 9.
    const role =
      spawnSeq <= 4 ? "reviewer" : LIVE_ROLES[spawnSeq % LIVE_ROLES.length];
    const id = `live-${String(spawnSeq).padStart(2, "0")}`;
    const profile: AgentProfile = {
      id,
      name:
        role === "reviewer"
          ? `code-reviewer #${spawnSeq}`
          : `${role.replaceAll("_", "-")} #${spawnSeq}`,
      role,
      roleLabel:
        role === "reviewer"
          ? "Code Reviewer"
          : role === "qa"
            ? "QA Engineer"
            : role === "product_manager"
              ? "Product Manager"
              : role === "researcher"
                ? "Researcher"
                : "Software Engineer",
      tagline: "Live subagent over the fake WebSocket backend",
      color: colorForAgent(id),
      seat: spawnSeq % 6,
      kind: "live",
    };
    const hub = slotFor("hub", 0);
    const state: AgentState = {
      id,
      status: "idle",
      activity: "Arrived at the Operations Hub",
      currentTaskId: null,
      progress: 0,
      location: "hub",
      destination: null,
      position: { x: hub.x, z: hub.z },
      heading: headingFor("hub", 0),
      path: [],
      facingAgentId: null,
      paused: false,
    };
    const agent: LiveAgent = {
      id,
      profile,
      state,
      phase: "walk-to-bay",
      timer: 0,
      bay: null,
      waiting: false,
      spawnedAt: clock,
      outcome: "success",
      path: [],
      target: hub,
      linkAt: 0,
    };

    const bay = allocateBay(occupiedBays());
    if (bay === null) {
      agent.waiting = true;
      agent.phase = "walk-to-bay";
      agent.state.activity = "Waiting for a dispatch bay";
      live.push(agent);
      placeWaiting();
    } else {
      live.push(agent);
      beginWalkToBay(agent, bay);
      // Hold at the hub while the client plays its 0.4 s scale-in.
      agent.timer = spawnHoldSeconds;
      agent.state.status = "idle";
      agent.state.activity = "Booting at the Operations Hub";
      agent.state.location = "hub";
      agent.state.destination = null;
      agent.state.path = [];
    }

    emit("agent.spawned", `${profile.name} joined the Dispatch Floor`, {
      agentId: id,
      severity: "info",
      feed: true,
      metadata: {
        role: profile.role,
        bay: agent.bay,
        waiting: agent.waiting,
        name: profile.name,
      },
    });
  };

  const startWork = (agent: LiveAgent): void => {
    agent.phase = "work";
    agent.timer = workSeconds;
    agent.state.status = "working";
    agent.state.location = "dispatch";
    agent.state.destination = null;
    agent.state.path = [];
    agent.state.heading = headingFor("dispatch", agent.bay ?? 0);
    agent.state.progress = 0;
    agent.state.activity = `${agent.profile.name} is working on a live task`;
    agent.linkAt = 0;
  };

  const beginEmote = (agent: LiveAgent): void => {
    agent.phase = "emote";
    agent.timer = emoteSeconds;
    agent.outcome = spawnSeq % 5 === 0 ? "error" : "success";
    agent.state.status = agent.outcome;
    agent.state.progress = 1;
    agent.state.activity =
      agent.outcome === "error"
        ? `${agent.profile.name} hit a problem`
        : `${agent.profile.name} looks pleased`;
  };

  const beginWalkHome = (agent: LiveAgent): void => {
    agent.phase = "walk-home";
    agent.timer = 0;
    if (agent.bay !== null) {
      agent.bay = null;
      // A freed bay is immediately offered to the queue.
      promoteWaiting();
    }
    const hub = slotFor("hub", 0);
    agent.path = route(agent.state.position, hub);
    agent.target = hub;
    agent.state.destination = "hub";
    agent.state.location = null;
    agent.state.status = "walking";
    agent.state.progress = 0;
    agent.state.activity = "Heading back to the Operations Hub";
    agent.state.path = agent.path.map((point) => ({ ...point }));
  };

  const finishAgent = (agent: LiveAgent): void => {
    // The client keeps the robot for its 0.4 s fade; removing it here after
    // that window would be a second, invisible step, so mark it fading and
    // drop it at the end of the timer.
    agent.phase = "fade";
    agent.timer = fadeSeconds;
    agent.state.status = agent.outcome;
    agent.state.activity =
      agent.outcome === "error" ? "Shutting down after an error" : "Shutting down";
    const duration = Math.max(0, clock - agent.spawnedAt);
    emit("agent.despawned", `${agent.profile.name} left the floor`, {
      agentId: agent.id,
      severity: agent.outcome === "error" ? "error" : "success",
      feed: true,
      metadata: { outcome: agent.outcome, duration },
    });
  };

  const tickAgent = (agent: LiveAgent, dt: number): boolean => {
    switch (agent.phase) {
      case "walk-to-bay": {
        if (agent.waiting) return false;
        if (agent.timer > 0) {
          agent.timer -= dt;
          return false;
        }
        const step = advance(agent.state.position, agent.path, dt * walkSpeed);
        if (step.heading !== null) agent.state.heading = step.heading;
        agent.state.path = agent.path.map((point) => ({ ...point }));
        if (agent.path.length === 0) startWork(agent);
        return false;
      }
      case "work": {
        agent.timer -= dt;
        agent.state.progress = Math.max(
          0,
          Math.min(1, 1 - agent.timer / Math.max(0.001, workSeconds)),
        );
        // One message arc early in the work phase, so live comm links show.
        if (agent.linkAt === 0 && agent.state.progress > 0.15) {
          agent.linkAt = clock;
          linkSeq += 1;
          links.push({
            id: `live-link-${linkSeq}`,
            from: agent.id,
            to: "orion",
            kind: "message",
            startedAt: Math.round(clock * 1000) / 1000,
            endsAt: Math.round((clock + 2.4) * 1000) / 1000,
          });
          emit("agent.message", `${agent.profile.name} reported to Orion`, {
            agentId: agent.id,
            targetAgentId: "orion",
            severity: "info",
            feed: true,
          });
        }
        if (agent.timer <= 0) beginEmote(agent);
        return false;
      }
      case "emote": {
        agent.timer -= dt;
        if (agent.timer <= 0) beginWalkHome(agent);
        return false;
      }
      case "walk-home": {
        const step = advance(agent.state.position, agent.path, dt * walkSpeed);
        if (step.heading !== null) agent.state.heading = step.heading;
        agent.state.path = agent.path.map((point) => ({ ...point }));
        if (agent.path.length === 0) finishAgent(agent);
        return false;
      }
      case "fade": {
        agent.timer -= dt;
        return agent.timer <= 0;
      }
    }
  };

  const snapshot = (): WorldSnapshot => ({
    clock: Math.round(clock * 1000) / 1000,
    status,
    speed,
    profiles: [
      ...CORE_AGENTS.map((profile) => ({ ...profile })),
      ...live.map((agent) => ({ ...agent.profile })),
    ],
    agents: [
      ...CORE_AGENTS.map((profile) => coreState(profile)),
      ...live.map((agent) => ({
        ...agent.state,
        position: { ...agent.state.position },
        path: agent.state.path.map((point) => ({ ...point })),
        paused: agent.state.paused || paused,
      })),
    ],
    tasks: [],
    links: links.filter((link) => link.endsAt > clock).map((link) => ({ ...link })),
  });

  const broadcastSnapshot = (): void => {
    broadcast({ type: "snapshot", snapshot: snapshot() });
  };

  const tick = (): void => {
    const now = Date.now();
    if (clients.size === 0) {
      lastTick = now;
      return;
    }
    const dt = Math.min(0.2, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (status !== "running") return;
    clock += dt * speed;

    spawnCountdown -= dt * 1000;
    if (spawnCountdown <= 0) {
      spawnAgent();
      spawnCountdown = spawnIntervalMs;
      if (spawnBurst > 0) {
        for (let index = 1; index < spawnBurst; index += 1) spawnAgent();
        spawnBurst = 0;
      }
    }

    let changed = false;
    for (const agent of live) {
      const remove = tickAgent(agent, dt);
      if (remove) changed = true;
    }
    if (changed) {
      for (let index = live.length - 1; index >= 0; index -= 1) {
        if (live[index].phase === "fade" && live[index].timer <= 0) {
          live.splice(index, 1);
        }
      }
      promoteWaiting();
    }
    links.splice(
      0,
      links.length,
      ...links.filter((link) => link.endsAt > clock),
    );
    broadcastSnapshot();
  };

  let lastTick = Date.now();
  const timer = setInterval(tick, tickMs);

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("AI Agent World fake live backend. Connect with a WebSocket.\n");
  });

  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    if (!isAllowedOrigin(request.headers.origin)) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = webSocketAccept(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client: Client = { socket, buffer: Buffer.alloc(0) };
    clients.add(client);
    broadcastSnapshot();

    const closeClient = (closeCode: number): void => {
      clients.delete(client);
      client.buffer = Buffer.alloc(0);
      socket.end(encodeClose(closeCode));
    };

    socket.on("data", (chunk: Buffer) => {
      // Once a client is closed, bytes that still arrive are ignored.
      if (!clients.has(client)) return;
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const { frames, rest, protocolError } = readFrames(client.buffer);
      client.buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === OPCODE_CLOSE) {
          closeClient(CLOSE_NORMAL);
          return;
        }
        if (frame.opcode === OPCODE_PING) {
          socket.write(encodeFrame(0xa, Buffer.alloc(0)));
          continue;
        }
        handleCommand(frame.text, client);
      }
      if (protocolError !== null) closeClient(protocolError.closeCode);
    });
    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", () => {
      clients.delete(client);
    });
  });

  const send = (client: Client, value: unknown): void => {
    if (client.socket.destroyed) return;
    client.socket.write(encodeText(JSON.stringify(value)));
  };

  const sendAck = (
    client: Client,
    id: string,
    ok: boolean,
    result?: unknown,
    error?: string,
  ): void => {
    send(client, {
      type: "ack",
      id,
      ok,
      ...(ok ? { result } : { error: error ?? "command failed" }),
    });
  };

  const handleCommand = (raw: string, client: Client): void => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      typeof message !== "object" ||
      message === null ||
      (message as { type?: unknown }).type !== "command"
    ) {
      return;
    }
    const frame = message as {
      id?: unknown;
      command?: { name?: unknown; multiplier?: unknown; agentId?: unknown };
    };
    const id = typeof frame.id === "string" ? frame.id : "";
    const command = frame.command;
    if (id.length === 0 || command === undefined || typeof command.name !== "string") {
      sendAck(client, id, false, undefined, "malformed command");
      return;
    }
    switch (command.name) {
      case "start":
        status = "running";
        emit("system.started", "Fake live backend started", { feed: true });
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      case "pause":
        status = "paused";
        emit("system.paused", "Fake live backend paused", {
          severity: "warning",
        });
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      case "resume":
        status = "running";
        lastTick = Date.now();
        emit("system.resumed", "Fake live backend resumed");
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      case "stop":
      case "reset":
        live.splice(0, live.length);
        links.splice(0, links.length);
        clock = 0;
        spawnSeq = 0;
        spawnBurst = options.spawnBurst ?? 4;
        spawnCountdown = 0;
        lastTick = Date.now();
        if (command.name === "reset") {
          status = "ready";
          emit("system.reset", "Fake live backend reset");
        } else {
          status = "ready";
        }
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      case "setSpeed": {
        const multiplier = command.multiplier;
        if (typeof multiplier !== "number" || !(multiplier > 0)) {
          sendAck(client, id, false, undefined, "speed must be positive");
          return;
        }
        speed = multiplier;
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      }
      case "submitTask": {
        sendAck(client, id, true, taskFixture());
        return;
      }
      case "pauseAgent":
      case "resumeAgent": {
        const agentId = command.agentId;
        if (typeof agentId !== "string") {
          sendAck(client, id, false, undefined, "unknown agent");
          return;
        }
        const agent = live.find((entry) => entry.id === agentId);
        if (agent) {
          agent.state.paused = command.name === "pauseAgent";
          emit(
            command.name === "pauseAgent" ? "agent.paused" : "agent.resumed",
            `${agent.profile.name} ${agent.state.paused ? "is paused" : "is back"}`,
            {
              agentId,
              severity: command.name === "pauseAgent" ? "warning" : "info",
            },
          );
          broadcastSnapshot();
          sendAck(client, id, true);
          return;
        }
        if (command.name === "pauseAgent") paused = true;
        else paused = false;
        broadcastSnapshot();
        sendAck(client, id, true);
        return;
      }
      default:
        sendAck(client, id, false, undefined, `unknown command ${command.name}`);
    }
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    async close(): Promise<void> {
      clearInterval(timer);
      for (const client of clients) client.socket.destroy();
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.LIVE_FAKE_PORT ?? 8790);
  void startFakeLiveServer({ port }).then(
    (server) => {
      console.log(`Fake live backend on ws://127.0.0.1:${server.port}`);
      console.log(
        "Run the app with NEXT_PUBLIC_AGENT_BACKEND=websocket and NEXT_PUBLIC_AGENT_WS_URL set to that URL.",
      );
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
