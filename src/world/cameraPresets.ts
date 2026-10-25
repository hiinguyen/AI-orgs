import type { CameraPresetId } from "@/state/useWorldStore";

export interface CameraPreset {
  /** World position of the camera. */
  position: readonly [number, number, number];
  /** Orbit target the camera looks at. */
  target: readonly [number, number, number];
}

/** The five camera presets from the spec, in metres and radians-free. */
export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: {
    position: [-1.2, 20, 25.8],
    target: [-1.2, 0, 1.6],
  },
  hub: {
    position: [0.6, 7.2, 9.6],
    target: [0, 1, -2.4],
  },
  development: {
    position: [8.2, 6.2, 5.6],
    target: [8.25, 0.6, -2.8],
  },
  research: {
    position: [0.6, 5.6, 11.2],
    target: [6.8, 0.9, 5.2],
  },
  collaboration: {
    position: [-3.2, 8.4, 15],
    target: [-6.8, 0.5, 4.6],
  },
};

export const CAMERA_FOV = 40;

export const CAMERA_LIMITS = {
  minDistance: 3.5,
  maxDistance: 70,
  minPolarAngle: 0.18,
  maxPolarAngle: 1.36,
  targetMinX: -14,
  targetMaxX: 14,
  targetMinZ: -8,
  targetMaxZ: 11.5,
  targetMinY: 0,
  targetMaxY: 3,
} as const;

/** The camera position the Canvas starts from (overview preset). */
export const INITIAL_CAMERA_POSITION: [number, number, number] = [
  CAMERA_PRESETS.overview.position[0],
  CAMERA_PRESETS.overview.position[1],
  CAMERA_PRESETS.overview.position[2],
];
