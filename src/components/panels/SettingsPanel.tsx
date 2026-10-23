"use client";

import type { ReactNode } from "react";
import { SIMULATION_CONFIG } from "@/simulation/simulationConfig";
import { useWorldStore } from "@/state/useWorldStore";
import { describeQuality } from "@/state/qualityPolicy";
import { SegmentedControl, Switch, cn } from "@/components/ui";

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <p className="eyebrow">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.05] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-4 text-mist-100">{title}</p>
        {description && (
          <p className="mt-0.5 text-[10.5px] leading-4 text-mist-500">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function DefinitionRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] py-1.5 text-[11.5px] last:border-b-0">
      <dt className="text-mist-500">{label}</dt>
      <dd className="text-right font-mono text-[10.5px] text-mist-300">
        {value}
      </dd>
    </div>
  );
}

export function SettingsPanel() {
  const quality = useWorldStore((state) => state.quality);
  const qualityAuto = useWorldStore((state) => state.qualityAuto);
  const setQuality = useWorldStore((state) => state.setQuality);
  const overlays = useWorldStore((state) => state.overlays);
  const setOverlays = useWorldStore((state) => state.setOverlays);
  const sound = useWorldStore((state) => state.sound);
  const setSound = useWorldStore((state) => state.setSound);
  const backend = useWorldStore((state) => state.backend);

  return (
    <div className="px-4 py-3.5">
      <SettingsSection title="Rendering">
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-ink-950/40 px-2.5 py-2">
          <span className="eyebrow">Active mode</span>
          <span
            data-testid="quality-mode"
            className="font-mono text-[10.5px] text-mist-300"
          >
            {describeQuality(quality, qualityAuto)}
          </span>
        </div>
        <SegmentedControl
          className="flex w-full"
          options={[
            { value: "high", label: "High quality" },
            { value: "low", label: "Performance" },
          ]}
          value={quality}
          onChange={(value) => setQuality(value, false)}
          ariaLabel="Render quality"
          size="md"
          grow
        />
        <p className="mt-2 text-[10.5px] leading-4 text-mist-500">
          High quality adds shadows, the environment map and full-resolution
          textures. Performance disables them and caps the pixel ratio.
        </p>
        <p className="mt-1.5 text-[10.5px] leading-4 text-mist-500">
          {qualityAuto
            ? "Auto-selected from screen size, reduced-motion preference and CPU count. The renderer can lower it further if frames drop."
            : "Set manually. Add ?quality=high or ?quality=low to the URL to force a mode."}
        </p>
      </SettingsSection>

      <SettingsSection title="Overlays">
        <SettingsRow
          title="Walking paths and destinations"
          description="Dotted route trails and destination rings in the office."
        >
          <Switch
            checked={overlays.walkingPaths}
            onChange={(next) => setOverlays({ walkingPaths: next })}
            label="Walking paths and destinations"
          />
        </SettingsRow>
        <SettingsRow
          title="Agent speech indicators"
          description="Bubbles for communicating, success and error states."
        >
          <Switch
            checked={overlays.speechIndicators}
            onChange={(next) => setOverlays({ speechIndicators: next })}
            label="Agent speech indicators"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Sound">
        <SettingsRow title="Sound effects (M)">
          <Switch
            checked={sound.enabled}
            onChange={(next) => setSound({ enabled: next })}
            label="Sound effects"
          />
        </SettingsRow>
        <SettingsRow title="Ambient office hum">
          <Switch
            checked={sound.ambient}
            onChange={(next) => setSound({ ambient: next })}
            label="Ambient office hum"
          />
        </SettingsRow>
        <div className="border-b border-white/[0.05] py-2.5">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="sound-volume"
              className="text-[12px] text-mist-100"
            >
              Volume
            </label>
            <span className="font-mono text-[10px] text-mist-500">
              {Math.round(sound.volume * 100)}%
            </span>
          </div>
          <input
            id="sound-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            disabled={!sound.enabled}
            onChange={(event) =>
              setSound({ volume: Number(event.target.value) })
            }
            className="range mt-2 disabled:opacity-40"
          />
          <p className="mt-2 text-[10.5px] leading-4 text-mist-500">
            Cues are synthesised with Web Audio; no audio files are downloaded.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Backend">
        <div className="surface-quiet p-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                backend.connected
                  ? "bg-ok"
                  : backend.error
                    ? "bg-warn"
                    : "bg-mist-500",
              )}
            />
            <span className="text-[12px] font-medium text-mist-100">
              {backend.label}
            </span>
            <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.08em] text-mist-500">
              {backend.connected
                ? "Connected"
                : backend.error
                  ? "Reconnecting"
                  : "Offline"}
            </span>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-4 text-mist-500">
            {backend.simulated
              ? "Simulation mode - no live inference. The local engine replays canned workflow templates; no model is called and no code is executed."
              : "Live backend session. State and events arrive over the websocket protocol; a dropped socket reconnects automatically with capped backoff."}
          </p>
          {backend.error && (
            <p className="mt-2 rounded-md border border-bad/25 bg-bad/[0.08] px-2 py-1.5 text-[10.5px] leading-4 text-bad">
              {backend.error}
            </p>
          )}
        </div>
        <div className="mt-2 space-y-1 font-mono text-[9.5px] leading-4 text-mist-500">
          <p>NEXT_PUBLIC_AGENT_BACKEND=websocket</p>
          <p>NEXT_PUBLIC_AGENT_WS_URL=wss://your-orchestrator</p>
        </div>
      </SettingsSection>

      <SettingsSection title="Simulation">
        <dl>
          <DefinitionRow
            label="Tick rate"
            value={`${SIMULATION_CONFIG.tickHz} Hz`}
          />
          <DefinitionRow
            label="Max concurrent tasks"
            value={String(SIMULATION_CONFIG.maxConcurrentTasks)}
          />
          <DefinitionRow
            label="Max iterations"
            value={String(SIMULATION_CONFIG.maxIterations)}
          />
          <DefinitionRow
            label="QA failure chance"
            value={`${Math.round(SIMULATION_CONFIG.qaFailRate * 100)}%`}
          />
          <DefinitionRow
            label="Review change chance"
            value={`${Math.round(SIMULATION_CONFIG.reviewChangeRate * 100)}%`}
          />
          <DefinitionRow
            label="Speed options"
            value={`${SIMULATION_CONFIG.speeds.join("× / ")}×`}
          />
          <DefinitionRow
            label="Seed"
            value={String(SIMULATION_CONFIG.seed)}
          />
        </dl>
      </SettingsSection>

      <p className="mt-5 border-t border-white/[0.06] pt-3 text-[9.5px] leading-4 text-mist-500">
        Simulation mode - no live inference. Agents act out a canned workflow;
        nothing is generated by a model.
      </p>
    </div>
  );
}
