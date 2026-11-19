#!/usr/bin/env node
/**
 * Checks who sees, changes and deletes which data, without a database or Stripe.
 *
 * - "Your songs" lists only your own charts, and nothing when signed out.
 * - A shared chart opened by someone else comes through riffscribe_shared_chart,
 *   not a table read (so the table cannot be listed), and an older database
 *   without that function still answers.
 * - Deleting or sharing a chart that is not yours (or has gone) is an error,
 *   not a silent success.
 * - Delete-my-data stops when Stripe could not cancel a live subscription, and
 *   when billing is set up but subscriptions cannot be read.
 * - Stripe's cancellation webhook after a deletion does not write the row back.
 *
 * Run with: node --experimental-strip-types scripts/verify-account-data.mjs
 */
let access, deletion, billing;
try {
  access = await import("../src/lib/store/chartAccess.ts");
  deletion = await import("../src/lib/billingFlow.ts");
  billing = await import("../src/lib/billingFlow.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-account-data.mjs");
    process.exit(0);
  }
  throw e;
}

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}
async function rejects(p) {
  try { await p; return null; } catch (e) { return e; }
}

/* ------------------------------------------------------------- charts */

/**
 * A query builder that records its filters and answers from `answer(q)`.
 * Every chain method returns the builder; awaiting it or calling
 * maybeSingle() resolves the answer.
 */
function chartsDb(answer, rpcAnswer = () => ({ data: null, error: null })) {
  const log = [];
  return {
    log,
    from(table) {
      const q = { table, op: "select", filters: {}, selected: null };
      log.push(q);
      const b = {
        select(cols) { if (q.op === "select") q.cols = cols; else q.selected = cols; return b; },
        delete() { q.op = "delete"; return b; },
        update(v) { q.op = "update"; q.values = v; return b; },
        eq(col, val) { q.filters[col] = val; return b; },
        order() { return b; },
        maybeSingle() { return Promise.resolve(answer(q)); },
        then(res, rej) { return Promise.resolve(answer(q)).then(res, rej); },
      };
      return b;
    },
    rpc(fn, args) {
      log.push({ rpc: fn, args });
      return Promise.resolve(rpcAnswer(fn, args));
    },
  };
}

{
  const s = chartsDb(() => ({ data: [{ id: "a" }], error: null }));
  const rows = await access.listOwnCharts(s, "me");
  check("listing filters on the owner", s.log[0].filters.owner === "me" && rows.length === 1);
}
{
  const s = chartsDb(() => ({ data: [{ id: "a" }], error: null }));
  const rows = await access.listOwnCharts(s, null);
  check("signed out, the list is empty and nothing is queried", rows.length === 0 && s.log.length === 0);
}
{
  const s = chartsDb(() => ({ data: { data: { title: "mine" } }, error: null }));
  const c = await access.readChart(s, "id1");
  check("an own chart reads from the table", c?.title === "mine" && !s.log.some((l) => l.rpc));
}
{
  const s = chartsDb(() => ({ data: null, error: null }), (fn, args) =>
    fn === "riffscribe_shared_chart" && args.chart_id === "id2" ? { data: { title: "theirs" }, error: null } : { data: null, error: null });
  const c = await access.readChart(s, "id2");
  check("someone else's shared chart comes through the lookup function", c?.title === "theirs");
}
{
  const s = chartsDb(() => ({ data: null, error: null }), () => ({ data: null, error: null }));
  check("an unshared or unknown chart is null", (await access.readChart(s, "id3")) === null);
}
{
  const s = chartsDb(() => ({ data: null, error: null }), () => ({
    data: null, error: { code: "PGRST202", message: "Could not find the function public.riffscribe_shared_chart" },
  }));
  check("before the function exists, a miss is still just null", (await access.readChart(s, "id4")) === null);
}
{
  const s = chartsDb(() => ({ data: null, error: null }), () => ({ data: null, error: { code: "57014", message: "timeout" } }));
  check("any other lookup error is thrown", (await rejects(access.readChart(s, "id5")))?.message === "timeout");
}
{
  const s = chartsDb((q) => ({ data: q.selected ? [] : null, error: null }));
  const e = await rejects(access.deleteOwnChart(s, "x"));
  check("deleting a chart that is not yours is an error", /not yours/.test(e?.message ?? ""), e?.message);
  check("…and asks for the deleted rows back", s.log[0].op === "delete" && s.log[0].selected === "id");
}
{
  const s = chartsDb(() => ({ data: [{ id: "x" }], error: null }));
  check("deleting your own chart succeeds", (await rejects(access.deleteOwnChart(s, "x"))) === null);
}
{
  const s = chartsDb(() => ({ data: [], error: null }));
  const e = await rejects(access.setChartShared(s, "x", true));
  check("sharing a chart that is not yours is an error", /not yours/.test(e?.message ?? ""), e?.message);
}
{
  const s = chartsDb(() => ({ data: [{ id: "x" }], error: null }));
  const ok = (await rejects(access.setChartShared(s, "x", true))) === null;
  check("sharing your own chart succeeds", ok && s.log[0].values.shared === true && s.log[0].filters.id === "x");
}

