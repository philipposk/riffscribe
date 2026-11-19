#!/usr/bin/env node
/**
 * Checks the Stripe webhook and checkout logic without Stripe or a database.
 *
 * - A failed database read or write answers 500 and forgets the event, so
 *   Stripe retries instead of the payment being lost.
 * - Only a unique-key clash on the event id counts as a duplicate.
 * - The webhook writes the subscription as Stripe has it now, not the event's
 *   snapshot, so late or retried events cannot roll the state back.
 * - A second subscription cannot overwrite the one that is billing.
 * - Cancelling at period end is stored, and the row still writes before
 *   migrations/0003 adds that column.
 * - Checkout refuses a second Pro and reuses the person's Stripe customer.
 *
 * Run with: node --experimental-strip-types scripts/verify-billing.mjs
 */
let mod;
try {
  mod = await import("../src/lib/billingFlow.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-billing.mjs");
    process.exit(0);
  }
  throw e;
}
const { handleWebhookEvent, checkoutCustomer } = mod;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

/* ------------------------------------------------------------- stand-ins */

/** A Supabase client that records writes and answers from `opts`. */
function fakeDb(opts = {}) {
  const calls = [];
  const row = opts.row ?? null;
  return {
    calls,
    from(table) {
      return {
        insert(values) {
          calls.push({ table, op: "insert", values });
          return Promise.resolve({ error: table === "riffscribe_webhook_events" ? opts.insertError ?? null : null });
        },
        delete() {
          return { eq: (col, val) => { calls.push({ table, op: "delete", col, val }); return Promise.resolve({ error: null }); } };
        },
        upsert(values, options) {
          calls.push({ table, op: "upsert", values, options });
          const n = calls.filter((c) => c.op === "upsert").length;
          const error = typeof opts.upsertError === "function" ? opts.upsertError(values, n) : opts.upsertError ?? null;
          return Promise.resolve({ error });
        },
        select(cols) {
          const q = {
            eq: () => q,
            maybeSingle: () => {
              calls.push({ table, op: "select", cols });
              return Promise.resolve({ data: opts.selectError ? null : row, error: opts.selectError ?? null });
            },
          };
          return q;
        },
      };
    },
  };
}

const META = { supabase_user_id: "u1", app: "riffscribe", plan: "pro" };
const sub = (over = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  metadata: { ...META },
  cancel_at_period_end: false,
  cancel_at: null,
  items: { data: [{ current_period_end: 1_800_000_000 }] },
  ...over,
});
const subEvent = (type, object, id = "evt_1") => ({ id, type, created: 1_700_000_000, data: { object } });

function deps(db, live = {}) {
  const retrieved = [];
  return {
    retrieved,
    db,
    app: "riffscribe",
    log: () => {},
    retrieveSubscription: async (id) => {
      retrieved.push(id);
      if (!(id in live)) throw Object.assign(new Error(`No such subscription: ${id}`), { code: "resource_missing" });
      return structuredClone(live[id]);
    },
  };
}
const upserts = (db) => db.calls.filter((c) => c.op === "upsert");
const deletes = (db) => db.calls.filter((c) => c.op === "delete" && c.table === "riffscribe_webhook_events");

/* ------------------------------------------------- write errors and dedupe */
{
  const db = fakeDb({ upsertError: { code: "23502", message: "null value in column" } });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("a failed subscriptions write answers 500", r.status === 500, `got ${r.status}`);
  check("…and forgets the event so Stripe retries", deletes(db).length === 1 && deletes(db)[0].val === "evt_1");
}
{
  const db = fakeDb({ selectError: { code: "42501", message: "permission denied" } });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("a failed read of the current row answers 500", r.status === 500, `got ${r.status}`);
  check("…writes nothing", upserts(db).length === 0);
  check("…and forgets the event", deletes(db).length === 1);
}
{
  const db = fakeDb({ insertError: { code: "23505", message: "duplicate key value" } });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("a repeated event id is a 200 duplicate", r.status === 200 && r.body.duplicate === true);
  check("…and is not processed again", upserts(db).length === 0);
}
{
  const db = fakeDb({ insertError: { code: "42P01", message: 'relation "riffscribe_webhook_events" does not exist' } });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("any other dedupe error is a 500, not a duplicate", r.status === 500 && !r.body.duplicate, `got ${r.status}`);
  check("…and processes nothing", upserts(db).length === 0);
  check("…and deletes no dedupe row (none was written)", deletes(db).length === 0);
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub() });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d);
  check("a good event is a 200", r.status === 200 && r.body.received === true);
  const w = upserts(db)[0];
  check("…writes the row on (user_id, app)", w?.options?.onConflict === "user_id,app" && w.values.user_id === "u1" && w.values.app === "riffscribe");
  check("…with the status and period end", w?.values.status === "active" && w.values.current_period_end === new Date(1_800_000_000_000).toISOString());
}
{
  const db = fakeDb();
  const r = await handleWebhookEvent({ id: "evt_x", type: "invoice.paid", created: 1, data: { object: {} } }, deps(db));
  check("events we do not handle are a 200 and touch nothing", r.status === 200 && db.calls.length === 0);
}

