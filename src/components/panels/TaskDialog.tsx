"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Shuffle, Sparkles, X } from "lucide-react";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { commands } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { DEMO_TASK } from "@/tasks/taskActions";
import {
  pickRandomTask,
  TASK_BACKLOG,
  TASK_SUGGESTIONS,
} from "@/tasks/taskBacklog";
import type { CreateTaskInput, TaskPriority } from "@/tasks/taskTypes";
import { PRIORITY_LABELS } from "@/tasks/taskTypes";
import { SegmentedControl } from "@/components/ui";

function suggestionInput(title: string): CreateTaskInput {
  if (title === DEMO_TASK.title) return DEMO_TASK;
  return TASK_BACKLOG.find((task) => task.title === title) ?? DEMO_TASK;
}

function TaskDialogForm({
  preferredAgentId,
}: {
  preferredAgentId: AgentId | null;
}) {
  const closeDialog = useWorldStore((state) => state.closeTaskDialog);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      titleRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [closeDialog]);

  const fill = (input: CreateTaskInput) => {
    setTitle(input.title);
    setDescription(input.description ?? "");
    setPriority(input.priority ?? "medium");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0 || submitting) return;

    setSubmitting(true);
    const input: CreateTaskInput = {
      title: trimmed,
      description: description.trim() || undefined,
      priority,
      ...(preferredAgentId ? { preferredAgentId } : {}),
    };
    const task = await commands.submitTask(input);
    setSubmitting(false);
    if (!task) return;

    const store = useWorldStore.getState();
    closeDialog();
    store.selectTask(task.id);
    store.requestCamera({ preset: "collaboration" });
    if (store.simStatus === "ready") {
      void commands.start();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        aria-describedby="task-dialog-note"
        className="surface scroll-thin max-h-[calc(100dvh-2rem)] w-full max-w-[460px] overflow-y-auto rounded-2xl"
      >
        <form onSubmit={handleSubmit}>
          <header className="flex items-start justify-between gap-3 px-5 pt-4">
            <div>
              <p className="eyebrow text-signal">New task</p>
              <h2
                id="task-dialog-title"
                className="mt-1.5 text-[17px] font-semibold tracking-tight text-mist-100"
              >
                Give the team something to ship
              </h2>
            </div>
            <button
              type="button"
              className="btn btn-quiet -mr-1.5 -mt-1 h-7 w-7 px-0"
              onClick={closeDialog}
              aria-label="Close dialog"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </header>

          <div className="px-5 pb-4 pt-3">
            <p className="eyebrow">Suggestions</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TASK_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chip max-w-full"
                  title={suggestion}
                  onClick={() => fill(suggestionInput(suggestion))}
                >
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <label
                htmlFor="task-title"
                className="mb-1.5 block text-[11px] font-medium text-mist-300"
              >
                Title
              </label>
              <input
                id="task-title"
                ref={titleRef}
                className="field"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Build a user authentication API with JWT support"
                autoComplete="off"
                required
                maxLength={140}
              />
            </div>

            <div className="mt-3">
              <label
                htmlFor="task-description"
                className="mb-1.5 block text-[11px] font-medium text-mist-300"
              >
                Description
                <span className="ml-1 font-normal text-mist-500">
                  optional
                </span>
              </label>
              <textarea
                id="task-description"
                className="field min-h-[76px] resize-y"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What should change, and what does done look like?"
                rows={3}
                maxLength={600}
              />
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-medium text-mist-300">
                Priority
              </p>
              <SegmentedControl
                className="flex w-full"
                options={(
                  ["low", "medium", "high", "critical"] as const
                ).map((value) => ({
                  value,
                  label: PRIORITY_LABELS[value],
                }))}
                value={priority}
                onChange={setPriority}
                ariaLabel="Task priority"
                grow
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn btn-ghost h-7 px-2 text-[11px]"
                onClick={() => fill(DEMO_TASK)}
              >
                <Sparkles aria-hidden="true" />
                Use demo task
              </button>
              <button
                type="button"
                className="btn btn-ghost h-7 px-2 text-[11px]"
                onClick={() => fill(pickRandomTask([title]))}
              >
                <Shuffle aria-hidden="true" />
                Surprise me
              </button>
            </div>

            {preferredAgentId && (
              <p className="mt-3 rounded-lg border border-signal/20 bg-signal/[0.06] px-2.5 py-2 text-[11px] leading-4 text-mist-300">
                Requested from{" "}
                {AGENT_BY_ID[preferredAgentId].name} - routed via the
                Orchestrator so the full workflow still applies.
              </p>
            )}
          </div>

          <footer className="flex flex-col gap-2.5 border-t border-white/[0.06] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              id="task-dialog-note"
              className="max-w-[250px] text-[9.5px] leading-4 text-mist-500"
            >
              Simulation mode - agents act out the workflow; no AI inference
              or code execution happens.
            </p>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={title.trim().length === 0 || submitting}
              >
                {submitting ? "Submitting..." : "Submit task"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function TaskDialog() {
  const open = useWorldStore((state) => state.taskDialogOpen);
  const preferredAgentId = useWorldStore((state) => state.preferredAgentId);

  if (!open) return null;
  return <TaskDialogForm preferredAgentId={preferredAgentId} />;
}