/* ------------------------------------------------------- delete my data */

function delDeps(over = {}) {
  const calls = [];
  return {
    calls,
    billing: true,
    serviceKey: true,
    readSubscription: async () => ({ data: { stripe_subscription_id: "sub_1", status: "active" }, error: null }),
    cancel: async (id) => { calls.push(["cancel", id]); },
    retrieve: async (id) => { calls.push(["retrieve", id]); return { status: "active" }; },
    deleteData: async () => { calls.push(["rpc"]); return { error: null }; },
    log: () => {},
    ...over,
  };
}
const ran = (d, what) => d.calls.some((c) => c[0] === what);

{
  const d = delDeps();
  const r = await deletion.deleteMyData(d);
  check("a Pro user's sub is cancelled, then the data deleted", r.status === 200 && ran(d, "cancel") && ran(d, "rpc"));
}
{
  const d = delDeps({ cancel: async () => { throw Object.assign(new Error("connect ETIMEDOUT"), { type: "StripeConnectionError" }); } });
  const r = await deletion.deleteMyData(d);
  check("a Stripe network error stops the deletion", r.status === 502 && !ran(d, "rpc"), `got ${r.status}`);
}
{
  const d = delDeps({
    cancel: async () => { throw new Error("A canceled subscription can only update its cancellation_details and metadata."); },
    retrieve: async () => ({ status: "canceled" }),
  });
  const r = await deletion.deleteMyData(d);
  check("an already-cancelled sub does not block the deletion", r.status === 200 && ran(d, "rpc"));
}
{
  const d = delDeps({ cancel: async () => { throw Object.assign(new Error("No such subscription"), { code: "resource_missing" }); } });
  const r = await deletion.deleteMyData(d);
  check("a sub Stripe does not know does not block the deletion", r.status === 200 && ran(d, "rpc"));
}
{
  const d = delDeps({ readSubscription: async () => ({ data: { stripe_subscription_id: "sub_1", status: "canceled" }, error: null }) });
  const r = await deletion.deleteMyData(d);
  check("a sub stored as cancelled is not cancelled again", r.status === 200 && !ran(d, "cancel") && ran(d, "rpc"));
}
{
  const d = delDeps({ serviceKey: false });
  const r = await deletion.deleteMyData(d);
  check("billing on but no service key: nothing is deleted", r.status === 500 && !ran(d, "rpc"));
}
{
  const d = delDeps({ readSubscription: async () => ({ data: null, error: { message: "permission denied" } }) });
  const r = await deletion.deleteMyData(d);
  check("a failed subscription read: nothing is deleted", r.status === 500 && !ran(d, "rpc"));
}
{
  const d = delDeps({ billing: false, serviceKey: false });
  const r = await deletion.deleteMyData(d);
  check("billing off: data is deleted without Stripe", r.status === 200 && ran(d, "rpc") && !ran(d, "cancel"));
}
{
  const d = delDeps({ deleteData: async () => ({ error: { message: "boom" } }) });
  const r = await deletion.deleteMyData(d);
  check("a failed delete answers 500", r.status === 500 && r.body.error === "boom");
}

