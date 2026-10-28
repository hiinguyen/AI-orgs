/**
 * Canvas 2D painting for the floor plan. Everything here is procedural and
 * React-free: the static office layer takes a camera and a theme, the live
 * layer (phase 3) takes the mutable world snapshot. No DOM reads.
 */
import { getAgentProfile } from "@/agents/AgentRegistry";
import type { AgentId, AgentState, AgentStatus } from "@/agents/agentTypes";
import type { CommLink } from "@/integrations/AgentBackend";
import {
  BAY_DESKS,
  BAY_DESK_DEPTH,
  BAY_DESK_WIDTH,
  BAY_STANDS,
  CORRIDOR_Z,
  FLOOR,
  HUB_CENTER,
  LOCATIONS,
  MISSION_CONTROL,
  PLANNING_BOARD_CENTER,
  PLANNING_BOARD_ROTATION,
  RESEARCH_BOARD_CENTER,
  RESEARCH_BOARD_ROTATION,
  STATIONS,
  STATION_OWNERS,
  type StationId,
} from "@/simulation/worldLayout";
import {
  mapFreeArea,
  mapPoint,
  type MapCamera,
  type MapViewport,
  type ScreenPoint,
} from "./mapView";

export interface MapColors {
  ink950: string;
  ink900: string;
  ink850: string;
  ink800: string;
  ink700: string;
  mist100: string;
  mist300: string;
  mist500: string;
  signal: string;
  signalStrong: string;
  ok: string;
  warn: string;
  bad: string;
}

export interface MapTheme {
  colors: MapColors;
  fontSans: string;
  fontMono: string;
}

/** Used before the first paint resolves the CSS tokens, and in tests. */
export const FALLBACK_MAP_THEME: MapTheme = {
  colors: {
    ink950: "#06080c",
    ink900: "#0a0e14",
    ink850: "#0e131b",
    ink800: "#121823",
    ink700: "#1a2230",
    mist100: "#eef2f7",
    mist300: "#b7c1cf",
    mist500: "#7c8797",
    signal: "#7cc4d6",
    signalStrong: "#9ad7e6",
    ok: "#6fe3a4",
    warn: "#f2b46a",
    bad: "#ff8a7a",
  },
  fontSans: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const STATION_SHORT: Record<StationId, string> = {
  ops: "Ops",
  research: "Research",
  product: "Product",
  dev: "Engineering",
  testing: "QA Lab",
  review: "Review",
};

/** Compact codes for a phone-sized plan, where full names would collide. */
const STATION_CODE: Record<StationId, string> = {
  ops: "OPS",
  research: "RES",
  product: "PROD",
  dev: "ENG",
  testing: "QA",
  review: "REV",
};

/** Below this scale (px per metre) the plan switches to compact labels. */
const COMPACT_LABEL_SCALE = 16;

/** World rect (min corner plus size) in CSS pixels. */
function worldRect(
  camera: MapCamera,
  viewport: MapViewport,
  x: number,
  z: number,
  width: number,
  depth: number,
): Rect {
  const topLeft = mapPoint(camera, viewport, x, z);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: width * camera.scale,
    height: depth * camera.scale,
  };
}

function centredRect(
  camera: MapCamera,
  viewport: MapViewport,
  x: number,
  z: number,
  width: number,
  depth: number,
): Rect {
  return worldRect(camera, viewport, x - width / 2, z - depth / 2, width, depth);
}

