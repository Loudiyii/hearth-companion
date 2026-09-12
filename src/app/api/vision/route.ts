import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAI } from "@/integrations/openai";

const Body = z.object({
  elderId: z.string(),
  imageBase64: z.string().min(1),
});

const VisionResult = z.object({
  posture: z.enum(["standing", "sitting", "lying", "on_floor", "unknown"]),
  moving: z.boolean(),
  confidence: z.number(),
  note: z.string(),
  scene: z.string(),
});

const PROMPT = `Look at this single camera frame of a room. Report strictly as JSON with
these exact keys: "posture" (one of "standing", "sitting", "lying", "on_floor",
"unknown"), "moving" (boolean, whether the person appears to be in motion),
"confidence" (number between 0 and 1), "note" (a short factual observation), and
"scene" (one short, plain sentence describing what the camera sees about the
person — where they are in the room, what they appear to be doing, and any
notable clothing colour; use "No one visible." if nobody is in frame).
Do not diagnose or speculate about health. If no person is visible, use posture
"unknown" and low confidence.`;

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${parsed.data.imageBase64}` },
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonResult = JSON.parse(raw);
    const result = VisionResult.parse(jsonResult);
    const clamped = {
      ...result,
      confidence: Math.min(1, Math.max(0, result.confidence)),
    };

    return NextResponse.json(clamped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
