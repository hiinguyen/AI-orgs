"use client";

import { useEffect } from "react";
import { useWorldStore } from "@/state/useWorldStore";

export function WorldPlaceholder() {
  const setSceneReady = useWorldStore((state) => state.setSceneReady);

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setSceneReady(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [setSceneReady]);

  return <div aria-hidden="true" className="world-placeholder absolute inset-0" />;
}
