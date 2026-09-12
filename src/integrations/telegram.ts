import { Bot, InlineKeyboard, InputFile } from "grammy";
import { encodeCallback, type Approval, type Basket, type Incident } from "@/contracts";

let cached: Bot | null = null;
/** Lazy: constructing grammY's Bot with an empty token throws, and Next evaluates route modules at build time. */
export function getBot(): Bot {
  if (!cached) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    cached = new Bot(token);
  }
  return cached;
}

export function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export async function sendApprovalRequest(
  approval: Approval,
  basket: Basket,
  chatId: string
): Promise<{ messageId: number }> {
  const items = basket.items.map((i) => `• ${i.qty}× ${i.name}`).join("\n");
  const text = [
    "Approval needed",
    items,
    `Total: ${formatEuros(approval.totalCents)} (limit ${formatEuros(approval.limitCents)}, over by ${formatEuros(approval.excessCents)})`,
  ].join("\n\n");
  const keyboard = new InlineKeyboard()
    .text("Approve", encodeCallback({ action: "approve", approvalId: approval.id }))
    .text("Reject", encodeCallback({ action: "reject", approvalId: approval.id }));
  const message = await getBot().api.sendMessage(chatId, text, { reply_markup: keyboard });
  return { messageId: message.message_id };
}

export async function sendIncidentAlert(
  incident: Incident,
  chatId: string,
  opts: { reason?: string; photoBase64?: string } = {}
): Promise<{ messageId: number }> {
  const when = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const text = [
    `Marie may need help (${when}).`,
    `Camera: ${incident.note}.`,
    opts.reason ?? "No answer to the check-in.",
  ].join("\n");
  const keyboard = new InlineKeyboard().text(
    "I'm on it",
    encodeCallback({ action: "ack", incidentId: incident.id })
  );
  const api = getBot().api;
  if (opts.photoBase64) {
    try {
      const photo = new InputFile(Buffer.from(opts.photoBase64, "base64"), "room.jpg");
      const message = await api.sendPhoto(chatId, photo, { caption: text, reply_markup: keyboard });
      return { messageId: message.message_id };
    } catch (err) {
      console.warn("sendPhoto failed, falling back to text", err);
    }
  }
  const message = await api.sendMessage(chatId, text, { reply_markup: keyboard });
  return { messageId: message.message_id };
}

export async function editResult(
  chatId: string,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await getBot().api.editMessageText(chatId, messageId, text);
  } catch {
    // message may already be edited/deleted; ignore
  }
}
