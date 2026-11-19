/**
 * Checkout's and delete-my-data's billing decisions, kept free of Next and of
 * env so scripts/verify-billing.mjs and verify-account-data.mjs can drive them
 * with stand-ins. The routes pass in the real Supabase clients and Stripe.
 * The webhook lives in billing/webhookLogic.ts.
 *
 * This file has no relative imports on purpose: the verify scripts load it
 * directly with node's type stripping, which does not resolve bare paths.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/** A subscription in one of these is billing, or about to be: one per person. */
export const BILLING_STATUSES = ["active", "trialing", "past_due"];
/** A subscription in one of these will never bill again. */
export const ENDED_STATUSES = ["canceled", "incomplete_expired"];

export type Reply = { status: number; body: Record<string, unknown> };

export interface CheckoutDeps {
  db: SupabaseClient;
  app: string;
  /** This deployment runs on a live key: customers are remembered per mode. */
  live: boolean;
  stripe: Pick<Stripe, "customers" | "subscriptions">;
  log?: (message: string) => void;
}

/**
 * The Stripe customer to check out as, or `blocked` when this person already
 * has Pro billing — stored by the webhook or, if it has not landed yet, in
 * Stripe itself. Reusing one customer keeps every subscription where the
 * billing portal can reach it.
 *
 * Candidates, in order: `riffscribe_customers` for this mode, the customer on
 * the shared subscriptions row, a customer found by email that carries this
 * user's id, and finally a new one. The pick is remembered in
 * `riffscribe_customers`; before migration 0005 that table is missing and is
 * simply skipped.
 */
export async function checkoutCustomer(
  user: { id: string; email?: string },
  deps: CheckoutDeps
): Promise<{ blocked: true; customer?: undefined } | { blocked?: undefined; customer: string }> {
  const log = deps.log ?? console.error;
  const { data, error } = await deps.db
    .from("subscriptions")
    .select("status, stripe_customer_id")
    .eq("user_id", user.id)
    .eq("app", deps.app)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status?: string | null; stripe_customer_id?: string | null } | null;
  if (BILLING_STATUSES.includes(row?.status ?? "")) return { blocked: true };

  const mapped = await deps.db
    .from("riffscribe_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .eq("livemode", deps.live)
    .maybeSingle();
  const known = mapped.error ? null : (mapped.data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;

  const billingPro = async (customer: string) => {
    const subs = await deps.stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    return subs.data.some((s) => s.metadata?.app === deps.app && BILLING_STATUSES.includes(s.status));
  };
  const remember = async (customer: string) => {
    if (customer === known) return;
    const { error: e } = await deps.db
      .from("riffscribe_customers")
      .upsert({ user_id: user.id, livemode: deps.live, stripe_customer_id: customer }, { onConflict: "user_id,livemode" });
    if (e) log(`checkout: could not remember customer ${customer}: ${e.message}`);
  };

  for (const candidate of [known, row?.stripe_customer_id]) {
    if (!candidate) continue;
    try {
      const c = await deps.stripe.customers.retrieve(candidate);
      if ((c as { deleted?: boolean }).deleted) continue;
      if (await billingPro(candidate)) return { blocked: true };
      await remember(candidate);
      return { customer: candidate };
    } catch (e) {
      // A customer from Stripe's test mode is unknown to the live key: try the next one.
      if ((e as { code?: string }).code !== "resource_missing") throw e;
    }
  }

  if (user.email) {
    const found = await deps.stripe.customers.list({ email: user.email, limit: 100 });
    const mine = found.data.find((c) => c.metadata?.supabase_user_id === user.id);
    if (mine) {
      if (await billingPro(mine.id)) return { blocked: true };
      await remember(mine.id);
      return { customer: mine.id };
    }
  }

  const created = await deps.stripe.customers.create(
    { email: user.email, metadata: { supabase_user_id: user.id, app: deps.app } },
    // A double click makes one customer, per mode.
    { idempotencyKey: `${deps.app}-customer-${user.id}-${deps.live ? "live" : "test"}` }
  );
  await remember(created.id);
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
