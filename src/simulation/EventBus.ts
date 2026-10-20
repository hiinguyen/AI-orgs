export type BusListener<T> = (value: T) => void;

/**
 * Minimal synchronous event bus. Subscribers are snapshotted before a publish
 * so a listener that subscribes or unsubscribes mid-dispatch cannot change the
 * set of listeners receiving the current value.
 */
export class EventBus<T> {
  private readonly listeners = new Set<BusListener<T>>();

  subscribe(listener: BusListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error("EventBus listener failed", error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}

/**
 * FNV-1a 32-bit hash. Stable across runs and platforms, which is what the
 * per-task RNG seeds need.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, deterministic, good enough for simulation dice. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInRange(
  rng: () => number,
  min: number,
  max: number,
): number {
  return min + rng() * (max - min);
}
