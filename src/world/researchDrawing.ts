import {
  RESEARCH_ACCENT,
  RESEARCH_BOARD,
  RESEARCH_ROW_LIMIT,
  type ResearchView,
} from "./researchContent";

/**
 * Painter for the research display. Dark glass panel with a teal accent, so it
 * reads as the opposite of the white sprint board. Rows scale in through
 * `scaleFor`, which the component derives from each row's age.
 */

const BACKGROUND_TOP = "#0c1a24";
const BACKGROUND_BOTTOM = "#07121a";
const TEXT = "#dbe7ee";
const MUTED = "#6f8797";
const FONT_MONO = "ui-monospace, Menlo, monospace";
const FONT_SANS = "Inter, system-ui, sans-serif";

const MARGIN = 44;
const ROW_TOP = 196;
const ROW_HEIGHT = 70;
const ROW_GAP = 6;
const BADGE_RADIUS = 18;

export function researchCanvasSize(): { width: number; height: number } {
  return {
    width: Math.round(RESEARCH_BOARD.width * RESEARCH_BOARD.pxPerMetre),
    height: Math.round(RESEARCH_BOARD.height * RESEARCH_BOARD.pxPerMetre),
  };
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const candidate = current === "" ? words[index] : `${current} ${words[index]}`;
    if (ctx.measureText(candidate).width <= maxWidth || current === "") {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = words[index];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current !== "") lines.push(current);
  if (lines.length === maxLines) {
    const rest = words.join(" ").length > lines.join(" ").length;
    if (rest) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}...`;
    }
  }
  return lines;
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  view: ResearchView,
  width: number,
): void {
  ctx.fillStyle = RESEARCH_ACCENT;
  ctx.fillRect(0, 0, 10, ctx.canvas.height);

  ctx.textBaseline = "alphabetic";
  ctx.font = `700 40px ${FONT_SANS}`;
  ctx.fillText("RESEARCH", MARGIN, 66);

  ctx.textAlign = "right";
  ctx.fillStyle = MUTED;
  ctx.font = `16px ${FONT_MONO}`;
  const state = view.researching
    ? "LIVE"
    : view.rows.length > 0
      ? "PUBLISHED"
      : "IDLE";
  ctx.fillText(
    `${state}  /  ${view.rows.length} FINDINGS`,
    width - MARGIN,
    62,
  );
  ctx.textAlign = "left";

  ctx.fillStyle = MUTED;
  ctx.font = `15px ${FONT_MONO}`;
  ctx.fillText("QUESTION", MARGIN, 108);
  ctx.fillStyle = TEXT;
  ctx.font = `500 22px ${FONT_SANS}`;
  const lines = wrapLines(ctx, view.topic, width - MARGIN * 2, 2);
  lines.forEach((line, index) => ctx.fillText(line, MARGIN, 138 + index * 28));

  ctx.strokeStyle = "rgba(92, 200, 215, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, 176.5);
  ctx.lineTo(width - MARGIN, 176.5);
  ctx.stroke();
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
): void {
  ctx.strokeStyle = "rgba(111, 135, 151, 0.25)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.roundRect(MARGIN, y, width - MARGIN * 2, ROW_HEIGHT, 10);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  index: number,
  text: string,
  y: number,
  width: number,
  scale: number,
): void {
  ctx.save();
  ctx.globalAlpha = scale;
  ctx.translate((1 - scale) * 40, 0);

  ctx.fillStyle = "rgba(92, 200, 215, 0.09)";
  ctx.beginPath();
  ctx.roundRect(MARGIN, y, width - MARGIN * 2, ROW_HEIGHT, 10);
  ctx.fill();

  const cy = y + ROW_HEIGHT / 2;
  ctx.fillStyle = RESEARCH_ACCENT;
  ctx.beginPath();
  ctx.arc(MARGIN + 14 + BADGE_RADIUS, cy, BADGE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BACKGROUND_BOTTOM;
  ctx.font = `700 18px ${FONT_MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index), MARGIN + 14 + BADGE_RADIUS, cy + 1);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = `18px ${FONT_SANS}`;
  const textX = MARGIN + 14 + BADGE_RADIUS * 2 + 16;
  const lines = wrapLines(ctx, text, width - MARGIN - 20 - textX, 2);
  const startY = cy - ((lines.length - 1) * 24) / 2 + 6;
  lines.forEach((line, lineIndex) =>
    ctx.fillText(line, textX, startY + lineIndex * 24),
  );
  ctx.restore();
}

/** Repaint the whole panel. `scaleFor` returns 0..1 per row key. */
export function drawResearch(
  ctx: CanvasRenderingContext2D,
  view: ResearchView,
  scaleFor: (key: string) => number,
): void {
  const { width, height } = ctx.canvas;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, BACKGROUND_TOP);
  background.addColorStop(1, BACKGROUND_BOTTOM);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  drawHeader(ctx, view, width);

  for (let slot = 0; slot < RESEARCH_ROW_LIMIT; slot += 1) {
    const y = ROW_TOP + slot * (ROW_HEIGHT + ROW_GAP);
    const row = view.rows[slot];
    if (row === undefined) {
      drawPlaceholder(ctx, y, width);
    } else {
      drawRow(ctx, row.index, row.text, y, width, scaleFor(row.key));
    }
  }
}
