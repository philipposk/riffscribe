/** Stripe's own page for changing the card, cancelling, or reading invoices. */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, origin, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Billing is not set up." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data } = await serviceClient()
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", who.user.id)
    .eq("app", APP)
    .maybeSingle();
  const customer = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (!customer) return NextResponse.json({ error: "There is no subscription to manage yet." }, { status: 400 });

  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin(req)}/account` });
  return NextResponse.json({ url: session.url });
}
