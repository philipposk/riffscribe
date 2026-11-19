/**
 * Delete this person's Riffscribe data: saved songs, assistant chats, past
 * months' usage, and the Riffscribe subscription (cancelled in Stripe first;
 * if Stripe cannot cancel a live one, nothing is deleted — see billingFlow.ts).
 * This month's assistant counter stays (supabase/migrations/0003_review_fixes.sql),
 * or deleting would reset the allowance. The login is shared with other 6x7
 * apps, so it stays — as does any cross-app 'global' subscription.
 */
import { NextResponse } from "next/server";

import { caller, serviceClient } from "@/lib/supabase/server";
import { APP, billingConfigured, stripe } from "@/lib/stripe";
import { deleteMyData } from "@/lib/billingFlow";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const who = await caller(req);
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { status, body } = await deleteMyData({
    billing: billingConfigured(),
    serviceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    readSubscription: async () => {
      const { data, error } = await serviceClient()
        .from("subscriptions")
        .select("stripe_subscription_id, status")
        .eq("user_id", who.user.id)
        .eq("app", APP)
        .maybeSingle();
      return { data, error };
    },
    cancel: (id) => stripe().subscriptions.cancel(id),
    retrieve: (id) => stripe().subscriptions.retrieve(id),
    deleteData: async () => {
      const { error } = await who.db.rpc("riffscribe_delete_my_data");
      return { error };
    },
  });
  return NextResponse.json(body, { status });
}
