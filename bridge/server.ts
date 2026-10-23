/**
 * Claude Code hooks bridge. One local HTTP server receives hook JSON on
 * `POST /hook` and serves the phase 9 WebSocket protocol on `/ws`, so the UI
 * sees each real subagent as a live robot without knowing Claude Code exists.
 *
 *   npm run bridge
 *   NEXT_PUBLIC_AGENT_BACKEND=websocket
 *   NEXT_PUBLIC_AGENT_WS_URL=ws://127.0.0.1:8791/ws
 *
 * The server binds loopback only, rejects browser Origins on the hook endpoint,
 * caps the body and the hook rate, and never logs payload values. It is a hook
 * driver on top of the shared stage in `src/simulation/liveStage.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { DEFAULT_BACKEND_CAPABILITIES } from "../src/integrations/AgentBackend.ts";
import type { BackendCapabilities } from "../src/integrations/AgentBackend.ts";
import { LiveStage } from "../src/simulation/liveStage.ts";
import { describeHookShape, parseHookPayload } from "./hooks.ts";
import {
  applyHook,
  createMappingState,
  resetMappingState,
} from "./mapping.ts";
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
import { isAllowedOrigin } from "./lib/origin.ts";
import { isBackedUp } from "./backlog.ts";
import { dropFinishedAgents } from "./offlineStage.ts";
import { createHookRateLimiter } from "./rateLimit.ts";
import { ORPHAN_TIMEOUT_MS, reapOrphans } from "./reaper.ts";

export const DEFAULT_BRIDGE_PORT = 8791;
export const MAX_HOOK_BODY_BYTES = 256 * 1024;

/** The bridge cannot accept tasks or pause agents; it only observes a session. */
export const BRIDGE_CAPABILITIES: BackendCapabilities = {
  ...DEFAULT_BACKEND_CAPABILITIES,
  submitTask: false,
  pauseAgent: false,
  setSpeed: false,
};

export interface BridgeServerOptions {
  /** 0 picks a free port; the resolved port is returned. */
  port?: number;
  /** Stage tick in milliseconds while a client is connected. */
  tickMs?: number;
  /** Silence after which a live agent is reaped. */
  orphanTimeoutMs?: number;
  /** Hook calls accepted per wall-clock second. */
  maxHookCallsPerSecond?: number;
  /** Print event names and field types, never values. */
  capture?: boolean;
  /** Wall clock source, injectable for the checks. */
  now?: () => number;
  /** Walking speed in m/s. */
  walkSpeed?: number;
  /** Pause at the hub before walking to a bay. */
  spawnHoldSeconds?: number;
  /** Success/error emote before walking home. */
  emoteSeconds?: number;
  /** Fade window before an agent leaves the snapshot. */
  fadeSeconds?: number;
}

export interface BridgeServer {
  port: number;
  close(): Promise<void>;
}

interface Client {
  socket: Socket;
  buffer: Buffer;
}

