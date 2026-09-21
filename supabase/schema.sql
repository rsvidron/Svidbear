-- Svidbear — Fat Bear Week bracket pool
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is guarded.

create extension if not exists pgcrypto;

-- Short, readable share codes for /b/CODE permalinks.
create or replace function public.new_bracket_code()
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

create table if not exists public.brackets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null unique default public.new_bracket_code(),
  name       text not null,
  picks      smallint[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One bracket per person, always complete, every pick a real slot.
  constraint brackets_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint brackets_picks_length check (array_length(picks, 1) = 15),
  constraint brackets_picks_values check (picks <@ array[0, 1]::smallint[])
);

create index if not exists brackets_updated_at_idx on public.brackets (updated_at desc);

-- Keep updated_at honest regardless of what the client sends.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists brackets_touch_updated_at on public.brackets;
create trigger brackets_touch_updated_at
  before update on public.brackets
  for each row execute function public.touch_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────────
-- The pool is public to read; a bracket is writable only by the person who owns it.

alter table public.brackets enable row level security;

drop policy if exists "Brackets are readable by everyone" on public.brackets;
create policy "Brackets are readable by everyone"
  on public.brackets for select
  using (true);

drop policy if exists "People insert their own bracket" on public.brackets;
create policy "People insert their own bracket"
  on public.brackets for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "People update their own bracket" on public.brackets;
create policy "People update their own bracket"
  on public.brackets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "People delete their own bracket" on public.brackets;
create policy "People delete their own bracket"
  on public.brackets for delete
  to authenticated
  using (auth.uid() = user_id);
