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
import { useRealtimeTable } from "@/lib/supabase-browser";
import type { Activity, ActivityKind } from "@/contracts";

const IDLE_TIMEOUT_MS = 45_000;
const IDLE_CHECK_INTERVAL_MS = 5_000;
const CHECK_IN_WINDOW_MS = 20_000;
/** Never speak the same activity kind's outcome twice within this window. */
const OUTCOME_DEBOUNCE_MS = 10_000;
/** Never push a fresh "Camera right now: …" thinking note more often than this. */
const SCENE_THINKING_MIN_INTERVAL_MS = 15_000;

/** Spoken outcomes for backend events Marie should hear about as soon as they happen. */
const OUTCOME_SENTENCES: Partial<Record<ActivityKind, string>> = {
  payment_succeeded: "Claire approved the order. The groceries are paid for and on their way.",
  approval_rejected: "Claire said no to this order for now. Nothing was charged.",
  approval_expired: "Claire didn't answer in time, so the order was not placed. We can try again later.",
  payment_failed: "Claire approved it, but the payment didn't go through. Nothing was charged; we can try again.",
  incident_acknowledged: "Claire has seen the alert and is on her way.",
};

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

async function postIncidentResponse(
  incidentId: string,
  response: string | null,
  imageBase64?: string | null
): Promise<"resolved_ok" | "escalated" | "ignored"> {
  try {
    const res = await fetch(`/api/incidents/${incidentId}/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response, ...(imageBase64 ? { imageBase64 } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    return data?.outcome === "resolved_ok" || data?.outcome === "escalated" ? data.outcome : "ignored";
  } catch {
    // best-effort — the incident path must never crash the room screen
    return "ignored";
  }
}

const CHECK_IN_HOLD_LINE =
  "I'm right here with you. I'm letting Claire know now. Stay still, and keep talking to me.";
const OUTCOME_LINES = {
  resolved_ok: "Good, I'm glad you're okay. I'll stay close by.",
  escalated:
    "I've alerted Claire with a picture of the room. She'll be told right away. Stay where you are — I'm staying with you.",
} as const;

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

  // --- ambient sight (silent scene updates + latest frame for delegation) --
  const latestFrameRef = useRef<string | null>(null);
  const latestSceneRef = useRef<string | null>(null);
  const lastSceneSentRef = useRef<{ scene: string; at: number } | null>(null);

  useEffect(() => {
    live.setFrameProvider(() => ({ frame: latestFrameRef.current, scene: latestSceneRef.current }));
    return () => live.setFrameProvider(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFrame = useCallback((base64: string) => {
    latestFrameRef.current = base64;
  }, []);

  const handleScene = useCallback(
    (scene: string) => {
      latestSceneRef.current = scene;
      if (live.state !== "awake") return;
      const last = lastSceneSentRef.current;
      const now = Date.now();
      if (last && last.scene === scene) return;
      if (last && now - last.at < SCENE_THINKING_MIN_INTERVAL_MS) return;
      lastSceneSentRef.current = { scene, at: now };
      live.sendThinking(`Background only, do not mention unless Marie asks about it — camera sees: ${scene}`);
    },
    [live]
  );

  // --- voice wake ---------------------------------------------------------
  const onVoiceWake = useCallback(() => {
    void live.start({
      instructionsAppend: "Marie just started talking to you; greet her briefly and listen.",
    });
  }, [live]);

  const wakeEnabled = liveState === "asleep";
  const { error: wakeError } = useWakeDetector({ enabled: wakeEnabled, onWake: onVoiceWake });

  // --- backend outcomes (approve/reject/pay/ack) speak into the live session ------------
  const { rows: activityRows, loading: activityLoading } = useRealtimeTable<Activity>("activity", {
    filter: { elder_id: "marie" },
    limit: 20,
  });
  // Rows already present when the page loaded must never be replayed as "news" — only
  // insertions after this cutoff (set once, from the first load) are spoken aloud.
  const cutoffAtRef = useRef<string | null>(null);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const lastSpokenAtRef = useRef<Map<ActivityKind, number>>(new Map());

  useEffect(() => {
    if (cutoffAtRef.current !== null || activityLoading) return;
    cutoffAtRef.current = activityRows[0]?.createdAt ?? new Date(0).toISOString();
  }, [activityLoading, activityRows]);

  useEffect(() => {
    const cutoff = cutoffAtRef.current;
    if (cutoff === null) return;

    const freshRows = activityRows
      .filter((row) => row.createdAt > cutoff && !processedIdsRef.current.has(row.id))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    for (const row of freshRows) {
      processedIdsRef.current.add(row.id);
      if (row.createdAt > cutoffAtRef.current!) cutoffAtRef.current = row.createdAt;

      const base = OUTCOME_SENTENCES[row.kind];
      const sentence =
        base && row.kind === "payment_succeeded"
          ? `${base} ${row.message.replace(/^Payment went through\.\s*/, "")}`.trim()
          : base;
      if (!sentence) continue;

      const now = Date.now();
      const lastSpokenAt = lastSpokenAtRef.current.get(row.kind) ?? 0;
      if (now - lastSpokenAt < OUTCOME_DEBOUNCE_MS) continue;
      lastSpokenAtRef.current.set(row.kind, now);

      if (live.state === "awake") {
        live.sendCommentary(sentence);
      } else {
        void live.start({ instructionsAppend: `Speak first: tell Marie that ${sentence}` });
      }
    }
  }, [activityRows, live]);

  // --- vision wake ---------------------------------------------------------
  const handleFloorCandidate = useCallback(
    ({ incidentId, question }: FloorCandidatePayload) => {
      setChecking(true);

      let settled = false;
      live.setDelegationOverride(() => CHECK_IN_HOLD_LINE);
      const finish = async (text: string | null) => {
        if (settled) return;
        settled = true;
        setChecking(false);
        live.setDelegationOverride(null);
        const outcome = await postIncidentResponse(incidentId, text, latestFrameRef.current);
        if (outcome !== "ignored") live.sendCommentary(OUTCOME_LINES[outcome]);
      };
      const timer = setTimeout(() => {
        unsubscribe();
        void finish(null);
      }, CHECK_IN_WINDOW_MS);

      const unsubscribe = live.onUserUtterance((text) => {
        clearTimeout(timer);
        void finish(text);
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
      <CameraWatch onFloorCandidate={handleFloorCandidate} onScene={handleScene} onFrame={handleFrame} />
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
