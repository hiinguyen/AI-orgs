"use client";

import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import type { DirectionalLight } from "three";
import { useWorldStore } from "@/state/useWorldStore";

/**
 * Static children for the baked environment. Their identity must stay stable:
 * drei's portal re-bakes whenever the `children` prop changes, and a rebake in
 * low quality would put the cube texture back on the scene after the gate
 * removed it.
 */
const ENVIRONMENT_CHILDREN = (
  <>
    <Lightformer
      form="rect"
      color="#bcd3ef"
      intensity={1.4}
      position={[0, 9, 2]}
      rotation-x={Math.PI / 2}
      scale={[22, 10, 1]}
    />
    <Lightformer
      form="rect"
      color="#6f8fbf"
      intensity={0.9}
      position={[-4, 4, -13]}
      scale={[18, 8, 1]}
    />
    <Lightformer
      form="rect"
      color="#ffd6a8"
      intensity={0.45}
      position={[0, 2, 15]}
      rotation-y={Math.PI}
      scale={[16, 6, 1]}
    />
    <Lightformer
      form="rect"
      color="#7cc4d6"
      intensity={0.4}
      position={[15, 4, 4]}
      rotation-y={-Math.PI / 2}
      scale={[14, 6, 1]}
    />
    <Lightformer
      form="rect"
      color="#9ad7e6"
      intensity={0.25}
      position={[-15, 4, 4]}
      rotation-y={Math.PI / 2}
      scale={[14, 6, 1]}
    />
  </>
);

/**
 * Detach the pooled environment cube from the scene while quality is low.
 * The texture stays owned by the mounted `Environment`, so switching back to
 * high restores it without a rebake.
 */
function EnvironmentGate({ enabled }: { enabled: boolean }) {
  const scene = useThree((state) => state.scene);
  // The lint rule protects hook results; three.js scene objects are mutable
  // engine state, so hold the reference in a ref and switch its environment.
  const sceneRef = useRef(scene);

  useLayoutEffect(() => {
    const target = sceneRef.current;
    if (enabled) return;
    const previous = target.environment;
    target.environment = null;
    return () => {
      target.environment = previous;
    };
  }, [enabled]);

  return null;
}

/**
 * Blue-hour exterior plus warm interior. One shadow-casting directional light
 * covers the floor with a tight orthographic frustum; every other light is a
 * cheap fill with no shadow map. High quality keeps two broad zone lights over
 * the desk banks; low quality drops them and lets the emissive desk pools
 * carry the warmth. The PBR environment is baked from Lightformers, so no HDR
 * file is downloaded.
 *
 * The environment is built on the first high-quality frame and kept mounted
 * afterwards: a session that starts low never pays for the cube render target,
 * and a later drop to low detaches the pooled texture instead of disposing it.
 */
export function Lighting() {
  const high = useWorldStore((state) => state.quality === "high");
  // The store latches this on the first high-quality choice, so the element
  // stays mounted for the rest of the session even after a drop to low. The
  // default is false: a session that starts low never builds the cube target.
  const environmentMounted = useWorldStore((state) => state.qualityEverHigh);
  const shadowLight = useRef<DirectionalLight>(null);

  useLayoutEffect(() => {
    const light = shadowLight.current;
    if (!light || high) return;
    // Turning castShadow off leaves `light.shadow.map` (a 2048 square render
    // target) allocated in three. Dispose it so low quality really costs
    // nothing; three recreates it when high quality returns.
    const map = light.shadow.map;
    if (map) {
      map.dispose();
      light.shadow.map = null;
    }
  }, [high]);

  return (
    <>
      <hemisphereLight
        args={["#8fa8c8", "#0a1018", 1.55]}
        position={[0, 12, 0]}
      />

      <directionalLight
        ref={shadowLight}
        castShadow={high}
        color="#b9cdf0"
        intensity={1.9}
        position={[-6, 16, -7]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={1}
        shadow-camera-far={46}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={2}
      />

      <pointLight
        color="#ffc07a"
        intensity={11}
        distance={5.5}
        decay={2}
        position={[0, 2.1, -0.6]}
      />

      {high && (
        <>
          <pointLight
            color="#ffd2a0"
            intensity={22}
            distance={9}
            decay={2}
            position={[-8.25, 2.6, -3.6]}
          />
          <pointLight
            color="#ffd2a0"
            intensity={22}
            distance={9}
            decay={2}
            position={[8.25, 2.6, -3.6]}
          />
        </>
      )}

      <pointLight
        color="#ffbf86"
        intensity={8}
        distance={5.5}
        decay={2}
        position={[-5, 2.2, 5.6]}
      />

      {environmentMounted && (
        <>
          <Environment resolution={128} frames={1} environmentIntensity={0.9}>
            {ENVIRONMENT_CHILDREN}
          </Environment>
          <EnvironmentGate enabled={high} />
        </>
      )}
    </>
  );
}
