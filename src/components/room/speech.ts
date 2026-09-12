"use client";

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  if (typeof window === "undefined" || !window.speechSynthesis) {
    cachedVoice = null;
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith("fr")) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    voices[0] ??
    null;
  cachedVoice = preferred;
  return preferred;
}

/** Speak text slowly and calmly. Resolves when speech ends (or immediately if unsupported). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = 0.85;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

// Voice lists load asynchronously in some browsers; refresh the cache once they arrive.
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = undefined;
  };
}

interface SpeechRecognitionResultLike {
  transcript: string;
}

type RecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: RecognitionCtor;
    SpeechRecognition?: RecognitionCtor;
  };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

/**
 * Listens for a spoken reply for up to `timeoutMs`. Resolves with the transcript,
 * or null if nothing was heard / recognition is unsupported.
 */
export function listenForReply(timeoutMs = 20000): Promise<string | null> {
  return new Promise((resolve) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      resolve(null);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = false;

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
      resolve(value);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? null;
      finish(transcript);
    };
    recognition.onerror = () => finish(null);
    recognition.onend = () => finish(null);

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      recognition.start();
    } catch {
      finish(null);
    }
  });
}
