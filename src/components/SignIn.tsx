"use client";
/** Google, or a link by email. There are no passwords. */
import { useState } from "react";
import { Loader2, User } from "lucide-react";

import { db, signInWithEmail, signInWithGoogle } from "@/lib/store/charts";
import { GoogleIdentityButton } from "@/components/GoogleIdentityButton";

export default function SignIn({ stacked = false }: { stacked?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "that did not work");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className={stacked ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
        <GoogleIdentityButton getSupabase={db} onSignedIn={() => window.location.assign("/studio")} onError={setError}>
          <button className="btn justify-center" disabled={!!busy} onClick={() => void run("google", signInWithGoogle)}>
            {busy === "google" ? <Loader2 className="animate-spin" size={15} /> : <User size={15} />}
            Continue with Google
          </button>
        </GoogleIdentityButton>
        <span className="text-center text-xs text-white/30">or</span>
        <input
          type="email"
          className="min-w-0 flex-1 text-sm"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="btn justify-center"
          disabled={!email.includes("@") || !!busy}
          onClick={() =>
            void run("email", async () => {
              await signInWithEmail(email.trim());
              setNote("Check your email — the link signs you in.");
            })
          }
        >
          {busy === "email" ? <Loader2 className="animate-spin" size={15} /> : null}
          Email me a link
        </button>
      </div>
      {note && <p className="mt-3 text-xs text-emerald-300/80">{note}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </div>
  );
}
