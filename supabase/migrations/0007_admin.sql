-- Riffscribe — admins, app settings and model-usage counts.
--
-- Run after 0003_review_fixes.sql. Additive; it can go in before or after the
-- release is deployed. Until it runs the server treats everyone as "not admin",
-- uses default settings and skips usage logging. Re-running it is safe.
--
-- Make yourself an admin once (SQL editor):
--   insert into public.riffscribe_admins (user_id)
--   select id from auth.users where email = '<you>' on conflict do nothing;

-- Who may change the app's settings. Read only through riffscribe_is_admin();
-- row-level security is on and there are no policies.
create table if not exists public.riffscribe_admins (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.riffscribe_admins enable row level security;
revoke all on table public.riffscribe_admins from anon, authenticated;
grant select, insert, update, delete on table public.riffscribe_admins to service_role;

-- App settings, one row per key. Only 'llm' (which models the assistant uses)
-- exists so far; a new key needs this check widened.
create table if not exists public.riffscribe_settings (
  key         text        primary key check (key in ('llm')),
  value       jsonb       not null check (octet_length(value::text) <= 100000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id) on delete set null
);

alter table public.riffscribe_settings enable row level security;
revoke all on table public.riffscribe_settings from anon;
revoke delete, truncate, references, trigger on table public.riffscribe_settings from authenticated;
grant select, insert, update on table public.riffscribe_settings to authenticated;
grant select, insert, update, delete on table public.riffscribe_settings to service_role;

-- Requests and tokens per UTC day, task and model. No user ids: this is for
-- watching cost and fallbacks, not people.
create table if not exists public.riffscribe_llm_usage (
  day            date    not null,
  task           text    not null check (char_length(task) <= 64),
  model          text    not null check (char_length(model) <= 200),
  requests       integer not null default 0,
  input_tokens   bigint  not null default 0,
  cached_tokens  bigint  not null default 0,
  output_tokens  bigint  not null default 0,
  fallbacks      integer not null default 0,
  primary key (day, task, model)
);

alter table public.riffscribe_llm_usage enable row level security;
revoke all on table public.riffscribe_llm_usage from anon;
revoke insert, update, delete, truncate, references, trigger on table public.riffscribe_llm_usage from authenticated;
grant select on table public.riffscribe_llm_usage to authenticated;
grant select, insert, update, delete on table public.riffscribe_llm_usage to service_role;

-- Is the signed-in caller an admin? False when signed out, and for the
-- service role (which has no auth.uid()).
create or replace function public.riffscribe_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.riffscribe_admins where user_id = (select auth.uid()))
$$;

revoke all on function public.riffscribe_is_admin() from public, anon;
grant execute on function public.riffscribe_is_admin() to authenticated;

-- Admins read and change settings and read usage. Nobody deletes a setting
-- through the API, and usage is written only by riffscribe_log_llm.
drop policy if exists "riffscribe: admins read settings" on public.riffscribe_settings;
create policy "riffscribe: admins read settings" on public.riffscribe_settings
  for select to authenticated
  using ((select public.riffscribe_is_admin()));

drop policy if exists "riffscribe: admins insert settings" on public.riffscribe_settings;
create policy "riffscribe: admins insert settings" on public.riffscribe_settings
  for insert to authenticated
  with check ((select public.riffscribe_is_admin()));

drop policy if exists "riffscribe: admins update settings" on public.riffscribe_settings;
create policy "riffscribe: admins update settings" on public.riffscribe_settings
  for update to authenticated
  using ((select public.riffscribe_is_admin()))
  with check ((select public.riffscribe_is_admin()));

drop policy if exists "riffscribe: admins read llm usage" on public.riffscribe_llm_usage;
create policy "riffscribe: admins read llm usage" on public.riffscribe_llm_usage
  for select to authenticated
  using ((select public.riffscribe_is_admin()));

-- Count one model call. Concurrent calls for the same day, task and model add
-- up rather than overwrite (one upsert, row-locked by the conflict). Service
-- role only.
create or replace function public.riffscribe_log_llm(
  p_task text, p_model text, p_in integer, p_cached integer, p_out integer, p_fallback boolean
)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.riffscribe_llm_usage as u
         (day, task, model, requests, input_tokens, cached_tokens, output_tokens, fallbacks)
  values ((now() at time zone 'utc')::date,
          left(coalesce(p_task, 'unknown'), 64),
          left(coalesce(p_model, 'unknown'), 200),
          1,
          greatest(coalesce(p_in, 0), 0),
          greatest(coalesce(p_cached, 0), 0),
          greatest(coalesce(p_out, 0), 0),
          case when coalesce(p_fallback, false) then 1 else 0 end)
  on conflict (day, task, model) do update set
    requests      = u.requests + 1,
    input_tokens  = u.input_tokens + excluded.input_tokens,
    cached_tokens = u.cached_tokens + excluded.cached_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    fallbacks     = u.fallbacks + excluded.fallbacks
$$;

revoke all on function public.riffscribe_log_llm(text, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.riffscribe_log_llm(text, text, integer, integer, integer, boolean) to service_role;

-- Keep 400 days of usage counts, when pg_cron is enabled.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'riffscribe-llm-usage-retention',
      '29 3 * * *',
      $job$delete from public.riffscribe_llm_usage where day < (now() at time zone 'utc')::date - 400$job$
    );
  else
    raise notice 'pg_cron is not enabled: riffscribe_llm_usage retention is not scheduled (see supabase/README.md).';
  end if;
end;
$$;
