import { STATIONS, type StationId } from "@/simulation/worldLayout";
import { useWorldStore } from "@/state/useWorldStore";

/** Orbit distance for a focused workstation. */
export const STATION_FOCUS_DISTANCE = 8.5;

/** The point a focused station is framed around: just above the desk. */
export function stationFocusPoint(id: StationId): {
  x: number;
  y: number;
  z: number;
} {
  const station = STATIONS.find((entry) => entry.id === id);
  if (!station) return { x: 0, y: 0.8, z: 0 };
  return {
    x: station.position.x,
    y: 0.85,
    z: station.position.z + 0.2,
  };
}

/**
 * Ask the camera to frame a workstation. Used by the 3D hit boxes and by the
 * station panel so both produce the same focus request.
 */
export function focusStation(id: StationId): void {
  useWorldStore.getState().requestCamera({
    focus: stationFocusPoint(id),
    distance: STATION_FOCUS_DISTANCE,
  });
}
