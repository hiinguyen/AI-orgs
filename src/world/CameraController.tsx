"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { AgentState } from "@/agents/agentTypes";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import type { CameraPresetId, ViewInsets } from "@/state/useWorldStore";
import { CAMERA_FOV, CAMERA_LIMITS, CAMERA_PRESETS } from "./cameraPresets";

const TARGET_LAMBDA = 4;
const POSITION_LAMBDA = 2;
const FOLLOW_LAMBDA = 4;

const scratchTarget = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();

interface MoveGoal {
  active: boolean;
  target: THREE.Vector3;
  position: THREE.Vector3;
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
  size: { width: number; height: number },
  insets: ViewInsets,
): number {
  const freeWidth = Math.max(1, size.width - insets.left - insets.right);
  const freeHeight = Math.max(1, size.height - insets.top - insets.bottom);
  const byWidth = (1.17 * size.height) / freeWidth;
  const byHeight = (0.96 * size.height) / freeHeight;
  return THREE.MathUtils.clamp(Math.max(byWidth, byHeight), 1, 2.2);
}

function viewportSize(): { width: number; height: number } {
  return {
    width: window.innerWidth || 1,
    height: window.innerHeight || 1,
  };
}

function presetGoal(
  presetId: CameraPresetId,
  insets: ViewInsets,
  target: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const preset = CAMERA_PRESETS[presetId];
  const size = viewportSize();
  target.fromArray(preset.target);
  scratchOffset.fromArray(preset.position).sub(target);
  const baseDistance = scratchOffset.length();
  const distance = THREE.MathUtils.clamp(
    baseDistance * insetFitFactor(size, insets),
    CAMERA_LIMITS.minDistance,
    CAMERA_LIMITS.maxDistance,
  );

  // Center the framing in the free area, not the whole viewport: the side
  // panel covers the right edge and the mobile bottom sheet the lower half.
  const freeCenterX = (insets.left + (size.width - insets.right)) / 2;
  const freeCenterY = (insets.top + (size.height - insets.bottom)) / 2;
  const worldPerPixel =
    (2 * distance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))) /
    size.height;
  const shiftScale = worldPerPixel * 0.85;
  target.x += (size.width / 2 - freeCenterX) * shiftScale;
  target.z += (size.height / 2 - freeCenterY) * shiftScale;

  scratchOffset.normalize().multiplyScalar(distance);
  position.copy(target).add(scratchOffset);
  clampTarget(target);
}

export function CameraController() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const request = useWorldStore((state) => state.camera);

  const goal = useRef<MoveGoal>({
    active: false,
    target: new THREE.Vector3(),
    position: new THREE.Vector3(),
  });
  const hasUserInteracted = useRef(false);
  const hasRequestedFraming = useRef(false);

  // Mount: place the orbit target on the overview target, then fit the same
  // preset once the shell has measured its UI insets. The refit also runs on
  // resize until the user first touches the camera, so a phone keeps the
  // office inside the free area after rotating.
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      controls.target.fromArray(CAMERA_PRESETS.overview.target);
      controls.update();
    }
    const frame = requestAnimationFrame(() => {
      if (hasRequestedFraming.current) return;
      const current = controlsRef.current;
      if (!current) return;
      const store = useWorldStore.getState();
      presetGoal(
        "overview",
        store.viewInsets,
        goal.current.target,
        goal.current.position,
      );
      goal.current.active = true;
    });
    const onResize = () => {
      if (hasUserInteracted.current || hasRequestedFraming.current) return;
      const store = useWorldStore.getState();
      presetGoal(
        "overview",
        store.viewInsets,
        goal.current.target,
        goal.current.position,
      );
      goal.current.active = true;
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

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
    controls.update();
  });

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
