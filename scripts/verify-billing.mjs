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
 * - Checkout refuses a second Pro and reuses the person's Stripe customer,
 *   remembered per mode in riffscribe_customers (skipped while that is missing).
 * - webhookLogic.ts: only our 9 event types and our metadata are acted on;
 *   test events are dropped by a live deployment; invoices refresh the sub;
 *   full refunds and disputes cancel it; fraud warnings refund and cancel only
 *   when STRIPE_AUTO_REFUND_EFW is on; every Stripe write has an idempotency key.
 *
 * Run with: node --experimental-strip-types scripts/verify-billing.mjs
 */
let mod, logic;
try {
  mod = await import("../src/lib/billingFlow.ts");
  logic = await import("../src/lib/billing/webhookLogic.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-billing.mjs");
    process.exit(1);
  }
  throw e;
}
const { checkoutCustomer } = mod;
const { handleWebhookEvent, planAction, isOurs, HANDLED, subscriptionRow, withdrawalOpen } = logic;

let failed = 0;
function check(what, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
}

/* ------------------------------------------------------------- stand-ins */

/**
 * A Supabase client that records writes and answers from `opts`: `row` is the
 * shared subscriptions row, `rows` answers other tables, `missing` lists
 * tables that do not exist yet (every query on them errors, as PostgREST does).
 */
