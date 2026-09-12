"use client";

import { useState } from "react";
import type { Approval } from "@/contracts";
import { StatusPill } from "./StatusPill";
import { Countdown } from "./Countdown";
import { formatCents } from "./money";

export function ApprovalCard({ approval }: { approval: Approval }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function tap(action: "approve" | "reject") {
    if (busy) return;
    setBusy(action);
    try {
      await fetch("/api/dev/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: approval.id }),
      });
    } finally {
      setBusy(null);
    }
  }

  const isPending = approval.status === "PENDING";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <StatusPill status={approval.status} />
        {isPending && (
          <span className="tnum text-xs text-zinc-500">
            expires in <Countdown expiresAt={approval.expiresAt} />
          </span>
        )}
      </div>
      <dl className="tnum grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-zinc-400">Total</dt>
          <dd className="font-medium text-zinc-900">{formatCents(approval.totalCents)}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Limit</dt>
          <dd className="text-zinc-700">{formatCents(approval.limitCents)}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Excess</dt>
          <dd className="text-red-600">{formatCents(approval.excessCents)}</dd>
        </div>
      </dl>
      {isPending && (
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => tap("approve")}
            disabled={busy !== null}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => tap("reject")}
            disabled={busy !== null}
            className="flex-1 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
