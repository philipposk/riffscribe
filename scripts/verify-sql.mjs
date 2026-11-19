#!/usr/bin/env node
/**
 * Checks the Supabase SQL without a database: reads every supabase/**\/*.sql
 * in apply order and looks at the last definition of each object.
 *
 * - Every file is in the apply order (schema, accounts, assistant_chats, then
 *   migrations/ by number), and migration numbers are not reused.
 * - Every object riffscribe creates is prefixed riffscribe_ (HANDOFF G7: the
 *   project is shared by ~18 apps in one schema).
 * - Re-running is safe: create table/index if not exists, create or replace
 *   function, and every policy, trigger and constraint dropped before it is
 *   created.
 * - Every riffscribe table has row-level security on and is closed to anon.
 * - Every policy is `to authenticated` and reads `(select auth.uid())`, never a
 *   bare auth.uid() (evaluated once per row).
 * - Every security definer function ends with `search_path = ''` and is revoked
 *   from public; the service-role-only ones are granted to nobody else.
 * - riffscribe_charts_cap is revoked, and the shared-chart listing policy is
 *   dropped after it is created.
 * - A signed-out reader still opens a shared chart once anon loses the table
 *   (chartAccess.ts falls through to riffscribe_shared_chart on 42501).
 *
 * Run with: node --experimental-strip-types scripts/verify-sql.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const access = await import("../src/lib/store/chartAccess.ts").catch(() => null);
if (!access) {
  console.log("run with: node --experimental-strip-types scripts/verify-sql.mjs");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const supa = join(root, "supabase");

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

/* ------------------------------------------------------------ apply order */

const BASE = ["schema.sql", "accounts.sql", "assistant_chats.sql"];
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".")) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".sql") ? [relative(supa, p)] : [];
  });
}
const all = walk(supa).sort();
const migrations = all.filter((f) => f.startsWith("migrations/")).sort();
const order = [...BASE, ...migrations];
const stray = all.filter((f) => !order.includes(f));
check("every SQL file is in the apply order", !stray.length && BASE.every((f) => all.includes(f)), stray.join(", "));
check("every migration is named NNNN_name.sql", migrations.every((f) => /^migrations\/\d{4}_[a-z0-9_]+\.sql$/.test(f)));
const nums = migrations.map((f) => f.slice(11, 15));
check("no migration number is used twice", new Set(nums).size === nums.length, nums.join(" "));

/* -------------------------------------------------------------- statements */

/** Split SQL into statements, skipping comments and respecting quotes and $tag$ bodies. */
function statements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        const stop = end < 0 ? sql.length : end + m[0].length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "uid uuid, out songs integer" -> "uuid" (identity argument types). */
function argTypes(list) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => p.trim().replace(/\s+default\s+[\s\S]*$/i, "").split(/\s+/))
    .filter((w) => w[0] && !/^out$/i.test(w[0]))
    .map((w) => (/^(in|inout|variadic)$/i.test(w[0]) ? w.slice(1) : w))
    .map((w) => (w.length > 1 ? w.slice(1) : w).join(" ").toLowerCase())
    .join(",");
}

/** Body of the `(...)` that starts at `from` (the index of its open paren). */
function parens(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")" && --depth === 0) return s.slice(from + 1, i);
  }
  return "";
}

const fn = new Map(); // "name(types)" -> { name, secdef, searchPath, body, file }
const policies = new Map(); // "table|name" -> { text, file }
const tables = new Map(); // name -> { rls, file }
const revokedFromAnon = new Set();
const fnRevokes = new Map(); // key -> Set(roles)
const fnGrants = new Map(); // key -> Set(roles)
const prefixed = []; // [kind, name, file]
const idempotency = []; // problems
const timeline = []; // [index, event]
const dropped = { policy: new Set(), trigger: new Set(), constraint: new Set() };

function fnKey(name, list) {
  return `${name.toLowerCase()}(${argTypes(list)})`;
}
function roles(s) {
  return s.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
}
function addAll(map, key, rs) {
  if (!map.has(key)) map.set(key, new Set());
  for (const r of rs) map.get(key).add(r);
}

