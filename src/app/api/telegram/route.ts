import { NextRequest, NextResponse } from "next/server";
import { decodeCallback } from "@/contracts";
import { handleTap } from "@/server/tap";
import { getBot, editResult } from "@/integrations/telegram";

type TelegramUpdate = {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number };
    message?: { message_id: number; chat: { id: number } };
  };
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("Telegram webhook: secret token mismatch, ignoring update");
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const cq = update?.callback_query;

  if (!cq || !cq.data || !cq.message) {
    return NextResponse.json({ ok: true });
  }

  const decoded = decodeCallback(cq.data);
  if (!decoded) {
    await getBot().api.answerCallbackQuery(cq.id, { text: "Unknown action" }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const id = decoded.action === "ack" ? decoded.incidentId : decoded.approvalId;
  const actorId = cq.from ? String(cq.from.id) : "telegram";
  const chatId = String(cq.message.chat.id);
  const messageId = cq.message.message_id;

  try {
    const result = await handleTap({ action: decoded.action, id, actorId });
    console.info(`Telegram tap ${decoded.action} ${id}: ${result.ok ? "ok" : "refused"} — ${result.message}`);
    await getBot().api.answerCallbackQuery(cq.id, { text: result.message }).catch(() => {});
    await editResult(chatId, messageId, result.message);
  } catch (err) {
    console.warn("Telegram webhook handling failed", err);
    await getBot().api.answerCallbackQuery(cq.id, { text: "Something went wrong" }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
