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
    const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview",
        voice: "alloy",
        instructions: COMPANION_INSTRUCTIONS,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data?.error?.message ?? "Realtime session failed" }, { status: 502 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
