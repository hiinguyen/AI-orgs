import {
  MISSION_CHART_COLORS,
  MISSION_CHART_LABELS,
  MISSION_CHART_PHASES,
  type MissionTaskRow,
  type MissionView,
} from "./missionContent.ts";

/**
 * Canvas 2D drawing for the live mission-control wall. Called at most four
 * times per second, and only when the content signature changed. Type sizes
 * are deliberately large: the wall is about 250-290 px wide at the overview
 * camera preset, so small dashboard text would turn into a blur.
 */

export const MISSION_CANVAS_WIDTH = 2048;
export const MISSION_CANVAS_HEIGHT = 740;

const HEADER_HEIGHT = 104;
const MUTED = "rgba(183, 193, 207, 0.82)";
const FAINT = "rgba(124, 196, 214, 0.16)";
const PANEL = "rgba(12, 24, 38, 0.62)";
const FALLBACK_SANS = "system-ui, sans-serif";

/**
 * Resolved UI sans family for the wall. The app sets `--font-sans` from the
 * Next font class; canvas text does not inherit it and the literal "Inter"
 * only works when the OS happens to have that family installed.
 */
let sansFamily = FALLBACK_SANS;

/** Build a canvas font shorthand from the resolved family. */
export function missionSans(size: number, weight: number = 400): string {
  return `${weight} ${size}px ${sansFamily}`;
}

/**
 * Resolve `--font-sans` once from the document root. Values that still hold a
 * `var()` reference (for example the Next font variable) are expanded from the
 * same scope, and anything unresolved falls back to system-ui.
 */
export function resolveMissionFont(): string {
  if (typeof document === "undefined") {
    sansFamily = FALLBACK_SANS;
    return sansFamily;
  }
  const root = getComputedStyle(document.documentElement);
  const raw = root.getPropertyValue("--font-sans").trim();
  if (raw.length === 0) {
    sansFamily = FALLBACK_SANS;
    return sansFamily;
  }
  const expanded = raw.replace(
    /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)/g,
    (match, name: string) => {
      const value = root.getPropertyValue(name).trim();
      return value.length > 0 ? value : match;
    },
  );
  sansFamily = expanded.includes("var(") ? FALLBACK_SANS : expanded;
  return sansFamily;
}

const CHART = {
  top: 220,
  baseline: 650,
  maxBar: 380,
  left: 58,
  columnWidth: 74,
  barWidth: 46,
} as const;

const TASK_PANEL = {
  x: 700,
  top: 168,
  width: 660,
  heroHeight: 196,
  rowTop: 376,
  rowHeight: 104,
  rowGap: 8,
} as const;

const ROSTER = {
  x: 1400,
  top: 168,
  width: 608,
  cellWidth: 300,
  columnGap: 8,
  rowHeight: 172,
  rowGap: 10,
} as const;

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const background = ctx.createLinearGradient(0, 0, 0, MISSION_CANVAS_HEIGHT);
  background.addColorStop(0, "#0b1725");
  background.addColorStop(0.55, "#07111c");
  background.addColorStop(1, "#04090f");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, MISSION_CANVAS_WIDTH, MISSION_CANVAS_HEIGHT);

  ctx.strokeStyle = "rgba(124, 196, 214, 0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= MISSION_CANVAS_WIDTH; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, MISSION_CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= MISSION_CANVAS_HEIGHT; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(MISSION_CANVAS_WIDTH, y + 0.5);
    ctx.stroke();
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, view: MissionView): void {
  ctx.fillStyle = "rgba(10, 21, 34, 0.96)";
  ctx.fillRect(0, 0, MISSION_CANVAS_WIDTH, HEADER_HEIGHT);
  ctx.strokeStyle = "rgba(124, 196, 214, 0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(MISSION_CANVAS_WIDTH, HEADER_HEIGHT);
  ctx.stroke();

  const pillWidth = 560;
  const pillHeight = 50;
  const pillX = MISSION_CANVAS_WIDTH - 40 - pillWidth;
  const pillY = 27;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = view.simulated ? "#e8b04a" : "#6fe3a4";
  ctx.beginPath();
  ctx.arc(44, 52, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f2f6fb";
  ctx.font = missionSans(64, 700);
  const title = "MISSION CONTROL";
  ctx.fillText(title, 68, 56);
  const titleWidth = ctx.measureText(title).width;

  const subtitle = "ORCHESTRATION OVERVIEW";
  ctx.font = "16px ui-monospace, Menlo, monospace";
  const subtitleWidth = ctx.measureText(subtitle).width;
  const subtitleX = Math.min(
    68 + titleWidth + 40,
    pillX - 24 - subtitleWidth,
  );
  ctx.fillStyle = MUTED;
  ctx.fillText(subtitle, subtitleX, 56);

  ctx.fillStyle = view.simulated
    ? "rgba(232, 176, 74, 0.12)"
    : "rgba(111, 227, 164, 0.12)";
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 25);
  ctx.fill();
  ctx.strokeStyle = view.simulated
    ? "rgba(232, 176, 74, 0.55)"
    : "rgba(111, 227, 164, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = view.simulated ? "#f2c879" : "#8ff0bb";
  ctx.beginPath();
  ctx.arc(pillX + 26, pillY + pillHeight / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "700 18px ui-monospace, Menlo, monospace";
  ctx.fillText(
    view.simulated
      ? "SIMULATION MODE - NO LIVE INFERENCE"
      : "LIVE BACKEND CONNECTED",
    pillX + 44,
    pillY + pillHeight / 2 + 1,
  );
  ctx.textBaseline = "alphabetic";
}

function sectionTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
): void {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(183, 193, 207, 0.9)";
  ctx.font = missionSans(30, 700);
  ctx.fillText(text, x, 152);
}

