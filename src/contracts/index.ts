/**
 * Shared contracts — the only file every part of the system imports.
 * Companion (room) → backend → Telegram / Stripe / Trigger.dev → dashboard.
 *
 * Rules:
 *  - money is integer cents, never floats
 *  - Approval and Payment are separate state machines
 *  - an Approval is consumed exactly once, atomically, and only before expiresAt
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Companion → backend events
// ---------------------------------------------------------------------------

export const UtteranceEvent = z.object({
  type: z.literal("utterance"),
  elderId: z.string(),
  text: z.string().min(1),
  at: z.string().datetime(),
});

/** Vision only ever emits a *candidate*. Confidence is an estimate, not a probability. */
export const PersonOnFloorCandidateEvent = z.object({
  type: z.literal("person_on_floor_candidate"),
  elderId: z.string(),
  confidence: z.number().min(0).max(1),
  note: z.string(),
  at: z.string().datetime(),
});

export type UtteranceEvent = z.infer<typeof UtteranceEvent>;
export type PersonOnFloorCandidateEvent = z.infer<typeof PersonOnFloorCandidateEvent>;

export const CompanionEvent = z.discriminatedUnion("type", [
  UtteranceEvent,
  PersonOnFloorCandidateEvent,
]);
export type CompanionEvent = z.infer<typeof CompanionEvent>;

// ---------------------------------------------------------------------------
// 2. Money — baskets, approvals, payments
// ---------------------------------------------------------------------------

export const BasketItem = z.object({
  name: z.string(),
  qty: z.number().int().positive(),
  unitCents: z.number().int().nonnegative(),
});
export type BasketItem = z.infer<typeof BasketItem>;

export const Basket = z.object({
  id: z.string(),
  elderId: z.string(),
  items: z.array(BasketItem).min(1),
  totalCents: z.number().int().nonnegative(),
  /** sha256 of the canonical items JSON — a frozen quote */
  quoteHash: z.string(),
  createdAt: z.string().datetime(),
});
export type Basket = z.infer<typeof Basket>;

export const ApprovalStatus = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CONSUMED",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Approval = z.object({
  id: z.string(),
  elderId: z.string(),
  approverId: z.string(),
  basketId: z.string(),
  quoteHash: z.string(),
  totalCents: z.number().int(),
  limitCents: z.number().int(),
  excessCents: z.number().int(),
  status: ApprovalStatus,
  expiresAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  consumedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Approval = z.infer<typeof Approval>;

export const PaymentStatus = z.enum([
  "NOT_STARTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const Payment = z.object({
  id: z.string(),
  basketId: z.string(),
  /** null when the basket was within budget and needed no approval */
  approvalId: z.string().nullable(),
  amountCents: z.number().int(),
  status: PaymentStatus,
  /** = approvalId when present, else basketId — never charge the same thing twice */
  stripeIdempotencyKey: z.string(),
  stripePaymentIntentId: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Payment = z.infer<typeof Payment>;

// ---------------------------------------------------------------------------
// 3. Incidents (camera / check-in) and the activity feed
// ---------------------------------------------------------------------------

export const IncidentStatus = z.enum([
  "DETECTED",
  "CHECKING",
  "RESOLVED_OK",
  "ESCALATED",
  "ACKNOWLEDGED",
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const Incident = z.object({
  id: z.string(),
  elderId: z.string(),
  kind: z.literal("person_on_floor_candidate"),
  confidence: z.number(),
  note: z.string(),
  status: IncidentStatus,
  elderResponse: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Incident = z.infer<typeof Incident>;

/** One row per thing the agent did. The dashboard subscribes to this table via Supabase Realtime. */
export const ActivityKind = z.enum([
  "utterance",
  "basket_built",
  "within_budget",
  "over_budget",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "approval_expired",
  "approval_duplicate_tap_ignored",
  "payment_processing",
  "payment_succeeded",
  "payment_failed",
  "companion_said",
  "incident_detected",
  "incident_checking",
  "incident_resolved_ok",
  "incident_escalated",
  "incident_acknowledged",
  "refill_requested",
  "refill_confirmed",
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const Activity = z.object({
  id: z.string(),
  elderId: z.string(),
  kind: ActivityKind,
  /** short, human, present tense — this is what the projector shows */
  message: z.string(),
  refId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof Activity>;

// ---------------------------------------------------------------------------
// 4. Agent tools (OpenAI function calling) — names and argument shapes
// ---------------------------------------------------------------------------

export const ToolArgs = {
  build_basket: z.object({
    items: z.array(z.object({ name: z.string(), qty: z.number().int().positive() })),
  }),
  request_approval: z.object({ basketId: z.string() }),
  checkout: z.object({ basketId: z.string(), approvalId: z.string().nullable() }),
  check_in: z.object({ incidentId: z.string(), question: z.string() }),
  alert_family: z.object({ incidentId: z.string() }),
  request_refill: z.object({ medication: z.string() }),
  find_pharmacy: z.object({ near: z.string() }),
} as const;
export type ToolName = keyof typeof ToolArgs;

// ---------------------------------------------------------------------------
// 5. Telegram callback payloads (inline buttons)
// ---------------------------------------------------------------------------

export const TelegramCallback = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), approvalId: z.string() }),
  z.object({ action: z.literal("reject"), approvalId: z.string() }),
  z.object({ action: z.literal("ack"), incidentId: z.string() }),
]);
export type TelegramCallback = z.infer<typeof TelegramCallback>;

/** Encode/decode callback_data (Telegram limits it to 64 bytes). */
export function encodeCallback(c: TelegramCallback): string {
  if (c.action === "ack") return `ack:${c.incidentId}`;
  return `${c.action}:${c.approvalId}`;
}
export function decodeCallback(data: string): TelegramCallback | null {
  const [action, id] = data.split(":");
  if (!id) return null;
  if (action === "approve" || action === "reject") return { action, approvalId: id };
  if (action === "ack") return { action, incidentId: id };
  return null;
}
