import Stripe from "stripe";

let cached: Stripe | null = null;
function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    cached = new Stripe(key);
  }
  return cached;
}

export type ChargeResult = {
  id: string;
  status: string;
  receiptUrl: string | null;
};

export async function charge(
  amountCents: number,
  idempotencyKey: string,
  description: string
): Promise<ChargeResult> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await getStripe().paymentIntents.create(
      {
        amount: amountCents,
        currency: "eur",
        description,
        confirm: true,
        payment_method: process.env.STRIPE_PAYMENT_METHOD ?? "pm_card_visa",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        expand: ["latest_charge"],
      },
      { idempotencyKey }
    );
  } catch (err) {
    const message = err instanceof Stripe.errors.StripeError ? err.message : String(err);
    throw new Error(`Stripe charge failed: ${message}`);
  }

  if (intent.status !== "succeeded" && intent.status !== "processing") {
    const reason =
      intent.last_payment_error?.message ?? `PaymentIntent ended in status ${intent.status}`;
    throw new Error(`Stripe charge declined: ${reason}`);
  }

  const latestCharge = intent.latest_charge;
  const receiptUrl =
    latestCharge && typeof latestCharge !== "string" ? latestCharge.receipt_url ?? null : null;

  return { id: intent.id, status: intent.status, receiptUrl };
}
