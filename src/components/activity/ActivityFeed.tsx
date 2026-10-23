"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { AgentId } from "@/agents/agentTypes";
import { getAgentProfile } from "@/agents/AgentRegistry";
import type { AgentEvent } from "@/events/eventTypes";
import {
  AgentAvatar,
  SystemAvatar,
  cn,
  formatClockTime,
  relativeTime,
} from "@/components/ui";

const SEVERITY_COLORS: Record<AgentEvent["severity"], string> = {
  info: "#7c8797",
  success: "var(--color-ok)",
  warning: "var(--color-warn)",
  error: "var(--color-bad)",
};

/**
 * The feed shows wall-clock relative times, so they must keep ageing while the
 * simulation is paused and the mirror has nothing to push. A one-second ticker
 * is enough; nothing here reads `liveWorld` at frame rate.
 */
function useRelativeNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

function ActivityRow({
  event,
  compact,
  now,
  onJump,
}: {
  event: AgentEvent;
  compact: boolean;
  now: number;
  onJump?: (agentId: AgentId) => void;
}) {
  const primary = event.agentId ?? event.targetAgentId;
  const sender = event.agentId ? getAgentProfile(event.agentId) : null;
  const target = event.targetAgentId
    ? getAgentProfile(event.targetAgentId)
    : null;

  const content = (
    <>
      <span className="mt-[1px] flex w-[22px] shrink-0 justify-center">
        {primary ? (
          <AgentAvatar agentId={primary} size={22} />
        ) : (
          <SystemAvatar size={22} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5">
          <span
            aria-hidden="true"
            className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: SEVERITY_COLORS[event.severity] }}
          />
          <span
            className={cn(
              "text-mist-300",
              compact
                ? "line-clamp-2 text-[11.5px] leading-[1.4]"
                : "text-[12px] leading-[1.45]",
            )}
          >
            {event.message}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[9.5px] uppercase tracking-[0.07em] text-mist-500">
          <span>
            {compact
              ? relativeTime(event.timestamp, now)
              : formatClockTime(event.timestamp)}
          </span>
          {sender && (
            <>
              <span aria-hidden="true">·</span>
              <span>{sender.name}</span>
            </>
          )}
          {target && (
            <>
              <ArrowRight aria-hidden="true" size={9} />
              <span>{target.name}</span>
            </>
          )}
          {!primary && (
            <>
              <span aria-hidden="true">·</span>
              <span>system</span>
            </>
          )}
          {event.feed === false && (
            <>
              <span aria-hidden="true">·</span>
              <span>background</span>
            </>
          )}
        </span>
      </span>
    </>
  );

  const classes = cn(
    "flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors",
    primary && onJump ? "hover:bg-white/[0.04]" : "cursor-default",
  );

  if (primary && onJump) {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => onJump(primary)}
        aria-label={`${event.message} - open ${getAgentProfile(primary).name}`}
      >
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}

export function ActivityFeed({
  events,
  onJump,
  compact = false,
  live = false,
  className,
}: {
  events: readonly AgentEvent[];
  onJump?: (agentId: AgentId) => void;
  compact?: boolean;
  /** Announce newly added rows to assistive tech; stable keys keep it quiet. */
  live?: boolean;
  className?: string;
}) {
  const now = useRelativeNow(compact);

  if (events.length === 0) {
    return (
      <p className={cn("py-2 text-[11.5px] text-mist-500", className)}>
        No activity yet.
      </p>
    );
  }

  return (
    <div
      role="log"
      aria-live={live ? "polite" : undefined}
      aria-relevant={live ? "additions" : undefined}
      aria-label={live ? "Activity feed" : undefined}
      className={cn("space-y-0.5", className)}
    >
      {events.map((event) => (
        <ActivityRow
          key={event.id}
          event={event}
          compact={compact}
          now={now}
          onJump={onJump}
        />
      ))}
    </div>
  );
}