/* ----------------------------------------------------- webhook after delete */

function hookDb(row = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert(values) { calls.push({ table, op: "insert", values }); return Promise.resolve({ error: null }); },
        delete() { return { eq: () => { calls.push({ table, op: "delete" }); return Promise.resolve({ error: null }); } }; },
        upsert(values) { calls.push({ table, op: "upsert", values }); return Promise.resolve({ error: null }); },
        select() { const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: row, error: null }) }; return q; },
      };
    },
  };
}
const META = { supabase_user_id: "u1", app: "riffscribe", plan: "pro" };
const sub = (over = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", metadata: { ...META },
  cancel_at_period_end: false, cancel_at: null, items: { data: [{ current_period_end: 1_800_000_000 }] }, ...over,
});
const hookDeps = (db, live) => ({ db, app: "riffscribe", log: () => {}, retrieveSubscription: async (id) => structuredClone(live[id]) });
const evt = (type, object) => ({ id: "evt_1", type, created: 1, data: { object } });

{
  const db = hookDb(null);
  await billing.handleWebhookEvent(evt("customer.subscription.deleted", sub({ status: "canceled" })), hookDeps(db, { sub_1: sub({ status: "canceled" }) }));
  check("a cancellation with no stored row (data deleted) writes nothing", !db.calls.some((c) => c.op === "upsert"));
}
{
  const db = hookDb({ stripe_subscription_id: "sub_1", status: "active" });
  await billing.handleWebhookEvent(evt("customer.subscription.deleted", sub({ status: "canceled" })), hookDeps(db, { sub_1: sub({ status: "canceled" }) }));
  check("…but an existing row is still marked cancelled", db.calls.find((c) => c.op === "upsert")?.values.status === "canceled");
}
{
  const db = hookDb(null);
  await billing.handleWebhookEvent(evt("customer.subscription.created", sub()), hookDeps(db, { sub_1: sub() }));
  check("a new live sub with no row is written", db.calls.find((c) => c.op === "upsert")?.values.status === "active");
}
{
  const db = hookDb(null);
  await billing.handleWebhookEvent(evt("customer.subscription.updated", sub({ metadata: { app: "other-app" } })), hookDeps(db, {}));
  check("another app's event records nothing, not even its id", db.calls.length === 0);
}

/* ------------------------------------------------- device-saved chats */
{
  const hist = await import("../src/lib/assistantHistory.ts");
  const widget = await import("../node_modules/@page-assistant/widget/dist/chatHistoryMode.js").catch(() => null);
  const store = await import("../node_modules/@page-assistant/widget/dist/chatHistory.js").catch(() => null);
  if (widget && store) {
    check("the device-chats key is the widget's own", hist.deviceChatsKey("u1") === widget.deviceStorageKey(store.CHAT_HISTORY_STORAGE_KEY, "u1"));
  } else {
    console.log("skip  widget not installed: device-chats key not compared");
  }
  const mem = new Map([["page_assistant_chat_history:user:u1", "[]"], ["page_assistant_chat_history:user:u2", "[]"]]);
  globalThis.localStorage = { removeItem: (k) => mem.delete(k) };
  hist.clearDeviceChats("u1");
  check("deleting forgets only that person's device chats", !mem.has("page_assistant_chat_history:user:u1") && mem.has("page_assistant_chat_history:user:u2"));
  delete globalThis.localStorage;
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
