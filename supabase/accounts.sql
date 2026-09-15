-- Riffscribe — plans, usage and account deletion.
--
-- Run after schema.sql. Additive only; every object is prefixed `riffscribe_`
-- because the 6x7 project is shared (see schema.sql).
--
-- The plan comes from the shared 6x7 `subscriptions` table, written by the
-- Stripe webhook: a row with app = 'riffscribe', or a cross-app 'global' row.
--
-- Everything a signed-in person can do here runs as a SECURITY DEFINER
-- function scoped to auth.uid(), so the browser can call it with its own
-- session and cannot touch anyone else's numbers.

create table if not exists public.riffscribe_usage (
  user_id    uuid not null references auth.users (id) on delete cascade,
  period     text not null,             -- 'YYYY-MM', UTC
  assistant  integer not null default 0, -- assistant requests this month
  primary key (user_id, period)
);
alter table public.riffscribe_usage enable row level security;
drop policy if exists "riffscribe: read own usage" on public.riffscribe_usage;
create policy "riffscribe: read own usage" on public.riffscribe_usage
  for select using (auth.uid() = user_id);

-- Stripe re-delivers events; the webhook records each id once.
create table if not exists public.riffscribe_webhook_events (
  id       text primary key,
  created  bigint,
  seen_at  timestamptz not null default now()
);
alter table public.riffscribe_webhook_events enable row level security;

create or replace function public.riffscribe_period()
returns text language sql stable as $$ select to_char(now() at time zone 'utc', 'YYYY-MM') $$;

create or replace function public.riffscribe_plan(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when app = 'global' then coalesce(plan, 'pro') else plan end
       from public.subscriptions
      where user_id = uid and app in ('riffscribe', 'global') and status in ('active', 'trialing')
      order by (app = 'global') desc
      limit 1),
    'free')
$$;

-- Keep in step with src/lib/plans.ts.
create or replace function public.riffscribe_limits(plan text, out songs integer, out assistant integer)
language sql immutable as $$
  select case when plan = 'free' then 10 else 1000 end,
         case when plan = 'free' then 100 else 2000 end
$$;

-- Everything the account menu shows, in one round trip.
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
    'status', (select status from public.subscriptions where user_id = uid and app = 'riffscribe')
  );
end $$;

-- Spend one assistant request. False once the month's allowance is gone.
create or replace function public.riffscribe_use_assistant()
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cap integer;
  used integer;
begin
  if uid is null then return false; end if;
  select assistant into cap from public.riffscribe_limits(public.riffscribe_plan(uid));
  insert into public.riffscribe_usage (user_id, period, assistant)
       values (uid, public.riffscribe_period(), 0)
  on conflict (user_id, period) do nothing;
  update public.riffscribe_usage set assistant = assistant + 1
   where user_id = uid and period = public.riffscribe_period() and assistant < cap
  returning assistant into used;
  return used is not null;
end $$;

-- The song cap lives in the database, so no client can save past it.
create or replace function public.riffscribe_charts_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cap integer;
begin
  select songs into cap from public.riffscribe_limits(public.riffscribe_plan(new.owner));
  if (select count(*) from public.riffscribe_charts where owner = new.owner) >= cap then
    raise exception 'riffscribe_song_limit: you have saved % songs, the most your plan allows', cap
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists riffscribe_charts_cap on public.riffscribe_charts;
create trigger riffscribe_charts_cap
  before insert on public.riffscribe_charts
  for each row execute function public.riffscribe_charts_cap();

-- Delete this person's Riffscribe data. The login itself is shared with other
-- 6x7 apps, so it stays; so does any cross-app 'global' subscription.
create or replace function public.riffscribe_delete_my_data()
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.riffscribe_charts where owner = uid;
  delete from public.riffscribe_usage where user_id = uid;
  delete from public.subscriptions where user_id = uid and app = 'riffscribe';
end $$;

revoke all on function public.riffscribe_plan(uuid) from public, anon, authenticated;
revoke all on function public.riffscribe_account() from public, anon;
revoke all on function public.riffscribe_use_assistant() from public, anon;
revoke all on function public.riffscribe_delete_my_data() from public, anon;
grant execute on function public.riffscribe_account() to authenticated;
grant execute on function public.riffscribe_use_assistant() to authenticated;
grant execute on function public.riffscribe_delete_my_data() to authenticated;
