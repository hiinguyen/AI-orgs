"use client";

import { useState } from "react";
import {
  Crosshair,
  Eye,
  EyeOff,
  PauseCircle,
  PlayCircle,
  UserPlus,
} from "lucide-react";
import type { AgentId } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { AgentEvent } from "@/events/eventTypes";
import { isAgentCommunication } from "@/events/eventTypes";
import { eventsForAgent } from "@/events/eventStore";
import { LOCATIONS } from "@/simulation/worldLayout";
import { commands } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import {
  AgentAvatar,
  AgentStatusPill,
  ProgressBar,
  SegmentedControl,
  cn,
} from "@/components/ui";

const EMPTY_EVENTS: readonly AgentEvent[] = [];

export function AgentDetails({ agentId }: { agentId: AgentId }) {
  const agent = useWorldStore((state) =>
    state.world?.agents.find((entry) => entry.id === agentId),
  );
  const tasks = useWorldStore((state) => state.world?.tasks);
  const events = useWorldStore((state) => state.events ?? EMPTY_EVENTS);
  const followAgentId = useWorldStore((state) => state.followAgentId);
  const setFollowAgent = useWorldStore((state) => state.setFollowAgent);
  const focusAgent = useWorldStore((state) => state.focusAgent);
  const selectTask = useWorldStore((state) => state.selectTask);
  const openTaskDialog = useWorldStore((state) => state.openTaskDialog);

  const [view, setView] = useState<"activity" | "communication">("activity");

  const profile = AGENT_BY_ID[agentId];
  if (!agent) {
    return (
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <AgentAvatar agentId={agentId} size={44} />
          <div>
            <h3 className="text-[17px] font-semibold leading-tight text-mist-100">
              {profile.name}
            </h3>
            <p className="text-[11.5px] text-mist-500">{profile.roleLabel}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-mist-500">
          Waiting for the backend snapshot.
        </p>
      </div>
    );
  }

  const currentTask =
    tasks?.find((task) => task.id === agent.currentTaskId) ?? null;
  const following = followAgentId === agent.id;

  const locationLabel = agent.location
    ? LOCATIONS[agent.location].label
    : "In the office";
  const locationText =
    agent.destination && agent.status === "walking"
      ? `Walking to ${LOCATIONS[agent.destination].label}`
      : locationLabel;

  const agentEvents = eventsForAgent(events, agent.id);
  const agentCommunication = agentEvents.filter(isAgentCommunication);
  const shown =
    view === "activity" ? agentEvents : agentCommunication;

  const togglePause = () => {
    if (agent.paused) {
      void commands.resumeAgent(agent.id);
    } else {
      void commands.pauseAgent(agent.id);
    }
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <AgentAvatar agentId={agent.id} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[17px] font-semibold leading-tight tracking-tight text-mist-100">
              {profile.name}
            </h3>
            <span className="truncate text-[10.5px] uppercase tracking-[0.12em] text-mist-500">
              {profile.roleLabel}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-mist-300">
            {profile.tagline}
          </p>
        </div>
        <AgentStatusPill agent={agent} className="mt-1 shrink-0" />
      </div>

      <div className="surface-quiet mt-3 p-3">
        <p className="eyebrow">Now</p>
        <p className="mt-1.5 text-[12.5px] leading-5 text-mist-100">
          {agent.paused ? "Paused" : agent.activity}
        </p>
        <dl className="mt-2 space-y-1 text-[11px] leading-4">
          <div className="flex gap-2">
            <dt className="w-[62px] shrink-0 text-mist-500">Location</dt>
            <dd className="min-w-0 text-mist-300">{locationText}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[62px] shrink-0 text-mist-500">Task</dt>
            <dd className="min-w-0 flex-1">
              {currentTask ? (
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-mist-300 underline-offset-2 hover:text-mist-100 hover:underline"
                  onClick={() => selectTask(currentTask.id)}
                  title={currentTask.title}
                >
                  {currentTask.id} · {currentTask.title}
                </button>
              ) : (
                <span className="text-mist-500">No task assigned</span>
              )}
            </dd>
          </div>
        </dl>
        {currentTask && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar
              value={currentTask.progress}
              color={profile.color}
              label={`${profile.name} current task progress`}
            />
            <span className="w-8 shrink-0 text-right font-mono text-[9.5px] text-mist-500">
              {Math.round(currentTask.progress * 100)}%
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="btn btn-primary justify-start"
          onClick={() => openTaskDialog(agent.id)}
        >
          <UserPlus aria-hidden="true" />
          Assign task
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-start"
          onClick={togglePause}
        >
          {agent.paused ? (
            <PlayCircle aria-hidden="true" />
          ) : (
            <PauseCircle aria-hidden="true" />
          )}
          {agent.paused ? "Resume agent" : "Pause agent"}
        </button>
        <button
          type="button"
          className={cn(
            "btn btn-ghost justify-start",
            following && "border-signal/35 text-signal",
          )}
          onClick={() => {
            if (following) {
              setFollowAgent(null);
            } else {
              setFollowAgent(agent.id);
              focusAgent(agent.id);
            }
          }}
          aria-pressed={following}
        >
          {following ? (
            <EyeOff aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
          )}
          {following ? "Stop following" : "Follow"}
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-start"
          onClick={() => focusAgent(agent.id)}
        >
          <Crosshair aria-hidden="true" />
          Focus camera
        </button>
      </div>

      <div className="mt-4">
        <SegmentedControl
          options={[
            {
              value: "activity",
              label: `Activity · ${agentEvents.length}`,
            },
            {
              value: "communication",
              label: `Communication · ${agentCommunication.length}`,
            },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Agent event view"
          grow
          className="flex w-full"
        />
      </div>

      <div className="mt-2">
        <ActivityFeed events={shown} compact />
      </div>
    </div>
  );
}
