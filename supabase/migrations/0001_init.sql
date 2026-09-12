-- Hearth Companion — initial schema
-- Money is integer cents everywhere. Approval and Payment are separate state machines.
-- RLS is enabled on every table; the service role (used by the server) bypasses RLS.
-- Anon (dashboard, via Supabase Realtime) gets read-only `select` on activity, approvals,
-- incidents, payments — acceptable for this demo, not a general access model.

create extension if not exists pgcrypto;

create table if not exists elders (
  id text primary key,
  display_name text not null,
  telegram_chat_id text null,
  created_at timestamptz not null default now()
);

create table if not exists approvers (
  id text primary key,
  elder_id text not null references elders(id),
  display_name text not null,
  telegram_chat_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists budgets (
  elder_id text primary key references elders(id),
  weekly_limit_cents int not null check (weekly_limit_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists catalog (
  sku text primary key,
  name text not null,
  unit_cents int not null check (unit_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists usual_list (
  elder_id text not null references elders(id),
  sku text not null references catalog(sku),
  qty int not null check (qty > 0),
  created_at timestamptz not null default now(),
  primary key (elder_id, sku)
);

create table if not exists baskets (
  id uuid primary key default gen_random_uuid(),
  elder_id text not null references elders(id),
  items jsonb not null,
  total_cents int not null check (total_cents >= 0),
  quote_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  elder_id text not null references elders(id),
  approver_id text not null references approvers(id),
  basket_id uuid not null references baskets(id),
  quote_hash text not null,
  total_cents int not null check (total_cents >= 0),
  limit_cents int not null check (limit_cents >= 0),
  excess_cents int not null check (excess_cents >= 0),
  status text not null check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CONSUMED')),
  expires_at timestamptz not null,
  decided_at timestamptz null,
  decided_by text null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references baskets(id),
  approval_id uuid null references approvals(id),
  amount_cents int not null check (amount_cents >= 0),
  status text not null check (status in ('NOT_STARTED','PROCESSING','SUCCEEDED','FAILED')),
  stripe_idempotency_key text not null unique,
  stripe_payment_intent_id text null,
  receipt_url text null,
  failure_reason text null,
  created_at timestamptz not null default now()
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  elder_id text not null references elders(id),
  kind text not null,
  confidence real not null,
  note text not null,
  status text not null check (status in ('DETECTED','CHECKING','RESOLVED_OK','ESCALATED','ACKNOWLEDGED')),
  elder_response text null,
  acknowledged_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  elder_id text not null references elders(id),
  kind text not null,
  message text not null,
  ref_id text null,
  created_at timestamptz not null default now()
);

alter table elders enable row level security;
alter table approvers enable row level security;
alter table budgets enable row level security;
alter table catalog enable row level security;
alter table usual_list enable row level security;
alter table baskets enable row level security;
alter table approvals enable row level security;
alter table payments enable row level security;
alter table incidents enable row level security;
alter table activity enable row level security;

create policy "anon read activity" on activity for select to anon using (true);
create policy "anon read approvals" on approvals for select to anon using (true);
create policy "anon read incidents" on incidents for select to anon using (true);
create policy "anon read payments" on payments for select to anon using (true);

alter publication supabase_realtime add table activity, approvals, incidents, payments;