function hexChannels(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  if (value.length !== 6) return null;
  const number = Number.parseInt(value, 16);
  if (Number.isNaN(number)) return null;
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

/** Token colour at an alpha, so every layer reads from the same palette. */
function alpha(color: string, opacity: number): string {
  const channels = hexChannels(color);
  if (channels === null) return color;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
): void {
  const r = Math.max(
    0,
    Math.min(radius, rect.width / 2, rect.height / 2),
  );
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.width - r, rect.y);
  ctx.arcTo(
    rect.x + rect.width,
    rect.y,
    rect.x + rect.width,
    rect.y + r,
    r,
  );
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r);
  ctx.arcTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - r,
    rect.y + rect.height,
    r,
  );
  ctx.lineTo(rect.x + r, rect.y + rect.height);
  ctx.arcTo(
    rect.x,
    rect.y + rect.height,
    rect.x,
    rect.y + rect.height - r,
    r,
  );
  ctx.lineTo(rect.x, rect.y + r);
  ctx.arcTo(rect.x, rect.y, rect.x + r, rect.y, r);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  fill: string | CanvasGradient | CanvasPattern,
): void {
  roundRectPath(ctx, rect, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  stroke: string,
  width = 1,
): void {
  roundRectPath(ctx, rect, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function setFont(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight: number,
  family: string,
): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  family: string,
  align: CanvasTextAlign = "left",
  weight = 600,
): void {
  setFont(ctx, size, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawDisc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Zone washes: one rect each, in the same order as the labels. */
const ZONE_WASHES: readonly {
  label: string;
  key: "operations" | "research" | "development" | "collaboration";
  x: number;
  z: number;
  width: number;
  depth: number;
}[] = [
  { label: "Operations", key: "operations", x: -4.6, z: -3, width: 9.2, depth: 5.4 },
  { label: "", key: "operations", x: -3, z: 7, width: 9.2, depth: 4 },
  { label: "Research", key: "research", x: -13.6, z: -8.6, width: 8.9, depth: 10.5 },
  { label: "Development", key: "development", x: 4.7, z: -8.6, width: 8.9, depth: 10.5 },
  { label: "Collaboration", key: "collaboration", x: -13.6, z: 3.1, width: 23.3, depth: 3.8 },
];

function washColor(theme: MapTheme, key: string): string {
  const colors = theme.colors;
  switch (key) {
    case "operations":
      return alpha(colors.signal, 0.045);
    case "research":
      return alpha(colors.signalStrong, 0.035);
    case "development":
      return alpha(colors.mist300, 0.03);
    default:
      return alpha(colors.warn, 0.025);
  }
}

function drawFloorSlab(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const slab = worldRect(
    camera,
    viewport,
    FLOOR.minX,
    FLOOR.minZ,
    FLOOR.width,
    FLOOR.depth,
  );
  const radius = Math.min(18, camera.scale * 0.6);

  const gradient = ctx.createLinearGradient(slab.x, slab.y, slab.x, slab.y + slab.height);
  gradient.addColorStop(0, colors.ink900);
  gradient.addColorStop(1, colors.ink850);
  fillRoundRect(ctx, slab, radius, gradient);

  ctx.save();
  roundRectPath(ctx, slab, radius);
  ctx.clip();

  // Tile grid, fading out when the plan is zoomed far out.
  if (camera.scale >= 9) {
    const step = 1.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = alpha(colors.mist100, 0.022);
    ctx.beginPath();
    for (let x = FLOOR.minX; x <= FLOOR.maxX + 0.001; x += step) {
      const top = mapPoint(camera, viewport, x, FLOOR.minZ);
      const bottom = mapPoint(camera, viewport, x, FLOOR.maxZ);
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
    }
    for (let z = FLOOR.minZ; z <= FLOOR.maxZ + 0.001; z += step) {
      const left = mapPoint(camera, viewport, FLOOR.minX, z);
      const right = mapPoint(camera, viewport, FLOOR.maxX, z);
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
    }
    ctx.stroke();
  }

  // Warm pool of light around the operations hub, matching the 3D lighting.
  const hub = mapPoint(camera, viewport, HUB_CENTER.x, HUB_CENTER.z);
  const glow = ctx.createRadialGradient(
    hub.x,
    hub.y,
    0,
    hub.x,
    hub.y,
    camera.scale * 7,
  );
  glow.addColorStop(0, alpha(colors.signal, 0.08));
  glow.addColorStop(1, alpha(colors.signal, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(slab.x, slab.y, slab.width, slab.height);
  ctx.restore();

  // Outer walls, with the back wall (mission control) heavier.
  strokeRoundRect(ctx, slab, radius, alpha(colors.signalStrong, 0.2), 2.5);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(slab.x, slab.y + 3);
  ctx.lineTo(slab.x + slab.width, slab.y + 3);
  ctx.strokeStyle = alpha(colors.signalStrong, 0.34);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
  strokeRoundRect(ctx, slab, radius, alpha(colors.mist100, 0.05), 1);
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const compact = camera.scale < COMPACT_LABEL_SCALE;
  for (const zone of ZONE_WASHES) {
    const rect = worldRect(
      camera,
      viewport,
      zone.x,
      zone.z,
      zone.width,
      zone.depth,
    );
    fillRoundRect(
      ctx,
      rect,
      Math.min(14, camera.scale * 0.5),
      washColor(theme, zone.key),
    );
    if (compact || zone.label.length === 0) continue;
    drawLabel(
      ctx,
      zone.label.toUpperCase(),
      rect.x + 6,
      rect.y + 9,
      alpha(colors.mist500, 0.85),
      Math.max(7.5, Math.min(9.5, camera.scale * 0.3)),
      theme.fontMono,
    );
  }
}

function drawCorridor(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const band = worldRect(
    camera,
    viewport,
    FLOOR.minX,
    CORRIDOR_Z - 0.95,
    FLOOR.width,
    1.9,
  );
  ctx.fillStyle = alpha(colors.mist100, 0.02);
  ctx.fillRect(band.x, band.y, band.width, band.height);

  const left = mapPoint(camera, viewport, FLOOR.minX + 0.4, CORRIDOR_Z);
  const right = mapPoint(camera, viewport, FLOOR.maxX - 0.4, CORRIDOR_Z);
  ctx.save();
  ctx.setLineDash([camera.scale * 0.28, camera.scale * 0.34]);
  ctx.strokeStyle = alpha(colors.mist300, 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
  ctx.restore();
}

function drawPartitions(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  // Vertical glass at x = -4.6 and 4.6, from the back wall to the corridor.
  const segments: readonly [number, number][] = [
    [-4.6, -8.6],
    [4.6, -8.6],
  ];
  ctx.lineWidth = 1.2;
  for (const [x, z] of segments) {
    const start = mapPoint(camera, viewport, x, z);
    const end = mapPoint(camera, viewport, x, 2.2);
    ctx.strokeStyle = alpha(colors.signalStrong, 0.16);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.strokeStyle = alpha(colors.mist100, 0.06);
    ctx.beginPath();
    ctx.moveTo(start.x + 2.5, start.y);
    ctx.lineTo(end.x + 2.5, end.y);
    ctx.stroke();
  }

  for (const [x, width] of [
    [-13.6, 9],
    [4.6, 9],
  ] as const) {
    const start = mapPoint(camera, viewport, x, 2.2);
    const end = mapPoint(camera, viewport, x + width, 2.2);
    ctx.strokeStyle = alpha(colors.signalStrong, 0.12);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

function drawPlants(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  if (camera.scale < 12) return;
  const spots: readonly [number, number][] = [
    [-14.1, -8.7],
    [14.1, -8.7],
    [-14.1, 10.7],
    [14.1, 10.7],
    [5.5, -8.7],
  ];
  for (const [x, z] of spots) {
    const point = mapPoint(camera, viewport, x, z);
    drawDisc(
      ctx,
      point.x,
      point.y,
      camera.scale * 0.26,
      alpha(theme.colors.ink700, 0.9),
      alpha(theme.colors.mist500, 0.35),
    );
    drawDisc(
      ctx,
      point.x,
      point.y,
      camera.scale * 0.12,
      alpha(theme.colors.ok, 0.25),
    );
  }
}

function drawStations(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const compact = camera.scale < COMPACT_LABEL_SCALE;
  for (const station of STATIONS) {
    const desk = centredRect(
      camera,
      viewport,
      station.position.x,
      station.position.z,
      2.5,
      1.2,
    );
    const owner = getAgentProfile(STATION_OWNERS[station.id]);
    const radius = Math.min(6, camera.scale * 0.16);
    fillRoundRect(ctx, desk, radius, colors.ink800);
    strokeRoundRect(ctx, desk, radius, alpha(colors.mist100, 0.1), 1);

    // Monitor strip, the 2D read of the glowing screens.
    const strip = worldRect(
      camera,
      viewport,
      station.position.x - 1.24,
      station.position.z + 0.46,
      2.48,
      0.16,
    );
    fillRoundRect(ctx, strip, 1, alpha(owner.color, 0.55));

    const labelSize = Math.max(7.5, Math.min(10.5, camera.scale * 0.3));
    drawLabel(
      ctx,
      compact
        ? STATION_CODE[station.id]
        : STATION_SHORT[station.id].toUpperCase(),
      desk.x + desk.width / 2,
      desk.y - Math.max(5.5, camera.scale * 0.2),
      colors.mist300,
      labelSize,
      theme.fontMono,
      "center",
    );

    // Owner name inside the desk when it fits, otherwise the initial.
    const ownerName = owner.name.split(" ")[0];
    const ownerSize = Math.max(7, Math.min(9, camera.scale * 0.26));
    setFont(ctx, ownerSize, 600, theme.fontSans);
    const fits =
      ctx.measureText(ownerName).width <= desk.width - 6 && desk.height >= 11;
    const text = fits ? ownerName : ownerName.charAt(0);
    drawLabel(
      ctx,
      text,
      desk.x + desk.width / 2,
      desk.y + desk.height / 2 + 0.5,
      alpha(owner.color, 0.95),
      ownerSize,
      theme.fontSans,
      "center",
    );
  }
}

function drawHub(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const centre = mapPoint(camera, viewport, HUB_CENTER.x, HUB_CENTER.z);
  const outer = camera.scale * 1.35;

  ctx.beginPath();
  ctx.arc(centre.x, centre.y, outer, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(colors.signal, 0.38);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centre.x, centre.y, outer - 3, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(colors.signal, 0.12);
  ctx.lineWidth = 1;
  ctx.stroke();

  drawDisc(
    ctx,
    centre.x,
    centre.y,
    camera.scale * 0.62,
    alpha(colors.signal, 0.12),
    alpha(colors.signal, 0.3),
  );
  drawDisc(
    ctx,
    centre.x,
    centre.y,
    Math.max(2, camera.scale * 0.16),
    colors.signalStrong,
  );

  if (camera.scale >= COMPACT_LABEL_SCALE) {
    drawLabel(
      ctx,
      "OPERATIONS HUB",
      centre.x,
      centre.y - outer - Math.max(6, camera.scale * 0.28),
      colors.mist500,
      Math.max(7.5, Math.min(9.5, camera.scale * 0.3)),
      theme.fontMono,
      "center",
    );
  }
}

function drawMissionControl(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const screen = centredRect(
    camera,
    viewport,
    MISSION_CONTROL.x,
    MISSION_CONTROL.z - 0.55,
    8.4,
    0.7,
  );
  fillRoundRect(
    ctx,
    screen,
    Math.min(4, camera.scale * 0.12),
    alpha(colors.signal, 0.14),
  );
  strokeRoundRect(ctx, screen, 2, alpha(colors.signal, 0.36), 1);
  brightScreenLines(ctx, screen, colors);

  if (camera.scale >= COMPACT_LABEL_SCALE) {
    drawLabel(
      ctx,
      "MISSION CONTROL",
      screen.x + screen.width / 2,
      screen.y - Math.max(6, camera.scale * 0.24),
      alpha(colors.signalStrong, 0.8),
      Math.max(7.5, Math.min(9.5, camera.scale * 0.3)),
      theme.fontMono,
      "center",
    );
  }
}

/** A few lit rows so the wall reads as a screen instead of a flat block. */
function brightScreenLines(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  colors: MapColors,
): void {
  if (rect.height < 8) return;
  ctx.fillStyle = alpha(colors.signalStrong, 0.3);
  const rows = 3;
  for (let row = 0; row < rows; row += 1) {
    const y = rect.y + (rect.height * (row + 1)) / (rows + 1);
    ctx.fillRect(rect.x + rect.width * 0.08, y, rect.width * 0.84, 1);
  }
}

function drawAngledBoard(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  centre: { x: number; z: number },
  rotation: number,
  length: number,
  labelText: string,
  accent: string,
): void {
  const point = mapPoint(camera, viewport, centre.x, centre.z);
  const width = length * camera.scale;
  const depth = Math.max(3, camera.scale * 0.38);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(-rotation);
  const rect: Rect = { x: -width / 2, y: -depth / 2, width, height: depth };
  fillRoundRect(ctx, rect, 2, alpha(accent, 0.16));
  strokeRoundRect(ctx, rect, 2, alpha(accent, 0.45), 1.2);
  if (camera.scale >= COMPACT_LABEL_SCALE) {
    setFont(ctx, Math.max(7, Math.min(9, camera.scale * 0.26)), 600, theme.fontMono);
    ctx.fillStyle = alpha(theme.colors.mist100, 0.75);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, 0, 0);
  }
  ctx.restore();
}

function drawBoards(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  drawAngledBoard(
    ctx,
    camera,
    viewport,
    theme,
    PLANNING_BOARD_CENTER,
    PLANNING_BOARD_ROTATION,
    4.2,
    "PLANNING",
    colors.warn,
  );
  drawAngledBoard(
    ctx,
    camera,
    viewport,
    theme,
    RESEARCH_BOARD_CENTER,
    RESEARCH_BOARD_ROTATION,
    4.2,
    "RESEARCH",
    colors.signal,
  );

  if (camera.scale < 13) return;
  for (const location of [LOCATIONS.planning, LOCATIONS.researchBoard]) {
    for (const slot of location.slots) {
      const point = mapPoint(camera, viewport, slot.x, slot.z);
      drawDisc(
        ctx,
        point.x,
        point.y,
        Math.max(1.5, camera.scale * 0.16),
        alpha(colors.ink700, 0.9),
        alpha(colors.mist500, 0.35),
      );
    }
  }
}

function drawCollaboration(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const collab = LOCATIONS.collab;
  const centre = collab.center ?? { x: -5, z: 5.6 };
  const table = mapPoint(camera, viewport, centre.x, centre.z);

  drawDisc(
    ctx,
    table.x,
    table.y,
    camera.scale * 1.05,
    colors.ink800,
    alpha(colors.mist100, 0.12),
  );
  drawDisc(
    ctx,
    table.x,
    table.y,
    camera.scale * 0.55,
    alpha(colors.ink700, 0.8),
  );

  if (camera.scale >= 12) {
    for (const slot of collab.slots) {
      const point = mapPoint(camera, viewport, slot.x, slot.z);
      drawDisc(
        ctx,
        point.x,
        point.y,
        Math.max(1.5, camera.scale * 0.22),
        colors.ink700,
        alpha(colors.mist500, 0.4),
      );
    }
  }

}

function drawDispatch(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const radius = Math.min(5, camera.scale * 0.12);
  for (let index = 0; index < BAY_DESKS.length; index += 1) {
    const desk = centredRect(
      camera,
      viewport,
      BAY_DESKS[index].x,
      BAY_DESKS[index].z,
      BAY_DESK_WIDTH,
      BAY_DESK_DEPTH,
    );
    fillRoundRect(ctx, desk, radius, colors.ink800);
    strokeRoundRect(ctx, desk, radius, alpha(colors.mist100, 0.08), 1);

    const stand = BAY_STANDS[index];
    const point = mapPoint(camera, viewport, stand.x, stand.z);
    drawDisc(
      ctx,
      point.x,
      point.y,
      Math.max(1.2, camera.scale * 0.13),
      alpha(colors.mist500, 0.55),
    );
  }

}

/**
 * Paint the whole static plan for one camera. The caller caches the result
 * and only calls this again when the size, theme or camera changed.
 */
export function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
): void {
  const colors = theme.colors;
  const free = mapFreeArea(viewport);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = colors.ink950;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  // A soft blueprint vignette behind the slab, so the map sits in the same
  // dark glass world as the rest of the shell.
  const vignette = ctx.createRadialGradient(
    free.centerX,
    free.centerY,
    0,
    free.centerX,
    free.centerY,
    Math.max(free.width, free.height) * 0.75,
  );
  vignette.addColorStop(0, alpha(colors.signal, 0.05));
  vignette.addColorStop(1, alpha(colors.signal, 0));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawFloorSlab(ctx, camera, viewport, theme);
  drawZones(ctx, camera, viewport, theme);
  drawPartitions(ctx, camera, viewport, theme);
  drawCorridor(ctx, camera, viewport, theme);
  drawPlants(ctx, camera, viewport, theme);
  drawMissionControl(ctx, camera, viewport, theme);
  drawStations(ctx, camera, viewport, theme);
  drawHub(ctx, camera, viewport, theme);
  drawBoards(ctx, camera, viewport, theme);
  drawCollaboration(ctx, camera, viewport, theme);
  drawDispatch(ctx, camera, viewport, theme);
}

// ---------------------------------------------------------------------------
// Live layer: agents, trails, comm links and the working-state paints.
// Every function here reads a per-frame snapshot supplied by the caller; the
// only state the component keeps is the damped pose and the animation phases.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const TRAIL_SPACING = 0.32;
const TRAIL_MAX_DOTS = 64;
const PACKETS_PER_LINK = 3;
const PACKET_STAGGER = 0.16;
const PACKET_TRAVEL = 1 - (PACKETS_PER_LINK - 1) * PACKET_STAGGER;
const LINK_CAP = 4;
const PULSE_SECONDS = 0.9;
const HUB_PULSE_SECONDS = 2.4;

/** How strongly the floor status ring reads for each status. */
const STATUS_WEIGHT: Record<AgentStatus, number> = {
  idle: 0.18,
  walking: 0.3,
  thinking: 0.45,
  communicating: 0.6,
  working: 0.75,
  success: 0.6,
  error: 0.6,
};

export interface MapAgentPose {
  x: number;
  z: number;
  heading: number;
}

export interface MapAgentMarkerOptions {
  selected: boolean;
  hovered: boolean;
  followed: boolean;
  /** Seconds since the agent entered success or error, or null. */
  pulseAge: number | null;
  pulseOutcome: "success" | "error" | null;
  reducedMotion: boolean;
}

function screenRadius(camera: MapCamera, metres: number, minimum: number): number {
  return Math.max(minimum, camera.scale * metres);
}

/** Strip "Name is ..." so the pill says the activity, not the name twice. */
function displayActivity(name: string, activity: string | undefined): string {
  if (!activity) return "Idle";
  let text = activity;
  if (text.startsWith(`${name} is `)) {
    text = text.slice(name.length + 4);
  } else if (text.startsWith(`${name} `)) {
    text = text.slice(name.length + 1);
  }
  if (text.length === 0) return activity;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}...`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}...`;
}

/**
 * One robot: floor status ring, selection/hover ring, outcome pulse, the
 * profile-coloured disc, the heading notch and the initials.
 */
export function drawAgentMarker(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  agent: AgentState,
  pose: MapAgentPose,
  options: MapAgentMarkerOptions,
): void {
  const colors = theme.colors;
  const profile = getAgentProfile(agent.id);
  const point = mapPoint(camera, viewport, pose.x, pose.z);
  const radius = screenRadius(camera, 0.38, 6);

  // The expanding pulse sits under the disc so it never covers the initials.
  if (
    options.pulseAge !== null &&
    options.pulseAge < PULSE_SECONDS &&
    options.pulseOutcome !== null
  ) {
    const progress = options.reducedMotion
      ? 0.45
      : options.pulseAge / PULSE_SECONDS;
    const outcomeColor =
      options.pulseOutcome === "success" ? colors.ok : colors.warn;
    const ring = radius + 3 + progress * camera.scale * 0.9;
    ctx.beginPath();
    ctx.arc(point.x, point.y, ring, 0, TAU);
    ctx.strokeStyle = alpha(outcomeColor, (1 - progress) * 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (!agent.paused) {
    const weight = STATUS_WEIGHT[agent.status];
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + screenRadius(camera, 0.14, 3), 0, TAU);
    ctx.strokeStyle = alpha(profile.color, 0.12 + weight * 0.55);
    ctx.lineWidth = screenRadius(camera, 0.045, 1.5);
    ctx.stroke();
  }

  if (options.selected || options.hovered || options.followed) {
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      radius + screenRadius(camera, 0.2, 5),
      0,
      TAU,
    );
    ctx.strokeStyle = alpha(colors.mist100, options.selected ? 0.95 : 0.7);
    ctx.lineWidth = options.selected ? 2 : 1.4;
    ctx.stroke();
  }

  ctx.globalAlpha = agent.paused ? 0.5 : 1;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, TAU);
  ctx.fillStyle = profile.color;
  ctx.fill();
  ctx.strokeStyle = colors.ink950;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Heading notch: a dark edge mark from the outer half of the disc. It starts
  // past the initials so the mark never cuts through the letters.
  const headingX = Math.sin(pose.heading);
  const headingZ = Math.cos(pose.heading);
  ctx.beginPath();
  ctx.moveTo(
    point.x + headingX * radius * 0.52,
    point.y + headingZ * radius * 0.52,
  );
  ctx.lineTo(
    point.x + headingX * radius * 0.86,
    point.y + headingZ * radius * 0.86,
  );
  ctx.strokeStyle = alpha(colors.ink950, 0.85);
  ctx.lineWidth = Math.max(1.5, radius * 0.2);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineCap = "butt";

  const labelSize = clamp(camera.scale * 0.24, 7, 10);
  setFont(ctx, labelSize, 700, theme.fontMono);
  ctx.fillStyle = colors.ink950;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initialsForProfile(profile.name), point.x, point.y + 0.5);
  ctx.globalAlpha = 1;
}

function initialsForProfile(name: string): string {
  const words = name.split(/[\s-_]+/).filter((word) => word.length > 0);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  point: ScreenPoint;
  radius: number;
}

function labelBox(
  camera: MapCamera,
  viewport: MapViewport,
  pose: MapAgentPose,
  width: number,
  height: number,
): LabelBox {
  const point = mapPoint(camera, viewport, pose.x, pose.z);
  const radius = screenRadius(camera, 0.38, 6);
  const free = mapFreeArea(viewport);
  const x = clamp(
    point.x - width / 2,
    free.left + 6,
    free.left + free.width - width - 6,
  );
  let y = point.y - radius - 8 - height;
  if (y < free.top + 6) y = point.y + radius + 8;
  return { x, y, width, height, point, radius };
}

/** Full name plus activity: hover, selection and follow only. */
export function drawAgentDetailLabel(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  agent: AgentState,
  pose: MapAgentPose,
): void {
  const colors = theme.colors;
  const profile = getAgentProfile(agent.id);
  const name = profile.name;

  const nameFont = `600 10.5px ${theme.fontSans}`;
  const activityFont = `500 9.5px ${theme.fontSans}`;
  setFont(ctx, 10.5, 600, theme.fontSans);
  const nameWidth = ctx.measureText(name).width;
  setFont(ctx, 9.5, 500, theme.fontSans);
  const activity = agent.paused
    ? "Paused"
    : displayActivity(name, agent.activity);
  const activityText = truncate(ctx, activity, 132);
  const activityWidth = ctx.measureText(activityText).width;

  const padding = 7;
  const gap = 5;
  const dot = 5;
  const width = Math.min(
    250,
    padding * 2 + dot + gap + nameWidth + gap + activityWidth,
  );
  const height = 18;
  const box = labelBox(camera, viewport, pose, width, height);

  fillRoundRect(
    ctx,
    { x: box.x, y: box.y, width, height },
    height / 2,
    alpha(colors.ink950, 0.92),
  );
  strokeRoundRect(
    ctx,
    { x: box.x, y: box.y, width, height },
    height / 2,
    alpha(profile.color, 0.55),
    1,
  );

  let x = box.x + padding;
  drawDisc(ctx, x + dot / 2, box.y + height / 2, dot / 2, profile.color);
  x += dot + gap;
  ctx.font = nameFont;
  ctx.fillStyle = colors.mist100;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x, box.y + height / 2 + 0.5);
  x += nameWidth + gap;
  ctx.font = activityFont;
  ctx.fillStyle = colors.mist300;
  ctx.fillText(activityText, x, box.y + height / 2 + 0.5);
}

/** Compact name tag for a communicating robot. */
export function drawAgentNameTag(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  agent: AgentState,
  pose: MapAgentPose,
): void {
  const colors = theme.colors;
  const profile = getAgentProfile(agent.id);
  const name = profile.name;
  setFont(ctx, 9.5, 600, theme.fontSans);
  const nameWidth = ctx.measureText(name).width;
  const padding = 6;
  const gap = 4;
  const dot = 4;
  const width = padding * 2 + dot + gap + nameWidth;
  const height = 16;
  const box = labelBox(camera, viewport, pose, width, height);

  fillRoundRect(
    ctx,
    { x: box.x, y: box.y, width, height },
    height / 2,
    alpha(colors.ink950, 0.82),
  );
  strokeRoundRect(
    ctx,
    { x: box.x, y: box.y, width, height },
    height / 2,
    alpha(profile.color, 0.42),
    1,
  );
  drawDisc(
    ctx,
    box.x + padding + dot / 2,
    box.y + height / 2,
    dot / 2,
    profile.color,
  );
  ctx.font = `600 9.5px ${theme.fontSans}`;
  ctx.fillStyle = colors.mist300;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    name,
    box.x + padding + dot + gap,
    box.y + height / 2 + 0.5,
  );
}

/** Dotted remaining path plus the destination ring, matching the 3D trail. */
export function drawAgentTrail(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  agent: AgentState,
  pose: MapAgentPose,
  phase: number,
  reducedMotion: boolean,
): void {
  const path = agent.path;
  if (path.length === 0) return;
  const colors = theme.colors;
  const profile = getAgentProfile(agent.id);

  let segmentIndex = 0;
  let segmentStartX = pose.x;
  let segmentStartZ = pose.z;
  let segmentEndX = path[0].x;
  let segmentEndZ = path[0].z;
  let segmentLength = Math.hypot(
    segmentEndX - segmentStartX,
    segmentEndZ - segmentStartZ,
  );
  let travelled = 0;

  // One path, one fill: dozens of tiny dots are cheaper as subpaths than as
  // separate fills, and the fade still reads from the shrinking radius.
  ctx.beginPath();
  let placed = 0;
  for (let index = 0; index < TRAIL_MAX_DOTS; index += 1) {
    const target = phase + index * TRAIL_SPACING;
    while (
      target > travelled + segmentLength &&
      segmentIndex < path.length - 1
    ) {
      travelled += segmentLength;
      segmentIndex += 1;
      segmentStartX = segmentEndX;
      segmentStartZ = segmentEndZ;
      segmentEndX = path[segmentIndex].x;
      segmentEndZ = path[segmentIndex].z;
      segmentLength = Math.hypot(
        segmentEndX - segmentStartX,
        segmentEndZ - segmentStartZ,
      );
    }
    if (target > travelled + segmentLength) break;
    const t = segmentLength > 1e-6 ? (target - travelled) / segmentLength : 0;
    const x = segmentStartX + (segmentEndX - segmentStartX) * t;
    const z = segmentStartZ + (segmentEndZ - segmentStartZ) * t;
    const point = mapPoint(camera, viewport, x, z);
    const radius =
      screenRadius(camera, 0.05, 1) * (1 - (index / TRAIL_MAX_DOTS) * 0.4);
    ctx.moveTo(point.x + radius, point.y);
    ctx.arc(point.x, point.y, radius, 0, TAU);
    placed += 1;
  }
  if (placed > 0) {
    ctx.fillStyle = alpha(profile.color, 0.55);
    ctx.fill();
  }

  const last = path[path.length - 1];
  if (last === undefined) return;
  const destination = mapPoint(camera, viewport, last.x, last.z);
  const breath = reducedMotion
    ? 1
    : 1 + Math.sin((phase / TRAIL_SPACING) * TAU) * 0.08;
  ctx.beginPath();
  ctx.arc(destination.x, destination.y, camera.scale * 0.36 * breath, 0, TAU);
  ctx.strokeStyle = alpha(colors.mist100, 0.28);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(destination.x, destination.y, camera.scale * 0.36 * breath, 0, TAU);
  ctx.strokeStyle = alpha(profile.color, 0.72);
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function quadraticPoint(
  start: ScreenPoint,
  control: ScreenPoint,
  end: ScreenPoint,
  t: number,
): ScreenPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

/** Glowing arcs with travelling packets for every active communication. */
export function drawCommLinks(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  links: readonly CommLink[],
  poses: ReadonlyMap<AgentId, MapAgentPose>,
  clock: number,
  reducedMotion: boolean,
): void {
  const active: CommLink[] = [];
  for (const link of links) {
    if (clock >= link.startedAt && clock < link.endsAt) active.push(link);
  }
  if (active.length === 0) return;
  active.sort((left, right) => right.startedAt - left.startedAt);

  for (const link of active.slice(0, LINK_CAP)) {
    const from = poses.get(link.from);
    const to = poses.get(link.to);
    if (!from || !to) continue;
    const start = mapPoint(camera, viewport, from.x, from.z);
    const end = mapPoint(camera, viewport, to.x, to.z);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) continue;

    // A perpendicular dip instead of the 3D arc's lift, so a message between
    // two robots never hides behind their discs.
    const dip = clamp(length * 0.18, 8, 90);
    const control = {
      x: (start.x + end.x) / 2 - (dy / length) * dip,
      y: (start.y + end.y) / 2 + (dx / length) * dip,
    };
    const color = getAgentProfile(link.from).color;
    const duration = Math.max(0.001, link.endsAt - link.startedAt);
    const progress = clamp((clock - link.startedAt) / duration, 0, 1);

    // A wide, faint stroke behind the line reads as a glow without the cost
    // of canvas shadows, which are the most expensive op in this loop.
    ctx.strokeStyle = alpha(color, 0.16);
    ctx.lineWidth = link.kind === "assign" ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.stroke();
    ctx.strokeStyle = alpha(color, 0.78);
    ctx.lineWidth = link.kind === "assign" ? 2.4 : 1.6;
    ctx.stroke();

    const packetRadius = screenRadius(camera, link.kind === "assign" ? 0.09 : 0.07, 2.2);
    if (reducedMotion) {
      const point = quadraticPoint(start, control, end, 0.5);
      drawDisc(ctx, point.x, point.y, packetRadius, color);
      continue;
    }
    for (let packet = 0; packet < PACKETS_PER_LINK; packet += 1) {
      const t = (progress - packet * PACKET_STAGGER) / PACKET_TRAVEL;
      if (t < 0 || t > 1) continue;
      const point = quadraticPoint(start, control, end, t);
      drawDisc(ctx, point.x, point.y, packetRadius * 1.9, alpha(color, 0.22));
      drawDisc(ctx, point.x, point.y, packetRadius, alpha(color, 0.98));
    }
  }
}

/** Screen tint and floor pool for every desk whose owner is working. */
export function drawWorkingDesks(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  agents: readonly AgentState[],
): void {
  for (const station of STATIONS) {
    const ownerId = STATION_OWNERS[station.id];
    const owner = agents.find((agent) => agent.id === ownerId);
    if (!owner || owner.paused || owner.status !== "working") continue;
    const profile = getAgentProfile(ownerId);
    const pool = mapPoint(
      camera,
      viewport,
      station.position.x,
      station.position.z + 0.45,
    );
    const radius = camera.scale * 1.5;
    const glow = ctx.createRadialGradient(
      pool.x,
      pool.y,
      0,
      pool.x,
      pool.y,
      radius,
    );
    glow.addColorStop(0, alpha(profile.color, 0.26));
    glow.addColorStop(1, alpha(profile.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(pool.x - radius, pool.y - radius, radius * 2, radius * 2);

    const strip = worldRect(
      camera,
      viewport,
      station.position.x - 1.24,
      station.position.z + 0.46,
      2.48,
      0.16,
    );
    ctx.fillStyle = alpha(profile.color, 0.22);
    ctx.fillRect(
      strip.x - 2,
      strip.y - 3,
      strip.width + 4,
      strip.height + 6,
    );
    ctx.fillStyle = alpha(profile.color, 0.92);
    ctx.fillRect(strip.x, strip.y, strip.width, strip.height);
  }
}

/** The hub ring breathes while Orion works, like the 3D console. */
export function drawHubPulse(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  viewport: MapViewport,
  theme: MapTheme,
  clock: number,
  active: boolean,
  reducedMotion: boolean,
): void {
  if (!active) return;
  const point = mapPoint(camera, viewport, HUB_CENTER.x, HUB_CENTER.z);
  const base = camera.scale * 1.35;
  const progress = reducedMotion
    ? 0.5
    : (clock % HUB_PULSE_SECONDS) / HUB_PULSE_SECONDS;
  const radius = base + progress * camera.scale * 0.9;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, TAU);
  ctx.strokeStyle = alpha(theme.colors.signal, (1 - progress) * 0.6);
  ctx.lineWidth = 1.6;
  ctx.stroke();
}
