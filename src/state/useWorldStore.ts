import { create } from "zustand";
import type { AgentId, AgentProfile, AgentState } from "../agents/agentTypes.ts";
import { CORE_AGENT_IDS, MAX_LIVE_AGENTS } from "../agents/agentTypes.ts";
import { CORE_AGENTS, getAgentProfile, setAnnouncedProfiles } from "../agents/AgentRegistry.ts";
import type { LocationId } from "../simulation/worldLayout.ts";
import { BAY_COUNT } from "../simulation/worldLayout.ts";
import { SIMULATION_CONFIG } from "../simulation/simulationConfig.ts";
import type {
  BackendCapabilities,
  SimulationStatus,
  WorldSnapshot,
} from "../integrations/AgentBackend.ts";
import { DEFAULT_BACKEND_CAPABILITIES } from "../integrations/AgentBackend.ts";
import type { AgentEvent } from "../events/eventTypes.ts";
import { appendEvent } from "../events/eventStore.ts";
import { DEFAULT_SOUND_SETTINGS } from "../audio/soundCues.ts";
import type { SoundSettings } from "../audio/soundCues.ts";
import { MIRROR_INTERVAL_MS, ThrottledMirror } from "./mirrorThrottle.ts";
import type { QualityMode } from "./qualityPolicy.ts";

export type { QualityMode } from "./qualityPolicy.ts";
export type { SoundSettings } from "../audio/soundCues.ts";

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

export interface BackendInfo {
  kind: "mock" | "websocket";
  label: string;
  simulated: boolean;
  connected: boolean;
  error: string | null;
  capabilities: BackendCapabilities;
}

export interface OverlaySettings {
  walkingPaths: boolean;
  speechIndicators: boolean;
}

/** One agent that left the world, kept for the panel's Finished group. */
export interface FinishedAgent {
  id: AgentId;
  name: string;
  roleLabel: string;
  outcome: "success" | "error";
  /** Simulated lifetime in seconds when the backend reports one. */
  duration: number;
  finishedAt: number;
}

/**
 * Agent profiles keyed by id. A Map, because ids come from an untrusted
 * backend and "__proto__" or "constructor" must stay plain keys.
 */
export type AgentProfiles = ReadonlyMap<AgentId, AgentProfile>;

function coreProfilesMap(): Map<AgentId, AgentProfile> {
  return new Map(CORE_AGENTS.map((profile) => [profile.id, profile]));
}

/** Total profile lookup for UI code, never undefined. */
export function profileFor(
  profiles: AgentProfiles,
  id: AgentId,
): AgentProfile {
  return profiles.get(id) ?? getAgentProfile(id);
}

/**
 * Live agents without a bay. The backend owns bay allocation; a full floor
 * of 16 therefore reads as twelve bays plus four waiting, as the brief names.
 */
export function waitingAgentCount(snapshot: WorldSnapshot | null): number {
  if (snapshot === null) return 0;
  let live = 0;
  for (const agent of snapshot.agents) {
    if (getAgentProfile(agent.id).kind === "live") live += 1;
  }
  return Math.max(0, live - BAY_COUNT);
}

const FINISHED_LIMIT = 8;

export interface WorldStore {
  // React mirror of the backend snapshot, updated at most every 160 ms.
  world: WorldSnapshot | null;
  simStatus: SimulationStatus;
  speed: number;

  /** Profiles of every announced agent, core plus live, keyed by id. */
  profiles: AgentProfiles;
  /** Live agents in spawn order, newest last, for the Agents panel. */
  liveAgentOrder: AgentId[];
  /** The last eight live agents that finished and left the world. */
  finishedAgents: FinishedAgent[];

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
  /** True once high quality has been active; the baked environment stays pooled. */
  qualityEverHigh: boolean;
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

    profiles: coreProfilesMap(),
    liveAgentOrder: [],
    finishedAgents: [],

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
    // Low is the safe default until AppShell applies the device policy: the
    // first Canvas commit must not build high-only resources on a phone, a
    // reduced-motion session or a small CPU.
    quality: "low",
    qualityAuto: true,
    qualityEverHigh: false,
    sceneReady: false,
    viewInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    camera: { nonce: 0 },

    backend: {
      kind: "mock",
      label: "Local simulation",
      simulated: true,
      connected: false,
      error: null,
      capabilities: { ...DEFAULT_BACKEND_CAPABILITIES },
    },
    sound: { ...DEFAULT_SOUND_SETTINGS },

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

    setQuality: (quality, auto) =>
      set((state) => ({
        quality,
        qualityAuto: auto,
        qualityEverHigh: state.qualityEverHigh || quality === "high",
      })),

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
      const profilesChanged = setAnnouncedProfiles(snapshot.profiles);

      const liveIds: AgentId[] = [];
      for (const agent of snapshot.agents) {
        if (getAgentProfile(agent.id).kind === "live") liveIds.push(agent.id);
      }
      const present = new Set(liveIds);

      const state = useWorldStore.getState();
      const nextOrder = state.liveAgentOrder.filter((id) => present.has(id));
      for (const id of liveIds) {
        if (!nextOrder.includes(id)) nextOrder.push(id);
      }
      const orderChanged =
        nextOrder.length !== state.liveAgentOrder.length ||
        nextOrder.some((id, index) => id !== state.liveAgentOrder[index]);

      if (profilesChanged) {
        const profiles = coreProfilesMap();
        for (const profile of snapshot.profiles) {
          if (profile.kind === "live" && !CORE_AGENT_IDS.includes(profile.id)) {
            profiles.set(profile.id, profile);
          }
        }
        set({ profiles, liveAgentOrder: nextOrder });
      } else if (orderChanged) {
        set({ liveAgentOrder: nextOrder });
      }

      mirror.apply(snapshot);
    },

    applyEvent: (event) =>
      set((state) => {
        let finishedAgents = state.finishedAgents;
        let liveAgentOrder = state.liveAgentOrder;

        if (event.type === "system.reset") {
          finishedAgents = [];
          liveAgentOrder = [];
        } else if (event.type === "agent.spawned" && event.agentId) {
          const profile = profileFor(state.profiles, event.agentId);
          if (
            profile.kind === "live" &&
            liveAgentOrder.length < MAX_LIVE_AGENTS &&
            !liveAgentOrder.includes(event.agentId)
          ) {
            liveAgentOrder = [...liveAgentOrder, event.agentId];
          }
        } else if (event.type === "agent.despawned" && event.agentId) {
          const profile = profileFor(state.profiles, event.agentId);
          const rawOutcome = event.metadata?.outcome;
          const outcome: FinishedAgent["outcome"] =
            rawOutcome === "error" ? "error" : "success";
          const rawDuration = event.metadata?.duration;
          const duration =
            typeof rawDuration === "number" && Number.isFinite(rawDuration)
              ? Math.max(0, rawDuration)
              : 0;
          const finished: FinishedAgent = {
            id: event.agentId,
            name: profile.name,
            roleLabel: profile.roleLabel,
            outcome,
            duration,
            finishedAt: event.timestamp,
          };
          finishedAgents = [finished, ...finishedAgents].slice(0, FINISHED_LIMIT);
          liveAgentOrder = liveAgentOrder.filter((id) => id !== event.agentId);
        }

        return {
          events: appendEvent(
            event.type === "system.reset" ? [] : state.events,
            event,
          ),
          finishedAgents,
          liveAgentOrder,
        };
      }),
  };
});
