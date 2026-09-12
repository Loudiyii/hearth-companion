"use client";

import { useState } from "react";
import { useRealtimeTable } from "@/lib/supabase-browser";
import type { Activity } from "@/contracts";
import { TONE_BG, activityLineFr } from "./format";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR");
  } catch {
    return "--:--:--";
  }
}

export function EventLog() {
  const { rows } = useRealtimeTable<Activity>("activity", { filter: { elder_id: "marie" }, limit: 50 });
  const [cleared, setCleared] = useState(false);
  const visible = cleared ? [] : rows;

  return (
    <div className="rounded-xl border border-[#1c2a36] bg-[#0f1a24] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-wider text-[#7d8b99]">JOURNAL D&rsquo;ÉVÉNEMENTS</p>
          <p className="text-lg font-medium text-[#e6edf3]">Activité récente</p>
        </div>
        <button
          type="button"
          onClick={() => setCleared(true)}
          className="text-xs text-[#7d8b99] underline decoration-dotted hover:text-[#e6edf3]"
        >
          Effacer
        </button>
      </div>

      <ul
        className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-color:#1c2a36_transparent] [scrollbar-width:thin]"
      >
        {visible.length === 0 && <li className="py-4 text-center text-sm text-[#7d8b99]">Aucun événement.</li>}
        {visible.map((row) => {
          const line = activityLineFr(row);
          return (
            <li key={row.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/[0.02]">
              <span className="font-mono text-xs text-[#7d8b99]">{formatTime(row.createdAt)}</span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_BG[line.tone]}`} />
              <span className="truncate text-[#e6edf3]">{line.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
