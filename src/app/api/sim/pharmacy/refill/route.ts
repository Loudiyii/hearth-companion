import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({ medication: z.string().min(1) });

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const refillId = `refill_${Math.random().toString(36).slice(2, 10)}`;
  const readyAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return NextResponse.json({
    refillId,
    readyAt,
    pharmacy: "Pharmacie Oberkampf",
  });
}