/* --------------------------------------------- current state, not snapshots */
{
  // A retried `created` (still incomplete) arrives after the sub went active.
  const db = fakeDb({ row: { stripe_subscription_id: "sub_1", status: "active" } });
  const d = deps(db, { sub_1: sub({ status: "active" }) });
  await handleWebhookEvent(subEvent("customer.subscription.created", sub({ status: "incomplete" }), "evt_old"), d);
  check("a stale snapshot is not written; the live subscription is", upserts(db)[0]?.values.status === "active", upserts(db)[0]?.values.status);
  check("…fetched by the event's subscription id", d.retrieved[0] === "sub_1");
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub() });
  await handleWebhookEvent(subEvent("customer.subscription.updated", sub({ metadata: { app: "other-app", supabase_user_id: "u1", plan: "pro" } })), d);
  check("another app's subscription is ignored without a Stripe call", upserts(db).length === 0 && d.retrieved.length === 0);
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub({ metadata: {} }) });
  const session = { subscription: "sub_1", metadata: { ...META } };
  await handleWebhookEvent(subEvent("checkout.session.completed", session), d);
  check("checkout completion links the sub using the session's metadata", upserts(db)[0]?.values.user_id === "u1");
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub({ metadata: { ...META, plan: "free" } }) });
  await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d);
  check("the live subscription's metadata must still name Pro", upserts(db).length === 0);
}
{
  const db = fakeDb();
  const d = deps(db, {});
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d);
  check("a Stripe lookup failure answers 500 so Stripe retries", r.status === 500 && deletes(db).length === 1);
}

/* ------------------------------------------------- a second subscription */
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_A", status: "active" } });
  const d = deps(db, { sub_A: sub({ id: "sub_A" }), sub_B: sub({ id: "sub_B", status: "canceled" }) });
  const r = await handleWebhookEvent(subEvent("customer.subscription.deleted", sub({ id: "sub_B" })), d);
  check("a stray second sub's cancellation does not downgrade the billing one", upserts(db).length === 0 && r.status === 200);
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_A", status: "active" } });
  const d = deps(db, { sub_A: sub({ id: "sub_A", status: "canceled" }), sub_B: sub({ id: "sub_B" }) });
  await handleWebhookEvent(subEvent("customer.subscription.created", sub({ id: "sub_B" })), d);
  check("…but a row whose sub has really ended is replaced", upserts(db)[0]?.values.stripe_subscription_id === "sub_B");
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_A", status: "canceled" } });
  const d = deps(db, { sub_B: sub({ id: "sub_B" }) });
  await handleWebhookEvent(subEvent("customer.subscription.created", sub({ id: "sub_B" })), d);
  check("re-subscribing after a cancellation writes the new sub", upserts(db)[0]?.values.stripe_subscription_id === "sub_B");
}

