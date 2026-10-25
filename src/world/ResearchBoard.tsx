"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RESEARCH_BOARD_CENTER } from "@/simulation/worldLayout";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { liveWorld } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import {
  geometries,
  materials,
  sharedGeometry,
  sharedMaterial,
} from "./sharedResources";
import {
  BOARD_FEET_DEPTH,
  CARD_SCALE_SECONDS,
  cardScale,
} from "./planningContent";
import {
  RESEARCH_ACCENT,
  RESEARCH_BOARD,
  RESEARCH_BOARD_FACE_OFFSET,
  RESEARCH_BOARD_FRAME_WIDTH,
  RESEARCH_BOARD_ROTATION,
  researchSignature,
  researchView,
  type ResearchView,
} from "./researchContent";
import { drawResearch, researchCanvasSize } from "./researchDrawing";
import {
  createStripSurface,
  drawStrip,
  type StripStyle,
  type StripSurface,
} from "./boardStrip";
import { stationWorking } from "./stationPresence";
import { getAgentProfile } from "@/agents/AgentRegistry";

/**
 * Dark display panel that lists research findings as rows while the
 * researcher works. The canvas is repainted when the content signature
 * changes, and every frame only while a new row is still scaling in.
 */

/** Feet are 0.5 m deep boxes; their back edge sits at BOARD_FEET_DEPTH. */
const FOOT_X = 0.25 - BOARD_FEET_DEPTH;
const GLOW_LAMBDA = 5;
const IDLE_GLOW = 0.4;
const ACTIVE_GLOW = 2.3;
const SIGNATURE_INTERVAL_SECONDS = 0.2;
const SCALE_REPAINT_SECONDS = 1 / 30;
const BOARD_BOTTOM_Y = 0.35;
const STRIP_WIDTH = RESEARCH_BOARD.width - 0.24;
const STRIP_HEIGHT = 0.16;
const STRIP_Y = BOARD_BOTTOM_Y + 0.14;
const STRIP_STYLE: StripStyle = {
  accent: RESEARCH_ACCENT,
  background: "#14303b",
  track: "#27495a",
  text: "#dbe7ee",
  muted: "#7d98a8",
};

const glowMaterial = sharedMaterial(
  "research-board-glow",
  () =>
    new THREE.MeshStandardMaterial({
      color: "#0b1119",
      emissive: RESEARCH_ACCENT,
      emissiveIntensity: IDLE_GLOW,
      roughness: 0.34,
      metalness: 0.28,
    }),
);

const screenPlane = sharedGeometry(
  "research-board-plane",
  () => new THREE.PlaneGeometry(RESEARCH_BOARD.width, RESEARCH_BOARD.height),
);
const stripPlane = sharedGeometry(
  "research-board-strip-plane",
  () => new THREE.PlaneGeometry(STRIP_WIDTH, STRIP_HEIGHT),
);

interface ScreenSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

let screenSurface: ScreenSurface | null = null;
function researchScreen(): ScreenSurface {
  if (screenSurface !== null) return screenSurface;
  const { width, height } = researchCanvasSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = "#07121a";
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  screenSurface = { canvas, ctx, texture };
  return screenSurface;
}

let stripSurface: StripSurface | null = null;
function researchStrip(): StripSurface {
  if (stripSurface === null) {
    stripSurface = createStripSurface(STRIP_WIDTH, STRIP_HEIGHT);
  }
  return stripSurface;
}

const screenMaterial = sharedMaterial(
  "research-board-screen",
  () =>
    new THREE.MeshStandardMaterial({
      map: researchScreen().texture,
      emissiveMap: researchScreen().texture,
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.1,
    }),
);
const stripMaterial = sharedMaterial(
  "research-board-strip",
  () =>
    new THREE.MeshStandardMaterial({
      map: researchStrip().texture,
      emissiveMap: researchStrip().texture,
      emissive: "#ffffff",
      emissiveIntensity: 0.8,
      transparent: true,
      roughness: 0.5,
      metalness: 0,
    }),
);

function paintStrip(view: ResearchView): void {
  const label = view.researching
    ? `${getAgentProfile("iris").name.toUpperCase()} RESEARCHING ${view.taskId ?? ""}`
    : view.rows.length > 0
      ? `FINDINGS PUBLISHED ${view.taskId ?? ""}`
      : "RESEARCH BOARD READY - WAITING FOR A QUESTION";
  const idle = view.taskId === null;
  drawStrip(
    researchStrip(),
    {
      label,
      ratio: idle ? null : view.ratio,
      percentText: idle ? "--" : `${view.percent}%`,
    },
    STRIP_STYLE,
  );
}

