"use client";

import { useState } from "react";
import { Layers, Plus, Sparkles } from "lucide-react";
import type { Task } from "@/tasks/taskTypes";
import {
  filterTasks,
  sortTasksForList,
  taskCounts,
} from "@/tasks/taskActions";
import type { TaskFilter } from "@/tasks/taskActions";
import { commands } from "@/integrations/backendClient";
import { isBridgeBackend, isCapabilityEnabled } from "@/integrations/AgentBackend";
import { useWorldStore } from "@/state/useWorldStore";
import { SegmentedControl } from "@/components/ui";
import { TaskCard } from "./TaskCard";

const EMPTY_TASKS: readonly Task[] = [];

export function TasksPanel() {
  const tasks = useWorldStore((state) => state.world?.tasks ?? EMPTY_TASKS);
  const clock = useWorldStore((state) => state.world?.clock ?? 0);
  const selectedTaskId = useWorldStore((state) => state.selectedTaskId);
  const selectTask = useWorldStore((state) => state.selectTask);
  const openTaskDialog = useWorldStore((state) => state.openTaskDialog);
  const canSubmit = useWorldStore((state) =>
    isCapabilityEnabled(state.backend.capabilities, "submitTask"),
  );
  const bridgeMode = useWorldStore((state) =>
    isBridgeBackend(state.backend.simulated, state.backend.capabilities),
  );

  const [filter, setFilter] = useState<TaskFilter>("all");

  const counts = taskCounts(tasks);
  const visible = sortTasksForList(filterTasks(tasks, filter));

  return (
    <div className="px-4 py-3.5">
      {canSubmit && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost h-7 px-2 text-[11px]"
            onClick={() => openTaskDialog()}
          >
            <Plus aria-hidden="true" />
            New task
          </button>
          <button
            type="button"
            className="btn btn-ghost h-7 px-2 text-[11px]"
            onClick={() => {
              void commands.runDemo();
            }}
          >
            <Sparkles aria-hidden="true" />
            Demo
          </button>
          <button
            type="button"
            className="btn btn-ghost h-7 px-2 text-[11px]"
            onClick={() => {
              void commands.loadSprint();
            }}
          >
            <Layers aria-hidden="true" />
            Sprint
          </button>
        </div>
      )}

      <SegmentedControl
        className="mt-3 flex w-full"
        options={[
          { value: "all", label: `All ${counts.all}` },
          { value: "active", label: `Active ${counts.active}` },
          { value: "queued", label: `Queued ${counts.queued}` },
          { value: "done", label: `Done ${counts.done}` },
        ]}
        value={filter}
        onChange={setFilter}
        ariaLabel="Filter tasks"
        grow
      />

      <div className="mt-3 space-y-2">
        {visible.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            clock={clock}
            selected={task.id === selectedTaskId}
            onSelect={selectTask}
          />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="surface-quiet mt-3 px-3 py-4 text-center">
          <p className="text-[12px] leading-5 text-mist-500">
            {bridgeMode
              ? tasks.length === 0
                ? "No live work yet. Tasks appear when a Claude Code session receives a prompt or starts a subagent."
                : "No live tasks match this filter."
              : tasks.length === 0
                ? "No tasks yet. Run the demo or add one to watch the workflow move."
                : "No tasks match this filter."}
          </p>
          {tasks.length === 0 && canSubmit && (
            <button
              type="button"
              className="btn btn-primary mt-2.5"
              onClick={() => {
                void commands.runDemo();
              }}
            >
              <Sparkles aria-hidden="true" />
              Run demo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
