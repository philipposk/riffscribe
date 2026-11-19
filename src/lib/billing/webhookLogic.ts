/**
 * The Stripe webhook's decisions and its handler, kept free of Next, env and
 * the Stripe/Supabase runtimes (type imports only), so
 * scripts/verify-billing.mjs can drive them with stand-ins. The route passes
 * in the real service client and Stripe calls.
 *
 * No runtime imports on purpose: the verify scripts load this file directly
 * with node's type stripping, which does not resolve extensionless paths.
 *
 * The Stripe account is shared across 6x7 apps and every app's endpoint sees
 * every event: act only on ours, and never grant a plan from missing or
 * foreign metadata.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Same lists as billingFlow.ts (which cannot be imported here, see above);
// scripts/verify-billing.mjs fails if the two drift apart.
/** A subscription in one of these is billing, or about to be: one per person. */
export const BILLING_STATUSES = ["active", "trialing", "past_due"];
/** A subscription in one of these will never bill again. */
export const ENDED_STATUSES = ["canceled", "incomplete_expired"];

export type Reply = { status: number; body: Record<string, unknown> };

/** The events the live endpoint subscribes to. Anything else is acknowledged and dropped. */
export const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
]);

/** The legal withdrawal period for an EU consumer buying a digital service. */
export const WITHDRAWAL_DAYS = 14;

/** Metadata we stamp on checkouts and subscriptions: this app, the Pro plan. */
export function isOurs(metadata: Stripe.Metadata | null | undefined, app = "riffscribe"): boolean {
  return metadata?.app === app && metadata?.plan === "pro";
}

/** Whether a subscription that started at `startDate` (Stripe seconds) can still be withdrawn from. */
export function withdrawalOpen(startDate: number, nowMs: number, days = WITHDRAWAL_DAYS): boolean {
  return nowMs - startDate * 1000 <= days * 86_400_000;
}

/** The shared `subscriptions` row for a Pro subscription. */
export function subscriptionRow(sub: Stripe.Subscription, userId: string, app: string, updatedAt: string) {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = item?.current_period_end;
  return {
    user_id: userId,
    app,
    plan: "pro",
    status: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    updated_at: updatedAt,
  };
}

export type Action =
  | { kind: "ignore"; reason: string }
  /** Write the subscription as Stripe has it now. `metadata` is the event's; `eventWins` says which side wins a clash. */
  | { kind: "upsert"; subscription: string; metadata: Stripe.Metadata; eventWins: boolean }
  /** An invoice moved: re-read its subscription (period end, past_due) and write it. */
  | { kind: "refresh"; subscription: string }
  /** Money went back (full refund, dispute): end the subscription behind this charge. */
  | { kind: "cancel"; charge: string }
  /** A card-network fraud warning: refund the charge before it becomes a dispute, then end the subscription. */
  | { kind: "refund_and_cancel"; charge: string };

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** What an event asks for. Pure: reads only the event's own payload. */
export function planAction(
  event: Pick<Stripe.Event, "type" | "data">,
  opts: { autoRefundEfw: boolean; app?: string }
): Action {
  const app = opts.app ?? "riffscribe";
  if (!HANDLED.has(event.type)) return { kind: "ignore", reason: "unhandled" };
  const object = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const s = object as Stripe.Checkout.Session;
      const subscription = idOf(s.subscription);
      if (!subscription || !isOurs(s.metadata, app)) return { kind: "ignore", reason: "not ours" };
      return { kind: "upsert", subscription, metadata: s.metadata ?? {}, eventWins: true };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const s = object as Stripe.Subscription;
      if (!isOurs(s.metadata, app)) return { kind: "ignore", reason: "not ours" };
      return { kind: "upsert", subscription: s.id, metadata: s.metadata, eventWins: false };
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const details = (object as Stripe.Invoice).parent?.subscription_details;
      const subscription = idOf(details?.subscription);
      if (!subscription || !isOurs(details?.metadata, app)) return { kind: "ignore", reason: "not ours" };
      return { kind: "refresh", subscription };
    }
    case "charge.refunded": {
      const ch = object as Stripe.Charge;
      // Only a full refund (how a withdrawal looks) ends Pro; a partial one is a goodwill credit.
      if (ch.refunded !== true) return { kind: "ignore", reason: "partial refund" };
      return { kind: "cancel", charge: ch.id };
    }
    case "charge.dispute.created": {
      const charge = idOf((object as Stripe.Dispute).charge);
      return charge ? { kind: "cancel", charge } : { kind: "ignore", reason: "no charge" };
    }
    case "radar.early_fraud_warning.created": {
      if (!opts.autoRefundEfw) return { kind: "ignore", reason: "auto refund off" };
      const charge = idOf((object as Stripe.Radar.EarlyFraudWarning).charge);
      return charge ? { kind: "refund_and_cancel", charge } : { kind: "ignore", reason: "no charge" };
    }
  }
  return { kind: "ignore", reason: "unhandled" };
}

/* ------------------------------------------------------------ the handler */

