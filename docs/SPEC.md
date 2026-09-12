# Hearth Companion — build spec

Elder-care voice + camera agent with **bounded spending**: the agent acts within a weekly limit; above it, a relative approves once on Telegram. Approval is single-use and expires. See `docs/` for the blueprint; this file is the engineering contract.

## Stack

Next.js 16 (App Router, `src/`) on Vercel · Supabase (Postgres + Realtime) · OpenAI (Realtime voice, mini vision, tools) · Telegram (grammY) · Stripe **test mode** · Auth0 (identity + role only) · Trigger.dev (expiry notice, escalation) · CopilotKit (family dashboard) · Exa (stretch).

Shared types live in `src/contracts/index.ts` (zod). **Import from there; never redeclare.**

## Folder ownership (do not edit outside your folders)

| Owner | Folders |
|---|---|
| **A — data + domain** | `supabase/`, `src/lib/supabase-admin.ts`, `src/domain/`, `scripts/` |
| **B — integrations + API** | `src/integrations/`, `src/server/`, `src/app/api/**` (except `api/copilotkit`), `trigger/`, `trigger.config.ts` |
| **C — UI** | `src/app/page.tsx`, `src/app/room/`, `src/app/family/`, `src/app/api/copilotkit/`, `src/components/`, `src/lib/supabase-browser.ts`, `src/app/globals.css` |

Shared, already written: `src/contracts/index.ts`, `.env.example`, this file.

## Money rules (non-negotiable)

- integer cents everywhere
- a basket is a **frozen quote** (`quoteHash` = sha256 of canonical items JSON); checkout charges the snapshot
- budget is read from the DB per request, never from a token claim
- **Approval** and **Payment** are separate state machines
- consume is one atomic statement: `UPDATE approvals SET status='CONSUMED', consumed_at=now() WHERE id=$1 AND status='APPROVED' AND expires_at > now() RETURNING *` — zero rows ⇒ refuse (double tap, expired, or never approved)
- Stripe idempotency key = `approvalId` when there is one, else `basketId`

## Database (owner A) — `supabase/migrations/0001_init.sql`

Tables (snake_case columns; `created_at timestamptz default now()`):

- `elders(id text pk, display_name text, telegram_chat_id text null)`
- `approvers(id text pk, elder_id text fk, display_name text, telegram_chat_id text)`
- `budgets(elder_id text pk fk, weekly_limit_cents int not null)`
- `catalog(sku text pk, name text, unit_cents int)` — the simulated shop's prices
- `usual_list(elder_id text fk, sku text fk, qty int, primary key(elder_id, sku))`
- `baskets(id uuid pk default gen_random_uuid(), elder_id, items jsonb, total_cents int, quote_hash text, created_at)`
- `approvals(id uuid pk, elder_id, approver_id, basket_id uuid fk, quote_hash text, total_cents int, limit_cents int, excess_cents int, status text check in (PENDING,APPROVED,REJECTED,EXPIRED,CONSUMED), expires_at timestamptz, decided_at null, consumed_at null, created_at)`
- `payments(id uuid pk, basket_id fk, approval_id uuid null fk, amount_cents int, status text check in (NOT_STARTED,PROCESSING,SUCCEEDED,FAILED), stripe_idempotency_key text **unique**, stripe_payment_intent_id text null, receipt_url text null, failure_reason text null, created_at)`
- `incidents(id uuid pk, elder_id, kind text, confidence real, note text, status text check in (DETECTED,CHECKING,RESOLVED_OK,ESCALATED,ACKNOWLEDGED), elder_response text null, acknowledged_by text null, created_at, updated_at)`
- `activity(id uuid pk, elder_id, kind text, message text, ref_id text null, created_at)` — **enable Realtime** on `activity`, `approvals`, `incidents`, `payments` (`alter publication supabase_realtime add table …`).

Seed (`supabase/seed.sql`): elder `marie` ("Marie"), approver `claire` (chat id from env placeholder `'REPLACE_ME'`), budget 6000, a 12-item catalog in euros that sums to **8400 cents** for the usual list (so the demo goes over the 6000 limit by 2400), plus 1 cheap item set that stays under budget.

RLS: enable on all tables; service role bypasses; anon gets `select` on `activity`, `approvals`, `incidents`, `payments` (dashboard reads via anon + Realtime — fine for a demo, note it in a comment).

## Domain API (owner A implements; B calls) — `src/domain/*.ts`

All server-only, use `supabaseAdmin()` from `src/lib/supabase-admin.ts` (service role). Map snake_case rows to the camelCase contract types.

