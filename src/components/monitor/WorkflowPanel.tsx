"use client";

import type { IncidentPhase } from "@/components/room/useCompanion";
import type { LiveSessionState } from "@/components/room/LiveVoice";
import { WORKFLOW_STEPS, activeWorkflowStep } from "./format";

export function WorkflowPanel({
  incidentPhase,
  liveState,
}: {
  incidentPhase: IncidentPhase;
  liveState: LiveSessionState;
}) {
  const active = activeWorkflowStep(incidentPhase, liveState);
  const incidentActive = incidentPhase !== "none";

  return (
    <div className="rounded-xl border border-[#1c2a36] bg-[#0f1a24] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-wider text-[#7d8b99]">WORKFLOW DE L&rsquo;AGENT</p>
          <p className="text-lg font-medium text-[#e6edf3]">Du signal vidéo à l&rsquo;assistance</p>
        </div>
        <p className="text-xs text-[#7d8b99]">{incidentActive ? "Incident en cours" : "Aucun incident actif"}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        {WORKFLOW_STEPS.map((step) => {
          const isActive = step.n === active;
          const isDone = step.n < active;
          return (
            <div
              key={step.n}
              className={`rounded-lg border p-3 transition-colors ${
                isActive
                  ? "border-[#2dd4bf] bg-[#2dd4bf]/5"
                  : isDone
                    ? "border-[#1c2a36] bg-[#2dd4bf]/[0.03]"
                    : "border-[#1c2a36] bg-transparent"
              }`}
            >
              <p className={`font-mono text-sm font-semibold ${isActive ? "text-[#2dd4bf]" : "text-[#7d8b99]"}`}>
                {String(step.n).padStart(2, "0")}
              </p>
              <p className="mt-1 text-sm font-medium text-[#e6edf3]">{step.label}</p>
              <p className="text-xs text-[#7d8b99]">{step.sub}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
