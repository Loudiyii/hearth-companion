"use client";

import { useEffect, useState } from "react";

export type ConversationEntry = { id: string; role: "marie" | "hearth"; text: string; at: number };

const SETTLE_MS = 1400;

type Baseline = { marie: string; hearth: string };

/**
 * Turns the live (cumulative, streaming) captions into a list of finished turns.
 * A turn is closed when its caption stops changing for SETTLE_MS; only the text
 * added since the previous closed turn is logged, so nothing repeats.
 */
export function useConversationLog(captions: { user: string; assistant: string }): ConversationEntry[] {
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [baseline, setBaseline] = useState<Baseline>({ marie: "", hearth: "" });

  useEffect(() => {
    const cancelMarie = settle("marie", captions.user, baseline.marie, setEntries, setBaseline);
    return cancelMarie;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captions.user]);

  useEffect(() => {
    const cancelHearth = settle("hearth", captions.assistant, baseline.hearth, setEntries, setBaseline);
    return cancelHearth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captions.assistant]);

  return entries;
}

function settle(
  role: "marie" | "hearth",
  caption: string,
  prev: string,
  setEntries: React.Dispatch<React.SetStateAction<ConversationEntry[]>>,
  setBaseline: React.Dispatch<React.SetStateAction<Baseline>>
): () => void {
  const text = caption.trim();
  if (!text) {
    // A new session starts with an empty caption: forget this role's baseline (async, not during render).
    const reset = setTimeout(() => setBaseline((b) => (b[role] ? { ...b, [role]: "" } : b)), 0);
    return () => clearTimeout(reset);
  }
  const timer = setTimeout(() => {
    const fresh = prev && text.startsWith(prev) ? text.slice(prev.length).trim() : text;
    setBaseline((b) => ({ ...b, [role]: text }));
    if (!fresh) return;
    const at = Date.now();
    setEntries((list) => [...list, { id: `${role}-${at}`, role, text: fresh, at }].slice(-60));
  }, SETTLE_MS);
  return () => clearTimeout(timer);
}
