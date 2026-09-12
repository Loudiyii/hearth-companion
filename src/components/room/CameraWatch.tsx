"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speak, listenForReply } from "./speech";
import type { CompanionStatus } from "./StatusWord";
import type { CompanionEvent } from "@/contracts";

const ELDER_ID = "marie";
const SAMPLE_INTERVAL_MS = 4000;
const CHECK_IN_WINDOW_MS = 20000;
const COOLDOWN_MS = 60000;
const MAX_WIDTH = 1024;
const JPEG_QUALITY = 0.85;

interface VisionResult {
  posture: "standing" | "sitting" | "lying" | "on_floor" | "unknown";
  moving: boolean;
  confidence: number;
  note: string;
  scene: string;
}

const FALL_POSTURES = new Set(["on_floor", "lying"]);

export interface FloorCandidatePayload {
  incidentId: string;
  question: string;
}

export function CameraWatch({
  onStatusChange,
  onFloorCandidate,
  onScene,
  onFrame,
}: {
  /** Fallback self-contained UI status (unused once onFloorCandidate is provided). */
  onStatusChange?: (status: CompanionStatus | null) => void;
  /**
   * When provided, a candidate is handed off to the caller (CompanionController)
   * instead of CameraWatch speaking the question and listening for a reply itself.
   */
  onFloorCandidate?: (payload: FloorCandidatePayload) => void;
  /** Called with each sample's plain-language scene description. */
  onScene?: (scene: string, at: number) => void;
  /** Called with each sample's latest JPEG frame (base64, no data: prefix). */
  onFrame?: (base64: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const consecutiveFallsRef = useRef(0);
  const inIncidentRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const [checking, setChecking] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError("Camera unavailable — using text fallback only.");
      }
    }
    start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, []);

  const runIncidentFlow = useCallback(
    async (confidence: number, note: string) => {
      if (inIncidentRef.current) return;
      inIncidentRef.current = true;
      setChecking(true);
      onStatusChange?.("Checking on you…");
      try {
        const event: CompanionEvent = {
          type: "person_on_floor_candidate",
          elderId: ELDER_ID,
          confidence,
          note,
          at: new Date().toISOString(),
        };
        const res = await fetch("/api/incidents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
        const data = await res.json();
        const incidentId: string | undefined = data.incidentId;
        const question: string = data.question ?? "Marie? Are you okay?";

        if (onFloorCandidate && incidentId) {
          // The controller now owns speaking the question, listening for a
          // reply, and posting the response — it needs an open GPT-Live
          // session to do that with a real voice.
          onFloorCandidate({ incidentId, question });
          return;
        }

        onStatusChange?.("Speaking");
        await speak(question);
        onStatusChange?.("Checking on you…");

        const response = await listenForReply(CHECK_IN_WINDOW_MS);

        if (incidentId) {
          await fetch(`/api/incidents/${incidentId}/response`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response }),
          }).catch(() => {});
        }
      } catch {
        // best-effort — the incident path must never crash the room screen
      } finally {
        consecutiveFallsRef.current = 0;
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        setChecking(false);
        onStatusChange?.("Listening");
        inIncidentRef.current = false;
      }
    },
    [onStatusChange, onFloorCandidate]
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      if (inIncidentRef.current || Date.now() < cooldownUntilRef.current) return;
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      // Strip the "data:image/jpeg;base64," prefix — the server re-adds it,
      // and this raw base64 payload is also what onFrame/onScene consumers expect.
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      onFrame?.(imageBase64);
      try {
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elderId: ELDER_ID, imageBase64 }),
        });
        const result: VisionResult = await res.json();
        if (typeof result.scene === "string" && result.scene) {
          onScene?.(result.scene, Date.now());
        }
        if (FALL_POSTURES.has(result.posture)) {
          consecutiveFallsRef.current += 1;
        } else {
          consecutiveFallsRef.current = 0;
        }
        if (consecutiveFallsRef.current >= 2) {
          runIncidentFlow(result.confidence, result.note || "possible fall detected");
        }
      } catch {
        // vision is best-effort; skip this sample
      }
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [captureFrame, runIncidentFlow, onFrame, onScene]);

  return (
    <>
      <div className="pointer-events-none absolute right-6 top-6 h-32 w-44 overflow-hidden rounded-lg opacity-40">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {cameraError && (
        <p className="absolute right-6 top-40 max-w-44 text-right text-xs text-zinc-700">
          {cameraError}
        </p>
      )}
      <button
        type="button"
        onClick={() => runIncidentFlow(0.9, "manual test trigger")}
        disabled={checking}
        className="absolute bottom-4 right-4 rounded px-2 py-1 text-[11px] text-zinc-800 opacity-60 transition-opacity hover:opacity-100"
      >
        Force fall event
      </button>
    </>
  );
}
