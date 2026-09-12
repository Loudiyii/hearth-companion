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
 * (already inside CameraWatch) stops it from re-triggering back-to-back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraWatch, type FloorCandidatePayload } from "./CameraWatch";
import { useLiveSession, type LiveActivityKind } from "./LiveVoice";
import { useWakeDetector } from "./useWakeDetector";
import type { CompanionStatus } from "./StatusWord";

const IDLE_TIMEOUT_MS = 45_000;
const IDLE_CHECK_INTERVAL_MS = 5_000;
const CHECK_IN_WINDOW_MS = 20_000;

function activityToStatus(kind: LiveActivityKind): CompanionStatus {
  switch (kind) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking";
  }
}

async function postIncidentResponse(incidentId: string, response: string | null) {
  try {
    await fetch(`/api/incidents/${incidentId}/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
  } catch {
    // best-effort — the incident path must never crash the room screen
  }
}

export function CompanionController({
  onStatusChange,
}: {
  onStatusChange?: (status: CompanionStatus) => void;
}) {
  // Reflects GPT-Live's own transcript activity while AWAKE.
  const [activity, setActivity] = useState<LiveActivityKind>("listening");
  // True while a vision-triggered check-in is awaiting Marie's reply — used
  // to keep "Checking on you…" on screen instead of the generic Listening.
  const [checking, setChecking] = useState(false);

  const handleActivity = useCallback((kind: LiveActivityKind) => {
    setActivity(kind);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const live = useLiveSession(handleActivity, audioRef);
  const liveState = live.state;

  // --- voice wake ---------------------------------------------------------
  const onVoiceWake = useCallback(() => {
    void live.start({
      instructionsAppend: "Marie just started talking to you; greet her briefly and listen.",
    });
  }, [live]);

  const wakeEnabled = liveState === "asleep";
  const { error: wakeError } = useWakeDetector({ enabled: wakeEnabled, onWake: onVoiceWake });

  // --- vision wake ---------------------------------------------------------
  const handleFloorCandidate = useCallback(
    ({ incidentId, question }: FloorCandidatePayload) => {
      setChecking(true);

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        setChecking(false);
        unsubscribe();
        void postIncidentResponse(incidentId, null);
      }, CHECK_IN_WINDOW_MS);

      const unsubscribe = live.onUserUtterance((text) => {
        if (settled) return;
        settled = true;
        setChecking(false);
        clearTimeout(timer);
        void postIncidentResponse(incidentId, text);
      });

      void live.start({
        instructionsAppend:
          `Marie may have fallen. Speak FIRST, right now, and ask exactly: "${question}" Then listen.`,
      });
    },
    [live]
  );

  // --- idle timeout while awake --------------------------------------------
  useEffect(() => {
    if (liveState !== "awake") return;
    const id = setInterval(() => {
      if (Date.now() - live.getLastActivityAt() > IDLE_TIMEOUT_MS) {
        setChecking(false);
        live.end();
      }
    }, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, liveState]);

  // The displayed status is derived, not synced through its own state: a
  // check-in in progress always wins (even while GPT-Live is still
  // connecting), then the raw session lifecycle, then GPT-Live's own
  // transcript activity.
  const status: CompanionStatus = checking
    ? "Checking on you…"
    : liveState === "connecting"
      ? "Waking…"
      : liveState === "asleep" || liveState === "error"
        ? "Resting"
        : activityToStatus(activity);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  function manualWake() {
    if (liveState !== "asleep") return;
    void live.start();
  }

  function manualSleep() {
    setChecking(false);
    live.end();
  }

  const { userCaption, assistantCaption, errorMessage: liveErrorMessage } = live;
  const statusMessage = liveErrorMessage ?? wakeError;
  const isAsleep = liveState === "asleep";

  return (
    <>
      <CameraWatch onFloorCandidate={handleFloorCandidate} />
      <audio ref={audioRef} autoPlay />
      {(userCaption || assistantCaption) && (
        <div className="w-full max-w-2xl space-y-1 text-center">
          {userCaption && <p className="text-lg text-zinc-500">Marie: {userCaption}</p>}
          {assistantCaption && <p className="text-lg text-zinc-300">Hearth: {assistantCaption}</p>}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={manualWake}
          disabled={!isAsleep}
          className="rounded-full border border-zinc-800 px-4 py-1.5 text-xs text-zinc-500 disabled:opacity-30"
        >
          Wake
        </button>
        <button
          type="button"
          onClick={manualSleep}
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
