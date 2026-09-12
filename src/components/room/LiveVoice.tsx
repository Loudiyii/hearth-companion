"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ELDER_ID = "marie";
const MAX_BUFFER_CHARS = 600;
const MAX_COMMENTARY_CHARS = 1500;
/** ~500 tokens, approximated at 4 chars/token. */
const MAX_INSTRUCTIONS_CHARS = 2000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
/** Gap in input-transcript deltas that we treat as "the user finished a turn". */
const TURN_GAP_MS = 1200;
/** How long a failed connection attempt keeps the hook in the "error" display state. */
const ERROR_DISPLAY_MS = 3000;

export type LiveSessionState = "asleep" | "connecting" | "awake" | "closing" | "error";
export type LiveActivityKind = "listening" | "thinking" | "speaking";

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }, ICE_GATHERING_TIMEOUT_MS);
    function onChange() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export interface UseLiveSessionResult {
  state: LiveSessionState;
  userCaption: string;
  assistantCaption: string;
  errorMessage: string | null;
  /** Reads the epoch ms of the last transcript/delegation activity. Call from effects/handlers only. */
  getLastActivityAt: () => number;
  start: (opts?: { instructionsAppend?: string }) => Promise<void>;
  end: () => void;
  sendInstructions: (content: string) => void;
  /** Sends a backend-originated line for the model to paraphrase aloud. No-op unless the data channel is open. */
  sendCommentary: (content: string) => void;
  /** Sends silent context the model may use when relevant — never spoken on its own. */
  sendThinking: (content: string) => void;
  /** Fires with the accumulated transcript once a user turn ends (~1.2s silence gap). */
  onUserUtterance: (cb: (text: string) => void) => () => void;
  /**
   * Registers a function returning the latest camera frame (base64 JPEG, no
   * data: prefix) so client-delegation requests can attach it. Call with
   * `null` to clear. Least-invasive way for CompanionController to hand
   * LiveVoice a live-updating frame source without re-rendering on every frame.
   */
  setFrameProvider: (provider: (() => { frame: string | null; scene: string | null }) | null) => void;
}

/**
 * Drives a GPT-Live WebRTC session imperatively so a parent state machine
 * (CompanionController) can open/close it in response to wake/sleep events
 * instead of a human pressing "Start voice". The caller owns the <audio>
 * element and passes its ref in so remote audio playback is wired up.
 */
