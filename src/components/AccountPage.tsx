"use client";
/** Plan, this month's usage, billing, and deleting your data. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import SignIn from "./SignIn";
import { Meter } from "./AccountMenu";
import { signOut } from "@/lib/store/charts";
import { BILLING_LIVE } from "@/lib/billingLive";
import { deleteAccount, openBillingPortal, startCheckout, useAccount, withdraw } from "@/lib/store/account";
import { PLANS, planLabel } from "@/lib/plans";
import { COMPANY } from "@/lib/company";

export default function AccountPage() {
  const { user, account, ready, refresh } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  // 14-day withdrawal: a link, then an inline "type withdraw" step.
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawText, setWithdrawText] = useState("");
  const [withdrawNote, setWithdrawNote] = useState<string | null>(null);
  // Just paid: the webhook may not have landed. Hide Upgrade and poll briefly.
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const sub = new URLSearchParams(location.search).get("sub");
    if (sub === "success") {
      setNote("Thanks — you're on Pro. It can take a few seconds to show here.");
      setPending(true);
    }
    if (sub === "canceled") setNote("Checkout cancelled. Nothing was charged.");
  }, []);

  useEffect(() => {
    if (!pending || !user) return;
    let tries = 0;
    const timer = setInterval(() => {
      void refresh();
      if (++tries >= 10) { clearInterval(timer); setPending(false); }
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, user, refresh]);

  useEffect(() => {
    if (account && account.plan !== "free") setPending(false);
  }, [account]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "that did not work"); setBusy(null); }
  }

  async function doWithdraw() {
    setBusy("withdraw");
    setError(null);
    try {
      await withdraw();
      setWithdrawOpen(false);
      setWithdrawText("");
      setNote("Withdrawn. Your payment is being refunded in full and Pro has ended.");
    } catch (e) {
      // 404: self-serve withdrawal is switched off on this deployment.
      if ((e as { status?: number }).status === 404) setWithdrawNote(`Email us to withdraw: ${COMPANY.contactEmail}`);
      else setError(e instanceof Error ? e.message : "that did not work");
    }
    setBusy(null);
  }

  if (!ready) {
    return (
      <div className="panel max-w-xl animate-pulse space-y-3 p-5" aria-busy="true" aria-label="Loading your account">
        <div className="h-4 w-1/3 rounded bg-white/10" />
        <div className="h-3 w-2/3 rounded bg-white/10" />
        <div className="h-3 w-1/2 rounded bg-white/10" />
      </div>
    );
  }
  if (!user) {
    return (
      <section className="panel max-w-xl p-5">
        <p className="mb-4 text-sm text-white/55">Sign in to see your plan and usage.</p>
        <SignIn />
      </section>
    );
  }

  const free = !account || account.plan === "free";
  const canUpgrade = !!account && account.plan === "free" && !pending;

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
              {account.cancel_at_period_end || account.status === "canceled" ? "ends" : "renews"}{" "}
              {new Date(account.renews_at).toLocaleDateString()}
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
          {free && BILLING_LIVE && !canUpgrade && (
            <button className="btn btn-primary" disabled aria-disabled="true">
              <Loader2 className="animate-spin" size={15} />
              {pending ? "Activating Pro…" : "Upgrade to Pro"}
            </button>
          )}
          {canUpgrade && BILLING_LIVE && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void run("up", startCheckout)}>
              {busy === "up" && <Loader2 className="animate-spin" size={15} />}
              Upgrade to Pro — {PLANS.pro.price}
            </button>
          )}
          {free && !BILLING_LIVE && (
            <button className="btn btn-primary" disabled aria-disabled="true">Pro — coming soon</button>
          )}
          {account?.has_billing && (
            <button className="btn" disabled={!!busy} onClick={() => void run("portal", openBillingPortal)}>
              {busy === "portal" && <Loader2 className="animate-spin" size={15} />}
              Manage billing
            </button>
          )}
          <Link className="btn" href="/pricing">Compare plans</Link>
        </div>
        {account?.has_billing && !free && BILLING_LIVE && (
          <div className="mt-3 text-xs text-white/45">
            {!withdrawOpen ? (
              <button className="underline underline-offset-2 hover:text-white/70" onClick={() => setWithdrawOpen(true)}>
                Withdraw within 14 days
              </button>
            ) : (
              <div className="space-y-2">
                <p>
                  Within 14 days of subscribing you can withdraw: the payment is refunded in full and Pro ends now.
                </p>
                <label htmlFor="withdraw-confirm" className="block">Type &quot;withdraw&quot; to confirm</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="withdraw-confirm"
                    className="min-w-0 flex-1 text-sm"
                    value={withdrawText}
                    onChange={(e) => setWithdrawText(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    className="btn"
                    disabled={withdrawText.trim().toLowerCase() !== "withdraw" || !!busy}
                    onClick={() => void doWithdraw()}
                  >
                    {busy === "withdraw" && <Loader2 className="animate-spin" size={15} />}
                    Withdraw and refund
                  </button>
                  <button className="btn" disabled={!!busy} onClick={() => { setWithdrawOpen(false); setWithdrawText(""); }}>
                    Keep Pro
                  </button>
                </div>
              </div>
            )}
            {withdrawNote && <p className="mt-2 text-white/70" role="status">{withdrawNote}</p>}
          </div>
        )}
      </section>

      <section className="panel border-red-500/25 p-5">
        <h2 className="mb-1 text-base font-medium text-red-200">Delete my data</h2>
        <p className="mb-3 text-sm text-white/50">
          Removes every song you have saved (shared links stop working), your saved assistant chats, your usage, and
          cancels a Pro subscription.
          Your sign-in is shared with other 6x7 apps, so it stays. This cannot be undone.
        </p>
        <label htmlFor="delete-confirm" className="mb-2 block text-xs text-white/55">Type &quot;delete&quot; to confirm</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="delete-confirm"
            className="min-w-0 flex-1 text-sm"
            autoComplete="off"
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
