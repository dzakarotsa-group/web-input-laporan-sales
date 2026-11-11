create extension if not exists pgcrypto;

create table if not exists public.sales_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  email text not null unique check (email = lower(email)),
  password_salt text not null check (password_salt ~ '^[0-9a-f]{32}$'),
  password_hash text not null check (password_hash ~ '^[0-9a-f]{128}$'),
  spreadsheet_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.sales_accounts(id),
  name_user text not null check (char_length(name_user) between 1 and 100),
  phone text not null check (char_length(phone) between 1 and 30),
  sales_name text not null,
  domicile text not null default '',
  source text not null default '',
  lead_code text not null default '',
  created_at timestamptz not null default now(),
  final_result text not null default '',
  follow_ups jsonb not null default '[]'::jsonb
    check (jsonb_typeof(follow_ups) = 'array')
);

create index if not exists leads_owner_created_at_idx
  on public.leads (owner_id, created_at desc);

alter table public.sales_accounts enable row level security;
alter table public.leads enable row level security;

revoke all on public.sales_accounts from anon, authenticated;
revoke all on public.leads from anon, authenticated;
grant usage on schema public to service_role;
grant all on public.sales_accounts, public.leads to service_role;
