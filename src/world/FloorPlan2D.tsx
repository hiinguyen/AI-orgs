"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AgentId, AgentStatus } from "@/agents/agentTypes";
import type { WorldSnapshot } from "@/integrations/AgentBackend";
import { hashString } from "@/simulation/EventBus";
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
  mapWorld,
  mapZoneCamera,
  overviewMapCamera,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  type MapCamera,
  type MapViewport,
} from "./mapView";
import {
  drawAgentDetailLabel,
  drawAgentMarker,
  drawAgentNameTag,
  drawAgentTrail,
  drawCommLinks,
  drawHubPulse,
  drawStaticLayer,
  drawWorkingDesks,
  FALLBACK_MAP_THEME,
  type MapAgentPose,
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

/** Shortest-path angular damping, so a turn never spins the long way round. */
function dampAngle(current: number, target: number, t: number): number {
  let difference = target - current;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return current + difference * t;
}

interface PulseState {
  startedAt: number;
  outcome: "success" | "error";
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
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const cameraRef = useRef<MapCamera>({ cx: 0, cz: 1, scale: 1 });
  const goalRef = useRef<MapCamera | null>(null);
  const initialisedRef = useRef(false);
  const themeRef = useRef<MapTheme>(FALLBACK_MAP_THEME);
  const staticKeyRef = useRef("");
  const agentPointsRef = useRef(new Map<AgentId, { id: AgentId; x: number; z: number }>());
  const posesRef = useRef(new Map<AgentId, MapAgentPose>());
  const trailPhaseRef = useRef(new Map<AgentId, number>());
  const pulseRef = useRef(new Map<AgentId, PulseState>());
  const lastStatusRef = useRef(new Map<AgentId, AgentStatus>());
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
    const staticCanvas = staticCanvasRef.current;
    if (!wrapper || !canvas || !staticCanvas) return;

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
      for (const layer of [canvas, staticCanvas]) {
        layer.width = Math.round(width * dpr);
        layer.height = Math.round(height * dpr);
        layer.style.width = `${width}px`;
        layer.style.height = `${height}px`;
      }

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
      const layer = staticCanvasRef.current;
      if (layer === null) return null;
      if (key === staticKeyRef.current) return layer;
      const context = layer.getContext("2d");
      if (!context) return layer;
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawStaticLayer(context, camera, viewport, theme);
      staticKeyRef.current = key;
      return layer;
    };

    /**
     * Damp the drawn pose towards the snapshot (lambda 12, same as the 3D
     * animator), snap teleports and reduced-motion users, start outcome
     * pulses and advance the trail phase only while the simulation runs.
     */
    const syncAgents = (
      snapshot: WorldSnapshot,
      delta: number,
      calm: boolean,
      nowMs: number,
    ): void => {
      const poses = posesRef.current;
      const points = agentPointsRef.current;
      const present = new Set<AgentId>();

      for (const agent of snapshot.agents) {
        present.add(agent.id);
        let pose = poses.get(agent.id);
        const teleported =
          pose !== undefined &&
          Math.hypot(agent.position.x - pose.x, agent.position.z - pose.z) > 4;
        if (pose === undefined) {
          pose = {
            x: agent.position.x,
            z: agent.position.z,
            heading: agent.heading,
          };
          poses.set(agent.id, pose);
        } else if (calm || teleported) {
          pose.x = agent.position.x;
          pose.z = agent.position.z;
          pose.heading = agent.heading;
        } else {
          const positionStep = 1 - Math.exp(-12 * delta);
          pose.x += (agent.position.x - pose.x) * positionStep;
          pose.z += (agent.position.z - pose.z) * positionStep;
          pose.heading = dampAngle(
            pose.heading,
            agent.heading,
            1 - Math.exp(-9 * delta),
          );
        }
        points.set(agent.id, { id: agent.id, x: pose.x, z: pose.z });

        const previousStatus = lastStatusRef.current.get(agent.id);
        if (
          previousStatus !== agent.status &&
          (agent.status === "success" || agent.status === "error")
        ) {
          pulseRef.current.set(agent.id, {
            startedAt: nowMs,
            outcome: agent.status,
          });
        }
        lastStatusRef.current.set(agent.id, agent.status);

        let phase = trailPhaseRef.current.get(agent.id);
        if (phase === undefined) {
          // A deterministic offset per id keeps same-role live agents from
          // marching in lockstep.
          phase = (hashString(agent.id) * 0.137) % 0.32;
        }
        if (snapshot.status === "running" && !calm && agent.path.length > 0) {
          phase = (phase + delta * (snapshot.speed || 1) * 0.55) % 0.32;
        }
        trailPhaseRef.current.set(agent.id, phase);
      }

      // A despawned live agent must not leave a pose or a pulse behind.
      for (const id of poses.keys()) {
        if (!present.has(id)) poses.delete(id);
      }
      for (const id of points.keys()) {
        if (!present.has(id)) points.delete(id);
      }
      for (const id of lastStatusRef.current.keys()) {
        if (!present.has(id)) lastStatusRef.current.delete(id);
      }
      for (const id of pulseRef.current.keys()) {
        if (!present.has(id)) pulseRef.current.delete(id);
      }
      for (const id of trailPhaseRef.current.keys()) {
        if (!present.has(id)) trailPhaseRef.current.delete(id);
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
          // Prefer the damped drawn pose (last frame's) so the camera tracks
          // what the user sees, exactly as the 3D follow branch does.
          const pose = posesRef.current.get(followed.id);
          goalRef.current = clampMapCamera(
            {
              cx: pose?.x ?? followed.position.x,
              cz: pose?.z ?? followed.position.z,
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
      // The static plan lives on its own visible canvas behind this one, so
      // pan/zoom only repaints it when the camera actually changes and the
      // per-frame loop just clears the transparent live layer.
      ensureStatic(theme, viewport);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);

      const snapshot = liveWorld.current;
      if (snapshot !== null) {
        const camera = cameraRef.current;
        const poses = posesRef.current;
        const calm = reducedMotion.current;

        syncAgents(snapshot, delta, calm, now);

        drawWorkingDesks(context, camera, viewport, snapshot.agents);

        if (store.overlays.walkingPaths) {
          for (const agent of snapshot.agents) {
            const pose = poses.get(agent.id);
            if (pose === undefined) continue;
            drawAgentTrail(
              context,
              camera,
              viewport,
              theme,
              agent,
              pose,
              trailPhaseRef.current.get(agent.id) ?? 0,
              calm,
            );
          }
        }

        if (store.overlays.speechIndicators) {
          drawCommLinks(
            context,
            camera,
            viewport,
            snapshot.links,
            poses,
            snapshot.clock,
            calm,
          );
        }

        const orion = snapshot.agents.find((agent) => agent.id === "orion");
        drawHubPulse(
          context,
          camera,
          viewport,
          theme,
          snapshot.clock,
          snapshot.status === "running" &&
            orion !== undefined &&
            !orion.paused &&
            orion.status !== "idle",
          calm,
        );

        for (const agent of snapshot.agents) {
          const pose = poses.get(agent.id);
          if (pose === undefined) continue;
          const pulse = pulseRef.current.get(agent.id);
          drawAgentMarker(
            context,
            camera,
            viewport,
            theme,
            agent,
            pose,
            {
              selected: store.selectedAgentId === agent.id,
              hovered: store.hovered === `agent:${agent.id}`,
              followed: store.followAgentId === agent.id,
              pulseAge:
                pulse === undefined ? null : Math.max(0, (now - pulse.startedAt) / 1000),
              pulseOutcome: pulse?.outcome ?? null,
              reducedMotion: calm,
            },
          );
        }

        // Labels paint last so a pill is never covered by another robot.
        for (const agent of snapshot.agents) {
          const pose = poses.get(agent.id);
          if (pose === undefined) continue;
          const detail =
            store.selectedAgentId === agent.id ||
            store.hovered === `agent:${agent.id}` ||
            store.followAgentId === agent.id;
          if (detail) {
            drawAgentDetailLabel(
              context,
              camera,
              viewport,
              theme,
              agent,
              pose,
            );
          } else if (
            store.overlays.speechIndicators &&
            agent.status === "communicating"
          ) {
            drawAgentNameTag(context, camera, viewport, theme, agent, pose);
          }
        }
      }
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
        ref={staticCanvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
        data-testid="floor-plan-static"
      />
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
