import type { Activity, Approval, Basket, Incident, Payment } from "@/contracts";

export function mapBasket(row: {
  id: string;
  elder_id: string;
  items: unknown;
  total_cents: number;
  quote_hash: string;
  created_at: string;
}): Basket {
  return {
    id: row.id,
    elderId: row.elder_id,
    items: row.items as Basket["items"],
    totalCents: row.total_cents,
    quoteHash: row.quote_hash,
    createdAt: row.created_at,
  };
}

export function mapApproval(row: {
  id: string;
  elder_id: string;
  approver_id: string;
  basket_id: string;
  quote_hash: string;
  total_cents: number;
  limit_cents: number;
  excess_cents: number;
  status: Approval["status"];
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
  created_at: string;
}): Approval {
  return {
    id: row.id,
    elderId: row.elder_id,
    approverId: row.approver_id,
    basketId: row.basket_id,
    quoteHash: row.quote_hash,
    totalCents: row.total_cents,
    limitCents: row.limit_cents,
    excessCents: row.excess_cents,
    status: row.status,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export function mapPayment(row: {
  id: string;
  basket_id: string;
  approval_id: string | null;
  amount_cents: number;
  status: Payment["status"];
  stripe_idempotency_key: string;
  stripe_payment_intent_id: string | null;
  receipt_url: string | null;
  failure_reason: string | null;
  created_at: string;
}): Payment {
  return {
    id: row.id,
    basketId: row.basket_id,
    approvalId: row.approval_id,
    amountCents: row.amount_cents,
    status: row.status,
    stripeIdempotencyKey: row.stripe_idempotency_key,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    receiptUrl: row.receipt_url,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export function mapIncident(row: {
  id: string;
  elder_id: string;
  kind: Incident["kind"];
  confidence: number;
  note: string;
  status: Incident["status"];
  elder_response: string | null;
  acknowledged_by: string | null;
  created_at: string;
  updated_at: string;
}): Incident {
  return {
    id: row.id,
    elderId: row.elder_id,
    kind: row.kind,
    confidence: row.confidence,
    note: row.note,
    status: row.status,
    elderResponse: row.elder_response,
    acknowledgedBy: row.acknowledged_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapActivity(row: {
  id: string;
  elder_id: string;
  kind: Activity["kind"];
  message: string;
  ref_id: string | null;
  created_at: string;
}): Activity {
  return {
    id: row.id,
    elderId: row.elder_id,
    kind: row.kind,
    message: row.message,
    refId: row.ref_id,
    createdAt: row.created_at,
  };
}