function fakeDb(opts = {}) {
  const calls = [];
  const missing = new Set(opts.missing ?? []);
  const gone = (table) => ({ code: "42P01", message: `relation "public.${table}" does not exist` });
  const answer = (table) => (table === "subscriptions" ? opts.row ?? null : opts.rows?.[table] ?? null);
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
          if (missing.has(table)) return Promise.resolve({ error: gone(table) });
          const n = calls.filter((c) => c.op === "upsert").length;
          const error = typeof opts.upsertError === "function" ? opts.upsertError(values, n) : opts.upsertError ?? null;
          return Promise.resolve({ error });
        },
        select(cols) {
          const q = {
            eq: () => q,
            maybeSingle: () => {
              calls.push({ table, op: "select", cols });
              if (missing.has(table)) return Promise.resolve({ data: null, error: gone(table) });
              return Promise.resolve({ data: opts.selectError ? null : answer(table), error: opts.selectError ?? null });
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
const subEvent = (type, object, id = "evt_1", livemode = false) => ({ id, type, livemode, created: 1_700_000_000, data: { object } });

/** Webhook deps on a test key. `live` is Stripe's current state; `charges` maps charge → subscription. */
function deps(db, live = {}, more = {}) {
  const retrieved = [];
  const cancelled = [];
  const refunded = [];
  return {
    retrieved,
    cancelled,
    refunded,
    db,
    app: "riffscribe",
    live: false,
    autoRefundEfw: false,
    log: () => {},
    retrieveSubscription: async (id) => {
      retrieved.push(id);
      if (!(id in live)) throw Object.assign(new Error(`No such subscription: ${id}`), { code: "resource_missing" });
      return structuredClone(live[id]);
    },
    cancelSubscription: async (id, key) => {
      cancelled.push({ id, key });
      if (more.cancelFails) {
        live[id] = { ...live[id], status: "canceled" }; // someone else cancelled first
        throw new Error("already canceled");
      }
      live[id] = { ...live[id], status: "canceled" };
      return structuredClone(live[id]);
    },
    subscriptionForCharge: async (charge) => (more.charges ?? {})[charge] ?? null,
    refundCharge: async (charge, key) => { refunded.push({ charge, key }); },
    ...more.over,
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
  const r = await handleWebhookEvent(subEvent("customer.created", { metadata: { ...META } }, "evt_x"), deps(db));
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
function fakeStripe({ customers = [], subs = {}, missing = [], deleted = [] } = {}) {
  const created = [];
  return {
    created,
    customers: {
      retrieve: async (id) => {
        if (missing.includes(id)) throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
        return deleted.includes(id) ? { id, deleted: true } : { id };
      },
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
const cdeps = (db, st, live = false) => ({ db, app: "riffscribe", live, stripe: st, log: () => {} });

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

/* ------------------------------------------------- webhookLogic: decisions */
const OFF = { autoRefundEfw: false };
const ON = { autoRefundEfw: true };
const charge = (over = {}) => ({ id: "ch_1", object: "charge", refunded: false, amount_refunded: 0, ...over });
const invoice = (meta = META) => ({ id: "in_1", parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: meta } } });

check("webhookLogic's status lists match billingFlow's",
  JSON.stringify(logic.BILLING_STATUSES) === JSON.stringify(mod.BILLING_STATUSES) &&
    JSON.stringify(logic.ENDED_STATUSES) === JSON.stringify(mod.ENDED_STATUSES));
check("HANDLED lists exactly the 9 endpoint events", HANDLED.size === 9 && HANDLED.has("radar.early_fraud_warning.created") && HANDLED.has("invoice.payment_failed"));
check("an unhandled type is not in HANDLED and is ignored", !HANDLED.has("customer.created") && planAction(subEvent("customer.created", {}), OFF).kind === "ignore");
check("isOurs needs both app and plan", isOurs(META) && !isOurs({ app: "riffscribe" }) && !isOurs({ ...META, app: "other" }) && !isOurs(null));
check("another app's checkout is ignored", planAction(subEvent("checkout.session.completed", { subscription: "sub_1", metadata: { ...META, app: "other-app" } }), OFF).kind === "ignore");
check("a subscription with no metadata is ignored", planAction(subEvent("customer.subscription.updated", sub({ metadata: {} })), OFF).kind === "ignore");
{
  const a = planAction(subEvent("customer.subscription.updated", sub()), OFF);
  check("our subscription update asks for an upsert of that sub", a.kind === "upsert" && a.subscription === "sub_1" && a.eventWins === false);
  const c = planAction(subEvent("checkout.session.completed", { subscription: { id: "sub_9" }, metadata: { ...META } }), OFF);
  check("…and a completed checkout of its (expanded) sub, session metadata winning", c.kind === "upsert" && c.subscription === "sub_9" && c.eventWins === true);
}
{
  const row = subscriptionRow(sub({ status: "past_due", customer: { id: "cus_x" }, cancel_at_period_end: true }), "u9", "riffscribe", "2026-01-01T00:00:00.000Z");
  check(
    "subscriptionRow builds the shared row",
    row.user_id === "u9" && row.app === "riffscribe" && row.plan === "pro" && row.status === "past_due" &&
      row.stripe_customer_id === "cus_x" && row.stripe_subscription_id === "sub_1" && row.cancel_at_period_end === true &&
      row.current_period_end === new Date(1_800_000_000_000).toISOString() && row.updated_at === "2026-01-01T00:00:00.000Z",
    JSON.stringify(row)
  );
}
{
  const a = planAction(subEvent("invoice.payment_failed", invoice()), OFF);
  check("invoice.payment_failed → refresh the sub", a.kind === "refresh" && a.subscription === "sub_1");
  check("invoice.paid → refresh too", planAction(subEvent("invoice.paid", invoice()), OFF).kind === "refresh");
  check("another app's invoice is ignored", planAction(subEvent("invoice.paid", invoice({ app: "other", plan: "pro" })), OFF).kind === "ignore");
  check("an invoice with no subscription is ignored", planAction(subEvent("invoice.paid", { id: "in_2", parent: null }), OFF).kind === "ignore");
}
check("a full refund → cancel", (() => { const a = planAction(subEvent("charge.refunded", charge({ refunded: true })), OFF); return a.kind === "cancel" && a.charge === "ch_1"; })());
check("a partial refund → ignore", planAction(subEvent("charge.refunded", charge({ amount_refunded: 100 })), OFF).kind === "ignore");
check("a dispute → cancel the disputed charge's sub", (() => { const a = planAction(subEvent("charge.dispute.created", { id: "dp_1", charge: "ch_7" }), OFF); return a.kind === "cancel" && a.charge === "ch_7"; })());
check("an early fraud warning with the flag off → ignore", planAction(subEvent("radar.early_fraud_warning.created", { id: "issfr_1", charge: "ch_1" }), OFF).kind === "ignore");
check("…with the flag on → refund_and_cancel", planAction(subEvent("radar.early_fraud_warning.created", { id: "issfr_1", charge: "ch_1" }), ON).kind === "refund_and_cancel");
check("withdrawal is open on day 13 and closed on day 15", withdrawalOpen(1_000_000, 1_000_000_000 + 13 * 86_400_000) && !withdrawalOpen(1_000_000, 1_000_000_000 + 15 * 86_400_000));

/* --------------------------------------------------- webhookLogic: handler */
{
  const db = fakeDb();
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub(), "evt_live", true), deps(db, { sub_1: sub() }));
  check("a live event on a test deployment is dropped untouched", r.body.ignored === "mode" && db.calls.length === 0);
  const db2 = fakeDb();
  const d2 = { ...deps(db2, { sub_1: sub() }), live: true };
  const r2 = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), d2);
  check("…and a test event on a live deployment too", r2.body.ignored === "mode" && db2.calls.length === 0);
}
{
  const db = fakeDb();
  const r = await handleWebhookEvent(subEvent("charge.refunded", charge({ refunded: true }), "evt_r"), deps(db, {}, { over: { subscriptionForCharge: undefined } }));
  check("a charge event that cannot be wired answers 500 and forgets the event", r.status === 500 && deletes(db).length === 1);
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_1", status: "active" } });
  const d = deps(db, { sub_1: sub({ status: "past_due" }) });
  const r = await handleWebhookEvent(subEvent("invoice.payment_failed", invoice(), "evt_pf"), d);
  check("a failed renewal re-reads the sub and stores past_due", r.status === 200 && upserts(db)[0]?.values.status === "past_due" && d.retrieved[0] === "sub_1");
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_1", status: "active" } });
  const d = deps(db, { sub_1: sub() }, { charges: { ch_1: "sub_1" } });
  const r = await handleWebhookEvent(subEvent("charge.refunded", charge({ refunded: true }), "evt_ref"), d);
  check("a full refund cancels our sub with an event-derived idempotency key", r.status === 200 && d.cancelled.length === 1 && d.cancelled[0].key === "rs-cancel-evt_ref");
  check("…and switches Pro off straight away", upserts(db)[0]?.values.status === "canceled");
  check("…without refunding again", d.refunded.length === 0);
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub({ metadata: { app: "other-app", plan: "pro", supabase_user_id: "u1" } }) }, { charges: { ch_1: "sub_1" } });
  await handleWebhookEvent(subEvent("charge.dispute.created", { id: "dp_1", charge: "ch_1" }, "evt_dp"), d);
  check("a dispute on another app's sub cancels nothing", d.cancelled.length === 0 && upserts(db).length === 0);
}
{
  const db = fakeDb();
  const d = deps(db, {}, { charges: {} });
  const r = await handleWebhookEvent(subEvent("charge.dispute.created", { id: "dp_2", charge: "ch_lone" }, "evt_dp2"), d);
  check("a dispute on a one-off charge is a 200 that cancels nothing", r.status === 200 && d.cancelled.length === 0);
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_1", status: "active" } });
  const d = { ...deps(db, { sub_1: sub() }, { charges: { ch_1: "sub_1" } }), autoRefundEfw: true };
  const r = await handleWebhookEvent(subEvent("radar.early_fraud_warning.created", { id: "issfr_1", charge: "ch_1" }, "evt_efw"), d);
  check("a fraud warning with the flag on refunds then cancels, both keyed on the event",
    r.status === 200 && d.refunded[0]?.key === "rs-refund-evt_efw" && d.cancelled[0]?.key === "rs-cancel-evt_efw");
}
{
  const db = fakeDb();
  const d = deps(db, { sub_1: sub() }, { charges: { ch_1: "sub_1" } });
  const r = await handleWebhookEvent(subEvent("radar.early_fraud_warning.created", { id: "issfr_1", charge: "ch_1" }, "evt_efw0"), d);
  check("…with the flag off it records nothing and touches nothing", r.status === 200 && db.calls.length === 0 && d.refunded.length === 0 && d.cancelled.length === 0);
}
{
  const db = fakeDb({ row: { stripe_subscription_id: "sub_1", status: "active" } });
  const d = deps(db, { sub_1: sub() }, { charges: { ch_1: "sub_1" }, cancelFails: true });
  const r = await handleWebhookEvent(subEvent("charge.refunded", charge({ refunded: true }), "evt_race"), d);
  check("a cancel that loses a race with a withdrawal still succeeds", r.status === 200 && upserts(db)[0]?.values.status === "canceled");
}
{
  const db = fakeDb({ rows: { riffscribe_customers: { user_id: "u_mapped" } } });
  await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("the user comes from riffscribe_customers before metadata", upserts(db)[0]?.values.user_id === "u_mapped");
}
{
  const db = fakeDb({ missing: ["riffscribe_customers"] });
  const r = await handleWebhookEvent(subEvent("customer.subscription.updated", sub()), deps(db, { sub_1: sub() }));
  check("…and from metadata while that table is missing", r.status === 200 && upserts(db)[0]?.values.user_id === "u1");
}

