"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useWorldStore } from "@/state/useWorldStore";
import type { CameraPresetId } from "@/state/useWorldStore";
import type { ViewMode } from "@/state/viewMode";
import { SegmentedControl, cn } from "@/components/ui";

const VIEW_OPTIONS: readonly { value: ViewMode; label: string; title: string }[] =
  [
    { value: "3d", label: "3D", title: "3D office view" },
    { value: "2d", label: "2D", title: "2D floor plan" },
  ];

const PRESETS: readonly {
  id: CameraPresetId;
  label: string;
  short: string;
}[] = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "hub", label: "Operations Hub", short: "Ops Hub" },
  { id: "research", label: "Research", short: "Research" },
  { id: "development", label: "Development", short: "Dev" },
  { id: "collaboration", label: "Collaboration", short: "Collab" },
];

export function CameraBar({ className }: { className?: string }) {
  const camera = useWorldStore((state) => state.camera);
  const requestCamera = useWorldStore((state) => state.requestCamera);
  const viewMode = useWorldStore((state) => state.viewMode);
  const setViewMode = useWorldStore((state) => state.setViewMode);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <nav
      aria-label="World view and camera presets"
      className={cn(
        "surface scroll-thin flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1",
        className,
      )}
    >
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={viewMode}
        onChange={setViewMode}
        ariaLabel="World view"
        className="shrink-0 border-white/[0.09] bg-ink-950/70"
      />
      <span
        aria-hidden="true"
        className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.1]"
      />
      {PRESETS.map((preset) => {
        const active = camera.preset === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            aria-label={preset.label}
            title={preset.label}
            onClick={() => requestCamera({ preset: preset.id })}
            className={cn(
              "camera-preset shrink-0 rounded-full px-2 py-1.5 text-[10.5px] leading-none transition-colors sm:px-3 sm:text-[11px]",
              active
                ? "bg-white/[0.12] text-mist-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-mist-500 hover:bg-white/[0.04] hover:text-mist-100",
            )}
          >
            <span className="sm:hidden">{preset.short}</span>
            <span className="hidden sm:inline">{preset.label}</span>
          </button>
        );
      })}
      <span
        aria-hidden="true"
        className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.1]"
      />
      <button
        type="button"
        className="btn btn-quiet h-7 w-7 shrink-0 px-0"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {fullscreen ? (
          <Minimize2 aria-hidden="true" size={14} />
        ) : (
          <Maximize2 aria-hidden="true" size={14} />
        )}
      </button>
    </nav>
  );
}
