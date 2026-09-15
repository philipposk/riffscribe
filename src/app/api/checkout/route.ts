/**
 * Start a Stripe Checkout for Pro. The user id, app and plan are stamped into
 * the metadata so the webhook links the subscription without guessing by email.
 */
import { NextResponse } from "next/server";

import { caller } from "@/lib/supabase/server";
import { APP, billingConfigured, origin, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Upgrades are not open yet." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const meta = { supabase_user_id: who.user.id, app: APP, plan: "pro" };
  const base = origin(req);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],
    customer_email: who.user.email,
    client_reference_id: who.user.id,
    metadata: meta,
    subscription_data: { metadata: meta },
    success_url: `${base}/account?sub=success`,
    cancel_url: `${base}/account?sub=canceled`,
    allow_promotion_codes: true,
  });
  return NextResponse.json({ url: session.url });
}
