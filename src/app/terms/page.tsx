// DRAFT — have a Danish lawyer review before relying on it (especially sections 4, 5 and 10).
import SiteHeader, { SiteFooter } from "@/components/SiteHeader";
import { COMPANY, companyComplete } from "@/lib/company";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Terms — Riffscribe" };

const UPDATED = "19 November 2026";

function H({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h2 id={id} className="mb-2 mt-8 scroll-mt-6 text-lg font-medium text-white">{children}</h2>;
}

const Email = () => <a className="underline" href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>;

export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed text-white/65 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Terms of service</h1>
        <p className="mt-2 text-xs text-white/35">Last updated {UPDATED}</p>

        <p className="mt-6">By using Riffscribe (&ldquo;the service&rdquo;) you agree to these terms.</p>

        <H>1. Who we are</H>
        {companyComplete() ? (
          <p>
            Riffscribe is operated by {COMPANY.legalName}, CVR {COMPANY.cvr}
            {COMPANY.vatId ? <>, VAT {COMPANY.vatId}</> : null}, {COMPANY.address}, Denmark. Contact:{" "}
            <Email />{COMPANY.phone ? <>, {COMPANY.phone}</> : null}.
          </p>
        ) : (
          <p>Riffscribe is operated by 6x7. Contact: <Email />.</p>
        )}

        <H>2. The service</H>
        <p>Riffscribe turns a recording into notation, tablature and practice tools. Transcription runs in your browser
          and is a best-effort first draft; it will contain mistakes. Audio you load is processed on your own device and
          is never uploaded to us.</p>
        <p className="mt-2">The assistant is an AI system. Its answers can be wrong, so check anything that matters
          before relying on it. Charts you save (notes, tempo, key, sections) are stored under your account until you
          delete them, and you keep ownership of them. We only store and display them back to you and to people you
          share them with. Share links make a chart readable by anyone who has the link.</p>

        <H>3. Accounts</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>You must be at least 13 to have an account. Paying for Pro requires you to be 18, or to have a
            parent&rsquo;s or guardian&rsquo;s consent.</li>
          <li>Your login is shared with other 6x7 apps. You are responsible for keeping access to your email secure.</li>
          <li>Free and paid plans have limits on saved songs and assistant requests, shown on your account page.</li>
        </ul>

        <H>4. Price and billing</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Pro costs {PLANS.pro.price} in euro. VAT is added or included according to the invoice Stripe issues
            for your country.</li>
          <li>Pro renews every month until you cancel. Payment is taken through Stripe.</li>
          <li>You can cancel at any time from your account page (the billing portal). Pro then runs to the end of the
            period you paid for.</li>
          <li>If we change the price we tell you at least 30 days before it applies, and you can cancel before then.</li>
        </ul>

        <H id="withdrawal">5. Right of withdrawal</H>
        <p>If you are a consumer in the EU you may withdraw from a Pro subscription within 14 days of your first
          payment, without giving a reason. We refund the full amount you paid.</p>
        <p className="mt-2">To withdraw, use the withdrawal button on your account page while it is shown, or email{" "}
          <Email /> with a clear statement that you withdraw. You can use the form below, but you do not have to.
          Withdrawing ends Pro and your plan returns to Free.</p>
        <blockquote className="mt-3 border-l border-white/15 pl-4 text-white/55">
          <p className="font-medium text-white/70">Model withdrawal form</p>
          <p className="mt-1">To {COMPANY.legalName ?? "6x7"}, <Email />:</p>
          <p className="mt-1">I hereby give notice that I withdraw from my contract for the supply of the following
            service: Riffscribe Pro subscription.</p>
          <p className="mt-1">Ordered on / received on: ____________</p>
          <p>Name of consumer: ____________</p>
          <p>Address of consumer (only if sent on paper): ____________</p>
          <p>Date: ____________</p>
        </blockquote>

        <H>6. Faults</H>
        <p>If the service does not work as described, you have the remedies the law gives consumers for faulty digital
          services, such as having it brought into conformity or a price reduction or termination. Nothing in these terms
          removes them. Tell us at <Email /> and we will fix it or put it right.</p>

        <H>7. Liability</H>
        <p>The service is provided &ldquo;as is&rdquo;, without warranties beyond what the law requires. As far as the law
          allows, we are not liable for indirect or consequential loss, and for business users our total liability is
          limited to what you paid us in the previous 12 months. Nothing in these terms limits liability that cannot be
          limited by law, including towards consumers.</p>

        <H>8. Acceptable use and copyright</H>
        <p>Don&rsquo;t abuse, overload, or try to get unauthorised access to the service or the assistant. You are
          responsible for having the right to use the recordings you load and the charts you share, and you must not use
          share links to distribute material you have no right to distribute. We may suspend accounts that do.</p>

        <H>9. Ending</H>
        <p>You can delete your data at any time from your account page. Deleting your account cancels Pro immediately
          and does not refund the rest of the period you paid for, except where you withdraw within the 14 days in
          section 5. We may suspend or end accounts that break these terms.</p>

        <H>10. Law and complaints</H>
        <p>Danish law applies. If you are a consumer, this does not take away the mandatory protections of the country
          where you live. Send complaints to <Email /> first. If we cannot settle it, a consumer can bring it to
          Nævnenes Hus / Forbrugerklagenævnet (naevneneshus.dk).</p>

        <H>11. Changes to these terms</H>
        <p>If we make a material change we tell you by email before it applies. The date at the top shows when these
          terms were last updated. See also the <a className="underline" href="/privacy">privacy policy</a>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
