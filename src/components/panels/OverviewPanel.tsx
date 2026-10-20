"use client";

import { Layers, Plus, Sparkles } from "lucide-react";
import type { AgentState } from "@/agents/agentTypes";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import type { Task } from "@/tasks/taskTypes";
import { activeTasks, queuedTasks } from "@/tasks/taskActions";
import { feedEvents } from "@/events/eventStore";
import { commands } from "@/integrations/backendClient";
import { useWorldStore } from "@/state/useWorldStore";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AgentAvatar, AgentStatusPill } from "@/components/ui";
import { TaskCard } from "./TaskCard";

const EMPTY_AGENTS: readonly AgentState[] = [];
const EMPTY_TASKS: readonly Task[] = [];

export function OverviewPanel() {
  const agents = useWorldStore((state) => state.world?.agents ?? EMPTY_AGENTS);
  const tasks = useWorldStore((state) => state.world?.tasks ?? EMPTY_TASKS);
  const clock = useWorldStore((state) => state.world?.clock ?? 0);
  const events = useWorldStore((state) => state.events);
  const selectAgent = useWorldStore((state) => state.selectAgent);
  const selectTask = useWorldStore((state) => state.selectTask);
  const setActiveTab = useWorldStore((state) => state.setActiveTab);
  const openTaskDialog = useWorldStore((state) => state.openTaskDialog);

  const inFlight = activeTasks(tasks);
  const queuedCount = queuedTasks(tasks).length;
  const latest = feedEvents(events).slice(0, 8);

  return (
    <div className="px-4 py-3.5">
      {tasks.length === 0 && (
        <section className="surface-quiet p-4">
          <p className="eyebrow text-signal">Demo</p>
          <h3 className="mt-1.5 text-[15px] font-semibold tracking-tight text-mist-100">
            Watch the team ship a feature
          </h3>
          <p className="mt-1.5 text-[12px] leading-5 text-mist-300">
            Orion delegates a JWT authentication task to Piper, Iris, Kai,
            Quinn and Rex, then the team plans, researches, builds, fails a
            test, fixes it and gets it reviewed.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void commands.runDemo();
              }}
            >
              <Sparkles aria-hidden="true" />
              Run demo
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void commands.loadSprint();
              }}
            >
              <Layers aria-hidden="true" />
              Load sprint
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openTaskDialog()}
            >
              <Plus aria-hidden="true" />
              New task
            </button>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-4 text-mist-500">
            Simulation mode - no live inference. The sprint adds 8 tasks,
            including a scripted QA failure and one task that fails after
            three iterations.
          </p>
        </section>
      )}

      <section className="mt-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Team</p>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-mist-500">
            {agents.length} agents
          </span>
        </div>
        <div className="mt-1.5 space-y-0.5">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => selectAgent(agent.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <AgentAvatar agentId={agent.id} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium leading-tight text-mist-100">
                  {AGENT_BY_ID[agent.id].name}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-mist-500">
                  {AGENT_BY_ID[agent.id].roleLabel}
                </span>
              </span>
              <AgentStatusPill agent={agent} />
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">In flight</p>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-mist-500">
            {inFlight.length} active
            {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
          </span>
        </div>
        {inFlight.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {inFlight.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                clock={clock}
                selected={false}
                compact
                onSelect={selectTask}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11.5px] leading-5 text-mist-500">
            Nothing in flight. Run the demo or load the sprint to watch the
            office wake up.
          </p>
        )}
      </section>

      <section className="mt-4">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Latest activity</p>
          <button
            type="button"
            className="btn btn-quiet h-6 px-1.5 text-[10px]"
            onClick={() => setActiveTab("activity")}
          >
            View all
          </button>
        </div>
        <ActivityFeed
          events={latest}
          compact
          onJump={selectAgent}
          className="mt-1"
        />
      </section>
    </div>
  );
}
