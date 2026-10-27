"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AgentId } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import type { CameraRequest, ViewInsets } from "@/state/useWorldStore";
import { reducedMotion } from "@/state/reducedMotion";
import { cn } from "@/components/ui";
import { focusStation } from "./stationFocus";
import { stationTarget } from "./stationOwners";
import {
  clampMapCamera,
  focusMapCamera,
  hitAgentAt,
  hitStationAt,
  mapFitScale,
  mapFreeArea,
  mapPoint,
  mapWorld,
  mapZoneCamera,
  overviewMapCamera,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  type MapCamera,
  type MapViewport,
} from "./mapView";
import {
  drawStaticLayer,
  FALLBACK_MAP_THEME,
  type MapTheme,
} from "./mapDrawing";

const CAMERA_LAMBDA = 7;
/** Same click-vs-drag tolerance as the 3D office (spec pitfall 9). */
const CLICK_TOLERANCE_PX = 5;
const MAX_DPR = 2;
const WHEEL_ZOOM_RATE = 0.0015;

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

interface Pointers {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface Pinch {
  distance: number;
  scale: number;
  worldX: number;
  worldZ: number;
}

/** Resolve the theme tokens once per mount; canvas cannot read CSS variables. */
function readMapTheme(): MapTheme {
  const fallback = FALLBACK_MAP_THEME;
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const read = (name: string, value: string): string => {
    const resolved = root.getPropertyValue(name).trim();
    return resolved.length > 0 ? resolved : value;
  };
  return {
    colors: {
      ink950: read("--color-ink-950", fallback.colors.ink950),
      ink900: read("--color-ink-900", fallback.colors.ink900),
      ink850: read("--color-ink-850", fallback.colors.ink850),
      ink800: read("--color-ink-800", fallback.colors.ink800),
      ink700: read("--color-ink-700", fallback.colors.ink700),
      mist100: read("--color-mist-100", fallback.colors.mist100),
      mist300: read("--color-mist-300", fallback.colors.mist300),
      mist500: read("--color-mist-500", fallback.colors.mist500),
      signal: read("--color-signal", fallback.colors.signal),
      signalStrong: read("--color-signal-strong", fallback.colors.signalStrong),
      ok: read("--color-ok", fallback.colors.ok),
      warn: read("--color-warn", fallback.colors.warn),
      bad: read("--color-bad", fallback.colors.bad),
    },
    fontSans: body.fontFamily || fallback.fontSans,
    fontMono: read("--font-jetbrains-mono", fallback.fontMono),
  };
}

function viewportFor(size: CanvasSize, insets: ViewInsets): MapViewport {
  return { width: size.width, height: size.height, insets };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Two-letter mark for a robot: core names fit one, live names take two. */
function initialsFor(name: string): string {
  const words = name.split(/[\s-_]+/).filter((word) => word.length > 0);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * The 2D world renderer: a plain canvas over the same live world snapshot the
 * 3D layer reads. It stays mounted next to the Canvas in both modes so the
 * toggle is instant; the rAF loop only exists while the map is visible.
 */
export function FloorPlan2D() {
  const visible = useWorldStore((state) => state.viewMode === "2d");
  const request = useWorldStore((state) => state.camera);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const cameraRef = useRef<MapCamera>({ cx: 0, cz: 1, scale: 1 });
  const goalRef = useRef<MapCamera | null>(null);
  const initialisedRef = useRef(false);
  const themeRef = useRef<MapTheme>(FALLBACK_MAP_THEME);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticKeyRef = useRef("");
  const agentPointsRef = useRef(new Map<AgentId, { id: AgentId; x: number; z: number }>());
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<Pointers | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const lastNonceRef = useRef(request.nonce);
  const pendingRequestRef = useRef<CameraRequest | null>(null);

  const viewportNow = (): MapViewport =>
    viewportFor(sizeRef.current, useWorldStore.getState().viewInsets);

  const releaseFollow = (): void => {
    const store = useWorldStore.getState();
    if (store.followAgentId !== null) store.setFollowAgent(null);
  };

  // Size the backing store to the wrapper and keep the fit valid on resize.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    themeRef.current = readMapTheme();

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (
        sizeRef.current.width === width &&
        sizeRef.current.height === height &&
        sizeRef.current.dpr === dpr
      ) {
        return;
      }
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const viewport = viewportFor(sizeRef.current, useWorldStore.getState().viewInsets);
      cameraRef.current = initialisedRef.current
        ? clampMapCamera(cameraRef.current, viewport)
        : overviewMapCamera(viewport);
      initialisedRef.current = true;
      staticKeyRef.current = "";
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    resize();
    return () => observer.disconnect();
  }, []);

  // A camera command is consumed once, on a new nonce, like the 3D controller.
  useEffect(() => {
    if (request.nonce === lastNonceRef.current) return;
    lastNonceRef.current = request.nonce;
    if (request.nonce === 0) return;
    pendingRequestRef.current = request;
  }, [request]);

  // Native wheel listener: React's wheel handlers are passive at the root,
  // and the map must own the page zoom on trackpads.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const size = sizeRef.current;
      if (size.width <= 1) return;
      const rect = canvas.getBoundingClientRect();
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const viewport = viewportFor(size, useWorldStore.getState().viewInsets);
      const camera = cameraRef.current;
      const anchor = mapWorld(camera, viewport, local);
      const free = mapFreeArea(viewport);
      const fit = mapFitScale(viewport);
      const factor = clamp(
        Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
        0.7,
        1.4,
      );
      const scale = clamp(
        camera.scale * factor,
        fit * MAP_MIN_ZOOM,
        fit * MAP_MAX_ZOOM,
      );
      goalRef.current = clampMapCamera(
        {
          cx: anchor.x - (local.x - free.centerX) / scale,
          cz: anchor.z - (local.y - free.centerY) / scale,
          scale,
        },
        viewport,
      );
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // The draw loop only runs while 2D is the active view, so a hidden map is
  // free and the 3D scene keeps every frame it needs.
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let last = performance.now();

    const stepCamera = (delta: number, viewport: MapViewport): void => {
      const camera = cameraRef.current;
      const goal = goalRef.current;
      if (goal !== null) {
        if (reducedMotion.current) {
          cameraRef.current = { ...goal };
          goalRef.current = null;
        } else {
          const t = 1 - Math.exp(-CAMERA_LAMBDA * delta);
          camera.cx += (goal.cx - camera.cx) * t;
          camera.cz += (goal.cz - camera.cz) * t;
          camera.scale += (goal.scale - camera.scale) * t;
          if (
            Math.abs(goal.cx - camera.cx) < 0.002 &&
            Math.abs(goal.cz - camera.cz) < 0.002 &&
            Math.abs(goal.scale - camera.scale) < 0.01
          ) {
            cameraRef.current = { ...goal };
            goalRef.current = null;
          }
        }
      }
      const clamped = clampMapCamera(cameraRef.current, viewport);
      cameraRef.current = clamped;
    };

    const ensureStatic = (theme: MapTheme, viewport: MapViewport): HTMLCanvasElement | null => {
      const size = sizeRef.current;
      if (size.width <= 1 || size.height <= 1) return null;
      const camera = cameraRef.current;
      const insets = viewport.insets;
      const key =
        `${size.width}x${size.height}@${size.dpr}:` +
        `${insets.top},${insets.right},${insets.bottom},${insets.left}:` +
        `${camera.cx.toFixed(3)},${camera.cz.toFixed(3)},${camera.scale.toFixed(2)}`;
      let layer = staticCanvasRef.current;
      if (
        layer === null ||
        layer.width !== Math.round(size.width * size.dpr) ||
        layer.height !== Math.round(size.height * size.dpr)
      ) {
        layer = document.createElement("canvas");
        layer.width = Math.round(size.width * size.dpr);
        layer.height = Math.round(size.height * size.dpr);
        staticCanvasRef.current = layer;
        staticKeyRef.current = "";
      }
      if (key === staticKeyRef.current) return layer;
      const context = layer.getContext("2d");
      if (!context) return layer;
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawStaticLayer(context, camera, viewport, theme);
      staticKeyRef.current = key;
      return layer;
    };

    const drawAgents = (
      context: CanvasRenderingContext2D,
      camera: MapCamera,
      viewport: MapViewport,
      theme: MapTheme,
    ): void => {
      const store = useWorldStore.getState();
      const snapshot = liveWorld.current;
      const points = agentPointsRef.current;
      points.clear();
      if (!snapshot) return;

      for (const agent of snapshot.agents) {
        points.set(agent.id, {
          id: agent.id,
          x: agent.position.x,
          z: agent.position.z,
        });
        const profile = getAgentProfile(agent.id);
        const point = mapPoint(camera, viewport, agent.position.x, agent.position.z);
        const radius = Math.max(6, camera.scale * 0.4);
        const active =
          store.selectedAgentId === agent.id ||
          store.hovered === `agent:${agent.id}` ||
          store.followAgentId === agent.id;

        if (active) {
          context.beginPath();
          context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
          context.strokeStyle = theme.colors.mist100;
          context.lineWidth = 1.5;
          context.stroke();
        }

        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = agent.paused
          ? `${profile.color}66`
          : profile.color;
        context.fill();
        context.strokeStyle = theme.colors.ink950;
        context.lineWidth = 1.5;
        context.stroke();

        const labelSize = clamp(camera.scale * 0.26, 7, 10);
        context.font = `700 ${labelSize}px ${theme.fontMono}`;
        context.fillStyle = theme.colors.ink950;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(initialsFor(profile.name), point.x, point.y + 0.5);
      }
    };

    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw);
      const delta = clamp((now - last) / 1000, 0.001, 0.1);
      last = now;
      const store = useWorldStore.getState();
      if (store.viewMode !== "2d") return;
      const size = sizeRef.current;
      if (size.width <= 1 || size.height <= 1) return;

