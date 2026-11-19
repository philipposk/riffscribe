-- Riffscribe — fixes from the November 2026 review.
--
-- Run after accounts.sql. Additive only (create or replace); every object is
-- prefixed `riffscribe_` because the 6x7 project is shared (see schema.sql).
-- The app works whether or not this has been applied.

-- Deleting your data keeps this month's assistant counter. Clearing it gave a
-- signed-in caller a fresh allowance every time they called this function. The
-- row holds only the user id, the month and a count, and it still goes when the
-- login itself is deleted (on delete cascade). Earlier months are removed.
--
-- The assistant-chats table comes from assistant_chats.sql, which may not have
-- been run: without the check, the missing table made every call fail and roll
-- back the whole deletion. The shared 6x7 `app_access` row (that this person
-- used Riffscribe) goes too; it is guarded the same way.
create or replace function public.riffscribe_delete_my_data()
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.riffscribe_charts where owner = uid;
  delete from public.riffscribe_usage where user_id = uid and period <> public.riffscribe_period();
  if to_regclass('public.riffscribe_assistant_chats') is not null then
    delete from public.riffscribe_assistant_chats where user_id = uid and app = 'riffscribe';
  end if;
  if to_regclass('public.app_access') is not null then
    delete from public.app_access where user_id = uid and app = 'riffscribe';
  end if;
  delete from public.subscriptions where user_id = uid and app = 'riffscribe';
end $$;

revoke all on function public.riffscribe_delete_my_data() from public, anon;
grant execute on function public.riffscribe_delete_my_data() to authenticated;

-- Hand back one assistant request the model never answered (backend down,
-- timed out, or refused the round). `p` is the month the request was charged
-- to. Service role only: a browser that could call this could reset its own
-- allowance.
create or replace function public.riffscribe_refund_assistant(uid uuid, p text)
returns void language sql volatile security definer set search_path = public as $$
  update public.riffscribe_usage set assistant = assistant - 1
   where user_id = uid and period = p and assistant > 0
$$;

revoke all on function public.riffscribe_refund_assistant(uuid, text) from public, anon, authenticated;
grant execute on function public.riffscribe_refund_assistant(uuid, text) to service_role;

-- Billing. `cancel_at_period_end` is new on the SHARED 6x7 `subscriptions`
-- table: nullable, so other apps' rows and writes are untouched. The webhook
-- writes it (and writes without it until this runs); the account page then
-- says "ends <date>" rather than "renews <date>" after a cancellation.
alter table public.subscriptions add column if not exists cancel_at_period_end boolean;

-- A Riffscribe row only grants Pro until a few days past its paid period. The
-- webhook moves current_period_end on every renewal, so this only ends rows
-- nothing updates any more, such as test-mode subscriptions once the live
-- keys are in. Cross-app 'global' rows are unchanged.
create or replace function public.riffscribe_plan(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when app = 'global' then coalesce(plan, 'pro') else plan end
       from public.subscriptions
      where user_id = uid and app in ('riffscribe', 'global') and status in ('active', 'trialing')
        and (app = 'global' or current_period_end is null or current_period_end > now() - interval '3 days')
      order by (app = 'global') desc
      limit 1),
    'free')
$$;

revoke all on function public.riffscribe_plan(uuid) from public, anon, authenticated;

-- Same as accounts.sql, plus cancel_at_period_end.
create or replace function public.riffscribe_account()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p text;
  l record;
begin
  if uid is null then return null; end if;
  p := public.riffscribe_plan(uid);
  select * into l from public.riffscribe_limits(p);
  return json_build_object(
    'plan', p,
    'period', public.riffscribe_period(),
    'songs', (select count(*) from public.riffscribe_charts where owner = uid),
    'songs_limit', l.songs,
    'assistant', coalesce((select assistant from public.riffscribe_usage
                            where user_id = uid and period = public.riffscribe_period()), 0),
    'assistant_limit', l.assistant,
    'has_billing', exists (select 1 from public.subscriptions
                            where user_id = uid and app = 'riffscribe' and stripe_customer_id is not null),
    'renews_at', (select current_period_end from public.subscriptions
                   where user_id = uid and app = 'riffscribe'),
    'status', (select status from public.subscriptions where user_id = uid and app = 'riffscribe'),
    'cancel_at_period_end', (select cancel_at_period_end from public.subscriptions
                              where user_id = uid and app = 'riffscribe')
  );
end $$;

revoke all on function public.riffscribe_account() from public, anon;
grant execute on function public.riffscribe_account() to authenticated;

-- Shared charts, one at a time. The "read shared charts" policy in schema.sql
-- let anyone with the public key list every shared chart (row-level security
-- filters rows, it does not stop a query that asks for all of them). This
-- returns one chart's data by id, and only if it is shared; the owner and the
-- other columns stay out of reach. The app tries it when a direct read finds
-- nothing. 0004 then drops the policy — run that only after the code that
-- calls this is live, so shared links keep working throughout.
create or replace function public.riffscribe_shared_chart(chart_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select data from public.riffscribe_charts where id = chart_id and shared
$$;

revoke all on function public.riffscribe_shared_chart(uuid) from public;
grant execute on function public.riffscribe_shared_chart(uuid) to anon, authenticated;

-- A chart is a few kilobytes; cap what one row can hold, since the project is
-- shared and sign-up is free. 5 MB matches riffscribe_assistant_chats. NOT
-- VALID: enforced on every insert and update from now on, without checking
-- rows already there. To check those too, first look at
--   select max(octet_length(data::text)), max(char_length(title)) from public.riffscribe_charts;
-- then `alter table public.riffscribe_charts validate constraint <name>;`.
alter table public.riffscribe_charts drop constraint if exists riffscribe_charts_data_object;
alter table public.riffscribe_charts
  add constraint riffscribe_charts_data_object check (jsonb_typeof(data) = 'object') not valid;
alter table public.riffscribe_charts drop constraint if exists riffscribe_charts_data_size;
alter table public.riffscribe_charts
  add constraint riffscribe_charts_data_size check (octet_length(data::text) <= 5000000) not valid;
alter table public.riffscribe_charts drop constraint if exists riffscribe_charts_title_len;
alter table public.riffscribe_charts
  add constraint riffscribe_charts_title_len check (char_length(title) <= 300) not valid;
