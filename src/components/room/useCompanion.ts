"use client";

/**
 * Headless companion state machine — everything `CompanionController` used
 * to own directly, extracted so any UI (the calm `/room` screen, or the
 * `/monitor` supervision console) can drive the same sleep/wake, camera,
 * and incident logic. See `CompanionController.tsx` for the sleep/wake
 * diagram; this file adds one more axis on top: `incident.phase`, tracked
 * locally from the same flow (never read back from the DB except for the
 * `incident_acknowledged` activity row).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useCameraWatch, type CameraSample, type FloorCandidatePayload } from "./useCameraWatch";
import { useLiveSession, type LiveActivityKind, type LiveSessionState } from "./LiveVoice";
import { useWakeDetector } from "./useWakeDetector";
import { speak } from "./speech";
import type { CompanionStatus } from "./StatusWord";
import { useRealtimeTable } from "@/lib/supabase-browser";
import type { Activity, ActivityKind, CompanionEvent } from "@/contracts";

const ELDER_ID = "marie";
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
    // best-effort — the incident path must never crash the room/monitor screen
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

export type IncidentPhase = "none" | "detected" | "checking" | "escalated" | "acknowledged" | "resolved";

export interface CompanionIncident {
  id: string;
  phase: IncidentPhase;
  since: number | null;
}

export interface CompanionCamera {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  source: "camera" | "video" | "none";
  startCamera: () => Promise<void>;
  loadVideoFile: (file: File) => Promise<void>;
}

export interface CompanionActions {
  wake: () => void;
  sleep: () => void;
  forceFall: () => void;
  personGotUp: () => void;
  triggerAlert: () => void;
  reset: () => void;
  sendText: (text: string) => Promise<void>;
}

export interface UseCompanionResult {
  status: CompanionStatus;
  liveState: LiveSessionState;
  incident: CompanionIncident;
  lastSample: CameraSample | null;
  captions: { user: string; assistant: string };
  actions: CompanionActions;
  camera: CompanionCamera;
  /** Extra, beyond the minimal contract: the <audio> element ref the caller must render for GPT-Live playback. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Extra: a connection/mic error line, as shown on today's /room screen. */
  statusMessage: string | null;
}

const EMPTY_INCIDENT: CompanionIncident = { id: "", phase: "none", since: null };