      const viewport = viewportFor(size, store.viewInsets);
      if (!initialisedRef.current) {
        cameraRef.current = overviewMapCamera(viewport);
        initialisedRef.current = true;
      }

      const pending = pendingRequestRef.current;
      if (pending !== null) {
        pendingRequestRef.current = null;
        if (pending.preset) {
          goalRef.current = mapZoneCamera(pending.preset, viewport);
        } else if (pending.focus) {
          goalRef.current = focusMapCamera(
            pending.focus,
            pending.distance,
            viewport,
          );
        }
      }

      if (store.followAgentId !== null) {
        // Read the snapshot rather than the previous frame's hit points, so
        // entering 2D while following keeps the follow instead of clearing it
        // on the first frame.
        const followed = liveWorld.current?.agents.find(
          (agent) => agent.id === store.followAgentId,
        );
        if (followed) {
          goalRef.current = clampMapCamera(
            {
              cx: followed.position.x,
              cz: followed.position.z,
              scale: cameraRef.current.scale,
            },
            viewport,
          );
        } else {
          store.setFollowAgent(null);
        }
      }

      stepCamera(delta, viewport);

      const theme = themeRef.current;
      const staticLayer = ensureStatic(theme, viewport);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      if (staticLayer !== null) {
        context.drawImage(staticLayer, 0, 0, size.width, size.height);
      }
      drawAgents(context, cameraRef.current, viewport, theme);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const toLocal = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const viewport = viewportNow();
      const world = mapWorld(cameraRef.current, viewport, toLocal(midpoint.x, midpoint.y));
      pinchRef.current = {
        distance: Math.max(1, distance),
        scale: cameraRef.current.scale,
        worldX: world.x,
        worldZ: world.z,
      };
      dragRef.current = null;
      goalRef.current = null;
      releaseFollow();
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    canvas.style.cursor = "grabbing";
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const tracked = pointersRef.current.get(event.pointerId);

