/**
 * Self-serve 14-day withdrawal: refund the first payment in full and end Pro
 * now. Off (404) unless STRIPE_SELF_SERVE_WITHDRAWAL=true; until then the
 * account page tells people to email us.
 *
 * The refund goes first: if it fails nothing is cancelled. If the cancel then
 * fails, a retry repeats the refund harmlessly (same idempotency key, or an
 * "already refunded" answer), and the charge.refunded webhook ends the
 * subscription anyway.
 */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, flag, stripe } from "@/lib/stripe";
import { ENDED_STATUSES, isOurs, withdrawalOpen } from "@/lib/billing/webhookLogic";

export const runtime = "nodejs";

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

export async function POST(req: Request) {
  if (!flag("STRIPE_SELF_SERVE_WITHDRAWAL")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!billingConfigured()) return NextResponse.json({ error: "Billing is not set up." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await serviceClient()
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", who.user.id)
    .eq("app", APP)
    .maybeSingle();
  if (error) {
    console.error(`withdraw: reading the subscription failed: ${error.message}`);
    return NextResponse.json({ error: "Could not check your subscription. Nothing was changed." }, { status: 500 });
  }
  const id = (data as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id;
  if (!id) return NextResponse.json({ error: "There is no subscription to withdraw from." }, { status: 400 });

  try {
    const sub = await stripe().subscriptions.retrieve(id);
    if (!isOurs(sub.metadata, APP) || ENDED_STATUSES.includes(sub.status))
      return NextResponse.json({ error: "There is no subscription to withdraw from." }, { status: 400 });
    if (!withdrawalOpen(sub.start_date, Date.now()))
      return NextResponse.json(
        { error: "The 14-day withdrawal period has ended. You can still cancel from Manage billing." },
        { status: 409 }
      );

    const invoice = idOf(sub.latest_invoice);
    if (invoice) {
      const pays = await stripe().invoicePayments.list({ invoice, status: "paid", limit: 1 });
      const pay = pays.data[0]?.payment;
      const target = pay
        ? idOf(pay.payment_intent)
          ? { payment_intent: idOf(pay.payment_intent)! }
          : idOf(pay.charge)
            ? { charge: idOf(pay.charge)! }
            : null
        : null; // a free first invoice (100% promo code): nothing to refund
      if (target) {
        try {
          await stripe().refunds.create(
            { ...target, reason: "requested_by_customer", metadata: { app: APP, reason: "14-day withdrawal" } },
            { idempotencyKey: `rs-withdraw-${sub.id}-refund` }
          );
        } catch (e) {
          if ((e as { code?: string }).code !== "charge_already_refunded") throw e;
        }
      }
    }

    await stripe().subscriptions.cancel(
      sub.id,
      { cancellation_details: { comment: "14-day withdrawal" } },
      { idempotencyKey: `rs-withdraw-${sub.id}-cancel` }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`withdraw ${id}: ${(e as Error).message}`);
    return NextResponse.json({ error: "The withdrawal did not go through. Please try again or email us." }, { status: 502 });
  }
}
