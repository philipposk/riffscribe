/**
 * Start a Stripe Checkout for Pro. The user id, app and plan are stamped into
 * the metadata so the webhook links the subscription without guessing by email.
 * Someone already on Pro is sent to manage it instead of paying twice.
 */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, origin, stripe } from "@/lib/stripe";
import { checkoutCustomer } from "@/lib/billingFlow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Upgrades are not open yet." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const meta = { supabase_user_id: who.user.id, app: APP, plan: "pro" };
  const base = origin(req);
  try {
    const pick = await checkoutCustomer(who.user, { db: serviceClient(), app: APP, stripe: stripe() });
    if (pick.blocked) {
      return NextResponse.json(
        { error: "You're already on Pro. It can take a few seconds to show here.", portal: true },
        { status: 409 }
      );
    }
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],
      customer: pick.customer,
      client_reference_id: who.user.id,
      metadata: meta,
      subscription_data: { metadata: meta },
      success_url: `${base}/account?sub=success`,
      cancel_url: `${base}/account?sub=canceled`,
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error(`checkout: ${(e as Error).message}`);
    return NextResponse.json({ error: "Upgrades are not available right now. Please try again later." }, { status: 502 });
  }
}
