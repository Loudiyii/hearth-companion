"use client";

import { useState } from "react";
import { useCompanion } from "@/components/room/useCompanion";
import { useConversationLog } from "@/components/monitor/useConversationLog";
import { CameraPanel } from "@/components/monitor/CameraPanel";
import { StatusPanel } from "@/components/monitor/StatusPanel";
import { WorkflowPanel } from "@/components/monitor/WorkflowPanel";
import { EventLog } from "@/components/monitor/EventLog";

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2dd4bf" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default function MonitorPage() {
  const companion = useCompanion({ autoStartCamera: false });
  const [demoMode, setDemoMode] = useState(true);

  // Destructured once, here, in the same component that owns `useCompanion()` —
  // mirrors CompanionController.tsx, which passes discrete fields (never the
  // whole `camera`/`companion` object) down to presentational children.
  const { status, liveState, incident, lastSample, camera, actions, audioRef, captions } = companion;
  const conversation = useConversationLog(captions);

  return (
    <div className="min-h-screen w-full bg-[#0a1118] px-4 py-4 text-[#e6edf3] sm:px-6 sm:py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2dd4bf]/10">
            <ShieldIcon />
          </div>
          <div>
            <p className="text-lg font-semibold leading-tight text-[#e6edf3]">Hearth Companion</p>
            <p className="text-xs leading-tight text-[#7d8b99]">Assistance en temps réel</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDemoMode((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            demoMode
              ? "border-[#2dd4bf]/40 bg-[#2dd4bf]/10 text-[#2dd4bf]"
              : "border-[#1c2a36] text-[#7d8b99]"
          }`}
        >
          ● Mode démo
        </button>
      </header>

      <audio ref={audioRef} autoPlay />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[65fr_35fr]">
        <CameraPanel
          videoRef={camera.videoRef}
          error={camera.error}
          source={camera.source}
          lastSample={lastSample}
          incidentPhase={incident.phase}
          onStartCamera={() => void camera.startCamera()}
          onLoadVideoFile={(file) => void camera.loadVideoFile(file)}
        />
        <StatusPanel
          incidentPhase={incident.phase}
          liveState={liveState}
          status={status}
          demoMode={demoMode}
          onForceFall={actions.forceFall}
          onPersonGotUp={actions.personGotUp}
          onTriggerAlert={actions.triggerAlert}
          onReset={actions.reset}
          conversation={conversation}
        />
      </div>

      <div className="mt-4">
        <WorkflowPanel incidentPhase={incident.phase} liveState={liveState} />
      </div>

      <div className="mt-4">
        <EventLog />
      </div>
    </div>
  );
}
