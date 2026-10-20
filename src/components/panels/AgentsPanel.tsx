"use client";

import type { AgentState } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { useWorldStore } from "@/state/useWorldStore";
import {
  AgentAvatar,
  AgentStatusPill,
  ProgressBar,
} from "@/components/ui";

const EMPTY_AGENTS: readonly AgentState[] = [];

export function AgentsPanel() {
  const agents = useWorldStore((state) => state.world?.agents ?? EMPTY_AGENTS);
  const selectAgent = useWorldStore((state) => state.selectAgent);

  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] leading-5 text-mist-500">
        Select an agent to inspect its state, history and messages, or click
        one in the office.
      </p>

      <div className="mt-2">
        {agents.map((agent) => (
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
                  <span className="text-[13px] font-medium leading-tight text-mist-100">
                    {AGENT_BY_ID[agent.id].name}
                  </span>
                  <span className="truncate text-[10.5px] text-mist-500">
                    {AGENT_BY_ID[agent.id].roleLabel}
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
                  color={AGENT_BY_ID[agent.id].color}
                  label={`${AGENT_BY_ID[agent.id].name} task progress`}
                />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
