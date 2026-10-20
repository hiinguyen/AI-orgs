import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  blobTexture,
  boardTexture,
  floorTexture,
  glowTexture,
  missionControlTexture,
  screenTexture,
  windowsTexture,
} from "./proceduralTextures";

/**
 * Lazy pools for geometry and materials shared by every object in the office.
 * Keys are stable, builders run once on the client, and the pools live for
 * the lifetime of the tab so a StrictMode remount never renders disposed
 * buffers.
 */

const geometryPool = new Map<string, THREE.BufferGeometry>();
const materialPool = new Map<string, THREE.Material>();

export function sharedGeometry<T extends THREE.BufferGeometry>(
  key: string,
  make: () => T,
): T {
  const existing = geometryPool.get(key);
  if (existing) return existing as T;
  const built = make();
  built.name = key;
  geometryPool.set(key, built);
  return built;
}

export function sharedMaterial<T extends THREE.Material>(
  key: string,
  make: () => T,
): T {
  const existing = materialPool.get(key);
  if (existing) return existing as T;
  const built = make();
  built.name = key;
  materialPool.set(key, built);
  return built;
}

function transformed(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation?: [number, number, number],
): THREE.BufferGeometry {
  if (rotation) {
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
  }
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (merged === null) {
    throw new Error("Failed to merge shared geometry");
  }
  return merged;
}

function unitBox(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

function buildDeskBase(): THREE.BufferGeometry {
  return merge([
    transformed(unitBox().scale(0.09, 0.7, 1.0), [-1.05, 0.35, 0]),
    transformed(unitBox().scale(0.09, 0.7, 1.0), [1.05, 0.35, 0]),
    transformed(unitBox().scale(2.1, 0.42, 0.05), [0, 0.55, -0.44]),
  ]);
}

function buildChair(): THREE.BufferGeometry {
  return merge([
    transformed(unitBox().scale(0.52, 0.09, 0.5), [0, 0.46, 0]),
    transformed(unitBox().scale(0.52, 0.55, 0.08), [0, 0.75, 0.23]),
    transformed(
      new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10),
      [0, 0.28, 0],
    ),
    transformed(
      new THREE.CylinderGeometry(0.3, 0.3, 0.045, 18),
      [0, 0.06, 0],
    ),
  ]);
}

function buildMonitorStand(): THREE.BufferGeometry {
  return merge([
    transformed(unitBox().scale(0.3, 0.02, 0.18), [0, 0.01, 0]),
    transformed(unitBox().scale(0.06, 0.2, 0.05), [0, 0.12, 0]),
  ]);
}

function buildPlantFoliage(): THREE.BufferGeometry {
  return merge([
    transformed(
      new THREE.CylinderGeometry(0.05, 0.06, 0.72, 8),
      [0, 0.36, 0],
    ),
    transformed(new THREE.SphereGeometry(0.36, 10, 8), [0, 0.98, 0]),
    transformed(new THREE.SphereGeometry(0.28, 10, 8), [0.2, 1.22, -0.08]),
    transformed(new THREE.SphereGeometry(0.24, 10, 8), [-0.16, 1.4, 0.08]),
    transformed(new THREE.SphereGeometry(0.2, 10, 8), [0.04, 1.56, -0.04]),
  ]);
}

function buildStool(): THREE.BufferGeometry {
  return merge([
    transformed(
      new THREE.CylinderGeometry(0.28, 0.26, 0.06, 20),
      [0, 0.5, 0],
    ),
    transformed(
      new THREE.CylinderGeometry(0.035, 0.035, 0.46, 10),
      [0, 0.25, 0],
    ),
    transformed(
      new THREE.CylinderGeometry(0.22, 0.22, 0.03, 18),
      [0, 0.02, 0],
    ),
  ]);
}

function buildLoungeSeat(): THREE.BufferGeometry {
  return merge([
    transformed(unitBox().scale(0.95, 0.36, 0.8), [0, 0.18, 0]),
    transformed(unitBox().scale(0.95, 0.42, 0.15), [0, 0.45, -0.33]),
    transformed(unitBox().scale(0.12, 0.22, 0.8), [-0.52, 0.29, 0]),
    transformed(unitBox().scale(0.12, 0.22, 0.8), [0.52, 0.29, 0]),
  ]);
}

