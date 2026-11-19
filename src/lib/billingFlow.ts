/**
 * The Stripe webhook's and checkout's decisions, kept free of Next and of env
 * so scripts/verify-billing.mjs can drive them with stand-ins. The routes pass
 * in the real Supabase service client and Stripe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/** A subscription in one of these is billing, or about to be: one per person. */
export const BILLING_STATUSES = ["active", "trialing", "past_due"];
/** A subscription in one of these will never bill again. */
export const ENDED_STATUSES = ["canceled", "incomplete_expired"];

export type Reply = { status: number; body: Record<string, unknown> };

export interface WebhookDeps {
  db: SupabaseClient;
  app: string;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  log?: (message: string) => void;
}

export async function handleWebhookEvent(event: Stripe.Event, deps: WebhookDeps): Promise<Reply> {
  const log = deps.log ?? console.error;
  const relevant =
    event.type === "checkout.session.completed" || event.type.startsWith("customer.subscription.");
  // The Stripe account is shared: other apps' events are not ours to record.
  if (!relevant || !taggedFor(event, deps.app)) return { status: 200, body: { received: true } };

  // Stripe re-delivers; the first insert wins and repeats are no-ops. Any other
  // failure (table missing, wrong key) must not pass for a repeat.
  const seen = await deps.db.from("riffscribe_webhook_events").insert({ id: event.id, created: event.created });
  if (seen.error) {
    if (seen.error.code === "23505") return { status: 200, body: { received: true, duplicate: true } };
    log(`stripe webhook ${event.id}: recording the event failed: ${seen.error.message}`);
    return { status: 500, body: { error: seen.error.message } };
  }

  try {
    const sub = await currentSubscription(event, deps);
    if (sub) await upsertSubscription(sub, deps);
  } catch (e) {
    log(`stripe webhook ${event.id}: ${(e as Error).message}`);
    // Let Stripe retry: forget the event so the retry is not treated as a duplicate.
    await deps.db.from("riffscribe_webhook_events").delete().eq("id", event.id);
    return { status: 500, body: { error: (e as Error).message } };
  }
  return { status: 200, body: { received: true } };
}

/** Whether the event's own payload names this app (currentSubscription checks it again). */
function taggedFor(event: Stripe.Event, app: string): boolean {
  const object = event.data.object as { metadata?: Stripe.Metadata | null };
  return object.metadata?.app === app;
}

/**
 * The subscription as Stripe has it now. Events arrive out of order and
 * retried ones carry an old snapshot, so their payload is only used to decide
 * whether the event is ours.
 */
async function currentSubscription(event: Stripe.Event, deps: WebhookDeps): Promise<Stripe.Subscription | null> {
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (!s.subscription || s.metadata?.app !== deps.app) return null;
    const sub = await deps.retrieveSubscription(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
    sub.metadata = { ...sub.metadata, ...s.metadata };
    return sub;
  }
  const snapshot = event.data.object as Stripe.Subscription;
  if (snapshot.metadata?.app !== deps.app) return null;
  const sub = await deps.retrieveSubscription(snapshot.id);
  sub.metadata = { ...snapshot.metadata, ...sub.metadata };
  return sub;
}

async function upsertSubscription(sub: Stripe.Subscription, deps: WebhookDeps) {
  const userId = sub.metadata?.supabase_user_id;
  if (!userId || sub.metadata?.app !== deps.app || sub.metadata?.plan !== "pro") return;
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = item?.current_period_end;

  const { data: existing, error: readError } = await deps.db
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", userId)
    .eq("app", deps.app)
    .maybeSingle();
  if (readError) throw readError;

  // One row per person. A second subscription (two tabs, a double click) must
  // not overwrite the one that is billing, or cancelling the stray one would
  // drop them to Free while the other keeps charging.
  const stored = existing as { stripe_subscription_id?: string | null; status?: string | null } | null;
  // Nothing stored and nothing billing: the person deleted their data (that
  // cancels the sub, whose cancellation event lands here a moment later), or
  // the sub ended before we heard of it. Either way there is nothing to record.
  if (!stored && ENDED_STATUSES.includes(sub.status)) return;
  if (stored?.stripe_subscription_id && stored.stripe_subscription_id !== sub.id && BILLING_STATUSES.includes(stored.status ?? "")) {
    const other = await deps.retrieveSubscription(stored.stripe_subscription_id);
    if (BILLING_STATUSES.includes(other.status)) {
      (deps.log ?? console.error)(
        `stripe webhook: user ${userId} has a second subscription ${sub.id} (${sub.status}) besides ${other.id}; left for manual cleanup`
      );
      return;
    }
  }

  const row = {
    user_id: userId,
    app: deps.app,
    plan: "pro",
    status: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    updated_at: new Date().toISOString(),
  };
  let { error } = await deps.db.from("subscriptions").upsert(row, { onConflict: "user_id,app" });
  // The column comes with supabase/migrations/0003_review_fixes.sql; write without it until then.
  if (error && /cancel_at_period_end/.test(error.message ?? "")) {
    const { cancel_at_period_end: _unused, ...withoutCancel } = row;
    ({ error } = await deps.db.from("subscriptions").upsert(withoutCancel, { onConflict: "user_id,app" }));
  }
  if (error) throw error;
}

