/**
 * Pure view-mode policy: which world renderer is on screen. No React, three
 * or browser globals at module scope, so the boot decision can be checked
 * headlessly with a fake storage.
 */

export type ViewMode = "2d" | "3d";

/** Same persistence pattern as `aaw.sound.v1`. */
export const VIEW_STORAGE_KEY = "aaw.view.v1";

/** The 3D office is the first impression the spec describes. */
export const DEFAULT_VIEW_MODE: ViewMode = "3d";

/** A minimal `localStorage` surface, so checks can pass a fake. */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isViewMode(value: unknown): value is ViewMode {
  return value === "2d" || value === "3d";
}

/** The mode forced by `?view=`, or null when the URL does not force one. */
export function viewModeFromSearch(search: string): ViewMode | null {
  const value = new URLSearchParams(search).get("view");
  return isViewMode(value) ? value : null;
}

/**
 * `?view=` wins for this session, then the stored choice, then 3D. Anything
 * else in the URL or storage is ignored, so a stale or hand-edited value can
 * never leave the app with no renderer.
 */
export function readStoredViewMode(
  search: string,
  storage: ViewStorage | null,
): ViewMode {
  const forced = viewModeFromSearch(search);
  if (forced !== null) return forced;
  if (storage === null) return DEFAULT_VIEW_MODE;
  try {
    const stored = storage.getItem(VIEW_STORAGE_KEY);
    return isViewMode(stored) ? stored : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

export function writeStoredViewMode(
  mode: ViewMode,
  storage: ViewStorage | null,
): void {
  if (storage === null) return;
  try {
    storage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    // Private mode or a full quota: the choice is a convenience, never an error.
  }
}

/** Accessing `localStorage` itself can throw in some privacy modes. */
export function browserViewStorage(): ViewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
