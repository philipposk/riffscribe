/**
 * Start a Stripe Checkout for Pro. The user id, app and plan are stamped into
 * the metadata so the webhook links the subscription without guessing by email.
 * Someone already on Pro is sent to manage it instead of paying twice.
 *
 * Tax and the terms-consent box are off until their flags are set
 * (STRIPE_TAX_ENABLED, STRIPE_TOS_CONSENT): each needs Dashboard setup first
 * (a tax registration; a Terms URL under Settings > Public details).
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, CHECKOUT_TAG, SITE, billingConfigured, flag, liveMode, origin, stripe } from "@/lib/stripe";
import { checkoutCustomer } from "@/lib/billingFlow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!billingConfigured()) return NextResponse.json({ error: "Upgrades are not open yet." }, { status: 503 });
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const meta = { supabase_user_id: who.user.id, app: APP, plan: "pro" };
  const base = origin(req);
  let customer: string;
  try {
    const pick = await checkoutCustomer(who.user, { db: serviceClient(), app: APP, live: liveMode(), stripe: stripe() });
    if (pick.blocked) {
      return NextResponse.json(
        { error: "You're already on Pro. It can take a few seconds to show here.", portal: true },
        { status: 409 }
      );
    }
    customer = pick.customer;
  } catch (e) {
    console.error(`checkout: ${(e as Error).message}`);
    return NextResponse.json({ error: "Upgrades are not available right now. Please try again later." }, { status: 502 });
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],
    customer,
    client_reference_id: who.user.id,
    metadata: meta,
    subscription_data: { metadata: meta },
    success_url: `${base}/account?sub=success`,
    cancel_url: `${base}/account?sub=canceled`,
    allow_promotion_codes: true,
    integration_identifier: CHECKOUT_TAG,
    // payment_method_types is left out on purpose: payment methods are managed in the Dashboard.
  };
  if (flag("STRIPE_TAX_ENABLED")) {
    // Collects only where a tax registration is active in the Dashboard.
    params.automatic_tax = { enabled: true };
    params.tax_id_collection = { enabled: true }; // EU business buyers: reverse charge
    params.customer_update = { address: "auto", name: "auto" }; // tax needs the address on an existing customer
  }
  if (flag("STRIPE_TOS_CONSENT")) {
    params.consent_collection = { terms_of_service: "required" };
    params.custom_text = {
      terms_of_service_acceptance: {
        message: `I agree to the [Terms](${SITE}/terms) and ask for Pro to start straight away. I can withdraw within 14 days for a full refund ([how](${SITE}/terms#withdrawal)).`,
      },
    };
  }

  try {
    const session = await stripe().checkout.sessions.create(params, {
      // Two clicks in the same minute open the same session.
      idempotencyKey: `rs-checkout-${who.user.id}-${Math.floor(Date.now() / 60_000)}`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error(`checkout: ${(e as Error).message}`);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
