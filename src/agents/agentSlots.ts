/**
 * Stable index allocation for the pooled robot draw. Core agents keep slots
 * 0..5; live agents draw from the remaining slots and return them on despawn.
 * A released slot is reused, so two hundred spawn/despawn cycles leave the
 * free list exactly as it started.
 */

export class AgentSlotAllocator {
  private readonly reserved: number;
  private readonly capacity: number;
  private readonly free: number[] = [];

  constructor(reserved: number, capacity: number) {
    this.reserved = Math.max(0, Math.min(reserved, capacity));
    this.capacity = Math.max(this.reserved, capacity);
    for (let slot = this.capacity - 1; slot >= this.reserved; slot -= 1) {
      this.free.push(slot);
    }
  }

  get freeCount(): number {
    return this.free.length;
  }

  get activeCount(): number {
    return this.capacity - this.free.length;
  }

  /** Lowest free slot, or null when the pool is full. */
  acquire(): number | null {
    return this.free.pop() ?? null;
  }

  /** Return a slot; the lowest free slot is handed out next. */
  release(slot: number): void {
    if (slot < this.reserved || slot >= this.capacity) return;
    if (this.free.includes(slot)) return;
    this.free.push(slot);
    this.free.sort((left, right) => right - left);
  }

  reset(): void {
    this.free.length = 0;
    for (let slot = this.capacity - 1; slot >= this.reserved; slot -= 1) {
      this.free.push(slot);
    }
  }
}
