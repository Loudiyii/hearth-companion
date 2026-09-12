"use client";

import { useRealtimeTable } from "@/lib/supabase-browser";
import type { Activity } from "@/contracts";

export function ActivityStrip() {
  const { rows } = useRealtimeTable<Activity>("activity", {
    filter: { elder_id: "marie" },
    limit: 3,
  });

  if (rows.length === 0) return null;

  return (
    <div className="w-full border-t border-zinc-800 px-6 py-4">
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id} className="truncate text-sm text-zinc-600">
            {row.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
