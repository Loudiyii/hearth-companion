"use client";

/**
 * Sleep / wake state machine
 * ==========================
 *
 * GPT-Live is billed per second of open session time, and Marie cannot press
 * a button to start talking to it — so the companion spends most of its life
 * ASLEEP, with only a cheap always-on camera loop and a local (client-side)
 * voice-activity detector running. A full GPT-Live session only opens when
 * something actually needs it, and closes itself again after a short idle
 * window.
 *
 * ```
 * ASLEEP  (no GPT-Live session — camera loop + local VAD only, near-zero cost)
 *    │
 *    ├─ she starts speaking (local VAD, ~30ms RMS over threshold for 300ms)
 *    ├─ CameraWatch reports a person_on_floor_candidate (2 consecutive frames)
 *    └─ "Wake" button / "Force fall event" button (demo controls)
 *    ▼
 * CONNECTING ("Waking…")  →  live.start() opens the GPT-Live WebRTC session
 *    ▼
 * AWAKE ("Listening" / "Thinking…" / "Speaking", or "Checking on you…"
 *        while a vision-triggered check-in is awaiting Marie's reply)
 *    │
 *    ├─ every 5s: now - lastActivityAt > 45s (no transcript/delegation
 *    │            activity at all) ⇒ live.end() ⇒ back to ASLEEP
 *    └─ "Sleep now" button ⇒ live.end() immediately ⇒ ASLEEP
 * ```
 *
 * The local VAD is paused for the entire AWAKE window (it must never run
 * while GPT-Live's own audio is coming out of the speaker, or the companion
 * would "wake itself up" from its own voice). CameraWatch keeps running the
 * whole time — a fall can happen mid-conversation too — but a 60s cooldown
 * (already inside useCameraWatch) stops it from re-triggering back-to-back.
 *
 * The state machine itself now lives in `useCompanion` (headless, shared
 * with `/monitor`); this component is just today's `/room` presentation of it.
 */

import { useEffect } from "react";
import { useCompanion } from "./useCompanion";
import { CameraWatch } from "./CameraWatch";
import type { CompanionStatus } from "./StatusWord";

export function CompanionController({
  onStatusChange,
}: {
  onStatusChange?: (status: CompanionStatus) => void;
}) {
  const companion = useCompanion();
  const { status, liveState, camera, captions, actions, lastSample, statusMessage, audioRef, incident } = companion;

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const isAsleep = liveState === "asleep";

  return (
    <>
      <CameraWatch
        videoRef={camera.videoRef}
        error={camera.error}
        lastSample={lastSample}
        onForceFall={actions.forceFall}
        disabled={incident.phase !== "none"}
      />
      <audio ref={audioRef} autoPlay />
      {(captions.user || captions.assistant) && (
        <div className="w-full max-w-2xl space-y-1 text-center">
          {captions.user && <p className="text-lg text-zinc-500">Marie: {captions.user}</p>}
          {captions.assistant && <p className="text-lg text-zinc-300">Hearth: {captions.assistant}</p>}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={actions.wake}
          disabled={!isAsleep}
          className="rounded-full border border-zinc-800 px-4 py-1.5 text-xs text-zinc-500 disabled:opacity-30"
        >
          Wake
        </button>
        <button
          type="button"
          onClick={actions.sleep}
          disabled={isAsleep}
          className="rounded-full border border-zinc-800 px-4 py-1.5 text-xs text-zinc-500 disabled:opacity-30"
        >
          Sleep now
        </button>
      </div>
      {statusMessage && <p className="text-xs text-zinc-700">{statusMessage}</p>}
    </>
  );
}