export function ResearchBoard() {
  const view = useRef<ResearchView | null>(null);
  const signature = useRef<string | null>(null);
  const born = useRef(new Map<string, number>());
  const lastSnapshot = useRef<WorldSnapshot | null | undefined>(undefined);
  const elapsed = useRef(SIGNATURE_INTERVAL_SECONDS);
  const animating = useRef(false);

  useEffect(() => {
    // Remounts (StrictMode) must repaint from scratch.
    signature.current = null;
    lastSnapshot.current = undefined;
  }, []);

  // One stable scale callback and one stable repaint function: nothing is
  // allocated per repaint, and `movingRef` records whether any row is still
  // scaling in after the paint.
  const nowRef = useRef(0);
  const movingRef = useRef(false);
  const [scaleFor] = useState(
    () =>
      (key: string): number => {
        if (reducedMotion.current) return 1;
        const age = nowRef.current - (born.current.get(key) ?? nowRef.current);
        if (age < CARD_SCALE_SECONDS) movingRef.current = true;
        return cardScale(age);
      },
  );
  const paintClock = useRef(0);

  /** Repaints the panel; returns true while a row is still scaling in. */
  const repaint = (now: number): boolean => {
    const current = view.current;
    if (current === null) return false;
    nowRef.current = now;
    movingRef.current = false;
    drawResearch(researchScreen().ctx, current, scaleFor);
    researchScreen().texture.needsUpdate = true;
    paintClock.current = 0;
    return movingRef.current;
  };

  useFrame((_, delta) => {
    glowMaterial.emissiveIntensity = THREE.MathUtils.damp(
      glowMaterial.emissiveIntensity,
      stationWorking(liveWorld.current, "researchBoard", "research")
        ? ACTIVE_GLOW
        : IDLE_GLOW,
      GLOW_LAMBDA,
      delta,
    );

    elapsed.current += delta;
    if (elapsed.current >= SIGNATURE_INTERVAL_SECONDS) {
      elapsed.current = 0;
      const snapshot = liveWorld.current;
      if (snapshot !== lastSnapshot.current) {
        lastSnapshot.current = snapshot;
        const next = researchView(snapshot?.tasks ?? []);
        const nextSignature = researchSignature(next);
        if (nextSignature !== signature.current) {
          signature.current = nextSignature;
          view.current = next;
          const now = performance.now() / 1000;
          const nextBorn = new Map<string, number>();
          for (const row of next.rows) {
            nextBorn.set(row.key, born.current.get(row.key) ?? now);
          }
          born.current = nextBorn;
          paintStrip(next);
          animating.current = repaint(now);
        }
      }
    }

    // Scale-in repaints are capped at ~30 Hz; the last one lands at full size.
    paintClock.current += delta;
    if (animating.current && paintClock.current >= SCALE_REPAINT_SECONDS) {
      animating.current = repaint(performance.now() / 1000);
    }
  });

  return (
    <group
      position={[RESEARCH_BOARD_CENTER.x, 0, RESEARCH_BOARD_CENTER.z]}
      rotation-y={RESEARCH_BOARD_ROTATION}
    >
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 1.55, 0]}
        scale={[0.14, 2.62, RESEARCH_BOARD_FRAME_WIDTH]}
        castShadow
      />
      <mesh
        geometry={screenPlane}
        material={screenMaterial}
        position={[RESEARCH_BOARD_FACE_OFFSET, 1.55, 0]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={stripPlane}
        material={stripMaterial}
        position={[RESEARCH_BOARD_FACE_OFFSET + 0.004, STRIP_Y, 0]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={geometries.box}
        material={glowMaterial}
        position={[RESEARCH_BOARD_FACE_OFFSET + 0.05, 2.9, 0]}
        scale={[0.05, 0.04, RESEARCH_BOARD_FRAME_WIDTH]}
      />
      <mesh
        geometry={geometries.box}
        material={glowMaterial}
        position={[RESEARCH_BOARD_FACE_OFFSET + 0.05, 0.22, 0]}
        scale={[0.05, 0.03, RESEARCH_BOARD_FRAME_WIDTH]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[FOOT_X, 0.1, -1.25]}
        scale={[0.5, 0.2, 0.4]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[FOOT_X, 0.1, 1.25]}
        scale={[0.5, 0.2, 0.4]}
      />
    </group>
  );
}
