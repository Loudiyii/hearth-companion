import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleTap } from "@/server/tap";

const Body = z.object({
  action: z.enum(["approve", "reject", "ack"]),
  id: z.string(),
});

export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const secretHeader = req.headers.get("x-dev-tap-secret");
  const secretMatches =
    !!process.env.DEV_TAP_SECRET && secretHeader === process.env.DEV_TAP_SECRET;

  if (!isDev && !secretMatches) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await handleTap({ ...parsed.data, actorId: "dev-tap" });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
