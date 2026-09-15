#!/usr/bin/env node
/**
 * Checks the assistant's account chat history wiring without a database.
 *
 * - The adapter talks only to riffscribe's own table, and every query is scoped to
 *   the signed-in person and to this app.
 * - currentUserId() names the session's user, and nobody when signed out, which is
 *   what keeps device-saved chats apart on a shared browser.
 * - supabase/assistant_chats.sql limits every row to its owner and deletes chats
 *   idle for 12 months.
 * - Every Greek string is a key the widget knows; unknown keys are silently ignored.
 *
 * Run with: node --experimental-strip-types scripts/verify-chat-history.mjs
 */
import { readFileSync } from "node:fs";

const src = await import("../src/lib/assistantHistory.ts").catch(() => null);
const lang = await import("../src/lib/assistantLang.ts").catch(() => null);
if (!src || !lang) {
  console.log("run with: node --experimental-strip-types scripts/verify-chat-history.mjs");
  process.exit(0);
}
const { assistantChatHistory, ASSISTANT_CHATS_TABLE, ASSISTANT_CHATS_APP } = src;
const { supabaseChatHistoryAdapter } = await import("../vendor/page-assistant/widget/dist/adapters/supabase.js");
const { DEFAULT_STRINGS } = await import("../vendor/page-assistant/widget/dist/strings.js");

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

/** A stand-in for the supabase-js client that records every query it is asked for. */
function fakeClient(userId) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, ops: [] };
      queries.push(q);
      const chain = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "then") {
              const single = q.ops.some(([op]) => op === "maybeSingle");
              return (resolve, reject) => Promise.resolve({ data: single ? null : [], error: null }).then(resolve, reject);
            }
            return (...args) => {
              q.ops.push([prop, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    auth: {
      getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null }, error: null }),
    },
  };
}

const has = (q, op, ...args) => q.ops.some(([o, ...a]) => o === op && args.every((v, i) => a[i] === v));
const scoped = (q, uid) => has(q, "eq", "user_id", uid) && has(q, "eq", "app", ASSISTANT_CHATS_APP);

// No Supabase project configured: no adapter, so the widget stays on this device.
check("no client means no account adapter", assistantChatHistory(null, supabaseChatHistoryAdapter) === undefined);

// Signed out.
const outClient = fakeClient(null);
const out = assistantChatHistory(outClient, supabaseChatHistoryAdapter);
check("signed out, currentUserId() is null", (await out.currentUserId()) === null);
let refused = false;
try {
  await out.list();
} catch {
  refused = true;
}
check("signed out, list() refuses without querying", refused && outClient.queries.length === 0);

// Signed in.
const uid = "0b6c1a52-8f0e-4c55-9d7e-2f1c9a1d7e01";
const client = fakeClient(uid);
const a = assistantChatHistory(client, supabaseChatHistoryAdapter);
check("signed in, currentUserId() is the session user", (await a.currentUserId()) === uid);
check("retention is 12 months", a.retentionMonths === 12, String(a.retentionMonths));

await a.list();
const [prune, select] = client.queries;
check("list() prunes this person's chats idle past the cutoff", !!prune && has(prune, "delete") && scoped(prune, uid) && prune.ops.some(([o, f]) => o === "lt" && f === "updated_at"));
const cutoff = prune && new Date(prune.ops.find(([o]) => o === "lt")[2]);
const expected = new Date();
expected.setMonth(expected.getMonth() - 12);
check("the cutoff is 12 months ago", !!cutoff && Math.abs(cutoff - expected) < 60_000, cutoff?.toISOString());
check("list() reads only this person's chats in this app", !!select && has(select, "select") && scoped(select, uid));

const now = new Date().toISOString();
await a.save({ id: "c1", title: "Bass part", messages: [{ role: "user", content: "hi" }], createdAt: now, updatedAt: now });
const save = client.queries.at(-1);
const row = save.ops.find(([o]) => o === "upsert")?.[1];
check("save() writes the row as this person, in this app", row?.user_id === uid && row?.app === ASSISTANT_CHATS_APP);

await a.get("c1");
check("get() is scoped to this person", scoped(client.queries.at(-1), uid) && has(client.queries.at(-1), "eq", "id", "c1"));
await a.delete("c1");
check("delete() removes one of this person's chats", has(client.queries.at(-1), "delete") && scoped(client.queries.at(-1), uid) && has(client.queries.at(-1), "eq", "id", "c1"));
await a.deleteAll();
check("deleteAll() removes only this person's chats in this app", has(client.queries.at(-1), "delete") && scoped(client.queries.at(-1), uid));

const tables = new Set(client.queries.map((q) => q.table));
check(`every query goes to ${ASSISTANT_CHATS_TABLE}`, tables.size === 1 && tables.has(ASSISTANT_CHATS_TABLE), [...tables].join(","));

// The migration.
const sql = readFileSync(new URL("../supabase/assistant_chats.sql", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
check("the migration creates the table the adapter uses", sql.includes(`create table if not exists public.${ASSISTANT_CHATS_TABLE}`));
check("row-level security is on", sql.includes(`alter table public.${ASSISTANT_CHATS_TABLE} enable row level security`));
const policies = [...sql.matchAll(/create policy "[^"]+" on public\.\w+\s+for (\w+) to (\w+)\s+([\s\S]*?);/g)];
check("four policies: select, insert, update, delete", policies.map((p) => p[1]).sort().join(",") === "delete,insert,select,update");
check("every policy is for signed-in users only", policies.every((p) => p[2] === "authenticated"));
const MINE = "((select auth.uid()) = user_id)";
const wantBody = {
  select: `using ${MINE}`,
  delete: `using ${MINE}`,
  insert: `with check ${MINE}`,
  update: `using ${MINE} with check ${MINE}`,
};
const wrong = policies.filter((p) => p[3].replace(/\s+/g, " ").trim() !== wantBody[p[1]]);
check("every policy is 'the row is mine'", wrong.length === 0, wrong.map((p) => p[1]).join(", "));
check("anon gets nothing", sql.includes(`revoke all on table public.${ASSISTANT_CHATS_TABLE} from anon`));
check("retention deletes chats idle 12 months", /where updated_at < now\(\) - interval '12 months'/.test(sql));
check(
  "no signed-in user can run the retention sweep",
  sql.includes("revoke execute on function public.riffscribe_assistant_chats_delete_inactive() from public, anon, authenticated"),
);
check("the sweep is scheduled daily with pg_cron", sql.includes("'riffscribe-assistant-chats-retention'"));

// The Greek strings.
const unknown = Object.keys(lang.GREEK_STRINGS).filter((k) => !(k in DEFAULT_STRINGS));
check("every Greek string is a key the widget knows", unknown.length === 0, unknown.join(", "));
const history = Object.keys(DEFAULT_STRINGS).filter((k) => k.startsWith("history") && k !== "historyToggle");
const missing = history.filter((k) => !(k in lang.GREEK_STRINGS));
check(`all ${history.length} chat history strings are in Greek`, missing.length === 0, missing.join(", "));

process.exit(failed ? 1 : 0);
