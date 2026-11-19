-- Riffscribe — billing: the Stripe customer for each person, and the plan
-- through a failed renewal.
--
-- Run after 0003_review_fixes.sql. Additive; it can go in before or after the
-- release is deployed, and the app works without it (no stored customer means
-- the checkout route finds or creates one in Stripe). Re-running it is safe.

-- One Stripe customer per person per Stripe mode. Test-mode and live-mode
-- customers are different objects in Stripe, so a test `cus_…` id kept past the
-- switch to live keys would break checkout and the portal; keying on livemode
-- keeps them apart. Written and read by the server with the service role only:
-- row-level security is on and there are no policies.
create table if not exists public.riffscribe_customers (
  user_id             uuid        not null references auth.users (id) on delete cascade,
  livemode            boolean     not null,
  stripe_customer_id  text        not null unique check (char_length(stripe_customer_id) <= 255),
  created_at          timestamptz not null default now(),
  primary key (user_id, livemode)
);

alter table public.riffscribe_customers enable row level security;
revoke all on table public.riffscribe_customers from anon, authenticated;
grant select, insert, update, delete on table public.riffscribe_customers to service_role;

-- The plan. Same as 0003, except that a subscription Stripe is still retrying
-- (`past_due`) keeps Pro until Stripe gives up and cancels it, and a fixed
-- search_path. The 3-day grace past current_period_end still ends rows nothing
-- updates any more.
create or replace function public.riffscribe_plan(uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when app = 'global' then coalesce(plan, 'pro') else plan end
       from public.subscriptions
      where user_id = uid and app in ('riffscribe', 'global') and status in ('active', 'trialing', 'past_due')
        and (app = 'global' or current_period_end is null or current_period_end > now() - interval '3 days')
      order by (app = 'global') desc
      limit 1),
    'free')
$$;

revoke all on function public.riffscribe_plan(uuid) from public, anon, authenticated;
