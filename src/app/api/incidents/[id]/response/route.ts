import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordCheckInResponse } from "@/server/escalation";

const Body = z.object({
  response: z.string().nullable(),
  imageBase64: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await recordCheckInResponse(id, parsed.data.response, parsed.data.imageBase64);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
