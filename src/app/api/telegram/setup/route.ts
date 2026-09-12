import { NextResponse } from "next/server";
import { getBot } from "@/integrations/telegram";

export async function GET() {
  const appUrl = process.env.APP_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!appUrl || !secret) {
    return NextResponse.json({ error: "APP_URL and TELEGRAM_WEBHOOK_SECRET must be set" }, { status: 500 });
  }

  try {
    const result = await getBot().api.setWebhook(`${appUrl}/api/telegram`, {
      secret_token: secret,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