function drawChart(ctx: CanvasRenderingContext2D, view: MissionView): void {
  sectionTitle(ctx, "TASKS BY WORKFLOW PHASE", 48);

  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  for (let step = 0; step <= 3; step += 1) {
    const y = CHART.baseline - (step / 3) * CHART.maxBar;
    ctx.beginPath();
    ctx.moveTo(44, y + 0.5);
    ctx.lineTo(636, y + 0.5);
    ctx.stroke();
  }

  let maxCount = 1;
  for (const count of view.counts) maxCount = Math.max(maxCount, count);

  ctx.textAlign = "center";
  MISSION_CHART_PHASES.forEach((phase, index) => {
    const count = view.counts[index] ?? 0;
    const color = MISSION_CHART_COLORS[phase];
    const x = CHART.left + index * CHART.columnWidth;
    const barHeight =
      count === 0 ? 6 : 24 + (count / maxCount) * (CHART.maxBar - 24);
    const barTop = CHART.baseline - barHeight;

    const fill = ctx.createLinearGradient(0, barTop, 0, CHART.baseline);
    fill.addColorStop(0, color);
    fill.addColorStop(1, "rgba(24, 42, 58, 0.6)");
    ctx.fillStyle = fill;
    ctx.fillRect(x, barTop, CHART.barWidth, barHeight);
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.fillRect(x, barTop, CHART.barWidth, 3);

    ctx.fillStyle = "rgba(238, 245, 251, 0.96)";
    ctx.font = "700 29px ui-monospace, Menlo, monospace";
    ctx.fillText(String(count), x + CHART.barWidth / 2, barTop - 13);

    ctx.fillStyle = "rgba(180, 194, 209, 0.9)";
    ctx.font = "600 14px ui-monospace, Menlo, monospace";
    ctx.fillText(
      MISSION_CHART_LABELS[phase],
      x + CHART.barWidth / 2,
      CHART.baseline + 28,
    );
  });
  ctx.textAlign = "left";
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}...`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end).trimEnd()}...`;
}

