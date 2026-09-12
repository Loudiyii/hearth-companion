const COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  DETECTED: "bg-amber-100 text-amber-800",
  CHECKING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  CONSUMED: "bg-emerald-100 text-emerald-800",
  SUCCEEDED: "bg-emerald-100 text-emerald-800",
  RESOLVED_OK: "bg-emerald-100 text-emerald-800",
  ACKNOWLEDGED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-zinc-200 text-zinc-700",
  EXPIRED: "bg-zinc-200 text-zinc-700",
  FAILED: "bg-red-100 text-red-800",
  ESCALATED: "bg-red-100 text-red-800",
  PROCESSING: "bg-sky-100 text-sky-800",
  NOT_STARTED: "bg-zinc-200 text-zinc-700",
};

export function StatusPill({ status }: { status: string }) {
  const classes = COLORS[status] ?? "bg-zinc-200 text-zinc-700";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
