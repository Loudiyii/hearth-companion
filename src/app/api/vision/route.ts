import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAI } from "@/integrations/openai";

const Body = z
  .object({
    elderId: z.string(),
    imageBase64: z.string().min(1).optional(),
    /** oldest first, spanning the last ~2-3 s */
    frames: z.array(z.string().min(1)).min(1).max(5).optional(),
  })
  .refine((b) => b.imageBase64 || b.frames, { message: "imageBase64 or frames required" });

const VisionResult = z.object({
  posture: z.enum(["standing", "sitting", "lying", "on_floor", "unknown"]),
  moving: z.boolean(),
  confidence: z.number(),
  note: z.string(),
  scene: z.string(),
  fell: z.boolean().optional(),
});

const PROMPT = `You are given camera frames of a room, oldest first, spanning the last
few seconds (there may be only one). Report strictly as JSON with these exact
keys, describing the LATEST frame and using the earlier ones for motion:
"posture" (one of "standing", "sitting", "lying", "on_floor", "unknown"),
"moving" (boolean), "fell" (boolean: true only if the sequence shows a sudden
collapse or the person ending up on the floor unintentionally — not sitting
down, kneeling, or stretching on purpose), "confidence" (0 to 1), "note" (a
short factual observation), and "scene" (one short, plain sentence about the
person — where they are, what they are doing, notable clothing colour; use
"No one visible." if nobody is in frame). Do not diagnose or speculate about
health. If no person is visible, use posture "unknown" and low confidence.`;

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const visionModel = process.env.OPENAI_VISION_MODEL ?? "gpt-5.6-luna";
    const completion = await getOpenAI().chat.completions.create({
      model: visionModel,
      // gpt-5.x models reason by default; the frame loop needs the fast path
      ...(visionModel.startsWith("gpt-5") ? { reasoning_effort: "none" as const } : {}),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            ...(parsed.data.frames ?? [parsed.data.imageBase64 as string]).map((b64) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" as const },
            })),
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
