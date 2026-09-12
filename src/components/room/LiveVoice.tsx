"use client";

import { useRef, useState } from "react";

const ELDER_ID = "marie";
const MAX_BUFFER_CHARS = 600;
const MAX_COMMENTARY_CHARS = 1500;
const ICE_GATHERING_TIMEOUT_MS = 10_000;

type LiveStatus = "Connecting…" | "Listening" | "Thinking…" | "Speaking" | "Ended";
type ActivityKind = "listening" | "thinking" | "speaking";

function statusToActivity(status: LiveStatus): ActivityKind | null {
  if (status === "Listening") return "listening";
  if (status === "Thinking…") return "thinking";
  if (status === "Speaking") return "speaking";
  return null;
}

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

export function LiveVoice({
  onActivity,
}: {
  onActivity?: (kind: ActivityKind) => void;
}) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<LiveStatus>("Ended");
  const [userCaption, setUserCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userBufferRef = useRef("");
  const assistantTextRef = useRef("");

  function setStatusAndNotify(next: LiveStatus) {
    setStatus(next);
    const activity = statusToActivity(next);
    if (activity) onActivity?.(activity);
  }

  function send(payload: Record<string, unknown>) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(payload));
    }
  }

  async function handleDelegation(delegationId: string) {
    setStatusAndNotify("Thinking…");
    const text = userBufferRef.current.trim();
    userBufferRef.current = "";
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elderId: ELDER_ID, text: text || "(no speech captured)" }),
      });
      if (!res.ok) throw new Error("agent request failed");
      const data = await res.json();
      const reply: string = typeof data.reply === "string" ? data.reply : "Done.";
      send({
        type: "session.commentary.append",
        event_id: crypto.randomUUID(),
        delegation_id: delegationId,
        content: reply.slice(0, MAX_COMMENTARY_CHARS),
      });
    } catch {
      send({
        type: "session.commentary.append",
        event_id: crypto.randomUUID(),
        delegation_id: delegationId,
        content: "I couldn't reach the house system just now. Let's try again in a moment.",
      });
    }
  }

  function handleServerEvent(raw: string) {
    let event: { type?: string; [key: string]: unknown } | null = null;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (!event || typeof event.type !== "string") return;

    switch (event.type) {
      case "session.started": {
        setStatusAndNotify("Listening");
        break;
      }
      case "session.input_transcript.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        userBufferRef.current = (userBufferRef.current + delta).slice(-MAX_BUFFER_CHARS);
        setUserCaption(userBufferRef.current);
        setStatusAndNotify("Listening");
        break;
      }
      case "session.output_transcript.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        assistantTextRef.current += delta;
        setAssistantCaption(assistantTextRef.current);
        setStatusAndNotify("Speaking");
        break;
      }
      case "session.delegation.created": {
        const delegation = event.delegation as { id?: string; target?: string } | undefined;
        if (delegation?.target === "client" && typeof delegation.id === "string") {
          void handleDelegation(delegation.id);
        }
        break;
      }
      case "session.closed": {
        setStatusAndNotify("Ended");
        cleanup();
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
  }

  function cleanup() {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    setRunning(false);
  }

  async function start() {
    setErrorMessage(null);
    setUserCaption("");
    setAssistantCaption("");
    userBufferRef.current = "";
    assistantTextRef.current = "";
    setStatusAndNotify("Connecting…");
    setRunning(true);

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
        setStatusAndNotify("Ended");
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
      setStatusAndNotify("Ended");
      cleanup();
    }
  }

  function end() {
    send({ type: "session.close" });
    setStatusAndNotify("Ended");
    cleanup();
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-3">
      <audio ref={audioRef} autoPlay />
      {running && <p className="text-sm text-zinc-500">{status}</p>}
      {(userCaption || assistantCaption) && (
        <div className="w-full space-y-1 text-center">
          {userCaption && <p className="text-lg text-zinc-500">Marie: {userCaption}</p>}
          {assistantCaption && <p className="text-lg text-zinc-300">Hearth: {assistantCaption}</p>}
        </div>
      )}
      {running ? (
        <button
          type="button"
          onClick={end}
          className="rounded-full border border-zinc-700 px-6 py-2 text-sm text-zinc-300"
        >
          End
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="rounded-full bg-zinc-100 px-6 py-2 text-sm font-medium text-zinc-900"
        >
          Start voice
        </button>
      )}
      {errorMessage && <p className="text-xs text-zinc-600">{errorMessage}</p>}
    </div>
  );
}
