/**
 * Click versus orbit. The office is orbited with a drag; a drag that ends on
 * empty floor must not count as a click and clear the selection. The pointer
 * listeners live here so the station hit boxes and the empty-space clear use
 * the same 5 px tolerance.
 *
 * Empty-space clearing cannot rely on fiber's `onPointerMissed`: fiber only
 * reports a miss when its own pointer delta is at most 2 px, while station
 * clicks accept 5 px. The DOM `click` listener below runs after fiber has
 * dispatched the click (fiber listens on the Canvas wrapper, this listens on
 * window), so a station handler can mark the click as consumed first.
 */

const TOLERANCE_PX = 5;

let startX = 0;
let startY = 0;
let dragging = true;
let lastWasDrag = true;
let clickConsumed = false;

/**
 * Called by an R3F click handler that acted on the pick. The same DOM click
 * must not also clear the selection.
 */
export function consumeClickGesture(): void {
  clickConsumed = true;
}

export interface PointerGestureOptions {
  /** A click on the canvas that no pick handler consumed. */
  onEmptyClick?: () => void;
}

export function installPointerGesture(
  element: HTMLElement,
  options: PointerGestureOptions = {},
): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    lastWasDrag = false;
    clickConsumed = false;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!event.isPrimary || event.buttons === 0 || dragging) return;
    if (
      Math.abs(event.clientX - startX) > TOLERANCE_PX ||
      Math.abs(event.clientY - startY) > TOLERANCE_PX
    ) {
      dragging = true;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    const movedX = Math.abs(event.clientX - startX);
    const movedY = Math.abs(event.clientY - startY);
    lastWasDrag = dragging || movedX > TOLERANCE_PX || movedY > TOLERANCE_PX;
  };

  const onClick = (event: MouseEvent) => {
    if (event.target !== element) return;
    const wasDrag = lastWasDrag;
    const consumed = clickConsumed;
    clickConsumed = false;
    if (wasDrag || consumed) return;
    options.onEmptyClick?.();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("click", onClick);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("click", onClick);
  };
}

/** True when the last pointer gesture on the canvas was a drag, not a click. */
export function wasDragGesture(): boolean {
  return lastWasDrag;
}
