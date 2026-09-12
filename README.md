# Hearth Companion

A home companion for an older person living alone. It talks, does errands, and **pays within limits the family set** — above the limit it stops and a relative approves once on Telegram. A camera watches for a fall; the companion speaks first, and escalates to a human if nobody answers.

Thesis: **bounded agency**. Elder care is the case.

Built for the AI Tinkerers global hackathon "Agents, Everywhere" (Paris). Blueprint: `docs/blueprint.html`. Engineering contract: `docs/SPEC.md`.

## Stack

Next.js 16 on Vercel · Supabase (Postgres + Realtime) · OpenAI (Realtime voice, mini vision, tools) · Telegram · Stripe test mode · Auth0 · Trigger.dev · CopilotKit · Exa (stretch)

## Run it

```bash
cp .env.example .env.local        # fill in keys
npm install
# 1. Supabase: create a project, run supabase/migrations/0001_init.sql then supabase/seed.sql in the SQL editor
#    then set approvers.telegram_chat_id for "claire" to your chat id
npm run dev
```

- `http://localhost:3000/room`   — Marie's companion (laptop 1)
- `http://localhost:3000/family` — the family dashboard (projector / laptop 2)

Telegram webhook (after deploying, with `APP_URL` set to the production URL):

```
GET https://<your-app>.vercel.app/api/telegram/setup
```

## The money path — acceptance test

```bash
APP_URL=http://localhost:3000 npx tsx scripts/acceptance-double-tap.ts
```

Relative taps **Approve** twice → exactly one Stripe test charge, one receipt, one announcement. This must pass before anything else is built on top.

## Rules that keep it honest

- integer cents; a basket is a frozen quote
- Approval and Payment are separate state machines
- consume is one atomic `UPDATE … WHERE status='APPROVED' AND expires_at > now() RETURNING *`
- budget is read from the DB per request, never from a token
- Trigger.dev is never on the correctness path
- vision emits `person_on_floor_candidate` — a candidate, never a diagnosis
- Stripe is test mode against a simulated shop; emergency calls are simulated

## Layout

```
src/contracts/     shared zod types — the only thing everyone imports
src/domain/        budgets, baskets, approvals, payments, incidents, activity (Supabase)
src/server/        checkout (money path), agent (OpenAI tools), escalation, tap
src/integrations/  openai, stripe, telegram, exa
src/app/api/       routes (see docs/SPEC.md)
src/app/room/      the companion screen
src/app/family/    the dashboard (CopilotKit)
trigger/           expiry notice, escalate-if-silent
supabase/          migration + seed
scripts/           acceptance test
```
