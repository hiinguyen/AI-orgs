import type { AgentId } from "../agents/agentTypes.ts";
import { isAgentId } from "../agents/agentTypes.ts";
import type { AgentEvent } from "../events/eventTypes.ts";
import type { CreateTaskInput, Task } from "../tasks/taskTypes.ts";
import type {
  AgentBackend,
  BackendConnectionState,
  WorldSnapshot,
} from "./AgentBackend.ts";
import { parseServerMessage, parseTask } from "./wsProtocol.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface WebSocketBackendOptions {
  connectTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

type BackendCommand =
  | { name: "start" | "stop" | "pause" | "resume" | "reset" }
  | { name: "setSpeed"; multiplier: number }
  | { name: "submitTask"; input: CreateTaskInput }
  | { name: "pauseAgent" | "resumeAgent"; agentId: AgentId };

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Talks to a real orchestrator over the JSON protocol in spec 3.5. Every
 * inbound message is untrusted: protocol validation lives in `wsProtocol.ts`.
 *
 * A dropped socket is not silent. The transport reports it through
 * `subscribeConnection`, rejects pending acknowledgements and reconnects with
 * capped exponential backoff until `disconnect()` is called.
 */
export class WebSocketAgentBackend implements AgentBackend {
  readonly kind = "websocket" as const;
  readonly label = "Live backend";
  readonly simulated = false;

  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private snapshot: WorldSnapshot | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number;
  private reconnectEnabled = false;

  private connection: BackendConnectionState = { connected: false, error: null };
  private readonly connectionListeners = new Set<
    (state: BackendConnectionState) => void
  >();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly eventListeners = new Set<(event: AgentEvent) => void>();
  private readonly snapshotListeners = new Set<
    (snapshot: WorldSnapshot) => void
  >();

  constructor(url: string, options: WebSocketBackendOptions = {}) {
    this.url = url;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.reconnectBaseMs = options.reconnectBaseMs ?? RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS;
    this.reconnectDelayMs = this.reconnectBaseMs;
  }

  connect(): Promise<void> {
    this.reconnectEnabled = true;
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connecting !== null) return this.connecting;

    const attempt = new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        reject(new Error("Could not open the backend WebSocket"));
        this.scheduleReconnect();
        return;
      }

      this.socket = socket;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(message));
      };

      const timer = setTimeout(() => {
        fail("Timed out connecting to the backend");
        socket.close();
      }, this.connectTimeoutMs);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.reconnectDelayMs = this.reconnectBaseMs;
        this.reconnectEnabled = true;
        this.setConnection({ connected: true, error: null });
        resolve();
      };
      socket.onerror = () => {
        fail("Could not connect to the backend");
      };
      socket.onclose = () => {
        const shouldReconnect = this.reconnectEnabled;
        fail("Backend connection closed");
        if (this.socket !== socket) return;
        this.socket = null;
        this.rejectPending(new Error("Backend disconnected"));
        this.setConnection({
          connected: false,
          error: "Backend connection closed",
        });
        if (shouldReconnect) this.scheduleReconnect();
      };
      socket.onmessage = (message: MessageEvent) => {
        if (this.socket !== socket) return;
        this.handleMessage(message.data);
      };
    });

    this.connecting = attempt;
    const settle = () => {
      // A stale attempt (disconnect plus a new mount) must never clear the
      // promise that belongs to the current connection.
      if (this.connecting === attempt) this.connecting = null;
    };
    void attempt.then(settle, settle);
    return attempt;
  }

  async disconnect(): Promise<void> {
    this.reconnectEnabled = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    this.connecting = null;

    if (socket !== null) {
      // Detach first: a closing socket must not deliver a snapshot, an event
      // or a connection-status change after teardown.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    }

    this.rejectPending(new Error("Backend disconnected"));
    this.setConnection({ connected: false, error: null });
  }

  async start(): Promise<void> {
    await this.command({ name: "start" });
  }

  async stop(): Promise<void> {
    await this.command({ name: "stop" });
  }

  async pause(): Promise<void> {
    await this.command({ name: "pause" });
  }

  async resume(): Promise<void> {
    await this.command({ name: "resume" });
  }

  async reset(): Promise<void> {
    await this.command({ name: "reset" });
  }

  async setSpeed(multiplier: number): Promise<void> {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error("Speed must be a positive number");
    }
    await this.command({ name: "setSpeed", multiplier });
  }

  async submitTask(input: CreateTaskInput): Promise<Task> {
    const result = await this.command({ name: "submitTask", input });
    const task = parseTask(result);
    if (task === null) {
      throw new Error("Backend acknowledgement did not contain a valid task");
    }
    return task;
  }

  async pauseAgent(id: AgentId): Promise<void> {
    if (!isAgentId(id)) throw new Error("Unknown agent");
    await this.command({ name: "pauseAgent", agentId: id });
  }

  async resumeAgent(id: AgentId): Promise<void> {
    if (!isAgentId(id)) throw new Error("Unknown agent");
    await this.command({ name: "resumeAgent", agentId: id });
  }

  getSnapshot(): WorldSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeSnapshot(listener: (snapshot: WorldSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  subscribeConnection(
    listener: (state: BackendConnectionState) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private setConnection(state: BackendConnectionState): void {
    if (
      this.connection.connected === state.connected &&
      this.connection.error === state.error
    ) {
      return;
    }
    this.connection = state;
    for (const listener of this.connectionListeners) listener(state);
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      this.reconnectMaxMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.reconnectEnabled) return;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private command(command: BackendCommand): Promise<unknown> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Backend is not connected"));
    }

    const id = createCommandId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Backend did not acknowledge ${command.name} within ${
              ACK_TIMEOUT_MS / 1000
            }s`,
          ),
        );
      }, ACK_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        socket.send(JSON.stringify({ type: "command", id, command }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("Could not send the command"),
        );
      }
    });
  }

  private handleMessage(data: unknown): void {
    const message = parseServerMessage(data);
    switch (message.kind) {
      case "invalid":
        console.warn(`[agent-backend] ${message.reason}`);
        return;
      case "snapshot":
        this.snapshot = message.snapshot;
        for (const listener of this.snapshotListeners) {
          listener(message.snapshot);
        }
        return;
      case "event":
        for (const listener of this.eventListeners) listener(message.event);
        return;
      case "ack": {
        const pending = this.pending.get(message.id);
        if (pending === undefined) {
          // A late ack for a timed out or disconnected command.
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(
            new Error(message.error ?? "Backend rejected the command"),
          );
        }
        return;
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
