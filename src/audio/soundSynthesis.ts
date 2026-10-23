/**
 * Cue synthesis for the sound engine. Every voice is built from oscillators,
 * filtered noise and gain envelopes; there are no audio files. The engine
 * owns the shared noise buffer, so a cue only allocates what it plays.
 */
import type { CueId } from "./soundCues.ts";

const MAJOR_THIRD = 2 ** (4 / 12);
const PERFECT_FIFTH = 2 ** (7 / 12);

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E5_MAJOR = [E5, E5 * MAJOR_THIRD, E5 * PERFECT_FIFTH];
const MINOR_FALL = [440, 349.23, 293.66];

interface ToneOptions {
  type: OscillatorType;
  from: number;
  to?: number;
  /** Offset from the context's current time, seconds. */
  at?: number;
  duration: number;
  gain?: number;
  attack?: number;
}

interface NoiseOptions {
  from: number;
  to: number;
  at?: number;
  duration: number;
  gain?: number;
  attack?: number;
  filterType?: BiquadFilterType;
  q?: number;
}

interface VoiceOptions {
  context: AudioContext;
  destination: AudioNode;
  noiseBuffer: AudioBuffer;
  pitch: number;
}

/** Synthesises one cue into a destination node. */
export class CueVoice {
  private readonly context: AudioContext;
  private readonly destination: AudioNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly pitch: number;

  constructor(options: VoiceOptions) {
    this.context = options.context;
    this.destination = options.destination;
    this.noiseBuffer = options.noiseBuffer;
    this.pitch = options.pitch;
  }

  get speakerPitch(): number {
    return this.pitch;
  }

  tone(options: ToneOptions): void {
    const context = this.context;
    const start = context.currentTime + (options.at ?? 0);
    const duration = Math.max(0.02, options.duration);
    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.from, start);
    if (options.to !== undefined && options.to !== options.from) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.to),
        start + duration,
      );
    }

    const gain = context.createGain();
    envelope(
      gain.gain,
      start,
      duration,
      options.gain ?? 0.1,
      options.attack ?? 0.012,
    );

    oscillator.connect(gain);
    gain.connect(this.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise(options: NoiseOptions): void {
    const context = this.context;
    const start = context.currentTime + (options.at ?? 0);
    const duration = Math.max(0.02, options.duration);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = context.createBiquadFilter();
    filter.type = options.filterType ?? "bandpass";
    filter.frequency.setValueAtTime(Math.max(20, options.from), start);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, options.to),
      start + duration,
    );
    filter.Q.value = options.q ?? 1;

    const gain = context.createGain();
    envelope(
      gain.gain,
      start,
      duration,
      options.gain ?? 0.08,
      options.attack ?? 0.02,
    );

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

function envelope(
  gain: AudioParam,
  start: number,
  duration: number,
  peak: number,
  attack: number,
): void {
  const rise = Math.min(Math.max(0.001, attack), duration * 0.5);
  gain.setValueAtTime(0.0001, start);
  gain.linearRampToValueAtTime(peak, start + rise);
  gain.exponentialRampToValueAtTime(0.0001, start + duration);
}

/** One brown-ish noise buffer, built once when the context unlocks. */
export function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * 2));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[index] = last * 3.5;
  }
  return buffer;
}

type CueRenderer = (voice: CueVoice) => void;

