"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { AgentState } from "@/agents/agentTypes";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import type { CameraPresetId, ViewInsets } from "@/state/useWorldStore";
import { CAMERA_LIMITS, CAMERA_PRESETS } from "./cameraPresets";

const TARGET_LAMBDA = 4;
const POSITION_LAMBDA = 2;
const FOLLOW_LAMBDA = 4;

/**
 * Height reserved at the bottom of the free area for the floating camera bar.
 * The bar lives inside the measured insets, so framing has to keep the office
 * above it or the camera pills sit on top of the front of the floor.
 */
const CAMERA_BAR_CLEARANCE = 48;

const scratchTarget = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();

interface ViewportSize {
  width: number;
  height: number;
}

interface FreeArea {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface MoveGoal {
  active: boolean;
  target: THREE.Vector3;
  position: THREE.Vector3;
}

function freeArea(size: ViewportSize, insets: ViewInsets): FreeArea {
  const left = insets.left;
  const right = size.width - insets.right;
  const top = insets.top;
  const bottom = size.height - insets.bottom - CAMERA_BAR_CLEARANCE;
  return {
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function clampTarget(target: THREE.Vector3): void {
  target.x = THREE.MathUtils.clamp(
    target.x,
    CAMERA_LIMITS.targetMinX,
    CAMERA_LIMITS.targetMaxX,
  );
  target.y = THREE.MathUtils.clamp(
    target.y,
    CAMERA_LIMITS.targetMinY,
    CAMERA_LIMITS.targetMaxY,
  );
  target.z = THREE.MathUtils.clamp(
    target.z,
    CAMERA_LIMITS.targetMinZ,
    CAMERA_LIMITS.targetMaxZ,
  );
}

/**
 * Fit the preset so the visible part of the office stays in the free area
 * left by the floating UI. Wide screens with a side panel need a small
 * zoom-out; phones with a bottom sheet need the full clamp.
 */
export function insetFitFactor(
  size: ViewportSize,
  insets: ViewInsets,
): number {
  const free = freeArea(size, insets);
  const byWidth = (1.17 * size.height) / free.width;
  const byHeight = (0.96 * size.height) / free.height;
  return THREE.MathUtils.clamp(Math.max(byWidth, byHeight), 1, 2.2);
}

/**
 * Shift the camera's projection so the orbit target lands in the middle of
 * the free area instead of the middle of the canvas. The side panel and the
 * mobile sheet cover part of the viewport, and the office has to be framed
 * in what is left; moving the camera and target instead would push the orbit
 * target outside the configured limits.
 */
export function applyViewOffset(
  camera: THREE.Camera,
  size: ViewportSize,
  insets: ViewInsets,
): void {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  const free = freeArea(size, insets);
  const offsetX = size.width / 2 - free.centerX;
  const offsetY = size.height / 2 - free.centerY;
  if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) {
    camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(
    size.width,
    size.height,
    offsetX,
    offsetY,
    size.width,
    size.height,
  );
}

function presetGoal(
  presetId: CameraPresetId,
  insets: ViewInsets,
  size: ViewportSize,
  target: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const preset = CAMERA_PRESETS[presetId];
  target.fromArray(preset.target);
  scratchOffset.fromArray(preset.position).sub(target);
  const baseDistance = scratchOffset.length();
  const distance = THREE.MathUtils.clamp(
    baseDistance * insetFitFactor(size, insets),
    CAMERA_LIMITS.minDistance,
    CAMERA_LIMITS.maxDistance,
  );
  scratchOffset.normalize().multiplyScalar(distance);
  position.copy(target).add(scratchOffset);
  clampTarget(target);
}

export function CameraController() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const request = useWorldStore((state) => state.camera);
  const insets = useWorldStore((state) => state.viewInsets);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const goal = useRef<MoveGoal>({
    active: false,
    target: new THREE.Vector3(),
    position: new THREE.Vector3(),
  });
  const hasUserInteracted = useRef(false);
  const hasRequestedFraming = useRef(false);
  const sizeRef = useRef<ViewportSize>(size);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Keep the projection centered on the free area whenever the measured UI
  // insets or the canvas size change.
  useEffect(() => {
    applyViewOffset(camera, size, insets);
  }, [camera, size, insets]);

  // Mount: place the orbit target on the overview target, then fit the same
  // preset once the shell has measured its UI insets.
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      controls.target.fromArray(CAMERA_PRESETS.overview.target);
    }
    const frame = requestAnimationFrame(() => {
      if (hasRequestedFraming.current) return;
      const store = useWorldStore.getState();
      presetGoal(
        "overview",
        store.viewInsets,
        sizeRef.current,
        goal.current.target,
        goal.current.position,
      );
      goal.current.active = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Refit while the user has neither orbited nor picked a camera: the mobile
  // bottom sheet changes height with the tab content and the desktop panel
  // can change width, so viewInsets moves after mount.
  useEffect(() => {
    const refit = () => {
      if (hasUserInteracted.current || hasRequestedFraming.current) return;
      const store = useWorldStore.getState();
      presetGoal(
        "overview",
        store.viewInsets,
        sizeRef.current,
        goal.current.target,
        goal.current.position,
      );
      goal.current.active = true;
    };

    const unsubscribe = useWorldStore.subscribe((state, previous) => {
      if (state.viewInsets !== previous.viewInsets) refit();
    });
    refit();
    return unsubscribe;
  }, [size]);

  // A new store request starts a damped move towards the requested framing.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    hasRequestedFraming.current = false;

    if (request.preset) {
      hasRequestedFraming.current = true;
      presetGoal(
        request.preset,
        useWorldStore.getState().viewInsets,
        sizeRef.current,
        goal.current.target,
        goal.current.position,
      );
      goal.current.active = true;
      return;
    }

    if (request.focus) {
      hasRequestedFraming.current = true;
      goal.current.target.set(
        request.focus.x,
        request.focus.y,
        request.focus.z,
      );
      clampTarget(goal.current.target);
      scratchOffset.copy(controls.object.position).sub(controls.target);
      const currentDistance = scratchOffset.length();
      const distance = THREE.MathUtils.clamp(
        request.distance ?? currentDistance,
        CAMERA_LIMITS.minDistance,
        CAMERA_LIMITS.maxDistance,
      );
      if (currentDistance < 0.001) {
        scratchOffset.set(0, 0.7, 1);
      }
      scratchOffset.normalize().multiplyScalar(distance);
      goal.current.position.copy(goal.current.target).add(scratchOffset);
      goal.current.active = true;
    }
  }, [request]);

  // Priority -2 runs before drei's OrbitControls update (-1), so the controls
  // apply this frame's goal in their single damping step. Do not call
  // controls.update() here: it would advance the damping twice per frame.
  useFrame((state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = state.camera;

    const store = useWorldStore.getState();
    const followId = store.followAgentId;

    if (followId !== null) {
      const agents = liveWorld.current?.agents;
      let agent: AgentState | undefined;
      if (agents) {
        for (let index = 0; index < agents.length; index += 1) {
          if (agents[index].id === followId) {
            agent = agents[index];
            break;
          }
        }
      }
      if (agent) {
        scratchTarget.set(agent.position.x, 1, agent.position.z);
        const shiftX =
          THREE.MathUtils.damp(
            controls.target.x,
            scratchTarget.x,
            FOLLOW_LAMBDA,
            delta,
          ) - controls.target.x;
        const shiftY =
          THREE.MathUtils.damp(
            controls.target.y,
            scratchTarget.y,
            FOLLOW_LAMBDA,
            delta,
          ) - controls.target.y;
        const shiftZ =
          THREE.MathUtils.damp(
            controls.target.z,
            scratchTarget.z,
            FOLLOW_LAMBDA,
            delta,
          ) - controls.target.z;
        controls.target.x += shiftX;
        controls.target.y += shiftY;
        controls.target.z += shiftZ;
        camera.position.x += shiftX;
        camera.position.y += shiftY;
        camera.position.z += shiftZ;
        goal.current.active = false;
      }
    } else if (goal.current.active) {
      const target = goal.current.target;
      controls.target.x = THREE.MathUtils.damp(
        controls.target.x,
        target.x,
        TARGET_LAMBDA,
        delta,
      );
      controls.target.y = THREE.MathUtils.damp(
        controls.target.y,
        target.y,
        TARGET_LAMBDA,
        delta,
      );
      controls.target.z = THREE.MathUtils.damp(
        controls.target.z,
        target.z,
        TARGET_LAMBDA,
        delta,
      );

      const position = goal.current.position;
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        position.x,
        POSITION_LAMBDA,
        delta,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        position.y,
        POSITION_LAMBDA,
        delta,
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        position.z,
        POSITION_LAMBDA,
        delta,
      );

      const settled =
        controls.target.distanceToSquared(target) < 0.0004 &&
        camera.position.distanceToSquared(position) < 0.0025;
      if (settled) goal.current.active = false;
    }

    clampTarget(controls.target);
  }, -2);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={CAMERA_LIMITS.minDistance}
      maxDistance={CAMERA_LIMITS.maxDistance}
      minPolarAngle={CAMERA_LIMITS.minPolarAngle}
      maxPolarAngle={CAMERA_LIMITS.maxPolarAngle}
      onStart={() => {
        hasUserInteracted.current = true;
        goal.current.active = false;
        const store = useWorldStore.getState();
        if (store.followAgentId !== null) store.setFollowAgent(null);
      }}
    />
  );
}
