/** Stripe's own page for changing the card, cancelling, or reading invoices. */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, liveMode, origin, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * This person's Stripe customer for the key in use: our per-mode mapping
 * first (a test-mode id never reaches the live key), then the shared
 * subscriptions row. Before migration 0005 the mapping table is missing and
 * only the row is used.
 */
async function customerFor(userId: string): Promise<string | null> {
  const db = serviceClient();
  const mapped = await db
    .from("riffscribe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("livemode", liveMode())
    .maybeSingle();
  const known = mapped.error ? null : (mapped.data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (known) return known;

  const { data } = await db
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("app", APP)
    .maybeSingle();
  return (data as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null;
}

export async function POST(req: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Billing is not set up." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    const customer = await customerFor(who.user.id);
    if (!customer) return NextResponse.json({ error: "There is no subscription to manage yet." }, { status: 400 });
    const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${origin(req)}/account` });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error(`portal: ${(e as Error).message}`);
    return NextResponse.json({ error: "Billing could not be opened. Please contact support." }, { status: 502 });
  }
}