const RENDERERS: Readonly<Record<CueId, CueRenderer>> = {
  taskCreated: (voice) => {
    voice.tone({ type: "sine", from: 880, duration: 0.1, gain: 0.12 });
    voice.tone({
      type: "sine",
      from: 1174,
      at: 0.11,
      duration: 0.12,
      gain: 0.12,
    });
  },
  ping: (voice) => {
    const pitch = voice.speakerPitch;
    voice.tone({ type: "triangle", from: pitch, duration: 0.11, gain: 0.1 });
    voice.tone({
      type: "triangle",
      from: pitch * PERFECT_FIFTH,
      at: 0.09,
      duration: 0.16,
      gain: 0.1,
    });
  },
  arpeggio: (voice) => {
    const pitch = voice.speakerPitch;
    [pitch, pitch * MAJOR_THIRD, pitch * PERFECT_FIFTH].forEach(
      (frequency, index) => {
        voice.tone({
          type: "triangle",
          from: frequency,
          at: index * 0.06,
          duration: 0.18,
          gain: 0.08,
        });
      },
    );
  },
  researchSweep: (voice) => {
    voice.noise({
      from: 600,
      to: 3200,
      duration: 0.42,
      gain: 0.08,
      attack: 0.06,
    });
    voice.tone({
      type: "sine",
      from: 660,
      to: 990,
      at: 0.02,
      duration: 0.36,
      gain: 0.05,
    });
  },
  keyboard: (voice) => {
    for (let index = 0; index < 6; index += 1) {
      voice.noise({
        from: 1800,
        to: 1500,
        at: index * 0.045,
        duration: 0.028,
        gain: 0.05,
        attack: 0.002,
        q: 2,
      });
    }
  },
  whoosh: (voice) => {
    voice.noise({
      from: 300,
      to: 4000,
      duration: 0.4,
      gain: 0.09,
      attack: 0.1,
    });
  },
  successChime: (voice) => {
    E5_MAJOR.forEach((frequency, index) => {
      voice.tone({
        type: "triangle",
        from: frequency,
        at: index * 0.09,
        duration: 0.32,
        gain: 0.09,
      });
    });
  },
  errorBuzz: (voice) => {
    voice.tone({
      type: "sawtooth",
      from: 220,
      to: 150,
      duration: 0.28,
      gain: 0.07,
    });
    voice.tone({
      type: "square",
      from: 165,
      to: 110,
      duration: 0.28,
      gain: 0.06,
    });
  },
  fanfare: (voice) => {
    [C5, E5, G5, C6].forEach((frequency, index) => {
      voice.tone({
        type: "triangle",
        from: frequency,
        at: index * 0.11,
        duration: 0.2,
        gain: 0.09,
      });
    });
    voice.tone({
      type: "triangle",
      from: C6,
      at: 0.44,
      duration: 0.85,
      gain: 0.05,
    });
  },
  failure: (voice) => {
    voice.tone({
      type: "sine",
      from: 110,
      to: 55,
      duration: 0.4,
      gain: 0.16,
    });
    voice.noise({
      from: 320,
      to: 120,
      duration: 0.32,
      gain: 0.06,
      filterType: "lowpass",
    });
    MINOR_FALL.forEach((frequency, index) => {
      voice.tone({
        type: "triangle",
        from: frequency,
        at: 0.08 + index * 0.11,
        duration: 0.16,
        gain: 0.07,
      });
    });
  },
  downBlips: (voice) => {
    voice.tone({ type: "square", from: 440, duration: 0.07, gain: 0.06 });
    voice.tone({
      type: "square",
      from: 330,
      at: 0.08,
      duration: 0.07,
      gain: 0.06,
    });
  },
  upBlips: (voice) => {
    voice.tone({ type: "square", from: 330, duration: 0.07, gain: 0.06 });
    voice.tone({
      type: "square",
      from: 440,
      at: 0.08,
      duration: 0.07,
      gain: 0.06,
    });
  },
  rise: (voice) => {
    voice.tone({
      type: "sine",
      from: 220,
      to: 440,
      duration: 0.32,
      gain: 0.08,
    });
  },
  fall: (voice) => {
    voice.tone({
      type: "sine",
      from: 440,
      to: 220,
      duration: 0.32,
      gain: 0.08,
    });
  },
  resetSweep: (voice) => {
    voice.noise({
      from: 3000,
      to: 120,
      duration: 0.45,
      gain: 0.08,
      attack: 0.03,
    });
  },
  footstep: (voice) => {
    voice.tone({
      type: "sine",
      from: 90,
      to: 60,
      duration: 0.14,
      gain: 0.2,
    });
  },
  spawn: (voice) => {
    // A soft rising two-note blip: a new subagent joined the floor.
    voice.tone({ type: "sine", from: 587.33, duration: 0.08, gain: 0.05 });
    voice.tone({
      type: "sine",
      from: 880,
      at: 0.08,
      duration: 0.14,
      gain: 0.05,
    });
  },
  despawn: (voice) => {
    // The mirror image, quieter, so a busy floor of agents stays calm.
    voice.tone({ type: "sine", from: 783.99, duration: 0.08, gain: 0.045 });
    voice.tone({
      type: "sine",
      from: 523.25,
      at: 0.08,
      duration: 0.16,
      gain: 0.045,
    });
  },
};

/** Play one cue. Pitch only matters to the pings and the triad arpeggio. */
export function renderCue(cue: CueId, voice: CueVoice): void {
  RENDERERS[cue](voice);
}
