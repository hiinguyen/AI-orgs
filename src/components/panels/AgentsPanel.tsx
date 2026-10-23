"use client";

import type { AgentState } from "@/agents/agentTypes";
import { CORE_AGENT_IDS } from "@/agents/agentTypes";
import { useWorldStore, profileFor } from "@/state/useWorldStore";
import {
  AgentAvatar,
  AgentStatusPill,
  ProgressBar,
  cn,
} from "@/components/ui";

const EMPTY_AGENTS: readonly AgentState[] = [];

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function GroupHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="mt-3 flex items-center justify-between border-b border-white/[0.05] px-1 pb-1">
      <p className="eyebrow">{label}</p>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-mist-500">
        {count}
      </span>
    </div>
  );
}

/** Core first, then live (newest first), then the last eight finished. */
export function AgentsPanel() {
  const agents = useWorldStore((state) => state.world?.agents ?? EMPTY_AGENTS);
  const profiles = useWorldStore((state) => state.profiles);
  const liveOrder = useWorldStore((state) => state.liveAgentOrder);
  const finished = useWorldStore((state) => state.finishedAgents);
  const selectAgent = useWorldStore((state) => state.selectAgent);

  const byId = new Map<string, AgentState>();
  for (const agent of agents) byId.set(agent.id, agent);

  const coreAgents = CORE_AGENT_IDS.map((id) => byId.get(id)).filter(
    (agent): agent is AgentState => agent !== undefined,
  );
  const present = new Set(agents.map((agent) => agent.id));
  const liveAgents = [...liveOrder]
    .reverse()
    .filter((id) => present.has(id))
    .map((id) => byId.get(id))
    .filter((agent): agent is AgentState => agent !== undefined);

  const row = (agent: AgentState) => {
    const profile = profileFor(profiles, agent.id);
    return (
      <button
        key={agent.id}
        type="button"
        onClick={() => selectAgent(agent.id)}
        className="block w-full border-b border-white/[0.05] px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.03]"
      >
        <span className="flex w-full items-start gap-2.5">
          <AgentAvatar agentId={agent.id} size={30} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="truncate text-[13px] font-medium leading-tight text-mist-100">
                {profile.name}
              </span>
              <span className="truncate text-[10.5px] text-mist-500">
                {profile.roleLabel}
              </span>
            </span>
            <span className="mt-1 block truncate text-[11px] leading-4 text-mist-300">
              {agent.paused ? "Paused" : agent.activity}
            </span>
          </span>
          <AgentStatusPill agent={agent} className="mt-0.5 shrink-0" />
        </span>
        {agent.progress > 0.001 && (
          <span className="ml-10 mt-1.5 block">
            <ProgressBar
              value={agent.progress}
              color={profile.color}
              label={`${profile.name} task progress`}
            />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] leading-5 text-mist-500">
        Select an agent to inspect its state, history and messages, or click
        one in the office.
      </p>

      <GroupHeader label="Core team" count={coreAgents.length} />
      <div className="mt-1">{coreAgents.map(row)}</div>

      {liveAgents.length > 0 && (
        <>
          <GroupHeader label="Live agents" count={liveAgents.length} />
          <div className="mt-1">{liveAgents.map(row)}</div>
        </>
      )}

      {finished.length > 0 && (
        <>
          <GroupHeader label="Finished" count={finished.length} />
          <div className="mt-1">
            {finished.map((agent) => (
              <div
                key={`${agent.id}-${agent.finishedAt}`}
                className="flex w-full items-center gap-2.5 border-b border-white/[0.05] px-1 py-2 last:border-b-0"
              >
                <AgentAvatar agentId={agent.id} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium leading-tight text-mist-300">
                    {agent.name}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-mist-500">
                    {agent.roleLabel}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      "text-[10px] font-medium leading-none",
                      agent.outcome === "error" ? "text-bad" : "text-ok",
                    )}
                  >
                    {agent.outcome === "error" ? "Failed" : "Done"}
                  </p>
                  <p className="mt-1 font-mono text-[9px] leading-none text-mist-500">
                    {formatDuration(agent.duration)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
