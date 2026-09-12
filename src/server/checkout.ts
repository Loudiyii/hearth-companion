import {
  getBasket,
  getBudget,
  createApproval,
  consumeApproval,
  createPayment,
  markPayment,
  logActivity,
} from "@/domain";
import { charge } from "@/integrations/stripe";
import { sendApprovalRequest } from "@/integrations/telegram";
import type { Approval, Payment } from "@/contracts";

export type CheckoutResult =
  | { ok: true; payment: Payment }
  | {
      ok: false;
      reason: "approval_required" | "approval_not_consumable" | "payment_failed";
      approval?: Approval;
      payment?: Payment;
    };

export async function checkout(
  basketId: string,
  approvalId: string | null
): Promise<CheckoutResult> {
  const basket = await getBasket(basketId);
  if (!basket) {
    throw new Error(`Basket not found: ${basketId}`);
  }
  const budget = await getBudget(basket.elderId);

  if (approvalId == null && basket.totalCents > budget.limitCents) {
    const approval = await createApproval(basket, 15);
    await logActivity(basket.elderId, "over_budget", "This order is over the weekly budget.", basket.id);
    let messageId: number | undefined;
    try {
      const sent = await sendApprovalRequest(approval, basket, budget.approverChatId);
      messageId = sent.messageId;
    } catch (err) {
      console.warn("Failed to send Telegram approval request", err);
    }
    try {
      const { expireApprovalTask } = await import("../../trigger/expire-approval");
      await expireApprovalTask.trigger(
        { approvalId: approval.id, chatId: budget.approverChatId, messageId: messageId ?? null },
        { delay: "15m" }
      );
    } catch (err) {
      console.warn("Trigger.dev not configured; skipping expireApproval enqueue", err);
    }
    await logActivity(basket.elderId, "approval_requested", "Asked Claire to approve this order.", approval.id);
    return { ok: false, reason: "approval_required", approval };
  }

  let approval: Approval | null = null;
  if (approvalId != null) {
    approval = await consumeApproval(approvalId);
    if (!approval) {
      await logActivity(basket.elderId, "approval_duplicate_tap_ignored", "This approval was already used or has expired.", approvalId);
      return { ok: false, reason: "approval_not_consumable" };
    }
    if (approval.quoteHash !== basket.quoteHash) {
      await logActivity(basket.elderId, "approval_duplicate_tap_ignored", "The approved quote no longer matches the basket.", approvalId);
      return { ok: false, reason: "approval_not_consumable" };
    }
  }

  const idempotencyKey = approval?.id ?? basket.id;
  const { payment, created } = await createPayment(basket, approval?.id ?? null);

  if (!created && payment.status === "SUCCEEDED") {
    return { ok: true, payment };
  }

  await markPayment(payment.id, "PROCESSING");
  await logActivity(basket.elderId, "payment_processing", "Charging the card.", payment.id);

  try {
    const result = await charge(basket.totalCents, idempotencyKey, `Hearth order ${basket.id}`);
    const succeeded = await markPayment(payment.id, "SUCCEEDED", {
      stripePaymentIntentId: result.id,
      receiptUrl: result.receiptUrl ?? undefined,
    });
    const etaText = deliveryEtaText();
    await logActivity(basket.elderId, "payment_succeeded", `Payment went through. ${etaText}`, succeeded.id);
    return { ok: true, payment: succeeded };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const failed = await markPayment(payment.id, "FAILED", { failureReason });
    await logActivity(basket.elderId, "payment_failed", "Payment failed.", failed.id);
    return { ok: false, reason: "payment_failed", approval: approval ?? undefined, payment: failed };
  }
}

/** The simulated shop delivers about two hours after payment. */
function deliveryEtaText(): string {
  const eta = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const hhmm = eta.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  return `Delivery in about two hours, around ${hhmm}.`;
}
