import * as THREE from "three";

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

    ctx.fillStyle = "#101821";
    ctx.fillRect(0, 0, size, size);

    const tiles = 4;
    const tile = size / tiles;
    for (let row = 0; row < tiles; row += 1) {
      for (let column = 0; column < tiles; column += 1) {
        const shade = 24 + Math.floor(random() * 7);
        ctx.fillStyle = `rgb(${shade}, ${shade + 7}, ${shade + 16})`;
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
        ? `rgba(200, 220, 240, ${0.01 + random() * 0.018})`
        : `rgba(0, 4, 8, ${0.02 + random() * 0.03})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Seams.
    ctx.strokeStyle = "rgba(5, 8, 12, 0.85)";
    ctx.lineWidth = 2;
    for (let index = 0; index <= tiles; index += 1) {
      const position = Math.min(size - 1, index * tile);
      ctx.beginPath();
      ctx.moveTo(position, 0);
      ctx.lineTo(position, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, position);
      ctx.lineTo(size, position);
      ctx.stroke();
    }

    // Faint speckles keep large flat areas from looking like plastic.
    for (let index = 0; index < 180; index += 1) {
      ctx.fillStyle = `rgba(190, 214, 236, ${0.01 + random() * 0.018})`;
      const x = random() * size;
      const y = random() * size;
      ctx.fillRect(x, y, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 7);
    return asColorMap(texture);
  });
}

/** Lit-window grid for the instanced skyline (base colour plus emissive map). */
export function windowsTexture(): THREE.CanvasTexture {
  return cached("windows", () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size, size);
    const random = makeRandom(0x7a3c19);

    ctx.fillStyle = "#03060b";
    ctx.fillRect(0, 0, size, size);

    const cellWidth = 6;
    const cellHeight = 3;
    const gapX = 3;
    const gapY = 3;
    const columns = Math.floor(size / (cellWidth + gapX));
    const rows = Math.floor(size / (cellHeight + gapY));

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (random() < 0.58) continue;
        const warm = random() > 0.34;
        const alpha = 0.26 + random() * 0.54;
        ctx.fillStyle = warm
          ? `rgba(246, 208, 148, ${alpha})`
          : `rgba(170, 206, 240, ${alpha * 0.7})`;
        ctx.fillRect(
          column * (cellWidth + gapX) + gapX,
          row * (cellHeight + gapY) + gapY,
          cellWidth,
          cellHeight,
        );
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
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

/** Warm radial glow for the hub and the light pools under the desks. */
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
    gradient.addColorStop(0, "rgba(255, 226, 178, 0.5)");
    gradient.addColorStop(0.35, "rgba(255, 206, 145, 0.18)");
    gradient.addColorStop(1, "rgba(255, 190, 120, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}

/**
 * Mission-control wall screen. Phase 3 keeps the content structural: the
 * workflow pipeline, the roster and the simulation disclaimer. Phase 5
 * replaces this drawing with live task content.
 */
export function missionControlTexture(): THREE.CanvasTexture {
  return cached("mission-control", () => {
    const width = 1024;
    const height = 512;
    const { canvas, ctx } = createCanvas(width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#08111c");
    background.addColorStop(1, "#04080e");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    // Header bar.
    ctx.fillStyle = "rgba(12, 22, 34, 0.95)";
    ctx.fillRect(0, 0, width, 66);
    ctx.strokeStyle = "rgba(124, 196, 214, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 66.5);
    ctx.lineTo(width, 66.5);
    ctx.stroke();

    ctx.fillStyle = "#7cc4d6";
    ctx.beginPath();
    ctx.arc(38, 33, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e8eef4";
    ctx.font = "600 22px Inter, system-ui, sans-serif";
    ctx.fillText("MISSION CONTROL", 58, 42);

    ctx.fillStyle = "rgba(183, 193, 207, 0.72)";
    ctx.font = "13px ui-monospace, Menlo, monospace";
    ctx.fillText("ORCHESTRATION OVERVIEW", 300, 41);

    ctx.fillStyle = "#6fe3a4";
    ctx.font = "600 14px ui-monospace, Menlo, monospace";
    ctx.fillText("SIMULATION MODE", 760, 41);

    // Workflow pipeline.
    ctx.fillStyle = "rgba(183, 193, 207, 0.78)";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText("WORKFLOW", 36, 108);

    const stages = [
      "INTAKE",
      "PLANNING",
      "RESEARCH",
      "BUILD",
      "QA",
      "REVIEW",
      "DONE",
    ];
    const stageWidth = 130;
    const stageHeight = 56;
    const stageGap = 10;
    stages.forEach((stage, index) => {
      const x = 36 + index * (stageWidth + stageGap);
      const y = 130;
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      ctx.fillRect(x, y, stageWidth, stageHeight);
      ctx.strokeStyle = "rgba(124, 196, 214, 0.18)";
      ctx.strokeRect(x + 0.5, y + 0.5, stageWidth - 1, stageHeight - 1);
      ctx.fillStyle = "rgba(238, 242, 247, 0.9)";
      ctx.font = "600 14px ui-monospace, Menlo, monospace";
      ctx.fillText(stage, x + 14, y + 25);
      ctx.fillStyle = "rgba(124, 196, 214, 0.65)";
      ctx.fillRect(x + 14, y + 34, 26 + ((index * 13) % 54), 3);
    });

    ctx.fillStyle = "rgba(183, 193, 207, 0.62)";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText("Agents pick up queued tasks automatically", 36, 214);

    // Roster.
    ctx.fillStyle = "rgba(183, 193, 207, 0.78)";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText("TEAM", 36, 266);

    const roster = [
      ["ORION", "Orchestrator", "#E8B04A"],
      ["IRIS", "Researcher", "#5CC8D7"],
      ["PIPER", "Product Manager", "#A78BFA"],
      ["KAI", "Software Engineer", "#6C9EFF"],
      ["QUINN", "QA Engineer", "#5FD39A"],
      ["REX", "Code Reviewer", "#F08A7E"],
    ];
    roster.forEach(([name, role, color], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 36 + column * 320;
      const y = 292 + row * 54;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 12, 4, 26);
      ctx.fillStyle = "rgba(238, 242, 247, 0.94)";
      ctx.font = "600 15px Inter, system-ui, sans-serif";
      ctx.fillText(name, x + 14, y + 4);
      ctx.fillStyle = "rgba(148, 162, 180, 0.85)";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText(role, x + 14, y + 22);
    });

    // Footer.
    ctx.fillStyle = "rgba(6, 10, 15, 0.9)";
    ctx.fillRect(0, height - 44, width, 44);
    ctx.fillStyle = "rgba(148, 162, 180, 0.78)";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText(
      "Deterministic local simulation  /  no model inference  /  no code execution",
      36,
      height - 18,
    );
    ctx.fillStyle = "rgba(124, 196, 214, 0.7)";
    ctx.fillText("LINK  OK", width - 116, height - 18);

    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}

/** Whiteboard surface for the planning board, without cards. */
export function boardTexture(): THREE.CanvasTexture {
  return cached("board", () => {
    const width = 1024;
    const height = 640;
    const { canvas, ctx } = createCanvas(width, height);
    const random = makeRandom(0x1b7ea4);

    const surface = ctx.createLinearGradient(0, 0, width, height);
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
    ctx.font = "600 26px Inter, system-ui, sans-serif";
    ctx.fillText("SPRINT PLANNING", 36, 52);
    ctx.fillStyle = "rgba(70, 88, 106, 0.8)";
    ctx.font = "14px ui-monospace, Menlo, monospace";
    ctx.fillText("TASK CARDS ARRIVE AS WORK IS PLANNED", 36, 76);

    const columns = ["BACKLOG", "IN PROGRESS", "REVIEW", "DONE"];
    const columnWidth = (width - 72 - 3 * 18) / 4;
    columns.forEach((label, index) => {
      const x = 36 + index * (columnWidth + 18);
      ctx.fillStyle = "rgba(84, 102, 120, 0.1)";
      ctx.fillRect(x, 104, columnWidth, height - 148);
      ctx.strokeStyle = "rgba(84, 102, 120, 0.25)";
      ctx.strokeRect(x + 0.5, 104.5, columnWidth - 1, height - 149);
      ctx.fillStyle = "rgba(54, 70, 88, 0.85)";
      ctx.font = "600 14px ui-monospace, Menlo, monospace";
      ctx.fillText(label, x + 14, 130);
    });

    return asColorMap(new THREE.CanvasTexture(canvas));
  });
}
