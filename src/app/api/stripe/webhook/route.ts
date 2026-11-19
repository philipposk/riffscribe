/**
 * Stripe → the shared 6x7 `subscriptions` table.
 *
 * Stripe sends no session, so this authenticates by signature and writes with
 * the service role. The Stripe account is shared across 6x7 apps and every
 * app's webhook sees every event: act only on ours, and never grant a plan
 * from missing or foreign metadata. The decisions live in `billingFlow.ts`.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { serviceClient } from "@/lib/supabase/server";
import { APP, stripe } from "@/lib/stripe";
import { handleWebhookEvent } from "@/lib/billingFlow";

export const runtime = "nodejs";

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
    retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
  });
  return NextResponse.json(body, { status });
}
