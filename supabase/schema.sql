-- Riffscribe — charts.
--
-- Run this once (SQL editor, or `supabase db execute -f supabase/schema.sql`).
--
-- Everything here is prefixed `riffscribe_` on purpose. The 6x7 Supabase
-- project is shared by around eighteen apps in one `public` schema, so an
-- unprefixed `charts` table — and especially an unprefixed `touch_updated_at`
-- function, which `create or replace` would silently overwrite for whoever
-- else owns one — is a collision waiting to happen.
--
-- A chart is the work: parts, notes, tempo, key, named sections, loop. It is a
-- few kilobytes. Audio is never stored here — stems live in the browser of the
-- machine that made them, and hosting other people's recordings is both
-- expensive and not ours to do.

create table if not exists public.riffscribe_charts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled',
  data        jsonb not null,
  -- When true, anyone holding the link may read this row. Nothing else.
  shared      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists riffscribe_charts_owner_updated_idx
  on public.riffscribe_charts (owner, updated_at desc);

alter table public.riffscribe_charts enable row level security;

-- A signed-in person sees their own charts.
drop policy if exists "riffscribe: read own charts" on public.riffscribe_charts;
create policy "riffscribe: read own charts" on public.riffscribe_charts
  for select using (auth.uid() = owner);

-- Anyone at all — signed in or not — may read a chart the owner has shared.
-- They need the id, which is a v4 uuid and is not listable: the policy grants
-- no way to enumerate rows, only to fetch one already known.
drop policy if exists "riffscribe: read shared charts" on public.riffscribe_charts;
create policy "riffscribe: read shared charts" on public.riffscribe_charts
  for select using (shared = true);

drop policy if exists "riffscribe: insert own charts" on public.riffscribe_charts;
create policy "riffscribe: insert own charts" on public.riffscribe_charts
  for insert with check (auth.uid() = owner);

drop policy if exists "riffscribe: update own charts" on public.riffscribe_charts;
create policy "riffscribe: update own charts" on public.riffscribe_charts
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "riffscribe: delete own charts" on public.riffscribe_charts;
create policy "riffscribe: delete own charts" on public.riffscribe_charts
  for delete using (auth.uid() = owner);

-- Keep updated_at honest even when a client forgets to send it.
create or replace function public.riffscribe_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists riffscribe_charts_touch_updated_at on public.riffscribe_charts;
create trigger riffscribe_charts_touch_updated_at
  before update on public.riffscribe_charts
  for each row execute function public.riffscribe_touch_updated_at();
