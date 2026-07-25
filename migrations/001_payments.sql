-- LeftOff — payments table
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
--
-- Records every confirmed payment from the Razorpay and Dodo webhooks so
-- revenue history exists independently of the is_premium flag on
-- extension_users (which only says "premium right now", not what was paid).

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),

  -- Link to the account. Nullable on purpose: someone can pay with an email
  -- that doesn't match any account yet — we still want the revenue recorded
  -- rather than dropped, so it can be reconciled manually later.
  user_id         uuid references public.extension_users(id) on delete set null,
  email           text not null,

  -- transaction_id is the gateway's own payment id. The unique constraint
  -- makes webhook retries idempotent: gateways redeliver on any non-2xx,
  -- and without this a single payment could be inserted several times.
  gateway         text not null check (gateway in ('razorpay', 'dodo', 'manual')),
  transaction_id  text not null,

  amount          numeric(12,2) not null,
  currency        text not null,
  plan            text check (plan in ('monthly', 'yearly', 'lifetime')),

  status          text not null default 'completed',
  paid_at         timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- Full webhook payload, kept for debugging and disputes
  raw             jsonb,

  constraint payments_gateway_txn_unique unique (gateway, transaction_id)
);

create index if not exists payments_email_idx   on public.payments (email);
create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_paid_at_idx on public.payments (paid_at desc);

-- The backend connects with the service_role key, which bypasses RLS.
-- Enabling RLS with no policies means anon/authenticated clients get nothing,
-- so payment rows are never exposed publicly.
alter table public.payments enable row level security;
