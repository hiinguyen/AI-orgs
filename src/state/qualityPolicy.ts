/**
 * Pure render-quality policy. No React, three or browser globals: AppShell
 * passes the real browser values in and the headless checks call the same
 * function with fixtures.
 */

export type QualityMode = "high" | "low";

export interface QualityDecision {
  quality: QualityMode;
  auto: boolean;
}

export interface QualitySignals {
  /** `window.location.search`, including the leading question mark. */
  search: string;
  /** Viewport width in CSS pixels. */
  width: number;
  /** Current `prefers-reduced-motion: reduce` value. */
  reducedMotion: boolean;
  /** `navigator.hardwareConcurrency`; undefined on browsers that hide it. */
  hardwareConcurrency?: number;
}

/** The mobile breakpoint from spec section 7.2. */
export const MOBILE_BREAKPOINT = 768;

/** CPU count at or below which the low path is the safe default. */
export const AUTO_LOW_CORES = 4;

/** Treat a missing core count as a normal machine, not a weak one. */
const DEFAULT_CORES = 8;

/**
 * Decide the starting quality. `?quality=high` and `?quality=low` force a
 * mode and disable automatic fallback; any other value is ignored. Otherwise
 * a narrow viewport, reduced motion or a small CPU count picks low.
 */
export function pickInitialQuality({
  search,
  width,
  reducedMotion,
  hardwareConcurrency,
}: QualitySignals): QualityDecision {
  const forced = new URLSearchParams(search).get("quality");
  if (forced === "high" || forced === "low") {
    return { quality: forced, auto: false };
  }

  const cores = hardwareConcurrency ?? DEFAULT_CORES;
  const low =
    width < MOBILE_BREAKPOINT ||
    reducedMotion ||
    cores <= AUTO_LOW_CORES;

  return { quality: low ? "low" : "high", auto: true };
}

/**
 * A performance fallback may only override an automatic selection that is
 * still high. A forced `?quality=` must stay where the user put it.
 */
export function shouldAutoFallback(
  quality: QualityMode,
  auto: boolean,
): boolean {
  return auto && quality !== "low";
}

/** Human-readable mode for the top bar and the Settings panel. */
export function describeQuality(
  quality: QualityMode,
  auto: boolean,
): string {
  if (quality === "high") return auto ? "High (auto)" : "High (forced)";
  return auto ? "Low (auto)" : "Low (forced)";
}
