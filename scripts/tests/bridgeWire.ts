/**
 * Phase 10 checks over the wire: capability announcement, the hook HTTP
 * boundary and a real WebSocket round trip against the bridge server.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BackendCapabilities } from "../../src/integrations/AgentBackend.ts";
import {
  DEFAULT_BACKEND_CAPABILITIES,
  isCapabilityEnabled,
} from "../../src/integrations/AgentBackend.ts";
import type { WorldSnapshot } from "../../src/integrations/AgentBackend.ts";
import { WebSocketAgentBackend } from "../../src/integrations/WebSocketAgentBackend.ts";
import { parseServerMessage } from "../../src/integrations/wsProtocol.ts";
import { isAllowedOrigin } from "../../bridge/lib/origin.ts";
import {
  BRIDGE_CAPABILITIES,
  MAX_HOOK_BODY_BYTES,
  startBridgeServer,
} from "../../bridge/server.ts";
import type { BridgeServer } from "../../bridge/server.ts";
import type { TestReporter } from "./harness.ts";

type ServerMessage = ReturnType<typeof parseServerMessage>;

interface ClientHandle {
  socket: WebSocket;
  messages: ServerMessage[];
  waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void>;
  close(): void;
}

function runCapabilitySuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("41. Capability announcement");

  const hello = parseServerMessage(
    JSON.stringify({
      type: "hello",
      capabilities: {
        submitTask: false,
        pauseAgent: false,
        setSpeed: false,
      },
    }),
  );
  check(
    "a valid hello is parsed with its capabilities",
    hello.kind === "hello" &&
      !hello.capabilities.submitTask &&
      !hello.capabilities.pauseAgent &&
      !hello.capabilities.setSpeed,
  );

  const malformed = parseServerMessage(
    JSON.stringify({ type: "hello", capabilities: { submitTask: false } }),
  );
  check("a malformed hello is ignored", malformed.kind === "invalid");

  const backend = new WebSocketAgentBackend("ws://127.0.0.1:1");
  check(
    "a backend that never sends hello keeps every capability",
    isCapabilityEnabled(DEFAULT_BACKEND_CAPABILITIES, "submitTask") &&
      isCapabilityEnabled(DEFAULT_BACKEND_CAPABILITIES, "pauseAgent") &&
      isCapabilityEnabled(DEFAULT_BACKEND_CAPABILITIES, "setSpeed") &&
      isCapabilityEnabled(backend.getCapabilities(), "submitTask"),
  );
  check(
    "the bridge announces all three capabilities as false",
    !isCapabilityEnabled(BRIDGE_CAPABILITIES, "submitTask") &&
      !isCapabilityEnabled(BRIDGE_CAPABILITIES, "pauseAgent") &&
      !isCapabilityEnabled(BRIDGE_CAPABILITIES, "setSpeed"),
  );
  check(
    "the WebSocket Origin allow-list admits localhost only",
    isAllowedOrigin(undefined) &&
      isAllowedOrigin("http://localhost:3000") &&
      isAllowedOrigin("http://127.0.0.1:3000") &&
      !isAllowedOrigin("http://evil.example"),
  );
}

function connectClient(url: string): Promise<ClientHandle> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: ServerMessage[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("timed out opening the bridge WebSocket"));
    }, 3000);

    socket.addEventListener("message", (event) => {
      messages.push(parseServerMessage(event.data));
    });
    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        socket,
        messages,
        waitFor(predicate, timeoutMs, label) {
          return new Promise((done, fail) => {
            const started = Date.now();
            const poll = () => {
              if (predicate()) {
                done();
                return;
              }
              if (Date.now() - started > timeoutMs) {
                fail(new Error(`timed out waiting for ${label}`));
                return;
              }
              setTimeout(poll, 10);
            };
            poll();
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("bridge WebSocket failed to open"));
    });
  });
}

async function openBridge(): Promise<{
  server: BridgeServer;
  client: ClientHandle;
  hookUrl: string;
}> {
  const server = await startBridgeServer({
    port: 0,
    tickMs: 25,
    walkSpeed: 80,
    spawnHoldSeconds: 0,
    emoteSeconds: 0.02,
    fadeSeconds: 0.02,
  });
  try {
    const client = await connectClient(
      `ws://127.0.0.1:${server.port}/ws`,
    );
    return {
      server,
      client,
      hookUrl: `http://127.0.0.1:${server.port}/hook`,
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

function lastSnapshot(messages: ServerMessage[]): WorldSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind === "snapshot") return message.snapshot;
  }
  return null;
}

function hasEvent(messages: ServerMessage[], type: string): boolean {
  return messages.some(
    (message) => message.kind === "event" && message.event.type === type,
  );
}

function findHello(messages: ServerMessage[]): BackendCapabilities | null {
  const hello = messages.find((message) => message.kind === "hello");
  return hello?.kind === "hello" ? hello.capabilities : null;
}

async function postHook(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  response.body?.cancel();
  return response.status;
}

function validHook(event: string, extra: Record<string, unknown> = {}) {
  return {
    hook_event_name: event,
    session_id: "session-http",
    cwd: "/repo",
    ...extra,
  };
}

async function runHttpSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("42. Hook HTTP boundary");

  const server = await startBridgeServer({
    port: 0,
    tickMs: 30,
    walkSpeed: 80,
    spawnHoldSeconds: 0,
    emoteSeconds: 0.02,
    fadeSeconds: 0.02,
  });
  const url = `http://127.0.0.1:${server.port}/hook`;

  try {
    const origin = await postHook(url, validHook("SessionStart"), {
      origin: "http://evil.example",
    });
    check("a request with an Origin header gets 403", origin === 403);

    const type = await postHook(url, validHook("SessionStart"), {
      "content-type": "text/plain",
    });
    check("a non-JSON content type is refused", type === 415);

    const oversize = await postHook(url, {
      ...validHook("SessionStart"),
      pad: "x".repeat(MAX_HOOK_BODY_BYTES),
    });
    check("a body over 256 KiB gets 413", oversize === 413);

    const malformed = await postHook(url, "{not json");
    check("malformed JSON gets 400", malformed === 400);

    const missing = await postHook(url, {
      hook_event_name: "SessionStart",
      cwd: "/repo",
    });
    check("a missing required field gets 400", missing === 400);

    const unknown = await postHook(url, validHook("NotAHook"));
    check("an unknown hook name is ignored with 204", unknown === 204);

    const valid = await postHook(url, validHook("SessionStart"));
    check("a valid hook gets 204", valid === 204);

    const health = await fetch(`http://127.0.0.1:${server.port}/`);
    check("the bridge answers a plain health request", health.status === 200);
    health.body?.cancel();
  } finally {
    await server.close();
  }
}

async function runWebSocketOpenSuite(
  reporter: TestReporter,
): Promise<void> {
  const { check, group } = reporter;
  group("43. Bridge WebSocket connect");

  const { server, client } = await openBridge();
  try {
    await client.waitFor(
      () => findHello(client.messages) !== null,
      3000,
      "the hello frame",
    );
    const capabilities = findHello(client.messages);
    check(
      "a client first receives hello with every capability false",
      capabilities !== null &&
        !capabilities.submitTask &&
        !capabilities.pauseAgent &&
        !capabilities.setSpeed,
    );

    await client.waitFor(
      () => lastSnapshot(client.messages) !== null,
      3000,
      "the first snapshot",
    );
    check(
      "a client receives a snapshot on connect",
      lastSnapshot(client.messages)?.agents.length === 6,
    );

    client.socket.send(
      JSON.stringify({
        type: "command",
        id: "unsupported-1",
        command: { name: "submitTask" },
      }),
    );
    await client.waitFor(
      () =>
        client.messages.some(
          (message) =>
            message.kind === "ack" && message.id === "unsupported-1",
        ),
      3000,
      "the unsupported ack",
    );
    const ack = client.messages.find(
      (message) =>
        message.kind === "ack" && message.id === "unsupported-1",
    );
    check(
      "a command the bridge cannot do answers not supported",
      ack?.kind === "ack" && !ack.ok && ack.error === "not supported",
    );
  } finally {
    client.close();
    await server.close();
  }
}

async function runWebSocketSessionSuite(
  reporter: TestReporter,
): Promise<void> {
  const { check, group } = reporter;
  group("44. Bridge WebSocket session");

  const { server, client, hookUrl } = await openBridge();
  try {
    await client.waitFor(
      () => lastSnapshot(client.messages) !== null,
      3000,
      "the first snapshot",
    );

    await postHook(hookUrl, validHook("SessionStart"));
    await client.waitFor(
      () =>
        lastSnapshot(client.messages)?.agents.find(
          (agent) => agent.id === "orion",
        )?.status === "thinking",
      3000,
      "Orion thinking",
    );
    check(
      "a hook reaches the client as an event and a snapshot",
      hasEvent(client.messages, "system.started"),
    );

    await postHook(
      hookUrl,
      validHook("SubagentStart", {
        agent_id: "agent-ws-1",
        agent_type: "code-reviewer",
      }),
    );
    await client.waitFor(
      () =>
        lastSnapshot(client.messages)?.agents.some(
          (agent) => agent.id === "agent-ws-1",
        ) === true,
      3000,
      "the spawned agent",
    );
    check(
      "a subagent appears in the live roster",
      hasEvent(client.messages, "agent.spawned") &&
        lastSnapshot(client.messages)?.profiles.some(
          (profile) => profile.id === "agent-ws-1",
        ) === true,
    );

    await postHook(
      hookUrl,
      validHook("PreToolUse", {
        agent_id: "agent-ws-1",
        agent_type: "code-reviewer",
        tool_name: "Read",
        tool_input: { file_path: "/repo/src/ws.ts" },
      }),
    );
    await client.waitFor(
      () =>
        lastSnapshot(client.messages)?.agents.find(
          (agent) => agent.id === "agent-ws-1",
        )?.activity === "Tool: src/ws.ts",
      3000,
      "the tool activity",
    );
    check(
      "tool calls update the agent activity",
      lastSnapshot(client.messages)?.agents.find(
        (agent) => agent.id === "agent-ws-1",
      )?.activity === "Tool: src/ws.ts",
    );
  } finally {
    client.close();
    await server.close();
  }
}

async function runWebSocketStopSuite(
  reporter: TestReporter,
): Promise<void> {
  const { check, group } = reporter;
  group("45. Bridge WebSocket despawn");

  const { server, client, hookUrl } = await openBridge();
  try {
    await client.waitFor(
      () => lastSnapshot(client.messages) !== null,
      3000,
      "the first snapshot",
    );
    await postHook(
      hookUrl,
      validHook("SubagentStart", {
        agent_id: "agent-ws-stop",
        agent_type: "tdd-guide",
      }),
    );
    await client.waitFor(
      () =>
        lastSnapshot(client.messages)?.agents.some(
          (agent) => agent.id === "agent-ws-stop",
        ) === true,
      3000,
      "the spawned agent",
    );

    await postHook(
      hookUrl,
      validHook("SubagentStop", {
        agent_id: "agent-ws-stop",
        agent_type: "tdd-guide",
        last_assistant_message: "Done.",
      }),
    );
    await client.waitFor(
      () => hasEvent(client.messages, "agent.despawned"),
      3000,
      "the despawn event",
    );
    check(
      "a subagent stop becomes a success despawn",
      client.messages.some(
        (message) =>
          message.kind === "event" &&
          message.event.type === "agent.despawned" &&
          message.event.metadata?.outcome === "success",
      ),
    );
  } finally {
    client.close();
    await server.close();
  }
}

async function runLateClientSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("46. Late-connecting client");

  const server = await startBridgeServer({
    port: 0,
    tickMs: 30,
    walkSpeed: 80,
    spawnHoldSeconds: 0,
  });
  const hookUrl = `http://127.0.0.1:${server.port}/hook`;

  try {
    await postHook(hookUrl, validHook("SessionStart"));
    await postHook(
      hookUrl,
      validHook("SubagentStart", {
        agent_id: "agent-late",
        agent_type: "tdd-guide",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    const client = await connectClient(
      `ws://127.0.0.1:${server.port}/ws`,
    );
    try {
      await client.waitFor(
        () => lastSnapshot(client.messages) !== null,
        3000,
        "the late snapshot",
      );
      const snapshot = lastSnapshot(client.messages);
      check(
        "hooks applied before any client are visible to a late client",
        snapshot?.profiles.some(
          (profile) => profile.id === "agent-late",
        ) === true &&
          snapshot?.agents.some((agent) => agent.id === "agent-late") ===
            true,
      );
    } finally {
      client.close();
    }
  } finally {
    await server.close();
  }
}

const FORWARDER_PATH = fileURLToPath(
  new URL("../../bridge/hook-forward.mjs", import.meta.url),
);

function sendCommand(client: ClientHandle, id: string, name: string): void {
  client.socket.send(
    JSON.stringify({ type: "command", id, command: { name } }),
  );
}

async function commandAck(
  client: ClientHandle,
  id: string,
  name: string,
): Promise<boolean> {
  sendCommand(client, id, name);
  await client.waitFor(
    () =>
      client.messages.some(
        (message) => message.kind === "ack" && message.id === id,
      ),
    3000,
    `the ${name} ack`,
  );
  const ack = client.messages.find(
    (message) => message.kind === "ack" && message.id === id,
  );
  return ack?.kind === "ack" && ack.ok;
}

async function runNoClientCapSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("47. Finished agents with no client");

  const server = await startBridgeServer({
    port: 0,
    tickMs: 25,
    walkSpeed: 80,
    spawnHoldSeconds: 0,
    emoteSeconds: 0.02,
    fadeSeconds: 0.02,
    maxHookCallsPerSecond: 100000,
  });
  const hookUrl = `http://127.0.0.1:${server.port}/hook`;
  try {
    await postHook(hookUrl, validHook("SessionStart"));
    for (let index = 0; index < 64; index += 1) {
      const id = `agent-cap-${index}`;
      await postHook(
        hookUrl,
        validHook("SubagentStart", { agent_id: id, agent_type: "tdd-guide" }),
      );
      await postHook(
        hookUrl,
        validHook("SubagentStop", { agent_id: id, agent_type: "tdd-guide" }),
      );
    }
    for (let index = 0; index < 6; index += 1) {
      await postHook(
        hookUrl,
        validHook("SubagentStart", {
          agent_id: `agent-new-${index}`,
          agent_type: "tdd-guide",
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    const client = await connectClient(`ws://127.0.0.1:${server.port}/ws`);
    try {
      await client.waitFor(
        () => lastSnapshot(client.messages) !== null,
        3000,
        "the late snapshot",
      );
      const snapshot = lastSnapshot(client.messages);
      const ids = snapshot?.agents.map((agent) => agent.id) ?? [];
      const live = ids.filter((id) => id.startsWith("agent-"));
      check(
        "a late client sees the 6 new agents plus core agents only",
        snapshot?.agents.length === 12 &&
          live.length === 6 &&
          live.every((id) => id.startsWith("agent-new-")),
      );
    } finally {
      client.close();
    }
  } finally {
    await server.close();
  }
}

async function runResetThenHookSuite(
  reporter: TestReporter,
): Promise<void> {
  const { check, group } = reporter;
  group("48. Hooks after a UI reset and pause");

  const { server, client, hookUrl } = await openBridge();
  try {
    await client.waitFor(
      () => lastSnapshot(client.messages) !== null,
      3000,
      "the first snapshot",
    );
    await postHook(hookUrl, validHook("SessionStart"));
    await commandAck(client, "reset-a", "reset");
    await client.waitFor(
      () => lastSnapshot(client.messages)?.status === "ready",
      3000,
      "the ready status",
    );
    await postHook(
      hookUrl,
      validHook("SubagentStart", {
        agent_id: "agent-after-reset",
        agent_type: "tdd-guide",
      }),
    );
    await client.waitFor(
      () => lastSnapshot(client.messages)?.status === "running",
      3000,
      "the running status",
    );
    check("an accepted hook after reset sets status to running", true);
    await client.waitFor(
      () => {
        const agent = lastSnapshot(client.messages)?.agents.find(
          (candidate) => candidate.id === "agent-after-reset",
        );
        return agent !== undefined && agent.path.length > 0;
      },
      3000,
      "the robot walking",
    );
    check("a subagent spawned after reset walks to its bay", true);

    await commandAck(client, "pause-a", "pause");
    await postHook(
      hookUrl,
      validHook("PreToolUse", {
        agent_id: "agent-after-reset",
        agent_type: "tdd-guide",
        tool_name: "Read",
        tool_input: { file_path: "/repo/src/p.ts" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    check(
      "a user pause is not overridden by a later hook",
      lastSnapshot(client.messages)?.status === "paused",
    );
  } finally {
    client.close();
    await server.close();
  }
}

async function runStatusCommandSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("49. Start, pause, resume and reset over the wire");

  const { server, client, hookUrl } = await openBridge();
  try {
    await client.waitFor(
      () => lastSnapshot(client.messages) !== null,
      3000,
      "the first snapshot",
    );
    await postHook(
      hookUrl,
      validHook("SubagentStart", {
        agent_id: "agent-cmd",
        agent_type: "tdd-guide",
      }),
    );
    await client.waitFor(
      () =>
        lastSnapshot(client.messages)?.agents.some(
          (agent) => agent.id === "agent-cmd",
        ) === true,
      3000,
      "the spawned agent",
    );

    const pauseOk = await commandAck(client, "c-pause", "pause");
    await client.waitFor(
      () => lastSnapshot(client.messages)?.status === "paused",
      3000,
      "the paused status",
    );
    check(
      "pause is accepted and reports paused",
      pauseOk && lastSnapshot(client.messages)?.status === "paused",
    );

    const resumeOk = await commandAck(client, "c-resume", "resume");
    await client.waitFor(
      () => lastSnapshot(client.messages)?.status === "running",
      3000,
      "the running status",
    );
    check(
      "resume is accepted and reports running",
      resumeOk && lastSnapshot(client.messages)?.status === "running",
    );

    await commandAck(client, "c-pause-2", "pause");
    const startOk = await commandAck(client, "c-start", "start");
    await client.waitFor(
      () => lastSnapshot(client.messages)?.status === "running",
      3000,
      "the running status after start",
    );
    check(
      "start is accepted and reports running",
      startOk && lastSnapshot(client.messages)?.status === "running",
    );
    check(
      "pause, resume and start never touch the live roster",
      lastSnapshot(client.messages)?.agents.some(
        (agent) => agent.id === "agent-cmd",
      ) === true,
    );

    const resetOk = await commandAck(client, "c-reset", "reset");
    await client.waitFor(
      () => lastSnapshot(client.messages)?.agents.length === 6,
      3000,
      "the cleared roster",
    );
    const after = lastSnapshot(client.messages);
    check(
      "reset is accepted, clears the stage and reports ready",
      resetOk && after?.agents.length === 6 && after.status === "ready",
    );
  } finally {
    client.close();
    await server.close();
  }
}

interface ForwarderRun {
  code: number | null;
  stdout: string;
  elapsedMs: number;
}

function runForwarder(
  port: string,
  stdin: "never-closes" | "json",
): Promise<ForwarderRun> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [FORWARDER_PATH], {
      env: { ...process.env, BRIDGE_PORT: port },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const guard = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("hook-forward.mjs did not exit in 5 s"));
    }, 5000);
    child.on("close", (code) => {
      clearTimeout(guard);
      resolve({ code, stdout, elapsedMs: Date.now() - started });
    });
    if (stdin === "json") {
      child.stdin.end(JSON.stringify(validHook("SessionStart")));
    } else {
      // Keep the pipe open and silent, like `sleep 8 | hook-forward.mjs`.
      child.stdin.write("{");
    }
  });
}

async function runForwarderSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("50. Hook forwarder never blocks");

  const stalled = await runForwarder("8791", "never-closes");
  check(
    "a never-closing stdin exits 0 in well under 2 s and prints nothing",
    stalled.code === 0 && stalled.elapsedMs < 1900 && stalled.stdout === "",
  );

  const server = await startBridgeServer({ port: 0, tickMs: 30 });
  await server.close();
  const down = await runForwarder(String(server.port), "json");
  check(
    "with the bridge not running it exits 0 quickly and prints nothing",
    down.code === 0 && down.elapsedMs < 1900 && down.stdout === "",
  );

  const live = await startBridgeServer({ port: 0, tickMs: 30 });
  try {
    const up = await runForwarder(String(live.port), "json");
    check(
      "with the bridge running it exits 0 and prints nothing",
      up.code === 0 && up.stdout === "",
    );
  } finally {
    await live.close();
  }
}

export async function runBridgeWireSuites(
  reporter: TestReporter,
): Promise<void> {
  runCapabilitySuite(reporter);
  await runHttpSuite(reporter);
  await runWebSocketOpenSuite(reporter);
  await runWebSocketSessionSuite(reporter);
  await runWebSocketStopSuite(reporter);
  await runLateClientSuite(reporter);
  await runNoClientCapSuite(reporter);
  await runResetThenHookSuite(reporter);
  await runStatusCommandSuite(reporter);
  await runForwarderSuite(reporter);
}
