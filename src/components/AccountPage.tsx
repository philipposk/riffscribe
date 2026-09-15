"use client";
/** Plan, this month's usage, billing, and deleting your data. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import SignIn from "./SignIn";
import { Meter } from "./AccountMenu";
import { signOut } from "@/lib/store/charts";
import { deleteAccount, openBillingPortal, startCheckout, useAccount } from "@/lib/store/account";
import { PLANS, planLabel } from "@/lib/plans";

export default function AccountPage() {
  const { user, account, ready } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const sub = new URLSearchParams(location.search).get("sub");
    if (sub === "success") setNote("Thanks — you're on Pro. It can take a few seconds to show here.");
    if (sub === "canceled") setNote("Checkout cancelled. Nothing was charged.");
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "that did not work"); setBusy(null); }
  }

  if (!ready) return null;
  if (!user) {
    return (
      <section className="panel max-w-xl p-5">
        <p className="mb-4 text-sm text-white/55">Sign in to see your plan and usage.</p>
        <SignIn />
      </section>
    );
  }

  const free = !account || account.plan === "free";

  return (
    <div className="max-w-xl space-y-5">
      {note && <p className="rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200">{note}</p>}

      <section className="panel p-5">
        <h2 className="mb-1 text-base font-medium">Signed in</h2>
        <p className="text-sm text-white/55">{user.email}</p>
        <button className="btn mt-4" onClick={() => void signOut()}>Sign out</button>
      </section>

      <section className="panel p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-medium">{account ? planLabel(account.plan) : "…"} plan</h2>
          {account?.renews_at && !free && (
            <span className="text-xs text-white/40">
              {account.status === "canceled" ? "ends" : "renews"} {new Date(account.renews_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {account && (
          <div className="mb-5 space-y-3">
            <Meter label="Saved songs" used={account.songs} limit={account.songs_limit} />
            <Meter label={`Assistant requests (${account.period})`} used={account.assistant} limit={account.assistant_limit} />
          </div>
        )}
        <p className="mb-4 text-xs text-white/40">
          Transcribing, splitting stems and slowing down run on your own device, so they are unlimited on every plan.
        </p>
        <div className="flex flex-wrap gap-2">
          {free && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void run("up", startCheckout)}>
              {busy === "up" && <Loader2 className="animate-spin" size={15} />}
              Upgrade to Pro — {PLANS.pro.price}
            </button>
          )}
          {account?.has_billing && (
            <button className="btn" disabled={!!busy} onClick={() => void run("portal", openBillingPortal)}>
              {busy === "portal" && <Loader2 className="animate-spin" size={15} />}
              Manage billing
            </button>
          )}
          <Link className="btn" href="/pricing">Compare plans</Link>
        </div>
      </section>

      <section className="panel border-red-500/25 p-5">
        <h2 className="mb-1 text-base font-medium text-red-200">Delete my data</h2>
        <p className="mb-3 text-sm text-white/50">
          Removes every song you have saved (shared links stop working), your saved assistant chats, your usage, and
          cancels a Pro subscription.
          Your sign-in is shared with other 6x7 apps, so it stays. This cannot be undone.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-0 flex-1 text-sm"
            placeholder='Type "delete" to confirm'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button
            className="btn border-red-500/40 text-red-200"
            disabled={confirmText.trim().toLowerCase() !== "delete" || !!busy}
            onClick={() => void run("delete", async () => { await deleteAccount(); location.href = "/"; })}
          >
            {busy === "delete" && <Loader2 className="animate-spin" size={15} />}
            Delete everything
          </button>
        </div>
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
