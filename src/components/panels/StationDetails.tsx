"use client";

import { Crosshair, UserRound } from "lucide-react";
import { AGENT_BY_ID } from "@/agents/AgentRegistry";
import { LOCATIONS, STATIONS, type StationId } from "@/simulation/worldLayout";
import { useWorldStore } from "@/state/useWorldStore";
import { STATION_OWNER_IDS } from "@/world/stationOwners";
import { focusStation } from "@/world/stationFocus";
import {
  AgentAvatar,
  AgentStatusPill,
  ProgressBar,
} from "@/components/ui";

const ZONE_LABELS: Record<string, string> = {
  operations: "Operations zone",
  research: "Research zone",
  development: "Development zone",
  collaboration: "Collaboration zone",
};

/**
 * Panel content for a clicked workstation: station name, its owner and the
 * owner's current state. Selecting a desk in the office opens this view.
 */
export function StationDetails({ stationId }: { stationId: StationId }) {
  const station = STATIONS.find((entry) => entry.id === stationId);
  const agent = useWorldStore((state) =>
    state.world?.agents.find(
      (entry) => entry.id === STATION_OWNER_IDS[stationId],
    ),
  );
  const task = useWorldStore((state) =>
    agent?.currentTaskId
      ? state.world?.tasks.find((entry) => entry.id === agent.currentTaskId)
      : undefined,
  );
  const selectAgent = useWorldStore((state) => state.selectAgent);

  if (!station) {
    return (
      <div className="px-4 py-4">
        <p className="text-[12px] leading-5 text-mist-500">
          This workstation is no longer in the office.
        </p>
      </div>
    );
  }

  const owner = AGENT_BY_ID[STATION_OWNER_IDS[stationId]];
  const zone = LOCATIONS[stationId]?.zone;

  return (
    <div className="px-4 py-3.5">
      <p className="eyebrow">Workstation</p>
      <h3 className="mt-1 text-[17px] font-semibold leading-tight tracking-tight text-mist-100">
        {station.label}
      </h3>
      {zone && (
        <p className="mt-1 text-[11px] text-mist-500">
          {ZONE_LABELS[zone] ?? zone}
        </p>
      )}

      <div className="surface-quiet mt-3 p-3">
        <p className="eyebrow">Owner</p>
        <div className="mt-2 flex items-start gap-2.5">
          <AgentAvatar agentId={owner.id} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium leading-tight text-mist-100">
                {owner.name}
              </span>
              <span className="truncate text-[10.5px] text-mist-500">
                {owner.roleLabel}
              </span>
            </div>
            {agent ? (
              <>
                <p className="mt-1 text-[11.5px] leading-4 text-mist-300">
                  {agent.paused ? "Paused" : agent.activity}
                </p>
                {task && (
                  <p className="mt-1 truncate text-[11px] leading-4 text-mist-500">
                    {task.id} · {task.title}
                  </p>
                )}
                {agent.progress > 0.001 && (
                  <div className="mt-1.5">
                    <ProgressBar
                      value={agent.progress}
                      color={owner.color}
                      label={`${owner.name} current progress`}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1 text-[11.5px] leading-4 text-mist-500">
                Waiting for the backend snapshot.
              </p>
            )}
          </div>
          {agent && <AgentStatusPill agent={agent} className="mt-0.5 shrink-0" />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => focusStation(stationId)}
        >          <Crosshair aria-hidden="true" />
          Focus camera
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => selectAgent(owner.id)}
        >
          <UserRound aria-hidden="true" />
          View {owner.name}
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-mist-500">
        Click a desk in the office to inspect its station and owner.
      </p>
    </div>
  );
}
