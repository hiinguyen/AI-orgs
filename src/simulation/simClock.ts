/** Rounds a simulation clock value to millisecond precision. */
export function roundClock(value: number): number {
  return Math.round(value * 1000) / 1000;
}
