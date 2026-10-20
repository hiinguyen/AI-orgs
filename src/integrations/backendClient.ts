import type { AgentId } from "@/agents/agentTypes";
import { SIMULATION_CONFIG } from "@/simulation/simulationConfig";
import { useWorldStore } from "@/state/useWorldStore";
import { DEMO_TASK } from "@/tasks/taskActions";
import { SPRINT_TASKS } from "@/tasks/taskBacklog";
import type { CreateTaskInput, Task } from "@/tasks/taskTypes";
import type { AgentBackend } from "./AgentBackend.ts";
import { MockAgentBackend } from "./MockAgentBackend.ts";
import { WebSocketAgentBackend } from "./WebSocketAgentBackend.ts";

let backend: AgentBackend | null = null;

/**
 * One backend per tab. The websocket transport is selected only when both
 * environment variables are present; everything else runs the local engine.
 */
export function getBackend(): AgentBackend {
  if (backend !== null) return backend;
  const kind = process.env.NEXT_PUBLIC_AGENT_BACKEND;
  const url = process.env.NEXT_PUBLIC_AGENT_WS_URL;
  backend =
    kind === "websocket" && url
      ? new WebSocketAgentBackend(url)
      : new MockAgentBackend();
  return backend;
}

interface ActiveConnection {
  backend: AgentBackend;
  token: symbol;
  refs: number;
  unsubscribe: () => void;
}

let connection: ActiveConnection | null = null;

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) return error;
  return fallback;
}

async function attempt<T>(
  operation: () => Promise<T>,
  fallback: string,
): Promise<T | undefined> {
  try {
    const result = await operation();
    useWorldStore.getState().setBackendError(null);
    return result;
  } catch (error) {
    useWorldStore
      .getState()
      .setBackendError(describeError(error, fallback));
    return undefined;
  }
}

/**
 * Wires the selected backend into the store. Returns a disposer that is safe
 * under React StrictMode: the first cleanup tears the connection down, and a
 * second mount reconnects with a fresh wiring token so stale promises cannot
 * overwrite the new connection state.
 */
