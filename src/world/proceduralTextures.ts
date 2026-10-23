import * as THREE from "three";
import {
  MISSION_CANVAS_HEIGHT,
  MISSION_CANVAS_WIDTH,
} from "./missionDrawing.ts";
import { PLANNING_BOARD, PLANNING_CARD_LIMIT } from "./planningContent.ts";

/**
 * Procedural canvas textures for the office. Everything is drawn at runtime
 * from 2D canvas primitives: the repo ships no image or HDR files.
 *
 * Textures are built once and cached for the lifetime of the tab. Colour
 * textures are tagged sRGB, data textures (masks, gradients) keep the default
 * colour space unless they are used as colour maps.
 */

const cache = new Map<string, THREE.CanvasTexture>();

function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("2D canvas context unavailable");
  }
  return { canvas, ctx };
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function cached(
  key: string,
  make: () => THREE.CanvasTexture,
): THREE.CanvasTexture {
  const existing = cache.get(key);
  if (existing) return existing;
  const texture = make();
  cache.set(key, texture);
  return texture;
}

function asColorMap(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Large-format dark floor tiles with soft variation and seams. */
export function floorTexture(): THREE.CanvasTexture {
  return cached("floor", () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size, size);
    const random = makeRandom(0x51f10a);

    ctx.fillStyle = "#202a36";
    ctx.fillRect(0, 0, size, size);

    // Four tiles per texture with a 5 x 3.5 repeat over the 30 x 21 m floor:
    // one tile is 1.5 m, and the seams stay visible at the overview distance.
    const tiles = 4;
    const tile = size / tiles;
    for (let row = 0; row < tiles; row += 1) {
      for (let column = 0; column < tiles; column += 1) {
        const shade = 74 + Math.floor(random() * 12);
        ctx.fillStyle = `rgb(${shade - 6}, ${shade}, ${shade + 12})`;
        ctx.fillRect(column * tile, row * tile, tile, tile);

        // A soft specular corner keeps each slab from reading as one flat fill.
        const sheen = ctx.createLinearGradient(
          column * tile,
          row * tile,
          column * tile + tile,
          row * tile + tile,
        );
        sheen.addColorStop(0, "rgba(196, 218, 240, 0.07)");
        sheen.addColorStop(0.4, "rgba(196, 218, 240, 0.015)");
        sheen.addColorStop(1, "rgba(8, 12, 18, 0.08)");
        ctx.fillStyle = sheen;
        ctx.fillRect(column * tile, row * tile, tile, tile);
      }
    }

    // Very soft blotches instead of directional brush lines: lines repeat into
    // visible stripes at the camera distance of the overview preset.
    for (let index = 0; index < 180; index += 1) {
      const x = random() * size;
      const y = random() * size;
      const radius = 6 + random() * 22;
      const bright = random() > 0.5;
      ctx.fillStyle = bright
        ? `rgba(200, 220, 240, ${0.015 + random() * 0.02})`
        : `rgba(0, 4, 8, ${0.02 + random() * 0.035})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Seams: a wide dark joint plus a thin lit bevel one pixel inside it.
    for (let index = 0; index <= tiles; index += 1) {
      const position = Math.min(size - 1, index * tile);
      ctx.strokeStyle = "rgba(3, 6, 10, 0.92)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(position, 0);
      ctx.lineTo(position, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, position);
      ctx.lineTo(size, position);
      ctx.stroke();

      const bevel = Math.min(size - 1, position + 3);
      ctx.strokeStyle = "rgba(168, 194, 220, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bevel, 0);
      ctx.lineTo(bevel, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, bevel);
      ctx.lineTo(size, bevel);
      ctx.stroke();
    }

    // Faint speckles keep large flat areas from looking like plastic.
    for (let index = 0; index < 180; index += 1) {
      ctx.fillStyle = `rgba(190, 214, 236, ${0.015 + random() * 0.02})`;
      const x = random() * size;
      const y = random() * size;
      ctx.fillRect(x, y, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 3.5);
    texture.anisotropy = 8;
    return asColorMap(texture);
  });
}

/** Lit-window grid for the instanced skyline (base colour plus emissive map). */
export function windowsTexture(): THREE.CanvasTexture {
  return cached("windows", () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size, size);
    const random = makeRandom(0x7a3c19);

    // A faint blue facade instead of pure black: the tower silhouettes stay
    // readable against the dusk sky, and the lit cells look like windows on a
    // building rather than floating rectangles.
    const body = ctx.createLinearGradient(0, 0, size, 0);
    body.addColorStop(0, "#0a111a");
    body.addColorStop(0.5, "#0d1520");
    body.addColorStop(1, "#070c13");
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);

    // Equal-ish window cells: ten columns and twenty floors keep the grid
    // square on a tall tower face, so windows never stretch into light bars.
    const columns = 10;
    const rows = 20;
    const cellWidth = 40;
    const cellHeight = 18;
    const gapX = 10;
    const gapY = 7;
    const originX = 6;
    const originY = 6;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = originX + column * (cellWidth + gapX);
        const y = originY + row * (cellHeight + gapY);

        ctx.fillStyle = "rgba(4, 8, 13, 0.88)";
        ctx.fillRect(x - 2, y - 2, cellWidth + 4, cellHeight + 4);

        const roll = random();
        if (roll < 0.44) {
          ctx.fillStyle = "rgba(16, 25, 36, 0.9)";
          ctx.fillRect(x, y, cellWidth, cellHeight);
          continue;
        }

        const warm = random() > 0.4;
        const alpha = 0.34 + random() * 0.5;
        const window = ctx.createLinearGradient(x, y, x, y + cellHeight);
        if (warm) {
          window.addColorStop(0, `rgba(255, 228, 178, ${alpha})`);
          window.addColorStop(1, `rgba(224, 174, 116, ${alpha * 0.7})`);
        } else {
          window.addColorStop(0, `rgba(198, 224, 250, ${alpha})`);
          window.addColorStop(1, `rgba(148, 186, 226, ${alpha * 0.68})`);
        }
        ctx.fillStyle = window;
        ctx.fillRect(x, y, cellWidth, cellHeight);

        // A few rooms are half shuttered or hold a bright interior panel.
        if (roll < 0.53) {
          ctx.fillStyle = "rgba(5, 9, 15, 0.55)";
          ctx.fillRect(x, y, cellWidth, cellHeight * 0.45);
        } else if (roll < 0.56) {
          ctx.fillStyle = "rgba(255, 250, 235, 0.45)";
          ctx.fillRect(
            x + cellWidth * 0.12,
            y + cellHeight * 0.5,
            cellWidth * 0.3,
            cellHeight * 0.32,
          );
        }
      }
    }

    // Floor lines and a lit facade edge give the block some structure.
    ctx.strokeStyle = "rgba(120, 160, 198, 0.07)";
    ctx.lineWidth = 1;
    for (let row = 0; row <= rows; row += 1) {
      const y = originY - 6 + row * (cellHeight + gapY);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size, y + 0.5);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return asColorMap(texture);
  });
}

/** Dusk gradient with a faint star field, drawn behind the skyline. */
export function skyTexture(): THREE.CanvasTexture {
  return cached("sky", () => {
    const width = 1024;
    const height = 512;
    const { canvas, ctx } = createCanvas(width, height);
    const random = makeRandom(0x2d90be);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#02040a");
    gradient.addColorStop(0.45, "#071120");
    gradient.addColorStop(0.72, "#102133");
    gradient.addColorStop(0.88, "#20344a");
    gradient.addColorStop(1, "#2b3a4c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Blue-hour glow near the horizon, warmer on one side.
    const glow = ctx.createRadialGradient(
      width * 0.72,
      height * 0.86,
      10,
      width * 0.72,
      height * 0.86,
      width * 0.55,
    );
    glow.addColorStop(0, "rgba(120, 126, 150, 0.22)");
    glow.addColorStop(0.5, "rgba(70, 88, 118, 0.1)");
    glow.addColorStop(1, "rgba(20, 30, 44, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (let index = 0; index < 220; index += 1) {
      const y = random() * height * 0.62;
      const alpha = (0.06 + random() * 0.22) * (1 - y / (height * 0.7));
      ctx.fillStyle = `rgba(214, 228, 244, ${alpha})`;
      ctx.fillRect(random() * width, y, random() > 0.9 ? 2 : 1, 1);
    }

    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}

/** Scrolling monospace source code for the workstation monitors. */
export function screenTexture(): THREE.CanvasTexture {
  return cached("screen", () => {
    const width = 512;
    const height = 256;
    const { canvas, ctx } = createCanvas(width, height);
    const random = makeRandom(0x4410cc);

    ctx.fillStyle = "#04070b";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(18, 28, 40, 0.9)";
    ctx.fillRect(0, 0, 30, height);
    ctx.strokeStyle = "rgba(60, 82, 106, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30.5, 0);
    ctx.lineTo(30.5, height);
    ctx.stroke();

    const lines = 16;
    const lineHeight = height / lines;
    const keywords = [
      "const",
      "async",
      "await",
      "return",
      "export",
      "if",
      "type",
      "new",
      "let",
    ];
    const identifiers = [
      "session",
      "verifyToken",
      "refresh",
      "payload",
      "router",
      "audit",
      "cache",
      "queue",
      "handler",
      "result",
      "attempt",
      "status",
      "rotate",
      "claims",
      "middleware",
      "db",
      "token",
    ];
    const operators = ["=", "=>", ":", ".", "??", "&&", "===", "+"];
    const comments = [
      "// refresh rotation, single use",
      "// verify the bearer token",
      "// keep the access token short lived",
      "// audit failed login attempts",
      "// rotate only once per session",
    ];

    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";

    for (let line = 0; line < lines; line += 1) {
      const y = line * lineHeight + lineHeight / 2;
      const lineNumber = String((line * 7 + 12) % 240).padStart(3, " ");
      ctx.fillStyle = "rgba(86, 106, 130, 0.8)";
      ctx.fillText(lineNumber, 6, y);

      if (random() < 0.18) {
        ctx.fillStyle = "rgba(104, 130, 154, 0.85)";
        ctx.fillText(
          comments[Math.floor(random() * comments.length)],
          40,
          y,
        );
        continue;
      }

      const lineEnd = width * (0.42 + random() * 0.5);
      let x = 40 + Math.floor(random() * 4) * 8;
      while (x < lineEnd) {
        const roll = random();
        let text: string;
        let color: string;
        if (roll < 0.3) {
          text = keywords[Math.floor(random() * keywords.length)];
          color = "#f0a25c";
        } else if (roll < 0.72) {
          text = identifiers[Math.floor(random() * identifiers.length)];
          color = "rgba(214, 222, 232, 0.9)";
        } else if (roll < 0.86) {
          text = operators[Math.floor(random() * operators.length)];
          color = "#c88b4c";
        } else {
          text = `"${identifiers[Math.floor(random() * identifiers.length)]}"`;
          color = "#d8bb92";
        }
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        x += ctx.measureText(text).width + 5;
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    return asColorMap(texture);
  });
}

/** Soft radial blob used for contact shadows. */
export function blobTexture(): THREE.CanvasTexture {
  return cached("blob", () => {
    const size = 128;
    const { canvas, ctx } = createCanvas(size, size);
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.62)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.26)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}

/** Neutral radial glow, tinted by the material that uses it. */
export function glowTexture(): THREE.CanvasTexture {
  return cached("glow", () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size, size);
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.2)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}

/**
 * Mission-control wall screen surface. The canvas and texture are built once
 * for the tab; phase 5's MissionControl component repaints the canvas from
 * live data and sets `texture.needsUpdate` after each redraw. The initial
 * paint is the dark screen background so the first frame is never white.
 */
export interface MissionSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

let missionSurface: MissionSurface | null = null;

export function missionControlSurface(): MissionSurface {
  if (missionSurface !== null) return missionSurface;
  const width = MISSION_CANVAS_WIDTH;
  const height = MISSION_CANVAS_HEIGHT;
  const { canvas, ctx } = createCanvas(width, height);

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0b1725");
  background.addColorStop(0.55, "#07111c");
  background.addColorStop(1, "#04090f");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  asColorMap(texture);
  missionSurface = { canvas, ctx, texture };
  return missionSurface;
}

/** Whiteboard surface for the planning board, without cards. */
export function boardTexture(): THREE.CanvasTexture {
  return cached("board", () => {
    const pxPerMetre = 300;
    const width = Math.round(PLANNING_BOARD.width * pxPerMetre);
    const height = Math.round(PLANNING_BOARD.height * pxPerMetre);
    const { canvas, ctx } = createCanvas(width, height);
    const random = makeRandom(0x1b7ea4);

    const surface = ctx.createLinearGradient(0, 0, 0, height);
    surface.addColorStop(0, "#e9edf1");
    surface.addColorStop(0.55, "#dfe4ea");
    surface.addColorStop(1, "#d3d9e0");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height);

    // Soft marker smudges keep the surface from looking like flat paint.
    for (let index = 0; index < 90; index += 1) {
      ctx.fillStyle = `rgba(90, 108, 126, ${0.01 + random() * 0.018})`;
      ctx.beginPath();
      ctx.ellipse(
        random() * width,
        random() * height,
        14 + random() * 60,
        4 + random() * 14,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.fillStyle = "#2d3a48";
    ctx.font = "600 34px Inter, system-ui, sans-serif";
    ctx.fillText("SPRINT PLANNING", 40, 58);
    ctx.fillStyle = "rgba(70, 88, 106, 0.8)";
    ctx.font = "16px ui-monospace, Menlo, monospace";
    ctx.fillText("TASK CARDS ARRIVE AS WORK IS PLANNED", 40, 88);
    ctx.textAlign = "right";
    ctx.fillText(`${PLANNING_CARD_LIMIT} SLOTS`, width - 40, 58);
    ctx.textAlign = "left";

    const headerY = Math.round((height / PLANNING_BOARD.height) * PLANNING_BOARD.topInset);
    ctx.strokeStyle = "rgba(84, 102, 120, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerY - 8.5);
    ctx.lineTo(width, headerY - 8.5);
    ctx.stroke();

    // Faint cells behind the 3D cards; the card grid is shared with the
    // headless layout checks so the two can never drift apart.
    const { cardWidth, cardHeight, gap } = PLANNING_BOARD;
    const rows = Math.ceil(PLANNING_CARD_LIMIT / PLANNING_BOARD.columns);
    const gridWidth =
      PLANNING_BOARD.columns * cardWidth + (PLANNING_BOARD.columns - 1) * gap;
    const left = (PLANNING_BOARD.width - gridWidth) / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < PLANNING_BOARD.columns; column += 1) {
        const x = (left + column * (cardWidth + gap)) * pxPerMetre;
        const y =
          headerY + row * (cardHeight + gap) * pxPerMetre;
        ctx.fillStyle = "rgba(84, 102, 120, 0.045)";
        ctx.beginPath();
        ctx.roundRect(
          x,
          y,
          cardWidth * pxPerMetre,
          cardHeight * pxPerMetre,
          8,
        );
        ctx.fill();
        ctx.strokeStyle = "rgba(84, 102, 120, 0.18)";
        ctx.stroke();
      }
    }

    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}
