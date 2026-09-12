"use client";

/**
 * Thin presentational wrapper for `/room`: renders the small dimmed preview
 * from a `videoRef` owned by `useCameraWatch` (via `useCompanion`), plus the
 * classifier readout and the low-contrast "Force fall event" button. All
 * sampling/detection logic lives in `useCameraWatch`.
 */

import type { RefObject } from "react";
import type { CameraSample } from "./useCameraWatch";

export function CameraWatch({
  videoRef,
  error,
  lastSample,
  onForceFall,
  disabled = false,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  error: string | null;
  lastSample: CameraSample | null;
  onForceFall: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="pointer-events-none absolute right-6 top-6 h-32 w-44 overflow-hidden rounded-lg opacity-40">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      </div>
      {lastSample && (
        <p className="pointer-events-none absolute right-6 top-[9.5rem] w-44 text-right font-mono text-[11px] text-zinc-600">
          {lastSample.posture} · {Math.round(lastSample.confidence * 100)}% · {lastSample.streak}/2
        </p>
      )}
      {error && (
        <p className="absolute right-6 top-40 max-w-44 text-right text-xs text-zinc-700">{error}</p>
      )}
      <button
        type="button"
        onClick={onForceFall}
        disabled={disabled}
        className="absolute bottom-4 right-4 rounded px-2 py-1 text-[11px] text-zinc-800 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
      >
        Force fall event
      </button>
    </>
  );
}
