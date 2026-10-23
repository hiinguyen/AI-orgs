"use client";

import { useEffect } from "react";
import { getBackend } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { readSoundSettings, writeSoundSettings } from "./soundCues";
import type { StorageLike } from "./soundCues";
import { attachUnlockListeners, soundEngine } from "./soundEngine";
import type { SoundDebugSnapshot } from "./soundEngine";

declare global {
  interface Window {
    /** Sound cue counts for the phase checks; only installed with ?debug. */
    __AAW_SOUND__?: () => SoundDebugSnapshot;
  }
}

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function wantsDebugProbe(): boolean {
  return new URLSearchParams(window.location.search).has("debug");
}

/**
 * Mounted once in AppShell. Owns the engine lifecycle: persisted settings,
 * the gesture unlock, backend events and the running-state mirror.
 */
export function useSoundEffects(): void {
  useEffect(() => {
    const storage = browserStorage();
    const initial = readSoundSettings(storage);
    useWorldStore.getState().setSound(initial);
    soundEngine.configure(initial);
    soundEngine.setRunning(useWorldStore.getState().simStatus === "running");

    if (wantsDebugProbe()) {
      window.__AAW_SOUND__ = () => soundEngine.getDebugSnapshot();
    }

    // The context may only be created from a real gesture, and not every
    // gesture counts (Escape, touch pointerdown). The listeners stay until the
    // context is actually running.
    const detachUnlock = attachUnlockListeners(window, soundEngine);

    // A second subscriber on the backend bus: the store already receives the
    // event for its log, and this one turns it into a cue without touching
    // React state. Both are removed together on unmount.
    const unsubscribeEvents = getBackend().subscribe((event) => {
      soundEngine.play(event);
    });

    // Snapshots also pass through the store; reference checks keep the audio
    // mirror to actual sound or status changes.
    const unsubscribeStore = useWorldStore.subscribe((state, previous) => {
      if (state.sound !== previous.sound) {
        soundEngine.configure(state.sound);
        writeSoundSettings(storage, state.sound);
      }
      if (state.simStatus !== previous.simStatus) {
        soundEngine.setRunning(state.simStatus === "running");
      }
    });

    return () => {
      detachUnlock();
      unsubscribeEvents();
      unsubscribeStore();
      soundEngine.setRunning(false);
      if (wantsDebugProbe()) delete window.__AAW_SOUND__;
    };
  }, []);
}
