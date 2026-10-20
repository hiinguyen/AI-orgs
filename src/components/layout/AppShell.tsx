"use client";

import { useEffect, useRef } from "react";
import { connectBackend, commands } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { CameraBar } from "@/components/controls/CameraBar";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { LoadingScreen } from "./LoadingScreen";
import { SidePanel } from "@/components/panels/SidePanel";
import { TaskDialog } from "@/components/panels/TaskDialog";
import { WorldPlaceholder } from "./WorldPlaceholder";

function pickInitialQuality(): { quality: "high" | "low"; auto: boolean } {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("quality");
  if (forced === "high" || forced === "low") {
    return { quality: forced, auto: false };
  }
  const lowByDevice =
    window.innerWidth < 768 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    (navigator.hardwareConcurrency ?? 8) <= 4;
  return { quality: lowByDevice ? "low" : "high", auto: true };
}

export function AppShell() {
  const sceneReady = useWorldStore((state) => state.sceneReady);
  const navRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const initial = pickInitialQuality();
    useWorldStore.getState().setQuality(initial.quality, initial.auto);
    return connectBackend();
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    void commands.autoStartIfReady();
  }, [sceneReady]);

  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const desktop = window.matchMedia("(min-width: 768px)").matches;
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

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const key = event.key.toLowerCase();
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
      <WorldPlaceholder />

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 p-2 md:flex-row md:gap-3 md:p-3">
        <NavRail
          ref={navRef}
          className="pointer-events-auto order-last md:order-first"
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:gap-3">
          <TopBar ref={topRef} className="pointer-events-auto" />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:flex-row md:gap-3">
            <div className="relative min-h-0 min-w-0 flex-1">
              <CameraBar className="pointer-events-auto absolute bottom-0 left-0" />
            </div>
            <SidePanel ref={panelRef} className="pointer-events-auto" />
          </div>
        </div>
      </div>

      <TaskDialog />
      <LoadingScreen />
    </main>
  );
}
