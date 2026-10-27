"use client";

import { useWorldStore } from "@/state/useWorldStore";
import { cn } from "@/components/ui";

/**
 * The 2D world renderer. It stays mounted next to the 3D Canvas in both modes
 * so switching is instant; only the active renderer draws and takes pointer
 * input. Phase 1 lands the shell before the floor plan itself.
 */
export function FloorPlan2D() {
  const viewMode = useWorldStore((state) => state.viewMode);
  const visible = viewMode === "2d";

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden bg-ink-950",
        !visible && "invisible pointer-events-none",
      )}
      aria-hidden={!visible}
      data-testid="floor-plan-2d"
      data-visible={visible ? "1" : "0"}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="eyebrow">2D floor plan</span>
      </div>
    </div>
  );
}
