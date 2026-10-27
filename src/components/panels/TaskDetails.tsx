"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Lightbulb,
  LocateFixed,
  PauseCircle,
} from "lucide-react";
import { getAgentProfile } from "@/agents/AgentRegistry";
import { PHASE_LABELS } from "@/tasks/taskTypes";
import { useWorldStore } from "@/state/useWorldStore";
import {
  DemoTag,
  PriorityTag,
  ProgressBar,
  TaskStatusBadge,
  WorkflowMarker,
  cn,
  humanizeSignal,
} from "@/components/ui";
import {
  taskProgressColor,
  workflowRows,
} from "./taskWorkflow";

export function TaskDetails({ taskId }: { taskId: string }) {
  const task = useWorldStore((state) =>
    state.world?.tasks.find((entry) => entry.id === taskId),
  );
  const focusAgent = useWorldStore((state) => state.focusAgent);
  const simulated = useWorldStore((state) => state.backend.simulated);

  if (!task) {
    return (
      <div className="px-4 py-4">
        <p className="text-[12px] leading-5 text-mist-500">
          This task is no longer in the world. A reset may have cleared it.
        </p>
      </div>
    );
  }

  const owner = task.assignedAgentId
    ? getAgentProfile(task.assignedAgentId)
    : null;
  const rows = workflowRows(task);
  const progressColor = taskProgressColor(task);

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10.5px] font-medium text-mist-500">
          {task.id}
        </span>
        <TaskStatusBadge status={task.status} />
        {task.isDemo && <DemoTag />}
        <span className="ml-auto">
          <PriorityTag priority={task.priority} />
        </span>
      </div>

      <h3 className="mt-2 text-[16px] font-semibold leading-snug tracking-tight text-mist-100">
        {task.title}
      </h3>

      {task.description.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-5 text-mist-300">
          {task.description}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2.5">
        <ProgressBar
          value={task.progress}
          color={progressColor}
          label={`${task.title} progress`}
        />
        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-mist-500">
          {Math.round(task.progress * 100)}%
        </span>
      </div>

      {owner && (
        <button
          type="button"
          className="btn btn-ghost mt-2.5"
          onClick={() => focusAgent(owner.id)}
        >
          <LocateFixed aria-hidden="true" />
          Locate {owner.name}
        </button>
      )}

      {task.status === "blocked" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/[0.08] px-3 py-2 text-[11.5px] leading-4 text-warn">
          <PauseCircle aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          <p>
            Blocked - {task.blockedReason ?? "the owner is paused"}. Resume the
            agent to continue this task.
          </p>
        </div>
      )}

      {task.phase === "failed" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-bad/25 bg-bad/[0.08] px-3 py-2 text-[11.5px] leading-4 text-bad">
          <AlertTriangle
            aria-hidden="true"
            size={14}
            className="mt-0.5 shrink-0"
          />
          <p>
            {simulated
              ? `Failed after ${Math.max(1, task.iteration)} ${
                  task.iteration === 1 ? "iteration" : "iterations"
                }. QA or review kept rejecting the work, so the orchestrator stopped it.`
              : `Failed - ${task.blockedReason ?? "the agent stopped with an error or lost contact."}`}
          </p>
        </div>
      )}

      <div className="my-3.5 h-px bg-white/[0.06]" />

      {simulated ? (
        <>
          <p className="eyebrow">Workflow</p>
          <ol className="mt-1.5 space-y-0.5">
            {rows.map((row) => {
              const rowOwner = row.ownerId ? getAgentProfile(row.ownerId) : null;
              const active = row.state === "current" || row.state === "failed";
              return (
                <li
                  key={row.phase}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    active && "bg-white/[0.05]",
                  )}
                >
                  <WorkflowMarker
                    state={row.state}
                    color={
                      row.state === "failed"
                        ? "var(--color-bad)"
                        : rowOwner?.color
                    }
                  />
                  <span
                    className={cn(
                      "text-[12px] leading-none",
                      row.state === "pending" && "text-mist-500",
                      row.state === "failed" && "text-bad",
                      (row.state === "done" || row.state === "current") &&
                        "text-mist-100",
                    )}
                  >
                    {PHASE_LABELS[row.phase]}
                  </span>
                  <span
                    className="ml-auto text-[11px] leading-none"
                    style={{
                      color:
                        row.state === "failed"
                          ? "var(--color-bad)"
                          : active && rowOwner
                            ? rowOwner.color
                            : "var(--color-mist-500)",
                    }}
                  >
                    {rowOwner?.name ?? ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <p className="eyebrow">Live work</p>
          <p className="mt-1.5 text-[11.5px] leading-4 text-mist-500">
            Reported by Claude Code hooks. The task is done when its agent
            reports back or the session stops; there is no scripted workflow.
          </p>
        </>
      )}

      {simulated && task.iteration > 1 && (
        <p className="mt-2.5 text-[11px] leading-4 text-warn">
          Reworked {task.iteration - 1}× after QA/review feedback.
        </p>
      )}

      {task.subtasks.length > 0 && (
        <>
          <div className="my-3.5 h-px bg-white/[0.06]" />

          <p className="eyebrow">Task cards · {task.subtasks.length}</p>
          <ul className="mt-1.5 space-y-1.5">
            {task.subtasks.map((subtask) => (
              <li
                key={subtask.id}
                className="flex items-start gap-2 text-[11.5px] leading-4"
              >
                {subtask.done ? (
                  <CheckCircle2
                    aria-hidden="true"
                    size={13}
                    className="mt-[1px] shrink-0 text-ok"
                  />
                ) : (
                  <Circle
                    aria-hidden="true"
                    size={13}
                    className="mt-[1px] shrink-0 text-mist-500/50"
                  />
                )}
                <span
                  className={
                    subtask.done ? "text-mist-300" : "text-mist-500"
                  }
                >
                  {subtask.title}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {task.findings.length > 0 && (
        <>
          <div className="my-3.5 h-px bg-white/[0.06]" />

          <p className="eyebrow">
            {simulated ? "Research findings" : "Reported back"}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {task.findings.map((finding) => (
              <li
                key={finding}
                className="flex items-start gap-2 text-[11.5px] leading-[1.45] text-mist-300"
              >
                <Lightbulb
                  aria-hidden="true"
                  size={13}
                  className="mt-[1px] shrink-0 text-mist-500"
                />
                <span>{finding}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="my-3.5 h-px bg-white/[0.06]" />

      <p className="eyebrow">Timeline</p>
      {task.history.length > 0 ? (
        <ol className="mt-1.5 space-y-2">
          {task.history.map((entry, index) => (
            <li
              key={`${entry.signal}-${entry.at}-${index}`}
              className="flex items-start gap-2"
            >
              <span
                aria-hidden="true"
                className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-mist-500"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] leading-4 text-mist-300">
                    {PHASE_LABELS[entry.from]} → {PHASE_LABELS[entry.to]}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-mist-500">
                    {entry.at.toFixed(1)}s
                  </span>
                </span>
                <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-mist-500">
                  {humanizeSignal(entry.signal)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-mist-500">
          Waiting for the orchestrator.
        </p>
      )}

      <p className="mt-4 border-t border-white/[0.06] pt-2.5 text-[9.5px] leading-4 text-mist-500">
        {simulated
          ? "Simulated output from canned templates - no model inference."
          : "Details reported by the connected service."}
      </p>
    </div>
  );
}
