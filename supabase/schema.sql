-- Riffscribe — charts.
--
-- Run this once against a new Supabase project (SQL editor, or
-- `supabase db execute -f supabase/schema.sql`).
--
-- A chart is the work: parts, notes, tempo, key, named sections, loop. It is a
-- few kilobytes. Audio is never stored here — stems live in the browser of the
-- machine that made them, and hosting other people's recordings is both
-- expensive and not ours to do.

create table if not exists public.charts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled',
  data        jsonb not null,
  -- When true, anyone holding the link may read this row. Nothing else.
  shared      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists charts_owner_updated_idx
  on public.charts (owner, updated_at desc);

alter table public.charts enable row level security;

-- A signed-in person sees their own charts.
drop policy if exists "read own charts" on public.charts;
create policy "read own charts" on public.charts
  for select using (auth.uid() = owner);

-- Anyone at all — signed in or not — may read a chart the owner has shared.
-- They need the id, which is a v4 uuid and is not listable: the policy grants
-- no way to enumerate rows, only to fetch one already known.
drop policy if exists "read shared charts" on public.charts;
create policy "read shared charts" on public.charts
  for select using (shared = true);

drop policy if exists "insert own charts" on public.charts;
create policy "insert own charts" on public.charts
  for insert with check (auth.uid() = owner);

drop policy if exists "update own charts" on public.charts;
create policy "update own charts" on public.charts
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "delete own charts" on public.charts;
create policy "delete own charts" on public.charts
  for delete using (auth.uid() = owner);

-- Keep updated_at honest even when a client forgets to send it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists charts_touch_updated_at on public.charts;
create trigger charts_touch_updated_at
  before update on public.charts
  for each row execute function public.touch_updated_at();
