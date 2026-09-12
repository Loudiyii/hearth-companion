"use client";

import { useState } from "react";
import { speak } from "./speech";
import type { CompanionStatus } from "./StatusWord";

const ELDER_ID = "marie";

export function TextFallback({
  onStatusChange,
}: {
  onStatusChange: (status: CompanionStatus) => void;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    onStatusChange("Thinking");
    setText("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elderId: ELDER_ID, text: trimmed }),
      });
      const data = await res.json();
      const replyText: string = data.reply ?? "Sorry, I didn't catch that.";
      setReply(replyText);
      onStatusChange("Speaking");
      await speak(replyText);
    } catch {
      setReply("I couldn't reach the assistant just now.");
    } finally {
      onStatusChange("Listening");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-2xl">
      {reply && (
        <p className="mb-6 text-center text-2xl font-light text-zinc-400">{reply}</p>
      )}
      <form onSubmit={submit} className="flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type here to talk to me…"
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-5 text-2xl text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-zinc-100 px-8 py-5 text-2xl font-medium text-zinc-900 transition-opacity disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