let n = 0;
for (const file of order) {
  for (const st of statements(readFileSync(join(supa, file), "utf8"))) {
    n++;
    const s = st.replace(/\s+/g, " ");
    const low = s.toLowerCase();
    let m;

    if ((m = /^create (or replace )?function public\.(\w+)\s*\(/i.exec(s))) {
      const name = m[2];
      const list = parens(s, m[0].length - 1);
      const key = fnKey(name, list);
      if (!m[1]) idempotency.push(`${file}: create function ${name} without or replace`);
      const head = s.slice(0, s.indexOf("$"));
      const sp = /set search_path\s*(?:=|to)\s*('[^']*'|[\w, ]+?)(?=\s+as\s|\s+language\s|\s+security\s|\s+stable|\s+volatile|\s+immutable|$)/i.exec(head);
      fn.set(key, {
        name,
        secdef: /\bsecurity definer\b/i.test(head),
        searchPath: sp ? sp[1].trim() : null,
        body: s,
        file,
      });
      prefixed.push(["function", name, file]);
      timeline.push([n, `create function ${key}`]);
      continue;
    }
    if ((m = /^alter function public\.(\w+)\s*\(/i.exec(s))) {
      const key = fnKey(m[1], parens(s, m[0].length - 1));
      const f = fn.get(key);
      if (!f) {
        idempotency.push(`${file}: alter function ${key} before it is created`);
        continue;
      }
      const rest = s.slice(m[0].length - 1 + parens(s, m[0].length - 1).length + 2);
      let a;
      if ((a = /set search_path\s*(?:=|to)\s*('[^']*'|[\w, ]+)/i.exec(rest))) f.searchPath = a[1].trim();
      if (/reset search_path|reset all/i.test(rest)) f.searchPath = null;
      if (/security definer/i.test(rest)) f.secdef = true;
      if (/security invoker/i.test(rest)) f.secdef = false;
      continue;
    }
    if ((m = /^drop function (if exists )?public\.(\w+)\s*\(/i.exec(s))) {
      fn.delete(fnKey(m[2], parens(s, m[0].length - 1)));
      continue;
    }
    if ((m = /^(revoke|grant) (.+?) on function public\.(\w+)\s*\(/i.exec(s))) {
      const list = parens(s, m[0].length - 1);
      const key = fnKey(m[3], list);
      const who = s.slice(m[0].length + list.length + 1).replace(/^\s*(from|to)\s+/i, "");
      addAll(m[1].toLowerCase() === "revoke" ? fnRevokes : fnGrants, key, roles(who));
      continue;
    }
    if ((m = /^create table (if not exists )?public\.(\w+)/i.exec(s))) {
      if (!m[1]) idempotency.push(`${file}: create table ${m[2]} without if not exists`);
      tables.set(m[2], { rls: false, file });
      prefixed.push(["table", m[2], file]);
      continue;
    }
    if ((m = /^alter table public\.(\w+) enable row level security/i.exec(s))) {
      if (tables.has(m[1])) tables.get(m[1]).rls = true;
      continue;
    }
    if ((m = /^revoke (.+?) on table (.+?) from (.+)$/i.exec(s))) {
      if (/\ball\b/i.test(m[1]) && roles(m[3]).includes("anon")) {
        for (const t of m[2].split(",")) revokedFromAnon.add(t.trim().replace(/^public\./, ""));
      }
      continue;
    }
    if ((m = /^drop policy (if exists )?"([^"]+)" on public\.(\w+)/i.exec(s))) {
      policies.delete(`${m[3]}|${m[2]}`);
      dropped.policy.add(`${m[3]}|${m[2]}`);
      timeline.push([n, `drop policy ${m[3]}|${m[2]}`]);
      continue;
    }
    if ((m = /^create policy "([^"]+)" on public\.(\w+)/i.exec(s))) {
      const key = `${m[2]}|${m[1]}`;
      if (!dropped.policy.has(key)) idempotency.push(`${file}: policy "${m[1]}" created without a drop policy if exists`);
      dropped.policy.delete(key);
      policies.set(key, { text: s, file });
      prefixed.push(["policy", m[1].replace(/^riffscribe: .*/, "riffscribe_policy"), file]);
      timeline.push([n, `create policy ${key}`, s]);
      continue;
    }
    if ((m = /^drop trigger (if exists )?(\w+) on public\.(\w+)/i.exec(s))) {
      dropped.trigger.add(`${m[3]}|${m[2]}`);
      continue;
    }
    if ((m = /^create trigger (\w+) .*? on public\.(\w+)/i.exec(s))) {
      if (!dropped.trigger.has(`${m[2]}|${m[1]}`)) idempotency.push(`${file}: trigger ${m[1]} created without a drop trigger if exists`);
      dropped.trigger.delete(`${m[2]}|${m[1]}`);
      prefixed.push(["trigger", m[1], file]);
      continue;
    }
    if ((m = /^create (unique )?index (if not exists )?(\w+)/i.exec(s))) {
      if (!m[2]) idempotency.push(`${file}: index ${m[3]} without if not exists`);
      prefixed.push(["index", m[3], file]);
      continue;
    }
    if ((m = /^alter table public\.(\w+) drop constraint (if exists )?(\w+)/i.exec(s))) {
      dropped.constraint.add(`${m[1]}|${m[3]}`);
      continue;
    }
    if ((m = /^alter table public\.(\w+) add constraint (\w+)/i.exec(s))) {
      if (!dropped.constraint.has(`${m[1]}|${m[2]}`)) idempotency.push(`${file}: constraint ${m[2]} added without a drop constraint if exists`);
      dropped.constraint.delete(`${m[1]}|${m[2]}`);
      prefixed.push(["constraint", m[2], file]);
      continue;
    }
    if (/^alter table public\.(\w+) add column (?!if not exists)/i.test(s)) {
      idempotency.push(`${file}: add column without if not exists`);
    }
    for (const j of low.matchAll(/cron\.schedule\(\s*'([^']+)'/g)) prefixed.push(["cron job", j[1].replace(/-/g, "_"), file]);
  }
}

/* ------------------------------------------------------------------ checks */

const unprefixed = prefixed.filter(([, name]) => !name.startsWith("riffscribe_") && !name.startsWith("riffscribe-"));
check("every object riffscribe creates is prefixed riffscribe_", !unprefixed.length,
  unprefixed.map(([k, nm, f]) => `${k} ${nm} (${f})`).join("; "));
check("every file can be re-run (idempotent statements)", !idempotency.length, idempotency.join("; "));

const noRls = [...tables].filter(([, t]) => !t.rls).map(([nm]) => nm);
check("row-level security is on for every riffscribe table", !noRls.length, noRls.join(", "));
const openToAnon = [...tables.keys()].filter((t) => !revokedFromAnon.has(t));
check("every riffscribe table is revoked from anon", !openToAnon.length, openToAnon.join(", "));

const finalPolicies = [...policies].filter(([k]) => k.startsWith("riffscribe_"));
check("riffscribe has policies to check", finalPolicies.length >= 10, `${finalPolicies.length}`);
const notAuth = finalPolicies.filter(([, p]) => !/ for (select|insert|update|delete|all) to authenticated\b/i.test(p.text));
check("no riffscribe policy lacks `to authenticated`", !notAuth.length, notAuth.map(([k, p]) => `${k} (${p.file})`).join("; "));
const bare = finalPolicies.filter(([, p]) => /auth\.uid\(\)/i.test(p.text.replace(/\(\s*select\s+auth\.uid\(\)\s*\)/gi, "")));
check("no policy uses a bare auth.uid()", !bare.length, bare.map(([k, p]) => `${k} (${p.file})`).join("; "));
const openSelect = finalPolicies.filter(([, p]) => / using \(\s*(shared\s*=\s*true|true)\s*\)/i.test(p.text));
check("no remaining policy opens rows to everyone", !openSelect.length, openSelect.map(([k]) => k).join("; "));

const definers = [...fn].filter(([, f]) => f.secdef);
check("there are security definer functions to check", definers.length >= 8, `${definers.length}`);
const noPath = definers.filter(([, f]) => f.searchPath !== "''");
check("every security definer function ends with search_path = ''", !noPath.length,
  noPath.map(([k, f]) => `${k} = ${f.searchPath ?? "unset"}`).join("; "));
const notRevoked = definers.filter(([k]) => !fnRevokes.get(k)?.has("public"));
check("every security definer function is revoked from public", !notRevoked.length, notRevoked.map(([k]) => k).join(", "));
const mutable = [...fn].filter(([, f]) => f.name.startsWith("riffscribe_") && f.searchPath === null);
check("every riffscribe function has a fixed search_path", !mutable.length, mutable.map(([k]) => k).join(", "));

for (const key of ["riffscribe_refund_assistant(uuid,text)", "riffscribe_log_llm(text,text,integer,integer,integer,boolean)", "riffscribe_plan(uuid)"]) {
  const rv = fnRevokes.get(key) ?? new Set();
  const gr = fnGrants.get(key) ?? new Set();
  check(`${key} is closed to browsers`, fn.has(key) && ["public", "anon", "authenticated"].every((r) => rv.has(r)) && !gr.has("anon") && !gr.has("authenticated"));
}
check("riffscribe_log_llm and the refund are granted to the service role",
  fnGrants.get("riffscribe_refund_assistant(uuid,text)")?.has("service_role") &&
  fnGrants.get("riffscribe_log_llm(text,text,integer,integer,integer,boolean)")?.has("service_role"));
check("riffscribe_charts_cap has a revoke", ["public", "anon", "authenticated"].every((r) => fnRevokes.get("riffscribe_charts_cap()")?.has(r)));
const cap = fn.get("riffscribe_charts_cap()")?.body ?? "";
const capBody = cap.slice(cap.indexOf("begin") + 5).trim();
check("riffscribe_charts_cap takes its per-owner lock first", /^perform pg_catalog\.pg_advisory_xact_lock\(/i.test(capBody));
check("riffscribe_shared_chart is open to anon and authenticated only",
  ["anon", "authenticated"].every((r) => fnGrants.get("riffscribe_shared_chart(uuid)")?.has(r)) && fnRevokes.get("riffscribe_shared_chart(uuid)")?.has("public"));
check("riffscribe_is_admin is for signed-in callers",
  fnGrants.get("riffscribe_is_admin()")?.has("authenticated") && fnRevokes.get("riffscribe_is_admin()")?.has("anon"));

const del = fn.get("riffscribe_delete_my_data()")?.body ?? "";
check("deleting your data keeps this month's assistant counter", /period <> public\.riffscribe_period\(\)/.test(del));
check("deleting your data removes the Stripe customer link when that table exists",
  /to_regclass\('public\.riffscribe_customers'\)/.test(del) && /delete from public\.riffscribe_customers/.test(del));
check("the plan counts past_due as paid", /'past_due'/.test(fn.get("riffscribe_plan(uuid)")?.body ?? ""));

const sharedCreate = timeline.findIndex((e) => e[1] === "create policy riffscribe_charts|riffscribe: read shared charts" && /for select using \(shared = true\)/i.test(e[2]));
const sharedDrop = timeline.findIndex((e, i) => i > sharedCreate && e[1] === "drop policy riffscribe_charts|riffscribe: read shared charts");
check("`for select using (shared = true)` is dropped later", sharedCreate >= 0 && sharedDrop > sharedCreate);

for (const t of ["riffscribe_customers", "riffscribe_admins", "riffscribe_settings", "riffscribe_llm_usage"]) {
  check(`${t} exists`, tables.has(t));
}
const adminPolicies = finalPolicies.filter(([k]) => /^riffscribe_(settings|llm_usage)\|/.test(k));
check("settings and usage policies all go through riffscribe_is_admin()",
  adminPolicies.length === 4 && adminPolicies.every(([, p]) => /\(select public\.riffscribe_is_admin\(\)\)/i.test(p.text)));
check("no policy lets anyone write riffscribe_llm_usage", !adminPolicies.some(([k, p]) => k.startsWith("riffscribe_llm_usage") && !/ for select /i.test(p.text)));
const noPolicy = ["riffscribe_customers", "riffscribe_admins", "riffscribe_webhook_events"].filter((t) => finalPolicies.some(([k]) => k.startsWith(`${t}|`)));
check("customers, admins and webhook events have no policies (service role only)", !noPolicy.length, noPolicy.join(", "));

/* ----------------------------------------- the app after anon loses the table */

function chartsDb(table, rpc) {
  return {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => table() };
      return q;
    },
    rpc: async (name, args) => rpc(name, args),
  };
}
const denied = { data: null, error: { code: "42501", message: "permission denied for table riffscribe_charts" } };
{
  const s = chartsDb(() => denied, (name, args) =>
    name === "riffscribe_shared_chart" && args.chart_id === "s1" ? { data: { title: "shared" }, error: null } : { data: null, error: null });
  let got = null;
  try {
    got = await access.readChart(s, "s1");
  } catch (e) {
    got = e;
  }
  check("signed out, a refused table read falls through to the lookup function", got?.title === "shared", got?.message);
}
{
  const s = chartsDb(() => denied, () => ({ data: null, error: null }));
  check("signed out, an unshared chart is null", (await access.readChart(s, "s2").catch((e) => e)) === null);
}
{
  const s = chartsDb(() => ({ data: null, error: { code: "57014", message: "timeout" } }), () => ({ data: null, error: null }));
  check("any other table error is still thrown", (await access.readChart(s, "s3").catch((e) => e))?.message === "timeout");
}

check("supabase/README.md gives the apply order", existsSync(join(supa, "README.md")) &&
  order.every((f) => readFileSync(join(supa, "README.md"), "utf8").includes(f.replace("migrations/", ""))));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
