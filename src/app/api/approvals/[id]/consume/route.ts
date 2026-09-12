import { NextRequest, NextResponse } from "next/server";
import { checkout } from "@/server/checkout";
import { getApproval } from "@/domain";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const approval = await getApproval(id);
    if (!approval) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    const result = await checkout(approval.basketId, id);
    if (result.ok) {
      return NextResponse.json(result);
    }
    return NextResponse.json(result, { status: 409 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