export function useCompanion(options?: { autoStartCamera?: boolean }): UseCompanionResult {
  const autoStartCamera = options?.autoStartCamera ?? true;

  // Reflects GPT-Live's own transcript activity while AWAKE.
  const [activity, setActivity] = useState<LiveActivityKind>("listening");
  // True while a vision-triggered check-in is awaiting Marie's reply — used
  // to keep "Checking on you…" on screen instead of the generic Listening.
  const [checking, setChecking] = useState(false);
  const [incident, setIncident] = useState<CompanionIncident>(EMPTY_INCIDENT);
  const [textOverride, setTextOverride] = useState<CompanionStatus | null>(null);

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

  // --- fall check-in bookkeeping -------------------------------------------
  const incidentIdRef = useRef<string | null>(null);
  const activeCheckInRef = useRef<{ finish: (text: string | null) => void; cancel: () => void } | null>(null);
  const pendingAutoEscalateRef = useRef(false);

  const beginCheckIn = useCallback(
    (incidentId: string, question: string) => {
      incidentIdRef.current = incidentId;
      setChecking(true);

      let settled = false;
      live.setDelegationOverride(() => CHECK_IN_HOLD_LINE);

      const finish = async (text: string | null) => {
        if (settled) return;
        settled = true;
        setChecking(false);
        live.setDelegationOverride(null);
        activeCheckInRef.current = null;
        const outcome = await postIncidentResponse(incidentId, text, latestFrameRef.current);
        setIncident((prev) =>
          prev.id === incidentId
            ? {
                ...prev,
                phase: outcome === "resolved_ok" ? "resolved" : outcome === "escalated" ? "escalated" : "none",
              }
            : prev
        );
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

      activeCheckInRef.current = {
        finish: (text) => {
          clearTimeout(timer);
          unsubscribe();
          void finish(text);
        },
        cancel: () => {
          clearTimeout(timer);
          unsubscribe();
          settled = true; // silent cancel — no postIncidentResponse
          setChecking(false);
          live.setDelegationOverride(null);
          activeCheckInRef.current = null;
        },
      };

      // Moving to "checking" here (rather than at detection) is what lets the
      // /monitor workflow tell "waiting to call" (liveState connecting) apart
      // from "calling / listening" (liveState awake) for the same phase.
      setIncident({ id: incidentId, phase: "checking", since: Date.now() });

      void live
        .start({
          instructionsAppend: `Marie may have fallen. Speak FIRST, right now, and ask exactly: "${question}" Then listen.`,
        })
        .then(() => {
          if (pendingAutoEscalateRef.current) {
            pendingAutoEscalateRef.current = false;
            activeCheckInRef.current?.finish(null);
          }
        });
    },
    [live]
  );

  const handleFloorCandidate = useCallback(
    ({ incidentId, question }: FloorCandidatePayload) => {
      incidentIdRef.current = incidentId;
      setIncident({ id: incidentId, phase: "detected", since: Date.now() });
      beginCheckIn(incidentId, question);
    },
    [beginCheckIn]
  );

  const camera = useCameraWatch({ onFloorCandidate: handleFloorCandidate, onScene: handleScene, onFrame: handleFrame });

  useEffect(() => {
    if (autoStartCamera) void camera.startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      if (row.kind === "incident_acknowledged" && row.refId && row.refId === incidentIdRef.current) {
        setIncident((prev) => (prev.id === row.refId ? { ...prev, phase: "acknowledged" } : prev));
      }

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
  const derivedStatus: CompanionStatus = checking
    ? "Checking on you…"
    : liveState === "connecting"
      ? "Waking…"
      : liveState === "asleep" || liveState === "error"
        ? "Resting"
        : activityToStatus(activity);

  // --- actions --------------------------------------------------------------
  const runManualIncident = useCallback(async () => {
    try {
      const event: CompanionEvent = {
        type: "person_on_floor_candidate",
        elderId: ELDER_ID,
        confidence: 0.9,
        note: "manual test trigger",
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
      if (incidentId) handleFloorCandidate({ incidentId, question });
    } catch {
      // best-effort
    }
  }, [handleFloorCandidate]);

  const wake = useCallback(() => {
    if (liveState !== "asleep") return;
    void live.start();
  }, [liveState, live]);

  const sleep = useCallback(() => {
    setChecking(false);
    live.end();
  }, [live]);

  const forceFall = useCallback(() => {
    void runManualIncident();
  }, [runManualIncident]);

  const personGotUp = useCallback(() => {
    activeCheckInRef.current?.finish("I'm fine, I got up");
  }, []);

  const triggerAlert = useCallback(() => {
    if (activeCheckInRef.current) {
      activeCheckInRef.current.finish(null);
    } else {
      pendingAutoEscalateRef.current = true;
      void runManualIncident();
    }
  }, [runManualIncident]);

  const reset = useCallback(() => {
    activeCheckInRef.current?.cancel();
    pendingAutoEscalateRef.current = false;
    incidentIdRef.current = null;
    setIncident(EMPTY_INCIDENT);
    camera.resetCooldown();
  }, [camera]);

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTextOverride("Thinking…");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elderId: ELDER_ID, text: trimmed }),
      });
      const data = await res.json();
      const reply: string = data.reply ?? "Sorry, I didn't catch that.";
      setTextOverride("Speaking");
      await speak(reply);
    } catch {
      // best-effort — text fallback must never crash the screen
    } finally {
      setTextOverride(null);
    }
  }, []);

  const statusMessage = live.errorMessage ?? wakeError;

  return {
    status: textOverride ?? derivedStatus,
    liveState,
    incident,
    lastSample: camera.lastSample,
    captions: { user: live.userCaption, assistant: live.assistantCaption },
    actions: { wake, sleep, forceFall, personGotUp, triggerAlert, reset, sendText },
    camera: {
      videoRef: camera.videoRef,
      error: camera.error,
      source: camera.source,
      startCamera: camera.startCamera,
      loadVideoFile: camera.loadVideoFile,
    },
    audioRef,
    statusMessage,
  };
}
