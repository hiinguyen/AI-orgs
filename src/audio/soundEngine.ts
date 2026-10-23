/**
 * The singleton sound engine. It stays completely inert until a real user
 * gesture calls `unlock()` (browsers block audio before that), so `play()`
 * and the ambient bed are silent no-ops (also while the context is not `running`) rather than exceptions.
 *
 * Graph: per-cue voices -> master gain -> compressor (-18 dB, ratio 6) ->
 * destination. The ambient bed is a looped brown-ish noise through a 260 Hz
 * low-pass plus a very quiet 58 Hz sine.
 */
import type { AgentEvent } from "../events/eventTypes.ts";
import {
  DEFAULT_SOUND_SETTINGS,
  clampVolume,
  cueForEvent,
  isActivatingGesture,
  speakerPitch,
  throttleAllows,
  throttleKey,
  throttleWindowMs,
} from "./soundCues.ts";
import type { GestureLike, SoundSettings } from "./soundCues.ts";
import { CueVoice, createNoiseBuffer, renderCue } from "./soundSynthesis.ts";

type ContextFactory = () => AudioContext | null;

export interface SoundDebugSnapshot {
  context: AudioContextState | "none";
  running: boolean;
  ambient: boolean;
  cues: Record<string, number>;
  settings: SoundSettings;
}

function defaultContextFactory(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const constructor: typeof AudioContext | undefined =
    window.AudioContext ??
    (
      window as Window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (constructor === undefined) return null;
  try {
    return new constructor();
  } catch {
    return null;
  }
}

/** Gestures that may activate audio; Chrome counts pointerup, not touch pointerdown. */
export const UNLOCK_EVENTS: readonly string[] = [
  "pointerdown",
  "pointerup",
  "click",
  "keydown",
];

export type UnlockListener = (event: GestureLike) => void;

export interface UnlockTarget {
  addEventListener(type: string, listener: UnlockListener, capture?: boolean): void;
  removeEventListener(type: string, listener: UnlockListener, capture?: boolean): void;
}

/**
 * Keep exactly one set of gesture listeners armed while the context is not
 * running (Escape or a touch pointerdown cannot unlock it), disarm them once it
 * runs or the engine is disabled, and re-arm them if the context later leaves
 * `running` (iOS `interrupted`, `suspended`). Returns the cleanup function.
 */
export function attachUnlockListeners(
  target: UnlockTarget,
  engine: SoundEngine,
): () => void {
  let armed = false;
  let disposed = false;
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture, true);
  };
  const arm = () => {
    if (armed || disposed) return;
    armed = true;
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, onGesture, true);
  };
  const sync = () => {
    if (disposed) return;
    if (engine.isDisabled()) {
      disarm();
      stopWatching();
    } else if (engine.isRunning()) {
      disarm();
    } else {
      arm();
    }
  };
  function onGesture(event: GestureLike): void {
    if (!isActivatingGesture(event)) return;
    void engine.unlock().then(sync);
    sync();
  }
  const stopWatching = engine.onChange(sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    disarm();
    stopWatching();
  };
}

const AMBIENT_FADE_IN = 1.5;
const AMBIENT_FADE_OUT = 0.25;
const MASTER_RAMP = 0.08;

export class SoundEngine {
  private readonly contextFactory: ContextFactory;
  private readonly now: () => number;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientGain: GainNode | null = null;
  private ambientSources: AudioScheduledSourceNode[] = [];
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private running = false;
  private disabled = false;
  private readonly changeListeners = new Set<() => void>();
  private readonly lastCueAt = new Map<string, number>();
  private readonly cueCounts: Record<string, number> = {};

  constructor(
    contextFactory: ContextFactory = defaultContextFactory,
    now: () => number = Date.now,
  ) {
    this.contextFactory = contextFactory;
    this.now = now;
  }

