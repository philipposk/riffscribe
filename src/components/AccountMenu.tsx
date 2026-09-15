"use client";
/**
 * The circle in the corner: who you are, what your plan has left this month,
 * your songs, your account, sign out. Signed out, it offers to sign you in.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileMusic, LogOut, Settings } from "lucide-react";

import SignIn from "./SignIn";
import { savingConfigured } from "@/lib/supabase/client";
import { signOut } from "@/lib/store/charts";
import { useAccount } from "@/lib/store/account";
import { planLabel } from "@/lib/plans";

export function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const colour = pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-amber-400" : "bg-[var(--color-accent)]";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-white/60">{label}</span>
        <span className="tabular-nums text-white/40">{used} / {limit}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AccountMenu({ newTab = false }: { newTab?: boolean }) {
  // In the studio, leaving the page would drop the loaded song — open elsewhere.
  const tab = newTab ? { target: "_blank", rel: "noopener" } : {};
  const { user, account, ready, refresh } = useAccount();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open, refresh]);

  if (!savingConfigured || !ready) return null;

  return (
    <div ref={box} className="no-print relative">
      {user ? (
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-white/5 text-sm font-medium uppercase hover:border-white/30"
          onClick={() => setOpen((o) => !o)}
          aria-label="Your account"
          aria-expanded={open}
        >
          {(user.email ?? "?")[0]}
        </button>
      ) : (
        <button className="btn" onClick={() => setOpen((o) => !o)}>Sign in</button>
      )}

      {open && (
        <div className="panel absolute right-0 z-50 mt-2 w-72 p-4 shadow-2xl">
          {user ? (
            <>
              <p className="truncate text-sm">{user.email}</p>
              {account && (
                <>
                  <p className="mb-3 mt-0.5 text-xs text-white/40">
                    {planLabel(account.plan)} plan
                    {account.plan === "free" && (
                      <> · <Link className="text-[var(--color-accent)] hover:underline" href="/pricing" {...tab} onClick={() => setOpen(false)}>Upgrade</Link></>
                    )}
                  </p>
                  <div className="mb-4 space-y-2.5">
                    <Meter label="Saved songs" used={account.songs} limit={account.songs_limit} />
                    <Meter label="Assistant this month" used={account.assistant} limit={account.assistant_limit} />
                  </div>
                </>
              )}
              <nav className="-mx-2 flex flex-col text-sm">
                <Link className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5" href="/songs" {...tab} onClick={() => setOpen(false)}>
                  <FileMusic size={14} className="text-white/40" /> My songs
                </Link>
                <Link className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5" href="/account" {...tab} onClick={() => setOpen(false)}>
                  <Settings size={14} className="text-white/40" /> Account &amp; plan
                </Link>
                <button
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5"
                  onClick={() => { setOpen(false); void signOut(); }}
                >
                  <LogOut size={14} className="text-white/40" /> Sign out
                </button>
              </nav>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-white/60">Save your songs and share them. Transcribing needs no account.</p>
              <SignIn stacked />
            </>
          )}
        </div>
      )}
    </div>
  );
}
