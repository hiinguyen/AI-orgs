/**
 * Click versus orbit. The office is orbited with a drag; a drag that ends on
 * empty floor must not count as a click and clear the selection. The pointer
 * listeners live here so the Canvas' onPointerMissed and the station hit boxes
 * agree on the same 5 px tolerance.
 */

const TOLERANCE_PX = 5;

let startX = 0;
let startY = 0;
let dragging = true;
let lastWasDrag = true;

export function installPointerGesture(element: HTMLElement): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    lastWasDrag = false;
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

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
  };
}

/** True when the last pointer gesture on the canvas was a drag, not a click. */
export function wasDragGesture(): boolean {
  return lastWasDrag;
}
