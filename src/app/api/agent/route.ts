import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/server/agent";

const Body = z.object({
  elderId: z.string(),
  text: z.string().min(1),
  imageBase64: z.string().min(1).optional(),
  scene: z.string().max(400).optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await runAgent(parsed.data.elderId, parsed.data.text, parsed.data.imageBase64, parsed.data.scene);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
