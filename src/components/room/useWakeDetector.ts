"use client";

import { useEffect, useRef, useState } from "react";

/** RMS above this is considered "someone is speaking". Tune 0.02–0.04. */
export const VAD_RMS_THRESHOLD = 0.03;
const VAD_SUSTAIN_MS = 300;
const VAD_POLL_MS = 100;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Local, always-on voice-activity detector used while the companion is
 * ASLEEP. Never run this while AWAKE — the GPT-Live session's own audio
 * output would otherwise be picked up by the mic and re-trigger it.
 */
export function useWakeDetector({
  enabled,
  onWake,
}: {
  enabled: boolean;
  onWake: () => void;
}): { error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function teardown() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (ctx && ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
      ctx = null;
    }

    async function setup() {
      setError(null);
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Microphone unavailable — voice wake disabled.");
        return;
      }
      const AudioCtx = getAudioContextCtor();
      if (!AudioCtx) {
        setError("AudioContext unavailable — voice wake disabled.");
        return;
      }
      try {
        const gotStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          gotStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = gotStream;
        ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        let aboveSince: number | null = null;

        intervalId = setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            sumSquares += data[i] * data[i];
          }
          const rms = Math.sqrt(sumSquares / data.length);
          const now = Date.now();
          if (rms > VAD_RMS_THRESHOLD) {
            if (aboveSince === null) {
              aboveSince = now;
            } else if (now - aboveSince >= VAD_SUSTAIN_MS) {
              aboveSince = null;
              // Release the mic before the caller opens its own capture
              // (e.g. the GPT-Live session) so only one is ever active.
              teardown();
              onWakeRef.current();
            }
          } else {
            aboveSince = null;
          }
        }, VAD_POLL_MS);
      } catch {
        if (!cancelled) setError("Microphone unavailable — voice wake disabled.");
      }
    }

    void setup();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [enabled]);

  return { error };
}
