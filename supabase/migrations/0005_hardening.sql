-- Riffscribe — policy, privilege and function hardening.
--
-- Run AFTER 0003_review_fixes.sql and 0004_drop_shared_chart_listing.sql, and
-- only once the app version that reads shared charts through
-- riffscribe_shared_chart is deployed: this closes the charts table to the
-- anon role, so an older app that reads a shared chart straight from the
-- table, signed out, would stop opening shared links. See supabase/README.md.
--
-- Re-running it is safe. Every object is prefixed `riffscribe_` because the
-- 6x7 project is shared by ~18 apps in one `public` schema (see schema.sql).

do $$
begin
  if to_regprocedure('public.riffscribe_shared_chart(uuid)') is null
     or to_regprocedure('public.riffscribe_refund_assistant(uuid, text)') is null then
    raise exception 'apply supabase/migrations/0003_review_fixes.sql before 0005_hardening.sql';
  end if;
end;
$$;

-- 1. Shared charts are read one at a time through riffscribe_shared_chart
-- (0003). 0004 already dropped the listing policy; dropping it again keeps
-- this file correct on its own.
drop policy if exists "riffscribe: read shared charts" on public.riffscribe_charts;

alter function public.riffscribe_shared_chart(uuid) set search_path = '';
revoke all on function public.riffscribe_shared_chart(uuid) from public;
grant execute on function public.riffscribe_shared_chart(uuid) to anon, authenticated;

-- 2. Policies apply to signed-in sessions only, and read auth.uid() once per
-- query instead of once per row.
drop policy if exists "riffscribe: read own charts" on public.riffscribe_charts;
create policy "riffscribe: read own charts" on public.riffscribe_charts
  for select to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists "riffscribe: insert own charts" on public.riffscribe_charts;
create policy "riffscribe: insert own charts" on public.riffscribe_charts
  for insert to authenticated
  with check ((select auth.uid()) = owner);

drop policy if exists "riffscribe: update own charts" on public.riffscribe_charts;
create policy "riffscribe: update own charts" on public.riffscribe_charts
  for update to authenticated
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);

drop policy if exists "riffscribe: delete own charts" on public.riffscribe_charts;
create policy "riffscribe: delete own charts" on public.riffscribe_charts
  for delete to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists "riffscribe: read own usage" on public.riffscribe_usage;
create policy "riffscribe: read own usage" on public.riffscribe_usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The assistant-chat policies (assistant_chats.sql) already have this shape.

-- 3. The anon role reaches none of these tables directly. Row-level security
-- already returned nothing; without the grant the request is refused outright.
revoke all on table public.riffscribe_charts, public.riffscribe_usage, public.riffscribe_webhook_events from anon;
do $$
begin
  if to_regclass('public.riffscribe_assistant_chats') is not null then
    execute 'revoke all on table public.riffscribe_assistant_chats from anon';
  end if;
end;
$$;

-- 4. 0003 added the chart size limits NOT VALID. Check the rows already there;
-- if any breaks a limit, leave that constraint unvalidated (it is still
-- enforced on every insert and update) and say so.
do $$
declare
  c text;
begin
  foreach c in array array['riffscribe_charts_data_object', 'riffscribe_charts_data_size', 'riffscribe_charts_title_len'] loop
    if exists (select 1 from pg_catalog.pg_constraint
                where conrelid = 'public.riffscribe_charts'::regclass and conname = c and not convalidated) then
      begin
        execute pg_catalog.format('alter table public.riffscribe_charts validate constraint %I', c);
      exception when check_violation then
        raise notice '% is not validated: an existing chart breaks it. It still applies to new writes.', c;
      end;
    end if;
  end loop;
end;
$$;

-- 5. Fixed search_path on every riffscribe function, so no object in another
-- schema (or a temporary one) can stand in for one these bodies call. Every
-- name in these bodies is schema-qualified; built-ins resolve from pg_catalog.
alter function public.riffscribe_period() set search_path = '';
alter function public.riffscribe_limits(text) set search_path = '';
alter function public.riffscribe_touch_updated_at() set search_path = '';
alter function public.riffscribe_plan(uuid) set search_path = '';
alter function public.riffscribe_account() set search_path = '';
alter function public.riffscribe_use_assistant() set search_path = '';
alter function public.riffscribe_refund_assistant(uuid, text) set search_path = '';

revoke all on function public.riffscribe_touch_updated_at() from public, anon, authenticated;

-- 6. The song cap. Two saves from the same person at the same moment each
-- counted the rows before either was written, so both got in at the cap. A
-- per-owner transaction lock makes the second wait for the first. The lock
-- key's first half is fixed to this function, so it cannot collide with
-- another app's advisory locks in the shared project.
create or replace function public.riffscribe_charts_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cap integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('riffscribe_charts_cap'), pg_catalog.hashtext(new.owner::text));
  select songs into cap from public.riffscribe_limits(public.riffscribe_plan(new.owner));
  if (select count(*) from public.riffscribe_charts where owner = new.owner) >= cap then
    raise exception 'riffscribe_song_limit: you have saved % songs, the most your plan allows', cap
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A trigger runs its function whatever the caller's EXECUTE rights; nobody
-- needs to call it directly.
revoke all on function public.riffscribe_charts_cap() from public, anon, authenticated;

-- 7. Delete this person's Riffscribe data. Same as 0003, plus the Stripe
-- customer link from 0006_billing.sql, and a fixed search_path. This month's
-- assistant counter stays (else deleting resets the allowance); the login and
-- any cross-app 'global' subscription stay too.
create or replace function public.riffscribe_delete_my_data()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.riffscribe_charts where owner = uid;
  delete from public.riffscribe_usage where user_id = uid and period <> public.riffscribe_period();
  if pg_catalog.to_regclass('public.riffscribe_assistant_chats') is not null then
    execute 'delete from public.riffscribe_assistant_chats where user_id = $1 and app = ''riffscribe''' using uid;
  end if;
  if pg_catalog.to_regclass('public.app_access') is not null then
    execute 'delete from public.app_access where user_id = $1 and app = ''riffscribe''' using uid;
  end if;
  if pg_catalog.to_regclass('public.riffscribe_customers') is not null then
    execute 'delete from public.riffscribe_customers where user_id = $1' using uid;
  end if;
  delete from public.subscriptions where user_id = uid and app = 'riffscribe';
end $$;

revoke all on function public.riffscribe_delete_my_data() from public, anon;
grant execute on function public.riffscribe_delete_my_data() to authenticated;

-- 8. Retention, when pg_cron is enabled. Re-running updates the same jobs.
--   Webhook event ids: Stripe re-delivers for up to three days; keep 30.
--   Usage counters: keep two years of months.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'riffscribe-webhook-events-retention',
      '17 3 * * *',
      $job$delete from public.riffscribe_webhook_events where seen_at < now() - interval '30 days'$job$
    );
    perform cron.schedule(
      'riffscribe-usage-retention',
      '23 3 1 * *',
      $job$delete from public.riffscribe_usage where period < to_char(now() at time zone 'utc' - interval '24 months', 'YYYY-MM')$job$
    );
  else
    raise notice 'pg_cron is not enabled: webhook-event and usage retention are not scheduled (see supabase/README.md).';
  end if;
end;
$$;

-- 9. riffscribe_refund_assistant(uid, p) is in 0003 (service role only); its
-- search_path is fixed above. Re-assert who may call it.
revoke all on function public.riffscribe_refund_assistant(uuid, text) from public, anon, authenticated;
grant execute on function public.riffscribe_refund_assistant(uuid, text) to service_role;
