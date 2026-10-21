"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useWorldStore } from "@/state/useWorldStore";
import { FLOOR } from "@/simulation/worldLayout";
import {
  geometries,
  materials,
  sharedGeometry,
  sharedMaterial,
} from "./sharedResources";
import { skyTexture } from "./proceduralTextures";

const MAX_DUST = 260;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function boxPart(
  size: [number, number, number],
  position: [number, number, number],
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error("Failed to merge office geometry");
  return merged;
}

function Floor() {
  return (
    <group>
      <mesh
        geometry={sharedGeometry(
          "floor-plane",
          () => new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth),
        )}
        material={materials.floor}
        rotation-x={-Math.PI / 2}
        position={[0, 0, 1]}
        receiveShadow
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, -0.15, 1]}
        scale={[FLOOR.width + 0.6, 0.28, FLOOR.depth + 0.6]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.metal}
        position={[0, 0.22, 11.62]}
        scale={[FLOOR.width, 0.44, 0.24]}
      />
    </group>
  );
}

function buildBackWallFrame(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    boxPart([30, 0.58, 0.34], [0, 0.29, -9.48]),
    boxPart([30, 0.52, 0.34], [0, 4.62, -9.48]),
  ];
  for (let x = -13.5; x <= 13.5001; x += 3) {
    parts.push(boxPart([0.13, 4.1, 0.24], [x, 2.55, -9.46]));
  }
  return mergeParts(parts);
}

function BackWall() {
  const frame = sharedGeometry("back-wall-frame", buildBackWallFrame);

  return (
    <group>
      <mesh
        geometry={frame}
        material={materials.metal}
        receiveShadow
      />
      <mesh
        geometry={sharedGeometry(
          "back-window-glass",
          () => new THREE.PlaneGeometry(29.7, 4.0),
        )}
        material={materials.windowGlass}
        position={[0, 2.55, -9.44]}
      />
    </group>
  );
}

function buildSideWall(x: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [boxPart([0.3, 4.9, 21.2], [x, 2.45, 1])];
  const inner = x < 0 ? x + 0.19 : x - 0.19;
  for (let z = -9; z <= 11.01; z += 2.6) {
    parts.push(boxPart([0.14, 4.4, 0.16], [inner, 2.3, z]));
  }
  return mergeParts(parts);
}

function SideWalls() {
  const left = sharedGeometry("left-wall", () => buildSideWall(-15.15));
  const right = sharedGeometry("right-wall", () => buildSideWall(15.15));

  return (
    <>
      <mesh geometry={left} material={materials.wall} receiveShadow />
      <mesh geometry={right} material={materials.wall} receiveShadow />
    </>
  );
}

function buildPartitionFrames(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-3.8, 3.8]) {
    parts.push(boxPart([0.09, 0.06, 11.6], [x, 0.05, -3.6]));
    parts.push(boxPart([0.09, 0.08, 11.6], [x, 1.56, -3.6]));
    for (let z = -9.4; z <= 2.2001; z += 2.9) {
      parts.push(boxPart([0.11, 1.62, 0.11], [x, 0.81, z]));
    }
  }
  return mergeParts(parts);
}

function Partitions() {
  const frame = sharedGeometry("partition-frames", buildPartitionFrames);

  return (
    <group>
      <mesh geometry={frame} material={materials.metal} castShadow />
      <mesh
        geometry={sharedGeometry(
          "partition-glass",
          () => new THREE.PlaneGeometry(11.5, 1.44),
        )}
        material={materials.glass}
        position={[-3.8, 0.81, -3.6]}
        rotation-y={Math.PI / 2}
      />
      <mesh
        geometry={sharedGeometry(
          "partition-glass",
          () => new THREE.PlaneGeometry(11.5, 1.44),
        )}
        material={materials.glass}
        position={[3.8, 0.81, -3.6]}
        rotation-y={Math.PI / 2}
      />
    </group>
  );
}

const PLANT_SPOTS: readonly {
  position: readonly [number, number, number];
  scale: number;
}[] = [
  { position: [-13.9, 0, -8.15], scale: 1.1 },
  { position: [13.9, 0, -8.15], scale: 1.05 },
  { position: [-13.9, 0, 1.25], scale: 0.95 },
  { position: [13.9, 0, 2.7], scale: 1.1 },
  { position: [-2.3, 0, 10.4], scale: 1.0 },
  { position: [12.5, 0, 10.5], scale: 1.15 },
];

