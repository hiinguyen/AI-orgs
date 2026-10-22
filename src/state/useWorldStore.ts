import { create } from "zustand";
import type { AgentId, AgentState } from "@/agents/agentTypes";
import type { LocationId } from "@/simulation/worldLayout";
import { SIMULATION_CONFIG } from "@/simulation/simulationConfig";
import type {
  SimulationStatus,
  WorldSnapshot,
} from "@/integrations/AgentBackend";
import type { AgentEvent } from "@/events/eventTypes";
import { appendEvent } from "@/events/eventStore";
import { MIRROR_INTERVAL_MS, ThrottledMirror } from "./mirrorThrottle";

/**
 * The mutable per-frame snapshot buffer. The 3D layer reads this inside
 * useFrame; it is never a React value and is updated on every snapshot.
 */
export const liveWorld: { current: WorldSnapshot | null } = { current: null };

export type TabId = "overview" | "agents" | "tasks" | "activity" | "settings";

export type CameraPresetId =
  | "overview"
  | "hub"
  | "research"
  | "development"
  | "collaboration";

export interface CameraFocus {
  x: number;
  y: number;
  z: number;
}

/** A camera command the 3D controller (phase 3) consumes on a new nonce. */
export interface CameraRequest {
  nonce: number;
  preset?: CameraPresetId;
  focus?: CameraFocus;
  distance?: number;
}

export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type QualityMode = "high" | "low";

export interface BackendInfo {
  kind: "mock" | "websocket";
  label: string;
  simulated: boolean;
  connected: boolean;
  error: string | null;
}

export interface OverlaySettings {
  walkingPaths: boolean;
  speechIndicators: boolean;
}

/**
 * Sound settings shape shared with the phase 7 audio engine. Nothing is
 * persisted yet; the toggles only move the store.
 */
export interface SoundSettings {
  enabled: boolean;
  volume: number;
  ambient: boolean;
}

export interface WorldStore {
  // React mirror of the backend snapshot, updated at most every 160 ms.
  world: WorldSnapshot | null;
  simStatus: SimulationStatus;
  speed: number;

  events: AgentEvent[];

  activeTab: TabId;
  selectedAgentId: AgentId | null;
  selectedTaskId: string | null;
  selectedStationId: LocationId | null;
  hovered: string | null;
  followAgentId: AgentId | null;

  taskDialogOpen: boolean;
  preferredAgentId: AgentId | null;

  overlays: OverlaySettings;
  quality: QualityMode;
  qualityAuto: boolean;
  sceneReady: boolean;
  viewInsets: ViewInsets;
  camera: CameraRequest;

  backend: BackendInfo;
  sound: SoundSettings;

  setActiveTab: (tab: TabId) => void;
  selectAgent: (id: AgentId | null) => void;
  selectTask: (id: string | null) => void;
  selectStation: (id: LocationId | null) => void;
  setHovered: (target: string | null) => void;
  setFollowAgent: (id: AgentId | null) => void;
  clearSelection: () => void;

  openTaskDialog: (preferredAgentId?: AgentId | null) => void;
  closeTaskDialog: () => void;

  setOverlays: (patch: Partial<OverlaySettings>) => void;
  setQuality: (quality: QualityMode, auto: boolean) => void;
  setSceneReady: (ready: boolean) => void;
  setViewInsets: (insets: ViewInsets) => void;
  requestCamera: (
    request: Omit<CameraRequest, "nonce">,
  ) => void;
  focusAgent: (id: AgentId) => void;

  setBackend: (patch: Partial<BackendInfo>) => void;
  setBackendError: (error: string | null) => void;
  setSound: (patch: Partial<SoundSettings>) => void;

  applySnapshot: (snapshot: WorldSnapshot) => void;
  applyEvent: (event: AgentEvent) => void;
}

/** Focus point at the agent's current position, if the live world has one. */
function agentFocusPoint(id: AgentId): CameraFocus | undefined {
  const agent = liveWorld.current?.agents.find((entry) => entry.id === id);
  return agent
    ? { x: agent.position.x, y: 1, z: agent.position.z }
    : undefined;
}

export function isAgentActive(agent: AgentState): boolean {
  if (agent.paused) return false;
  return (
    agent.currentTaskId !== null ||
    agent.status === "working" ||
    agent.status === "thinking" ||
    agent.status === "communicating"
  );
}

