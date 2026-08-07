-- Compla Client OS
-- Run this entire file once in Supabase -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','prospect')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  monthly_amount numeric(12,2),
  payment_due_day integer check (payment_due_day between 1 and 31),
  current_focus text not null default '',
  next_step text not null default '',
  notes text not null default '',
  last_touched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  category text not null default 'Custom task',
  status text not null default 'next' check (status in ('next','in_progress','waiting','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_date date,
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(12,2),
  paid_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique(owner_id, client_id, period)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists clients_owner_idx on public.clients(owner_id);
create index if not exists tasks_owner_idx on public.tasks(owner_id);
create index if not exists tasks_client_idx on public.tasks(client_id);
create index if not exists payment_records_owner_idx on public.payment_records(owner_id);
create index if not exists payment_records_client_idx on public.payment_records(client_id);
create index if not exists activities_owner_idx on public.activities(owner_id);
create index if not exists activities_client_idx on public.activities(client_id);

alter table public.clients enable row level security;
alter table public.tasks enable row level security;
alter table public.payment_records enable row level security;
alter table public.activities enable row level security;

-- Re-create policies safely if you run this script again.
drop policy if exists "clients_owner_all" on public.clients;
drop policy if exists "tasks_owner_all" on public.tasks;
drop policy if exists "payment_records_owner_all" on public.payment_records;
drop policy if exists "activities_owner_all" on public.activities;

create policy "clients_owner_all" on public.clients
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "tasks_owner_all" on public.tasks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

create policy "payment_records_owner_all" on public.payment_records
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

create policy "activities_owner_all" on public.activities
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );
