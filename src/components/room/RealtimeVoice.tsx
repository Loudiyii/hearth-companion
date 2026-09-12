"use client";

import { useRef, useState } from "react";

type VoiceState = "idle" | "connecting" | "connected" | "error";

export function RealtimeVoice() {
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function start() {
    setState("connecting");
    setMessage(null);
    try {
      const tokenRes = await fetch("/api/realtime/token", { method: "POST" });
      if (!tokenRes.ok) throw new Error("token request failed");
      const session = await tokenRes.json();
      const clientSecret: string | undefined = session?.value ?? session?.client_secret?.value;
      if (!clientSecret) throw new Error("no client secret returned");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
        }
      };

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      pc.createDataChannel("oai-events");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
        }
      );
      if (!sdpRes.ok) throw new Error("realtime handshake failed");
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setState("connected");
    } catch {
      setState("error");
      setMessage("Voice call didn't connect — you can still type below.");
      pcRef.current?.close();
      pcRef.current = null;
    }
  }

  function stop() {
    pcRef.current?.close();
    pcRef.current = null;
    setState("idle");
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <audio ref={audioRef} autoPlay />
      {state === "connected" ? (
        <button
          type="button"
          onClick={stop}
          className="rounded-full border border-zinc-700 px-6 py-2 text-sm text-zinc-300"
        >
          End voice call
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={state === "connecting"}
          className="rounded-full border border-zinc-700 px-6 py-2 text-sm text-zinc-300 disabled:opacity-50"
        >
          {state === "connecting" ? "Connecting…" : "Start voice"}
        </button>
      )}
      {message && <p className="text-xs text-zinc-600">{message}</p>}
    </div>
  );
}
