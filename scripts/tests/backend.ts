/**
 * Backend checks: the untrusted WebSocket boundary and connection recovery.
 * Phase 2 review items A.4 and A.6.
 */
import { DEMO_TASK } from "../../src/tasks/taskActions.ts";
import type { AgentEvent } from "../../src/events/eventTypes.ts";
import type { WorldSnapshot } from "../../src/integrations/AgentBackend.ts";
import type { BackendConnectionState } from "../../src/integrations/AgentBackend.ts";
import { SimulationEngine } from "../../src/simulation/SimulationEngine.ts";
import { TICK_SECONDS } from "../../src/simulation/simulationConfig.ts";
import { WebSocketAgentBackend } from "../../src/integrations/WebSocketAgentBackend.ts";
import {
  MAX_AGENTS,
  MAX_LINKS,
  MAX_MESSAGE_BYTES,
  MAX_PATH_POINTS,
  MAX_TASK_COLLECTION,
  MAX_TASKS,
  parseAgentEvent,
  parseServerMessage,
  parseWorldSnapshot,
} from "../../src/integrations/wsProtocol.ts";
import type { TestReporter } from "./harness.ts";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  static last: FakeSocket | null = null;

  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(_url: string) {
    FakeSocket.all.push(this);
    FakeSocket.last = this;
  }

  static reset(): void {
    FakeSocket.all = [];
    FakeSocket.last = null;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  /** A server-initiated drop that is not our own teardown. */
  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function liveSnapshot(): WorldSnapshot {
  const engine = new SimulationEngine();
  engine.start();
  engine.submitTask(DEMO_TASK);
  for (let index = 0; index < 60; index += 1) engine.tick(TICK_SECONDS);
  return engine.snapshot();
}

function wsEventFixture(): AgentEvent {
  return {
    id: "evt-ws-1",
    type: "agent.message",
    timestamp: Date.now(),
    simTime: 1.25,
    agentId: "orion",
    targetAgentId: "piper",
    message: "Boundary check",
    severity: "info",
    feed: true,
  };
}

export async function runBackendSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("8. WebSocket boundary");

  const snapshot = liveSnapshot();
  const wsTask = snapshot.tasks[0];
  check(
    "snapshot fixture has a task",
    wsTask !== undefined,
    `${snapshot.tasks.length} tasks`,
  );

  check(
    "a valid snapshot passes boundary validation",
    parseWorldSnapshot(snapshot) !== null,
  );
  check(
    "a snapshot with an unknown agent status is rejected",
    parseWorldSnapshot({
      ...snapshot,
      agents: snapshot.agents.map((agent, index) =>
        index === 0 ? { ...agent, status: "dancing" } : agent,
      ),
    }) === null,
  );
  check(
    "a snapshot with an unknown task priority is rejected",
    parseWorldSnapshot({
      ...snapshot,
      tasks: snapshot.tasks.map((task, index) =>
        index === 0 ? { ...task, priority: "urgent" } : task,
      ),
    }) === null,
  );
  check(
    "a snapshot with duplicate agent ids is rejected",
    parseWorldSnapshot({
      ...snapshot,
      agents: [snapshot.agents[0], snapshot.agents[0]],
    }) === null,
  );
  check(
    "a snapshot with too many agents is rejected",
    parseWorldSnapshot({
      ...snapshot,
      agents: Array.from({ length: MAX_AGENTS + 1 }, () => snapshot.agents[0]),
    }) === null,
  );
  check(
    "a snapshot with too many tasks is rejected",
    parseWorldSnapshot({
      ...snapshot,
      tasks: Array.from({ length: MAX_TASKS + 1 }, () => snapshot.tasks[0]),
    }) === null,
  );
  check(
    "a snapshot with too many links is rejected",
    parseWorldSnapshot({
      ...snapshot,
      links: Array.from({ length: MAX_LINKS + 1 }, (_, index) => ({
        id: `link-${index}`,
        from: "orion",
        to: "piper",
        kind: "message",
        startedAt: 0,
        endsAt: 1,
      })),
    }) === null,
  );
  check(
    "an agent path longer than 256 points is rejected",
    parseWorldSnapshot({
      ...snapshot,
      agents: snapshot.agents.map((agent, index) =>
        index === 0
          ? {
              ...agent,
              path: Array.from({ length: MAX_PATH_POINTS + 1 }, () => ({
                x: 0,
                z: 0,
              })),
            }
          : agent,
      ),
    }) === null,
  );
  check(
    "a task with more than 100 subtasks is rejected",
    parseWorldSnapshot({
      ...snapshot,
      tasks: snapshot.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              subtasks: Array.from(
                { length: MAX_TASK_COLLECTION + 1 },
                (_, subtaskIndex) => ({
                  id: `s-${subtaskIndex}`,
                  title: "probe",
                  done: false,
                }),
              ),
            }
          : task,
      ),
    }) === null,
  );
  check(
    "an oversized message is rejected before JSON.parse",
    parseServerMessage("x".repeat(MAX_MESSAGE_BYTES + 1)).kind === "invalid",
  );

  const wsEvent = wsEventFixture();
  check(
    "a valid event passes boundary validation",
    parseAgentEvent(wsEvent) !== null,
  );
  check(
    "an event with an unknown type is rejected",
    parseAgentEvent({ ...wsEvent, type: "agent.party" }) === null,
  );

  const nativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    FakeSocket.reset();
    const backend = new WebSocketAgentBackend("ws://boundary.test");
    const seenSnapshots: WorldSnapshot[] = [];
    const seenEvents: AgentEvent[] = [];
    backend.subscribeSnapshot((next) => seenSnapshots.push(next));
    backend.subscribe((event) => seenEvents.push(event));

    const connecting = backend.connect();
    const socket = FakeSocket.last;
    check("the websocket transport opens a socket", socket !== null);
    if (socket === null) throw new Error("FakeSocket was not created");
    socket.open();
    await connecting;

    socket.receive(JSON.stringify({ type: "snapshot", snapshot }));
    check(
      "a snapshot updates getSnapshot and notifies listeners",
      backend.getSnapshot()?.clock === snapshot.clock &&
        seenSnapshots.length === 1,
    );

    socket.receive(JSON.stringify({ type: "event", event: wsEvent }));
    check(
      "an event notifies subscribers",
      seenEvents.length === 1 && seenEvents[0].message === wsEvent.message,
    );

    const nativeWarn = console.warn;
    let warnings = 0;
    console.warn = () => {
      warnings += 1;
    };
    try {
      socket.receive(
        JSON.stringify({
          type: "snapshot",
          snapshot: { ...snapshot, agents: [{ id: "orion" }] },
        }),
      );
      socket.receive(
        JSON.stringify({
          type: "event",
          event: { ...wsEvent, type: "agent.party" },
        }),
      );
      socket.receive("not json");
      socket.receive("x".repeat(MAX_MESSAGE_BYTES + 1));
    } finally {
      console.warn = nativeWarn;
    }
    check(
      "malformed and oversized messages warn once each and leave state untouched",
      warnings === 4 &&
        backend.getSnapshot()?.clock === snapshot.clock &&
        seenEvents.length === 1,
      `${warnings} warnings`,
    );

    if (wsTask === undefined) throw new Error("Task fixture missing");
    const submitted = backend.submitTask(DEMO_TASK);
    const sentSubmit = socket.sent[socket.sent.length - 1];
    const submitMessage = JSON.parse(sentSubmit ?? "{}") as {
      id?: string;
    };
    socket.receive(
      JSON.stringify({
        type: "ack",
        id: submitMessage.id,
        ok: true,
        result: wsTask,
      }),
    );
    const created = await submitted;
    check(
      "submitTask resolves with the task from the matching ack",
      created.id === wsTask.id,
    );

    const rejected = backend.start();
    const sentStart = socket.sent[socket.sent.length - 1];
    const startMessage = JSON.parse(sentStart ?? "{}") as { id?: string };
    socket.receive(
      JSON.stringify({
        type: "ack",
        id: startMessage.id,
        ok: false,
        error: "start is locked",
      }),
    );
    let rejection = "";
    try {
      await rejected;
    } catch (error) {
      rejection = error instanceof Error ? error.message : "";
    }
    check(
      "a failed ack rejects the command with the backend message",
      rejection === "start is locked",
      rejection,
    );

    const pending = backend.pause();
    await backend.disconnect();
    let disconnected = false;
    try {
      await pending;
    } catch {
      disconnected = true;
    }
    check("pending acks reject on disconnect", disconnected);
    check(
      "disconnect detaches the old socket handlers",
      socket.onopen === null &&
        socket.onmessage === null &&
        socket.onerror === null &&
        socket.onclose === null,
    );
  } finally {
    globalThis.WebSocket = nativeWebSocket;
  }

  // ------------------------------------------------------- connection recovery
  group("9. WebSocket connection recovery");
  const recoveryNative = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    FakeSocket.reset();
    const backend = new WebSocketAgentBackend("ws://recovery.test", {
      connectTimeoutMs: 50,
      reconnectBaseMs: 5,
      reconnectMaxMs: 20,
    });
    const states: BackendConnectionState[] = [];
    backend.subscribeConnection((state) => states.push(state));

    const connecting = backend.connect();
    const first = FakeSocket.last;
    if (first === null) throw new Error("FakeSocket was not created");
    first.open();
    await connecting;
    check(
      "an open socket reports connected",
      states[states.length - 1]?.connected === true,
    );

    const pending = backend.pause();
    const pendingResult = pending.then(
      () => false,
      () => true,
    );
    first.drop();
    const pendingRejected = await pendingResult;
    check(
      "a dropped socket reports disconnected with an error",
      states[states.length - 1]?.connected === false &&
        states[states.length - 1]?.error !== null,
    );
    check("pending acks reject when the socket drops", pendingRejected);

    await delay(30);
    check(
      "the transport opens a fresh socket after the backoff",
      FakeSocket.all.length === 2 && FakeSocket.last !== first,
    );
    const retry = FakeSocket.last;
    if (retry === null) throw new Error("Reconnect socket was not created");
    retry.open();
    check(
      "reconnecting reports connected again",
      states[states.length - 1]?.connected === true,
    );
    await backend.disconnect();

    // A first connection that never opens is retried too, so the "Live backend
    // reconnecting" label in the UI is always true.
    FakeSocket.reset();
    const neverOpened = new WebSocketAgentBackend("ws://initial.test", {
      connectTimeoutMs: 50,
      reconnectBaseMs: 5,
      reconnectMaxMs: 10,
    });
    const initialConnect = neverOpened.connect();
    const failedSocket = FakeSocket.last;
    if (failedSocket === null) throw new Error("FakeSocket was not created");
    failedSocket.drop();
    let initialRejected = false;
    try {
      await initialConnect;
    } catch {
      initialRejected = true;
    }
    await delay(25);
    check(
      "a failed first connection is retried with backoff",
      initialRejected && FakeSocket.all.length === 2,
      `${initialRejected}, ${FakeSocket.all.length} sockets`,
    );
    await neverOpened.disconnect();

    // A stale attempt must not clear a newer connecting promise.
    FakeSocket.reset();
    const racing = new WebSocketAgentBackend("ws://stale.test", {
      connectTimeoutMs: 20,
      reconnectBaseMs: 5,
    });
    const stale = racing.connect();
    const staleSettled = stale.then(
      () => "resolved",
      () => "rejected",
    );
    await racing.disconnect();
    const fresh = racing.connect();
    const freshSocket = FakeSocket.last;
    if (freshSocket === null) throw new Error("Fresh socket was not created");
    check(
      "a disconnect detaches the stale socket",
      FakeSocket.all[0].onmessage === null,
    );
    const staleOutcome = await staleSettled;
    check(
      "a stale attempt cannot clear a newer connecting promise",
      racing.connect() === fresh,
      `${staleOutcome}, ${FakeSocket.all.length} sockets`,
    );
    freshSocket.open();
    let freshResolved = false;
    await fresh.then(() => {
      freshResolved = true;
    });
    check(
      "the newer attempt still resolves after the stale timeout",
      freshResolved,
    );
    await racing.disconnect();
  } finally {
    globalThis.WebSocket = recoveryNative;
  }
}
