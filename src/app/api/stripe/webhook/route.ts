/**
 * Stripe → the shared 6x7 `subscriptions` table.
 *
 * Stripe sends no session, so this authenticates by signature and writes with
 * the service role. The Stripe account is shared across 6x7 apps and every
 * app's webhook sees every event: act only on ours, and never grant a plan
 * from missing or foreign metadata.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { serviceClient } from "@/lib/supabase/server";
import { APP, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

async function upsert(sub: Stripe.Subscription, eventCreated: number) {
  const userId = sub.metadata?.supabase_user_id;
  if (!userId || sub.metadata?.app !== APP || sub.metadata?.plan !== "pro") return;
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = item?.current_period_end;

  const db = serviceClient();
  const { data: existing } = await db
    .from("subscriptions")
    .select("updated_at")
    .eq("user_id", userId)
    .eq("app", APP)
    .maybeSingle();
  // Out-of-order delivery: an older event must not overwrite a newer state.
  const storedAt = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
  if (storedAt && eventCreated * 1000 < storedAt - 1000) return;

  await db.from("subscriptions").upsert(
    {
      user_id: userId,
      app: APP,
      plan: "pro",
      status: sub.status,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      stripe_subscription_id: sub.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date(eventCreated * 1000).toISOString(),
    },
    { onConflict: "user_id,app" }
  );
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

  const relevant =
    event.type === "checkout.session.completed" || event.type.startsWith("customer.subscription.");
  if (!relevant) return NextResponse.json({ received: true });

  // Stripe re-delivers; the first insert wins and repeats are no-ops.
  const seen = await serviceClient().from("riffscribe_webhook_events").insert({ id: event.id, created: event.created });
  if (seen.error) return NextResponse.json({ received: true, duplicate: true });

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.subscription && s.metadata?.app === APP) {
        const sub = await stripe().subscriptions.retrieve(s.subscription as string);
        sub.metadata = { ...sub.metadata, ...s.metadata };
        await upsert(sub, event.created);
      }
    } else {
      await upsert(event.data.object as Stripe.Subscription, event.created);
    }
  } catch (e) {
    // Let Stripe retry: forget the event so the retry is not treated as a duplicate.
    await serviceClient().from("riffscribe_webhook_events").delete().eq("id", event.id);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
