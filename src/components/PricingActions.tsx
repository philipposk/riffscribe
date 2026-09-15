"use client";
import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { startCheckout, useAccount } from "@/lib/store/account";

export default function PricingActions({ plan }: { plan: "free" | "pro" }) {
  const { user, account } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan === "free") return <Link className="btn" href="/studio">Open the studio</Link>;
  if (account && account.plan !== "free") return <Link className="btn" href="/account">You're on Pro — manage</Link>;
  if (!user) return <Link className="btn btn-primary" href="/account">Sign in to upgrade</Link>;

  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try { await startCheckout(); } catch (e) { setError(e instanceof Error ? e.message : "that did not work"); setBusy(false); }
        }}
      >
        {busy && <Loader2 className="animate-spin" size={15} />} Upgrade to Pro
      </button>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