  /**
   * Create or resume the context. Only ever called from a gesture handler; a
   * browser without Web Audio disables the engine quietly. Resolves to whether
   * the context is running once `resume()` has settled.
   */
  async unlock(): Promise<boolean> {
    if (this.disabled) return false;
    const context = this.context ?? this.createContext();
    if (context === null) {
      this.disable();
      return false;
    }
    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        // A blocked resume leaves the context suspended; cues stay silent.
      }
    }
    try {
      this.syncAmbient();
    } catch {
      // Starting the ambient bed failed; cues and the unlock stay quiet.
    }
    return this.isRunning();
  }

  isRunning(): boolean {
    return this.context?.state === "running";
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  /** Called on every context state change and when disabled; returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /** Test probe: number of live change subscriptions. */
  get changeListenerCount(): number {
    return this.changeListeners.size;
  }

  configure(settings: SoundSettings): void {
    this.settings = {
      enabled: settings.enabled,
      volume: clampVolume(settings.volume),
      ambient: settings.ambient,
    };
    this.applyMasterGain();
    this.syncAmbient();
  }

  setRunning(running: boolean): void {
    this.running = running;
    this.syncAmbient();
  }

  /** Map an event to a cue, throttled per type (per agent for messages). */
  play(event: AgentEvent): void {
    if (this.disabled) return;
    const context = this.context;
    const master = this.master;
    const noiseBuffer = this.noiseBuffer;
    if (context === null || master === null || noiseBuffer === null) return;
    if (context.state !== "running" || !this.settings.enabled) return;

    const cue = cueForEvent(event);
    if (cue === null) return;

    const key = throttleKey(event);
    const at = this.now();
    if (!throttleAllows(this.lastCueAt.get(key), at, throttleWindowMs(event.type))) {
      return;
    }
    this.lastCueAt.set(key, at);
    this.cueCounts[cue] = (this.cueCounts[cue] ?? 0) + 1;

    const voice = new CueVoice({
      context,
      destination: master,
      noiseBuffer,
      pitch: speakerPitch(event.agentId),
    });
    renderCue(cue, voice);
  }

  /** Read-only probe for the phase checks; only exposed behind `?debug`. */
  getDebugSnapshot(): SoundDebugSnapshot {
    return {
      context: this.context?.state ?? "none",
      running: this.running,
      ambient: this.ambientGain !== null,
      cues: { ...this.cueCounts },
      settings: { ...this.settings },
    };
  }

  private createContext(): AudioContext | null {
    let context: AudioContext | null = null;
    try {
      context = this.contextFactory();
      if (context === null) return null;

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;

      const master = context.createGain();
      master.gain.value = 0;
      master.connect(compressor);
      compressor.connect(context.destination);
      const noiseBuffer = createNoiseBuffer(context);

      this.context = context;
      this.master = master;
      this.noiseBuffer = noiseBuffer;
      this.applyMasterGain(true);
      context.addEventListener?.("statechange", this.onContextState);
      return context;
    } catch {
      this.context = null;
      this.master = null;
      this.noiseBuffer = null;
      // Do not leak a half-built context (browsers cap live AudioContexts).
      if (context !== null && typeof context.close === "function") {
        void context.close().catch(() => {});
      }
      return null;
    }
  }

  private disable(): void {
    // By design the engine stays disabled for the session after a failure (fail quietly).
    this.disabled = true;
    for (const listener of [...this.changeListeners]) listener();
  }

  private readonly onContextState = (): void => {
    this.syncAmbient();
    for (const listener of [...this.changeListeners]) listener();
  };

  private applyMasterGain(immediate = false): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const target = this.settings.enabled ? this.settings.volume : 0;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    if (immediate) {
      master.gain.setValueAtTime(target, now);
      return;
    }
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + MASTER_RAMP);
  }

  private syncAmbient(): void {
    const wanted =
      this.context !== null &&
      this.running &&
      this.settings.enabled &&
      this.settings.ambient;
    if (wanted) {
      if (this.isRunning()) this.startAmbient();
    } else {
      this.stopAmbient();
    }
  }

  private startAmbient(): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.noiseBuffer;
    if (
      context === null ||
      master === null ||
      buffer === null ||
      this.ambientGain !== null
    ) {
      return;
    }

    const start = context.currentTime;
    const bed = context.createGain();
    bed.gain.setValueAtTime(0.0001, start);
    bed.gain.linearRampToValueAtTime(1, start + AMBIENT_FADE_IN);
    bed.connect(master);

    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.055;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(bed);

    const hum = context.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 58;
    const humGain = context.createGain();
    humGain.gain.value = 0.012;
    hum.connect(humGain);
    humGain.connect(bed);

    // The shared bed is released once its last source has ended, which is
    // audio-clock driven, so a suspended context cannot desync the release.
    let live = 2;
    const release = () => {
      live -= 1;
      if (live === 0) bed.disconnect();
    };
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      noiseGain.disconnect();
      release();
    };
    hum.onended = () => {
      hum.disconnect();
      humGain.disconnect();
      release();
    };

    noise.start(start);
    hum.start(start);
    this.ambientGain = bed;
    this.ambientSources = [noise, hum];
  }

  private stopAmbient(): void {
    const context = this.context;
    const bed = this.ambientGain;
    if (context === null || bed === null) return;

    const stop = context.currentTime;
    this.ambientGain = null;
    bed.gain.cancelScheduledValues(stop);
    bed.gain.setValueAtTime(bed.gain.value, stop);
    bed.gain.linearRampToValueAtTime(0.0001, stop + AMBIENT_FADE_OUT);

    const sources = this.ambientSources;
    this.ambientSources = [];
    for (const source of sources) {
      try {
        source.stop(stop + AMBIENT_FADE_OUT + 0.01);
      } catch {
        // Already stopped by a previous fade; nothing to do.
      }
    }
  }
}

export const soundEngine = new SoundEngine();
