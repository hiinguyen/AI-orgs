"use client";

import { useState } from "react";
import { feedEvents } from "@/events/eventStore";
import { useWorldStore } from "@/state/useWorldStore";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

export function ActivityPanel() {
  const events = useWorldStore((state) => state.events);
  const selectAgent = useWorldStore((state) => state.selectAgent);
  const [messagesOnly, setMessagesOnly] = useState(false);

  const visible = feedEvents(events, messagesOnly);

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] leading-5 text-mist-500">
          Click an entry to jump to the agent.
        </p>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-mist-300">
          <input
            type="checkbox"
            checked={messagesOnly}
            onChange={(event) => setMessagesOnly(event.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-ink-950 accent-signal"
          />
          Messages only
        </label>
      </div>

      <ActivityFeed
        events={visible}
        onJump={selectAgent}
        className="mt-2"
      />
    </div>
  );
}
