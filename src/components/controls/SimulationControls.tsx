"use client";

import { useEffect, useRef, useState } from "react";
import {
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { commands } from "@/integrations/backendClient";
import { SIMULATION_CONFIG } from "@/simulation/simulationConfig";
import { useWorldStore } from "@/state/useWorldStore";
import { SegmentedControl, cn } from "@/components/ui";

export function SimulationControls() {
  const simStatus = useWorldStore((state) => state.simStatus);
  const speed = useWorldStore((state) => state.speed);
  const soundEnabled = useWorldStore((state) => state.sound.enabled);
  const setSound = useWorldStore((state) => state.setSound);
  const openTaskDialog = useWorldStore((state) => state.openTaskDialog);

  const [confirmReset, setConfirmReset] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  useEffect(() => {
    if (confirmReset || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    resetButtonRef.current?.focus();
  }, [confirmReset]);

  const running = simStatus === "running";
  const runLabel = running
    ? "Pause"
    : simStatus === "paused"
      ? "Resume"
      : "Start";
  const RunIcon = running ? Pause : Play;

  const speedOptions = SIMULATION_CONFIG.speeds.map((value) => ({
    value: String(value),
    label: `${value}x`,
  }));
  if (!SIMULATION_CONFIG.speeds.some((value) => value === speed)) {
    speedOptions.push({ value: String(speed), label: `${speed}x` });
  }

  const handleRunToggle = () => {
    if (running) {
      void commands.pause();
    } else {
      void commands.start();
    }
  };

  const handleConfirmReset = async () => {
    returnFocusRef.current = true;
    setConfirmReset(false);
    await commands.reset();
    const store = useWorldStore.getState();
    store.clearSelection();
    store.closeTaskDialog();
    store.setActiveTab("overview");
  };

  const cancelReset = () => {
    returnFocusRef.current = true;
    setConfirmReset(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
      <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          className="btn btn-ghost w-8 px-0 xl:w-auto xl:px-2.5"
          onClick={handleRunToggle}
          aria-label={`${runLabel} simulation`}
        >
          <RunIcon aria-hidden="true" />
          <span className="hidden xl:inline">{runLabel}</span>
        </button>

        <SegmentedControl
          options={speedOptions}
          value={String(speed)}
          onChange={(value) => {
            void commands.setSpeed(Number(value));
          }}
          ariaLabel="Simulation speed"
        />

        <button
          type="button"
          className={cn(
            "btn btn-quiet h-8 w-8 px-0",
            !soundEnabled && "text-warn",
          )}
          onClick={() => setSound({ enabled: !soundEnabled })}
          aria-pressed={!soundEnabled}
          aria-label={soundEnabled ? "Mute sound" : "Unmute sound"}
          title="Mute (M)"
        >
          {soundEnabled ? (
            <Volume2 aria-hidden="true" />
          ) : (
            <VolumeX aria-hidden="true" />
          )}
        </button>

        {confirmReset ? (
          <div
            role="group"
            aria-label="Confirm reset"
            className="flex items-center gap-0.5 rounded-lg border border-warn/30 bg-warn/[0.08] px-1.5"
          >
            <button
              type="button"
              autoFocus
              className="btn btn-quiet h-7 px-1.5 text-[10.5px] text-warn"
              onClick={() => {
                void handleConfirmReset();
              }}
            >
              Confirm reset
            </button>
            <button
              type="button"
              className="btn btn-quiet h-7 px-1.5 text-[10.5px]"
              onClick={cancelReset}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            ref={resetButtonRef}
            type="button"
            className="btn btn-ghost w-8 px-0 xl:w-auto xl:px-2.5"
            onClick={() => setConfirmReset(true)}
            aria-label="Reset simulation"
          >
            <RotateCcw aria-hidden="true" />
            <span className="hidden xl:inline">Reset</span>
          </button>
        )}
      </div>

      <span
        aria-hidden="true"
        className="mx-0.5 hidden h-5 w-px bg-white/[0.08] sm:block"
      />

      {/* On phones the actions wrap as one deliberate row instead of leaving
          the primary button alone on a line of its own. */}
      <div className="flex items-center gap-0.5 max-sm:w-full max-sm:justify-between sm:gap-1">
        <button
          type="button"
          className="btn btn-ghost w-8 px-0 xl:w-auto xl:px-2.5"
          onClick={() => {
            void commands.runDemo();
          }}
          aria-label="Run demo"
          title="Run demo"
        >
          <Sparkles aria-hidden="true" />
          <span className="hidden xl:inline">Run demo</span>
        </button>

        <button
          type="button"
          className="btn btn-ghost w-8 px-0 xl:w-auto xl:px-2.5"
          onClick={() => {
            void commands.loadSprint();
          }}
          aria-label="Load sprint"
          title="Load sprint"
        >
          <Layers aria-hidden="true" />
          <span className="hidden xl:inline">Load sprint</span>
        </button>

        <button
          type="button"
          className="btn btn-primary w-8 px-0 sm:w-auto sm:px-2.5"
          onClick={() => openTaskDialog()}
          aria-label="New task"
        >
          <Plus aria-hidden="true" />
          <span className="hidden sm:inline">New task</span>
        </button>
      </div>
    </div>
  );
}
