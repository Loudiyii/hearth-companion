"use client";

import { useState } from "react";
import type { Incident } from "@/contracts";
import { StatusPill } from "./StatusPill";

export function AlertsColumn({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return <p className="text-sm text-zinc-400">No alerts.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {incidents.map((incident) => (
        <IncidentCard key={incident.id} incident={incident} />
      ))}
    </ul>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const [acking, setAcking] = useState(false);
  const needsAck = incident.status === "ESCALATED";

  async function ack() {
    if (acking) return;
    setAcking(true);
    try {
      await fetch("/api/dev/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ack", id: incident.id }),
      });
    } finally {
      setAcking(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <StatusPill status={incident.status} />
        <span className="text-xs text-zinc-400">
          {new Date(incident.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <p className="text-sm text-zinc-700">{incident.note}</p>
      {incident.elderResponse && (
        <p className="text-xs italic text-zinc-500">&ldquo;{incident.elderResponse}&rdquo;</p>
      )}
      {needsAck && (
        <button
          type="button"
          onClick={ack}
          disabled={acking}
          className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          I&rsquo;m on it
        </button>
      )}
    </li>
  );
}
