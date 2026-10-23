"use client";

import {
  Profiler,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { connectBackend, commands } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { pickInitialQuality } from "@/state/qualityPolicy";
import {
  initReducedMotion,
  reducedMotion,
} from "@/state/reducedMotion";
import { CameraBar } from "@/components/controls/CameraBar";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { LoadingScreen } from "./LoadingScreen";
import { SidePanel } from "@/components/panels/SidePanel";
import { TaskDialog } from "@/components/panels/TaskDialog";
import { AgentLabelsOverlay } from "@/components/world/AgentLabelsOverlay";

const WorldCanvas = dynamic(
  () => import("@/world/WorldCanvas").then((module) => module.WorldCanvas),
  { ssr: false },
);

function handlePanelRender(): void {
  window.__AAW_SIDE_PANEL_RENDERS__ =
    (window.__AAW_SIDE_PANEL_RENDERS__ ?? 0) + 1;
}

function ignorePanelRender(): void {}

function subscribeToNothing(): () => void {
  return () => {};
}

function panelProbeOnClient(): boolean {
  return new URLSearchParams(window.location.search).has("debug");
}

function panelProbeOnServer(): boolean {
  return false;
}

/**
 * Read the `?debug` probe without a hydration mismatch: the server snapshot
 * is false, and React switches to the client snapshot after hydrating. The
 * first client render therefore matches the server markup.
 */
function usePanelRenderProbe(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    panelProbeOnClient,
    panelProbeOnServer,
  );
}

function PanelProfiler({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  // Always render the same element tree: switching between a fragment and a
  // Profiler would remount the side panel when the ?debug probe flips after
  // hydration. Only the measurement callback is gated.
  return (
    <Profiler
      id="side-panel"
      onRender={enabled ? handlePanelRender : ignorePanelRender}
    >
      {children}
    </Profiler>
  );
}

function pickInitialQualityFromBrowser(): {
  quality: "high" | "low";
  auto: boolean;
} {
  return pickInitialQuality({
    search: window.location.search,
    width: window.innerWidth,
    reducedMotion: reducedMotion.current,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
}

export function AppShell() {
  const sceneReady = useWorldStore((state) => state.sceneReady);
  const backendConnected = useWorldStore((state) => state.backend.connected);
  const panelProbe = usePanelRenderProbe();
  const navRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // The live reduced-motion flag must exist before the first quality pick:
    // it is one of the inputs to the low path decision.
    const stopReducedMotion = initReducedMotion();
    const initial = pickInitialQualityFromBrowser();
    useWorldStore.getState().setQuality(initial.quality, initial.auto);
    const stopBackend = connectBackend();
    return () => {
      stopReducedMotion();
      stopBackend();
    };
  }, []);

  useEffect(() => {
    if (!sceneReady || !backendConnected) return;
    void commands.autoStartIfReady();
  }, [sceneReady, backendConnected]);

  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      // Rects are viewport-relative, so they already include `.app-safe`
      // padding and the safe-area insets. The insets below are the covered
      // edges the camera fit has to avoid; do not add the padding again.
      const nav = navRef.current?.getBoundingClientRect();
      const top = topRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();

      const insets = {
        top: top ? Math.round(top.bottom) : 0,
        left: desktop && nav ? Math.round(nav.right) : 0,
        right: desktop && panel ? Math.round(width - panel.left) : 0,
        bottom: panel
          ? Math.round(
              desktop ? height - panel.bottom : height - panel.top,
            )
          : 0,
      };
      useWorldStore.getState().setViewInsets(insets);
    };

    const observer = new ResizeObserver(measure);
    for (const element of [navRef.current, topRef.current, panelRef.current]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", measure);
    measure();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const store = useWorldStore.getState();
      if (store.taskDialogOpen) return;

      // Escape never activates a focused control, so it must run before the
      // guard below. The Follow button keeps focus after it is clicked, and
      // that is exactly when the user presses Escape to release follow mode.
      const key = event.key.toLowerCase();
      if (key === "escape") {
        store.clearSelection();
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        // Never steal a key from a focused control: Space activates the
        // focused button, radio or tab instead of pausing the simulation.
        const interactive = target.closest(
          'button, a, [role="radio"], [role="tab"], [role="dialog"], input, textarea, select, [contenteditable]',
        );
        if (interactive !== null) return;
      }

      if (event.code === "Space" || key === " ") {
        event.preventDefault();
        if (store.simStatus === "running") {
          void commands.pause();
        } else {
          void commands.start();
        }
        return;
      }

      switch (key) {
        case "n":
          event.preventDefault();
          store.openTaskDialog();
          break;
        case "b":
          event.preventDefault();
          void commands.loadSprint();
          break;
        case "m":
          event.preventDefault();
          store.setSound({ enabled: !store.sound.enabled });
          break;
        case "escape":
          store.clearSelection();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink-950">
      <WorldCanvas />
      <AgentLabelsOverlay />

      <div className="app-safe pointer-events-none absolute inset-0 flex flex-col gap-2 md:flex-row md:gap-3">
        <NavRail
          ref={navRef}
          className="pointer-events-auto order-last md:order-first"
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:gap-3">
          <TopBar ref={topRef} className="pointer-events-auto" />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:flex-row md:gap-3">
            <div className="relative min-h-0 min-w-0 flex-1">
              <CameraBar className="pointer-events-auto absolute bottom-0 left-0 max-w-full" />
            </div>
            <PanelProfiler enabled={panelProbe}>
              <SidePanel ref={panelRef} className="pointer-events-auto" />
            </PanelProfiler>
          </div>
        </div>
      </div>

      <TaskDialog />
      <LoadingScreen />
    </main>
  );
}
