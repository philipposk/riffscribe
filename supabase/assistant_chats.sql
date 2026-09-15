-- Riffscribe — the assistant's saved chats.
--
-- Run this once, after schema.sql (SQL editor, or
-- `supabase db execute -f supabase/assistant_chats.sql`). Re-running it is safe.
-- Enable pg_cron first (Database → Extensions → pg_cron) and the daily clean-up at
-- the end of this file schedules itself.
--
-- Adapted from the reference migration shipped with the page-assistant widget
-- (supabase/assistant_chats.sql in @page-assistant/widget); it pairs with that
-- package's supabaseChatHistoryAdapter(), see src/lib/assistantHistory.ts.
--
-- Everything is prefixed `riffscribe_`, for the same reason as schema.sql: the 6x7
-- project is shared by around eighteen apps in one `public` schema, and an
-- unprefixed `assistant_chats` table or `create or replace` function could already
-- belong to someone else.
--
-- What is stored: the text of each conversation with the assistant, its title,
-- pin/archive flags and model name — only for signed-in players whose chat history
-- is set to "Save to my account" (the default once signed in). Never audio.
--
-- Access: row-level security, and every policy is "the row is mine". The anon role
-- gets nothing. The browser reaches this table only through the player's own
-- session; no key that can read other people's chats is ever sent to it.
--
-- Retention: chats with no activity for 12 months (updated_at) are deleted by
-- public.riffscribe_assistant_chats_delete_inactive(), daily, with pg_cron.

create table if not exists public.riffscribe_assistant_chats (
  id          text        not null check (char_length(id) between 1 and 128),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- The adapter's `app` option. This table is riffscribe's alone, but the adapter
  -- scopes every query by it, so it stays.
  app         text        not null default 'riffscribe' check (char_length(app) <= 128),
  title       text        not null default 'New chat' check (char_length(title) <= 500),
  messages    jsonb       not null default '[]'::jsonb
                          check (jsonb_typeof(messages) = 'array')
                          -- Generous cap so one person cannot fill the database. The
                          -- widget keeps at most 100 messages per chat.
                          check (octet_length(messages::text) <= 5000000),
  pinned      boolean     not null default false,
  archived    boolean     not null default false,
  group_id    text,
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- The sidebar: one person's chats, newest first.
create index if not exists riffscribe_assistant_chats_user_app_updated_idx
  on public.riffscribe_assistant_chats (user_id, app, updated_at desc);
-- The retention sweep.
create index if not exists riffscribe_assistant_chats_updated_idx
  on public.riffscribe_assistant_chats (updated_at);

-- The client sends its own timestamps: created_at keeps a moved chat's real age, and
-- updated_at is its last activity. It may never send one in the future — that would
-- dodge the retention rule.
create or replace function public.riffscribe_assistant_chats_clamp_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := least(coalesce(new.updated_at, now()), now());
  new.created_at := least(coalesce(new.created_at, now()), new.updated_at);
  return new;
end;
$$;

drop trigger if exists riffscribe_assistant_chats_clamp_times on public.riffscribe_assistant_chats;
create trigger riffscribe_assistant_chats_clamp_times
  before insert or update on public.riffscribe_assistant_chats
  for each row execute function public.riffscribe_assistant_chats_clamp_times();

-- Row-level security: a signed-in person reads, adds, changes and deletes only their
-- own chats. There is no shared-link policy here, unlike charts.
alter table public.riffscribe_assistant_chats enable row level security;

drop policy if exists "riffscribe: read own assistant chats" on public.riffscribe_assistant_chats;
create policy "riffscribe: read own assistant chats" on public.riffscribe_assistant_chats
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "riffscribe: insert own assistant chats" on public.riffscribe_assistant_chats;
create policy "riffscribe: insert own assistant chats" on public.riffscribe_assistant_chats
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "riffscribe: update own assistant chats" on public.riffscribe_assistant_chats;
create policy "riffscribe: update own assistant chats" on public.riffscribe_assistant_chats
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "riffscribe: delete own assistant chats" on public.riffscribe_assistant_chats;
create policy "riffscribe: delete own assistant chats" on public.riffscribe_assistant_chats
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.riffscribe_assistant_chats from anon;
grant select, insert, update, delete on table public.riffscribe_assistant_chats to authenticated;

-- Retention: delete chats with no activity for 12 months. Returns how many went. The
-- interval is fixed, with no parameter, so nobody can call this to wipe everything.
create or replace function public.riffscribe_assistant_chats_delete_inactive()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.riffscribe_assistant_chats
  where updated_at < now() - interval '12 months';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Only the database owner and the service role may run it; never a signed-in player.
revoke execute on function public.riffscribe_assistant_chats_delete_inactive() from public, anon, authenticated;
grant execute on function public.riffscribe_assistant_chats_delete_inactive() to service_role;

-- Schedule it daily at 03:17 UTC with pg_cron, when pg_cron is enabled. Re-running this
-- file updates the same job rather than adding a second one.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'riffscribe-assistant-chats-retention',
      '17 3 * * *',
      'select public.riffscribe_assistant_chats_delete_inactive()'
    );
  else
    raise notice 'pg_cron is not enabled: riffscribe_assistant_chats_delete_inactive() is not scheduled (see the end of supabase/assistant_chats.sql).';
  end if;
end;
$$;

-- If pg_cron was not enabled when this ran: enable it, then run once
--
--   select cron.schedule(
--     'riffscribe-assistant-chats-retention',
--     '17 3 * * *',
--     'select public.riffscribe_assistant_chats_delete_inactive()'
--   );
--
-- Check it with:
--
--   select jobname, schedule, command from cron.job
--   where jobname = 'riffscribe-assistant-chats-retention';
--
-- The adapter also hides and deletes a player's own inactive chats each time they open
-- the assistant, but someone who never comes back is only covered by the scheduled run.