export interface WebhookDeps {
  db: SupabaseClient;
  app: string;
  /** This deployment runs on a live key; events from the other mode are dropped. */
  live: boolean;
  /** STRIPE_AUTO_REFUND_EFW. */
  autoRefundEfw: boolean;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  cancelSubscription?: (id: string, idempotencyKey: string) => Promise<Stripe.Subscription>;
  /** The subscription a charge paid for, through its invoice; null for a charge that is not a subscription's. */
  subscriptionForCharge?: (chargeId: string) => Promise<string | null>;
  /** Refund a charge in full unless it already is. */
  refundCharge?: (chargeId: string, idempotencyKey: string) => Promise<void>;
  log?: (message: string) => void;
}

export async function handleWebhookEvent(event: Stripe.Event, deps: WebhookDeps): Promise<Reply> {
  const log = deps.log ?? console.error;
  // A test event reaching the live endpoint (or the reverse) must not touch real rows.
  if (Boolean(event.livemode) !== Boolean(deps.live)) return { status: 200, body: { received: true, ignored: "mode" } };

  const action = planAction(event, { autoRefundEfw: deps.autoRefundEfw, app: deps.app });
  // Unhandled and other apps' events are not ours to record.
  if (action.kind === "ignore") return { status: 200, body: { received: true } };

  // Stripe re-delivers; the first insert wins and repeats are no-ops. Any other
  // failure (table missing, wrong key) must not pass for a repeat.
  const seen = await deps.db.from("riffscribe_webhook_events").insert({ id: event.id, created: event.created });
  if (seen.error) {
    if (seen.error.code === "23505") return { status: 200, body: { received: true, duplicate: true } };
    log(`stripe webhook ${event.id}: recording the event failed: ${seen.error.message}`);
    return { status: 500, body: { error: seen.error.message } };
  }

  try {
    await act(action, event, deps);
  } catch (e) {
    log(`stripe webhook ${event.id}: ${(e as Error).message}`);
    // Let Stripe retry: forget the event so the retry is not treated as a duplicate.
    await deps.db.from("riffscribe_webhook_events").delete().eq("id", event.id);
    return { status: 500, body: { error: (e as Error).message } };
  }
  return { status: 200, body: { received: true } };
}

async function act(action: Exclude<Action, { kind: "ignore" }>, event: Stripe.Event, deps: WebhookDeps) {
  switch (action.kind) {
    case "upsert": {
      // Events arrive out of order and retried ones carry an old snapshot, so
      // the row is written from the subscription as Stripe has it now.
      const sub = await deps.retrieveSubscription(action.subscription);
      sub.metadata = action.eventWins ? { ...sub.metadata, ...action.metadata } : { ...action.metadata, ...sub.metadata };
      await upsertSubscription(sub, deps);
      return;
    }
    case "refresh":
      await upsertSubscription(await deps.retrieveSubscription(action.subscription), deps);
      return;
    case "cancel":
    case "refund_and_cancel": {
      if (!deps.subscriptionForCharge || !deps.cancelSubscription) throw new Error("charge handling is not wired");
      const id = await deps.subscriptionForCharge(action.charge);
      if (!id) return; // not a subscription charge
      const sub = await deps.retrieveSubscription(id);
      if (!isOurs(sub.metadata, deps.app)) return; // another app's charge on the shared account
      if (action.kind === "refund_and_cancel") {
        if (!deps.refundCharge) throw new Error("refunds are not wired");
        await deps.refundCharge(action.charge, `rs-refund-${event.id}`);
      }
      if (ENDED_STATUSES.includes(sub.status)) return;
      let ended: Stripe.Subscription;
      try {
        ended = await deps.cancelSubscription(sub.id, `rs-cancel-${event.id}`);
      } catch (e) {
        // Cancelled meanwhile (a withdrawal cancels right after its refund): that is the goal.
        const now = await deps.retrieveSubscription(sub.id);
        if (!ENDED_STATUSES.includes(now.status)) throw e;
        ended = now;
      }
      // Switch Pro off now rather than waiting for customer.subscription.deleted.
      await upsertSubscription(ended, deps);
      return;
    }
  }
}

/** Who a subscription belongs to: our customer mapping first, the subscription's metadata second. */
async function userFor(sub: Stripe.Subscription, deps: WebhookDeps): Promise<string | null> {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (customer) {
    const { data, error } = await deps.db
      .from("riffscribe_customers")
      .select("user_id")
      .eq("stripe_customer_id", customer)
      .maybeSingle();
    // Before migration 0005 the table is missing: fall through to the metadata.
    const mapped = error ? null : (data as { user_id?: string } | null)?.user_id;
    if (mapped) return mapped;
  }
  return sub.metadata?.supabase_user_id || null;
}

async function upsertSubscription(sub: Stripe.Subscription, deps: WebhookDeps) {
  if (!isOurs(sub.metadata, deps.app)) return;
  const userId = await userFor(sub, deps);
  if (!userId) return;

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

  const row = subscriptionRow(sub, userId, deps.app, new Date().toISOString());
  let { error } = await deps.db.from("subscriptions").upsert(row, { onConflict: "user_id,app" });
  // The column comes with supabase/migrations/0003_review_fixes.sql; write without it until then.
  if (error && /cancel_at_period_end/.test(error.message ?? "")) {
    const { cancel_at_period_end: _unused, ...withoutCancel } = row;
    ({ error } = await deps.db.from("subscriptions").upsert(withoutCancel, { onConflict: "user_id,app" }));
  }
  if (error) throw error;
}
