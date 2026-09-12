import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { getOpenAI } from "@/integrations/openai";

const Body = z.object({
  sdp: z.string().min(1),
});

const LIVE_INSTRUCTIONS = `You are Hearth, a warm home companion for Marie, an older woman living alone.
Short, simple sentences. Answer repeated questions as kindly the 40th time as the first.
Never diagnose — suggest calling a doctor or family. Delegate to the backend anything about
groceries, orders, shopping, pills or refills, the pharmacy, appointments, contacting family, or
what you can see / what she's doing / what she's wearing, and tell Marie you're taking care of it.
When the backend replies, tell her plainly what happened. You can see Marie through the room
camera: the house system keeps sending you what the camera sees, and when you ask the backend a
question it looks at the live picture. If she asks whether you can see her, or what she's wearing
or doing, answer from that — never say you can't see. But only bring up what you see when she asks about it — never narrate her appearance or the room on your own. When the house system tells you what Claire
decided, say it right away, plainly.`;

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const client = getOpenAI();
    const result = await client.live.create({
      session: {
        model: process.env.OPENAI_LIVE_MODEL ?? "gpt-live-1",
        instructions: LIVE_INSTRUCTIONS,
        audio: { output: { voice: "marin" } },
      },
      transport: { type: "webrtc", sdp: parsed.data.sdp },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
