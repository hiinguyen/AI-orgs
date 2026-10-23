/** Fake Web Audio nodes and helpers shared by the sound checks. */
import type { AgentEvent, AgentEventType } from "../../src/events/eventTypes.ts";
import type { StorageLike } from "../../src/audio/soundCues.ts";
import type { GestureLike } from "../../src/audio/soundCues.ts";
import type { UnlockListener, UnlockTarget } from "../../src/audio/soundEngine.ts";

export class FakeParam {
  value = 0;
  readonly events: Array<{ kind: string; value: number; at: number }> = [];

  setValueAtTime(value: number, at: number): void {
    this.value = value;
    this.events.push({ kind: "set", value, at });
  }

  linearRampToValueAtTime(value: number, at: number): void {
    this.value = value;
    this.events.push({ kind: "linear", value, at });
  }

  exponentialRampToValueAtTime(value: number, at: number): void {
    this.value = value;
    this.events.push({ kind: "exponential", value, at });
  }

  cancelScheduledValues(at: number): void {
    this.events.push({ kind: "cancel", value: this.value, at });
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnected = false;

  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
    this.onended?.();
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam();
}

export class FakeBufferSource extends FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

export class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly nodes: FakeNode[] = [];
  readonly sources: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly bufferSources: FakeBufferSource[] = [];

  /** Outcomes for successive resume() calls; empty means "becomes running". */
  readonly resumePlan: AudioContextState[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  private readonly stateListeners = new Set<() => void>();

  /** When true, resume() stays pending until settleResume() is called. */
  deferResume = false;
  private readonly pendingResumes: Array<(notify: boolean) => void> = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    const outcome = this.resumePlan.shift() ?? "running";
    if (!this.deferResume) {
      this.setState(outcome);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pendingResumes.push((notify) => {
        if (notify) this.setState(outcome);
        else this.state = outcome;
        resolve();
      });
    });
  }

  /** Resolve the oldest deferred resume; `notify: false` fires no statechange. */
  settleResume(notify: boolean): void {
    this.pendingResumes.shift()?.(notify);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }

  setState(state: AudioContextState): void {
    if (state === this.state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener();
  }

  get stateListenerCount(): number {
    return this.stateListeners.size;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "statechange") this.stateListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "statechange") this.stateListeners.delete(listener);
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.nodes.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor();
    this.nodes.push(node);
    return node;
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.nodes.push(node);
    this.sources.push(node);
    this.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.nodes.push(node);
    this.sources.push(node);
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.nodes.push(node);
    return node;
  }

  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): AudioBuffer {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }
}

export function eventOf(
  type: AgentEventType,
  extra: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id: `evt-${type}`,
    type,
    timestamp: 0,
    simTime: 0,
    message: "sound check",
    severity: "info",
    feed: false,
    ...extra,
  };
}

export function memoryStorage(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
export class FakeTarget implements UnlockTarget {
  readonly listeners = new Map<string, Set<UnlockListener>>();

  addEventListener(type: string, listener: UnlockListener): void {
    const set = this.listeners.get(type) ?? new Set<UnlockListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: UnlockListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  get count(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  fire(type: string, extra: Omit<GestureLike, "type"> = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, ...extra });
    }
  }
}

export class ThrowingGainContext extends FakeAudioContext {
  override createGain(): FakeGain {
    throw new Error("createGain failed");
  }
}


/** Context whose ambient bed cannot start (createBufferSource throws). */
export class ThrowingBufferContext extends FakeAudioContext {
  override createBufferSource(): FakeBufferSource {
    throw new Error("createBufferSource failed");
  }
}
