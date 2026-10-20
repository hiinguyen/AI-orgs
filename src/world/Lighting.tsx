"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useWorldStore } from "@/state/useWorldStore";
import { STATIONS } from "@/simulation/worldLayout";

/**
 * Blue-hour exterior plus warm interior. One shadow-casting directional light
 * covers the floor with a tight orthographic frustum; every other light is a
 * cheap fill with no shadow map. The PBR environment is baked from
 * Lightformers, so no HDR file is downloaded.
 */
export function Lighting() {
  const quality = useWorldStore((state) => state.quality);
  const high = quality === "high";

  return (
    <>
      <hemisphereLight
        args={["#7d95b5", "#070a0f", 0.9]}
        position={[0, 12, 0]}
      />

      <directionalLight
        castShadow={high}
        color="#b9cdf0"
        intensity={1.75}
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

      {STATIONS.map((station) => (
        <pointLight
          key={station.id}
          color="#ffd2a0"
          intensity={6}
          distance={4}
          decay={2}
          position={[station.position.x, 2.3, station.position.z + 0.25]}
        />
      ))}

      <pointLight
        color="#ffbf86"
        intensity={8}
        distance={5.5}
        decay={2}
        position={[-5, 2.2, 5.6]}
      />

      {high && (
        <Environment
          resolution={128}
          frames={1}
          environmentIntensity={0.55}
        >
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
        </Environment>
      )}
    </>
  );
}
