/**
 * Canvas 2D painting for the floor plan. Everything here is procedural and
 * React-free: the static office layer takes a camera and a theme, the live
 * layer (phase 3) takes the mutable world snapshot. No DOM reads.
 */
import { getAgentProfile } from "@/agents/AgentRegistry";
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
