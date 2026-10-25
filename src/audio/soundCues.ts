/**
 * Pure sound decisions: event to cue mapping, speaker pitches, throttling and
 * persisted settings. No Web Audio, React, three or Next imports, so the Node
 * checks can load this module directly through `node --experimental-strip-types`.
 */
import type { AgentId } from "../agents/agentTypes.ts";
import type { AgentEvent, AgentEventType } from "../events/eventTypes.ts";
import { hashString } from "../simulation/EventBus.ts";

export type CueId =
  | "taskCreated"
  | "ping"
  | "arpeggio"
  | "researchSweep"
  | "keyboard"
  | "whoosh"
  | "successChime"
  | "errorBuzz"
  | "fanfare"
  | "failure"
  | "downBlips"
  | "upBlips"
  | "rise"
  | "fall"
  | "resetSweep"
  | "footstep"
  | "spawn"
  | "despawn";

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  ambient: boolean;
}

export const SOUND_STORAGE_KEY = "aaw.sound.v1";

export const DEFAULT_SOUND_SETTINGS: Readonly<SoundSettings> = {
  enabled: true,
  volume: 0.6,
  ambient: true,
};

/** A minimal `localStorage` surface, so the checks can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Speaker pitches from spec section 8: C5, E5, D5, A4, F5, G4. */
export const SPEAKER_PITCH: Readonly<Record<string, number>> = {
  orion: 523,
  piper: 659,
  iris: 587,
  kai: 440,
  quinn: 698,
  rex: 392,
};

/**
 * C major pentatonic across C4..C6. Live agents hash into this table, so any
 * number of subagents gets a musical speaking voice inside the range without
 * colliding with the six core pitches.
 */
export const LIVE_SPEAKER_PITCHES: readonly number[] = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.0, // G4
  440.0, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0, // A5
  1046.5, // C6
];

/** Fallback for an event with no speaker. */
const FALLBACK_PITCH = SPEAKER_PITCH.orion;

export function speakerPitch(agentId?: AgentId | null): number {
  if (!agentId) return FALLBACK_PITCH;
  if (Object.hasOwn(SPEAKER_PITCH, agentId)) {
    const core = SPEAKER_PITCH[agentId];
    if (Number.isFinite(core)) return core;
  }
  const hashed =
    LIVE_SPEAKER_PITCHES[hashString(agentId) % LIVE_SPEAKER_PITCHES.length];
  return Number.isFinite(hashed) ? hashed : FALLBACK_PITCH;
}

/**
 * Every event type gets an explicit decision. A null cue is a deliberate
 * silence: ambient wanderings, bookkeeping status changes and the start of a
 * phase never make a sound of their own.
 */
const CUE_BY_EVENT: Readonly<Record<AgentEventType, CueId | null>> = {
  "system.ready": null,
  "system.started": "rise",
  "system.paused": "fall",
  "system.resumed": "rise",
  "system.reset": "resetSweep",
  "system.speed_changed": null,
  "task.created": "taskCreated",
  "task.assigned": "ping",
  "task.status_changed": null,
  "task.completed": "fanfare",
  "task.failed": "failure",
  "task.blocked": "downBlips",
  "task.unblocked": "upBlips",
  "plan.created": "arpeggio",
  "research.completed": "researchSweep",
  "implementation.started": "keyboard",
  "implementation.submitted": "whoosh",
  "qa.started": null,
  "qa.passed": "successChime",
  "qa.failed": "errorBuzz",
  "review.started": null,
  "review.approved": "successChime",
  "review.changes_requested": "errorBuzz",
  "agent.message": "ping",
  "agent.arrived": "footstep",
  "agent.paused": "downBlips",
  "agent.resumed": "upBlips",
  "agent.ambient": null,
  "agent.spawned": "spawn",
  "agent.despawned": "despawn",
};

/**
 * The footstep is only meaningful when an agent arrives with a task; walking
 * back home or wandering to a board stays silent.
 */
export function cueForEvent(
  event: Pick<AgentEvent, "type"> & { taskId?: string },
): CueId | null {
  if (event.type === "agent.arrived") {
    return event.taskId ? CUE_BY_EVENT[event.type] : null;
  }
  return CUE_BY_EVENT[event.type];
}

export const CUE_THROTTLE_MS = 120;
export const ARRIVAL_THROTTLE_MS = 160;

export function throttleWindowMs(type: AgentEventType): number {
  return type === "agent.arrived" ? ARRIVAL_THROTTLE_MS : CUE_THROTTLE_MS;
}

/**
 * Messages are throttled per speaking agent, so two agents talking in the
 * same tick both get their ping. Everything else is throttled per type.
 */
export function throttleKey(
  event: Pick<AgentEvent, "type" | "agentId">,
): string {
  if (event.type === "agent.message") {
    return `${event.type}:${event.agentId ?? "unknown"}`;
  }
  return event.type;
}

export function throttleAllows(
  lastAt: number | undefined,
  now: number,
  windowMs: number,
): boolean {
  return lastAt === undefined || now - lastAt >= windowMs;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOUND_SETTINGS.volume;
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Field-by-field validation: a bad field falls back, good siblings survive. */
export function normaliseSoundSettings(value: unknown): SoundSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
  const volume = value.volume;
  return {
    enabled:
      typeof value.enabled === "boolean"
        ? value.enabled
        : DEFAULT_SOUND_SETTINGS.enabled,
    volume:
      typeof volume === "number" &&
      Number.isFinite(volume) &&
      volume >= 0 &&
      volume <= 1
        ? volume
        : DEFAULT_SOUND_SETTINGS.volume,
    ambient:
      typeof value.ambient === "boolean"
        ? value.ambient
        : DEFAULT_SOUND_SETTINGS.ambient,
  };
}

export function parseSoundSettings(raw: string | null): SoundSettings {
  if (raw === null) return { ...DEFAULT_SOUND_SETTINGS };
  try {
    return normaliseSoundSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

export function serializeSoundSettings(settings: SoundSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    volume: clampVolume(settings.volume),
    ambient: settings.ambient,
  });
}

export function readSoundSettings(
  storage: StorageLike | null,
): SoundSettings {
  if (storage === null) return { ...DEFAULT_SOUND_SETTINGS };
  try {
    return parseSoundSettings(storage.getItem(SOUND_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

export function writeSoundSettings(
  storage: StorageLike | null,
  settings: SoundSettings,
): void {
  if (storage === null) return;
  try {
    storage.setItem(SOUND_STORAGE_KEY, serializeSoundSettings(settings));
  } catch {
    // Private mode or a full quota: sound is a nicety, never an error.
  }
}

/** Minimal shape of the DOM events that may unlock audio. */
export interface GestureLike {
  type: string;
  key?: string;
  pointerType?: string;
}

/**
 * Whether an input counts as a user activation for Web Audio. Chrome ignores
 * Escape keydown and touch/pen pointerdown, so creating or resuming the
 * context on them logs a console warning instead of unlocking audio.
 */
export function isActivatingGesture(event: GestureLike): boolean {
  switch (event.type) {
    case "keydown":
      return event.key !== "Escape";
    case "pointerdown":
      return event.pointerType === undefined || event.pointerType === "mouse";
    case "pointerup":
    case "click":
      return true;
    default:
      return false;
  }
}
