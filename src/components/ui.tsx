"use client";

import type { KeyboardEvent, ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Play,
  Signal,
} from "lucide-react";
import type { AgentId, AgentState } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { TaskPriority, TaskStatus } from "@/tasks/taskTypes";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/tasks/taskTypes";

export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <ellipse
        cx="16"
        cy="16"
        rx="12.4"
        ry="6.4"
        transform="rotate(-28 16 16)"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="12.4"
        ry="6.4"
        transform="rotate(28 16 16)"
        stroke="currentColor"
        strokeWidth="1.7"
        opacity="0.55"
      />
      <circle cx="16" cy="16" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function AgentAvatar({
  agentId,
  size = 28,
  className,
}: {
  agentId: AgentId;
  size?: number;
  className?: string;
}) {
  const agent = AGENT_BY_ID[agentId];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[9px] font-semibold leading-none text-[#071016] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: agent.color,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {agent.name.slice(0, 1)}
    </span>
  );
}

/**
 * The avatar slot for events that have no agent (boot, reset, speed changes).
 * Same footprint as an agent avatar so activity rows keep one vertical rhythm.
 */
export function SystemAvatar({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[9px] border border-white/[0.09] bg-white/[0.05] text-mist-500",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Logo className="h-[58%] w-[58%]" />
    </span>
  );
}

export function agentStatusLabel(agent: AgentState): string {
  if (agent.paused) return "Paused";
  switch (agent.status) {
    case "idle":
      return "Idle";
    case "walking":
      return "Moving";
    case "working":
      return "Working";
    case "thinking":
      return "Thinking";
    case "communicating":
      return "Communicating";
    case "success":
      return "Done";
    case "error":
      return "Error";
  }
}

export function agentStatusColor(agent: AgentState): string {
  if (agent.paused) return "var(--color-warn)";
  switch (agent.status) {
    case "idle":
      return "#7c8797";
    case "walking":
      return "var(--color-signal-strong)";
    case "working":
      return "var(--color-ok)";
    case "thinking":
      return "var(--color-signal)";
    case "communicating":
      return "#c4b5fd";
    case "success":
      return "var(--color-ok)";
    case "error":
      return "var(--color-bad)";
  }
}

export function AgentStatusPill({
  agent,
  className,
}: {
  agent: AgentState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] leading-none text-mist-300",
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: agentStatusColor(agent) }}
      />
      {agentStatusLabel(agent)}
    </span>
  );
}

const TASK_STATUS_CLASSES: Record<TaskStatus, string> = {
  queued: "border-white/10 bg-white/[0.04] text-mist-500",
  assigned: "border-signal/25 bg-signal/10 text-signal",
  in_progress: "border-signal/25 bg-signal/10 text-signal",
  testing: "border-ok/25 bg-ok/10 text-ok",
  review: "border-[#a78bfa]/30 bg-[#a78bfa]/10 text-[#c4b5fd]",
  blocked: "border-warn/30 bg-warn/10 text-warn",
  completed: "border-ok/30 bg-ok/10 text-ok",
  failed: "border-bad/30 bg-bad/10 text-bad",
};

export function TaskStatusBadge({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-[3px] text-[10px] font-medium leading-none tracking-[0.01em]",
        TASK_STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  critical: "text-bad",
  high: "text-warn",
  medium: "text-mist-300",
  low: "text-mist-500",
};

export function PriorityTag({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase leading-none tracking-[0.12em]",
        PRIORITY_CLASSES[priority],
      )}
      title={`${PRIORITY_LABELS[priority]} priority`}
    >
      <Signal aria-hidden="true" size={12} strokeWidth={2.2} />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-signal/35 bg-signal/10 px-1.5 py-[2px] font-mono text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-signal",
        className,
      )}
    >
      Demo
    </span>
  );
}

export function ProgressBar({
  value,
  color = "var(--color-signal)",
  className,
  label,
}: {
  value: number;
  color?: string;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn(
        "h-1 w-full overflow-hidden rounded-full bg-white/[0.08]",
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-linear"
        style={{ width: `${clamped * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  grow = false,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  grow?: boolean;
  className?: string;
}) {
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + options.length) % options.length;
    } else {
      return;
    }
    event.preventDefault();
    onChange(options[next].value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<
      HTMLButtonElement
    >('[role="radio"]');
    buttons?.[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-white/[0.07] bg-ink-950/60 p-0.5",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "segmented-option inline-flex items-center justify-center rounded-[6px] font-medium leading-none transition-colors max-[900px]:min-w-10",
              grow && "flex-1",
              size === "sm"
                ? "h-6 min-w-7 px-1.5 text-[11px]"
                : "h-7 min-w-8 px-2 text-[12px]",
              selected
                ? "bg-white/[0.1] text-mist-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-mist-500 hover:text-mist-300",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full md:h-5 md:w-9"
    >
      <span
        className={cn(
          "relative block h-5 w-9 rounded-full border transition-colors",
          checked
            ? "border-signal/40 bg-signal/70"
            : "border-white/10 bg-white/[0.06]",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-3.5 w-3.5 rounded-full bg-mist-100 shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-[left] duration-150",
            checked ? "left-[18px]" : "left-[2px]",
          )}
        />
      </span>
    </button>
  );
}

export function WorkflowMarker({
  state,
  color,
}: {
  state: "done" | "current" | "pending" | "failed";
  color?: string;
}) {
  if (state === "done") {
    return (
      <CheckCircle2
        aria-hidden="true"
        size={14}
        className="shrink-0 text-ok"
      />
    );
  }
  if (state === "failed") {
    return (
      <AlertCircle aria-hidden="true" size={14} className="shrink-0 text-bad" />
    );
  }
  if (state === "current") {
    return (
      <span
        aria-hidden="true"
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: color ?? "var(--color-signal)" }}
      >
        <Play size={7} className="text-ink-950" fill="currentColor" />
      </span>
    );
  }
  return (
    <Circle
      aria-hidden="true"
      size={14}
      className="shrink-0 text-mist-500/45"
    />
  );
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function simAgo(clock: number, at: number): string {
  const diff = Math.max(0, clock - at);
  if (diff < 1) return "now";
  if (diff < 60) return `${Math.round(diff)}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export function humanizeSignal(signal: string): string {
  return signal.replaceAll("_", " ");
}
