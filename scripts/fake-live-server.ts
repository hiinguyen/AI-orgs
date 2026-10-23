/**
 * Development-only live backend: a tiny WebSocket server that speaks the
 * protocol in spec 3.5 and keeps a changing roster of live subagents.
 *
 *   npm run live:fake
 *   NEXT_PUBLIC_AGENT_BACKEND=websocket
 *   NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8790
 *
 * It has no dependencies (the repo installs no `ws` package): the handshake
 * and the text frames are implemented directly on node:net. It is a scenario
 * driver on top of the shared stage in src/simulation/liveStage.ts; that stage
 * is also what the Claude Code bridge drives. It also exports
 * `startFakeLiveServer` so the headless checks can drive a real WebSocket round
 * trip without a browser.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import type { SimulationStatus } from "../src/integrations/AgentBackend.ts";
import { LiveStage } from "../src/simulation/liveStage.ts";
import {
  CLOSE_NORMAL,
  OPCODE_CLOSE,
  OPCODE_PING,
  encodeClose,
  encodeFrame,
  encodeText,
  readFrames,
  webSocketAccept,
} from "../bridge/lib/miniWebSocket.ts";
import { isAllowedOrigin } from "../bridge/lib/origin.ts";
import { liveProfileFor, taskFixture } from "./lib/fakeLiveScenario.ts";

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

interface Client {
  socket: Socket;
  buffer: Buffer;
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

  let spawnCountdown = 0;
  let spawnSeq = 0;

  const stage = new LiveStage({
    maxAgents,
    walkSpeed,
    spawnHoldSeconds: 0.4,
    emoteSeconds,
    fadeSeconds,
    now: Date.now,
    eventIdPrefix: "live",
  });
  stage.setStatus("running");
  stage.setSpeed(1);

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

  const broadcastSnapshot = (): void => {
    broadcast({ type: "snapshot", snapshot: stage.snapshot() });
  };

  /** Broadcast queued stage events, then the current snapshot. */
  const flush = (): void => {
    for (const event of stage.drainEvents()) {
      broadcast({ type: "event", event });
    }
    broadcastSnapshot();
  };

  const spawnAgent = (): void => {
    if (stage.liveAgents.length >= maxAgents) return;
    spawnSeq += 1;
    const profile = liveProfileFor(spawnSeq);
    stage.spawn(profile, {
      workSeconds,
      outcome: spawnSeq % 5 === 0 ? "error" : "success",
    });
  };

  let lastTick = Date.now();
  const tick = (): void => {
    const now = Date.now();
    if (clients.size === 0) {
      stage.drainEvents();
      lastTick = now;
      return;
    }
    const dt = Math.min(0.2, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (stage.simulationStatus !== "running") {
      stage.drainEvents();
      return;
    }

    spawnCountdown -= dt * 1000;
    if (spawnCountdown <= 0) {
      spawnAgent();
      spawnCountdown = spawnIntervalMs;
      if (spawnBurst > 0) {
        for (let index = 1; index < spawnBurst; index += 1) spawnAgent();
        spawnBurst = 0;
      }
    }

    stage.tick(dt);
    flush();
  };

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
    // Events from before the first client are history, not a live feed.
    stage.drainEvents();
    broadcastSnapshot();

    const closeClient = (closeCode: number): void => {
      clients.delete(client);
      client.buffer = Buffer.alloc(0);
      socket.end(encodeClose(closeCode));
    };

    socket.on("data", (chunk: Buffer) => {
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

  const setStatus = (status: SimulationStatus): void => {
    stage.setStatus(status);
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
        setStatus("running");
        stage.emit("system.started", "Fake live backend started", { feed: true });
        flush();
        sendAck(client, id, true);
        return;
      case "pause":
        setStatus("paused");
        stage.emit("system.paused", "Fake live backend paused", {
          severity: "warning",
        });
        flush();
        sendAck(client, id, true);
        return;
      case "resume":
        setStatus("running");
        lastTick = Date.now();
        stage.emit("system.resumed", "Fake live backend resumed");
        flush();
        sendAck(client, id, true);
        return;
      case "stop":
      case "reset":
        stage.reset();
        spawnSeq = 0;
        spawnBurst = options.spawnBurst ?? 4;
        spawnCountdown = 0;
        lastTick = Date.now();
        if (command.name === "reset") {
          stage.emit("system.reset", "Fake live backend reset");
        }
        setStatus("ready");
        flush();
        sendAck(client, id, true);
        return;
      case "setSpeed": {
        const multiplier = command.multiplier;
        if (typeof multiplier !== "number" || !(multiplier > 0)) {
          sendAck(client, id, false, undefined, "speed must be positive");
          return;
        }
        stage.setSpeed(multiplier);
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
        const agent = stage.getAgent(agentId);
        if (agent) {
          agent.state.paused = command.name === "pauseAgent";
          stage.emit(
            command.name === "pauseAgent" ? "agent.paused" : "agent.resumed",
            `${agent.profile.name} ${agent.state.paused ? "is paused" : "is back"}`,
            {
              agentId,
              severity: command.name === "pauseAgent" ? "warning" : "info",
            },
          );
          flush();
          sendAck(client, id, true);
          return;
        }
        stage.setGlobalPaused(command.name === "pauseAgent");
        flush();
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