    if (tracked === undefined) {
      // Hover only. Same target vocabulary as the 3D hit boxes.
      const store = useWorldStore.getState();
      const viewport = viewportNow();
      const point = toLocal(event.clientX, event.clientY);
      const camera = cameraRef.current;
      const agentId = hitAgentAt(
        point,
        camera,
        viewport,
        [...agentPointsRef.current.values()],
      );
      const stationId =
        agentId === null ? hitStationAt(point, camera, viewport) : null;
      const target =
        agentId !== null
          ? `agent:${agentId}`
          : stationId !== null
            ? stationTarget(stationId)
            : null;
      if (store.hovered !== target) store.setHovered(target);
      canvas.style.cursor = target === null ? "grab" : "pointer";
      return;
    }

    tracked.x = event.clientX;
    tracked.y = event.clientY;

    if (pointersRef.current.size === 2 && pinchRef.current !== null) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const viewport = viewportNow();
      const free = mapFreeArea(viewport);
      const fit = mapFitScale(viewport);
      const scale = clamp(
        (pinchRef.current.scale * distance) / pinchRef.current.distance,
        fit * MAP_MIN_ZOOM,
        fit * MAP_MAX_ZOOM,
      );
      const local = toLocal(midpoint.x, midpoint.y);
      cameraRef.current = clampMapCamera(
        {
          cx: pinchRef.current.worldX - (local.x - free.centerX) / scale,
          cz: pinchRef.current.worldZ - (local.y - free.centerY) / scale,
          scale,
        },
        viewport,
      );
      return;
    }

    const drag = dragRef.current;
    if (drag === null) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (
      !drag.moved &&
      (Math.abs(event.clientX - drag.startX) > CLICK_TOLERANCE_PX ||
        Math.abs(event.clientY - drag.startY) > CLICK_TOLERANCE_PX)
    ) {
      drag.moved = true;
      releaseFollow();
    }
    if (!drag.moved) return;

    goalRef.current = null;
    const viewport = viewportNow();
    cameraRef.current = clampMapCamera(
      {
        cx: cameraRef.current.cx - dx / cameraRef.current.scale,
        cz: cameraRef.current.cz - dy / cameraRef.current.scale,
        scale: cameraRef.current.scale,
      },
      viewport,
    );
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const drag = dragRef.current;
    const wasSingle = pointersRef.current.size === 1;
    pointersRef.current.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    canvas.style.cursor = "grab";

    if (drag === null || drag.moved || !wasSingle) return;

    const store = useWorldStore.getState();
    const viewport = viewportNow();
    const point = toLocal(event.clientX, event.clientY);
    const camera = cameraRef.current;
    const agentId = hitAgentAt(
      point,
      camera,
      viewport,
      [...agentPointsRef.current.values()],
    );
    if (agentId !== null) {
      store.selectAgent(agentId);
      return;
    }
    const station = hitStationAt(point, camera, viewport);
    if (station !== null) {
      store.selectStation(station);
      focusStation(station);
      return;
    }
    // A genuine click on empty floor clears, exactly like the 3D office.
    store.clearSelection();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    event.currentTarget.style.cursor = "grab";
  };

  const handlePointerLeave = (): void => {
    if (pointersRef.current.size > 0) return;
    const store = useWorldStore.getState();
    if (store.hovered !== null) store.setHovered(null);
    if (canvasRef.current) canvasRef.current.style.cursor = "";
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "absolute inset-0 overflow-hidden bg-ink-950",
        !visible && "invisible pointer-events-none",
      )}
      aria-hidden={!visible}
      data-testid="floor-plan-2d"
      data-visible={visible ? "1" : "0"}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full select-none"
        style={{ touchAction: "none" }}
        role="img"
        aria-label="Top-down floor plan of the AI Agent World office"
        data-testid="floor-plan-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
      />
    </div>
  );
}
