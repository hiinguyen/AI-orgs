import * as THREE from "three";

/**
 * Status strip shared by the sprint and research boards: a dark pill with a
 * label on the left and a progress bar with a percent readout on the right.
 * The canvas is repainted only when the strip content changes.
 */

export const STRIP_PX_PER_METRE = 300;

export interface StripContent {
  label: string;
  /** 0..1 fill, or null to draw the empty idle track. */
  ratio: number | null;
  percentText: string;
}

export interface StripStyle {
  accent: string;
  background: string;
  track: string;
  text: string;
  muted: string;
}

export interface StripSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export function createStripSurface(
  widthMetres: number,
  heightMetres: number,
): StripSurface {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthMetres * STRIP_PX_PER_METRE);
  canvas.height = Math.round(heightMetres * STRIP_PX_PER_METRE);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, ctx, texture };
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
  return `${text.slice(0, end)}...`;
}

export function drawStrip(
  surface: StripSurface,
  content: StripContent,
  style: StripStyle,
): void {
  const { ctx, canvas, texture } = surface;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = style.background;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, height / 2);
  ctx.fill();

  const pad = height * 0.5;
  const barWidth = width * 0.28;
  const percentWidth = 64;
  const barX = width - pad - percentWidth - barWidth;
  const barHeight = height * 0.3;
  const barY = (height - barHeight) / 2;

  ctx.textBaseline = "middle";
  ctx.font = "600 17px ui-monospace, Menlo, monospace";
  ctx.fillStyle = content.ratio === null ? style.muted : style.text;
  ctx.fillText(fitText(ctx, content.label, barX - pad * 2), pad, height / 2 + 1);

  ctx.fillStyle = style.track;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fill();
  if (content.ratio !== null && content.ratio > 0) {
    ctx.fillStyle = style.accent;
    ctx.beginPath();
    ctx.roundRect(
      barX,
      barY,
      Math.max(barHeight, barWidth * content.ratio),
      barHeight,
      barHeight / 2,
    );
    ctx.fill();
  }

  ctx.textAlign = "right";
  ctx.fillStyle = content.ratio === null ? style.muted : style.accent;
  ctx.fillText(content.percentText, width - pad, height / 2 + 1);
  ctx.textAlign = "left";

  texture.needsUpdate = true;
}
