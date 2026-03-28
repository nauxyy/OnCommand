"use client";

import { useMemo, useState } from "react";

type SceneTiming = {
  scene: string;
  durationMs: number;
  endedAt: string;
};

function formatMs(ms: number) {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SceneTimingHistory({ showId }: { showId: string }) {
  const [timings] = useState<SceneTiming[]>(() => {
    if (typeof window === "undefined") return [];
    const key = `oncommand:scene-timings:${showId}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as SceneTiming[];
    } catch {
      return [];
    }
  });

  const recent = useMemo(() => [...timings].reverse().slice(0, 8), [timings]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
      <h2 className="text-lg font-semibold text-white">Recorded Scene Timings</h2>
      {recent.length ? (
        <div className="mt-3 space-y-2">
          {recent.map((item, index) => (
            <div key={`${item.scene}-${item.endedAt}-${index}`} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
              <p className="font-medium text-white">{item.scene}</p>
              <p className="text-zinc-400">Duration: {formatMs(item.durationMs)}</p>
              <p className="text-zinc-500">Ended: {new Date(item.endedAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No scene timing history yet. Run live mode to capture timings.</p>
      )}
    </section>
  );
}
