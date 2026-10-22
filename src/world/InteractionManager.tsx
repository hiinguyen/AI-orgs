"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_IDS } from "@/agents/agentTypes";
import { useWorldStore } from "@/state/useWorldStore";
import { STATIONS, type StationId } from "@/simulation/worldLayout";
import { agentVisuals } from "./agentVisuals";
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
  const agentHitRefs = useRef<Array<THREE.Mesh | null>>([]);

  // The invisible agent cylinders follow the damped visual pose, so a click
  // lands where the robot is drawn rather than where the snapshot already is.
  useFrame(() => {
    for (let index = 0; index < AGENT_IDS.length; index += 1) {
      const mesh = agentHitRefs.current[index];
      if (!mesh) continue;
      const visual = agentVisuals[AGENT_IDS[index]];
      mesh.position.set(visual.x, 1.02, visual.z);
      mesh.rotation.y = visual.heading;
    }
  });

  useEffect(() => {
    const element = gl.domElement;
    const removeGesture = installPointerGesture(element, {
      onEmptyClick: () => {
        useWorldStore.getState().clearSelection();
      },
      // Only a real drag releases follow mode. OrbitControls also fires its
      // `start` event on a plain click and every wheel tick, which is not a
      // gesture the user would expect to end following.
      onDrag: () => {
        const store = useWorldStore.getState();
        if (store.followAgentId !== null) store.setFollowAgent(null);
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

  const enteredAgent = (id: AgentId) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const store = useWorldStore.getState();
    const target = `agent:${id}`;
    if (store.hovered !== target) store.setHovered(target);
    gl.domElement.style.cursor = "pointer";
  };

  const leftAgent = (id: AgentId) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const store = useWorldStore.getState();
    if (store.hovered === `agent:${id}`) {
      store.setHovered(null);
      gl.domElement.style.cursor = "";
    }
  };

  const clickedAgent = (id: AgentId) => (event: ThreeEvent<MouseEvent>) => {
    if (wasDragGesture()) return;
    consumeClickGesture();
    event.stopPropagation();
    // selectAgent also requests the focus at distance 7.5, so every panel
    // selection path and the 3D click share the same framing.
    useWorldStore.getState().selectAgent(id);
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

      {AGENT_IDS.map((id, index) => (
        <mesh
          key={id}
          ref={(node) => {
            agentHitRefs.current[index] = node;
          }}
          name={`agent-hit-${id}`}
          geometry={geometries.cylinder}
          scale={[0.9, 2.05, 0.9]}
          position={[agentVisuals[id].x, 1.02, agentVisuals[id].z]}
          visible={false}
          onPointerOver={enteredAgent(id)}
          onPointerOut={leftAgent(id)}
          onClick={clickedAgent(id)}
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
