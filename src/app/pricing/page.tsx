import { Check } from "lucide-react";

import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import PricingActions from "@/components/PricingActions";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Pricing — Riffscribe" };

const ALWAYS = [
  "Unlimited transcription — notation and tab",
  "Unlimited stem splitting and vocal removal",
  "Slow-down, transpose, loop, tuner, play-along",
  "Every export: MIDI, MusicXML, PDF, wav",
];

export default function Pricing() {
  const tiers = [
    { id: "free" as const, extra: [`Save up to ${PLANS.free.songs} songs`, `${PLANS.free.assistant} assistant requests a month`, "Share links"] },
    { id: "pro" as const, extra: [`Save up to ${PLANS.pro.songs.toLocaleString()} songs`, `${PLANS.pro.assistant.toLocaleString()} assistant requests a month`, "Share links", "Keeps Riffscribe going"] },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-3 max-w-2xl text-white/55">
          The heavy work — listening, splitting, stretching — runs on your own machine, so it costs nothing to serve
          and is unlimited for everyone, with or without an account. Pro is for the parts that live on our side:
          your saved songs and the assistant.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {tiers.map((t) => (
            <section key={t.id} className={`panel flex flex-col p-6 ${t.id === "pro" ? "border-[var(--color-accent)]/50" : ""}`}>
              <h2 className="text-lg font-medium">{PLANS[t.id].label}</h2>
              <p className="mb-5 mt-1 text-2xl font-semibold">{PLANS[t.id].price}</p>
              <ul className="mb-6 flex-1 space-y-2 text-sm text-white/65">
                {[...ALWAYS, ...t.extra].map((f) => (
                  <li key={f} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" /> {f}</li>
                ))}
              </ul>
              <PricingActions plan={t.id} />
            </section>
          ))}
        </div>
        <p className="mt-6 text-xs text-white/35">Cancel any time from your account; Pro runs to the end of the month you paid for. Prices include VAT where it applies.</p>
      </main>
      <SiteFooter />
    </>
  );
}