function isJsonContentType(value: string): boolean {
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  if (response.writableEnded || response.headersSent) return;
  if (status === 204) {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function rejectTooLarge(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (response.headersSent) {
    request.destroy();
    return;
  }
  response.writeHead(413, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  });
  response.end("Hook body too large", () => {
    request.destroy();
  });
}

/** Capture mode must never be able to throw out of the request handler. */
function logCapture(body: unknown): void {
  try {
    // Event name and field types only; never a payload value.
    console.log(`[capture] ${describeHookShape(body)}`);
  } catch {
    // Diagnostics only.
  }
}

function rejectSocket(socket: Socket, status: string, reason: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

export async function startBridgeServer(
  options: BridgeServerOptions = {},
): Promise<BridgeServer> {
  const tickMs = options.tickMs ?? 100;
  const orphanTimeoutMs = options.orphanTimeoutMs ?? ORPHAN_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const capture = options.capture ?? false;

  const stage = new LiveStage({
    walkSpeed: options.walkSpeed,
    spawnHoldSeconds: options.spawnHoldSeconds,
    emoteSeconds: options.emoteSeconds,
    fadeSeconds: options.fadeSeconds,
    now,
    eventIdPrefix: "bridge",
  });
  stage.setStatus("running");
  const mapping = createMappingState();
  const limiter = createHookRateLimiter(
    options.maxHookCallsPerSecond,
    now,
  );

  const clients = new Set<Client>();
  // A UI pause is the only thing that keeps accepted hooks from running the
  // stage; reset and any hook after it bring the world back to running.
  let userPaused = false;

  const dropClient = (client: Client): void => {
    clients.delete(client);
    client.socket.destroy();
  };

  const broadcast = (value: unknown): void => {
    const frame = encodeText(JSON.stringify(value));
    for (const client of [...clients]) {
      if (client.socket.destroyed) continue;
      if (isBackedUp(client.socket)) {
        dropClient(client);
        continue;
      }
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

  const flush = (): void => {
    for (const event of stage.drainEvents()) {
      broadcast({ type: "event", event });
    }
    broadcastSnapshot();
  };

  const send = (client: Client, value: unknown): void => {
    if (client.socket.destroyed) return;
    if (isBackedUp(client.socket)) {
      dropClient(client);
      return;
    }
    client.socket.write(encodeText(JSON.stringify(value)));
  };

  const sendAck = (
    client: Client,
    id: string,
    ok: boolean,
    error?: string,
  ): void => {
    send(client, {
      type: "ack",
      id,
      ok,
      ...(ok ? {} : { error: error ?? "command failed" }),
    });
  };

  const handleHookRequest = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    // Browsers always send Origin on a cross-origin request; Claude Code does
    // not. A present Origin therefore means this is not a hook call.
    if (request.headers.origin !== undefined) {
      request.resume();
      sendText(response, 403, "Forbidden");
      return;
    }

    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !isJsonContentType(contentType)) {
      request.resume();
      sendText(response, 415, "Expected application/json");
      return;
    }

    if (!limiter.allow()) {
      request.resume();
      sendText(response, 429, "Too many hook calls");
      return;
    }

    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_HOOK_BODY_BYTES) {
      rejectTooLarge(request, response);
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > MAX_HOOK_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        rejectTooLarge(request, response);
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", () => {
      // A dropped hook forwarding client has nothing to answer.
    });
    request.on("end", () => {
      if (tooLarge) return;

      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendText(response, 400, "Malformed JSON");
        return;
      }

      if (capture) logCapture(body);

      const parsed = parseHookPayload(body);
      if (parsed.kind === "invalid") {
        sendText(response, 400, parsed.reason);
        return;
      }
      if (parsed.kind === "ignored") {
        sendText(response, 204, "");
        return;
      }

      try {
        applyHook(stage, mapping, parsed.payload, now());
        // Claude Code never resends SessionStart, so any accepted hook wakes
        // a stage that a UI reset left ready, unless the user paused it.
        if (!userPaused && stage.simulationStatus !== "running") {
          stage.setStatus("running");
        }
        if (clients.size === 0) {
          stage.drainEvents();
          dropFinishedAgents(stage);
        } else flush();
        sendText(response, 204, "");
      } catch {
        sendText(response, 400, "Hook could not be applied");
      }
    });
  };

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/hook") {
        if (request.method !== "POST") {
          request.resume();
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        handleHookRequest(request, response);
        return;
      }
      if (
        request.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/health")
      ) {
        sendText(
          response,
          200,
          "AI Agent World Claude Code bridge. Hooks: POST /hook. WebSocket: /ws.\n",
        );
        return;
      }
      request.resume();
      sendText(response, 404, "Not found");
    } catch {
      sendText(response, 500, "Bridge error");
    }
  });

  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/ws") {
        rejectSocket(socket, "404", "Not Found");
        return;
      }
      if (!isAllowedOrigin(request.headers.origin)) {
        rejectSocket(socket, "403", "Forbidden");
        return;
      }
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string") {
        socket.destroy();
        return;
      }

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${webSocketAccept(key)}\r\n\r\n`,
      );

      const client: Client = { socket, buffer: Buffer.alloc(0) };
      clients.add(client);
      // Events from before the first client are history, not a live feed.
      stage.drainEvents();
      send(client, { type: "hello", capabilities: BRIDGE_CAPABILITIES });
      broadcastSnapshot();

      const closeClient = (closeCode: number): void => {
        clients.delete(client);
        client.buffer = Buffer.alloc(0);
        socket.end(encodeClose(closeCode));
      };

      const handleCommand = (raw: string): void => {
        let message: unknown;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }
        if (!isRecord(message) || message.type !== "command") return;

        const id = typeof message.id === "string" ? message.id : "";
        const command = message.command;
        if (id.length === 0 || !isRecord(command)) {
          sendAck(client, id, false, "malformed command");
          return;
        }
        const name = command.name;
        if (typeof name !== "string") {
          sendAck(client, id, false, "malformed command");
          return;
        }

        switch (name) {
          case "start":
            userPaused = false;
            stage.setStatus("running");
            stage.emit("system.started", "Claude Code bridge is running", {
              feed: true,
            });
            flush();
            sendAck(client, id, true);
            return;
          case "pause":
            userPaused = true;
            stage.setStatus("paused");
            stage.emit("system.paused", "Claude Code bridge paused", {
              severity: "warning",
            });
            flush();
            sendAck(client, id, true);
            return;
          case "resume":
            userPaused = false;
            stage.setStatus("running");
            stage.emit("system.resumed", "Claude Code bridge resumed");
            flush();
            sendAck(client, id, true);
            return;
          case "reset":
            stage.reset();
            resetMappingState(mapping);
            userPaused = false;
            stage.setStatus("ready");
            stage.emit("system.reset", "Claude Code bridge reset");
            flush();
            sendAck(client, id, true);
            return;
          default:
            // The bridge cannot stop Claude Code, accept tasks or pause an
            // agent. It says so instead of pretending the command worked.
            sendAck(client, id, false, "not supported");
        }
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
          handleCommand(frame.text);
        }
        if (protocolError !== null) closeClient(protocolError.closeCode);
      });
      socket.on("close", () => {
        clients.delete(client);
      });
      socket.on("error", () => {
        clients.delete(client);
      });
    } catch {
      socket.destroy();
    }
  });

  let lastTick = now();
  const timer = setInterval(() => {
    const current = now();
    const reaped = reapOrphans(stage, mapping, current, orphanTimeoutMs);

    if (clients.size === 0) {
      // The world does not move without a viewer, but hook state still applies
      // and a reaped agent must not hold a bay forever. Its history is dropped.
      stage.drainEvents();
      dropFinishedAgents(stage);
      lastTick = current;
      return;
    }

    if (stage.simulationStatus !== "running") {
      lastTick = current;
      if (reaped.length > 0) flush();
      else stage.drainEvents();
      return;
    }

    const dt = Math.min(0.2, Math.max(0, (current - lastTick) / 1000));
    lastTick = current;
    stage.tick(dt);
    flush();
  }, tickMs);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_BRIDGE_PORT, "127.0.0.1", () => {
      resolve();
    });
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
      server.closeIdleConnections();
      server.closeAllConnections();
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
  const rawPort = process.env.BRIDGE_PORT;
  const parsedPort =
    rawPort === undefined ? DEFAULT_BRIDGE_PORT : Number.parseInt(rawPort, 10);
  const port =
    Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_BRIDGE_PORT;
  const capture = process.argv.includes("--capture");

  void startBridgeServer({ port, capture }).then(
    (server) => {
      console.log(`Claude Code bridge on http://127.0.0.1:${server.port}`);
      console.log(
        `Hooks: POST /hook  WebSocket: ws://127.0.0.1:${server.port}/ws`,
      );
      if (capture) {
        console.log(
          "Capture mode: printing hook event names and field types only, never values.",
        );
      }
      console.log(
        "Run the app with NEXT_PUBLIC_AGENT_BACKEND=websocket and NEXT_PUBLIC_AGENT_WS_URL set to the WebSocket URL.",
      );
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