```ts
// budget.ts
getBudget(elderId): Promise<{ limitCents: number; approverId: string; approverChatId: string }>
// basket.ts
buildBasket(elderId, items: {name: string; qty: number}[]): Promise<Basket>   // prices from catalog by name (case-insensitive); unknown item ⇒ throw
buildUsualBasket(elderId): Promise<Basket>
getBasket(id): Promise<Basket | null>
// approval.ts
createApproval(basket: Basket, ttlMinutes = 15): Promise<Approval>           // reads budget; excess = total - limit
getApproval(id): Promise<Approval | null>
decideApproval(id, decision: "approve" | "reject", approverId): Promise<{ outcome: "decided" | "already_decided" | "expired" | "not_found"; approval: Approval | null }>
   // atomic: UPDATE … WHERE id AND status='PENDING' AND expires_at > now(); if 0 rows, read the row to classify
consumeApproval(id): Promise<Approval | null>                                 // the atomic statement above; null ⇒ refuse
expireApproval(id): Promise<boolean>                                          // PENDING → EXPIRED only
listPendingExpired(): Promise<Approval[]>
// payment.ts
createPayment(basket: Basket, approvalId: string | null): Promise<{ payment: Payment; created: boolean }>  // upsert on stripe_idempotency_key; created=false if it already existed
markPayment(id, status: PaymentStatus, patch?: { stripePaymentIntentId?; receiptUrl?; failureReason? }): Promise<Payment>
// incident.ts
createIncident(elderId, confidence, note): Promise<Incident>
updateIncident(id, patch: Partial<Pick<Incident,"status"|"elderResponse"|"acknowledgedBy">>): Promise<Incident>
getIncident(id): Promise<Incident | null>
// activity.ts
logActivity(elderId, kind: ActivityKind, message: string, refId?: string): Promise<Activity>
```

`src/domain/index.ts` re-exports everything.

## Server orchestration (owner B) — `src/server/*.ts`

```ts
// checkout.ts — the money path
checkout(basketId, approvalId: string | null): Promise<{ ok: true; payment: Payment } | { ok: false; reason: "approval_required" | "approval_not_consumable" | "payment_failed"; approval?: Approval; payment?: Payment }>
  // 1. basket = getBasket; budget = getBudget
  // 2. if approvalId == null and total > limit ⇒ createApproval, send Telegram request, logActivity(over_budget, approval_requested) ⇒ {ok:false, approval_required}
  // 3. if approvalId: consumeApproval ⇒ null ⇒ logActivity(approval_duplicate_tap_ignored) ⇒ {ok:false, approval_not_consumable}
  //    also verify approval.quoteHash === basket.quoteHash
  // 4. createPayment (if created=false and status SUCCEEDED ⇒ return it, never charge twice)
  // 5. markPayment PROCESSING → stripe.charge(amount, idempotencyKey) → SUCCEEDED | FAILED; logActivity each step
// agent.ts — OpenAI tool loop
runAgent(elderId, text): Promise<{ reply: string; toolCalls: {name, args, result}[] }>
  // system prompt: warm, short sentences, answers repeated questions patiently, never diagnoses
  // tools from contracts ToolArgs: build_basket / request_approval / checkout / request_refill / find_pharmacy
  // "order my groceries" ⇒ buildUsualBasket ⇒ checkout(basket.id, null) ⇒ if approval_required, reply that Claire is being asked
// escalation.ts
handleFloorCandidate(event): creates incident (DETECTED), logActivity, returns {incidentId, question: "Marie? I noticed you're on the floor. Are you okay?"}
recordCheckInResponse(incidentId, response: string | null): if response non-empty ⇒ RESOLVED_OK; else ESCALATED + Telegram alert with [I'm on it] button
```

### API routes (owner B) — `src/app/api/**/route.ts`

| Route | Body → Result |
|---|---|
| `POST /api/agent` | `{ elderId, text }` → `{ reply, toolCalls }` |
| `POST /api/telegram` | Telegram update (verify `X-Telegram-Bot-Api-Secret-Token`); callback `approve:<id>` ⇒ decideApproval then **checkout(basketId, id)**; `reject:<id>`; `ack:<incidentId>` ⇒ ACKNOWLEDGED. Edit the message to show the result. Always 200. |
| `POST /api/approvals/[id]/consume` | dev/manual: runs checkout for that approval |
| `POST /api/dev/tap` | `{ action: "approve"\|"reject"\|"ack", id }` — simulates a Telegram tap (same code path as the webhook). **Only when `NODE_ENV !== "production"` or `DEV_TAP_SECRET` header matches.** |
| `POST /api/realtime/token` | → ephemeral OpenAI Realtime client secret (`POST https://api.openai.com/v1/realtime/sessions`) with the companion system prompt + tool definitions |
| `POST /api/vision` | `{ elderId, imageBase64 }` → `{ posture: "standing"\|"sitting"\|"lying"\|"on_floor"\|"unknown", moving: boolean, confidence: number, note }` via `OPENAI_VISION_MODEL` with `response_format: json_object`. **Stateless** — debounce lives in the browser. |
| `POST /api/incidents` | `CompanionEvent` of type `person_on_floor_candidate` → `handleFloorCandidate` → `{ incidentId, question }` |
| `POST /api/incidents/[id]/response` | `{ response: string \| null }` → `recordCheckInResponse` |
| `GET /api/sim/shop` | catalog; `POST /api/sim/shop/order` `{ basketId }` → `{ orderId, eta }` |
| `POST /api/sim/pharmacy/refill` | `{ medication }` → `{ refillId, readyAt, pharmacy }` |
| `GET /api/telegram/setup` | one-shot: sets the webhook to `${APP_URL}/api/telegram` with the secret; returns Telegram's answer |

