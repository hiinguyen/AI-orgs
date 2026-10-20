"use client";

import type { Ref } from "react";
import { AlertTriangle } from "lucide-react";
import { isTerminalPhase } from "@/tasks/taskTypes";
import { pendingTasks } from "@/tasks/taskActions";
import { SimulationControls } from "@/components/controls/SimulationControls";
import { isAgentActive, useWorldStore } from "@/state/useWorldStore";
import { Logo, cn } from "@/components/ui";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[42px]">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 flex h-[18px] items-center text-[18px] font-semibold leading-none tabular-nums text-mist-100">
        {value}
      </p>
    </div>
  );
}

const STATUS_META = {
  running: { label: "Running", dot: "bg-ok text-ok pulse-dot" },
  paused: { label: "Paused", dot: "bg-warn" },
  ready: { label: "Ready", dot: "bg-mist-500" },
} as const;

export function TopBar({
  ref,
  className,
}: {
  ref?: Ref<HTMLElement>;
  className?: string;
}) {
  const agentCount = useWorldStore((state) => state.world?.agents.length ?? 6);
  const activeCount = useWorldStore((state) =>
    state.world ? state.world.agents.filter(isAgentActive).length : 0,
  );
  const pendingCount = useWorldStore((state) =>
    state.world ? pendingTasks(state.world.tasks).length : 0,
  );
  const completedCount = useWorldStore((state) =>
    state.world
      ? state.world.tasks.filter(
          (task) => task.status === "completed" && isTerminalPhase(task.phase),
        ).length
      : 0,
  );
  const status = useWorldStore((state) => state.simStatus);
  const backend = useWorldStore((state) => state.backend);

  const meta = STATUS_META[status];
  const live = !backend.simulated;
  const connectionLabel = backend.connected
    ? "connected"
    : backend.error
      ? "reconnecting"
      : "connecting";

  return (
    <header
      ref={ref}
      className={cn(
        "surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-3 py-2 md:px-4 md:py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-signal md:hidden">
          <Logo className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-mist-100">
            AI Agent World
          </h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-tight text-mist-500">
            {live && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  backend.connected ? "bg-ok" : "bg-warn",
                )}
              />
            )}
            <span className="truncate">
              {live
                ? `Live backend · ${connectionLabel}`
                : "Simulation mode · no live inference"}
            </span>
          </p>
        </div>
      </div>

      <div className="order-3 flex w-full items-center justify-between gap-4 sm:order-2 sm:w-auto sm:justify-start sm:gap-5">
        <Metric label="Agents" value={agentCount} />
        <Metric label="Active" value={activeCount} />
        <Metric label="Pending" value={pendingCount} />
        <Metric label="Completed" value={completedCount} />
        <div className="min-w-[64px]">
          <p className="eyebrow">Status</p>
          <span className="mt-1 flex h-[18px] items-center gap-1.5 text-[11.5px] font-medium leading-none text-mist-300">
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                meta.dot,
              )}
            />
            {meta.label}
          </span>
        </div>
      </div>

      <div className="order-2 ml-auto flex w-full min-w-0 max-w-full flex-wrap items-center justify-between gap-1.5 sm:order-3 sm:w-auto sm:justify-end">
        {backend.error && (
          <span
            className="flex max-w-[170px] items-center gap-1 rounded-full border border-bad/30 bg-bad/[0.08] px-2 py-1 text-[10px] leading-none text-bad"
            title={backend.error}
            role="status"
          >
            <AlertTriangle aria-hidden="true" size={11} className="shrink-0" />
            <span className="truncate">{backend.error}</span>
          </span>
        )}
        <SimulationControls />
      </div>
    </header>
  );
}