export function connectBackend(): () => void {
  const activeBackend = getBackend();
  const store = useWorldStore.getState();
  store.setBackend({
    kind: activeBackend.kind,
    label: activeBackend.label,
    simulated: activeBackend.simulated,
  });

  if (connection === null || connection.backend !== activeBackend) {
    const unsubscribeEvent = activeBackend.subscribe((event) => {
      useWorldStore.getState().applyEvent(event);
    });
    const unsubscribeSnapshot = activeBackend.subscribeSnapshot((snapshot) => {
      useWorldStore.getState().applySnapshot(snapshot);
    });
    connection = {
      backend: activeBackend,
      token: Symbol("backend-connection"),
      refs: 0,
      unsubscribe: () => {
        unsubscribeEvent();
        unsubscribeSnapshot();
      },
    };
  }

  const active = connection;
  active.refs += 1;
  const token = active.token;

  const existing = activeBackend.getSnapshot();
  if (existing !== null) {
    useWorldStore.getState().applySnapshot(existing);
  }

  void activeBackend.connect().then(
    () => {
      if (connection?.token === token) {
        useWorldStore.getState().setBackend({ connected: true, error: null });
      }
    },
    (error: unknown) => {
      if (connection?.token === token) {
        useWorldStore
          .getState()
          .setBackendError(
            describeError(error, "Could not connect to the backend"),
          );
      }
    },
  );

  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.refs -= 1;
    if (active.refs > 0) return;
    if (connection === active) connection = null;
    active.unsubscribe();
    useWorldStore.getState().setBackend({ connected: false });
    void active.backend.disconnect().catch(() => {
      // A failed teardown must not produce an unhandled rejection.
    });
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let scenarioBusy = false;

export const commands = {
  start: (): Promise<void | undefined> =>
    attempt(() => getBackend().start(), "Could not start the simulation"),

  pause: (): Promise<void | undefined> =>
    attempt(() => getBackend().pause(), "Could not pause the simulation"),

  resume: (): Promise<void | undefined> =>
    attempt(() => getBackend().resume(), "Could not resume the simulation"),

  reset: (): Promise<void | undefined> =>
    attempt(() => getBackend().reset(), "Could not reset the simulation"),

  setSpeed: (multiplier: number): Promise<void | undefined> =>
    attempt(
      () => getBackend().setSpeed(multiplier),
      "Could not change the simulation speed",
    ),

  submitTask: (input: CreateTaskInput): Promise<Task | undefined> =>
    attempt(() => getBackend().submitTask(input), "Could not submit the task"),

  /**
   * Submits a batch with a small stagger so the orchestrator queue and the
   * activity feed stay readable instead of receiving eight tasks at once.
   */
  submitTasks: async (
    inputs: readonly CreateTaskInput[],
    gapMs = 220,
  ): Promise<Task[]> => {
    const created: Task[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      if (index > 0 && gapMs > 0) await delay(gapMs);
      const task = await attempt(
        () => getBackend().submitTask(inputs[index]),
        "Could not submit a task",
      );
      if (task !== undefined) created.push(task);
    }
    return created;
  },

  pauseAgent: (id: AgentId): Promise<void | undefined> =>
    attempt(
      () => getBackend().pauseAgent(id),
      "Could not pause the agent",
    ),

  resumeAgent: (id: AgentId): Promise<void | undefined> =>
    attempt(
      () => getBackend().resumeAgent(id),
      "Could not resume the agent",
    ),

  /** Starts the local simulation once the world has rendered. */
  autoStartIfReady: async (): Promise<void> => {
    const state = useWorldStore.getState();
    if (!state.sceneReady || !SIMULATION_CONFIG.autoStart) return;
    const snapshot = getBackend().getSnapshot();
    if (snapshot !== null && snapshot.status !== "ready") return;
    await attempt(() => getBackend().start(), "Could not start the simulation");
  },

  /**
   * A deterministic demo run: reset, start, submit the scripted demo task,
   * select it and ask the camera for the collaboration area.
   */
  runDemo: async (): Promise<Task | null> => {
    if (scenarioBusy) return null;
    scenarioBusy = true;
    try {
      await attempt(() => getBackend().reset(), "Could not reset the simulation");
      await attempt(() => getBackend().start(), "Could not start the simulation");
      const task = await attempt(
        () => getBackend().submitTask(DEMO_TASK),
        "Could not start the demo",
      );
      if (task === undefined) return null;
      const state = useWorldStore.getState();
      state.selectTask(task.id);
      state.requestCamera({ preset: "collaboration" });
      return task;
    } finally {
      scenarioBusy = false;
    }
  },

  /**
   * Loads the eight-task sprint into the current world. Resumes a paused
   * simulation so the sprint visibly moves, as the shortcut promises.
   */
  loadSprint: async (): Promise<Task[]> => {
    if (scenarioBusy) return [];
    scenarioBusy = true;
    try {
      const snapshot = getBackend().getSnapshot();
      if (snapshot?.status === "paused") {
        await attempt(
          () => getBackend().resume(),
          "Could not resume the simulation",
        );
      } else if (snapshot?.status === "ready") {
        await attempt(
          () => getBackend().start(),
          "Could not start the simulation",
        );
      }

      const created: Task[] = [];
      for (let index = 0; index < SPRINT_TASKS.length; index += 1) {
        if (index > 0) await delay(220);
        const task = await attempt(
          () => getBackend().submitTask(SPRINT_TASKS[index]),
          "Could not submit a sprint task",
        );
        if (task !== undefined) created.push(task);
      }

      if (created.length > 0) {
        const state = useWorldStore.getState();
        state.setActiveTab("tasks");
        state.clearSelection();
      }
      return created;
    } finally {
      scenarioBusy = false;
    }
  },
};
