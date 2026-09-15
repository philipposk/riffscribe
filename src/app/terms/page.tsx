// DRAFT — have a lawyer review before relying on it.
import SiteHeader, { SiteFooter } from "@/components/SiteHeader";

export const metadata = { title: "Terms — Riffscribe" };

const UPDATED = "15 September 2026";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-lg font-medium text-white">{children}</h2>;
}

export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed text-white/65 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Terms of service</h1>
        <p className="mt-2 text-xs text-white/35">Last updated {UPDATED}</p>

        <p className="mt-6">By using Riffscribe (&ldquo;the service&rdquo;) you agree to these terms.</p>

        <H>The service</H>
        <p>Riffscribe turns a recording into notation, tablature and practice tools. Transcription runs in your browser
          and is a best-effort first draft; it will contain mistakes.</p>

        <H>Your recordings and charts</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Audio you load is processed on your own device and never uploaded to us.</li>
          <li>Charts you save (notes, tempo, key, sections) are stored under your account until you delete them.</li>
          <li>You are responsible for having the right to use the recordings you load and the charts you share.
            Share links make a chart readable by anyone who has the link.</li>
          <li>You keep ownership of your charts. We only store and display them back to you and to people you share them with.</li>
        </ul>

        <H>Plans and billing</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Free and paid plans have limits on saved songs and assistant requests, shown on your account page.</li>
          <li>Pro is billed monthly through Stripe until you cancel. Cancelling keeps Pro until the end of the paid
            month. Fees already paid are not refunded except where the law requires.</li>
          <li>We may change prices or limits with reasonable notice.</li>
        </ul>

        <H>Acceptable use</H>
        <p>Don&rsquo;t abuse, overload, or try to get unauthorised access to the service or the assistant, and don&rsquo;t
          use share links to distribute material you have no right to distribute. We may suspend accounts that do.</p>

        <H>Disclaimers and liability</H>
        <p>The service is provided &ldquo;as is&rdquo;, without warranties. As far as the law allows, we are not liable for
          indirect or consequential loss, and our total liability is limited to what you paid us in the previous 12 months.</p>

        <H>Ending</H>
        <p>You can delete your data at any time from your account page. We may end accounts that break these terms.</p>

        <H>Contact</H>
        <p><a className="underline" href="mailto:phktistakis@gmail.com">phktistakis@gmail.com</a> · see also the{" "}
          <a className="underline" href="/privacy">privacy policy</a>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
