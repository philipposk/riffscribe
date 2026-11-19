# Riffscribe database

Riffscribe lives in the shared 6x7 Supabase project (`fmrnqepyyjucnfbrqawl`),
next to ~18 other apps in one `public` schema. Everything riffscribe owns is
prefixed `riffscribe_` (HANDOFF gotcha 7). The one shared table it writes is
`subscriptions` (rows with `app = 'riffscribe'`).

Every file is safe to run more than once. Apply them in this order, in the SQL
editor or with `supabase db execute -f <file>`:

| # | File | What it does | When |
|---|------|--------------|------|
| 1 | `schema.sql` | charts table, its policies, `updated_at` trigger | first |
| 2 | `accounts.sql` | usage counter, plan lookup, limits, song cap, account menu, delete-my-data | after 1 |
| 3 | `assistant_chats.sql` | the assistant's saved chats, their policies, 12-month sweep | after 1 |
| 4 | `migrations/0003_review_fixes.sql` | `riffscribe_shared_chart`, refund, plan grace period, chart size limits | any time after 2 |
| 5 | `migrations/0004_drop_shared_chart_listing.sql` | drops the policy that let anyone list shared charts | **after the release is deployed** |
| 6 | `migrations/0005_hardening.sql` | policies `to authenticated`, anon closed out of the tables, fixed `search_path` on every function, song-cap lock, retention jobs | **after the release is deployed**, after 0004 |
| 7 | `migrations/0006_billing.sql` | `riffscribe_customers`, `past_due` keeps Pro | any time after 4 |
| 8 | `migrations/0007_admin.sql` | admins, settings, model-usage counts, `riffscribe_is_admin`, `riffscribe_log_llm` | any time after 4 |

Why 0004 and 0005 wait for the deploy: until the release that reads shared
charts through `riffscribe_shared_chart` is live, the running app reads a
shared chart straight from `riffscribe_charts`. 0004 removes the policy that
allows that and 0005 removes the anon role's access to the table, so applying
either early stops shared links opening for anyone not signed in.

The app works with any prefix of this list applied: a missing function or
table reads as "not admin", "default settings", "no stored customer" or "skip
logging".

## Make yourself an admin

After 0007, once, in the SQL editor:

```sql
insert into public.riffscribe_admins (user_id)
select id from auth.users where email = '<you>'
on conflict do nothing;
```

## Retention (pg_cron)

Enable pg_cron first (Database, Extensions) and the jobs schedule themselves
when their file runs. If it was off, enable it and re-run the file. Jobs:

| Job | Schedule (UTC) | Deletes |
|-----|----------------|---------|
| `riffscribe-assistant-chats-retention` | daily 03:17 | chats idle 12 months |
| `riffscribe-webhook-events-retention` | daily 03:17 | Stripe event ids older than 30 days |
| `riffscribe-usage-retention` | 1st of the month 03:23 | usage counters older than 24 months |
| `riffscribe-llm-usage-retention` | daily 03:29 | model-usage counts older than 400 days |

```sql
select jobname, schedule, command from cron.job where jobname like 'riffscribe-%';
```

## Checks

`node --experimental-strip-types scripts/verify-sql.mjs` reads every file here
in this order and checks the final state: prefixes, re-runnable statements,
row-level security and anon access on every table, `to authenticated` and
`(select auth.uid())` on every policy, `search_path = ''` and revokes on every
security definer function. It does not run the SQL. After applying, check in
the dashboard's Security Advisor that no riffscribe object is listed.
