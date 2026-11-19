# Admin page and the assistant's models

The studio assistant (the page-assistant widget) asks a language model what to do with the studio's
controls. Which model answers is decided on the server, from a short allowlist, by an admin. Nothing a
browser sends and no environment variable can name a model.

## Who is an admin

An admin is a row in `riffscribe_admins` (migration `supabase/migrations/0007_admin.sql`), checked
through the database function `riffscribe_is_admin()` as the signed-in caller. The table has row-level
security on and no policies, so nobody can read or edit it from a browser.

Make the first admin once, in the Supabase SQL editor:

```sql
insert into public.riffscribe_admins (user_id)
select id from auth.users where email = '<you>'
on conflict do nothing;
```

Until that table exists, or while it is empty, one user is let in by the environment variable
`RIFFSCRIBE_ADMIN_BOOTSTRAP` (a user id, a uuid). Set it to your own id to reach the page before the
migration has run; remove it once a row exists. Everybody else gets a 403 and the page shows nothing.

The page is `/admin` (`src/app/admin/page.tsx`, `src/components/AdminSettings.tsx`) and it talks to
`/api/admin/settings` (`src/app/api/admin/settings/route.ts`). It shows the saved settings, the
allowlist with prices, and the last 30 days of usage with an estimated cost per row.

## What an admin can change

Per task (today one task, the studio assistant): the **model** (only from that task's allowlist), the
**effort** (low, medium or high; the adapter sends it as the model's reasoning effort), and an
**on/off switch**. A value outside the allowlist is rejected with the reason, not quietly replaced.
Settings live in `riffscribe_settings` (key `llm`) and each server instance caches them for a minute;
saving clears that instance's cache. If the table is missing or unreadable the defaults apply.

## The allowlist and costs

The list is `MODELS` in `src/lib/llm/models.ts`. Prices there are US dollars per million tokens; the
cache-read price is a tenth of the input price.

| Model | Provider | Input | Output | Default for the assistant |
|---|---|---:|---:|---|
| Claude Haiku 5.5 | Anthropic | 0.10 | 0.50 | yes |
| Claude Sonnet 5.5 | Anthropic | 2.00 | 10.00 | |
| Claude Opus 5.5 | Anthropic | 4.00 | 20.00 | |
| gpt-oss-20b | OpenRouter | not set | not set | the fallback |

The prices are the ones written in the code. They were not checked against Anthropic's price list on
the day this page was written; confirm them before relying on the cost column, and fix `models.ts` if
they are stale.

What a request costs: input tokens times the input price, plus output tokens times the output price.
The assistant sends the conversation, the studio's capabilities (the tools) and a system prompt, which
is capped (`src/lib/assistantRequest.ts`: 24 messages, 40,000 characters of history, 700 output
tokens). The system prompt is marked for the provider's prompt cache, so a repeated prefix is billed at the
cache-read price; how much of a real round that covers has not been measured.

As an illustration only, assuming 8,000 input tokens and 300 output tokens a round with no cache hits
(a guess, not a measurement; the admin page shows the real figures):

| Model | Per 1,000 requests | A Free account's 100 requests | A Pro account's 2,000 requests |
|---|---:|---:|---:|
| Haiku 5.5 | $0.95 | $0.10 | $1.90 |
| Sonnet 5.5 | $19 | $1.90 | $38 |
| Opus 5.5 | $38 | $3.80 | $76 |

Pro costs the player EUR 5 a month. A Pro account that uses its whole allowance on Sonnet or Opus
costs more than it pays, and a Free account that does costs real money for nothing. That is why Haiku
is the default. Set a spend limit in the Anthropic console before any key goes into production.

## Fallback rules

`modelChain()` in `src/lib/llm/models.ts` builds the order of models to try, and `complete()` in
`src/lib/llm/complete.ts` walks it:

1. The admin's chosen model, if its provider's key is set (`ANTHROPIC_API_KEY` for Claude models,
   `OPENROUTER_API_KEY` for OpenRouter models).
2. If the first was a Claude model, then the task's fallback (gpt-oss-20b on OpenRouter), if the
   OpenRouter key is set.
3. If the chosen model was an OpenRouter one and its key is missing, the task's default instead.
4. Nothing usable: the route answers 503 "not configured".

The next model is tried only when the Claude adapter throws `LlmUnavailable`: a rate limit, a
connection failure or timeout, a server error (status 500 or above), a request the API rejects over
the tool schema, or the model refusing. Any other error (an invalid key, for one) ends the round with a
502 and no fallback. A request the model never answered is handed back to the
player's monthly allowance (`riffscribe_refund_assistant`, migration 0003).

When the player is on a fallback model the answer is the same shape, so nothing in the studio changes;
the admin page shows how many rounds fell back (`fallbacks` in `riffscribe_llm_usage`).

Claude requests never send sampling parameters, `thinking` or a forced `tool_choice` (current models
reject or ignore them) and never replay thinking blocks; a history without them is valid.

## Usage records

`riffscribe_llm_usage` holds one row per UTC day, task and model: requests, input, cached and output
tokens, and fallbacks. It has no user ids and is written only by the server through
`riffscribe_log_llm`. A scheduled job deletes rows older than 400 days (see `supabase/README.md`).
Missing table means no logging, never an error for the player.

## How to add a model

1. Add an entry to `MODELS` in `src/lib/llm/models.ts`: a key (`provider/model`), the label, the
   provider, the id the provider expects, the two prices and `priceKnown`.
2. Add the key to the `allowed` list of each task that may use it, in `TASKS`.
3. For a provider other than Anthropic and OpenRouter, add an adapter beside `anthropic.ts` and
   `openrouter.ts` and a branch in `complete()`. The adapter must throw `LlmUnavailable` for the cases
   that should fall back.
4. If the model takes the server-side refusal fallback, add its id to `SERVER_FALLBACK` in
   `src/lib/llm/anthropic.ts`.
5. `node --experimental-strip-types scripts/verify-llm-adapter.mjs` (part of `npm test`). Update it
   when the allowlist is meant to change.
6. Deploy. Pick the model on `/admin`.

## Environment

| Variable | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Server only. Claude models. Without it the chain goes straight to the fallback. |
| `OPENROUTER_API_KEY` | Server only. The fallback route. With neither key the widget does not appear. |
| `RIFFSCRIBE_ADMIN_BOOTSTRAP` | The first admin's user id, until a `riffscribe_admins` row exists. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Settings reads, usage logging, refunds. |

`ASSISTANT_MODEL` no longer exists. Delete it from the Vercel project if it is still set.