/** Word wrap into at most `maxLines`, with an ellipsis on the last line. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index];
    index += 1;
    while (index < words.length) {
      const candidate = `${line} ${words[index]}`;
      if (ctx.measureText(candidate).width > maxWidth) break;
      line = candidate;
      index += 1;
    }
    lines.push(line);
  }
  if (index < words.length && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = fitText(
      ctx,
      `${lines[last]} ${words.slice(index).join(" ")}`,
      maxWidth,
    );
  }
  return lines.map((line) => fitText(ctx, line, maxWidth));
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(124, 196, 214, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawProgress(
  ctx: CanvasRenderingContext2D,
  task: MissionTaskRow,
  x: number,
  y: number,
  width: number,
  height: number,
  right: number,
): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
  if (task.progress > 0) {
    ctx.fillStyle = task.color;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(height, width * task.progress), height, height / 2);
    ctx.fill();
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "#eef2f7";
  const percentSize = height >= 10 ? 22 : 17;
  ctx.font = `600 ${percentSize}px ui-monospace, Menlo, monospace`;
  ctx.fillText(
    `${Math.round(task.progress * 100)}%`,
    right,
    y + (height >= 10 ? 20 : 16),
  );
  ctx.textAlign = "left";
}

function drawHeroTask(
  ctx: CanvasRenderingContext2D,
  task: MissionTaskRow,
): void {
  const x = TASK_PANEL.x;
  const y = TASK_PANEL.top;
  const width = TASK_PANEL.width;
  const height = TASK_PANEL.heroHeight;
  panel(ctx, x, y, width, height, 12);
  ctx.fillStyle = task.color;
  ctx.fillRect(x, y + 2, 7, height - 4);

  ctx.fillStyle = "#eef2f7";
  ctx.font = missionSans(46, 700);
  const lines = wrapText(ctx, task.title, width - 48, 2);
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 24, y + 52 + index * 52);
  });

  ctx.fillStyle = task.color;
  ctx.font = "600 21px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `${task.phaseLabel.toUpperCase()} / ${task.agentName.toUpperCase()}`,
    x + 24,
    y + 140,
  );
  drawProgress(ctx, task, x + 24, y + 156, 500, 10, x + width - 24);
}

function drawCompactTask(
  ctx: CanvasRenderingContext2D,
  task: MissionTaskRow,
  index: number,
): void {
  const x = TASK_PANEL.x;
  const y = TASK_PANEL.rowTop + index * (TASK_PANEL.rowHeight + TASK_PANEL.rowGap);
  const width = TASK_PANEL.width;
  panel(ctx, x, y, width, TASK_PANEL.rowHeight, 10);
  ctx.fillStyle = task.color;
  ctx.fillRect(x, y + 2, 6, TASK_PANEL.rowHeight - 4);

  ctx.fillStyle = "#eef2f7";
  ctx.font = missionSans(32, 700);
  ctx.fillText(fitText(ctx, task.title, width - 48), x + 24, y + 36);

  ctx.fillStyle = task.color;
  ctx.font = "600 17px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `${task.phaseLabel.toUpperCase()} / ${task.agentName.toUpperCase()}`,
    x + 24,
    y + 62,
  );
  ctx.fillStyle = "#eef2f7";
  drawProgress(ctx, task, x + 24, y + 78, 500, 6, x + width - 24);
}

function drawTasks(ctx: CanvasRenderingContext2D, view: MissionView): void {
  sectionTitle(ctx, "ACTIVE TASKS", TASK_PANEL.x);

  ctx.textAlign = "right";
  ctx.fillStyle = MUTED;
  ctx.font = "600 14px ui-monospace, Menlo, monospace";
  ctx.fillText(
    `${view.tasks.length} IN FLIGHT`,
    TASK_PANEL.x + TASK_PANEL.width - 4,
    152,
  );
  ctx.textAlign = "left";

  if (view.tasks.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(183, 193, 207, 0.55)";
    ctx.font = "600 24px ui-monospace, Menlo, monospace";
    ctx.fillText("NO ACTIVE TASKS", TASK_PANEL.x + TASK_PANEL.width / 2, 420);
    ctx.font = "14px ui-monospace, Menlo, monospace";
    ctx.fillText(
      "QUEUED WORK STARTS WHEN THE ORCHESTRATOR DELEGATES",
      TASK_PANEL.x + TASK_PANEL.width / 2,
      454,
    );
    ctx.textAlign = "left";
    return;
  }

  drawHeroTask(ctx, view.tasks[0]);
  for (let index = 1; index < view.tasks.length; index += 1) {
    drawCompactTask(ctx, view.tasks[index], index - 1);
  }
}

function drawRosterCell(
  ctx: CanvasRenderingContext2D,
  view: MissionView,
  index: number,
): void {
  const agent = view.agents[index];
  if (!agent) return;
  const column = index % 2;
  const row = Math.floor(index / 2);
  const x = ROSTER.x + column * (ROSTER.cellWidth + ROSTER.columnGap);
  const y = ROSTER.top + row * (ROSTER.rowHeight + ROSTER.rowGap);

  panel(ctx, x, y, ROSTER.cellWidth, ROSTER.rowHeight, 10);
  ctx.fillStyle = agent.color;
  ctx.fillRect(x, y + 2, 5, ROSTER.rowHeight - 4);

  ctx.fillStyle = agent.color;
  ctx.beginPath();
  ctx.roundRect(x + 16, y + 16, 46, 46, 10);
  ctx.fill();
  ctx.fillStyle = "#071016";
  ctx.font = missionSans(24, 700);
  ctx.textAlign = "center";
  ctx.fillText(agent.name.slice(0, 1), x + 39, y + 31);
  ctx.textAlign = "left";

  ctx.fillStyle = "#eef2f7";
  ctx.font = missionSans(34, 700);
  ctx.fillText(agent.name, x + 76, y + 44);
  ctx.fillStyle = MUTED;
  ctx.font = missionSans(15);
  ctx.fillText(agent.roleLabel, x + 76, y + 70);

  ctx.fillStyle = agent.statusColor;
  ctx.beginPath();
  ctx.arc(x + 82, y + 106, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = agent.statusColor;
  ctx.font = "600 17px ui-monospace, Menlo, monospace";
  ctx.fillText(agent.statusLabel, x + 94, y + 111);
}

function drawRoster(ctx: CanvasRenderingContext2D, view: MissionView): void {
  sectionTitle(ctx, "TEAM", ROSTER.x);
  for (let index = 0; index < view.agents.length; index += 1) {
    drawRosterCell(ctx, view, index);
  }
}

/** Repaint the whole wall from a derived view. */
export function drawMissionControl(
  ctx: CanvasRenderingContext2D,
  view: MissionView,
): void {
  ctx.clearRect(0, 0, MISSION_CANVAS_WIDTH, MISSION_CANVAS_HEIGHT);
  drawBackground(ctx);
  drawHeader(ctx, view);

  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(676, 122);
  ctx.lineTo(676, 720);
  ctx.moveTo(1372, 122);
  ctx.lineTo(1372, 720);
  ctx.stroke();

  drawChart(ctx, view);
  drawTasks(ctx, view);
  drawRoster(ctx, view);
}
