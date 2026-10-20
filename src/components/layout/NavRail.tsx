"use client";

import type { Ref } from "react";
import {
  Activity,
  Bot,
  LayoutGrid,
  ListChecks,
  Settings,
} from "lucide-react";
import { useWorldStore } from "@/state/useWorldStore";
import type { TabId } from "@/state/useWorldStore";
import { Logo, cn } from "@/components/ui";

const TABS: readonly {
  id: TabId;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

export function NavRail({
  ref,
  className,
}: {
  ref?: Ref<HTMLElement>;
  className?: string;
}) {
  const activeTab = useWorldStore((state) => state.activeTab);
  const setActiveTab = useWorldStore((state) => state.setActiveTab);

  return (
    <nav
      ref={ref}
      aria-label="Primary"
      className={cn(
        "surface flex shrink-0 flex-row items-center rounded-2xl px-1.5 py-1.5 md:w-[62px] md:flex-col md:px-1.5 md:py-2.5 xl:w-[64px]",
        className,
      )}
    >
      <div className="mb-2 hidden h-8 items-center justify-center text-mist-100 md:flex">
        <Logo className="h-6 w-6" />
      </div>

      <div className="flex w-full flex-1 flex-row items-center justify-around gap-0.5 md:flex-col md:justify-start md:gap-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={active ? "page" : undefined}
              aria-label={tab.label}
              title={tab.label}
              className={cn(
                "flex h-11 w-full flex-1 flex-col items-center justify-center gap-1 rounded-xl transition-colors md:h-auto md:flex-none md:gap-1.5 md:py-2",
                active
                  ? "bg-white/[0.07] text-mist-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "text-mist-500 hover:bg-white/[0.035] hover:text-mist-300",
              )}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
              <span
                className={cn(
                  "text-[9px] leading-none tracking-[0.01em]",
                  active ? "text-mist-100" : "text-mist-500",
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