export const useWorldStore = create<WorldStore>()((set) => {
  // Throttled mirror: significant changes reach React at once, progress and
  // activity changes at most every MIRROR_INTERVAL_MS, position-only updates
  // never.
  const mirror = new ThrottledMirror({
    intervalMs: MIRROR_INTERVAL_MS,
    push: (snapshot) => {
      set({
        world: snapshot,
        simStatus: snapshot.status,
        speed: snapshot.speed,
      });
    },
  });

  return {
    world: null,
    simStatus: "ready",
    speed: SIMULATION_CONFIG.defaultSpeed,

    events: [],

    activeTab: "overview",
    selectedAgentId: null,
    selectedTaskId: null,
    selectedStationId: null,
    hovered: null,
    followAgentId: null,

    taskDialogOpen: false,
    preferredAgentId: null,

    overlays: { walkingPaths: true, speechIndicators: true },
    quality: "high",
    qualityAuto: true,
    sceneReady: false,
    viewInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    camera: { nonce: 0 },

    backend: {
      kind: "mock",
      label: "Local simulation",
      simulated: true,
      connected: false,
      error: null,
    },
    sound: { enabled: true, volume: 0.6, ambient: true },

    setActiveTab: (tab) => set({ activeTab: tab }),

    // Every agent selection path (3D click, roster, activity jump, station
    // panel) frames the agent the same way, and releases follow unless the
    // selected agent is the one already being followed.
    selectAgent: (id) =>
      set((state) =>
        id === null
          ? {
              selectedAgentId: null,
              selectedTaskId: null,
              selectedStationId: null,
              activeTab: "agents",
            }
          : {
              selectedAgentId: id,
              selectedTaskId: null,
              selectedStationId: null,
              activeTab: "agents",
              followAgentId:
                state.followAgentId === id ? state.followAgentId : null,
              camera: {
                nonce: state.camera.nonce + 1,
                focus: agentFocusPoint(id),
                distance: 7.5,
              },
            },
      ),

    selectTask: (id) =>
      set({
        selectedTaskId: id,
        selectedAgentId: null,
        selectedStationId: null,
        activeTab: "tasks",
      }),

    selectStation: (id) =>
      set(
        id === null
          ? { selectedStationId: null }
          : {
              selectedStationId: id,
              selectedAgentId: null,
              selectedTaskId: null,
              activeTab: "agents",
            },
      ),

    setHovered: (target) => set({ hovered: target }),

    setFollowAgent: (id) => set({ followAgentId: id }),

    clearSelection: () =>
      set({
        selectedAgentId: null,
        selectedTaskId: null,
        selectedStationId: null,
        followAgentId: null,
      }),

    openTaskDialog: (preferredAgentId = null) =>
      set({ taskDialogOpen: true, preferredAgentId }),

    closeTaskDialog: () =>
      set({ taskDialogOpen: false, preferredAgentId: null }),

    setOverlays: (patch) =>
      set((state) => ({ overlays: { ...state.overlays, ...patch } })),

    setQuality: (quality, auto) => set({ quality, qualityAuto: auto }),

    setSceneReady: (ready) => set({ sceneReady: ready }),

    setViewInsets: (insets) =>
      set((state) => {
        const current = state.viewInsets;
        if (
          current.top === insets.top &&
          current.right === insets.right &&
          current.bottom === insets.bottom &&
          current.left === insets.left
        ) {
          return state;
        }
        return { viewInsets: insets };
      }),

    // A preset or a station focus is a deliberate camera move away from the
    // followed agent, so follow must end with it. Otherwise the follow branch
    // would pull the camera back once the move settles.
    requestCamera: (request) =>
      set((state) => ({
        camera: { ...request, nonce: state.camera.nonce + 1 },
        followAgentId: null,
      })),

    focusAgent: (id) =>
      set((state) => ({
        camera: {
          nonce: state.camera.nonce + 1,
          focus: agentFocusPoint(id),
          distance: 7.5,
        },
        followAgentId: state.followAgentId === id ? state.followAgentId : null,
      })),

    setBackend: (patch) =>
      set((state) => ({ backend: { ...state.backend, ...patch } })),

    setBackendError: (error) =>
      set((state) => ({ backend: { ...state.backend, error } })),

    setSound: (patch) =>
      set((state) => ({ sound: { ...state.sound, ...patch } })),

    applySnapshot: (snapshot) => {
      liveWorld.current = snapshot;
      mirror.apply(snapshot);
    },

    applyEvent: (event) =>
      set((state) => ({
        events: appendEvent(
          event.type === "system.reset" ? [] : state.events,
          event,
        ),
      })),
  };
});
