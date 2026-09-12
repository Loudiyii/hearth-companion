![Hearth Companion — Everyday independence. Family within reach.](docs/assets/hearth-banner.svg)

# Hearth Companion

**A home companion for an older person living alone. It talks, it sees, it runs her errands — and it pays for things only within limits her family set. Above the limit it stops and asks a relative. If she falls, it asks her first, then brings family in.**

Built in one day for the AI Tinkerers global hackathon **"Agents, Everywhere"** (Paris, 12 Sept 2026).

> **Thesis — bounded agency.** AI agents are about to start acting and spending for people. We built one for the person who most needs a guardrail — an older adult who can't use a phone — and the guardrail is a relative with a tap-to-approve on Telegram. The agent acts freely within limits; above them, it stops and asks. Elder care is the case, not the idea.

- **Live:** https://hearth-companion-cyan.vercel.app
- **Repo:** https://github.com/Loudiyii/hearth-companion
- Blueprint (architecture + pitch): `docs/blueprint.html` · Engineering contract: `docs/SPEC.md` · Voice: `docs/VOICE.md` · Camera partner integration: `docs/GUARDIAN_INTEGRATION.md`

---

## Table of contents

1. [What it does — the three flows](#1-what-it-does--the-three-flows)
2. [The screens](#2-the-screens)
3. [Architecture](#3-architecture)
4. [How each part works](#4-how-each-part-works)
   - [Money: approvals and payments](#41-money-approvals-and-payments)
   - [Sight: the camera pipeline](#42-sight-the-camera-pipeline)
   - [Voice: GPT-Live with client delegation](#43-voice-gpt-live-with-client-delegation)
   - [Sleep / wake](#44-sleep--wake)
   - [Fall check-in and escalation](#45-fall-check-in-and-escalation)
   - [Family channel: Telegram](#46-family-channel-telegram)
   - [Background jobs: Trigger.dev](#47-background-jobs-triggerdev)
5. [Stack and sponsor map](#5-stack-and-sponsor-map)
6. [Repository layout](#6-repository-layout)
7. [API reference](#7-api-reference)
8. [Data model](#8-data-model)
9. [Setup](#9-setup)
10. [Running and testing](#10-running-and-testing)
11. [Deploying](#11-deploying)
12. [Demo run of show](#12-demo-run-of-show)
13. [Design principles and safety rules](#13-design-principles-and-safety-rules)
14. [Known limitations](#14-known-limitations)
15. [Cost](#15-cost)

---

## 1. What it does — the three flows

**Marie** is the elder (persona). **Claire** is her daughter and *approver*. **Hearth** is the companion's voice.

### Flow 1 — Groceries over budget → approval → payment (the differentiator)

```
Marie:  "Order my groceries for the week."
Hearth: "Of course — your usual list. It's a bit over budget, so I've asked Claire."
        ▸ basket €84.00 > weekly limit €60.00 → Approval PENDING (expires in 15 min)
        ▸ Telegram to Claire: basket, total, excess, [Approve] [Reject]
Claire taps Approve
        ▸ approval consumed atomically (once, never twice) → Stripe test charge → receipt
Hearth: "Good news — Claire approved. Your groceries are paid for, delivery around 16:40."
Claire taps Approve again → "already decided", nothing charged
```

### Flow 2 — Sight

```
Marie:  "Can you see me? Do I have my glasses on? What am I wearing?"
Hearth: "Yes — you're sitting by the window in an olive green shirt, glasses on."
```
The companion only *talks* about what it sees when asked; it never narrates the room on its own.

### Flow 3 — Fall → question first → family

```
camera: person on the floor in two consecutive checks (~4 s)
        ▸ Telegram heads-up to Claire: "⚠️ Possible fall — checking with Marie now"
Hearth (speaks first): "Marie? I noticed you're on the floor. Are you okay?"
  "I'm fine, I dropped my glasses" → resolved · Telegram: "✅ False alarm"
  silence 20 s, or "I'm not okay / help / yes" → Telegram alert with a PHOTO of the room + [I'm on it]
Claire taps I'm on it
Hearth: "Claire has seen it and is on her way."
```
Marie can also ask for help in conversation at any time ("I don't feel well, can you call my family?") — same alert.

The camera never alarms directly: **it asks first.** A false alarm costs one spoken question, not a panicked relative.

---

## 2. The screens

| URL | Who looks at it | What it is |
|---|---|---|
| `/room` | Marie (laptop in her living room) | Calm, dark, huge text. No buttons to press. Wakes when she talks. Camera preview faint in a corner. |
| `/monitor` | The projector / judges / caregiver (same laptop as the camera) | The **FallGuard** console: live camera, current state, 5-step agent workflow, event journal, conversation log, demo controls (*Simuler une chute*, *La personne se relève*, *Déclencher l'alerte*, *Réinitialiser*), and **Charger une vidéo** to run the fall detector on a recorded clip. |
| `/family` | Claire (phone / laptop 2) | Pending approvals with countdown and Approve/Reject, live activity feed, alerts. CopilotKit sidebar: "What did Mom order this week?" |

All three update live from the database (Supabase Realtime).

---

## 3. Architecture

```
LAPTOP IN THE ROOM (browser)                              FAMILY
┌────────────────────────────────────────────┐            ┌────────────────────────────┐
│ /room or /monitor                          │            │ Telegram (Claire's phone)  │
│  • webcam: 1 frame/s → 3-frame burst/2 s   │            │   heads-up · approvals ·   │
│  • local VAD (wake on voice)               │            │   photo alerts · buttons   │
│  • GPT-Live over WebRTC (voice, on demand) │            ├────────────────────────────┤
│  • frame + scene attached to every ask     │            │ /family dashboard          │
└───────────────┬────────────────────────────┘            │  (CopilotKit)              │
                │ HTTPS                                    └──────────────┬─────────────┘
                ▼                                                         │ Supabase Realtime
┌─────────────────────────────────────────────────────────────────────────┴─────────────┐
│ NEXT.JS ON VERCEL (API routes)                                                        │
│ /api/agent          OpenAI tool loop: build_basket · checkout · alert_family · refill │
│ /api/vision         gpt-5.6-luna, reasoning off, 3 frames → posture/fell/scene        │
│ /api/live/session   GPT-Live session (client delegation)                              │
│ /api/telegram       webhook: Approve / Reject / I'm on it                             │
│ /api/incidents/*    fall candidates and check-in answers                              │
│ /api/sim/*          simulated shop and pharmacy                                       │
└──────┬─────────────────────────────┬─────────────────────────────┬────────────────────┘
       │                             │                             │
       ▼                             ▼                             ▼
  SUPABASE (Postgres)           STRIPE (test mode)           TRIGGER.DEV
  source of truth + event bus   one charge, idempotent       expiry notice · silence timer
```

**The database is the event bus.** The agent writes rows; every screen subscribes to row changes. Trigger.dev jobs run out-of-process and only ever read and write rows — nothing in the money path depends on them.

---

## 4. How each part works

### 4.1 Money: approvals and payments

Two separate state machines, because an approved purchase can still fail at the card.

```
Approval: PENDING ─► APPROVED ─► CONSUMED        (or REJECTED / EXPIRED)
Payment:  NOT_STARTED ─► PROCESSING ─► SUCCEEDED (or FAILED)
```

Rules that keep it honest (all enforced in code, none left to the model):

- **Integer cents**, never floats.
- **Frozen quote**: a basket carries `quote_hash` (sha256 of its items); checkout charges the snapshot. A tampered basket voids its approval.
- **Budget read from the DB per request**, never from a token claim — a limit changed on the dashboard applies immediately.
- **Atomic single-use consume** — the whole double-tap defence is one SQL statement:
  ```sql
  UPDATE approvals SET status='CONSUMED', consumed_at=now()
  WHERE id=$1 AND status='APPROVED' AND expires_at > now()
  RETURNING *;   -- zero rows ⇒ refuse (second tap, expired, never approved)
  ```
- **Stripe idempotency key = approval id** — even a retried request can't charge twice.
- **Expiry is correct without any job** (it's in the `WHERE`); Trigger.dev only sends the "it expired" notice.

Verified by `npm run test:money`: reject, expiry, tampered quote, and **5 concurrent Approve taps → exactly one charge**.

### 4.2 Sight: the camera pipeline

- The browser captures **1 frame per second** (640 px) into a rolling burst of 3, and every **2 s** sends the burst to `POST /api/vision` (never two calls in flight).
- The model is **`gpt-5.6-luna` with `reasoning_effort: "none"`** (~1.9 s per call). It returns `posture`, `moving`, **`fell`** (a sudden collapse vs sitting down on purpose — that's why it gets a sequence, not a still), `confidence`, `note`, and a one-sentence `scene`. In our tests it does *not* invent a person in an empty frame, which `gpt-4o-mini` did.
- **Two consecutive "on the floor / fell" results** (plain code, ~4 s) open an incident. A 60 s cooldown prevents repeats.
- **The companion sees, two ways.** While awake, each new `scene` is pushed silently into the voice model's context (`session.thinking.append`, "background only — do not mention unless asked"). And whenever the voice model delegates a question to the backend, the **latest full-resolution frame** (1024 px, high detail) and the scene are attached, so "what's on the table?" gets a real look.
- **"Charger une vidéo"** on `/monitor` plays a recorded clip through the *same* pipeline — rehearse a fall without lying on the floor.

Confidence is an estimate, not a probability; the event is a *candidate*, never a diagnosis.

### 4.3 Voice: GPT-Live with client delegation

Voice uses OpenAI's **GPT-Live** (`gpt-live-1`, voice *marin*) over WebRTC. The browser creates an SDP offer, `POST /api/live/session` exchanges it with OpenAI (`client.live.create`), audio flows peer-to-peer, and a data channel carries events.

**Client delegation** is the whole trick: GPT-Live holds the conversation; when Marie asks for something the house does, it emits `session.delegation.created`, the browser sends her sentence (plus the camera frame and scene) to `POST /api/agent`, and the reply comes back as `session.commentary.append`, which the voice model paraphrases aloud. So the money path, the tools and the guardrails live in *our* backend — the voice model never spends anything.

Details that came out of live testing:
- Delegations wait for the sentence to *finish arriving* (deltas quiet ~1 s, ≥3 words, max 3 s) — no more answering "So I…".
- GPT-Live delegates only clear requests; greetings, the time, small talk it handles itself.
- Backend outcomes are spoken the moment they land: Claire's approval, a rejection, an expiry, "Claire is on her way".

A **Realtime API fallback** (`gpt-realtime-2.1-mini`, `/v1/realtime/client_secrets` → `/v1/realtime/calls`) is one link away on `/room`.

### 4.4 Sleep / wake

GPT-Live is billed per second, and Marie can't press buttons. So the *voice model sleeps* and cheap watchers stay awake:

```
RESTING  — camera loop + local voice-activity detector (Web Audio RMS gate); no session open
   wake on: she starts talking · a fall candidate · a button (demo)
AWAKE    — GPT-Live session open; status word: Listening / Thinking… / Speaking / Checking on you…
   45 s without transcript activity → session.close → RESTING
```
Only one microphone capture is ever open. A fall wakes the session with an instruction to **speak first**.

### 4.5 Fall check-in and escalation

```
candidate confirmed ─► incident DETECTED ─► CHECKING (question spoken, 20 s window)
   answer classified (regex, then gpt-4.1-mini):
     "I'm fine"                     ─► RESOLVED_OK  + Telegram "✅ False alarm"
     "not okay / help / yes / hurt" ─► ESCALATED    + Telegram alert with room photo
     silence 20 s / unclear         ─► ESCALATED    + Telegram alert with room photo
Claire taps "I'm on it"              ─► ACKNOWLEDGED (spoken to Marie)
```
During a check-in the voice model is *held*: her words go to the check-in, not to the general backend, and Hearth says "I'm letting Claire know now — keep talking to me" rather than improvising advice. Emergency services are **never** called automatically; a human decides.

### 4.6 Family channel: Telegram

One bot (`@CompanionParis_bot`). Approvals and alerts carry inline buttons whose `callback_data` is `approve:<id>` / `reject:<id>` / `ack:<id>`. The webhook verifies `X-Telegram-Bot-Api-Secret-Token`, runs the same handler as the dashboard buttons, answers the callback, and edits the message with the outcome. Alerts include the camera frame (`sendPhoto`) and the reason.

(A bot cannot place Telegram *calls*; a phone call would be Twilio — deliberately out of scope.)

### 4.7 Background jobs: Trigger.dev

- `expireApproval` — 15 min after an approval is requested: flips PENDING → EXPIRED and edits the Telegram message.
- `escalateIfSilent` — 20 s after a check-in question: escalates if still unanswered.

Both are enqueued in `try/catch`; if Trigger isn't configured the system still behaves correctly (expiry is in the SQL, silence is timed in the browser).

---

## 5. Stack and sponsor map

| Piece | What | Why it's the right tool |
|---|---|---|
| **OpenAI** | GPT-Live voice · `gpt-5.6-luna` vision · `gpt-4.1-mini` agent tools · Realtime fallback | Client delegation keeps tools and money in our backend; luna judges motion from a burst and doesn't hallucinate people. |
| **Supabase** | Postgres + Realtime | Source of truth for approvals, payments, incidents, activity; Realtime makes the DB the event bus — no SSE. |
| **Vercel** | Next.js 16 app (API + all screens) | Public HTTPS from minute one (Telegram webhook), git-integrated deploys. |
| **Trigger.dev** | Expiry notice, silence timer | Delayed, retried, out-of-process — never on the correctness path. |
| **CopilotKit** | Family dashboard sidebar | "What did Mom order this week?" over live approvals/activity. |
| **Auth0** | Identity + approver role (env prepared, optional) | Who you are and your role; the *budget* is read from the DB, never a token claim. |
| **Exa** | `find_pharmacy` (stretch) | Stubbed unless `EXA_API_KEY` is set. |
| **OpenRouter** | Fallback for OpenAI keys | One env var swap. |
| Stripe (test) · Telegram | Payments · family channel | Not sponsors. Test-mode charges against *our simulated shop* — not a real merchant. |

---

## 6. Repository layout

```
src/contracts/index.ts      zod contracts — the only thing everyone imports (events, basket, approval, payment, incident, activity, tool args)
src/domain/                 budgets, baskets (frozen quote), approvals (atomic consume), payments, incidents, activity  (Supabase)
src/server/                 checkout (money path) · agent (OpenAI tool loop) · escalation · tap (shared by webhook + dashboard)
src/integrations/           openai · stripe · telegram · exa  (lazy clients — the build runs without keys)
src/app/api/                routes — see §7
src/app/room/               Marie's screen           src/components/room/      useCompanion (state machine), useCameraWatch, useLiveSession, wake detector
src/app/monitor/            FallGuard console        src/components/monitor/   camera, status, workflow, event log, conversation log
src/app/family/             dashboard                src/components/family/    approvals, feed, alerts (+ CopilotKit runtime in api/copilotkit)
src/lib/                    supabase-admin (server) · supabase-browser (Realtime hook)
trigger/                    expire-approval · escalate-if-silent
supabase/                   migrations/0001_init.sql · seed.sql
scripts/                    acceptance-double-tap · acceptance-edge-cases · simulate-fall
docs/                       blueprint.html · SPEC.md · VOICE.md · GUARDIAN_INTEGRATION.md
```

---

## 7. API reference

| Route | Body → Result |
|---|---|
| `POST /api/agent` | `{ elderId, text, imageBase64?, scene? }` → `{ reply, toolCalls[] }`. Tools: `build_basket`, `request_approval`, `checkout`, `alert_family`, `request_refill`, `find_pharmacy`. "order my groceries" takes a deterministic fast path. |
| `POST /api/vision` | `{ elderId, frames: string[1..5] }` (or `imageBase64`) → `{ posture, moving, fell, confidence, note, scene }` |
| `POST /api/live/session` | `{ sdp }` → GPT-Live session (`{ session:{id}, transport:{sdp} }`) |
| `POST /api/realtime/token` | → ephemeral Realtime key (fallback voice) |
| `POST /api/incidents` | `person_on_floor_candidate` event → `{ incidentId, question }` (also sends the Telegram heads-up) |
| `POST /api/incidents/[id]/response` | `{ response: string\|null, imageBase64? }` → `{ outcome: "resolved_ok"\|"escalated"\|"ignored", reason }` |
| `POST /api/telegram` | Telegram update (secret header) — Approve / Reject / I'm on it |
| `GET /api/telegram/setup` | one-shot: sets the webhook to `${APP_URL}/api/telegram` |
| `POST /api/dev/tap` | `{ action: "approve"\|"reject"\|"ack", id }` — the dashboard buttons; allowed in dev, or with `ALLOW_DEMO_TAP=1`, or header `x-dev-tap-secret` |
| `POST /api/approvals/[id]/consume` | manual checkout for an approval |
| `GET /api/sim/shop` · `POST /api/sim/shop/order` · `POST /api/sim/pharmacy/refill` | simulated merchants |
| `POST /api/copilotkit` | CopilotKit runtime for the dashboard |

Every route validates its body with zod and returns `{ error }` with a 4xx/5xx on failure.

---

## 8. Data model

`elders` · `approvers` (with `telegram_chat_id`) · `budgets` (`weekly_limit_cents`) · `catalog` · `usual_list` · `baskets` (`items jsonb`, `total_cents`, `quote_hash`) · `approvals` (status, `expires_at`, `decided_by`, `consumed_at`) · `payments` (`stripe_idempotency_key` **unique**) · `incidents` (kind `person_on_floor_candidate` | `asked_for_help`, status) · `activity` (one row per thing the agent did — this is what the screens show).

RLS is on everywhere; the server uses the service key; the anon key can only `select` the four tables the screens read (`activity`, `approvals`, `incidents`, `payments`), which are also in the Realtime publication. Fine for a demo, not a general access model.

Seed: Marie, Claire, a €60.00 weekly limit, a 14-item catalog, and a usual list that totals exactly **€84.00** — over by €24 by design.

---

## 9. Setup

### Keys (`.env.example` → `.env.local`)

| Var | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (the new `sb_secret_…` key works as the service key) |
| `OPENAI_API_KEY` (+ `OPENAI_AGENT_MODEL=gpt-4.1-mini`, `OPENAI_VISION_MODEL=gpt-5.6-luna`, `OPENAI_LIVE_MODEL=gpt-live-1`, `OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini`) | OpenAI |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any random string), `TELEGRAM_APPROVER_CHAT_ID` | @BotFather; message your bot once, then `getUpdates` shows your chat id |
| `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_PAYMENT_METHOD=pm_card_visa` | Stripe test mode |
| `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF` | Trigger.dev (optional) |
| `APP_URL` | `http://localhost:3000` locally; the production URL on Vercel |
| `ALLOW_DEMO_TAP=1` | lets the dashboard buttons work on the deployed demo |
| `AUTH0_*`, `EXA_API_KEY`, `OPENROUTER_API_KEY` | optional |

### Database

Create a Supabase project, then in the SQL editor run `supabase/migrations/0001_init.sql` followed by `supabase/seed.sql`. Set Claire's chat id: `update approvers set telegram_chat_id='<your id>' where id='claire';`

### Telegram webhook (after deploying)

```
GET https://<your-app>/api/telegram/setup
```
or `setWebhook` directly with `url=https://<your-app>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>`.

### Trigger.dev (optional)

```
npx trigger.dev@4.5.16 login
npx trigger.dev@4.5.16 deploy --env prod
```
(The SDK version is pinned; Trigger requires CLI and SDK to match exactly.)

---

## 10. Running and testing

```bash
npm install
npm run dev            # http://localhost:3000  → /room · /monitor · /family
```

Automated (need `.env.local`; they hit the real Supabase/Stripe-test/Telegram):

```bash
npm run test:money                                   # double-tap + reject/expiry/tamper/5-concurrent-taps
APP_URL=http://localhost:3000 npx tsx scripts/simulate-fall.ts   # detect → question → silence → escalate → ack, and the "I'm fine" path
```

Manual, in Chrome (camera + mic):

1. **Sight** — say *"Can you see me? What am I wearing?"* then *"What time is it?"* (no narration).
2. **Groceries** — *"Order my groceries for the week"* → Approve on Telegram → Hearth announces it with the delivery time → Approve again → "already decided".
3. **Fall** — lie down ~5 s (or *Simuler une chute* on `/monitor`) → heads-up on Telegram → Hearth asks → stay silent, or say *"I'm not okay… yes please"* → photo alert → *I'm on it* → Hearth confirms. Then once with *"I'm fine, I dropped my glasses"* → all-clear, no alert.
4. **Sleep** — 45 s of silence → *Resting*.

The grey readout under the camera (`sitting · 94% · 0/2`) is the classifier's live opinion — use it to set the camera angle so it sees the floor.

---

## 11. Deploying

The repo is git-integrated with Vercel: every push to `master` builds a production deployment. Environment variables live in the Vercel project (`vercel env pull` to sync).

One quirk: the public alias `hearth-companion-cyan.vercel.app` is a deployment alias, not the project's domain, so after a push run

```bash
vercel alias set <new-deployment-url> hearth-companion-cyan.vercel.app
```

(The project's own `*.vercel.app` domain is behind Vercel's login protection, which is why the alias is the public URL.)

---

## 12. Demo run of show (2 minutes)

| t | Beat |
|---|---|
| 0:00 | *"Benjamin Code spent a week wiring his mother's house so he could see her from Malaga. He built the eyes and ears. We built the hands — and a leash her family holds."* |
| 0:15 | Marie: *"Order my groceries for the week."* Feed: basket €84 > limit €60 → asking Claire. |
| 0:45 | Claire's phone buzzes — tap Approve — **tap it again**: one charge, never two. Hearth announces it, with the delivery time. |
| 1:15 | *"That's a Tuesday. Here's the morning nobody wants."* Marie slides to the floor. |
| 1:25 | Heads-up on the phone. Hearth speaks first. Silence. Photo alert. Claire taps *I'm on it*. Hearth tells Marie. |
| 1:55 | *"An agent that acts within limits, stops and asks above them, and brings family in only when it matters. Bounded agency — for the person who needs it most."* |

Fallbacks: *Simuler une chute* if stage lighting defeats the camera (say so); type the sentence if voice fails; a backup video of a full run.

---

## 13. Design principles and safety rules

- **The camera never alarms directly — it asks first.** Two confirmations to ask; escalate on silence, on a request for help, or on an explicit yes.
- **Rules are code, not prompts:** two-frame confirmation, 20 s window, single-use approvals, budget checks, idempotent charges.
- **The vulnerable person is never the sole approver of a large spend.**
- **Sight is answered, not narrated.** It never says "I can't see" (it can), and it never identifies people — it describes what's visible.
- **Emergency services are never called automatically.** A human decides.
- **Designed for a real impaired user** (from Benjamin Code's account of his mother with Alzheimer's): no blinking lights, zero-action interface, repeated questions answered as kindly the fortieth time, reassurance over surveillance.
- **Privacy:** frames are analysed for an event and not stored; only the frame attached to an alert leaves the house (to the family). What the family sees follows the elder's sharing preferences.

---

## 14. Known limitations

- Single household hard-coded (`marie` / `claire`); every open room page is "Marie". Auth0 is wired for identity but not enforced.
- Vision is cloud-based at 2 s cadence (~1.9 s per call). A local pose model (MediaPipe) for sub-second detection with luna as confirmation is the planned next step.
- GPT-Live is full-duplex; on a laptop with speakers the mic may hear the companion. WebRTC echo cancellation handles most of it; the Realtime fallback takes turns.
- Telegram is the only family channel (no SMS/phone). Stripe is test mode against a simulated shop.
- The dashboard reads with the anon key — acceptable for a demo only.

## 15. Cost

Roughly: vision ~1 800 luna calls/hour at low detail while watching; voice billed per second only while a session is awake (sleeps after 45 s of silence); backend agent calls are per request. Trigger.dev, Supabase, Vercel and Telegram are within free tiers for a demo.

---

Team: Loudiyii (backend, agents, screens) · HasanRaza-ui (Guardian camera agent, `docs/GUARDIAN_INTEGRATION.md`).