export const geometries = {
  get box(): THREE.BoxGeometry {
    return sharedGeometry("box", unitBox);
  },
  get plane(): THREE.PlaneGeometry {
    return sharedGeometry("plane", () => new THREE.PlaneGeometry(1, 1));
  },
  get disc(): THREE.CircleGeometry {
    return sharedGeometry("disc", () => new THREE.CircleGeometry(0.5, 48));
  },
  get sphere(): THREE.SphereGeometry {
    return sharedGeometry(
      "sphere",
      () => new THREE.SphereGeometry(0.5, 24, 16),
    );
  },
  get cylinder(): THREE.CylinderGeometry {
    return sharedGeometry(
      "cylinder",
      () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
    );
  },
  get torus(): THREE.TorusGeometry {
    return sharedGeometry(
      "torus",
      () => new THREE.TorusGeometry(1, 0.012, 8, 128),
    );
  },
  get deskSlab(): RoundedBoxGeometry {
    return sharedGeometry(
      "desk-slab",
      () => new RoundedBoxGeometry(2.6, 0.1, 1.15, 3, 0.05),
    );
  },
  get deskBase(): THREE.BufferGeometry {
    return sharedGeometry("desk-base", buildDeskBase);
  },
  get chair(): THREE.BufferGeometry {
    return sharedGeometry("chair", buildChair);
  },
  get monitorFrame(): THREE.BoxGeometry {
    return sharedGeometry(
      "monitor-frame",
      () => new THREE.BoxGeometry(1.0, 0.55, 0.045),
    );
  },
  get monitorScreen(): THREE.PlaneGeometry {
    return sharedGeometry(
      "monitor-screen",
      () => new THREE.PlaneGeometry(0.93, 0.47),
    );
  },
  get monitorStand(): THREE.BufferGeometry {
    return sharedGeometry("monitor-stand", buildMonitorStand);
  },
  get keyboard(): THREE.BoxGeometry {
    return sharedGeometry(
      "keyboard",
      () => new THREE.BoxGeometry(0.72, 0.022, 0.22),
    );
  },
  get plantFoliage(): THREE.BufferGeometry {
    return sharedGeometry("plant-foliage", buildPlantFoliage);
  },
  get plantPot(): THREE.CylinderGeometry {
    return sharedGeometry(
      "plant-pot",
      () => new THREE.CylinderGeometry(0.28, 0.22, 0.5, 20),
    );
  },
  get stool(): THREE.BufferGeometry {
    return sharedGeometry("stool", buildStool);
  },
  get loungeSeat(): THREE.BufferGeometry {
    return sharedGeometry("lounge-seat", buildLoungeSeat);
  },
  get hubBase(): THREE.CylinderGeometry {
    return sharedGeometry(
      "hub-base",
      () => new THREE.CylinderGeometry(0.72, 0.9, 0.9, 40),
    );
  },
  get hubTop(): THREE.CylinderGeometry {
    return sharedGeometry(
      "hub-top",
      () => new THREE.CylinderGeometry(0.98, 0.98, 0.07, 40),
    );
  },
  get hubOrb(): THREE.SphereGeometry {
    return sharedGeometry(
      "hub-orb",
      () => new THREE.SphereGeometry(0.22, 32, 20),
    );
  },
  get stationHitBox(): THREE.BoxGeometry {
    return sharedGeometry(
      "station-hit-box",
      () => new THREE.BoxGeometry(2.9, 2.0, 2.3),
    );
  },
};

