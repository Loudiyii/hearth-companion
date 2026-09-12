import type { Activity, ActivityKind } from "@/contracts";

const ICONS: Record<ActivityKind, string> = {
  utterance: "»",
  basket_built: "▤",
  within_budget: "✓",
  over_budget: "!",
  approval_requested: "?",
  approval_approved: "✓",
  approval_rejected: "✕",
  approval_expired: "⏱",
  approval_duplicate_tap_ignored: "⇢",
  payment_processing: "…",
  payment_succeeded: "✓",
  payment_failed: "✕",
  companion_said: "»",
  incident_detected: "!",
  incident_checking: "…",
  incident_resolved_ok: "✓",
  incident_escalated: "‼",
  incident_acknowledged: "✓",
  refill_requested: "℞",
  refill_confirmed: "✓",
};

export function ActivityFeed({ rows }: { rows: Activity[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">No activity yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm">
          <span className="mt-0.5 w-5 shrink-0 text-center text-zinc-400" aria-hidden>
            {ICONS[row.kind] ?? "•"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-800">{row.message}</p>
            <p className="text-xs text-zinc-400">
              {new Date(row.createdAt).toLocaleTimeString()}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
