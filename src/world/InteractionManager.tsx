"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldStore } from "@/state/useWorldStore";
import { STATIONS, type StationId } from "@/simulation/worldLayout";
import { geometries, hoverRingMaterial, sharedGeometry } from "./sharedResources";
import {
  isStationId,
  stationIdFromTarget,
  stationTarget,
} from "./stationOwners";
import { focusStation } from "./stationFocus";
import {
  consumeClickGesture,
  installPointerGesture,
  wasDragGesture,
} from "./pointerGesture";

const HOVER_COLOR = "#9ad7e6";

/**
 * Invisible hit boxes for the six desks, the shared click-vs-orbit gesture,
 * hover state, the pointer cursor and the station focus request.
 *
 * The boxes stay `visible={false}`: the raycaster tests layers, not
 * visibility, so picking still works while nothing extra is drawn.
 */
export function InteractionManager() {
  const gl = useThree((state) => state.gl);
  const hovered = useWorldStore((state) => state.hovered);
  const selectedStationId = useWorldStore((state) => state.selectedStationId);

  useEffect(() => {
    const element = gl.domElement;
    const removeGesture = installPointerGesture(element, {
      onEmptyClick: () => {
        useWorldStore.getState().clearSelection();
      },
    });
    const onLeave = () => {
      useWorldStore.getState().setHovered(null);
      element.style.cursor = "";
    };
    element.addEventListener("pointerleave", onLeave);
    return () => {
      removeGesture();
      element.removeEventListener("pointerleave", onLeave);
      element.style.cursor = "";
    };
  }, [gl]);

  const entered = (id: StationId) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const store = useWorldStore.getState();
    const target = stationTarget(id);
    if (store.hovered !== target) store.setHovered(target);
    gl.domElement.style.cursor = "pointer";
  };

  const left = (id: StationId) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const store = useWorldStore.getState();
    if (store.hovered === stationTarget(id)) {
      store.setHovered(null);
      gl.domElement.style.cursor = "";
    }
  };

  const clicked = (id: StationId) => (event: ThreeEvent<MouseEvent>) => {
    if (wasDragGesture()) return;
    consumeClickGesture();
    event.stopPropagation();
    useWorldStore.getState().selectStation(id);
    focusStation(id);
  };

  const hoverStation = stationIdFromTarget(hovered);
  const selectedStation =
    selectedStationId !== null && isStationId(selectedStationId)
      ? selectedStationId
      : null;
  const highlighted = hoverStation ?? selectedStation;
  const highlightStation = highlighted
    ? STATIONS.find((entry) => entry.id === highlighted)
    : undefined;

  return (
    <group>
      {STATIONS.map((station) => (
        <mesh
          key={station.id}
          geometry={geometries.stationHitBox}
          position={[station.position.x, 0.9, station.position.z + 0.35]}
          visible={false}
          onPointerOver={entered(station.id)}
          onPointerOut={left(station.id)}
          onClick={clicked(station.id)}
        />
      ))}

      {highlightStation && (
        <mesh
          geometry={sharedGeometry(
            "station-highlight-ring",
            () => new THREE.RingGeometry(1.22, 1.32, 64),
          )}
          material={hoverRingMaterial(HOVER_COLOR)}
          position={[
            highlightStation.position.x,
            0.02,
            highlightStation.position.z + 0.35,
          ]}
          rotation-x={-Math.PI / 2}
        />
      )}
    </group>
  );
}
