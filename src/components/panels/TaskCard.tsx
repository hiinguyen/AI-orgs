"use client";

import { getAgentProfile } from "@/agents/AgentRegistry";
import type { Task } from "@/tasks/taskTypes";
import { PHASE_LABELS } from "@/tasks/taskTypes";
import {
  AgentAvatar,
  DemoTag,
  PriorityTag,
  ProgressBar,
  TaskStatusBadge,
  cn,
  simAgo,
} from "@/components/ui";
import { taskProgressColor } from "./taskWorkflow";

export function TaskCard({
  task,
  clock,
  selected,
  compact = false,
  onSelect,
}: {
  task: Task;
  clock: number;
  selected: boolean;
  compact?: boolean;
  onSelect: (taskId: string) => void;
}) {
  const owner = task.assignedAgentId
    ? getAgentProfile(task.assignedAgentId)
    : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-label={`Open task ${task.id}: ${task.title}`}
      className={cn(
        "group w-full rounded-xl border text-left transition-colors",
        compact ? "p-2.5" : "p-3",
        selected
          ? "border-signal/45 bg-signal/[0.06]"
          : "border-white/[0.07] bg-ink-900/40 hover:border-signal/25 hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-medium text-mist-500">
          {task.id}
        </span>
        {task.isDemo && <DemoTag />}
        <TaskStatusBadge status={task.status} />
        <span className="ml-auto pl-1">
          <PriorityTag priority={task.priority} />
        </span>
      </span>

      <span
        className={cn(
          "mt-1.5 block font-medium leading-snug text-mist-100",
          compact
            ? "line-clamp-2 text-[12px]"
            : "line-clamp-2 text-[13px]",
        )}
      >
        {task.title}
      </span>

      {!compact && task.description.length > 0 && (
        <span className="mt-1 line-clamp-2 block text-[11.5px] leading-[1.45] text-mist-500">
          {task.description}
        </span>
      )}

      <ProgressBar
        value={task.progress}
        color={taskProgressColor(task)}
        label={`${task.title} progress`}
        className="mt-2.5"
      />

      <span className="mt-2 flex items-center gap-1.5 text-[10.5px] text-mist-500">
        {owner ? (
          <>
            <AgentAvatar agentId={owner.id} size={17} />
            <span className="font-medium text-mist-300">{owner.name}</span>
            <span aria-hidden="true">·</span>
            <span>{PHASE_LABELS[task.phase]}</span>
          </>
        ) : (
          <span>Waiting for orchestrator</span>
        )}
        {task.iteration > 1 && (
          <span className="text-warn" title="Implementation attempts">
            Rework {task.iteration - 1}×
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-[0.04em]">
          {simAgo(clock, task.updatedAt)}
        </span>
      </span>
    </button>
  );
}
