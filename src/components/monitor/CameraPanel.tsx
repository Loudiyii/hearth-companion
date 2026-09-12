"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CameraSample, CameraSource } from "@/components/room/useCameraWatch";
import type { IncidentPhase } from "@/components/room/useCompanion";
import { TONE_BG, TONE_TEXT, cameraChip } from "./format";

function Clock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("fr-FR"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-sm text-[#7d8b99]">{now}</span>;
}

function WalkingGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#2dd4bf" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="4" r="1.6" fill="#2dd4bf" stroke="none" />
      <path d="M13 7 10 9l-2.5 4M13 7l3 2 3-1M13 7l-1 5 2 6M12 12l-3 2-1.5 4M12 12l2.5 1.5L17 19" />
    </svg>
  );
}

export function CameraPanel({
  videoRef,
  error,
  source,
  lastSample,
  incidentPhase,
  onStartCamera,
  onLoadVideoFile,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  error: string | null;
  source: CameraSource;
  lastSample: CameraSample | null;
  incidentPhase: IncidentPhase;
  onStartCamera: () => void;
  onLoadVideoFile: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chip = cameraChip(incidentPhase, lastSample);
  const live = source !== "none";

  return (
    <div className="flex flex-col rounded-xl border border-[#1c2a36] bg-[#0f1a24] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-wider text-[#7d8b99]">CAMÉRA 01</p>
          <p className="text-lg font-medium text-[#e6edf3]">Salon</p>
        </div>
        {live && (
          <span className="flex items-center gap-1.5 rounded-full border border-[#1c2a36] px-2.5 py-1 text-[11px] font-medium text-[#f472b6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#f472b6]" />
            LIVE
          </span>
        )}
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2dd4bf]/10">
              <WalkingGlyph />
            </div>
            <p className="text-sm font-medium text-[#e6edf3]">Flux vidéo prêt</p>
            <p className="max-w-56 text-xs text-[#7d8b99]">Démarre la caméra ou charge une vidéo</p>
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs backdrop-blur">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_BG[chip.tone]}`} />
          <span className={TONE_TEXT[chip.tone]}>{chip.text}</span>
        </div>
        <div className="absolute bottom-3 right-3 rounded-full bg-black/50 px-2.5 py-1 backdrop-blur">
          <Clock />
        </div>
      </div>

      {lastSample && (
        <p className="mt-2 text-right font-mono text-[11px] text-[#7d8b99]">
          {lastSample.posture} · {Math.round(lastSample.confidence * 100)}% · {lastSample.streak}/2
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[#f43f5e]">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onStartCamera}
          className="flex-1 rounded-lg border border-[#1c2a36] bg-[#0a1118] px-3 py-2 text-sm text-[#e6edf3] transition-colors hover:border-[#2dd4bf]/50"
        >
          Démarrer la caméra
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 rounded-lg border border-[#1c2a36] bg-[#0a1118] px-3 py-2 text-sm text-[#e6edf3] transition-colors hover:border-[#2dd4bf]/50"
        >
          Charger une vidéo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoadVideoFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
