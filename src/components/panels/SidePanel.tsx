"use client";

import type { Ref } from "react";
import { ChevronLeft } from "lucide-react";
import { feedEvents } from "@/events/eventStore";
import { useWorldStore } from "@/state/useWorldStore";
import type { TabId } from "@/state/useWorldStore";
import { cn } from "@/components/ui";
import { ActivityPanel } from "./ActivityPanel";
import { AgentDetails } from "./AgentDetails";
import { AgentsPanel } from "./AgentsPanel";
import { OverviewPanel } from "./OverviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { TaskDetails } from "./TaskDetails";
import { TasksPanel } from "./TasksPanel";

const TITLES: Record<TabId, string> = {
  overview: "Overview",
  agents: "Agents",
  tasks: "Tasks",
  activity: "Live activity",
  settings: "Settings",
};

export function SidePanel({
  ref,
  className,
}: {
  ref?: Ref<HTMLElement>;
  className?: string;
}) {
  const activeTab = useWorldStore((state) => state.activeTab);
  const selectedAgentId = useWorldStore((state) => state.selectedAgentId);
  const selectedTaskId = useWorldStore((state) => state.selectedTaskId);
  const clearSelection = useWorldStore((state) => state.clearSelection);
  const events = useWorldStore((state) => state.events);

  const title = TITLES[activeTab];
  const drilled =
    (activeTab === "agents" && selectedAgentId !== null) ||
    (activeTab === "tasks" && selectedTaskId !== null);
  const feedCount = feedEvents(events).length;

  let content = null;
  switch (activeTab) {
    case "overview":
      content = <OverviewPanel />;
      break;
    case "agents":
      content = selectedAgentId ? (
        <AgentDetails agentId={selectedAgentId} />
      ) : (
        <AgentsPanel />
      );
      break;
    case "tasks":
      content = selectedTaskId ? (
        <TaskDetails taskId={selectedTaskId} />
      ) : (
        <TasksPanel />
      );
      break;
    case "activity":
      content = <ActivityPanel />;
      break;
    case "settings":
      content = <SettingsPanel />;
      break;
  }

  return (
    <aside
      ref={ref}
      aria-label={`${title} panel`}
      className={cn(
        "surface flex h-[40dvh] w-full shrink-0 flex-col overflow-hidden rounded-2xl md:h-auto md:w-[384px]",
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.05] px-3">
        {drilled && (
          <button
            type="button"
            className="btn btn-quiet -ml-1.5 h-7 w-7 px-0"
            onClick={clearSelection}
            aria-label={`Back to ${title}`}
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
        )}
        <h2 className="text-[13px] font-semibold tracking-tight text-mist-100">
          {title}
        </h2>
        {activeTab === "activity" && (
          <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.08em] text-mist-500">
            {feedCount} entries
          </span>
        )}
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {content}
      </div>
    </aside>
  );
}
