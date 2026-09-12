"use client";

import { useState } from "react";
import { StatusWord, type CompanionStatus } from "@/components/room/StatusWord";
import { TextFallback } from "@/components/room/TextFallback";
import { CompanionController } from "@/components/room/CompanionController";
import { RealtimeVoice } from "@/components/room/RealtimeVoice";
import { ActivityStrip } from "@/components/room/ActivityStrip";

export default function RoomPage() {
  const [status, setStatus] = useState<CompanionStatus>("Resting");
  const [showFallback, setShowFallback] = useState(false);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-between bg-zinc-950 px-6 py-10">
      <div className="flex-1" />

      <div className="flex w-full flex-col items-center gap-10">
        <StatusWord status={status} />
        <TextFallback onStatusChange={setStatus} />
        <CompanionController onStatusChange={setStatus} />
        <button
          type="button"
          onClick={() => setShowFallback((v) => !v)}
          className="text-xs text-zinc-600 underline"
        >
          Fallback voice (Realtime)
        </button>
        {showFallback && <RealtimeVoice />}
      </div>

      <div className="flex-1" />

      <ActivityStrip />
    </div>
  );
}