export function useLiveSession(
  onActivity: ((kind: LiveActivityKind) => void) | undefined,
  audioRef: React.RefObject<HTMLAudioElement | null>
): UseLiveSessionResult {
  const [state, setState] = useState<LiveSessionState>("asleep");
  const [userCaption, setUserCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const userBufferRef = useRef("");
  const assistantTextRef = useRef("");
  const lastActivityAtRef = useRef(0);
  const pendingInstructionsRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const turnBufferRef = useRef("");
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utteranceSubscribersRef = useRef(new Set<(text: string) => void>());
  const frameProviderRef = useRef<(() => { frame: string | null; scene: string | null }) | null>(null);

  const setFrameProvider = useCallback((provider: (() => { frame: string | null; scene: string | null }) | null) => {
    frameProviderRef.current = provider;
  }, []);

  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  });

  const getLastActivityAt = useCallback(() => lastActivityAtRef.current, []);

  const notify = useCallback((kind: LiveActivityKind) => {
    onActivityRef.current?.(kind);
  }, []);

  const markActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(payload));
    }
  }, []);

  const sendInstructions = useCallback(
    (content: string) => {
      send({
        type: "session.instructions.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: content.slice(0, MAX_INSTRUCTIONS_CHARS),
      });
    },
    [send]
  );

  const sendCommentary = useCallback(
    (content: string) => {
      send({
        type: "session.commentary.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: content.slice(0, MAX_COMMENTARY_CHARS),
      });
    },
    [send]
  );

  const sendThinking = useCallback(
    (content: string) => {
      send({
        type: "session.thinking.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content,
      });
    },
    [send]
  );

  const onUserUtterance = useCallback((cb: (text: string) => void) => {
    utteranceSubscribersRef.current.add(cb);
    return () => {
      utteranceSubscribersRef.current.delete(cb);
    };
  }, []);

  const scheduleTurnBoundary = useCallback(() => {
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    turnTimerRef.current = setTimeout(() => {
      const text = turnBufferRef.current.trim();
      turnBufferRef.current = "";
      if (text) {
        utteranceSubscribersRef.current.forEach((cb) => cb(text));
      }
    }, TURN_GAP_MS);
  }, []);

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    turnBufferRef.current = "";
  }, []);

  const handleDelegation = useCallback(
    async (delegationId: string) => {
      markActivity();
      notify("thinking");
      const text = userBufferRef.current.trim();
      userBufferRef.current = "";
      try {
        const sight = frameProviderRef.current?.() ?? null;
        const frame = sight?.frame ?? null;
        const scene = sight?.scene ?? undefined;
        // Base64 expands ~4/3 over raw bytes, so ~200KB of base64 text is the
        // budget requested — comfortably under typical request body limits.
        const imageBase64 = frame && frame.length < 900_000 ? frame : undefined;
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            elderId: ELDER_ID,
            text: text || "(no speech captured)",
            ...(imageBase64 ? { imageBase64 } : {}),
            ...(scene ? { scene } : {}),
          }),
        });
        if (!res.ok) throw new Error("agent request failed");
        const data = await res.json();
        const reply: string = typeof data.reply === "string" ? data.reply : "Done.";
        markActivity();
        send({
          type: "session.commentary.append",
          event_id: crypto.randomUUID(),
          delegation_id: delegationId,
          content: reply.slice(0, MAX_COMMENTARY_CHARS),
        });
      } catch {
        markActivity();
        send({
          type: "session.commentary.append",
          event_id: crypto.randomUUID(),
          delegation_id: delegationId,
          content: "I couldn't reach the house system just now. Let's try again in a moment.",
        });
      }
    },
    [markActivity, notify, send]
  );

  const handleServerEvent = useCallback(
    (raw: string) => {
      let event: { type?: string; [key: string]: unknown } | null = null;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (!event || typeof event.type !== "string") return;

      switch (event.type) {
        case "session.started": {
          setState("awake");
          notify("listening");
          if (pendingInstructionsRef.current) {
            sendInstructions(pendingInstructionsRef.current);
            pendingInstructionsRef.current = null;
          }
          break;
        }
        case "session.input_transcript.delta": {
          const delta = typeof event.delta === "string" ? event.delta : "";
          markActivity();
          userBufferRef.current = (userBufferRef.current + delta).slice(-MAX_BUFFER_CHARS);
          setUserCaption(userBufferRef.current);
          turnBufferRef.current += delta;
          scheduleTurnBoundary();
          notify("listening");
          break;
        }
        case "session.output_transcript.delta": {
          const delta = typeof event.delta === "string" ? event.delta : "";
          markActivity();
          assistantTextRef.current += delta;
          setAssistantCaption(assistantTextRef.current);
          notify("speaking");
          break;
        }
        case "session.delegation.created": {
          markActivity();
          const delegation = event.delegation as { id?: string; target?: string } | undefined;
          if (delegation?.target === "client" && typeof delegation.id === "string") {
            void handleDelegation(delegation.id);
          }
          break;
        }
        case "session.closed": {
          cleanup();
          setState("asleep");
          break;
        }
        case "error": {
          const errorObj = event.error as { message?: string } | undefined;
          setErrorMessage(errorObj?.message ?? "Voice session reported an error.");
          break;
        }
        default:
          break;
      }
    },
    [cleanup, handleDelegation, markActivity, notify, scheduleTurnBoundary, sendInstructions]
  );

  const start = useCallback(
    async (opts?: { instructionsAppend?: string }) => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      setErrorMessage(null);
      setUserCaption("");
      setAssistantCaption("");
      userBufferRef.current = "";
      assistantTextRef.current = "";
      turnBufferRef.current = "";
      pendingInstructionsRef.current = opts?.instructionsAppend ?? null;
      setState("connecting");
      markActivity();

      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.ontrack = (event) => {
          if (audioRef.current) {
            audioRef.current.srcObject = event.streams[0];
          }
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.addEventListener("message", (event) => handleServerEvent(event.data));
        dc.addEventListener("close", () => {
          setState((prev) => (prev === "closing" || prev === "awake" ? "asleep" : prev));
        });
        dc.addEventListener("error", () => {
          setErrorMessage("Voice connection had a data channel error.");
        });

        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micRef.current = mic;
        mic.getTracks().forEach((track) => pc.addTrack(track, mic));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);

        const localSdp = pc.localDescription?.sdp;
        if (!localSdp) throw new Error("no local SDP produced");

        const res = await fetch("/api/live/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: localSdp }),
        });
        if (!res.ok) throw new Error("live session request failed");
        const result = await res.json();
        const answerSdp: string | undefined = result?.transport?.sdp;
        if (!answerSdp) throw new Error("no answer SDP returned");

        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch {
        setErrorMessage("Voice call didn't connect — you can still type below.");
        cleanup();
        setState("error");
        errorTimerRef.current = setTimeout(() => {
          setState((prev) => (prev === "error" ? "asleep" : prev));
        }, ERROR_DISPLAY_MS);
      }
    },
    [audioRef, cleanup, handleServerEvent, markActivity]
  );

  const end = useCallback(() => {
    setState((prev) => (prev === "asleep" ? prev : "closing"));
    send({ type: "session.close" });
    cleanup();
    setState("asleep");
  }, [cleanup, send]);

  useEffect(() => {
    return () => {
      cleanup();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    userCaption,
    assistantCaption,
    errorMessage,
    getLastActivityAt,
    start,
    end,
    sendInstructions,
    sendCommentary,
    sendThinking,
    onUserUtterance,
    setFrameProvider,
  };
}
