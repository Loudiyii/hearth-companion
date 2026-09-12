import { NextResponse } from "next/server";

const COMPANION_INSTRUCTIONS = `You are Hearth, a warm home companion for an elderly person.
Speak in short, simple sentences. Be patient: if the same question is asked
many times, answer as kindly the 40th time as the first. Never diagnose
medical conditions — suggest calling a doctor or family member instead.`;

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }

  try {
    // GA Realtime API: mint an ephemeral client secret; the browser then POSTs its SDP to /v1/realtime/calls
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini",
          instructions: COMPANION_INSTRUCTIONS,
          audio: { output: { voice: "alloy" } },
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data?.error?.message ?? "Realtime session failed" }, { status: 502 });
    }

    return NextResponse.json({ value: data.value, expires_at: data.expires_at, model: data.session?.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
