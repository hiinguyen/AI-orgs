/**
 * Pure geometry for the 2D floor plan: world metres to canvas pixels, the
 * inset-aware fit, pan/zoom clamping, hit testing and the per-preset framing.
 *
 * The map is drawn with screen `y` following world `z` (both grow towards the
 * front of the office), so the mission-control wall sits at the top of the
 * plan and the dispatch floor at the bottom, the same way the overview camera
 * shows the room. No React, three or DOM imports.
 */
import type { AgentId, Vec2 } from "@/agents/agentTypes";
import type { CameraPresetId, ViewInsets } from "@/state/useWorldStore";
import { FLOOR, STATIONS, type StationId } from "@/simulation/worldLayout";

export interface MapViewport {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** The floating UI the plan must stay clear of, in viewport pixels. */
  insets: ViewInsets;
}

export interface MapCamera {
  /** World x at the centre of the free area. */
  cx: number;
  /** World z at the centre of the free area. */
  cz: number;
  /** CSS pixels per metre. */
  scale: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface FreeArea {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** Empty floor kept around the slab in the overview framing, in metres. */
export const MAP_MARGIN = 1.2;

/** Space reserved under the free area for the floating camera bar. */
export const MAP_BAR_CLEARANCE = 48;

/** Zoom bounds as a multiple of the fit scale. */
export const MAP_MIN_ZOOM = 0.85;
export const MAP_MAX_ZOOM = 4.5;

/** Click targets, matching the 3D hit box so both views select the same area. */
export const AGENT_HIT_RADIUS = 0.62;
export const AGENT_HIT_MIN_PX = 9;
export const STATION_HIT_WIDTH = 2.9;
export const STATION_HIT_DEPTH = 2.3;
export const STATION_HIT_OFFSET_Z = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mapFreeArea(viewport: MapViewport): FreeArea {
  const left = viewport.insets.left;
  const right = viewport.width - viewport.insets.right;
  const top = viewport.insets.top;
  const bottom = viewport.height - viewport.insets.bottom - MAP_BAR_CLEARANCE;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    left,
    top,
    width,
    height,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

/** Scale that fits the whole floor plus margin into the free area. */
export function mapFitScale(viewport: MapViewport): number {
  const free = mapFreeArea(viewport);
  const width = FLOOR.width + MAP_MARGIN * 2;
  const depth = FLOOR.depth + MAP_MARGIN * 2;
  return Math.max(1, Math.min(free.width / width, free.height / depth));
}

export function overviewMapCamera(viewport: MapViewport): MapCamera {
  return clampMapCamera(
    {
      cx: (FLOOR.minX + FLOOR.maxX) / 2,
      cz: (FLOOR.minZ + FLOOR.maxZ) / 2,
      scale: mapFitScale(viewport),
    },
    viewport,
  );
}

/**
 * Keep the visible window inside the floor plus margin. When the window is
 * larger than that (the overview on a phone), centre the floor instead of
 * exposing empty space around it.
 */
export function clampMapCamera(
  camera: MapCamera,
  viewport: MapViewport,
): MapCamera {
  const free = mapFreeArea(viewport);
  const fit = mapFitScale(viewport);
  const scale = clamp(camera.scale, fit * MAP_MIN_ZOOM, fit * MAP_MAX_ZOOM);
  const halfWidth = free.width / (2 * scale);
  const halfHeight = free.height / (2 * scale);
  const minX = FLOOR.minX - MAP_MARGIN;
  const maxX = FLOOR.maxX + MAP_MARGIN;
  const minZ = FLOOR.minZ - MAP_MARGIN;
  const maxZ = FLOOR.maxZ + MAP_MARGIN;

  const centre = (
    value: number,
    min: number,
    max: number,
    half: number,
  ): number => {
    if (max - min <= half * 2) return (min + max) / 2;
    return clamp(value, min + half, max - half);
  };

  return {
    cx: centre(camera.cx, minX, maxX, halfWidth),
    cz: centre(camera.cz, minZ, maxZ, halfHeight),
    scale,
  };
}

export function mapPoint(
  camera: MapCamera,
  viewport: MapViewport,
  x: number,
  z: number,
): ScreenPoint {
  const free = mapFreeArea(viewport);
  return {
    x: free.centerX + (x - camera.cx) * camera.scale,
    y: free.centerY + (z - camera.cz) * camera.scale,
  };
}

export function mapWorld(
  camera: MapCamera,
  viewport: MapViewport,
  point: ScreenPoint,
): Vec2 {
  const free = mapFreeArea(viewport);
  return {
    x: camera.cx + (point.x - free.centerX) / camera.scale,
    z: camera.cz + (point.y - free.centerY) / camera.scale,
  };
}

/**
 * Camera framing per shared camera preset. `scale` is a multiple of the fit
 * scale, roughly the zone bounding box plus padding.
 */
export interface MapZone {
  cx: number;
  cz: number;
  scale: number;
}

export const MAP_ZONES: Record<CameraPresetId, MapZone> = {
  overview: { cx: 0, cz: 1, scale: 1 },
  hub: { cx: 0, cz: -1.4, scale: 2.4 },
  research: { cx: -8.4, cz: -3.1, scale: 2.6 },
  development: { cx: 8.3, cz: -3.1, scale: 2.6 },
  collaboration: { cx: -3.6, cz: 5, scale: 2.2 },
};

export function mapZoneCamera(
  preset: CameraPresetId,
  viewport: MapViewport,
): MapCamera {
  const zone = MAP_ZONES[preset];
  return clampMapCamera(
    {
      cx: zone.cx,
      cz: zone.cz,
      scale: mapFitScale(viewport) * zone.scale,
    },
    viewport,
  );
}

/**
 * A focus request from the panels or a selection: centre the point and zoom
 * in enough that the agent or desk reads, using the orbit distance the 3D
 * controller would have used as a hint.
 */
export function focusMapCamera(
  focus: { x: number; z: number },
  distance: number | undefined,
  viewport: MapViewport,
): MapCamera {
  const free = mapFreeArea(viewport);
  const fit = mapFitScale(viewport);
  // A 7.5 m orbit reads as roughly a 14 m wide floor plan.
  const span = Math.max(9, (distance ?? 7.5) * 1.9);
  const scale = Math.max(fit * 1.6, Math.min(free.width, free.height) / span);
  return clampMapCamera({ cx: focus.x, cz: focus.z, scale }, viewport);
}

/** Nearest agent whose drawn disc contains the point, if any. */
export function hitAgentAt(
  point: ScreenPoint,
  camera: MapCamera,
  viewport: MapViewport,
  agents: readonly { id: AgentId; x: number; z: number }[],
): AgentId | null {
  const radius = Math.max(
    AGENT_HIT_MIN_PX,
    AGENT_HIT_RADIUS * camera.scale,
  );
  let best: AgentId | null = null;
  let bestDistance = radius;
  for (const agent of agents) {
    const screen = mapPoint(camera, viewport, agent.x, agent.z);
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance <= bestDistance) {
      best = agent.id;
      bestDistance = distance;
    }
  }
  return best;
}

/** Station whose desk rect contains the point, matching the 3D hit box. */
export function hitStationAt(
  point: ScreenPoint,
  camera: MapCamera,
  viewport: MapViewport,
): StationId | null {
  const halfWidth = (STATION_HIT_WIDTH / 2) * camera.scale;
  const halfDepth = (STATION_HIT_DEPTH / 2) * camera.scale;
  for (const station of STATIONS) {
    const centre = mapPoint(
      camera,
      viewport,
      station.position.x,
      station.position.z + STATION_HIT_OFFSET_Z,
    );
    if (
      Math.abs(point.x - centre.x) <= halfWidth &&
      Math.abs(point.y - centre.y) <= halfDepth
    ) {
      return station.id;
    }
  }
  return null;
}