export interface CheckoutDeps {
  db: SupabaseClient;
  app: string;
  stripe: Pick<Stripe, "customers" | "subscriptions">;
}

/**
 * The Stripe customer to check out as, or `blocked` when this person already
 * has Pro billing — stored by the webhook or, if it has not landed yet, in
 * Stripe itself. Reusing one customer keeps every subscription where the
 * billing portal can reach it.
 */
export async function checkoutCustomer(
  user: { id: string; email?: string },
  deps: CheckoutDeps
): Promise<{ blocked: true; customer?: undefined } | { blocked?: undefined; customer: string }> {
  const { data, error } = await deps.db
    .from("subscriptions")
    .select("status, stripe_customer_id")
    .eq("user_id", user.id)
    .eq("app", deps.app)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status?: string | null; stripe_customer_id?: string | null } | null;
  if (BILLING_STATUSES.includes(row?.status ?? "")) return { blocked: true };

  const billingPro = async (customer: string) => {
    const subs = await deps.stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    return subs.data.some((s) => s.metadata?.app === deps.app && BILLING_STATUSES.includes(s.status));
  };

  if (row?.stripe_customer_id) {
    try {
      if (await billingPro(row.stripe_customer_id)) return { blocked: true };
      return { customer: row.stripe_customer_id };
    } catch (e) {
      // A customer from Stripe's test mode is unknown to the live key: start afresh.
      if ((e as { code?: string }).code !== "resource_missing") throw e;
    }
  }

  if (user.email) {
    const found = await deps.stripe.customers.list({ email: user.email, limit: 100 });
    const mine = found.data.find((c) => c.metadata?.supabase_user_id === user.id);
    if (mine) {
      if (await billingPro(mine.id)) return { blocked: true };
      return { customer: mine.id };
    }
  }

  const created = await deps.stripe.customers.create(
    { email: user.email, metadata: { supabase_user_id: user.id, app: deps.app } },
    { idempotencyKey: `${deps.app}-customer-${user.id}` }
  );
  return { customer: created.id };
}

/* ----------------------------------------------------------- delete my data */

/**
 * Delete-my-data's billing decisions. The Riffscribe subscription is cancelled
 * in Stripe before anything is deleted. Deleting removes our record of it, and
 * with it the "Manage billing" button, so if Stripe could not cancel a live
 * subscription nothing is deleted and the person is asked to try again.
 */
export interface DeleteDeps {
  /** Stripe keys are set on this deployment. */
  billing: boolean;
  /** The service role key is set, so the subscription row can be read. */
  serviceKey: boolean;
  readSubscription: () => Promise<{
    data: { stripe_subscription_id?: string | null; status?: string | null } | null;
    error: { message: string } | null;
  }>;
  cancel: (id: string) => Promise<unknown>;
  retrieve: (id: string) => Promise<{ status: string }>;
  /** riffscribe_delete_my_data, as the caller. */
  deleteData: () => Promise<{ error: { message: string } | null }>;
  log?: (message: string) => void;
}

export async function deleteMyData(deps: DeleteDeps): Promise<Reply> {
  const log = deps.log ?? console.error;

  if (deps.billing) {
    if (!deps.serviceKey) {
      log("delete my data: billing is configured but SUPABASE_SERVICE_ROLE_KEY is not set");
      return { status: 500, body: { error: "Deleting is not available right now. Nothing was deleted." } };
    }
    const { data, error } = await deps.readSubscription();
    if (error) {
      log(`delete my data: reading the subscription failed: ${error.message}`);
      return { status: 500, body: { error: "Could not check your subscription. Nothing was deleted." } };
    }
    const id = data?.stripe_subscription_id;
    if (id && !ENDED_STATUSES.includes(data?.status ?? "")) {
      try {
        await deps.cancel(id);
      } catch (e) {
        if (!(await hasEnded(id, e, deps))) {
          log(`delete my data: cancelling ${id} failed: ${(e as Error).message}`);
          return {
            status: 502,
            body: { error: "Could not cancel your subscription with Stripe. Nothing was deleted — try again in a minute." },
          };
        }
      }
    }
  }

  const { error } = await deps.deleteData();
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true } };
}

/** The cancel failed: fine only if there is nothing left that could charge. */
async function hasEnded(id: string, err: unknown, deps: DeleteDeps): Promise<boolean> {
  // Unknown to this key: gone, or a test-mode id under the live key — neither bills.
  if ((err as { code?: string }).code === "resource_missing") return true;
  try {
    return ENDED_STATUSES.includes((await deps.retrieve(id)).status);
  } catch (e) {
    return (e as { code?: string }).code === "resource_missing";
  }
}