/* ----------------------------------------------- checkout: customer mapping */
{
  const st = fakeStripe();
  const db = fakeDb({ rows: { riffscribe_customers: { stripe_customer_id: "cus_mapped" } }, row: { status: "canceled", stripe_customer_id: "cus_old" } });
  const r = await checkoutCustomer(user, cdeps(db, st, true));
  check("checkout uses this mode's mapped customer first", r.customer === "cus_mapped" && st.created.length === 0);
  const sel = db.calls.find((c) => c.table === "riffscribe_customers" && c.op === "select");
  check("…and writes no mapping it already has", !!sel && !upserts(db).some((c) => c.table === "riffscribe_customers"));
}
{
  const st = fakeStripe({ deleted: ["cus_mapped"] });
  const db = fakeDb({ rows: { riffscribe_customers: { stripe_customer_id: "cus_mapped" } } });
  const r = await checkoutCustomer(user, cdeps(db, st, true));
  check("a deleted mapped customer is replaced", r.customer === "cus_new");
}
{
  const st = fakeStripe();
  const db = fakeDb();
  await checkoutCustomer(user, cdeps(db, st, true));
  const m = upserts(db).find((c) => c.table === "riffscribe_customers");
  check("a new customer is remembered for this user and mode",
    m?.values.user_id === "u1" && m.values.livemode === true && m.values.stripe_customer_id === "cus_new" && m.options?.onConflict === "user_id,livemode");
  check("…and its idempotency key names the mode", st.created[0]?.options.idempotencyKey.endsWith("-live"));
}
{
  const st = fakeStripe();
  const r = await checkoutCustomer(user, cdeps(fakeDb({ missing: ["riffscribe_customers"] }), st));
  check("checkout still works before riffscribe_customers exists", r.customer === "cus_new");
}

console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);
