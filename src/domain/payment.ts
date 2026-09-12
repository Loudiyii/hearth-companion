import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Basket, Payment, PaymentStatus } from "@/contracts";
import { mapPayment } from "./map";

export async function createPayment(
  basket: Basket,
  approvalId: string | null,
): Promise<{ payment: Payment; created: boolean }> {
  const idempotencyKey = approvalId ?? basket.id;
  const db = supabaseAdmin();

  const { data: existing, error: existingError } = await db
    .from("payments")
    .select()
    .eq("stripe_idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error(`createPayment: ${existingError.message}`);
  if (existing) {
    return { payment: mapPayment(existing), created: false };
  }

  const { data, error } = await db
    .from("payments")
    .upsert(
      {
        basket_id: basket.id,
        approval_id: approvalId,
        amount_cents: basket.totalCents,
        status: "NOT_STARTED",
        stripe_idempotency_key: idempotencyKey,
      },
      { onConflict: "stripe_idempotency_key" },
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`createPayment: ${error?.message ?? "upsert failed"}`);
  }
  return { payment: mapPayment(data), created: true };
}

export async function markPayment(
  id: string,
  status: PaymentStatus,
  patch?: { stripePaymentIntentId?: string; receiptUrl?: string; failureReason?: string },
): Promise<Payment> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("payments")
    .update({
      status,
      ...(patch?.stripePaymentIntentId !== undefined
        ? { stripe_payment_intent_id: patch.stripePaymentIntentId }
        : {}),
      ...(patch?.receiptUrl !== undefined ? { receipt_url: patch.receiptUrl } : {}),
      ...(patch?.failureReason !== undefined ? { failure_reason: patch.failureReason } : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`markPayment: ${error?.message ?? "update failed"}`);
  }
  return mapPayment(data);
}
