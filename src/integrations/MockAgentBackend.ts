import type { AgentId } from "../agents/agentTypes.ts";
import type { AgentEvent } from "../events/eventTypes.ts";
import { SimulationEngine } from "../simulation/SimulationEngine.ts";
import { SIMULATION_CONFIG } from "../simulation/simulationConfig.ts";
import type { CreateTaskInput, Task } from "../tasks/taskTypes.ts";
import type {
  AgentBackend,
  WorldSnapshot,
} from "./AgentBackend.ts";

/**
 * Runs the deterministic local simulation on a fixed interval. Each real-time
 * step is clamped so a sleeping tab cannot fast-forward the world.
 */
export class MockAgentBackend implements AgentBackend {
  readonly kind = "mock" as const;
  readonly label = "Local simulation";
  readonly simulated = true;

  private readonly engine: SimulationEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private booted = false;

  constructor(engine: SimulationEngine = new SimulationEngine()) {
    this.engine = engine;
  }

  async connect(): Promise<void> {
    if (this.timer !== null) return;
    if (!this.booted) {
      this.booted = true;
      this.engine.emitBootEvents();
    }
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      this.step();
    }, 1000 / SIMULATION_CONFIG.tickHz);
    this.engine.publishSnapshot();
  }

  async disconnect(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async start(): Promise<void> {
    this.engine.start();
  }

  async stop(): Promise<void> {
    this.engine.stop();
  }

  async pause(): Promise<void> {
    this.engine.pause();
  }

  async resume(): Promise<void> {
    this.engine.resume();
  }

  async reset(): Promise<void> {
    this.engine.reset();
  }

  async setSpeed(multiplier: number): Promise<void> {
    this.engine.setSpeed(multiplier);
  }

  async submitTask(input: CreateTaskInput): Promise<Task> {
    return this.engine.submitTask(input);
  }

  async pauseAgent(id: AgentId): Promise<void> {
    this.engine.pauseAgent(id);
  }

  async resumeAgent(id: AgentId): Promise<void> {
    this.engine.resumeAgent(id);
  }

  getSnapshot(): WorldSnapshot | null {
    return this.engine.snapshot();
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.engine.events.subscribe(listener);
  }

  subscribeSnapshot(
    listener: (snapshot: WorldSnapshot) => void,
  ): () => void {
    return this.engine.snapshots.subscribe(listener);
  }

  private step(): void {
    const now = Date.now();
    const realDt = Math.max(
      0,
      Math.min((now - this.lastTick) / 1000, SIMULATION_CONFIG.maxStepSeconds),
    );
    this.lastTick = now;
    this.engine.tick(realDt);
  }
}