### Integrations (owner B) — `src/integrations/*.ts`

- `telegram.ts` — grammY `Bot` (no polling); `sendApprovalRequest(approval, basket, chatId)` with inline keyboard `[Approve][Reject]` using `encodeCallback`; `sendIncidentAlert(incident, chatId)` with `[I'm on it]`; `editResult(chatId, messageId, text)`.
- `stripe.ts` — `charge(amountCents, idempotencyKey, description)` → PaymentIntent with `confirm: true`, `payment_method: STRIPE_PAYMENT_METHOD`, `automatic_payment_methods: { enabled: true, allow_redirects: "never" }`, `{ idempotencyKey }` request option. Returns `{ id, status, receiptUrl }` or throws with message.
- `openai.ts` — one client; `OPENROUTER_API_KEY` fallback via `baseURL` if `OPENAI_API_KEY` is empty.
- `exa.ts` — `findPharmacy(near)` (stretch; return a stub if no key).

### Trigger.dev (owner B) — `trigger/*.ts`

- `expireApproval` — delayed task (`delay: "15m"`) → `expireApproval(id)`; if it flipped, `logActivity(approval_expired)` and edit the Telegram message.
- `escalateIfSilent` — delayed `20s` after a check-in; if incident still `CHECKING` ⇒ `recordCheckInResponse(id, null)`.
Enqueue from `checkout.ts` and `escalation.ts` **inside try/catch** — if Trigger isn't configured, log and continue. Nothing must depend on Trigger to be correct.

## UI (owner C)

- `/` — two big links: "Marie's room" → `/room`, "Family" → `/family`. Minimal.
- `/room` — the companion. **No blinking, dark calm screen, large text.**
  - webcam: `getUserMedia`, sample a frame every 4 s to a canvas → JPEG base64 → `POST /api/vision`. **Debounce in the browser**: emit `person_on_floor_candidate` only when `posture === "on_floor" || "lying"` on **2 consecutive** samples, then `POST /api/incidents`, speak the returned `question` (TTS), start a 20 s window listening for a reply → `POST /api/incidents/[id]/response`. Off-screen **"Force fall event"** button (tiny, bottom-right, low contrast) that triggers the same path.
  - voice: Realtime API over WebRTC using `POST /api/realtime/token`; audio in/out; tool calls surfaced from the data channel are forwarded to `POST /api/agent` **or** simpler v1: show a text input as fallback that posts to `/api/agent` and speaks the `reply` with `speechSynthesis`. **Ship the text fallback first**, then add Realtime.
  - a small live activity strip at the bottom (last 3 activity rows via Supabase Realtime).
- `/family` — the dashboard (this is what the projector shows).
  - three columns: **Pending approvals** (status pill, total/limit/excess in €, expires countdown), **Activity feed** (newest first, kind → icon + message, this is the projector), **Alerts** (incidents with status).
  - Supabase Realtime subscriptions on `activity`, `approvals`, `incidents`, `payments` via `src/lib/supabase-browser.ts` (anon key).
  - CopilotKit: `CopilotKit` provider + `CopilotSidebar`; `src/app/api/copilotkit/route.ts` with `CopilotRuntime` + `OpenAIAdapter`; give it `useCopilotReadable` of the current approvals/activity so a relative can ask "what did Mom order this week?".
  - buttons on a pending approval: **Approve / Reject** → `POST /api/dev/tap` (so the demo works without a phone).
- Tailwind only; no component library. Tabular numbers for money. Both themes not required — commit to a dark room page and a light dashboard.

## Acceptance test (owner A) — `scripts/acceptance-double-tap.ts`

Run with `npx tsx scripts/acceptance-double-tap.ts` against `APP_URL`:
1. `POST /api/agent { elderId: "marie", text: "Order my groceries for the week" }` → expect an `approval_requested` activity and a PENDING approval.
2. `POST /api/dev/tap { action: "approve", id }` → expect payment SUCCEEDED.
3. `POST /api/dev/tap { action: "approve", id }` **again** → expect no new payment; activity `approval_duplicate_tap_ignored`.
4. Assert exactly **one** `payments` row for that basket with status SUCCEEDED.
Print PASS/FAIL per step; exit 1 on failure.

## Conventions

- TypeScript strict; `zod` parse at every boundary (route bodies, tool args, vision JSON).
- Never `console.log` secrets. Errors return `{ error: string }` with a 4xx/5xx.
- Keep files small; one concern per file. No comments that restate the code.
