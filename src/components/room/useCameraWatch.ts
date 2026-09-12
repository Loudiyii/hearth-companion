"use client";

/**
 * Camera sampling — extracted from the old `CameraWatch` component so both
 * `/room` (webcam, auto-started) and `/monitor` (webcam or a loaded video
 * file, manually started) can share one sampling loop and one detection
 * path. Owns the `<video>` ref, the frame-sampling interval, and the
 * 2-consecutive-frame fall debounce; hands confirmed candidates off to the
 * caller (`useCompanion`) which owns speaking the check-in question.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionEvent } from "@/contracts";

const ELDER_ID = "marie";
const SAMPLE_INTERVAL_MS = 4000;
const COOLDOWN_MS = 60000;
const MAX_WIDTH = 1024;
const JPEG_QUALITY = 0.85;

export type CameraSource = "camera" | "video" | "none";

export interface CameraSample {
  posture: string;
  confidence: number;
  streak: number;
  scene: string | null;
  at: number;
}

export interface FloorCandidatePayload {
  incidentId: string;
  question: string;
}

interface VisionResult {
  posture: "standing" | "sitting" | "lying" | "on_floor" | "unknown";
  moving: boolean;
  confidence: number;
  note: string;
  scene: string;
}

const FALL_POSTURES = new Set(["on_floor", "lying"]);

export interface UseCameraWatchResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  source: CameraSource;
  lastSample: CameraSample | null;
  startCamera: () => Promise<void>;
  loadVideoFile: (file: File) => Promise<void>;
  /** Clears the fall streak + cooldown without touching the DB (used by the demo "Réinitialiser" control). */
  resetCooldown: () => void;
}

export function useCameraWatch({
  onFloorCandidate,
  onScene,
  onFrame,
}: {
  /** A candidate confirmed on 2 consecutive frames is handed off here instead of being handled locally. */
  onFloorCandidate?: (payload: FloorCandidatePayload) => void;
  onScene?: (scene: string, at: number) => void;
  onFrame?: (base64: string) => void;
}): UseCameraWatchResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const consecutiveFallsRef = useRef(0);
  const inIncidentRef = useRef(false);
  const cooldownUntilRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<CameraSource>("none");
  const [lastSample, setLastSample] = useState<CameraSample | null>(null);

  // canvas is only used off-screen for frame capture — never rendered by callers.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    return () => {
      canvasRef.current = null;
    };
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearVideoFile = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 } },
        audio: false,
      });
      stopStream();
      clearVideoFile();
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.src = "";
        video.removeAttribute("src");
        video.loop = false;
        video.muted = true;
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setSource("camera");
    } catch {
      setError("Camera unavailable — using text fallback only.");
    }
  }, [clearVideoFile, stopStream]);

  const loadVideoFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        stopStream();
        clearVideoFile();
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        const video = videoRef.current;
        if (video) {
          video.srcObject = null;
          video.loop = true;
          video.muted = true;
          video.src = url;
          await video.play().catch(() => {});
        }
        setSource("video");
      } catch {
        setError("Couldn't load that video file.");
      }
    },
    [clearVideoFile, stopStream]
  );

  const resetCooldown = useCallback(() => {
    consecutiveFallsRef.current = 0;
    cooldownUntilRef.current = 0;
    inIncidentRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      clearVideoFile();
    };
  }, [stopStream, clearVideoFile]);

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

  const runCandidateFlow = useCallback(
    async (confidence: number, note: string) => {
      if (inIncidentRef.current) return;
      inIncidentRef.current = true;
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
        if (incidentId) onFloorCandidate?.({ incidentId, question });
      } catch {
        // best-effort — the incident path must never crash the room/monitor screen
      } finally {
        consecutiveFallsRef.current = 0;
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        inIncidentRef.current = false;
      }
    },
    [onFloorCandidate]
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      if (inIncidentRef.current || Date.now() < cooldownUntilRef.current) return;
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      // Strip the "data:image/jpeg;base64," prefix — the server re-adds it,
      // and this raw base64 payload is also what onFrame consumers expect.
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
        setLastSample({
          posture: result.posture,
          confidence: result.confidence,
          streak: consecutiveFallsRef.current,
          scene: result.scene ?? null,
          at: Date.now(),
        });
        if (consecutiveFallsRef.current >= 2) {
          void runCandidateFlow(result.confidence, result.note || "possible fall detected");
        }
      } catch {
        // vision is best-effort; skip this sample
      }
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [captureFrame, runCandidateFlow, onFrame, onScene]);

  return { videoRef, error, source, lastSample, startCamera, loadVideoFile, resetCooldown };
}
