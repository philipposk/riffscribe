/**
 * Stripe → the shared 6x7 `subscriptions` table.
 *
 * Stripe sends no session, so this authenticates by signature and writes with
 * the service role. The decisions live in `billing/webhookLogic.ts`; this file
 * only wires in the real Stripe calls. Every Stripe write made from here has
 * an idempotency key derived from the event id, so a retried event repeats
 * nothing.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { serviceClient } from "@/lib/supabase/server";
import { APP, flag, liveMode, stripe } from "@/lib/stripe";
import { handleWebhookEvent } from "@/lib/billing/webhookLogic";

export const runtime = "nodejs";

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** Charge → payment intent → invoice payment → invoice → subscription (the dahlia object graph). */
async function subscriptionForCharge(chargeId: string): Promise<string | null> {
  const ch = await stripe().charges.retrieve(chargeId);
  const pi = idOf(ch.payment_intent);
  if (!pi) return null;
  const pays = await stripe().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
  const invoice = pays.data[0]?.invoice;
  if (!invoice) return null;
  const inv = typeof invoice === "string" ? await stripe().invoices.retrieve(invoice) : invoice;
  if ("deleted" in inv && inv.deleted) return null;
  return idOf((inv as Stripe.Invoice).parent?.subscription_details?.subscription);
}

async function refundCharge(chargeId: string, idempotencyKey: string): Promise<void> {
  const ch = await stripe().charges.retrieve(chargeId);
  if (ch.refunded) return;
  try {
    await stripe().refunds.create({ charge: chargeId, reason: "fraudulent" }, { idempotencyKey });
  } catch (e) {
    if ((e as { code?: string }).code !== "charge_already_refunded") throw e;
  }
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "not configured" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `signature: ${(e as Error).message}` }, { status: 400 });
  }

  const { status, body } = await handleWebhookEvent(event, {
    db: serviceClient(),
    app: APP,
    live: liveMode(),
    autoRefundEfw: flag("STRIPE_AUTO_REFUND_EFW"),
    retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
    cancelSubscription: (id, idempotencyKey) => stripe().subscriptions.cancel(id, {}, { idempotencyKey }),
    subscriptionForCharge,
    refundCharge,
  });
  return NextResponse.json(body, { status });
}
