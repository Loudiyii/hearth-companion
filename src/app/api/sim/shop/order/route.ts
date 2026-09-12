import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getBasket } from "@/domain";

const Body = z.object({ basketId: z.string() });

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const basket = await getBasket(parsed.data.basketId);
    if (!basket) {
      return NextResponse.json({ error: "Basket not found" }, { status: 404 });
    }

    const orderId = `order_${basket.id.slice(0, 8)}`;
    const eta = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    return NextResponse.json({ orderId, eta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