function Plants() {
  const pots = useRef<THREE.InstancedMesh>(null);
  const foliage = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    PLANT_SPOTS.forEach((spot, index) => {
      const [x, , z] = spot.position;
      dummy.position.set(x, 0.25, z);
      dummy.rotation.set(0, index * 1.7, 0);
      dummy.scale.setScalar(spot.scale);
      dummy.updateMatrix();
      pots.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(x, 0.5, z);
      dummy.rotation.set(0, index * 2.1, 0);
      dummy.scale.setScalar(spot.scale);
      dummy.updateMatrix();
      foliage.current?.setMatrixAt(index, dummy.matrix);
    });
    if (pots.current) pots.current.instanceMatrix.needsUpdate = true;
    if (foliage.current) foliage.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <instancedMesh
        ref={pots}
        args={[geometries.plantPot, materials.pot, PLANT_SPOTS.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={foliage}
        args={[geometries.plantFoliage, materials.plant, PLANT_SPOTS.length]}
        castShadow
      />
    </group>
  );
}

function Skyline({ count }: { count: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const random = makeRandom(0x20261018);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    // Every row stays in front of the sky plane at z = -78: 26 x 10 rows in
    // high (260 towers) and 24 x 5 rows in low (120 towers) end near z = -69
    // and z = -51. Narrower towers and tighter spacing give the back window a
    // layered city instead of a few oversized facades.
    const columns = count > 150 ? 26 : 24;
    const spacingX = count > 150 ? 10.2 : 11.2;
    const spacingZ = count > 150 ? 5.4 : 7.4;
    for (let index = 0; index < count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const width = 4 + random() * 4;
      const depth = 4 + random() * 3;
      const height = 14 + random() * 22;
      const x =
        (column - (columns - 1) / 2) * spacingX + (random() - 0.5) * 1.6;
      const z = -20 - row * spacingZ + (random() - 0.5) * 1.4;
      dummy.position.set(x, height / 2 - 0.4, z);
      dummy.rotation.set(0, (random() - 0.5) * 0.14, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      target.setMatrixAt(index, dummy.matrix);
      const warm = random() > 0.58;
      const bright = 0.8 + random() * 0.2;
      color.setRGB(
        bright * (warm ? 1.0 : 0.82),
        bright * (warm ? 0.92 : 0.89),
        bright * (warm ? 0.8 : 1.0),
      );
      target.setColorAt(index, color);
    }
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    target.computeBoundingSphere();
  }, [count]);

  return (
    <instancedMesh
      ref={mesh}
      key={count}
      args={[geometries.box, materials.skyline, count]}
    />
  );
}

function Sky() {
  const material = sharedMaterial(
    "sky",
    () =>
      new THREE.MeshBasicMaterial({
        map: skyTexture(),
        fog: false,
        toneMapped: false,
      }),
  );

  const ground = sharedMaterial(
    "outside-ground",
    () =>
      new THREE.MeshBasicMaterial({
        color: "#03060a",
        fog: true,
      }),
  );

  return (
    <group>
      <mesh
        geometry={sharedGeometry(
          "sky-plane",
          () => new THREE.PlaneGeometry(220, 90),
        )}
        material={material}
        position={[0, 28, -78]}
      />
      <mesh
        geometry={sharedGeometry(
          "outside-ground",
          () => new THREE.PlaneGeometry(200, 100),
        )}
        material={ground}
        rotation-x={-Math.PI / 2}
        position={[0, -0.3, -40]}
      />
    </group>
  );
}

function Dust({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_DUST * 3);
    const random = makeRandom(0x3c19aa);
    for (let index = 0; index < MAX_DUST; index += 1) {
      positions[index * 3] = -14 + random() * 28;
      positions[index * 3 + 1] = 0.25 + random() * 3.1;
      positions[index * 3 + 2] = -8.6 + random() * 19.4;
    }
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setDrawRange(0, count);
    return buffer;
    // The buffer always holds MAX_DUST points; the draw range follows quality
    // in the effect below, so this is built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = useMemo(() => {
    const source = geometry.getAttribute("position").array;
    return new Float32Array(source);
  }, [geometry]);

  const phases = useMemo(() => {
    const random = makeRandom(0x77ab31);
    const values = new Float32Array(MAX_DUST);
    for (let index = 0; index < MAX_DUST; index += 1) {
      values[index] = random() * Math.PI * 2;
    }
    return values;
  }, []);

  const material = sharedMaterial(
    "dust",
    () =>
      new THREE.PointsMaterial({
        color: "#b9d6ea",
        size: 0.04,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );

  useEffect(() => {
    geometry.setDrawRange(0, count);
  }, [count, geometry]);

  // The dust buffer is built here, not in a shared pool, so this component owns
  // its lifetime. StrictMode remounts create a fresh geometry.
  useEffect(() => () => geometry.dispose(), [geometry]);

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const time = elapsed.current;
    for (let index = 0; index < count; index += 1) {
      const phase = phases[index];
      const offset = index * 3;
      array[offset] =
        base[offset] + Math.sin(time * 0.12 + phase) * 0.22;
      array[offset + 1] =
        base[offset + 1] + Math.sin(time * 0.16 + phase * 1.7) * 0.28;
      array[offset + 2] =
        base[offset + 2] + Math.cos(time * 0.1 + phase) * 0.18;
    }
    attribute.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Static architecture of the office: floor, window wall, side walls, glass
 * zone partitions, plants, the instanced skyline and drifting dust.
 */
export function OfficeEnvironment() {
  const quality = useWorldStore((state) => state.quality);
  const high = quality === "high";

  return (
    <group>
      <Sky />
      <Skyline count={high ? 260 : 120} />
      <Floor />
      <BackWall />
      <SideWalls />
      <Partitions />
      <Plants />
      <Dust count={high ? 260 : 90} />
    </group>
  );
}