export const materials = {
  get floor(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "floor",
      () =>
        new THREE.MeshStandardMaterial({
          map: floorTexture(),
          color: "#93a2b4",
          roughness: 0.38,
          metalness: 0.24,
          envMapIntensity: 0.9,
        }),
    );
  },
  get wall(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "wall",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#0a0f17",
          roughness: 0.9,
          metalness: 0.16,
        }),
    );
  },
  get wallPanel(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "wall-panel",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#101823",
          roughness: 0.72,
          metalness: 0.28,
        }),
    );
  },
  get metal(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "metal",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#1b2431",
          roughness: 0.44,
          metalness: 0.72,
        }),
    );
  },
  get metalLight(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "metal-light",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#8e9bae",
          roughness: 0.32,
          metalness: 0.86,
        }),
    );
  },
  get glass(): THREE.MeshPhysicalMaterial {
    return sharedMaterial(
      "glass",
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#9fd3e6",
          transparent: true,
          opacity: 0.14,
          roughness: 0.08,
          metalness: 0,
          clearcoat: 0.6,
          clearcoatRoughness: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
          envMapIntensity: 1.1,
        }),
    );
  },
  get windowGlass(): THREE.MeshPhysicalMaterial {
    return sharedMaterial(
      "window-glass",
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#8fc6e0",
          transparent: true,
          opacity: 0.06,
          roughness: 0.05,
          metalness: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          envMapIntensity: 1.2,
        }),
    );
  },
  get desk(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "desk",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#d9dfe7",
          roughness: 0.5,
          metalness: 0.1,
          envMapIntensity: 0.75,
        }),
    );
  },
  get chair(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "chair",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#151d29",
          roughness: 0.55,
          metalness: 0.45,
        }),
    );
  },
  get screenFrame(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "screen-frame",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#070b11",
          roughness: 0.5,
          metalness: 0.6,
        }),
    );
  },
  get plant(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "plant",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#2f5b45",
          roughness: 0.86,
          metalness: 0,
        }),
    );
  },
  get pot(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "pot",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#cfd5dc",
          roughness: 0.55,
          metalness: 0.16,
          envMapIntensity: 0.8,
        }),
    );
  },
  get skyline(): THREE.MeshStandardMaterial {
    return sharedMaterial("skyline", () => {
      const texture = windowsTexture();
      return new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: "#ffffff",
        emissiveIntensity: 0.46,
        color: "#93a5ba",
        roughness: 0.92,
        metalness: 0.18,
      });
    });
  },
  get missionScreen(): THREE.MeshStandardMaterial {
    return sharedMaterial("mission-screen", () => {
      const texture = missionControlTexture();
      return new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: "#ffffff",
        emissiveIntensity: 0.72,
        color: "#0a111b",
        roughness: 0.46,
        metalness: 0.2,
      });
    });
  },
  get board(): THREE.MeshStandardMaterial {
    return sharedMaterial("board", () => {
      const texture = boardTexture();
      return new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: "#ffffff",
        emissiveIntensity: 0.06,
        color: "#a5afba",
        roughness: 0.9,
        metalness: 0.06,
      });
    });
  },
  get hubAccent(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "hub-accent",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#3a2a10",
          emissive: "#E8B04A",
          emissiveIntensity: 2.1,
          roughness: 0.36,
          metalness: 0.65,
        }),
    );
  },
  get contactShadow(): THREE.MeshBasicMaterial {
    return sharedMaterial(
      "contact-shadow",
      () =>
        new THREE.MeshBasicMaterial({
          map: blobTexture(),
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        }),
    );
  },
  get glow(): THREE.MeshBasicMaterial {
    return sharedMaterial(
      "glow",
      () =>
        new THREE.MeshBasicMaterial({
          map: glowTexture(),
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
    );
  },
  get stickyCard(): THREE.MeshStandardMaterial {
    return sharedMaterial(
      "sticky-card",
      () =>
        new THREE.MeshStandardMaterial({
          color: "#f0c96e",
          roughness: 0.82,
          metalness: 0,
        }),
    );
  },
};

/** Emissive material in an agent accent colour, pooled per colour. */
export function accentMaterial(color: string): THREE.MeshStandardMaterial {
  return sharedMaterial(
    `accent:${color}`,
    () =>
      new THREE.MeshStandardMaterial({
        color: "#11161d",
        emissive: color,
        emissiveIntensity: 1.7,
        roughness: 0.4,
        metalness: 0.4,
      }),
  );
}

/** Matte tinted material, pooled per colour. */
export function tintedMaterial(color: string): THREE.MeshStandardMaterial {
  return sharedMaterial(
    `tinted:${color}`,
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.64,
        metalness: 0.14,
      }),
  );
}

/**
 * One screen material per station so phase 5 can raise the emissive intensity
 * of the desk belonging to the agent that is currently working.
 */
export function screenMaterial(stationId: string): THREE.MeshStandardMaterial {
  return sharedMaterial(`screen:${stationId}`, () => {
    const texture = screenTexture();
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: "#ffffff",
      emissiveIntensity: 0.95,
      color: "#070b11",
      roughness: 0.34,
      metalness: 0.2,
    });
  });
}

export function hoverRingMaterial(color: string): THREE.MeshBasicMaterial {
  return sharedMaterial(
    `hover-ring:${color}`,
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
  );
}
