"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useWorldStore } from "@/state/useWorldStore";
import { Logo, cn } from "@/components/ui";

const STEPS = [
  "Booting simulation engine",
  "Building the office",
  "Waking up agents",
];

export function LoadingScreen() {
  const sceneReady = useWorldStore((state) => state.sceneReady);
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
    const timers = [
      setTimeout(() => setStep(1), 360),
      setTimeout(() => setStep(2), 720),
      setTimeout(() => setStep(3), 1080),
    ];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!sceneReady || hidden) return;
    const elapsed = Date.now() - startedAt.current;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const waitTimer = setTimeout(
      () => {
        setLeaving(true);
        fadeTimer = setTimeout(() => {
          setHidden(true);
        }, 520);
      },
      Math.max(0, 1150 - elapsed),
    );

    return () => {
      clearTimeout(waitTimer);
      if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    };
  }, [sceneReady, hidden]);

  if (hidden) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading AI Agent World"
      className={cn(
        "safe-overlay fixed inset-0 z-[80] flex flex-col items-center justify-center bg-ink-950/95 backdrop-blur-sm transition-opacity duration-500",
        leaving && "pointer-events-none opacity-0",
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-signal shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <Logo className="h-8 w-8" />
      </div>
      <p className="mt-4 text-[18px] font-semibold tracking-tight text-mist-100">
        AI Agent World
      </p>
      <p className="mt-1 text-[11px] text-mist-500">
        Preparing the local simulation office
      </p>

      <ol className="mt-7 space-y-2.5">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li
              key={label}
              className="flex items-center gap-2.5 text-[11.5px] leading-none"
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center">
                {done ? (
                  <Check aria-hidden="true" size={12} className="text-ok" />
                ) : current ? (
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 animate-spin rounded-full border border-white/15 border-t-signal"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-mist-500/40"
                  />
                )}
              </span>
              <span className={done ? "text-mist-300" : "text-mist-500"}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