/* ---------------------------------------------------- cancel at period end */
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub({ cancel_at_period_end: true }) });
  await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d);
  check("cancel at period end is stored", upserts(db)[0]?.values.cancel_at_period_end === true);
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub({ cancel_at: 1_800_000_000 }) });
  await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d);
  check("a scheduled cancel_at counts as ending", upserts(db)[0]?.values.cancel_at_period_end === true);
}
{
  const missing = { code: "PGRST204", message: "Could not find the 'cancel_at_period_end' column of 'subscriptions' in the schema cache" };
  const db = fakeDb({ upsertError: (values) => ("cancel_at_period_end" in values ? missing : null) });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  const w = upserts(db);
  check("without migration 0003 the row still writes", r.status === 200 && w.length === 2 && !("cancel_at_period_end" in w[1].values), `status ${r.status}`);
}

/* ---------------------------------------------------------------- checkout */
function fakeStripe({ customers = [], subs = {}, missing = [] } = {}) {
  const created = [];
  return {
    created,
    customers: {
      list: async ({ email }) => ({ data: customers.filter((c) => c.email === email) }),
      create: async (params, options) => { created.push({ params, options }); return { id: "cus_new" }; },
    },
    subscriptions: {
      list: async ({ customer }) => {
        if (missing.includes(customer)) throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
        return { data: subs[customer] ?? [] };
      },
    },
  };
}
const user = { id: "u1", email: "a@b.c" };
const cdeps = (db, st) => ({ db, app: "riffscribe", stripe: st });

for (const status of ["active", "trialing", "past_due"]) {
  const r = await checkoutCustomer(user, cdeps(fakeDb({ row: { status, stripe_customer_id: "cus_1" } }), fakeStripe()));
  check(`checkout is refused while the stored sub is ${status}`, r.blocked === true);
}
{
  const st = fakeStripe({ subs: { cus_1: [sub({ status: "active" })] } });
  const r = await checkoutCustomer(user, cdeps(fakeDb({ row: { status: "canceled", stripe_customer_id: "cus_1" } }), st));
  check("checkout is refused when Stripe already bills a Pro sub the webhook has not stored", r.blocked === true);
}
{
  const st = fakeStripe({ subs: { cus_1: [sub({ status: "canceled" }), sub({ status: "active", metadata: { app: "other-app" } })] } });
  const r = await checkoutCustomer(user, cdeps(fakeDb({ row: { status: "canceled", stripe_customer_id: "cus_1" } }), st));
  check("a past sub reuses the stored customer", r.customer === "cus_1" && st.created.length === 0, JSON.stringify(r));
}
{
  const st = fakeStripe({ customers: [{ id: "cus_other", email: "a@b.c", metadata: { supabase_user_id: "someone" } }, { id: "cus_mine", email: "a@b.c", metadata: { supabase_user_id: "u1" } }] });
  const r = await checkoutCustomer(user, cdeps(fakeDb(), st));
  check("an earlier customer of this person is found by email and id", r.customer === "cus_mine" && st.created.length === 0, JSON.stringify(r));
}
{
  const st = fakeStripe({ customers: [{ id: "cus_mine", email: "a@b.c", metadata: { supabase_user_id: "u1" } }], subs: { cus_mine: [sub({ status: "trialing" })] } });
  const r = await checkoutCustomer(user, cdeps(fakeDb(), st));
  check("…and its billing Pro sub blocks checkout", r.blocked === true);
}
{
  const st = fakeStripe();
  const r = await checkoutCustomer(user, cdeps(fakeDb(), st));
  const c = st.created[0];
  check("a first checkout creates one customer", r.customer === "cus_new" && st.created.length === 1);
  check("…tagged with the user and app", c?.params.metadata.supabase_user_id === "u1" && c.params.metadata.app === "riffscribe" && c.params.email === "a@b.c");
  check("…with an idempotency key per user", typeof c?.options?.idempotencyKey === "string" && c.options.idempotencyKey.includes("u1"));
}
{
  const st = fakeStripe({ missing: ["cus_test"] });
  const r = await checkoutCustomer(user, cdeps(fakeDb({ row: { status: "canceled", stripe_customer_id: "cus_test" } }), st));
  check("a stored customer Stripe no longer knows (test → live) is replaced", r.customer === "cus_new", JSON.stringify(r));
}
{
  let threw = false;
  try { await checkoutCustomer(user, cdeps(fakeDb({ selectError: { message: "boom" } }), fakeStripe())); } catch { threw = true; }
  check("a failed subscriptions read stops checkout", threw);
}

console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);
