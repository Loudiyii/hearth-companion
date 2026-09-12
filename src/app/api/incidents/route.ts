import { NextRequest, NextResponse } from "next/server";
import { CompanionEvent } from "@/contracts";
import { handleFloorCandidate } from "@/server/escalation";

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = CompanionEvent.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  if (parsed.data.type !== "person_on_floor_candidate") {
    return NextResponse.json({ error: "Unsupported event type" }, { status: 400 });
  }

  try {
    const result = await handleFloorCandidate(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
