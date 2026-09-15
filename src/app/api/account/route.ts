/**
 * Delete this person's Riffscribe data: saved songs, usage, and the Riffscribe
 * subscription (cancelled in Stripe first). The login is shared with other
 * 6x7 apps, so it stays — as does any cross-app 'global' subscription.
 */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  if (billingConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await serviceClient()
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", who.user.id)
      .eq("app", APP)
      .maybeSingle();
    const id = (data as { stripe_subscription_id?: string } | null)?.stripe_subscription_id;
    if (id) {
      try {
        await stripe().subscriptions.cancel(id);
      } catch {
        /* already cancelled — must not block the deletion */
      }
    }
  }

  const { error } = await who.db.rpc("riffscribe_delete_my_data");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
