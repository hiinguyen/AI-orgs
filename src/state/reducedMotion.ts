/**
 * Live reduced-motion flag for the 3D layer. This is deliberately a plain
 * mutable object, not React state: useFrame reads it every frame, so a media
 * query change must never re-render the Canvas or allocate a subscription.
 *
 * AppShell calls `initReducedMotion` once; the flag then follows the OS
 * setting through the media query `change` event.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const reducedMotion = { current: false };

/** Update the flag without touching the DOM (also used by the checks). */
export function setReducedMotion(value: boolean): void {
  reducedMotion.current = value;
}

/**
 * Sync the flag with matchMedia and keep it live. Returns the unsubscribe
 * used by the AppShell effect cleanup.
 */
export function initReducedMotion(): () => void {
  if (typeof window === "undefined") return () => {};

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  reducedMotion.current = query.matches;

  const onChange = (event: MediaQueryListEvent): void => {
    reducedMotion.current = event.matches;
  };

  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
